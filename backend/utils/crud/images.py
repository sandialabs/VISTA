import uuid
from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from core import models, schemas
from typing import List, Optional, Dict, Any

from ._common import log_db_operation


async def get_data_instance(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.DataInstance]:
    result = await db.execute(
        select(models.DataInstance)
        .options(selectinload(models.DataInstance.project))
        .where(models.DataInstance.id == image_id)
        )
    return result.scalars().first()


async def get_data_instance_for_update(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.DataInstance]:
    """Retrieve image without eager loads for update operations."""
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.id == image_id)
        .with_for_update(of=models.DataInstance)
    )
    return result.scalars().first()


# Backwards-compatible alias used by dependencies/get_image_or_403
async def get_image(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.DataInstance]:
    """
    Retrieve a DataInstance by id. Maintains compatibility with older call sites
    that referenced `crud.get_image`.
    """
    return await get_data_instance(db, image_id)


async def get_data_instances_for_project(db: AsyncSession, project_id: uuid.UUID, skip: int = 0, limit: int = 100, search_field: Optional[str] = None, search_value: Optional[str] = None) -> List[models.DataInstance]:
    from .projects import get_project
    # First check if the project exists
    project = await get_project(db, project_id)
    if not project:
        return []

    query = select(models.DataInstance).where(models.DataInstance.project_id == project_id)

    if search_field and search_value:
        search_value_lower = f"%{search_value.lower()}%"

        if search_field == 'filename':
            query = query.where(models.DataInstance.filename.ilike(search_value_lower))
        elif search_field == 'content_type':
            query = query.where(models.DataInstance.content_type.ilike(search_value_lower))
        elif search_field == 'uploaded_by':
            query = query.where(models.DataInstance.uploaded_by_user_id.ilike(search_value_lower))
        elif search_field == 'metadata':
            # Search across all metadata values using JSON text search
            query = query.where(text("metadata::text ILIKE :search_value")).params(search_value=search_value_lower)
        else:
            # Search specific metadata key using JSON path
            query = query.where(text("metadata ->> :key ILIKE :search_value")).params(key=search_field, search_value=search_value_lower)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


async def get_deleted_images_for_project(db: AsyncSession, project_id: uuid.UUID, skip: int = 0, limit: int = 100) -> List[models.DataInstance]:
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.isnot(None))
        .order_by(models.DataInstance.deleted_at.desc())
        .offset(skip).limit(limit)
    )
    return result.scalars().all()


async def count_deleted_images_for_project(db: AsyncSession, project_id: uuid.UUID) -> int:
    from sqlalchemy import func as _func
    result = await db.execute(
        select(_func.count())
        .select_from(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.isnot(None))
    )
    return result.scalar_one()


async def create_image_deletion_event(db: AsyncSession, *, image: models.DataInstance, actor_user_id: Optional[uuid.UUID], action: str, reason: Optional[str], previous_state: Optional[Dict[str, Any]] = None):
    event = models.ImageDeletionEvent(
        image_id=image.id,
        project_id=image.project_id,
        actor_user_id=actor_user_id,
        action=action,
        reason=reason,
        previous_state=previous_state or {},
        storage_deleted=image.storage_deleted,
    )
    db.add(event)
    await db.flush()  # Get id
    return event


async def list_image_deletion_events(db: AsyncSession, project_id: uuid.UUID, image_id: Optional[uuid.UUID] = None, skip: int = 0, limit: int = 100):
    stmt = select(models.ImageDeletionEvent).where(models.ImageDeletionEvent.project_id == project_id)
    if image_id:
        stmt = stmt.where(models.ImageDeletionEvent.image_id == image_id)
    stmt = stmt.order_by(models.ImageDeletionEvent.at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


async def count_image_deletion_events(db: AsyncSession, project_id: uuid.UUID, image_id: Optional[uuid.UUID] = None) -> int:
    from sqlalchemy import func as _func
    stmt = select(_func.count()).select_from(models.ImageDeletionEvent).where(models.ImageDeletionEvent.project_id == project_id)
    if image_id:
        stmt = stmt.where(models.ImageDeletionEvent.image_id == image_id)
    result = await db.execute(stmt)
    return result.scalar_one()


async def soft_delete_image(db: AsyncSession, image: models.DataInstance, *, actor_user_id: Optional[uuid.UUID], reason: str, retention_days: int):
    from datetime import datetime, timezone, timedelta
    if image.deleted_at and image.storage_deleted:
        return image  # already fully deleted
    now = datetime.now(timezone.utc)
    pending_dt = now + timedelta(days=retention_days)
    # If already soft deleted, don't override original deleted_at or pending date
    if not image.deleted_at:
        await db.execute(
            update(models.DataInstance)
            .where(models.DataInstance.id == image.id)
            .values(
                deleted_at=now,
                deleted_by_user_id=actor_user_id,
                deletion_reason=reason,
                pending_hard_delete_at=pending_dt
            )
        )
    else:
        # Update reason if new (keep existing to preserve original justification)
        if not image.deletion_reason:
            await db.execute(
                update(models.DataInstance)
                .where(models.DataInstance.id == image.id)
                .values(deletion_reason=reason)
            )
    await db.flush()
    await db.refresh(image)
    return image


async def restore_image(db: AsyncSession, image: models.DataInstance):
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image.id)
        .values(
            deleted_at=None,
            deleted_by_user_id=None,
            deletion_reason=None,
            pending_hard_delete_at=None,
            hard_deleted_at=None,
            hard_deleted_by_user_id=None,
            storage_deleted=False
        )
    )
    await db.flush()
    await db.refresh(image)
    return image


async def mark_image_storage_deleted(db: AsyncSession, image: models.DataInstance, *, actor_user_id: Optional[uuid.UUID], hard: bool):
    from sqlalchemy.sql import func as _func
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image.id)
        .values(
            storage_deleted=True,
            hard_deleted_at=_func.coalesce(models.DataInstance.hard_deleted_at, _func.now()),
            hard_deleted_by_user_id=actor_user_id if hard else models.DataInstance.hard_deleted_by_user_id
        )
    )
    await db.flush()
    await db.refresh(image)
    return image


async def create_data_instance(db: AsyncSession, data_instance: schemas.DataInstanceCreate, created_by: Optional[str] = None) -> models.DataInstance:
    create_data = data_instance.model_dump()
    # Rename Pydantic field name to SQLAlchemy attribute name
    if "metadata_" in create_data:
         create_data["metadata_json"] = create_data.pop("metadata_")
    db_data_instance = models.DataInstance(**create_data)
    db.add(db_data_instance)
    await db.commit()
    await db.refresh(db_data_instance)

    log_db_operation("CREATE", "data_instances", db_data_instance.id, created_by or "system", {"filename": data_instance.filename, "project_id": str(data_instance.project_id)})
    return db_data_instance
