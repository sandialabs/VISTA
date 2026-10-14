"""Import selected S3 objects into a project as image records.

The workflow validates every key and all metadata before the first storage
side effect, inspects and copies objects with bounded concurrency, and saves
every successful copy in one database commit. Per-object problems are
reported in ``failed``; request-level problems raise service errors.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import time
import uuid
from contextlib import suppress
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from schemas import images as image_schemas
from schemas import users as user_schemas
from services.errors import ServiceError
from services.images import limits as image_limit_service
from services.images import s3_imports
from services.images import storage_limits as image_storage_limit_service
from services.images import upload as image_upload_service
from utils import cache_manager
from utils.boto3_client import get_s3_object_info
from utils.serialization import data_instance_schema_from_values
from utils.transactions import commit_database_transaction

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class S3ImportSource:
    """Shared bucket and concurrency limit for one import's object copies."""

    bucket: str
    semaphore: asyncio.Semaphore


async def import_project_s3_files(
    *,
    db: AsyncSession,
    db_project: models.Project,
    request: image_schemas.S3ImportRequest,
    current_user: user_schemas.User,
) -> image_schemas.S3ImportResponse:
    """Copy selected S3 objects with bounded storage work and one DB commit."""
    started_at = time.perf_counter()
    project_id = db_project.id
    s3_imports.validate_import_keys(request.keys)
    bucket, prefix = s3_imports.parse_s3_url(request.s3_url)
    s3_imports.validate_import_request_metadata(request)
    failures: dict[int, dict[str, str]] = {}
    validated = s3_imports.validate_import_items(request, bucket=bucket, prefix=prefix)
    items = _partition(validated, failures)
    validated_count = len(items)
    marks = {"validation": time.perf_counter()}

    source = S3ImportSource(bucket, asyncio.Semaphore(_import_concurrency()))
    inspected = await asyncio.gather(*(inspect_source(item, source) for item in items))
    items = _partition(inspected, failures)
    marks["inspection"] = time.perf_counter()

    items = _partition(await copy_sources(items, source, project_id), failures)
    marks["copy"] = time.perf_counter()

    imported = await persist_imports(
        db,
        items,
        project_id=project_id,
        uploaded_by=current_user.email,
        requested_count=len(request.keys),
        started_at=started_at,
    )
    marks["database"] = time.perf_counter()
    _log_completion(
        project_id,
        counts=(len(request.keys), validated_count, len(imported), len(failures)),
        started_at=started_at,
        marks=marks,
    )
    failed = [failure for _, failure in sorted(failures.items())]
    return image_schemas.S3ImportResponse(imported=imported, failed=failed)


async def inspect_source(
    item: s3_imports.S3ImportItem, source: S3ImportSource
) -> s3_imports.StepResult:
    """HEAD one source object and check its size and ETag."""
    try:
        async with (
            source.semaphore,
            image_storage_limit_service.storage_operation_slot(),
        ):
            info = await get_s3_object_info(source.bucket, item.key)
        if not info:
            raise ValueError("S3 object not found or inaccessible")
        size_bytes = int(info.get("size") or 0)
        _check_source_size(item.filename, size_bytes)
        etag = str(info.get("etag") or "").strip()
        if not etag:
            raise ValueError(
                "S3 object did not provide an ETag required for a "
                "size-safe conditional copy"
            )
        return replace(
            item,
            source_etag=etag,
            source_content_type=info.get("content_type"),
            size_bytes=size_bytes,
        )
    except Exception as exc:
        return s3_imports.import_failure(item.position, item.key, exc)


def _check_source_size(filename: str, size_bytes: int) -> None:
    if size_bytes < 0:
        raise ValueError("S3 object reported an invalid negative size")
    max_size = image_upload_service._upload_size_limit()
    if size_bytes > max_size:
        raise ValueError(
            image_upload_service._file_too_large_detail(filename, size_bytes, max_size)
        )


async def copy_sources(
    items: list[s3_imports.S3ImportItem], source: S3ImportSource, project_id: uuid.UUID
) -> list[s3_imports.StepResult]:
    """Copy inspected objects; on cancellation remove completed copies."""
    copied_keys: list[str] = []

    async def copy_and_track(item: s3_imports.S3ImportItem) -> s3_imports.StepResult:
        result = await copy_source(item, source, project_id)
        if isinstance(result, s3_imports.S3ImportItem):
            copied_keys.append(result.object_storage_key)
        return result

    try:
        return list(await asyncio.gather(*(copy_and_track(item) for item in items)))
    except asyncio.CancelledError:
        # Completed sibling tasks are not themselves cancelled, so clean their
        # successful copies here in addition to each interrupted task's target.
        await image_upload_service.cleanup_batch_upload_objects(copied_keys)
        raise


async def copy_source(
    item: s3_imports.S3ImportItem, source: S3ImportSource, project_id: uuid.UUID
) -> s3_imports.StepResult:
    """Conditionally copy one object into project storage."""
    image_id = uuid.uuid4()
    object_storage_key = f"{project_id}/{image_id}/{item.filename}"
    try:
        async with source.semaphore:
            copied = await image_upload_service.copy_target_with_cleanup(
                source_bucket=source.bucket,
                source_key=item.key,
                source_etag=item.source_etag,
                object_storage_key=object_storage_key,
            )
        if not copied:
            raise ValueError("Failed to copy file to project storage")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        return s3_imports.import_failure(item.position, item.key, exc)
    return replace(
        item,
        image_id=image_id,
        object_storage_key=object_storage_key,
        source_content_type=(
            item.source_content_type or mimetypes.guess_type(item.filename)[0]
        ),
    )


async def persist_imports(
    db: AsyncSession,
    items: list[s3_imports.S3ImportItem],
    *,
    project_id: uuid.UUID,
    uploaded_by: str,
    requested_count: int,
    started_at: float,
) -> list[image_schemas.DataInstance]:
    """Save copied objects in one commit, compensating storage on failure."""
    if not items:
        return []
    object_storage_keys = [item.object_storage_key for item in items]
    try:
        imported = await _add_image_records(db, items, project_id, uploaded_by)
        await db.flush()
        await commit_database_transaction(db)
    except asyncio.CancelledError as exc:
        if getattr(exc, "vista_commit_succeeded", False):
            cache_manager.invalidate_project_images(project_id)
        else:
            await _rollback_and_cleanup(db, object_storage_keys)
        raise
    except Exception as exc:
        await _rollback_and_cleanup(db, object_storage_keys)
        logger.error(
            "S3 image import database transaction failed",
            extra={
                "project_id": str(project_id),
                "requested_count": requested_count,
                "copied_count": len(items),
                "duration_ms": _elapsed_ms(started_at, time.perf_counter()),
            },
            exc_info=True,
        )
        raise ServiceError("Unable to save imported image records") from exc
    cache_manager.invalidate_project_images(project_id)
    return imported


async def _add_image_records(
    db: AsyncSession,
    items: list[s3_imports.S3ImportItem],
    project_id: uuid.UUID,
    uploaded_by: str,
) -> list[image_schemas.DataInstance]:
    """Stage one row per item and return schemas built from pre-commit values.

    Images join only groups the caller named; nothing is auto-assigned.
    """
    groups = await image_upload_service.resolve_batch_image_groups(
        db,
        project_id=project_id,
        identifiers=[item.group_identifier for item in items if item.group_identifier],
    )
    imported_at = datetime.now(UTC)
    imported = []
    for item in items:
        group = groups.get(item.group_identifier) if item.group_identifier else None
        values = {
            "id": item.image_id,
            "project_id": project_id,
            "group_id": group.id if group else None,
            "filename": item.filename,
            "object_storage_key": item.object_storage_key,
            "content_type": item.source_content_type,
            "size_bytes": item.size_bytes,
            "uploaded_by_user_id": uploaded_by,
            "created_at": imported_at,
        }
        db.add(models.DataInstance(**values, metadata_json=item.metadata))
        imported.append(
            data_instance_schema_from_values(**values, metadata=item.metadata)
        )
    return imported


async def _rollback_and_cleanup(
    db: AsyncSession, object_storage_keys: list[str]
) -> None:
    with suppress(Exception):
        await db.rollback()
    await image_upload_service.cleanup_batch_upload_objects(object_storage_keys)


def _partition(
    results: list[s3_imports.StepResult], failures: dict[int, dict[str, str]]
) -> list[s3_imports.S3ImportItem]:
    """Record failures by request position and return the surviving items."""
    survivors = []
    for result in results:
        if isinstance(result, s3_imports.S3ImportFailure):
            failures[result.position] = result.failure
        else:
            survivors.append(result)
    return survivors


def _import_concurrency() -> int:
    return image_limit_service.s3_import_concurrency(settings.MAX_S3_IMPORT_CONCURRENCY)


def _elapsed_ms(start: float, end: float) -> float:
    return round((end - start) * 1000, 1)


def _log_completion(
    project_id: uuid.UUID,
    *,
    counts: tuple[int, int, int, int],
    started_at: float,
    marks: dict[str, float],
) -> None:
    requested, validated, imported, failed = counts
    logger.info(
        "S3 image import completed",
        extra={
            "project_id": str(project_id),
            "requested_count": requested,
            "validated_count": validated,
            "imported_count": imported,
            "failed_count": failed,
            "validation_ms": _elapsed_ms(started_at, marks["validation"]),
            "inspection_ms": _elapsed_ms(marks["validation"], marks["inspection"]),
            "copy_ms": _elapsed_ms(marks["inspection"], marks["copy"]),
            "database_ms": _elapsed_ms(marks["copy"], marks["database"]),
            "duration_ms": _elapsed_ms(started_at, marks["database"]),
        },
    )
