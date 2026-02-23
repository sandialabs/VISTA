import uuid
from datetime import datetime, timezone
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Dict, Any
from core import models
import logging

logger = logging.getLogger(__name__)


async def create_annotation(
    db: AsyncSession,
    *,
    image_id: uuid.UUID,
    project_id: uuid.UUID,
    collection_id: Optional[uuid.UUID],
    bbox_class_id: uuid.UUID,
    created_by_id: uuid.UUID,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
    image_width: int,
    image_height: int,
    notes: Optional[str] = None,
    origin: str = "manual",
    original_annotation_id: Optional[uuid.UUID] = None,
) -> models.UserAnnotation:
    ann = models.UserAnnotation(
        image_id=image_id,
        project_id=project_id,
        collection_id=collection_id,
        bbox_class_id=bbox_class_id,
        created_by_id=created_by_id,
        x_min=x_min,
        y_min=y_min,
        x_max=x_max,
        y_max=y_max,
        image_width=image_width,
        image_height=image_height,
        notes=notes,
        origin=origin,
        original_annotation_id=original_annotation_id,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    return ann


async def get_annotation(
    db: AsyncSession, annotation_id: uuid.UUID
) -> Optional[models.UserAnnotation]:
    result = await db.execute(
        select(models.UserAnnotation).where(
            models.UserAnnotation.id == annotation_id
        )
    )
    return result.scalars().first()


async def get_annotations_for_image(
    db: AsyncSession,
    image_id: uuid.UUID,
    collection_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 500,
) -> List[models.UserAnnotation]:
    stmt = select(models.UserAnnotation).where(
        models.UserAnnotation.image_id == image_id
    )
    if collection_id:
        stmt = stmt.where(models.UserAnnotation.collection_id == collection_id)
    stmt = stmt.order_by(models.UserAnnotation.created_at.asc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


async def count_annotations_for_image(
    db: AsyncSession,
    image_id: uuid.UUID,
    collection_id: Optional[uuid.UUID] = None,
) -> int:
    stmt = (
        select(func.count())
        .select_from(models.UserAnnotation)
        .where(models.UserAnnotation.image_id == image_id)
    )
    if collection_id:
        stmt = stmt.where(models.UserAnnotation.collection_id == collection_id)
    result = await db.execute(stmt)
    return result.scalar_one()


async def update_annotation(
    db: AsyncSession,
    annotation_id: uuid.UUID,
    data: Dict[str, Any],
) -> Optional[models.UserAnnotation]:
    ann = await get_annotation(db, annotation_id)
    if not ann:
        return None
    await db.execute(
        update(models.UserAnnotation)
        .where(models.UserAnnotation.id == annotation_id)
        .values(**data)
    )
    await db.commit()
    return await get_annotation(db, annotation_id)


async def delete_annotation(
    db: AsyncSession, annotation_id: uuid.UUID
) -> bool:
    ann = await get_annotation(db, annotation_id)
    if not ann:
        return False
    await db.execute(
        delete(models.UserAnnotation).where(
            models.UserAnnotation.id == annotation_id
        )
    )
    await db.commit()
    return True


async def update_annotation_review(
    db: AsyncSession,
    annotation_id: uuid.UUID,
    review_status: str,
    reviewed_by_id: uuid.UUID,
    review_comment: Optional[str] = None,
) -> Optional[models.UserAnnotation]:
    now = datetime.now(timezone.utc)
    await db.execute(
        update(models.UserAnnotation)
        .where(models.UserAnnotation.id == annotation_id)
        .values(
            review_status=review_status,
            reviewed_by_id=reviewed_by_id,
            reviewed_at=now,
            review_comment=review_comment,
        )
    )
    await db.commit()
    return await get_annotation(db, annotation_id)
