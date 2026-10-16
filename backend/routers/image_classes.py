import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from repositories import image_classes as image_class_repository
from repositories import users as user_repository
from schemas import image_classes as image_class_schemas
from schemas import users as user_schemas
from utils.dependencies import (
    UserContext,
    get_current_user,
    get_image_or_403,
    get_image_or_403_writable,
    get_project_or_403,
    get_project_or_403_writable,
    get_user_context,
)

router = APIRouter(
    tags=["Image Classes"],
)


# Image Classes endpoints
@router.post(
    "/projects/{project_id}/classes",
    response_model=image_class_schemas.ImageClass,
    status_code=status.HTTP_201_CREATED,
)
async def create_image_class(
    project_id: uuid.UUID,
    image_class: image_class_schemas.ImageClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(project_id, db, current_user)

    # Ensure the project_id in the path matches the one in the request body
    if project_id != image_class.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project ID in the path must match the project_id in the request body",
        )

    # Create the image class
    return await image_class_repository.create_image_class(
        db=db, image_class=image_class
    )


@router.get(
    "/projects/{project_id}/classes",
    response_model=list[image_class_schemas.ImageClass],
)
async def list_image_classes(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project
    await get_project_or_403(project_id, db, current_user)

    # Get all image classes for the project
    return await image_class_repository.get_image_classes_for_project(
        db=db, project_id=project_id
    )


@router.get("/classes/{class_id}", response_model=image_class_schemas.ImageClass)
async def get_image_class(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Get the image class
    db_class = await image_class_repository.get_image_class(db=db, class_id=class_id)
    if db_class is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found"
        )

    # Check if the user has access to the project
    await get_project_or_403(db_class.project_id, db, current_user)

    return db_class


@router.patch("/classes/{class_id}", response_model=image_class_schemas.ImageClass)
async def update_image_class(
    class_id: uuid.UUID,
    image_class_data: image_class_schemas.ImageClassBase,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Get the image class
    db_class = await image_class_repository.get_image_class(db=db, class_id=class_id)
    if db_class is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found"
        )

    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(db_class.project_id, db, current_user)

    # Update the image class
    updated_class = await image_class_repository.update_image_class(
        db=db,
        class_id=class_id,
        image_class_data=image_class_data.model_dump(exclude_unset=True),
    )

    return updated_class


@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image_class(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Get the image class
    db_class = await image_class_repository.get_image_class(db=db, class_id=class_id)
    if db_class is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found"
        )

    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(db_class.project_id, db, current_user)

    # Delete the image class
    success = await image_class_repository.delete_image_class(db=db, class_id=class_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete image class",
        )

    return None


# Image Classifications endpoints


@router.post(
    "/images/{image_id}/classifications",
    response_model=image_class_schemas.ImageClassification,
    status_code=status.HTTP_201_CREATED,
)
async def classify_image(
    image_id: uuid.UUID,
    classification: image_class_schemas.ImageClassificationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the image (and that the project isn't archived)
    db_image = await get_image_or_403_writable(image_id, db, current_user)

    # Ensure the image_id in the path matches the one in the request body
    # Convert both to strings for comparison to handle different UUID object types
    if str(image_id) != str(classification.image_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Image ID in the path must match the image_id in the request body. Path: {image_id}, Body: {classification.image_id}",
        )

    # Get the image class to ensure it exists and belongs to the same project
    db_class = await image_class_repository.get_image_class(
        db=db, class_id=classification.class_id
    )
    if db_class is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Image class not found"
        )

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
        db_user = await user_repository.get_user_by_email(
            db=db, email=current_user.email
        )
        if not db_user:
            # Create a new user
            user_create = user_schemas.UserCreate(
                email=current_user.email,
            )
            db_user = await user_repository.create_user(db=db, user=user_create)

        classification.created_by_id = db_user.id

    # Create the classification
    return await image_class_repository.create_image_classification(
        db=db, classification=classification
    )


@router.get(
    "/images/{image_id}/classifications",
    response_model=list[image_class_schemas.ImageClassification],
)
async def list_image_classifications(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the image
    await get_image_or_403(image_id, db, current_user)

    # Get all classifications for the image
    return await image_class_repository.get_classifications_for_image(
        db=db, image_id=image_id
    )


@router.delete(
    "/classifications/{classification_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_classification(
    classification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    # Get the classification
    db_classification = await image_class_repository.get_image_classification(
        db=db, classification_id=classification_id
    )
    if db_classification is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Classification not found"
        )

    # Check if the user has access to the image's project (and that it's not archived)
    await get_image_or_403_writable(db_classification.image_id, db, user_context.user)

    # Delete the classification
    success = await image_class_repository.delete_image_classification(
        db=db, classification_id=classification_id, deleted_by=user_context.email
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete classification",
        )

    return None
