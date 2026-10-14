"""Database access helpers for image groups."""

from __future__ import annotations

import uuid

from sqlalchemy import exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories.audit import log_db_operation
from repositories.images import create_image_deletion_event, soft_delete_image
from repositories.reviews import get_review_status_for_images
from schemas import image_groups as image_group_schemas


def _escape_like(value: str) -> str:
    return value.replace("/", "//").replace("%", "/%").replace("_", "/_")


async def get_image_group(
    db: AsyncSession, group_id: uuid.UUID
) -> models.ImageGroup | None:
    """Return an image group by ID."""
    result = await db.execute(
        select(models.ImageGroup).where(models.ImageGroup.id == group_id)
    )
    return result.scalars().first()


async def get_image_group_by_identifier(
    db: AsyncSession, project_id: uuid.UUID, identifier: str
) -> models.ImageGroup | None:
    """Return an image group by project-local identifier."""
    result = await db.execute(
        select(models.ImageGroup).where(
            models.ImageGroup.project_id == project_id,
            models.ImageGroup.identifier == identifier,
        )
    )
    return result.scalars().first()


async def get_or_create_image_group(
    db: AsyncSession,
    project_id: uuid.UUID,
    identifier: str,
    created_by: str | None = None,
) -> models.ImageGroup:
    """Return an existing group or create it when absent."""
    existing = await get_image_group_by_identifier(db, project_id, identifier)
    if existing:
        return existing
    group = models.ImageGroup(project_id=project_id, identifier=identifier)
    db.add(group)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await get_image_group_by_identifier(db, project_id, identifier)
        if existing:
            return existing
        raise
    await db.refresh(group)
    log_db_operation(
        "CREATE",
        "image_groups",
        group.id,
        created_by or "system",
        {"project_id": str(project_id), "identifier": identifier},
    )
    return group


async def create_image_group(
    db: AsyncSession,
    group: image_group_schemas.ImageGroupCreate,
    created_by: str | None = None,
) -> models.ImageGroup:
    """Create an image group and record an audit event."""
    db_group = models.ImageGroup(**group.model_dump())
    db.add(db_group)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise
    await db.refresh(db_group)
    log_db_operation(
        "CREATE",
        "image_groups",
        db_group.id,
        created_by or "system",
        {"project_id": str(group.project_id), "identifier": group.identifier},
    )
    return db_group


async def update_image_group(
    db: AsyncSession,
    group: models.ImageGroup,
    update_data: image_group_schemas.ImageGroupUpdate,
    updated_by: str | None = None,
) -> models.ImageGroup:
    """Update image group fields and record an audit event."""
    values = update_data.model_dump(exclude_unset=True)
    if "identifier" in values and values["identifier"] is None:
        del values["identifier"]
    if values:
        await db.execute(
            update(models.ImageGroup)
            .where(models.ImageGroup.id == group.id)
            .values(**values)
        )
        await db.commit()
        await db.refresh(group)
        log_db_operation(
            "UPDATE", "image_groups", group.id, updated_by or "system", values
        )
    return group


async def list_image_groups(
    db: AsyncSession,
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
) -> list[models.ImageGroup]:
    """List image groups for a project, optionally filtered by identifier."""
    query = select(models.ImageGroup).where(models.ImageGroup.project_id == project_id)
    if search:
        query = query.where(
            models.ImageGroup.identifier.ilike(f"%{_escape_like(search)}%", escape="/")
        )
    query = query.order_by(models.ImageGroup.identifier).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_image_groups(
    db: AsyncSession, project_id: uuid.UUID, search: str | None = None
) -> int:
    """Count image groups for a project, optionally filtered by identifier."""
    query = (
        select(func.count())
        .select_from(models.ImageGroup)
        .where(models.ImageGroup.project_id == project_id)
    )
    if search:
        query = query.where(
            models.ImageGroup.identifier.ilike(f"%{_escape_like(search)}%", escape="/")
        )
    result = await db.execute(query)
    return result.scalar() or 0


async def get_image_counts_for_groups(
    db: AsyncSession, group_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Return image counts for multiple groups in a single query."""
    if not group_ids:
        return {}

    result = await db.execute(
        select(
            models.DataInstance.group_id,
            func.count(models.DataInstance.id),
        )
        .where(
            models.DataInstance.group_id.in_(group_ids),
            models.DataInstance.deleted_at.is_(None),
        )
        .group_by(models.DataInstance.group_id)
    )
    return {row[0]: row[1] for row in result.all()}


async def get_aggregate_review_statuses_for_groups(
    db: AsyncSession, group_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """Compute aggregate review status for multiple groups in bulk."""
    if not group_ids:
        return {}

    image_rows = await db.execute(
        select(models.DataInstance.id, models.DataInstance.group_id).where(
            models.DataInstance.group_id.in_(group_ids),
            models.DataInstance.deleted_at.is_(None),
        )
    )
    rows = image_rows.all()
    if not rows:
        return {gid: None for gid in group_ids}

    group_image_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    all_image_ids = []
    for image_id, group_id in rows:
        group_image_map.setdefault(group_id, []).append(image_id)
        all_image_ids.append(image_id)

    statuses = await get_review_status_for_images(db, all_image_ids)

    result: dict[uuid.UUID, str | None] = {}
    for group_id in group_ids:
        image_ids = group_image_map.get(group_id, [])
        if not image_ids:
            result[group_id] = None
            continue
        status_values = [statuses.get(image_id) for image_id in image_ids]
        if "reject_confirmed" in status_values:
            result[group_id] = "reject_confirmed"
        elif "reject_pending" in status_values:
            result[group_id] = "reject_pending"
        else:
            non_none = [status for status in status_values if status is not None]
            if (
                non_none
                and all(status == "pass" for status in non_none)
                and len(non_none) == len(image_ids)
            ):
                result[group_id] = "pass"
            else:
                result[group_id] = None
    return result


async def count_images_for_group(db: AsyncSession, group_id: uuid.UUID) -> int:
    """Count non-deleted images assigned to a group."""
    result = await db.execute(
        select(func.count())
        .select_from(models.DataInstance)
        .where(
            models.DataInstance.group_id == group_id,
            models.DataInstance.deleted_at.is_(None),
        )
    )
    return result.scalar() or 0


async def assign_images_to_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    image_ids: list[uuid.UUID],
    project_id: uuid.UUID,
    assigned_by: str | None = None,
) -> int:
    """Assign non-deleted project images to a group."""
    result = await db.execute(
        update(models.DataInstance)
        .where(
            models.DataInstance.id.in_(image_ids),
            models.DataInstance.project_id == project_id,
            models.DataInstance.deleted_at.is_(None),
        )
        .values(group_id=group_id)
    )
    await db.commit()
    rowcount = int(getattr(result, "rowcount", 0) or 0)
    log_db_operation(
        "UPDATE",
        "image_groups",
        group_id,
        assigned_by or "system",
        {
            "action": "assign_images",
            "image_ids": [str(image_id) for image_id in image_ids],
            "assigned_count": rowcount,
        },
    )
    return rowcount


async def remove_images_from_group(
    db: AsyncSession,
    group_id: uuid.UUID,
    image_ids: list[uuid.UUID],
    project_id: uuid.UUID,
    removed_by: str | None = None,
) -> int:
    """Remove project images from a group."""
    result = await db.execute(
        update(models.DataInstance)
        .where(
            models.DataInstance.id.in_(image_ids),
            models.DataInstance.group_id == group_id,
            models.DataInstance.project_id == project_id,
        )
        .values(group_id=None)
    )
    await db.commit()
    rowcount = int(getattr(result, "rowcount", 0) or 0)
    log_db_operation(
        "UPDATE",
        "image_groups",
        group_id,
        removed_by or "system",
        {
            "action": "remove_images",
            "image_ids": [str(image_id) for image_id in image_ids],
            "removed_count": rowcount,
        },
    )
    return rowcount


async def get_aggregate_review_status_for_group(
    db: AsyncSession, group_id: uuid.UUID
) -> str | None:
    """Compute aggregate review status for a single group."""
    result = await get_aggregate_review_statuses_for_groups(db, [group_id])
    return result.get(group_id)


async def count_ungrouped_images(db: AsyncSession, project_id: uuid.UUID) -> int:
    """Return the count of non-deleted images with no group assignment."""
    result = await db.execute(
        select(func.count())
        .select_from(models.DataInstance)
        .where(
            models.DataInstance.project_id == project_id,
            models.DataInstance.group_id.is_(None),
            models.DataInstance.deleted_at.is_(None),
        )
    )
    return result.scalar() or 0


async def has_image_groups(db: AsyncSession, project_id: uuid.UUID) -> bool:
    """Return True if the project has at least one image group."""
    result = await db.execute(
        select(exists().where(models.ImageGroup.project_id == project_id))
    )
    return bool(result.scalar())


async def delete_image_group(
    db: AsyncSession,
    group: models.ImageGroup,
    delete_images: bool = False,
    deleted_by: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    retention_days: int = 60,
) -> list[uuid.UUID]:
    """Delete an image group and return the IDs of the images it changed.

    Member images are soft-deleted when ``delete_images`` is set; otherwise
    they are ungrouped.
    """
    if delete_images:
        result = await db.execute(
            select(models.DataInstance).where(
                models.DataInstance.group_id == group.id,
                models.DataInstance.deleted_at.is_(None),
            )
        )
        affected_images = list(result.scalars().all())
        affected_ids = [image.id for image in affected_images]
        for image in affected_images:
            previous_state = {"deleted_at": None, "group_id": str(group.id)}
            await soft_delete_image(
                db,
                image,
                actor_user_id=actor_user_id,
                reason="Group deleted",
                retention_days=retention_days,
            )
            await create_image_deletion_event(
                db,
                image=image,
                actor_user_id=actor_user_id,
                action="soft_delete",
                reason="Group deleted",
                previous_state=previous_state,
            )
    else:
        result = await db.execute(
            select(models.DataInstance.id).where(
                models.DataInstance.group_id == group.id
            )
        )
        affected_ids = list(result.scalars().all())
        await db.execute(
            update(models.DataInstance)
            .where(models.DataInstance.group_id == group.id)
            .values(group_id=None)
        )
    await db.delete(group)
    await db.commit()
    log_db_operation("DELETE", "image_groups", group.id, deleted_by or "system", {})
    return affected_ids
