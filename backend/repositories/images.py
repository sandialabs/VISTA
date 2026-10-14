"""Repository helpers for image data instances and image deletion events."""

# ruff: noqa: D103,D205,E501

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict

from sqlalchemy import String, and_, bindparam, cast, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import models
from repositories.audit import log_db_operation
from schemas import images as image_schemas

# DataInstance CRUD operations


class _DataInstanceFilterOptions(TypedDict):
    project_id: uuid.UUID
    include_deleted: bool
    deleted_only: bool
    search_field: str | None
    search_value: str | None
    group_id: uuid.UUID | None
    ungrouped: bool


async def get_data_instance(
    db: AsyncSession, image_id: uuid.UUID
) -> models.DataInstance | None:
    result = await db.execute(
        select(models.DataInstance)
        .options(selectinload(models.DataInstance.project))
        .where(models.DataInstance.id == image_id)
    )
    return result.scalars().first()


async def get_data_instance_for_update(
    db: AsyncSession, image_id: uuid.UUID
) -> models.DataInstance | None:
    """Retrieve image without eager loads for update operations."""
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.id == image_id)
        .with_for_update(of=models.DataInstance)
    )
    return result.scalars().first()


async def get_active_project_image(
    db: AsyncSession,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
) -> models.DataInstance | None:
    """Return a non-deleted image only when it belongs to the project."""
    result = await db.execute(
        select(models.DataInstance).where(
            models.DataInstance.project_id == project_id,
            models.DataInstance.id == image_id,
            models.DataInstance.deleted_at.is_(None),
        )
    )
    return result.scalars().first()


async def list_active_project_images_by_filename(
    db: AsyncSession,
    project_id: uuid.UUID,
    filename: str,
    limit: int | None = None,
) -> list[models.DataInstance]:
    """Return non-deleted project images that share an exact filename."""
    query = select(models.DataInstance).where(
        models.DataInstance.project_id == project_id,
        models.DataInstance.filename == filename,
        models.DataInstance.deleted_at.is_(None),
    )
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


# Backwards-compatible alias used by dependencies/get_image_or_403
async def get_image(
    db: AsyncSession, image_id: uuid.UUID
) -> models.DataInstance | None:
    """Retrieve a DataInstance by id. Maintains compatibility with older call sites
    that referenced `crud.get_image`.
    """
    return await get_data_instance(db, image_id)


def _apply_data_instance_filters(
    query,
    *,
    project_id: uuid.UUID,
    include_deleted: bool = False,
    deleted_only: bool = False,
    search_field: str | None = None,
    search_value: str | None = None,
    group_id: uuid.UUID | None = None,
    ungrouped: bool = False,
):
    """Apply the common project-image filters before pagination."""
    query = query.where(models.DataInstance.project_id == project_id)

    if deleted_only:
        query = query.where(models.DataInstance.deleted_at.isnot(None))
    elif not include_deleted:
        query = query.where(models.DataInstance.deleted_at.is_(None))

    if group_id is not None:
        query = query.where(models.DataInstance.group_id == group_id)
    elif ungrouped:
        query = query.where(models.DataInstance.group_id.is_(None))

    if search_field and search_value:
        search_value_lower = f"%{search_value.lower()}%"

        if search_field == "filename":
            query = query.where(models.DataInstance.filename.ilike(search_value_lower))
        elif search_field == "content_type":
            query = query.where(
                models.DataInstance.content_type.ilike(search_value_lower)
            )
        elif search_field == "uploaded_by":
            query = query.where(
                models.DataInstance.uploaded_by_user_id.ilike(search_value_lower)
            )
        elif search_field == "metadata":
            query = query.where(
                cast(models.DataInstance.metadata_json, String).ilike(
                    search_value_lower
                )
            )
        else:
            query = query.where(
                models.DataInstance.metadata_json[search_field]
                .as_string()
                .ilike(search_value_lower)
            )

    return query


async def get_data_instances_for_project(
    db: AsyncSession,
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    search_field: str | None = None,
    search_value: str | None = None,
    group_id: uuid.UUID | None = None,
    ungrouped: bool = False,
    include_deleted: bool = False,
) -> list[models.DataInstance]:
    query = _apply_data_instance_filters(
        select(models.DataInstance),
        project_id=project_id,
        include_deleted=include_deleted,
        search_field=search_field,
        search_value=search_value,
        group_id=group_id,
        ungrouped=ungrouped,
    )
    query = (
        query.order_by(
            models.DataInstance.created_at.asc(),
            models.DataInstance.id.asc(),
        )
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_deleted_images_for_project(
    db: AsyncSession, project_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> list[models.DataInstance]:
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.isnot(None))
        .order_by(models.DataInstance.deleted_at.desc(), models.DataInstance.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_data_instance_page(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    limit: int,
    cursor_created_at: datetime | None = None,
    cursor_id: uuid.UUID | None = None,
    include_deleted: bool = False,
    deleted_only: bool = False,
    search_field: str | None = None,
    search_value: str | None = None,
    group_id: uuid.UUID | None = None,
    ungrouped: bool = False,
) -> tuple[list[models.DataInstance], int]:
    """Return a keyset page plus the exact total for the un-cursored filter."""
    base_options: _DataInstanceFilterOptions = {
        "project_id": project_id,
        "include_deleted": include_deleted,
        "deleted_only": deleted_only,
        "search_field": search_field,
        "search_value": search_value,
        "group_id": group_id,
        "ungrouped": ungrouped,
    }
    count_query = _apply_data_instance_filters(
        select(func.count(models.DataInstance.id)),
        **base_options,
    )
    total_result = await db.execute(count_query)
    total = int(total_result.scalar_one() or 0)

    page_query = _apply_data_instance_filters(
        select(models.DataInstance), **base_options
    )
    if cursor_created_at is not None and cursor_id is not None:
        page_query = page_query.where(
            or_(
                models.DataInstance.created_at > cursor_created_at,
                and_(
                    models.DataInstance.created_at == cursor_created_at,
                    models.DataInstance.id > cursor_id,
                ),
            )
        )
    page_query = page_query.order_by(
        models.DataInstance.created_at.asc(),
        models.DataInstance.id.asc(),
    ).limit(limit + 1)
    page_result = await db.execute(page_query)
    return list(page_result.scalars().all()), total


async def get_project_data_summary(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> tuple[dict[str, int], dict[str, float]]:
    """Compute a project summary using two aggregate-only database queries."""
    dialect_name = db.get_bind().dialect.name
    project_id_param = bindparam("project_id", type_=models.Project.id.type)

    image_started = time.perf_counter()
    if dialect_name == "sqlite":
        image_sql = text(
            """
            SELECT
                COALESCE(SUM(CASE WHEN di.deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active_image_count,
                COALESCE(SUM(CASE WHEN di.deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS deleted_image_count,
                COALESCE(SUM(CASE WHEN di.deleted_at IS NULL THEN COALESCE(di.size_bytes, 0) ELSE 0 END), 0) AS total_image_bytes,
                COALESCE(SUM(
                    CASE
                        WHEN di.deleted_at IS NULL AND json_valid(di.metadata) AND json_type(di.metadata) = 'object'
                        THEN (SELECT COUNT(*) FROM json_each(di.metadata))
                        ELSE 0
                    END
                ), 0) AS image_metadata_fields
            FROM data_instances AS di
            WHERE di.project_id = :project_id
            """
        )
    elif dialect_name == "postgresql":
        image_sql = text(
            """
            SELECT
                COUNT(*) FILTER (WHERE di.deleted_at IS NULL) AS active_image_count,
                COUNT(*) FILTER (WHERE di.deleted_at IS NOT NULL) AS deleted_image_count,
                COALESCE(SUM(CASE WHEN di.deleted_at IS NULL THEN COALESCE(di.size_bytes, 0) ELSE 0 END), 0) AS total_image_bytes,
                COALESCE(SUM(
                    CASE
                        WHEN di.deleted_at IS NULL AND jsonb_typeof(di.metadata::jsonb) = 'object'
                        THEN (SELECT COUNT(*) FROM jsonb_object_keys(di.metadata::jsonb))
                        ELSE 0
                    END
                ), 0) AS image_metadata_fields
            FROM data_instances AS di
            WHERE di.project_id = :project_id
            """
        )
    else:  # The application officially supports SQLite and PostgreSQL.
        raise RuntimeError(
            f"Unsupported database dialect for project summaries: {dialect_name}"
        )
    image_sql = image_sql.bindparams(project_id_param)
    image_row = (
        (await db.execute(image_sql, {"project_id": project_id})).mappings().one()
    )
    image_ms = (time.perf_counter() - image_started) * 1000

    part_started = time.perf_counter()
    if dialect_name == "sqlite":
        part_sql = text(
            """
            SELECT
                COUNT(*) AS part_count,
                COALESCE(SUM(
                    CASE WHEN json_valid(ip.metadata) AND json_type(ip.metadata, '$.annotations') = 'array'
                    THEN (
                        SELECT COUNT(*)
                        FROM json_each(ip.metadata, '$.annotations')
                        WHERE json_each.type = 'object'
                    ) ELSE 0 END
                ), 0) AS annotation_count,
                COALESCE(SUM(
                    CASE WHEN json_valid(ip.metadata) AND json_type(ip.metadata, '$.overlay_layers') = 'array'
                    THEN (
                        SELECT COUNT(*)
                        FROM json_each(ip.metadata, '$.overlay_layers')
                        WHERE json_each.type = 'object'
                    ) ELSE 0 END
                ), 0) AS overlay_layer_count
            FROM inspection_parts AS ip
            WHERE ip.project_id = :project_id
            """
        )
    else:
        part_sql = text(
            """
            SELECT
                COUNT(*) AS part_count,
                COALESCE(SUM(
                    CASE WHEN jsonb_typeof(ip.metadata::jsonb -> 'annotations') = 'array'
                    THEN (
                        SELECT COUNT(*)
                        FROM jsonb_array_elements(ip.metadata::jsonb -> 'annotations') AS annotation(value)
                        WHERE jsonb_typeof(annotation.value) = 'object'
                    ) ELSE 0 END
                ), 0) AS annotation_count,
                COALESCE(SUM(
                    CASE WHEN jsonb_typeof(ip.metadata::jsonb -> 'overlay_layers') = 'array'
                    THEN (
                        SELECT COUNT(*)
                        FROM jsonb_array_elements(ip.metadata::jsonb -> 'overlay_layers') AS overlay(value)
                        WHERE jsonb_typeof(overlay.value) = 'object'
                    ) ELSE 0 END
                ), 0) AS overlay_layer_count
            FROM inspection_parts AS ip
            WHERE ip.project_id = :project_id
            """
        )
    part_sql = part_sql.bindparams(project_id_param)
    part_row = (await db.execute(part_sql, {"project_id": project_id})).mappings().one()
    part_ms = (time.perf_counter() - part_started) * 1000

    return (
        {
            "active_image_count": int(image_row["active_image_count"] or 0),
            "deleted_image_count": int(image_row["deleted_image_count"] or 0),
            "total_image_bytes": int(image_row["total_image_bytes"] or 0),
            "part_count": int(part_row["part_count"] or 0),
            "image_metadata_fields": int(image_row["image_metadata_fields"] or 0),
            "annotation_count": int(part_row["annotation_count"] or 0),
            "overlay_layer_count": int(part_row["overlay_layer_count"] or 0),
        },
        {
            "images_ms": round(image_ms, 3),
            "parts_ms": round(part_ms, 3),
        },
    )


async def count_deleted_images_for_project(
    db: AsyncSession, project_id: uuid.UUID
) -> int:

    result = await db.execute(
        select(func.count())
        .select_from(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.isnot(None))
    )
    return result.scalar_one()


async def create_image_deletion_event(
    db: AsyncSession,
    *,
    image: models.DataInstance,
    actor_user_id: uuid.UUID | None,
    action: str,
    reason: str | None,
    previous_state: dict[str, Any] | None = None,
):
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


async def list_image_deletion_events(
    db: AsyncSession,
    project_id: uuid.UUID,
    image_id: uuid.UUID | None = None,
    skip: int = 0,
    limit: int = 100,
):
    stmt = select(models.ImageDeletionEvent).where(
        models.ImageDeletionEvent.project_id == project_id
    )
    if image_id:
        stmt = stmt.where(models.ImageDeletionEvent.image_id == image_id)
    stmt = (
        stmt.order_by(
            models.ImageDeletionEvent.at.desc(),
            models.ImageDeletionEvent.id.desc(),
        )
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def count_image_deletion_events(
    db: AsyncSession, project_id: uuid.UUID, image_id: uuid.UUID | None = None
) -> int:

    stmt = (
        select(func.count())
        .select_from(models.ImageDeletionEvent)
        .where(models.ImageDeletionEvent.project_id == project_id)
    )
    if image_id:
        stmt = stmt.where(models.ImageDeletionEvent.image_id == image_id)
    result = await db.execute(stmt)
    return result.scalar_one()


async def soft_delete_image(
    db: AsyncSession,
    image: models.DataInstance,
    *,
    actor_user_id: uuid.UUID | None,
    reason: str,
    retention_days: int,
):
    from datetime import datetime

    if image.deleted_at and image.storage_deleted:
        return image  # already fully deleted
    now = datetime.now(UTC)
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
                pending_hard_delete_at=pending_dt,
            )
        )
    else:
        # Update reason if new (append or keep existing? Keep existing to preserve original justification)
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
            storage_deleted=False,
        )
    )
    await db.flush()
    await db.refresh(image)
    return image


async def mark_image_storage_deleted(
    db: AsyncSession,
    image: models.DataInstance,
    *,
    actor_user_id: uuid.UUID | None,
    hard: bool,
):
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image.id)
        .values(
            storage_deleted=True,
            hard_deleted_at=func.coalesce(
                models.DataInstance.hard_deleted_at, func.now()
            ),
            hard_deleted_by_user_id=actor_user_id
            if hard
            else models.DataInstance.hard_deleted_by_user_id,
        )
    )
    await db.flush()
    await db.refresh(image)
    return image


async def create_data_instance(
    db: AsyncSession,
    data_instance: image_schemas.DataInstanceCreate,
    created_by: str | None = None,
) -> models.DataInstance:
    create_data = data_instance.model_dump()
    # Rename Pydantic field name to SQLAlchemy attribute name
    if "metadata_" in create_data:
        create_data["metadata_json"] = create_data.pop("metadata_")
    db_data_instance = models.DataInstance(**create_data)
    db.add(db_data_instance)
    await db.commit()
    await db.refresh(db_data_instance)

    log_db_operation(
        "CREATE",
        "data_instances",
        db_data_instance.id,
        created_by or "system",
        {
            "filename": data_instance.filename,
            "project_id": str(data_instance.project_id),
        },
    )
    return db_data_instance
