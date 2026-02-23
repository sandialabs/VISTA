import uuid
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Dict, Any
from core import models


async def create_bbox_class(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    collection_id: uuid.UUID,
    name: str,
    color: str = "#FF0000",
    description: Optional[str] = None,
) -> models.BoundingBoxClass:
    obj = models.BoundingBoxClass(
        project_id=project_id,
        collection_id=collection_id,
        name=name,
        color=color,
        description=description,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


async def get_bbox_class(
    db: AsyncSession, bbox_class_id: uuid.UUID
) -> Optional[models.BoundingBoxClass]:
    result = await db.execute(
        select(models.BoundingBoxClass).where(
            models.BoundingBoxClass.id == bbox_class_id
        )
    )
    return result.scalars().first()


async def get_bbox_classes_for_collection(
    db: AsyncSession, collection_id: uuid.UUID
) -> List[models.BoundingBoxClass]:
    result = await db.execute(
        select(models.BoundingBoxClass)
        .where(models.BoundingBoxClass.collection_id == collection_id)
        .order_by(models.BoundingBoxClass.created_at.asc())
    )
    return result.scalars().all()


async def update_bbox_class(
    db: AsyncSession,
    bbox_class_id: uuid.UUID,
    data: Dict[str, Any],
) -> Optional[models.BoundingBoxClass]:
    obj = await get_bbox_class(db, bbox_class_id)
    if not obj:
        return None
    await db.execute(
        update(models.BoundingBoxClass)
        .where(models.BoundingBoxClass.id == bbox_class_id)
        .values(**data)
    )
    await db.commit()
    return await get_bbox_class(db, bbox_class_id)


async def delete_bbox_class(
    db: AsyncSession, bbox_class_id: uuid.UUID
) -> bool:
    obj = await get_bbox_class(db, bbox_class_id)
    if not obj:
        return False
    await db.execute(
        delete(models.BoundingBoxClass).where(
            models.BoundingBoxClass.id == bbox_class_id
        )
    )
    await db.commit()
    return True
