import logging
import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import BBoxClass

logger = logging.getLogger(__name__)


def _sanitize(val: str) -> str:
    if not val:
        return ""
    return val.replace("\n", "").replace("\r", "")


async def create_bbox_class(
    db: AsyncSession, bbox_class, created_by: str = ""
) -> BBoxClass:
    logger.info(
        "Creating bbox class",
        extra={"project_id": str(bbox_class.project_id), "user": _sanitize(created_by)},
    )
    db_obj = BBoxClass(
        project_id=bbox_class.project_id,
        name=bbox_class.name,
        description=bbox_class.description,
        color=bbox_class.color,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_bbox_class(db: AsyncSession, class_id: uuid.UUID) -> Optional[BBoxClass]:
    result = await db.execute(
        select(BBoxClass).where(BBoxClass.id == class_id)
    )
    return result.scalars().first()


async def get_bbox_classes_for_project(
    db: AsyncSession, project_id: uuid.UUID
) -> List[BBoxClass]:
    result = await db.execute(
        select(BBoxClass)
        .where(BBoxClass.project_id == project_id)
        .order_by(BBoxClass.created_at)
    )
    return list(result.scalars().all())


async def update_bbox_class(
    db: AsyncSession, class_id: uuid.UUID, update_data: dict, updated_by: str = ""
) -> Optional[BBoxClass]:
    db_obj = await get_bbox_class(db, class_id)
    if not db_obj:
        return None
    for key, value in update_data.items():
        if value is not None:
            setattr(db_obj, key, value)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def delete_bbox_class(
    db: AsyncSession, class_id: uuid.UUID, deleted_by: str = ""
) -> bool:
    db_obj = await get_bbox_class(db, class_id)
    if not db_obj:
        return False
    await db.delete(db_obj)
    await db.commit()
    return True
