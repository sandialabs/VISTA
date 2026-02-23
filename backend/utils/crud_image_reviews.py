import uuid
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from core import models


async def create_or_update_image_review(
    db: AsyncSession,
    *,
    collection_id: uuid.UUID,
    image_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    status: str,
    notes: Optional[str] = None,
) -> models.ImageReview:
    result = await db.execute(
        select(models.ImageReview).where(
            models.ImageReview.collection_id == collection_id,
            models.ImageReview.image_id == image_id,
        )
    )
    existing = result.scalars().first()
    if existing:
        existing.reviewer_id = reviewer_id
        existing.status = status
        existing.notes = notes
        await db.commit()
        await db.refresh(existing)
        return existing

    review = models.ImageReview(
        collection_id=collection_id,
        image_id=image_id,
        reviewer_id=reviewer_id,
        status=status,
        notes=notes,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return review


async def get_image_review(
    db: AsyncSession,
    collection_id: uuid.UUID,
    image_id: uuid.UUID,
) -> Optional[models.ImageReview]:
    result = await db.execute(
        select(models.ImageReview).where(
            models.ImageReview.collection_id == collection_id,
            models.ImageReview.image_id == image_id,
        )
    )
    return result.scalars().first()


async def get_image_reviews_for_collection(
    db: AsyncSession,
    collection_id: uuid.UUID,
) -> List[models.ImageReview]:
    result = await db.execute(
        select(models.ImageReview).where(
            models.ImageReview.collection_id == collection_id
        )
    )
    return result.scalars().all()


async def get_review_progress(
    db: AsyncSession,
    collection_id: uuid.UUID,
) -> dict:
    # Total images
    total_images = await db.execute(
        select(func.count())
        .select_from(models.CollectionMembership)
        .where(models.CollectionMembership.collection_id == collection_id)
    )
    total = total_images.scalar_one()

    # Reviewed
    reviewed_q = await db.execute(
        select(func.count())
        .select_from(models.ImageReview)
        .where(
            models.ImageReview.collection_id == collection_id,
            models.ImageReview.status == "reviewed",
        )
    )
    reviewed = reviewed_q.scalar_one()

    # Flagged
    flagged_q = await db.execute(
        select(func.count())
        .select_from(models.ImageReview)
        .where(
            models.ImageReview.collection_id == collection_id,
            models.ImageReview.status == "flagged",
        )
    )
    flagged = flagged_q.scalar_one()

    # Annotation counts
    ann_total_q = await db.execute(
        select(func.count())
        .select_from(models.UserAnnotation)
        .where(models.UserAnnotation.collection_id == collection_id)
    )
    ann_total = ann_total_q.scalar_one()

    ann_approved_q = await db.execute(
        select(func.count())
        .select_from(models.UserAnnotation)
        .where(
            models.UserAnnotation.collection_id == collection_id,
            models.UserAnnotation.review_status == "approved",
        )
    )
    ann_approved = ann_approved_q.scalar_one()

    ann_pending_q = await db.execute(
        select(func.count())
        .select_from(models.UserAnnotation)
        .where(
            models.UserAnnotation.collection_id == collection_id,
            models.UserAnnotation.review_status == "pending",
        )
    )
    ann_pending = ann_pending_q.scalar_one()

    ann_rejected_q = await db.execute(
        select(func.count())
        .select_from(models.UserAnnotation)
        .where(
            models.UserAnnotation.collection_id == collection_id,
            models.UserAnnotation.review_status == "rejected",
        )
    )
    ann_rejected = ann_rejected_q.scalar_one()

    ann_flagged_q = await db.execute(
        select(func.count())
        .select_from(models.UserAnnotation)
        .where(
            models.UserAnnotation.collection_id == collection_id,
            models.UserAnnotation.review_status == "flagged",
        )
    )
    ann_flagged = ann_flagged_q.scalar_one()

    return {
        "total_images": total,
        "reviewed": reviewed,
        "flagged": flagged,
        "unreviewed": total - reviewed - flagged,
        "annotation_total": ann_total,
        "annotation_approved": ann_approved,
        "annotation_pending": ann_pending,
        "annotation_rejected": ann_rejected,
        "annotation_flagged": ann_flagged,
    }


async def delete_image_reviews_for_collection(
    db: AsyncSession, collection_id: uuid.UUID
) -> int:
    result = await db.execute(
        delete(models.ImageReview).where(
            models.ImageReview.collection_id == collection_id
        )
    )
    await db.commit()
    return result.rowcount
