import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.schemas import User
from core.schemas_annotations import (
    UserAnnotation, AnnotationReviewCreate,
)
from utils.dependencies import (
    get_current_user, get_image_or_403, resolve_user_id,
    check_collection_allows,
)
from utils.crud_annotations import (
    get_annotation, get_annotations_for_image,
    update_annotation_review, count_annotations_for_image,
)
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(tags=["annotation-reviews"])


@router.post("/annotations/{annotation_id}/review", response_model=UserAnnotation)
async def review_annotation_endpoint(
    annotation_id: uuid.UUID,
    body: AnnotationReviewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ann = await get_annotation(db, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await get_image_or_403(ann.image_id, db, current_user)
    if ann.collection_id:
        await check_collection_allows(ann.collection_id, "review_annotation", db)
    user_id = await resolve_user_id(current_user, db)
    updated = await update_annotation_review(
        db,
        annotation_id,
        review_status=body.review_status,
        reviewed_by_id=user_id,
        review_comment=body.review_comment,
    )
    return UserAnnotation.model_validate(updated)


@router.get("/images/{image_id}/annotations/review-summary")
async def annotation_review_summary_endpoint(
    image_id: uuid.UUID,
    collection_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_image_or_403(image_id, db, current_user)
    annotations = await get_annotations_for_image(db, image_id, collection_id)
    total = len(annotations)
    approved = sum(1 for a in annotations if a.review_status == "approved")
    rejected = sum(1 for a in annotations if a.review_status == "rejected")
    pending = sum(1 for a in annotations if a.review_status == "pending")
    flagged = sum(1 for a in annotations if a.review_status == "flagged")
    return {
        "total": total,
        "approved": approved,
        "rejected": rejected,
        "pending": pending,
        "flagged": flagged,
    }
