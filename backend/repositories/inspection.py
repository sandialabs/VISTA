"""Repository helpers for inspection batches and parts."""

# ruff: noqa: D103,D205,E501

import logging
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy import (
    delete,
    select,
    update,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories.audit import log_db_operation
from schemas import inspection_parts as inspection_part_schemas

logger = logging.getLogger(__name__)


async def create_inspection_batch(
    db: AsyncSession,
    project_id: uuid.UUID,
    batch: inspection_part_schemas.InspectionBatchCreate,
    created_by: str | None = None,
    commit: bool = True,
) -> models.InspectionBatch:
    """Create a batch, or stage it when ``commit`` is false."""
    db_batch = models.InspectionBatch(project_id=project_id, **batch.model_dump())
    db.add(db_batch)
    if commit:
        await db.commit()
        await db.refresh(db_batch)
        log_db_operation(
            "CREATE",
            "inspection_batches",
            db_batch.id,
            created_by or "system",
            {"project_id": str(project_id), "name": batch.name},
        )
    return db_batch


async def list_inspection_batches(
    db: AsyncSession, project_id: uuid.UUID
) -> list[models.InspectionBatch]:
    result = await db.execute(
        select(models.InspectionBatch)
        .where(models.InspectionBatch.project_id == project_id)
        .order_by(models.InspectionBatch.created_at.asc())
    )
    return result.scalars().all()


async def get_inspection_batch(
    db: AsyncSession, batch_id: uuid.UUID
) -> models.InspectionBatch | None:
    result = await db.execute(
        select(models.InspectionBatch).where(models.InspectionBatch.id == batch_id)
    )
    return result.scalars().first()


async def update_inspection_batch(
    db: AsyncSession,
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    patch: inspection_part_schemas.InspectionBatchUpdate,
    updated_by: str | None = None,
) -> models.InspectionBatch | None:
    batch = await db.execute(
        select(models.InspectionBatch).where(
            models.InspectionBatch.id == batch_id,
            models.InspectionBatch.project_id == project_id,
        )
    )
    db_batch = batch.scalars().first()
    if not db_batch:
        return None

    updates = patch.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(db_batch, key, value)

    await db.commit()
    await db.refresh(db_batch)
    log_db_operation(
        "UPDATE",
        "inspection_batches",
        db_batch.id,
        updated_by or "system",
        {"project_id": str(project_id), "fields": sorted(updates.keys())},
    )
    return db_batch


async def delete_inspection_batch(
    db: AsyncSession,
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    batch = await db.execute(
        select(models.InspectionBatch).where(
            models.InspectionBatch.id == batch_id,
            models.InspectionBatch.project_id == project_id,
        )
    )
    db_batch = batch.scalars().first()
    if not db_batch:
        return False

    parts_result = await db.execute(
        select(models.InspectionPart.id).where(
            models.InspectionPart.project_id == project_id,
            models.InspectionPart.batch_id == batch_id,
        )
    )
    moved_part_ids = [part_id for part_id in parts_result.scalars().all()]
    if moved_part_ids:
        await db.execute(
            update(models.InspectionPart)
            .where(
                models.InspectionPart.project_id == project_id,
                models.InspectionPart.batch_id == batch_id,
            )
            .values(batch_id=None)
        )

    await db.delete(db_batch)
    await db.commit()
    log_db_operation(
        "DELETE",
        "inspection_batches",
        batch_id,
        deleted_by or "system",
        {
            "project_id": str(project_id),
            "parts_moved_to_unassigned": len(moved_part_ids),
        },
    )
    return True


async def create_inspection_part(
    db: AsyncSession,
    project_id: uuid.UUID,
    part: inspection_part_schemas.InspectionPartCreate,
    created_by: str | None = None,
    commit: bool = True,
) -> models.InspectionPart:
    """Create a part, or stage it when ``commit`` is false."""
    payload = part.model_dump(by_alias=False)
    metadata_payload = payload.pop("metadata_json", None)
    db_part = models.InspectionPart(
        project_id=project_id, metadata_json=metadata_payload, **payload
    )
    db.add(db_part)
    if commit:
        await db.commit()
        await db.refresh(db_part)
        log_db_operation(
            "CREATE",
            "inspection_parts",
            db_part.id,
            created_by or "system",
            {"project_id": str(project_id), "serial_number": part.serial_number},
        )
    return db_part


async def replace_inspection_part_metadata_fields(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    fields_by_part: dict[uuid.UUID, list[dict[str, Any]]],
) -> None:
    """Replace derived metadata-field rows for several parts in one transaction.

    The caller owns the surrounding transaction. An empty list is meaningful:
    it clears all indexed fields for that part.
    """
    part_ids = list(fields_by_part)
    if not part_ids:
        return

    delete_statement = (
        delete(models.InspectionPartMetadataField)
        .where(
            models.InspectionPartMetadataField.project_id == project_id,
            models.InspectionPartMetadataField.part_id.in_(part_ids),
        )
        .execution_options(synchronize_session=False, autoflush=False)
    )
    await db.execute(delete_statement)

    # Assign primary keys client-side so large batched inserts correlate rows
    # by their supplied UUID sentinel instead of relying on SQLAlchemy's
    # RETURNING-based sentinel matching, which can misorder rows under
    # insertmanyvalues.
    field_rows = [
        models.InspectionPartMetadataField(
            id=uuid.uuid4(),
            project_id=project_id,
            part_id=part_id,
            **field_values,
        )
        for part_id, part_fields in fields_by_part.items()
        for field_values in part_fields
    ]
    if field_rows:
        db.add_all(field_rows)


async def list_inspection_parts(
    db: AsyncSession,
    project_id: uuid.UUID,
    batch_id: uuid.UUID | None = None,
    review_state: str | None = None,
) -> list[models.InspectionPart]:
    query = (
        select(models.InspectionPart)
        .where(models.InspectionPart.project_id == project_id)
        .order_by(models.InspectionPart.created_at.asc())
    )
    if batch_id:
        query = query.where(models.InspectionPart.batch_id == batch_id)
    if review_state:
        query = query.where(models.InspectionPart.review_state == review_state)

    result = await db.execute(query)
    return result.scalars().all()


async def list_inspection_parts_for_update_by_serial_numbers(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    serial_numbers: list[str],
) -> list[models.InspectionPart]:
    """Lock selected parts in deterministic order for transactional ingest."""
    normalized_serial_numbers = sorted(
        {
            str(serial_number).strip()
            for serial_number in serial_numbers
            if str(serial_number).strip()
        }
    )
    if not normalized_serial_numbers:
        return []

    query = (
        select(models.InspectionPart)
        .where(
            models.InspectionPart.project_id == project_id,
            models.InspectionPart.serial_number.in_(normalized_serial_numbers),
        )
        .order_by(
            models.InspectionPart.serial_number.asc(),
            models.InspectionPart.id.asc(),
        )
        .with_for_update()
    )
    result = await db.execute(query)
    return result.scalars().all()


async def get_inspection_part(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
) -> models.InspectionPart | None:
    result = await db.execute(
        select(models.InspectionPart).where(
            models.InspectionPart.project_id == project_id,
            models.InspectionPart.id == part_id,
        )
    )
    return result.scalars().first()


async def get_inspection_part_for_update(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
) -> models.InspectionPart | None:
    """Return a freshly-loaded part while holding its row lock until commit."""
    result = await db.execute(
        select(models.InspectionPart)
        .where(
            models.InspectionPart.project_id == project_id,
            models.InspectionPart.id == part_id,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    return result.scalar_one_or_none()


async def update_inspection_part_batch_assignment(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    to_batch_id: uuid.UUID | None,
    updated_by: str | None = None,
) -> models.InspectionPart | None:
    part = await get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        return None

    part.batch_id = to_batch_id
    await db.commit()
    await db.refresh(part)
    log_db_operation(
        "UPDATE",
        "inspection_parts",
        part.id,
        updated_by or "system",
        {
            "project_id": str(project_id),
            "batch_id": str(to_batch_id) if to_batch_id else None,
        },
    )
    return part


async def update_inspection_part_review_state(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    review_state: str,
    updated_by: str | None = None,
) -> models.InspectionPart | None:
    part = await get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        return None

    part.review_state = review_state
    await db.commit()
    await db.refresh(part)
    log_db_operation(
        "UPDATE",
        "inspection_parts",
        part.id,
        updated_by or "system",
        {"project_id": str(project_id), "review_state": review_state},
    )
    return part


async def update_inspection_part_metadata(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    metadata_patch: dict,
    updated_by: str | None = None,
    commit: bool = True,
) -> models.InspectionPart | None:
    # Every independently committed metadata mutation participates in the same
    # row-lock discipline. This keeps a narrow patch (for example
    # measurement_runs) from merging against a stale identity-mapped document
    # and erasing annotations written by a concurrent request. Bulk callers
    # using commit=False already own one encompassing transaction and may have
    # unflushed identity-map changes that must not be refreshed away here.
    part = await (
        get_inspection_part_for_update(
            db=db,
            project_id=project_id,
            part_id=part_id,
        )
        if commit
        else get_inspection_part(
            db=db,
            project_id=project_id,
            part_id=part_id,
        )
    )
    if not part:
        return None

    current_metadata = (
        part.metadata_json if isinstance(part.metadata_json, dict) else {}
    )
    part.metadata_json = {**current_metadata, **metadata_patch}
    if commit:
        await db.commit()
        await db.refresh(part)
        log_db_operation(
            "UPDATE",
            "inspection_parts",
            part.id,
            updated_by or "system",
            {
                "project_id": str(project_id),
                "metadata_keys": sorted(metadata_patch.keys()),
            },
        )
    return part


async def mutate_inspection_part_metadata_locked(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    metadata_mutator: Callable[[dict[str, Any]], tuple[dict[str, Any], Any]],
    updated_by: str | None = None,
) -> tuple[models.InspectionPart | None, Any]:
    """Apply a metadata transformation to the freshly locked row and commit.

    Use this when a patch cannot be computed safely before acquiring the row
    lock, such as a source-images list transformation. The callback returns a
    top-level metadata patch plus an arbitrary result needed by the caller.
    """
    part = await get_inspection_part_for_update(
        db=db,
        project_id=project_id,
        part_id=part_id,
    )
    if not part:
        return None, None

    current_metadata = (
        part.metadata_json if isinstance(part.metadata_json, dict) else {}
    )
    metadata_patch, mutation_result = metadata_mutator(dict(current_metadata))
    if not isinstance(metadata_patch, dict):
        raise TypeError("metadata_mutator must return a dictionary patch")
    if metadata_patch:
        part.metadata_json = {**current_metadata, **metadata_patch}

    # Commit even for a no-op transformation so the row lock is released
    # before the route performs its next source/target mutation.
    await db.commit()
    await db.refresh(part)
    if metadata_patch:
        log_db_operation(
            "UPDATE",
            "inspection_parts",
            part.id,
            updated_by or "system",
            {
                "project_id": str(project_id),
                "metadata_keys": sorted(metadata_patch.keys()),
            },
        )
    return part, mutation_result


async def remove_image_from_inspection_parts(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    filename: str | None = None,
    image_id: uuid.UUID | None = None,
    updated_by: str | None = None,
) -> int:
    """Remove image references from all project inspection-part metadata."""
    normalized_filename = str(filename or "").strip()
    normalized_image_id = str(image_id) if image_id else ""
    if not normalized_filename and not normalized_image_id:
        return 0

    parts = await list_inspection_parts(db=db, project_id=project_id)
    updated_count = 0
    for part in parts:
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        source_images = metadata.get("source_images")
        if not isinstance(source_images, list):
            continue

        retained = []
        changed = False
        for record in source_images:
            if not isinstance(record, dict):
                retained.append(record)
                continue
            record_filename = str(record.get("filename") or "").strip()
            record_image_id = str(record.get("image_id") or "")
            matches_filename = (
                normalized_filename and record_filename == normalized_filename
            )
            matches_image_id = (
                normalized_image_id and record_image_id == normalized_image_id
            )
            if matches_filename or matches_image_id:
                changed = True
                continue
            retained.append(record)

        if changed:
            configured_views = set()
            modalities = set()
            view_images = {}
            overlay_images = {}
            normalized_source_images = []
            for retained_record in retained:
                if not isinstance(retained_record, dict):
                    continue
                retained_filename = str(retained_record.get("filename") or "").strip()
                if not retained_filename:
                    continue
                side = str(retained_record.get("side") or "").strip().lower()
                modality = str(retained_record.get("modality") or "").strip().lower()
                overlay = bool(retained_record.get("overlay"))
                normalized_record = {
                    **retained_record,
                    "filename": retained_filename,
                    "side": side,
                    "modality": modality,
                    "overlay": overlay,
                }
                normalized_source_images.append(normalized_record)
                if side:
                    configured_views.add(side)
                if modality:
                    modalities.add(modality)
                if side and overlay and modality:
                    overlay_images.setdefault(side, {})[modality] = retained_filename
                elif side and not overlay and side not in view_images:
                    view_images[side] = retained_filename

            part.metadata_json = {
                **metadata,
                "source_images": normalized_source_images,
                "configured_views": sorted(configured_views),
                "modalities": sorted(modalities),
                "view_images": view_images,
                "overlay_images": overlay_images,
            }
            updated_count += 1

    if updated_count:
        await db.commit()
        log_db_operation(
            "UPDATE",
            "inspection_parts",
            project_id,
            updated_by or "system",
            {
                "action": "remove_image_references",
                "filename": normalized_filename,
                "image_id": normalized_image_id,
                "parts_updated": updated_count,
            },
        )
    return updated_count


def _is_missing_inspection_part_metadata_fields_table_error(
    exc: SQLAlchemyError,
) -> bool:
    error_text = str(exc).lower()
    return "inspection_part_metadata_fields" in error_text and any(
        marker in error_text
        for marker in (
            "does not exist",
            "no such table",
            "undefined table",
            "undefinedtable",
        )
    )


def _is_missing_inspection_part_metadata_fields_column_error(
    exc: SQLAlchemyError,
    column_name: str,
) -> bool:
    error_text = str(exc).lower()
    normalized_column = column_name.lower()
    return (
        "inspection_part_metadata_fields" in error_text
        and normalized_column in error_text
        and any(
            marker in error_text
            for marker in (
                "does not exist",
                "no such column",
                "undefined column",
                "undefinedcolumn",
            )
        )
    )


async def _execute_inspection_part_metadata_field_delete(
    db: AsyncSession,
    statement,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID | None,
    fallback_reason: str | None = None,
) -> bool:
    try:
        await db.execute(statement.execution_options(synchronize_session=False))
        return True
    except SQLAlchemyError as exc:
        await db.rollback()
        if not (
            _is_missing_inspection_part_metadata_fields_table_error(exc)
            or _is_missing_inspection_part_metadata_fields_column_error(exc, "part_id")
        ):
            raise
        logger.warning(
            "Skipping inspection part metadata-field cleanup because the derived table schema is unavailable",
            exc_info=True,
            extra={
                "project_id": str(project_id),
                "part_id": str(part_id) if part_id else None,
                "fallback_reason": fallback_reason,
            },
        )
        return False


async def _delete_inspection_part_metadata_fields(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID | None = None,
) -> bool:
    """Clean up derived metadata-field rows before part deletion when available."""
    statement = delete(models.InspectionPartMetadataField).where(
        models.InspectionPartMetadataField.project_id == project_id,
    )
    if part_id is not None:
        statement = statement.where(
            models.InspectionPartMetadataField.part_id == part_id
        )

    try:
        await db.execute(statement.execution_options(synchronize_session=False))
        return True
    except SQLAlchemyError as exc:
        await db.rollback()
        if _is_missing_inspection_part_metadata_fields_table_error(exc):
            logger.warning(
                "Skipping inspection part metadata-field cleanup because the table is missing",
                exc_info=True,
                extra={
                    "project_id": str(project_id),
                    "part_id": str(part_id) if part_id else None,
                },
            )
            return False
        if _is_missing_inspection_part_metadata_fields_column_error(exc, "part_id"):
            logger.warning(
                "Skipping inspection part metadata-field cleanup because the derived table lacks part_id",
                exc_info=True,
                extra={
                    "project_id": str(project_id),
                    "part_id": str(part_id) if part_id else None,
                },
            )
            return False
        if not _is_missing_inspection_part_metadata_fields_column_error(
            exc, "project_id"
        ):
            raise

    # Some long-lived development databases may have the optional derived-field
    # table from an earlier schema draft without project_id. Fall back to part_id
    # scoped cleanup so legacy projects can still unload parts.
    if part_id is not None:
        fallback_statement = delete(models.InspectionPartMetadataField).where(
            models.InspectionPartMetadataField.part_id == part_id,
        )
    else:
        project_part_ids = select(models.InspectionPart.id).where(
            models.InspectionPart.project_id == project_id,
        )
        fallback_statement = delete(models.InspectionPartMetadataField).where(
            models.InspectionPartMetadataField.part_id.in_(project_part_ids),
        )
    return await _execute_inspection_part_metadata_field_delete(
        db,
        fallback_statement,
        project_id=project_id,
        part_id=part_id,
        fallback_reason="missing_project_id_column",
    )


async def delete_inspection_part(
    db: AsyncSession,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    part = await get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        return False

    # Do not rely on the ORM relationship cascade here. The derived metadata
    # collection is not necessarily loaded and some supported databases do not
    # enforce the FK's ON DELETE cascade, which can leave the part delete
    # blocked by its indexed metadata rows. If the derived-field table is absent
    # because a development database is behind migrations, continue with the
    # canonical part delete instead of returning a 500 for this optional cleanup.
    await _delete_inspection_part_metadata_fields(
        db,
        project_id=project_id,
        part_id=part_id,
    )
    result = await db.execute(
        delete(models.InspectionPart).where(
            models.InspectionPart.project_id == project_id,
            models.InspectionPart.id == part_id,
        )
    )
    if max(int(result.rowcount or 0), 0) == 0:
        return False
    await db.commit()
    log_db_operation(
        "DELETE",
        "inspection_parts",
        part_id,
        deleted_by or "system",
        {"project_id": str(project_id)},
    )
    return True


async def delete_all_inspection_parts(
    db: AsyncSession,
    project_id: uuid.UUID,
    deleted_by: str | None = None,
) -> int:
    """Delete every part and its derived metadata rows in one transaction."""
    # Bulk ORM deletes do not run relationship cascades. Remove derived rows
    # explicitly so this remains correct on databases that do not enforce
    # foreign-key cascades (including the SQLite test configuration). If the
    # derived-field table is absent because migrations have not caught up, keep
    # the part deletion itself available.
    await _delete_inspection_part_metadata_fields(db, project_id=project_id)
    result = await db.execute(
        delete(models.InspectionPart).where(
            models.InspectionPart.project_id == project_id,
        )
    )
    deleted_count = max(int(result.rowcount or 0), 0)
    await db.commit()
    log_db_operation(
        "BULK_DELETE",
        "inspection_parts",
        project_id,
        deleted_by or "system",
        {
            "project_id": str(project_id),
            "parts_deleted": deleted_count,
        },
    )
    return deleted_count
