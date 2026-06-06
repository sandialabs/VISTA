import logging
import uuid
from typing import List, Optional, Dict, Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.models import UserAnnotation

logger = logging.getLogger(__name__)


async def create_user_annotation(
    db: AsyncSession, image_id: uuid.UUID, project_id: uuid.UUID,
    annotation_data, user_id: uuid.UUID, created_by: str = ""
) -> UserAnnotation:
    # Use validated UUID format to prevent log injection (image_id is uuid.UUID)
    safe_id = uuid.UUID(str(image_id))
    logger.info("Creating user annotation for image %s", safe_id)
    db_obj = UserAnnotation(
        image_id=image_id,
        project_id=project_id,
        bbox_class_id=annotation_data.bbox_class_id,
        bbox_x_min=annotation_data.bbox_x_min,
        bbox_y_min=annotation_data.bbox_y_min,
        bbox_x_max=annotation_data.bbox_x_max,
        bbox_y_max=annotation_data.bbox_y_max,
        image_width=annotation_data.image_width,
        image_height=annotation_data.image_height,
        notes=annotation_data.notes,
        created_by_user_id=user_id,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_user_annotation(
    db: AsyncSession, annotation_id: uuid.UUID
) -> Optional[UserAnnotation]:
    result = await db.execute(
        select(UserAnnotation)
        .options(selectinload(UserAnnotation.bbox_class))
        .where(UserAnnotation.id == annotation_id)
    )
    return result.scalars().first()


async def list_annotations_for_image(
    db: AsyncSession, image_id: uuid.UUID
) -> List[Dict[str, Any]]:
    result = await db.execute(
        select(UserAnnotation)
        .options(
            selectinload(UserAnnotation.bbox_class),
            selectinload(UserAnnotation.created_by),
        )
        .where(UserAnnotation.image_id == image_id)
        .order_by(UserAnnotation.created_at)
    )
    annotations = result.scalars().all()
    out = []
    for a in annotations:
        data = {
            "id": a.id,
            "image_id": a.image_id,
            "project_id": a.project_id,
            "bbox_class_id": a.bbox_class_id,
            "bbox_x_min": a.bbox_x_min,
            "bbox_y_min": a.bbox_y_min,
            "bbox_x_max": a.bbox_x_max,
            "bbox_y_max": a.bbox_y_max,
            "image_width": a.image_width,
            "image_height": a.image_height,
            "notes": a.notes,
            "created_by_user_id": a.created_by_user_id,
            "updated_by_user_id": a.updated_by_user_id,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
            "class_name": a.bbox_class.name if a.bbox_class else None,
            "class_color": a.bbox_class.color if a.bbox_class else None,
            "creator_email": a.created_by.email if a.created_by else None,
        }
        out.append(data)
    return out


async def list_annotations_for_project(
    db: AsyncSession, project_id: uuid.UUID,
    class_id: Optional[uuid.UUID] = None,
    user_id: Optional[uuid.UUID] = None,
    skip: int = 0, limit: int = 10000,
) -> List[UserAnnotation]:
    query = (
        select(UserAnnotation)
        .options(selectinload(UserAnnotation.bbox_class))
        .where(UserAnnotation.project_id == project_id)
    )
    if class_id:
        query = query.where(UserAnnotation.bbox_class_id == class_id)
    if user_id:
        query = query.where(UserAnnotation.created_by_user_id == user_id)
    query = query.order_by(UserAnnotation.created_at).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def update_user_annotation(
    db: AsyncSession, annotation_id: uuid.UUID,
    update_data: dict, user_id: uuid.UUID, updated_by: str = ""
) -> Optional[UserAnnotation]:
    db_obj = await get_user_annotation(db, annotation_id)
    if not db_obj:
        return None
    for key, value in update_data.items():
        if value is not None:
            setattr(db_obj, key, value)
    db_obj.updated_by_user_id = user_id
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def delete_user_annotation(
    db: AsyncSession, annotation_id: uuid.UUID, deleted_by: str = ""
) -> bool:
    db_obj = await get_user_annotation(db, annotation_id)
    if not db_obj:
        return False
    await db.delete(db_obj)
    await db.commit()
    return True


async def count_annotations_for_image(
    db: AsyncSession, image_id: uuid.UUID
) -> int:
    result = await db.execute(
        select(func.count()).select_from(UserAnnotation).where(
            UserAnnotation.image_id == image_id
        )
    )
    return result.scalar() or 0
