"""Transactional image deletion and restore workflows.

The HTTP router owns authentication and response translation.  This module
owns the database invariants that span images, inspection-part references,
project metadata, and deletion audit events.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories import audit as audit_repository
from schemas import images as image_schemas
from services.errors import ConflictError, GoneError, NotFoundError, UpstreamError
from utils.serialization import to_data_instance_schema
from utils.transactions import commit_database_transaction

StorageDelete = Callable[[str, str], Awaitable[bool]]
FORCE_DELETE_PENDING_ACTION = "force_delete_pending"


@dataclass(frozen=True, slots=True)
class ImageDeletionOutcome:
    """Result of a single image deletion or restore attempt."""

    image: image_schemas.DataInstance
    soft_deleted_now: bool
    storage_deleted_now: bool
    project_metadata_removed: int
    inspection_parts_updated: int


class ImageDeletionNotFound(NotFoundError, RuntimeError):
    """The authorized image disappeared or no longer belongs to the project."""

    default_detail = "Image not found"


class ImageStorageDeletionFailed(UpstreamError, RuntimeError):
    """Object storage could not confirm permanent deletion."""

    default_detail = (
        "Unable to permanently delete image from object storage; "
        "the storage outcome requires reconciliation before restore"
    )


class ImagePermanentlyDeleted(ConflictError, RuntimeError):
    """A restore was requested after permanent storage deletion."""

    default_detail = "Image permanently deleted"


class ImageStorageDeletionPending(ConflictError, RuntimeError):
    """A restore was requested while permanent deletion needs reconciliation."""

    default_detail = "Image storage deletion is pending reconciliation"


class ImageRetentionExpired(GoneError, RuntimeError):
    """A restore was requested after its retention deadline."""

    default_detail = "Retention expired"


async def _delete_storage_to_completion(
    *,
    delete_storage: StorageDelete,
    storage_bucket: str,
    storage_object_key: str,
) -> tuple[bool, asyncio.CancelledError | None]:
    """Wait for an irreversible storage request even if its caller is cancelled.

    Object-store clients generally cannot cancel an already-running blocking
    delete.  Shielding the task lets this service observe the definitive result
    and publish it to the database before propagating request cancellation.
    """
    storage_task = asyncio.create_task(
        delete_storage(storage_bucket, storage_object_key)
    )
    request_cancellation: asyncio.CancelledError | None = None
    try:
        storage_deleted = await asyncio.shield(storage_task)
    except asyncio.CancelledError as exc:
        if storage_task.cancelled():
            raise
        request_cancellation = exc
        while not storage_task.done():
            try:
                await asyncio.shield(storage_task)
            except asyncio.CancelledError:
                if storage_task.cancelled():
                    raise
                continue
            except BaseException:
                break
        if storage_task.cancelled():
            raise request_cancellation from exc
        try:
            storage_deleted = storage_task.result()
        except Exception as storage_exc:
            raise ImageStorageDeletionFailed from storage_exc
    except Exception as exc:
        raise ImageStorageDeletionFailed from exc

    return bool(storage_deleted), request_cancellation


async def _get_force_delete_pending_event(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
) -> models.ImageDeletionEvent | None:
    result = await db.execute(
        select(models.ImageDeletionEvent)
        .where(
            models.ImageDeletionEvent.project_id == project_id,
            models.ImageDeletionEvent.image_id == image_id,
            models.ImageDeletionEvent.action == FORCE_DELETE_PENDING_ACTION,
        )
        .order_by(models.ImageDeletionEvent.id.asc())
        .limit(1)
        .with_for_update()
    )
    return result.scalar_one_or_none()


def _candidate_project_metadata_keys(metadata: Any) -> set[str]:
    if not isinstance(metadata, dict):
        return set()

    keys: set[str] = set()
    for raw in metadata.get("associated_metadata_refs") or []:
        if raw:
            keys.add(str(raw))

    raw_ref = metadata.get("associated_metadata_ref")
    if raw_ref:
        keys.add(str(raw_ref))

    associated = metadata.get("associated_metadata")
    if isinstance(associated, dict):
        for candidate_key in ("project_metadata_key", "key"):
            raw = associated.get(candidate_key)
            if raw:
                keys.add(str(raw))

    sources = metadata.get("associated_metadata_sources")
    if isinstance(sources, list):
        for source in sources:
            if not isinstance(source, dict):
                continue
            for candidate_key in ("project_metadata_key", "key"):
                raw = source.get(candidate_key)
                if raw:
                    keys.add(str(raw))

    return {key for key in keys if key}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


async def _get_locked_image(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
) -> models.DataInstance:
    result = await db.execute(
        select(models.DataInstance)
        .where(
            models.DataInstance.id == image_id,
            models.DataInstance.project_id == project_id,
        )
        .execution_options(populate_existing=True)
        .with_for_update(of=models.DataInstance)
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise ImageDeletionNotFound
    return image


async def _stage_unreferenced_project_metadata_removal(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    deleted_image_id: uuid.UUID,
    image_metadata: Any,
) -> list[models.ProjectMetadata]:
    candidate_keys = _candidate_project_metadata_keys(image_metadata)
    if not candidate_keys:
        return []

    # Lock the narrow set of candidate metadata rows before checking whether
    # another active image still references them. Concurrent deletions that
    # share a key then serialize on that key, so the waiter performs its
    # reference scan against the winner's committed deletion state.
    metadata_result = await db.execute(
        select(models.ProjectMetadata)
        .where(
            models.ProjectMetadata.project_id == project_id,
            models.ProjectMetadata.key.in_(sorted(candidate_keys)),
        )
        .order_by(models.ProjectMetadata.key.asc())
        .with_for_update()
    )
    candidate_metadata = list(metadata_result.scalars().all())

    result = await db.execute(
        select(models.DataInstance.metadata_json).where(
            models.DataInstance.project_id == project_id,
            models.DataInstance.id != deleted_image_id,
            models.DataInstance.deleted_at.is_(None),
        )
    )
    referenced_elsewhere: set[str] = set()
    for other_metadata in result.scalars().all():
        referenced_elsewhere.update(_candidate_project_metadata_keys(other_metadata))

    unreferenced_keys = sorted(candidate_keys - referenced_elsewhere)
    if not unreferenced_keys:
        return []

    removed_metadata = [
        metadata for metadata in candidate_metadata if metadata.key in unreferenced_keys
    ]
    for metadata in removed_metadata:
        await db.delete(metadata)
    return removed_metadata


def _metadata_without_image_reference(
    metadata: Any,
    *,
    filename: str,
    image_id: uuid.UUID,
) -> dict[str, Any] | None:
    if not isinstance(metadata, dict):
        return None
    source_images = metadata.get("source_images")
    if not isinstance(source_images, list):
        return None

    normalized_image_id = str(image_id)
    retained: list[Any] = []
    changed = False
    for record in source_images:
        if not isinstance(record, dict):
            retained.append(record)
            continue
        record_filename = str(record.get("filename") or "").strip()
        record_image_id = str(record.get("image_id") or "").strip()
        matches_image_id = record_image_id == normalized_image_id
        matches_legacy_filename = not record_image_id and record_filename == filename
        if matches_image_id or matches_legacy_filename:
            changed = True
            continue
        retained.append(record)

    if not changed:
        return None

    configured_views: set[str] = set()
    modalities: set[str] = set()
    view_images: dict[str, str] = {}
    overlay_images: dict[str, dict[str, str]] = {}
    normalized_source_images: list[dict[str, Any]] = []
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

    return {
        **metadata,
        "source_images": normalized_source_images,
        "configured_views": sorted(configured_views),
        "modalities": sorted(modalities),
        "view_images": view_images,
        "overlay_images": overlay_images,
    }


async def _stage_inspection_part_reference_removal(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    filename: str,
    image_id: uuid.UUID,
) -> list[models.InspectionPart]:
    result = await db.execute(
        select(models.InspectionPart)
        .where(models.InspectionPart.project_id == project_id)
        .order_by(models.InspectionPart.id.asc())
        .execution_options(populate_existing=True)
        .with_for_update(of=models.InspectionPart)
    )
    updated_parts: list[models.InspectionPart] = []
    for part in result.scalars().all():
        updated_metadata = _metadata_without_image_reference(
            part.metadata_json,
            filename=filename,
            image_id=image_id,
        )
        if updated_metadata is None:
            continue
        part.metadata_json = updated_metadata
        updated_parts.append(part)
    return updated_parts


def _add_deletion_event(
    *,
    db: AsyncSession,
    image: models.DataInstance,
    actor_user_id: uuid.UUID | None,
    action: str,
    reason: str | None,
    previous_state: dict[str, Any],
) -> None:
    db.add(
        models.ImageDeletionEvent(
            image_id=image.id,
            project_id=image.project_id,
            actor_user_id=actor_user_id,
            action=action,
            reason=reason,
            previous_state=previous_state,
            storage_deleted=bool(image.storage_deleted),
            at=datetime.now(UTC),
        )
    )


async def _stage_soft_delete(
    *,
    db: AsyncSession,
    image: models.DataInstance,
    project_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    reason: str,
    retention_days: int,
    now: datetime,
) -> tuple[list[models.ProjectMetadata], list[models.InspectionPart]]:
    image_metadata = (
        image.metadata_json if isinstance(image.metadata_json, dict) else {}
    )
    image.deleted_at = now
    image.deleted_by_user_id = actor_user_id
    image.deletion_reason = reason
    image.pending_hard_delete_at = now + timedelta(days=retention_days)

    removed_metadata = await _stage_unreferenced_project_metadata_removal(
        db=db,
        project_id=project_id,
        deleted_image_id=image.id,
        image_metadata=image_metadata,
    )
    updated_parts = await _stage_inspection_part_reference_removal(
        db=db,
        project_id=project_id,
        filename=image.filename,
        image_id=image.id,
    )
    _add_deletion_event(
        db=db,
        image=image,
        actor_user_id=actor_user_id,
        action="soft_delete",
        reason=reason,
        previous_state={"deleted_at": None},
    )

    return removed_metadata, updated_parts


def _log_soft_delete_side_effects(
    *,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    image_filename: str,
    actor_email: str,
    removed_metadata: list[tuple[uuid.UUID, str]],
    updated_parts_count: int,
) -> None:
    for metadata_id, metadata_key in removed_metadata:
        audit_repository.log_db_operation(
            "DELETE",
            "project_metadata",
            metadata_id,
            actor_email,
            {"key": metadata_key, "project_id": str(project_id)},
        )
    if updated_parts_count:
        audit_repository.log_db_operation(
            "UPDATE",
            "inspection_parts",
            project_id,
            actor_email,
            {
                "action": "remove_image_references",
                "filename": image_filename,
                "image_id": str(image_id),
                "parts_updated": updated_parts_count,
            },
        )


async def delete_authorized_image(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    actor_email: str,
    reason: str,
    retention_days: int,
    force: bool,
    storage_bucket: str,
    delete_storage: StorageDelete,
) -> ImageDeletionOutcome:
    """Delete an authorized image while preserving recoverable state.

    Soft deletion and its database side effects commit atomically.  Permanent
    object deletion is then performed outside a database transaction and is
    published in a second, idempotent transaction.
    """
    soft_deleted_now = False
    storage_deleted_now = False
    removed_metadata_count = 0
    updated_parts_count = 0
    phase_one_removed_metadata_log: list[tuple[uuid.UUID, str]] = []
    phase_one_image_id = image_id
    phase_one_image_filename = ""

    try:
        image = await _get_locked_image(
            db=db,
            project_id=project_id,
            image_id=image_id,
        )
        if image.deleted_at is None:
            soft_deleted_now = True
            removed_metadata, updated_parts = await _stage_soft_delete(
                db=db,
                image=image,
                project_id=project_id,
                actor_user_id=actor_user_id,
                reason=reason,
                retention_days=retention_days,
                now=datetime.now(UTC),
            )
            phase_one_removed_metadata_log = [
                (metadata.id, metadata.key) for metadata in removed_metadata
            ]
            removed_metadata_count = len(removed_metadata)
            updated_parts_count = len(updated_parts)
        storage_already_deleted = bool(image.storage_deleted)
        existing_force_delete_pending = None
        if force and not storage_already_deleted:
            existing_force_delete_pending = await _get_force_delete_pending_event(
                db=db,
                project_id=project_id,
                image_id=image_id,
            )
        force_delete_pending_now = bool(
            force
            and not storage_already_deleted
            and existing_force_delete_pending is None
        )
        if force_delete_pending_now:
            # This audit row is a durable pre-I/O intent marker. It blocks
            # restore until a confirmed storage result is published, without
            # claiming that permanent deletion has already completed.
            _add_deletion_event(
                db=db,
                image=image,
                actor_user_id=actor_user_id,
                action=FORCE_DELETE_PENDING_ACTION,
                reason=reason,
                previous_state={"storage_delete_pending": True},
            )
        if soft_deleted_now or force_delete_pending_now:
            await db.flush()
            await db.refresh(image)
        phase_one_image = to_data_instance_schema(image)
        phase_one_image_id = image.id
        phase_one_image_filename = image.filename
        storage_object_key = image.object_storage_key
        await commit_database_transaction(db)
    except asyncio.CancelledError as exc:
        if not getattr(exc, "vista_commit_succeeded", False):
            await db.rollback()
        raise
    except BaseException:
        await db.rollback()
        raise

    if soft_deleted_now:
        _log_soft_delete_side_effects(
            project_id=project_id,
            image_id=phase_one_image_id,
            image_filename=phase_one_image_filename,
            actor_email=actor_email,
            removed_metadata=phase_one_removed_metadata_log,
            updated_parts_count=updated_parts_count,
        )

    if not force or storage_already_deleted:
        return ImageDeletionOutcome(
            image=phase_one_image,
            soft_deleted_now=soft_deleted_now,
            storage_deleted_now=False,
            project_metadata_removed=removed_metadata_count,
            inspection_parts_updated=updated_parts_count,
        )

    storage_deleted, storage_request_cancellation = await _delete_storage_to_completion(
        delete_storage=delete_storage,
        storage_bucket=storage_bucket,
        storage_object_key=storage_object_key,
    )
    if not storage_deleted:
        if storage_request_cancellation is not None:
            storage_request_cancellation.vista_storage_delete_succeeded = False
            raise storage_request_cancellation
        raise ImageStorageDeletionFailed

    # Re-lock after external I/O. A concurrent restore may have won while the
    # object was being deleted; if so, reapply soft deletion and its cleanup in
    # this transaction so an active row can never reference missing storage.
    phase_two_removed_metadata: list[models.ProjectMetadata] = []
    phase_two_updated_parts: list[models.InspectionPart] = []
    phase_two_removed_metadata_log: list[tuple[uuid.UUID, str]] = []
    phase_two_image_id = image_id
    phase_two_image_filename = phase_one_image_filename
    phase_two_soft_deleted = False
    try:
        image = await _get_locked_image(
            db=db,
            project_id=project_id,
            image_id=image_id,
        )
        pending_event = await _get_force_delete_pending_event(
            db=db,
            project_id=project_id,
            image_id=image_id,
        )
        if pending_event is not None:
            await db.delete(pending_event)
        if not image.storage_deleted:
            if image.deleted_at is None:
                phase_two_soft_deleted = True
                (
                    phase_two_removed_metadata,
                    phase_two_updated_parts,
                ) = await _stage_soft_delete(
                    db=db,
                    image=image,
                    project_id=project_id,
                    actor_user_id=actor_user_id,
                    reason=reason,
                    retention_days=retention_days,
                    now=datetime.now(UTC),
                )
                phase_two_removed_metadata_log = [
                    (metadata.id, metadata.key)
                    for metadata in phase_two_removed_metadata
                ]
            image.storage_deleted = True
            image.hard_deleted_at = image.hard_deleted_at or datetime.now(UTC)
            image.hard_deleted_by_user_id = actor_user_id
            _add_deletion_event(
                db=db,
                image=image,
                actor_user_id=actor_user_id,
                action="force_delete",
                reason=reason,
                previous_state={},
            )
            storage_deleted_now = True
            await db.flush()
            await db.refresh(image)
        phase_two_image = to_data_instance_schema(image)
        phase_two_image_id = image.id
        phase_two_image_filename = image.filename
        await commit_database_transaction(db)
    except asyncio.CancelledError as exc:
        if not getattr(exc, "vista_commit_succeeded", False):
            await db.rollback()
        raise
    except BaseException:
        await db.rollback()
        raise

    if phase_two_soft_deleted:
        soft_deleted_now = True
        removed_metadata_count += len(phase_two_removed_metadata)
        updated_parts_count += len(phase_two_updated_parts)
        _log_soft_delete_side_effects(
            project_id=project_id,
            image_id=phase_two_image_id,
            image_filename=phase_two_image_filename,
            actor_email=actor_email,
            removed_metadata=phase_two_removed_metadata_log,
            updated_parts_count=len(phase_two_updated_parts),
        )

    outcome = ImageDeletionOutcome(
        image=phase_two_image,
        soft_deleted_now=soft_deleted_now,
        storage_deleted_now=storage_deleted_now,
        project_metadata_removed=removed_metadata_count,
        inspection_parts_updated=updated_parts_count,
    )
    if storage_request_cancellation is not None:
        storage_request_cancellation.vista_storage_delete_succeeded = True
        storage_request_cancellation.vista_force_delete_published = True
        raise storage_request_cancellation
    return outcome


async def restore_authorized_image(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    now: datetime | None = None,
) -> image_schemas.DataInstance:
    """Restore a recoverable image and append its audit event atomically."""
    try:
        image = await _get_locked_image(
            db=db,
            project_id=project_id,
            image_id=image_id,
        )
        if image.storage_deleted:
            raise ImagePermanentlyDeleted
        if (
            await _get_force_delete_pending_event(
                db=db,
                project_id=project_id,
                image_id=image_id,
            )
            is not None
        ):
            raise ImageStorageDeletionPending
        if image.deleted_at is None:
            response_image = to_data_instance_schema(image)
            await commit_database_transaction(db)
            return response_image

        current_time = _utc(now or datetime.now(UTC))
        retention_deadline = image.pending_hard_delete_at
        if retention_deadline and current_time > _utc(retention_deadline):
            raise ImageRetentionExpired

        image.deleted_at = None
        image.deleted_by_user_id = None
        image.deletion_reason = None
        image.pending_hard_delete_at = None
        image.hard_deleted_at = None
        image.hard_deleted_by_user_id = None
        image.storage_deleted = False
        _add_deletion_event(
            db=db,
            image=image,
            actor_user_id=actor_user_id,
            action="restore",
            reason=None,
            previous_state={},
        )
        await db.flush()
        await db.refresh(image)
        response_image = to_data_instance_schema(image)
        await commit_database_transaction(db)
        return response_image
    except asyncio.CancelledError as exc:
        if not getattr(exc, "vista_commit_succeeded", False):
            await db.rollback()
        raise
    except BaseException:
        await db.rollback()
        raise
