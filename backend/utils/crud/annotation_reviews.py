import logging
import uuid
from typing import List, Optional, Dict
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
    from sqlalchemy import text
    from core.models import UserAnnotation

    total_result = await db.execute(
        select(func.count()).select_from(UserAnnotation).where(
            UserAnnotation.project_id == project_id
        )
    )
    total = total_result.scalar() or 0

    if total == 0:
        return {"total": 0, "approved": 0, "rejected": 0, "flagged": 0, "unreviewed": 0}

    # Single query: get the latest review action per annotation using a window function
    latest_reviews = (
        select(
            AnnotationReview.annotation_id,
            AnnotationReview.action,
            func.row_number().over(
                partition_by=AnnotationReview.annotation_id,
                order_by=AnnotationReview.created_at.desc(),
            ).label("rn"),
        )
        .where(
            AnnotationReview.annotation_id.in_(
                select(UserAnnotation.id).where(UserAnnotation.project_id == project_id)
            )
        )
        .subquery()
    )
    result = await db.execute(
        select(latest_reviews.c.action, func.count())
        .where(latest_reviews.c.rn == 1)
        .group_by(latest_reviews.c.action)
    )
    action_counts = dict(result.all())
    reviewed = sum(action_counts.values())

    return {
        "total": total,
        "approved": action_counts.get("approve", 0),
        "rejected": action_counts.get("reject", 0),
        "flagged": action_counts.get("flag_revision", 0),
        "unreviewed": total - reviewed,
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
    if project_id:
        query = query.where(AuditEvent.project_id == project_id)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_audit_events(
    db: AsyncSession,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
    project_id: Optional[uuid.UUID] = None,
) -> int:
    query = select(func.count()).select_from(AuditEvent)
    if entity_type:
        query = query.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditEvent.entity_id == entity_id)
    if project_id:
        query = query.where(AuditEvent.project_id == project_id)
    result = await db.execute(query)
    return result.scalar() or 0
