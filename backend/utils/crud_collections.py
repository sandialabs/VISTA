import uuid
from datetime import datetime, timezone
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional, List
from core import models
import logging

logger = logging.getLogger(__name__)

VALID_PHASE_TRANSITIONS = {
    "draft": {"annotating"},
    "annotating": {"review"},
    "review": {"certified", "annotating"},
    "certified": {"review"},
}


async def create_collection(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    name: str,
    description: Optional[str],
    purpose: str,
    created_by_id: uuid.UUID,
) -> models.ImageCollection:
    coll = models.ImageCollection(
        project_id=project_id,
        name=name,
        description=description,
        purpose=purpose,
        created_by_id=created_by_id,
    )
    db.add(coll)
    await db.commit()
    await db.refresh(coll)
    return coll


async def get_collection(
    db: AsyncSession, collection_id: uuid.UUID
) -> Optional[models.ImageCollection]:
    result = await db.execute(
        select(models.ImageCollection).where(
            models.ImageCollection.id == collection_id
        )
    )
    return result.scalars().first()


async def get_collections_for_project(
    db: AsyncSession,
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
) -> List[models.ImageCollection]:
    result = await db.execute(
        select(models.ImageCollection)
        .where(models.ImageCollection.project_id == project_id)
        .order_by(models.ImageCollection.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def count_collections_for_project(
    db: AsyncSession, project_id: uuid.UUID
) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(models.ImageCollection)
        .where(models.ImageCollection.project_id == project_id)
    )
    return result.scalar_one()


async def update_collection(
    db: AsyncSession,
    collection_id: uuid.UUID,
    **kwargs,
) -> Optional[models.ImageCollection]:
    coll = await get_collection(db, collection_id)
    if not coll:
        return None
    await db.execute(
        update(models.ImageCollection)
        .where(models.ImageCollection.id == collection_id)
        .values(**kwargs)
    )
    await db.commit()
    return await get_collection(db, collection_id)


async def delete_collection(
    db: AsyncSession, collection_id: uuid.UUID
) -> bool:
    coll = await get_collection(db, collection_id)
    if not coll:
        return False
    await db.execute(
        delete(models.ImageCollection).where(
            models.ImageCollection.id == collection_id
        )
    )
    await db.commit()
    return True


async def add_images_to_collection(
    db: AsyncSession,
    collection_id: uuid.UUID,
    image_ids: List[uuid.UUID],
    added_by_id: uuid.UUID,
) -> int:
    added = 0
    for img_id in image_ids:
        existing = await db.execute(
            select(models.CollectionMembership).where(
                models.CollectionMembership.collection_id == collection_id,
                models.CollectionMembership.image_id == img_id,
            )
        )
        if existing.scalars().first():
            continue
        db.add(
            models.CollectionMembership(
                collection_id=collection_id,
                image_id=img_id,
                added_by_id=added_by_id,
            )
        )
        added += 1
    await db.commit()
    return added


async def remove_images_from_collection(
    db: AsyncSession,
    collection_id: uuid.UUID,
    image_ids: List[uuid.UUID],
) -> int:
    result = await db.execute(
        delete(models.CollectionMembership).where(
            models.CollectionMembership.collection_id == collection_id,
            models.CollectionMembership.image_id.in_(image_ids),
        )
    )
    await db.commit()
    return result.rowcount


async def get_collection_image_ids(
    db: AsyncSession, collection_id: uuid.UUID
) -> List[uuid.UUID]:
    result = await db.execute(
        select(models.CollectionMembership.image_id).where(
            models.CollectionMembership.collection_id == collection_id
        )
    )
    return [row[0] for row in result.all()]


async def get_collection_images_full(
    db: AsyncSession,
    collection_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
) -> List[models.DataInstance]:
    result = await db.execute(
        select(models.DataInstance)
        .join(
            models.CollectionMembership,
            models.CollectionMembership.image_id == models.DataInstance.id,
        )
        .where(models.CollectionMembership.collection_id == collection_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def count_collection_images(
    db: AsyncSession, collection_id: uuid.UUID
) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(models.CollectionMembership)
        .where(models.CollectionMembership.collection_id == collection_id)
    )
    return result.scalar_one()


async def update_collection_phase(
    db: AsyncSession,
    collection_id: uuid.UUID,
    new_phase: str,
) -> Optional[models.ImageCollection]:
    coll = await get_collection(db, collection_id)
    if not coll:
        return None
    allowed = VALID_PHASE_TRANSITIONS.get(coll.phase, set())
    if new_phase not in allowed:
        return None
    await db.execute(
        update(models.ImageCollection)
        .where(models.ImageCollection.id == collection_id)
        .values(phase=new_phase)
    )
    await db.commit()
    return await get_collection(db, collection_id)


async def certify_collection(
    db: AsyncSession,
    collection_id: uuid.UUID,
    certified_by_id: uuid.UUID,
    certification_notes: Optional[str] = None,
) -> Optional[models.ImageCollection]:
    now = datetime.now(timezone.utc)
    await db.execute(
        update(models.ImageCollection)
        .where(models.ImageCollection.id == collection_id)
        .values(
            phase="certified",
            certified_by_id=certified_by_id,
            certified_at=now,
            certification_notes=certification_notes,
        )
    )
    await db.commit()
    return await get_collection(db, collection_id)
