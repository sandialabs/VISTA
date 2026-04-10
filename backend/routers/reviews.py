import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import utils.crud as crud
from core import schemas
from core.database import get_db
from utils.dependencies import (
    get_current_user,
    get_user_context,
    UserContext,
    get_image_or_403,
    get_image_or_403_writable,
    get_project_or_403,
)

router = APIRouter(
    tags=["Reviews"],
)


@router.post(
    "/images/{image_id}/reviews",
    response_model=schemas.ImageReview,
    status_code=status.HTTP_201_CREATED,
)
async def create_review(
    image_id: uuid.UUID,
    review: schemas.ImageReviewBase,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Mark an image as pass or reject (creates a new review record)."""
    db_image = await get_image_or_403_writable(image_id, db, user_context.user)

    review_create = schemas.ImageReviewCreate(
        image_id=image_id,
        project_id=db_image.project_id,
        status=review.status,
        notes=review.notes,
        reviewer_id=user_context.id,
    )

    return await crud.create_image_review(
        db=db, review=review_create, created_by=user_context.email
    )


@router.get(
    "/images/{image_id}/reviews",
    response_model=List[schemas.ImageReviewWithUser],
)
async def list_reviews(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get the review history for an image."""
    await get_image_or_403(image_id, db, current_user)
    return await crud.get_reviews_for_image(db=db, image_id=image_id)


@router.get(
    "/images/{image_id}/review-status",
    response_model=schemas.ImageReviewSummary,
)
async def get_image_review_status(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get the current review status summary for an image."""
    await get_image_or_403(image_id, db, current_user)
    reviews = await crud.get_reviews_for_image(db=db, image_id=image_id)
    latest = reviews[0] if reviews else None
    current_status = latest.status if latest else "unreviewed"

    return schemas.ImageReviewSummary(
        image_id=image_id,
        status=current_status,
        review_count=len(reviews),
        latest_review=latest,
    )


@router.delete(
    "/reviews/{review_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_review(
    review_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Revoke/delete a review record."""
    db_review = await crud.get_image_review(db=db, review_id=review_id)
    if db_review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Review not found"
        )

    # Ensure user has access to the image's project (and project isn't archived)
    await get_image_or_403_writable(db_review.image_id, db, user_context.user)

    success = await crud.delete_image_review(
        db=db, review_id=review_id, deleted_by=user_context.email
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete review",
        )
    return None


@router.get(
    "/projects/{project_id}/review-status",
    response_model=schemas.ProjectReviewStatus,
)
async def get_project_review_status(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get aggregate review status for a project."""
    await get_project_or_403(project_id, db, current_user)
    return await crud.get_review_status_for_project(db=db, project_id=project_id)


@router.get(
    "/projects/{project_id}/image-review-statuses",
)
async def get_image_review_statuses(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get the latest review status for all images in a project.

    Returns a mapping of image_id -> status (or 'unreviewed').
    """
    await get_project_or_403(project_id, db, current_user)

    # Paginate through all images to avoid truncating at an arbitrary limit
    page_size = 10000
    offset = 0
    all_images = []
    while True:
        page = await crud.get_data_instances_for_project(
            db=db, project_id=project_id, limit=page_size, skip=offset
        )
        if not page:
            break
        all_images.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    image_ids = [img.id for img in all_images if img.deleted_at is None]
    status_map = await crud.get_review_status_for_images(db=db, image_ids=image_ids)
    return {
        str(img_id): status_map.get(img_id, "unreviewed") for img_id in image_ids
    }
