import uuid
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from core import models, schemas
from typing import List, Optional, Dict, Any

from ._common import log_db_operation


async def create_image_review(db: AsyncSession, review: schemas.ImageReviewCreate, created_by: Optional[str] = None) -> models.ImageReview:
    db_review = models.ImageReview(
        image_id=review.image_id,
        project_id=review.project_id,
        reviewer_id=review.reviewer_id,
        status=review.status,
        notes=review.notes,
    )
    db.add(db_review)
    await db.commit()
    await db.refresh(db_review)
    log_db_operation("CREATE", "image_reviews", db_review.id, created_by or "system",
                     {"image_id": str(review.image_id), "status": review.status})
    return db_review


async def get_image_review(db: AsyncSession, review_id: uuid.UUID) -> Optional[models.ImageReview]:
    result = await db.execute(
        select(models.ImageReview).where(models.ImageReview.id == review_id)
    )
    return result.scalars().first()


async def get_reviews_for_image(db: AsyncSession, image_id: uuid.UUID) -> List[schemas.ImageReviewWithUser]:
    result = await db.execute(
        select(models.ImageReview, models.User.email)
        .outerjoin(models.User, models.ImageReview.reviewer_id == models.User.id)
        .where(models.ImageReview.image_id == image_id)
        .order_by(models.ImageReview.created_at.desc(), models.ImageReview.id.desc())
    )

    return [
        schemas.ImageReviewWithUser(
            id=review.id,
            image_id=review.image_id,
            project_id=review.project_id,
            reviewer_id=review.reviewer_id,
            status=review.status,
            notes=review.notes,
            created_at=review.created_at,
            updated_at=review.updated_at,
            reviewer_email=email,
        )
        for review, email in result.all()
    ]


async def get_latest_review_for_image(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.ImageReview]:
    result = await db.execute(
        select(models.ImageReview)
        .where(models.ImageReview.image_id == image_id)
        .order_by(models.ImageReview.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def delete_image_review(db: AsyncSession, review_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    db_review = await get_image_review(db, review_id)
    if not db_review:
        return False
    log_db_operation("DELETE", "image_reviews", review_id, deleted_by or "system",
                     {"image_id": str(db_review.image_id), "status": db_review.status})
    await db.execute(delete(models.ImageReview).where(models.ImageReview.id == review_id))
    await db.commit()
    return True


async def get_review_status_for_project(db: AsyncSession, project_id: uuid.UUID) -> Dict[str, Any]:
    """Return aggregate review statistics for a project."""
    from sqlalchemy import func as _func

    # Total images (non-deleted)
    total_result = await db.execute(
        select(_func.count())
        .select_from(models.DataInstance)
        .where(
            models.DataInstance.project_id == project_id,
            models.DataInstance.deleted_at.is_(None),
        )
    )
    total_images = total_result.scalar_one()

    # Latest review status per image via a subquery, filtered to non-deleted images
    latest_review = (
        select(
            models.ImageReview.image_id,
            models.ImageReview.status,
            _func.row_number().over(
                partition_by=models.ImageReview.image_id,
                order_by=models.ImageReview.created_at.desc()
            ).label("rn")
        )
        .join(
            models.DataInstance,
            models.ImageReview.image_id == models.DataInstance.id,
        )
        .where(
            models.ImageReview.project_id == project_id,
            models.DataInstance.deleted_at.is_(None),
        )
        .subquery()
    )
    latest = select(latest_review.c.image_id, latest_review.c.status).where(latest_review.c.rn == 1).subquery()

    counts_result = await db.execute(
        select(
            latest.c.status,
            _func.count().label("cnt"),
        ).group_by(latest.c.status)
    )
    status_counts = {row.status: row.cnt for row in counts_result}
    reviewed = sum(status_counts.values())

    return {
        "project_id": project_id,
        "total_images": total_images,
        "reviewed": reviewed,
        "unreviewed": total_images - reviewed,
        "passed": status_counts.get("pass", 0),
        "reject_pending": status_counts.get("reject_pending", 0),
        "reject_confirmed": status_counts.get("reject_confirmed", 0),
    }


async def get_review_status_for_images(db: AsyncSession, image_ids: List[uuid.UUID]) -> Dict[uuid.UUID, Optional[str]]:
    """Return the latest review status for each image id."""
    if not image_ids:
        return {}
    from sqlalchemy import func as _func

    latest_review = (
        select(
            models.ImageReview.image_id,
            models.ImageReview.status,
            _func.row_number().over(
                partition_by=models.ImageReview.image_id,
                order_by=models.ImageReview.created_at.desc()
            ).label("rn")
        )
        .where(models.ImageReview.image_id.in_(image_ids))
        .subquery()
    )
    result = await db.execute(
        select(latest_review.c.image_id, latest_review.c.status)
        .where(latest_review.c.rn == 1)
    )
    return {row.image_id: row.status for row in result}
