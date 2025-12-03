import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import utils.crud as crud
from core import schemas
from core.database import get_db
from utils.dependencies import get_current_user, get_user_context, UserContext, get_image_or_403

router = APIRouter(
    tags=["Comments"],
)

@router.post("/images/{image_id}/comments", response_model=schemas.ImageComment, status_code=status.HTTP_201_CREATED)
async def create_comment(
    image_id: uuid.UUID,
    comment: schemas.ImageCommentBase,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    print(f"Comment request received for image_id: {image_id}")
    print(f"Comment text: {comment.text}")
    print(f"Current user: {user_context.user}")
    
    # Check if the user has access to the image
    await get_image_or_403(image_id, db, user_context.user)
    
    # Set up the comment create object - automatic user ID resolution handled by get_user_context
    comment_create = schemas.ImageCommentCreate(
        image_id=image_id,
        text=comment.text,
        author_id=user_context.id  # Automatically resolved ID
    )
    
    print(f"Created comment object: {comment_create}")
    
    # Create the comment with automatic user context
    return await crud.create_comment(db=db, comment=comment_create, created_by=user_context.email)

@router.get("/images/{image_id}/comments", response_model=List[schemas.ImageComment])
async def list_comments(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the image
    await get_image_or_403(image_id, db, current_user)
    
    # Get all comments for the image
    return await crud.get_comments_for_image(db=db, image_id=image_id)

@router.get("/comments/{comment_id}", response_model=schemas.ImageComment)
async def get_comment(
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Get the comment
    db_comment = await crud.get_comment(db=db, comment_id=comment_id)
    if db_comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    
    # Check if the user has access to the image
    await get_image_or_403(db_comment.image_id, db, current_user)
    
    return db_comment

@router.patch("/comments/{comment_id}", response_model=schemas.ImageComment)
async def update_comment(
    comment_id: uuid.UUID,
    comment_data: schemas.ImageCommentBase,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    # Get the comment
    db_comment = await crud.get_comment(db=db, comment_id=comment_id)
    if db_comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    
    # Check if the user has access to the image
    await get_image_or_403(db_comment.image_id, db, current_user)
    
    # Only allow the author of the comment to update it (admin check removed since groups field is gone)
    if current_user.id and str(db_comment.author_id) != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this comment",
        )
    
    # Update the comment with automatic user context
    updated_comment = await crud.update_comment(
        db=db, 
        comment_id=comment_id, 
        comment_data=comment_data.model_dump(exclude_unset=True),
        updated_by=current_user.email
    )
    
    return updated_comment

@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    # Get the comment
    db_comment = await crud.get_comment(db=db, comment_id=comment_id)
    if db_comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    
    # Check if the user has access to the image
    await get_image_or_403(db_comment.image_id, db, user_context.user)
    
    # Only allow the author of the comment to delete it (admin check removed since groups field is gone)
    if user_context.id and str(db_comment.author_id) != str(user_context.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this comment",
        )
    
    # Delete the comment with automatic user context
    success = await crud.delete_comment(db=db, comment_id=comment_id, deleted_by=user_context.email)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete comment",
        )
    
    return None
