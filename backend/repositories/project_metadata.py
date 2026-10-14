"""Database access helpers for project metadata key/value records."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories.audit import log_db_operation
from schemas import project_metadata as project_metadata_schemas

PROJECT_IDENTIFIER_METADATA_KEY = "nsipro.project_identifiers"


async def get_project_metadata(
    db: AsyncSession,
    metadata_id: uuid.UUID,
) -> models.ProjectMetadata | None:
    """Return the project metadata row with id ``metadata_id``, or ``None``."""
    result = await db.execute(
        select(models.ProjectMetadata).where(models.ProjectMetadata.id == metadata_id)
    )
    return result.scalars().first()


async def get_project_metadata_by_key(
    db: AsyncSession,
    project_id: uuid.UUID,
    key: str,
) -> models.ProjectMetadata | None:
    """Return the project metadata row for ``project_id`` and ``key``, or ``None``."""
    result = await db.execute(
        select(models.ProjectMetadata).where(
            and_(
                models.ProjectMetadata.project_id == project_id,
                models.ProjectMetadata.key == key,
            )
        )
    )
    return result.scalars().first()


async def get_project_metadata_by_keys(
    db: AsyncSession,
    project_id: uuid.UUID,
    keys: list[str],
) -> dict[str, models.ProjectMetadata]:
    """Return project metadata rows for ``keys`` in one query, keyed by key."""
    if not keys:
        return {}
    result = await db.execute(
        select(models.ProjectMetadata).where(
            models.ProjectMetadata.project_id == project_id,
            models.ProjectMetadata.key.in_(keys),
        )
    )
    return {metadata.key: metadata for metadata in result.scalars().all()}


async def get_all_project_metadata(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> list[models.ProjectMetadata]:
    """Return all metadata rows for ``project_id``."""
    result = await db.execute(
        select(models.ProjectMetadata).where(
            models.ProjectMetadata.project_id == project_id
        )
    )
    return result.scalars().all()


async def create_or_update_project_metadata(
    db: AsyncSession,
    metadata: project_metadata_schemas.ProjectMetadataCreate,
    created_by: str | None = None,
    commit: bool = True,
) -> models.ProjectMetadata:
    """Create or update a project metadata row."""
    existing_metadata = await get_project_metadata_by_key(
        db, metadata.project_id, metadata.key
    )
    if existing_metadata:
        existing_metadata.value = metadata.value
        if commit:
            await db.commit()
            await db.refresh(existing_metadata)
            log_db_operation(
                "UPDATE",
                "project_metadata",
                existing_metadata.id,
                created_by or "system",
                {"key": metadata.key, "project_id": str(metadata.project_id)},
            )
        return existing_metadata

    db_metadata = models.ProjectMetadata(**metadata.model_dump())
    db.add(db_metadata)
    if commit:
        await db.commit()
        await db.refresh(db_metadata)
        log_db_operation(
            "CREATE",
            "project_metadata",
            db_metadata.id,
            created_by or "system",
            {"key": metadata.key, "project_id": str(metadata.project_id)},
        )
    return db_metadata


async def delete_project_metadata(
    db: AsyncSession,
    metadata_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    """Delete the metadata row with id ``metadata_id``. Return whether it existed."""
    db_metadata = await get_project_metadata(db, metadata_id)
    if not db_metadata:
        return False

    log_db_operation(
        "DELETE",
        "project_metadata",
        metadata_id,
        deleted_by or "system",
        {"key": db_metadata.key},
    )

    await db.execute(
        delete(models.ProjectMetadata).where(models.ProjectMetadata.id == metadata_id)
    )
    await db.commit()
    return True


async def delete_project_metadata_by_key(
    db: AsyncSession,
    project_id: uuid.UUID,
    key: str,
    deleted_by: str | None = None,
) -> bool:
    """Delete the metadata row for ``project_id`` and ``key``. Return if it existed."""
    db_metadata = await get_project_metadata_by_key(db, project_id, key)
    if not db_metadata:
        return False

    log_db_operation(
        "DELETE",
        "project_metadata",
        db_metadata.id,
        deleted_by or "system",
        {"key": key, "project_id": str(project_id)},
    )

    await db.execute(
        delete(models.ProjectMetadata).where(
            and_(
                models.ProjectMetadata.project_id == project_id,
                models.ProjectMetadata.key == key,
            )
        )
    )
    await db.commit()
    return True


def _normalize_identifier_values(value: Any) -> list[str]:
    raw_values = value if isinstance(value, (list, tuple, set)) else [value]

    normalized: list[str] = []
    seen = set()
    for item in raw_values:
        if item is None:
            continue
        safe_value = str(item).strip()
        if not safe_value or safe_value in seen:
            continue
        normalized.append(safe_value)
        seen.add(safe_value)
    return normalized


def _record_project_identifier_conflict(
    conflicts: dict[str, Any],
    key: str,
    kept_value: str,
    incoming_value: str,
) -> None:
    record = conflicts.get(key)
    if not isinstance(record, dict) or record.get("kept") != kept_value:
        record = {"kept": kept_value, "incoming": []}
        conflicts[key] = record

    incoming_values = record.get("incoming")
    if not isinstance(incoming_values, list):
        incoming_values = []
        record["incoming"] = incoming_values
    if incoming_value not in incoming_values:
        incoming_values.append(incoming_value)


async def store_project_identifier_metadata(
    db: AsyncSession,
    project_id: uuid.UUID,
    identifiers: dict[str, Any],
    created_by: str | None = None,
    commit: bool = True,
) -> list[models.ProjectMetadata]:
    """Persist extracted .nsipro project identifiers under one reserved key."""
    normalized_identifiers = {
        str(key).strip(): _normalize_identifier_values(value)
        for key, value in (identifiers or {}).items()
        if str(key).strip()
    }
    normalized_identifiers = {
        key: values for key, values in normalized_identifiers.items() if values
    }
    if not normalized_identifiers:
        return []

    existing_metadata = await get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=PROJECT_IDENTIFIER_METADATA_KEY,
    )
    current_value = (
        existing_metadata.value
        if existing_metadata and isinstance(existing_metadata.value, dict)
        else {}
    )
    current_identifiers = current_value.get("identifiers")
    if not isinstance(current_identifiers, dict):
        current_identifiers = {}
    merged_identifiers = {
        str(key).strip(): str(value).strip()
        for key, value in current_identifiers.items()
        if str(key).strip() and str(value).strip()
    }

    current_conflicts = current_value.get("conflicts")
    conflicts: dict[str, Any] = (
        dict(current_conflicts) if isinstance(current_conflicts, dict) else {}
    )

    for key, values in normalized_identifiers.items():
        for value in values:
            kept_value = merged_identifiers.get(key)
            if kept_value is None:
                merged_identifiers[key] = value
            elif kept_value != value:
                _record_project_identifier_conflict(
                    conflicts=conflicts,
                    key=key,
                    kept_value=kept_value,
                    incoming_value=value,
                )

    metadata_create = project_metadata_schemas.ProjectMetadataCreate(
        project_id=project_id,
        key=PROJECT_IDENTIFIER_METADATA_KEY,
        value={
            **current_value,
            "source": "nsipro",
            "schema_version": 1,
            "identifiers": merged_identifiers,
            "conflicts": conflicts,
        },
    )
    row = await create_or_update_project_metadata(
        db=db,
        metadata=metadata_create,
        created_by=created_by,
        commit=commit,
    )
    return [row]
