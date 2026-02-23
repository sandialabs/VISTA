import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.schemas import User
from core.schemas_collections import ImageReviewCreate, ImageReviewResponse
from utils.dependencies import (
    get_current_user, get_project_or_403, resolve_user_id,
    check_collection_allows,
)
from utils.crud_collections import get_collection
from utils.crud_image_reviews import create_or_update_image_review, get_image_review

logger = logging.getLogger(__name__)
router = APIRouter(tags=["image-reviews"])


@router.post(
    "/collections/{collection_id}/images/{image_id}/review",
    response_model=ImageReviewResponse,
)
async def review_image_endpoint(
    collection_id: uuid.UUID,
    image_id: uuid.UUID,
    body: ImageReviewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll = await get_collection(db, collection_id)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    await get_project_or_403(coll.project_id, db, current_user)
    await check_collection_allows(collection_id, "review_image", db)
    user_id = await resolve_user_id(current_user, db)
    review = await create_or_update_image_review(
        db,
        collection_id=collection_id,
        image_id=image_id,
        reviewer_id=user_id,
        status=body.status,
        notes=body.notes,
    )
    return ImageReviewResponse.model_validate(review)


@router.get(
    "/collections/{collection_id}/images/{image_id}/review",
    response_model=ImageReviewResponse,
)
async def get_image_review_endpoint(
    collection_id: uuid.UUID,
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll = await get_collection(db, collection_id)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    await get_project_or_403(coll.project_id, db, current_user)
    review = await get_image_review(db, collection_id, image_id)
    if not review:
        raise HTTPException(status_code=404, detail="No review found for this image")
    return ImageReviewResponse.model_validate(review)
