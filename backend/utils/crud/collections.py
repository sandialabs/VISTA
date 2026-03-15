import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Collection, CollectionImage

logger = logging.getLogger(__name__)


async def create_collection(
    db: AsyncSession, collection_data, user_id: uuid.UUID, created_by: str = ""
) -> Collection:
    db_obj = Collection(
        project_id=collection_data.project_id,
        name=collection_data.name,
        description=collection_data.description,
        created_by_user_id=user_id,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_collection(db: AsyncSession, collection_id: uuid.UUID) -> Optional[Collection]:
    result = await db.execute(
        select(Collection).where(Collection.id == collection_id)
    )
    return result.scalars().first()


async def get_collections_for_project(
    db: AsyncSession, project_id: uuid.UUID
) -> List[Collection]:
    result = await db.execute(
        select(Collection)
        .where(Collection.project_id == project_id)
        .order_by(Collection.created_at)
    )
    return list(result.scalars().all())


async def update_collection(
    db: AsyncSession, collection_id: uuid.UUID, update_data: dict
) -> Optional[Collection]:
    db_obj = await get_collection(db, collection_id)
    if not db_obj:
        return None
    for key, value in update_data.items():
        if value is not None:
            setattr(db_obj, key, value)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def delete_collection(db: AsyncSession, collection_id: uuid.UUID) -> bool:
    db_obj = await get_collection(db, collection_id)
    if not db_obj:
        return False
    await db.delete(db_obj)
    await db.commit()
    return True


async def lock_collection(
    db: AsyncSession, collection_id: uuid.UUID,
    user_id: uuid.UUID, reason: Optional[str] = None
) -> Optional[Collection]:
    db_obj = await get_collection(db, collection_id)
    if not db_obj:
        return None
    db_obj.is_locked = True
    db_obj.locked_at = datetime.now(timezone.utc)
    db_obj.locked_by_user_id = user_id
    db_obj.lock_reason = reason
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def unlock_collection(
    db: AsyncSession, collection_id: uuid.UUID
) -> Optional[Collection]:
    db_obj = await get_collection(db, collection_id)
    if not db_obj:
        return None
    db_obj.is_locked = False
    db_obj.locked_at = None
    db_obj.locked_by_user_id = None
    db_obj.lock_reason = None
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def set_review_required(
    db: AsyncSession, collection_id: uuid.UUID, required: bool
) -> Optional[Collection]:
    db_obj = await get_collection(db, collection_id)
    if not db_obj:
        return None
    db_obj.review_required = required
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def add_images_to_collection(
    db: AsyncSession, collection_id: uuid.UUID,
    image_ids: List[uuid.UUID], user_id: uuid.UUID
) -> List[CollectionImage]:
    added = []
    for img_id in image_ids:
        existing = await db.execute(
            select(CollectionImage).where(
                CollectionImage.collection_id == collection_id,
                CollectionImage.image_id == img_id,
            )
        )
        if existing.scalars().first():
            continue
        obj = CollectionImage(
            collection_id=collection_id,
            image_id=img_id,
            added_by_user_id=user_id,
        )
        db.add(obj)
        added.append(obj)
    if added:
        await db.commit()
        for obj in added:
            await db.refresh(obj)
    return added


async def remove_image_from_collection(
    db: AsyncSession, collection_id: uuid.UUID, image_id: uuid.UUID
) -> bool:
    result = await db.execute(
        select(CollectionImage).where(
            CollectionImage.collection_id == collection_id,
            CollectionImage.image_id == image_id,
        )
    )
    obj = result.scalars().first()
    if not obj:
        return False
    await db.delete(obj)
    await db.commit()
    return True


async def get_collection_images(
    db: AsyncSession, collection_id: uuid.UUID,
    skip: int = 0, limit: int = 1000
) -> List[CollectionImage]:
    result = await db.execute(
        select(CollectionImage)
        .where(CollectionImage.collection_id == collection_id)
        .order_by(CollectionImage.added_at)
        .offset(skip).limit(limit)
    )
    return list(result.scalars().all())


async def count_collection_images(
    db: AsyncSession, collection_id: uuid.UUID
) -> int:
    result = await db.execute(
        select(func.count()).select_from(CollectionImage).where(
            CollectionImage.collection_id == collection_id
        )
    )
    return result.scalar() or 0
