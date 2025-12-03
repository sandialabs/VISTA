import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import utils.crud as crud
from core import schemas
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from utils.dependencies import get_current_user, get_project_or_403, get_image_or_403

router = APIRouter(
    tags=["Image Classes"],
)

# Image Classes endpoints
@router.post("/projects/{project_id}/classes", response_model=schemas.ImageClass, status_code=status.HTTP_201_CREATED)
async def create_image_class(
    project_id: uuid.UUID,
    image_class: schemas.ImageClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project
    await get_project_or_403(project_id, db, current_user)
    
    # Ensure the project_id in the path matches the one in the request body
    if project_id != image_class.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project ID in the path must match the project_id in the request body",
        )
    
    # Create the image class
    return await crud.create_image_class(db=db, image_class=image_class)

@router.get("/projects/{project_id}/classes", response_model=List[schemas.ImageClass])
async def list_image_classes(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project
    await get_project_or_403(project_id, db, current_user)
    
    # Get all image classes for the project
    return await crud.get_image_classes_for_project(db=db, project_id=project_id)

@router.get("/classes/{class_id}", response_model=schemas.ImageClass)
async def get_image_class(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Get the image class
    db_class = await crud.get_image_class(db=db, class_id=class_id)
    if db_class is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found")
    
    # Check if the user has access to the project
    await get_project_or_403(db_class.project_id, db, current_user)
    
    return db_class

@router.patch("/classes/{class_id}", response_model=schemas.ImageClass)
async def update_image_class(
    class_id: uuid.UUID,
    image_class_data: schemas.ImageClassBase,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Get the image class
    db_class = await crud.get_image_class(db=db, class_id=class_id)
    if db_class is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found")
    
    # Check if the user has access to the project
    await get_project_or_403(db_class.project_id, db, current_user)
    
    # Update the image class
    updated_class = await crud.update_image_class(
        db=db, 
        class_id=class_id, 
        image_class_data=image_class_data.model_dump(exclude_unset=True)
    )
    
    return updated_class

@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image_class(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Get the image class
    db_class = await crud.get_image_class(db=db, class_id=class_id)
    if db_class is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found")
    
    # Check if the user has access to the project
    await get_project_or_403(db_class.project_id, db, current_user)
    
    # Delete the image class
    success = await crud.delete_image_class(db=db, class_id=class_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete image class",
        )
    
    return None

# Image Classifications endpoints

@router.post("/images/{image_id}/classifications", response_model=schemas.ImageClassification, status_code=status.HTTP_201_CREATED)
async def classify_image(
    image_id: uuid.UUID,
    classification: schemas.ImageClassificationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    print(f"Classification request received for image_id: {image_id}")
    print(f"Request body: {classification}")
    
    # Check if the user has access to the image
    db_image = await get_image_or_403(image_id, db, current_user)
    
    # Ensure the image_id in the path matches the one in the request body
    # Convert both to strings for comparison to handle different UUID object types
    if str(image_id) != str(classification.image_id):
        print(f"Image ID mismatch: path={image_id}, body={classification.image_id}")
        print(f"Types: path={type(image_id)}, body={type(classification.image_id)}")
        print(f"String comparison: {str(image_id)} vs {str(classification.image_id)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Image ID in the path must match the image_id in the request body. Path: {image_id}, Body: {classification.image_id}",
        )
    
    # Get the image class to ensure it exists and belongs to the same project
    db_class = await crud.get_image_class(db=db, class_id=classification.class_id)
    if db_class is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found")
    
    if db_class.project_id != db_image.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image class must belong to the same project as the image",
        )
    
    # Set the created_by_id to the current user's ID
    # We need to ensure we have a valid user ID from a real user in the database
    
    # Check if the current user has an ID
    if current_user.id:
        classification.created_by_id = current_user.id
    else:
        # If the current user doesn't have an ID (e.g., it's a mock user),
        # we need to find or create a user record for them
        db_user = await crud.get_user_by_email(db=db, email=current_user.email)
        if not db_user:
            # Create a new user
            user_create = schemas.UserCreate(
                email=current_user.email,
            )
            db_user = await crud.create_user(db=db, user=user_create)
        
        classification.created_by_id = db_user.id
    
    # Log the final classification object before saving
    print(f"Final classification object to save: {classification}")
    
    # Create the classification
    return await crud.create_image_classification(db=db, classification=classification)

@router.get("/images/{image_id}/classifications", response_model=List[schemas.ImageClassification])
async def list_image_classifications(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the image
    await get_image_or_403(image_id, db, current_user)
    
    # Get all classifications for the image
    return await crud.get_classifications_for_image(db=db, image_id=image_id)

@router.delete("/classifications/{classification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_classification(
    classification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Get the classification
    db_classification = await crud.get_image_classification(db=db, classification_id=classification_id)
    if db_classification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classification not found")
    
    # Check if the user has access to the image
    await get_image_or_403(db_classification.image_id, db, current_user)
    
    # Only allow the user who created the classification or admin users to delete it
    is_admin = is_user_in_group(current_user.email, "admin")
    if (current_user.id and str(db_classification.created_by_id) != str(current_user.id)) and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this classification",
        )
    
    # Delete the classification
    success = await crud.delete_image_classification(db=db, classification_id=classification_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete classification",
        )
    
    return None
