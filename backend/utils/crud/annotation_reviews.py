import logging
import uuid
from typing import List, Optional, Dict, Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import AnnotationReview, AuditEvent

logger = logging.getLogger(__name__)


async def create_annotation_review(
    db: AsyncSession, review_data, created_by: str = ""
) -> AnnotationReview:
    db_obj = AnnotationReview(
        annotation_id=review_data.annotation_id,
        annotation_type=review_data.annotation_type,
        reviewer_id=review_data.reviewer_id,
        action=review_data.action,
        comment=review_data.comment,
        edits_made=review_data.edits_made,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_reviews_for_annotation(
    db: AsyncSession, annotation_id: uuid.UUID, annotation_type: str = "user"
) -> List[AnnotationReview]:
    result = await db.execute(
        select(AnnotationReview)
        .where(
            AnnotationReview.annotation_id == annotation_id,
            AnnotationReview.annotation_type == annotation_type,
        )
        .order_by(AnnotationReview.created_at.desc())
    )
    return list(result.scalars().all())


async def get_annotation_review_stats(
    db: AsyncSession, project_id: uuid.UUID
) -> Dict[str, int]:
    """Get aggregate review stats for annotations in a project."""
    from core.models import UserAnnotation

    total_result = await db.execute(
        select(func.count()).select_from(UserAnnotation).where(
            UserAnnotation.project_id == project_id
        )
    )
    total = total_result.scalar() or 0

    ann_result = await db.execute(
        select(UserAnnotation.id).where(UserAnnotation.project_id == project_id)
    )
    ann_ids = [row[0] for row in ann_result.all()]

    if not ann_ids:
        return {"total": 0, "approved": 0, "rejected": 0, "flagged": 0, "unreviewed": 0}

    reviewed_ids = set()
    status_counts = {"approve": 0, "reject": 0, "flag_revision": 0}

    for ann_id in ann_ids:
        latest = await db.execute(
            select(AnnotationReview)
            .where(AnnotationReview.annotation_id == ann_id)
            .order_by(AnnotationReview.created_at.desc())
            .limit(1)
        )
        review = latest.scalars().first()
        if review:
            reviewed_ids.add(ann_id)
            if review.action in status_counts:
                status_counts[review.action] += 1

    return {
        "total": total,
        "approved": status_counts["approve"],
        "rejected": status_counts["reject"],
        "flagged": status_counts["flag_revision"],
        "unreviewed": total - len(reviewed_ids),
    }


async def get_audit_events(
    db: AsyncSession,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
    action: Optional[str] = None,
    actor_user_id: Optional[uuid.UUID] = None,
    project_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[AuditEvent]:
    query = select(AuditEvent).order_by(AuditEvent.created_at.desc())
    if entity_type:
        query = query.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditEvent.entity_id == entity_id)
    if action:
        query = query.where(AuditEvent.action == action)
    if actor_user_id:
        query = query.where(AuditEvent.actor_user_id == actor_user_id)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_audit_events(
    db: AsyncSession,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
) -> int:
    query = select(func.count()).select_from(AuditEvent)
    if entity_type:
        query = query.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditEvent.entity_id == entity_id)
    result = await db.execute(query)
    return result.scalar() or 0
