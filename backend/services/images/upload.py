"""Image upload orchestration services."""

from __future__ import annotations

import asyncio
import io
import json as _json
import logging
import math
import mimetypes
import time
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from schemas import images as image_schemas
from schemas import users as user_schemas
from services.errors import PayloadTooLargeError, ServiceError, ValidationFailedError
from services.images import metadata as image_metadata_service
from services.images import storage_cleanup, storage_limits
from services.images import volumes as image_volume_service
from services.images.metadata import UploadedFile
from utils import cache_manager
from utils.boto3_client import (
    copy_s3_object_to_s3,
    delete_file_from_s3,
    upload_file_to_s3,
)
from utils.serialization import data_instance_schema_from_values
from utils.transactions import commit_database_transaction
from utils.volume_loader import MAX_VOLUME_LOAD_BYTES, REFERENCE_VOLUME_READ_LIMITS

logger = logging.getLogger(__name__)

DEFAULT_BATCH_UPLOAD_MAX_FILES = 100
DEFAULT_BATCH_UPLOAD_MAX_BYTES = 256 * 1024 * 1024
DEFAULT_BATCH_UPLOAD_MAX_MANIFEST_BYTES = 8 * 1024 * 1024
DEFAULT_BATCH_UPLOAD_CONCURRENCY = 6
MAX_BATCH_UPLOAD_CONCURRENCY = 6
DEFAULT_BATCH_METADATA_MAX_BYTES = 1024 * 1024
DEFAULT_BATCH_METADATA_MAX_DEPTH = 32
DEFAULT_BATCH_METADATA_MAX_ITEMS = 10_000
DEFAULT_BATCH_METADATA_MAX_STRING_BYTES = 1024 * 1024
DEFAULT_BATCH_METADATA_MAX_KEY_BYTES = 4096
MAX_UPLOAD_BYTES = MAX_VOLUME_LOAD_BYTES


def _format_byte_limit(byte_count: int) -> str:
    gib = byte_count / (1024**3)
    return f"{gib:.1f} GiB ({byte_count} bytes)"


def _positive_setting_int(value: int, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _upload_size_limit() -> int:
    return _positive_setting_int(settings.MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES)


def _batch_upload_file_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_UPLOAD_FILES, DEFAULT_BATCH_UPLOAD_MAX_FILES
    )


def _batch_upload_byte_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_UPLOAD_BYTES, DEFAULT_BATCH_UPLOAD_MAX_BYTES
    )


def _batch_upload_manifest_byte_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_UPLOAD_MANIFEST_BYTES,
        DEFAULT_BATCH_UPLOAD_MAX_MANIFEST_BYTES,
    )


def _batch_metadata_byte_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_METADATA_BYTES, DEFAULT_BATCH_METADATA_MAX_BYTES
    )


def _batch_metadata_depth_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_METADATA_DEPTH, DEFAULT_BATCH_METADATA_MAX_DEPTH
    )


def _batch_metadata_item_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_METADATA_ITEMS, DEFAULT_BATCH_METADATA_MAX_ITEMS
    )


def _batch_metadata_string_byte_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_METADATA_STRING_BYTES,
        DEFAULT_BATCH_METADATA_MAX_STRING_BYTES,
    )


def _batch_metadata_key_byte_limit() -> int:
    return _positive_setting_int(
        settings.MAX_BATCH_METADATA_KEY_BYTES, DEFAULT_BATCH_METADATA_MAX_KEY_BYTES
    )


def _batch_upload_concurrency() -> int:
    configured = _positive_setting_int(
        settings.MAX_BATCH_UPLOAD_CONCURRENCY, DEFAULT_BATCH_UPLOAD_CONCURRENCY
    )
    return min(configured, MAX_BATCH_UPLOAD_CONCURRENCY)


def _file_too_large_detail(filename: str | None, file_size: int, max_size: int) -> str:
    name = filename or "Uploaded file"
    return (
        f"{name} is too large: {file_size} bytes exceeds the built-in "
        f"upload size limit of {_format_byte_limit(max_size)}. "
        "Set MAX_UPLOAD_BYTES to adjust this limit."
    )


def _batch_upload_file_size(file: UploadedFile) -> int:
    """Return a seekable multipart file's exact size without retaining its bytes."""
    try:
        file.file.seek(0, io.SEEK_END)
        file_size = int(file.file.tell())
        if file_size < 0:
            raise ValueError("negative file size")
        return file_size
    except Exception as exc:
        raise ValueError("Unable to determine uploaded file size") from exc
    finally:
        with suppress(Exception):
            file.file.seek(0)


def _batch_manifest_size_bytes(manifest_json: str) -> int:
    try:
        manifest_size = len(manifest_json.encode("utf-8"))
    except (AttributeError, UnicodeError) as exc:
        raise ValidationFailedError(
            "Batch upload manifest must be valid UTF-8 text"
        ) from exc

    manifest_limit = _batch_upload_manifest_byte_limit()
    if manifest_size > manifest_limit:
        raise PayloadTooLargeError(
            (
                f"Batch upload manifest is too large: {manifest_size} bytes "
                f"exceeds the configured manifest limit of {manifest_limit} bytes. "
                "Set MAX_BATCH_UPLOAD_MANIFEST_BYTES to adjust this limit."
            )
        )
    return manifest_size


async def _read_batch_upload_manifest(manifest_file: UploadedFile) -> tuple[str, int]:
    """Read a multipart manifest with an application-level byte ceiling."""
    manifest_limit = _batch_upload_manifest_byte_limit()
    try:
        raw_manifest = await manifest_file.read(manifest_limit + 1)
    except Exception as exc:
        raise ValidationFailedError("Unable to read batch upload manifest") from exc
    if len(raw_manifest) > manifest_limit:
        raise PayloadTooLargeError(
            (
                f"Batch upload manifest is too large: more than {manifest_limit} bytes "
                f"exceeds the configured manifest limit of {manifest_limit} bytes. "
                "Set MAX_BATCH_UPLOAD_MANIFEST_BYTES to adjust this limit."
            )
        )
    try:
        return raw_manifest.decode("utf-8"), len(raw_manifest)
    except UnicodeDecodeError as exc:
        raise ValidationFailedError(
            "Batch upload manifest must be valid UTF-8 text"
        ) from exc


def _raise_batch_metadata_limit(
    *,
    position: int,
    resource: str,
    observed: int,
    limit: int,
    environment_name: str,
) -> None:
    raise PayloadTooLargeError(
        (
            f"Batch upload manifest entry {position} metadata {resource} "
            f"is {observed}; the configured limit is {limit}. "
            f"Set {environment_name} to adjust this limit."
        )
    )


def validate_batch_metadata_structure(metadata: Any, *, position: int) -> None:
    """Bound metadata work before Pydantic or database JSON serialization."""
    if not isinstance(metadata, dict):
        raise ValidationFailedError(
            f"Batch upload manifest entry {position} metadata must be a JSON object"
        )

    depth_limit = _batch_metadata_depth_limit()
    item_limit = _batch_metadata_item_limit()
    string_limit = _batch_metadata_string_byte_limit()
    key_limit = _batch_metadata_key_byte_limit()
    item_count = 0
    stack: list[tuple[Any, int]] = [(metadata, 1)]

    while stack:
        value, depth = stack.pop()
        if depth > depth_limit:
            _raise_batch_metadata_limit(
                position=position,
                resource="nesting depth",
                observed=depth,
                limit=depth_limit,
                environment_name="MAX_BATCH_METADATA_DEPTH",
            )

        if isinstance(value, dict):
            item_count += len(value)
            if item_count > item_limit:
                _raise_batch_metadata_limit(
                    position=position,
                    resource="item count",
                    observed=item_count,
                    limit=item_limit,
                    environment_name="MAX_BATCH_METADATA_ITEMS",
                )
            for key, child in value.items():
                key_size = len(key.encode("utf-8"))
                if key_size > key_limit:
                    _raise_batch_metadata_limit(
                        position=position,
                        resource="key size in bytes",
                        observed=key_size,
                        limit=key_limit,
                        environment_name="MAX_BATCH_METADATA_KEY_BYTES",
                    )
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1))
                elif isinstance(child, str):
                    string_size = len(child.encode("utf-8"))
                    if string_size > string_limit:
                        _raise_batch_metadata_limit(
                            position=position,
                            resource="string size in bytes",
                            observed=string_size,
                            limit=string_limit,
                            environment_name="MAX_BATCH_METADATA_STRING_BYTES",
                        )
                elif isinstance(child, float) and not math.isfinite(child):
                    raise ValidationFailedError(
                        (
                            f"Batch upload manifest entry {position} metadata contains "
                            "a non-finite number"
                        )
                    )
        elif isinstance(value, list):
            item_count += len(value)
            if item_count > item_limit:
                _raise_batch_metadata_limit(
                    position=position,
                    resource="item count",
                    observed=item_count,
                    limit=item_limit,
                    environment_name="MAX_BATCH_METADATA_ITEMS",
                )
            for child in value:
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1))
                elif isinstance(child, str):
                    string_size = len(child.encode("utf-8"))
                    if string_size > string_limit:
                        _raise_batch_metadata_limit(
                            position=position,
                            resource="string size in bytes",
                            observed=string_size,
                            limit=string_limit,
                            environment_name="MAX_BATCH_METADATA_STRING_BYTES",
                        )
                elif isinstance(child, float) and not math.isfinite(child):
                    raise ValidationFailedError(
                        (
                            f"Batch upload manifest entry {position} metadata contains "
                            "a non-finite number"
                        )
                    )

    try:
        metadata_size = len(
            _json.dumps(
                metadata,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValidationFailedError(
            f"Batch upload manifest entry {position} metadata is not valid JSON"
        ) from exc
    metadata_limit = _batch_metadata_byte_limit()
    if metadata_size > metadata_limit:
        _raise_batch_metadata_limit(
            position=position,
            resource="serialized size in bytes",
            observed=metadata_size,
            limit=metadata_limit,
            environment_name="MAX_BATCH_METADATA_BYTES",
        )


def _parse_batch_upload_manifest(
    manifest_json: str,
    *,
    file_count: int,
) -> tuple[list[image_schemas.BatchImageUploadManifestEntry], int]:
    manifest_size = _batch_manifest_size_bytes(manifest_json)
    try:
        raw_manifest = _json.loads(manifest_json)
    except RecursionError as exc:
        raise PayloadTooLargeError(
            (
                "Batch upload manifest nesting exceeds the JSON parser's "
                "built-in limit; reduce its depth. MAX_BATCH_METADATA_DEPTH "
                "controls the application limit."
            )
        ) from exc
    except (TypeError, ValueError) as exc:
        raise ValidationFailedError(
            "Invalid JSON format for batch upload manifest"
        ) from exc

    if not isinstance(raw_manifest, list):
        raise ValidationFailedError("Batch upload manifest must be a JSON array")
    if len(raw_manifest) != file_count:
        raise ValidationFailedError(
            "Batch upload manifest must contain exactly one entry for each file"
        )

    entries: list[image_schemas.BatchImageUploadManifestEntry] = []
    for position, raw_entry in enumerate(raw_manifest):
        if not isinstance(raw_entry, dict):
            raise ValidationFailedError(
                f"Batch upload manifest entry {position} must be a JSON object"
            )
        validate_batch_metadata_structure(
            raw_entry.get("metadata", {}), position=position
        )
        try:
            entries.append(
                image_schemas.BatchImageUploadManifestEntry.model_validate(raw_entry)
            )
        except ValidationError as exc:
            raise ValidationFailedError(
                f"Batch upload manifest entry {position} is invalid"
            ) from exc

    client_indices = [entry.client_index for entry in entries]
    if len(client_indices) != len(set(client_indices)):
        raise ValidationFailedError(
            "Batch upload manifest client_index values must be unique"
        )
    return entries, manifest_size


def _batch_item_failure(
    entry: image_schemas.BatchImageUploadManifestEntry,
    *,
    code: str,
    detail: str,
) -> image_schemas.BatchImageUploadFailure:
    cleaned_detail = " ".join(str(detail).replace("\x00", "").split())[:512]
    return image_schemas.BatchImageUploadFailure(
        client_index=entry.client_index,
        filename=entry.filename,
        code=code,
        detail=cleaned_detail or "File could not be uploaded",
    )


async def cleanup_batch_upload_objects(object_storage_keys: list[str]) -> None:
    """Best-effort delete of orphaned batch upload objects."""
    await storage_cleanup.cleanup_objects(
        object_storage_keys,
        bucket_name=settings.S3_BUCKET,
        delete_file=delete_file_from_s3,
        storage_operation_slot=storage_limits.storage_operation_slot,
        concurrency=_batch_upload_concurrency(),
    )


async def upload_target_with_cleanup(
    *,
    object_storage_key: str,
    file_data: Any,
    length: int,
    content_type: str | None,
) -> bool:
    """Upload one batch object, cleaning it up on later batch failure."""
    return await storage_cleanup.upload_target_with_cleanup(
        object_storage_key=object_storage_key,
        file_data=file_data,
        length=length,
        content_type=content_type,
        bucket_name=settings.S3_BUCKET,
        upload_file=upload_file_to_s3,
        delete_file=delete_file_from_s3,
        storage_operation_slot=storage_limits.storage_operation_slot,
        cleanup_concurrency=_batch_upload_concurrency(),
    )


async def copy_target_with_cleanup(
    *,
    source_bucket: str,
    source_key: str,
    source_etag: str,
    object_storage_key: str,
) -> bool:
    """Copy one batch object, cleaning it up on later batch failure."""
    return await storage_cleanup.copy_target_with_cleanup(
        source_bucket=source_bucket,
        source_key=source_key,
        source_etag=source_etag,
        object_storage_key=object_storage_key,
        bucket_name=settings.S3_BUCKET,
        copy_file=copy_s3_object_to_s3,
        delete_file=delete_file_from_s3,
        storage_operation_slot=storage_limits.storage_operation_slot,
        cleanup_concurrency=_batch_upload_concurrency(),
    )


async def resolve_batch_image_groups(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    identifiers: list[str],
) -> dict[str, models.ImageGroup]:
    """Resolve groups with a unique-key upsert safe under concurrent batches."""
    unique_identifiers = sorted(set(identifiers))
    if not unique_identifiers:
        return {}

    # Always issue the idempotent insert first. Besides eliminating a query,
    # this closes the classic SELECT-then-INSERT race between two requests.
    values = [
        {
            "id": uuid.uuid4(),
            "project_id": project_id,
            "identifier": identifier,
        }
        for identifier in unique_identifiers
    ]
    dialect_name = db.get_bind().dialect.name
    if dialect_name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as dialect_insert

        statement = (
            dialect_insert(models.ImageGroup)
            .values(values)
            .on_conflict_do_nothing(constraint="uix_image_groups_project_identifier")
        )
        await db.execute(statement)
    elif dialect_name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as dialect_insert

        statement = (
            dialect_insert(models.ImageGroup)
            .values(values)
            .on_conflict_do_nothing(index_elements=["project_id", "identifier"])
        )
        await db.execute(statement)
    else:
        # Preserve support for other SQLAlchemy dialects. A savepoint keeps
        # the outer image transaction usable if another request wins the
        # unique-key race between our INSERT and INSERT.
        for value in values:
            try:
                async with db.begin_nested():
                    await db.execute(insert(models.ImageGroup).values(**value))
            except IntegrityError:
                pass

    # In PostgreSQL READ COMMITTED, an ON CONFLICT statement waits for the
    # winning transaction and this new statement snapshot sees its row.
    resolved_result = await db.execute(
        select(models.ImageGroup).where(
            models.ImageGroup.project_id == project_id,
            models.ImageGroup.identifier.in_(unique_identifiers),
        )
    )
    groups_by_identifier = {
        group.identifier: group for group in resolved_result.scalars().all()
    }

    unresolved = set(unique_identifiers) - set(groups_by_identifier)
    if unresolved:
        raise RuntimeError("Unable to resolve one or more image groups")
    return groups_by_identifier


async def upload_images_to_project_batch(
    *,
    db_project: models.Project,
    files: list[UploadedFile],
    manifest_file: UploadedFile,
    db: AsyncSession,
    current_user: user_schemas.User,
):
    """Upload a bounded batch to an authorized project with one database commit.

    ``files`` and ``manifest`` are positional peers. ``client_index`` is the
    stable response identity and does not depend on filenames, so duplicate
    final filenames remain unambiguous.
    """
    started_at = time.perf_counter()

    project_id = db_project.id
    project_type = db_project.project_type

    if not files:
        raise ValidationFailedError("Select at least one image file to upload")
    file_limit = _batch_upload_file_limit()
    if len(files) > file_limit:
        raise PayloadTooLargeError(
            f"Batch contains {len(files)} files; the configured limit is {file_limit}"
        )

    manifest_json, manifest_size = await _read_batch_upload_manifest(manifest_file)
    manifest, _ = _parse_batch_upload_manifest(
        manifest_json,
        file_count=len(files),
    )
    for file, entry in zip(files, manifest, strict=False):
        # Inspection and object naming must use the requested final filename,
        # rather than a possibly duplicated or browser-normalized source name.
        file.filename = entry.filename

    try:
        file_sizes = await asyncio.gather(
            *(asyncio.to_thread(_batch_upload_file_size, file) for file in files)
        )
    except ValueError as exc:
        raise ValidationFailedError(str(exc)) from exc

    per_file_limit = _upload_size_limit()
    for entry, file_size in zip(manifest, file_sizes, strict=False):
        if file_size > per_file_limit:
            raise PayloadTooLargeError(
                _file_too_large_detail(entry.filename, file_size, per_file_limit)
            )

    aggregate_size = sum(file_sizes) + manifest_size
    aggregate_limit = _batch_upload_byte_limit()
    if aggregate_size > aggregate_limit:
        raise PayloadTooLargeError(
            (
                f"Batch request is too large: {aggregate_size} "
                f"file-and-manifest bytes exceeds the configured batch "
                f"upload limit of {_format_byte_limit(aggregate_limit)}. "
                "Set MAX_BATCH_UPLOAD_BYTES to adjust this limit."
            )
        )
    preflight_finished_at = time.perf_counter()

    semaphore = asyncio.Semaphore(_batch_upload_concurrency())
    failures: list[image_schemas.BatchImageUploadFailure] = []

    async def inspect_one(
        position: int,
        file: UploadedFile,
        entry: image_schemas.BatchImageUploadManifestEntry,
    ) -> dict[str, Any] | None:
        async with semaphore:
            try:
                inspected_metadata, inspected_size = await asyncio.to_thread(
                    image_metadata_service.inspect_upload_file,
                    file,
                    validate_ordinary_header=True,
                    limits=REFERENCE_VOLUME_READ_LIMITS,
                )
            except ServiceError as exc:
                failures.append(
                    _batch_item_failure(
                        entry,
                        code="validation_failed",
                        detail=str(exc.detail),
                    )
                )
                return None
            except Exception:
                failures.append(
                    _batch_item_failure(
                        entry,
                        code="inspection_failed",
                        detail="File inspection failed",
                    )
                )
                return None

        merged_metadata = dict(entry.metadata)
        merged_metadata.update(inspected_metadata)
        if project_type == "PT3" and image_metadata_service.is_volume_upload_metadata(
            merged_metadata
        ):
            failures.append(
                _batch_item_failure(
                    entry,
                    code="legacy_route_required",
                    detail=(
                        "PT3 volume files must use the single-image upload endpoint "
                        "so inspection-part assignment remains atomic"
                    ),
                )
            )
            return None
        return {
            "position": position,
            "file": file,
            "entry": entry,
            "file_size": inspected_size
            if inspected_size is not None
            else file_sizes[position],
            "metadata": merged_metadata,
        }

    inspected = await asyncio.gather(
        *(
            inspect_one(position, file, entry)
            for position, (file, entry) in enumerate(zip(files, manifest, strict=False))
        )
    )
    upload_candidates = [item for item in inspected if item is not None]
    inspection_finished_at = time.perf_counter()

    async def upload_one(item: dict[str, Any]) -> dict[str, Any] | None:
        entry = item["entry"]
        image_id = uuid.uuid4()
        object_storage_key = f"{project_id}/{image_id}/{entry.filename}"
        content_type = (
            item["file"].content_type
            or mimetypes.guess_type(entry.filename)[0]
            or "application/octet-stream"
        )
        async with semaphore:
            uploaded = await upload_target_with_cleanup(
                object_storage_key=object_storage_key,
                file_data=item["file"].file,
                length=item["file_size"],
                content_type=content_type,
            )
        if not uploaded:
            failures.append(
                _batch_item_failure(
                    entry,
                    code="storage_upload_failed",
                    detail="Failed to upload file to object storage",
                )
            )
            return None
        return {
            **item,
            "image_id": image_id,
            "object_storage_key": object_storage_key,
            "content_type": content_type,
        }

    completed_upload_keys: list[str] = []

    async def tracked_upload_one(item: dict[str, Any]) -> dict[str, Any] | None:
        result = await upload_one(item)
        if result is not None:
            completed_upload_keys.append(result["object_storage_key"])
        return result

    try:
        upload_results = await asyncio.gather(
            *(tracked_upload_one(item) for item in upload_candidates)
        )
    except asyncio.CancelledError:
        await cleanup_batch_upload_objects(completed_upload_keys)
        raise
    uploaded_items = [item for item in upload_results if item is not None]
    storage_finished_at = time.perf_counter()

    if not uploaded_items:
        finished_at = time.perf_counter()
        logger.info(
            "Image batch upload completed",
            extra={
                "project_id": str(project_id),
                "requested_count": len(files),
                "uploaded_count": 0,
                "failed_count": len(failures),
                "request_bytes": aggregate_size,
                "preflight_ms": round((preflight_finished_at - started_at) * 1000, 1),
                "inspection_ms": round(
                    (inspection_finished_at - preflight_finished_at) * 1000, 1
                ),
                "storage_ms": round(
                    (storage_finished_at - inspection_finished_at) * 1000, 1
                ),
                "database_ms": 0.0,
                "duration_ms": round((finished_at - started_at) * 1000, 1),
            },
        )
        return image_schemas.BatchImageUploadResponse(
            uploaded=[],
            failed=sorted(failures, key=lambda item: item.client_index),
        )

    object_storage_keys = [item["object_storage_key"] for item in uploaded_items]
    uploaded_response: list[image_schemas.BatchImageUploadSuccess] = []
    try:
        requested_group_identifiers = sorted(
            {
                item["entry"].group_identifier
                for item in uploaded_items
                if item["entry"].group_identifier
            }
        )
        groups_by_identifier = await resolve_batch_image_groups(
            db,
            project_id=project_id,
            identifiers=requested_group_identifiers,
        )

        uploaded_at = datetime.now(UTC)
        for item in uploaded_items:
            entry = item["entry"]
            group = (
                groups_by_identifier.get(entry.group_identifier)
                if entry.group_identifier
                else None
            )
            group_id = group.id if group else None
            db_image = models.DataInstance(
                id=item["image_id"],
                project_id=project_id,
                group_id=group_id,
                filename=entry.filename,
                object_storage_key=item["object_storage_key"],
                content_type=item["content_type"],
                size_bytes=item["file_size"],
                metadata_json=item["metadata"],
                uploaded_by_user_id=current_user.email,
                created_at=uploaded_at,
            )
            db.add(db_image)
            uploaded_response.append(
                image_schemas.BatchImageUploadSuccess(
                    client_index=entry.client_index,
                    image=data_instance_schema_from_values(
                        id=item["image_id"],
                        project_id=project_id,
                        group_id=group_id,
                        filename=entry.filename,
                        object_storage_key=item["object_storage_key"],
                        content_type=item["content_type"],
                        size_bytes=item["file_size"],
                        metadata=item["metadata"],
                        uploaded_by_user_id=current_user.email,
                        created_at=uploaded_at,
                    ),
                )
            )

        await db.flush()
        await commit_database_transaction(db)
    except asyncio.CancelledError as exc:
        if getattr(exc, "vista_commit_succeeded", False):
            cache_manager.invalidate_project_images(project_id)
        else:
            with suppress(Exception):
                await db.rollback()
            await cleanup_batch_upload_objects(object_storage_keys)
        raise
    except Exception as exc:
        with suppress(Exception):
            await db.rollback()
        await cleanup_batch_upload_objects(object_storage_keys)
        raise ServiceError("Unable to save uploaded image records") from exc

    # One invalidation covers every row committed above. It is deliberately
    # best-effort because the database and object-storage writes are durable.
    cache_manager.invalidate_project_images(project_id)
    finished_at = time.perf_counter()
    logger.info(
        "Image batch upload completed",
        extra={
            "project_id": str(project_id),
            "requested_count": len(files),
            "uploaded_count": len(uploaded_response),
            "failed_count": len(failures),
            "request_bytes": aggregate_size,
            "preflight_ms": round((preflight_finished_at - started_at) * 1000, 1),
            "inspection_ms": round(
                (inspection_finished_at - preflight_finished_at) * 1000, 1
            ),
            "storage_ms": round(
                (storage_finished_at - inspection_finished_at) * 1000, 1
            ),
            "database_ms": round((finished_at - storage_finished_at) * 1000, 1),
            "duration_ms": round((finished_at - started_at) * 1000, 1),
        },
    )
    return image_schemas.BatchImageUploadResponse(
        uploaded=sorted(uploaded_response, key=lambda item: item.client_index),
        failed=sorted(failures, key=lambda item: item.client_index),
    )


async def upload_image_to_project(
    *,
    db_project: models.Project,
    file: UploadedFile,
    metadata_json: str | None,
    group_identifier: str | None,
    db: AsyncSession,
    current_user: user_schemas.User,
):
    """Upload an image file to a project, validating and storing it.

    Parses metadata, associates the image with the project and the
    uploading user, and optionally assigns it to a group found or
    created by `group_identifier`.
    """
    # Capture scalar values before any blocking IO to avoid MissingGreenlet
    # errors when SQLAlchemy tries to lazy-load expired attributes.
    project_id = db_project.id
    image_id = uuid.uuid4()
    object_storage_key = f"{project_id}/{image_id}/{file.filename}"
    parsed_metadata: dict[str, Any] | None = None
    if metadata_json:
        try:
            parsed_metadata = _json.loads(metadata_json)
        except _json.JSONDecodeError as exc:
            raise ValidationFailedError("Invalid JSON format for metadata") from exc
    if parsed_metadata is None:
        parsed_metadata = {}
    if not isinstance(parsed_metadata, dict):
        raise ValidationFailedError("Image metadata must be a JSON object")
    inspected_metadata, file_size = await asyncio.to_thread(
        image_metadata_service.inspect_upload_file,
        file,
        limits=REFERENCE_VOLUME_READ_LIMITS,
    )
    parsed_metadata.update(inspected_metadata)
    max_size = _upload_size_limit()
    if file_size and file_size > max_size:
        raise PayloadTooLargeError(
            _file_too_large_detail(file.filename, file_size, max_size)
        )
    success = await upload_target_with_cleanup(
        object_storage_key=object_storage_key,
        file_data=file.file,
        length=file_size or 0,
        content_type=file.content_type,
    )
    if not success:
        raise ServiceError("Failed to upload file to object storage")

    try:
        resolved_group_id: uuid.UUID | None = None
        normalized_group_identifier = (group_identifier or "").strip()
        if normalized_group_identifier:
            groups = await resolve_batch_image_groups(
                db,
                project_id=project_id,
                identifiers=[normalized_group_identifier],
            )
            resolved_group_id = groups[normalized_group_identifier].id

        uploaded_at = datetime.now(UTC)
        db_data_instance = models.DataInstance(
            id=image_id,
            project_id=project_id,
            filename=file.filename,
            object_storage_key=object_storage_key,
            content_type=file.content_type,
            size_bytes=file_size,
            metadata_json=parsed_metadata,
            uploaded_by_user_id=current_user.email,
            group_id=resolved_group_id,
            created_at=uploaded_at,
        )
        db.add(db_data_instance)
        await db.flush()
        await image_volume_service.autoassign_pt3_volume_upload_to_part(
            db=db,
            project=db_project,
            image=db_data_instance,
            current_user=current_user,
            commit=False,
        )
        await db.flush()
        response_image = data_instance_schema_from_values(
            id=image_id,
            project_id=project_id,
            group_id=resolved_group_id,
            filename=file.filename,
            object_storage_key=object_storage_key,
            content_type=file.content_type,
            size_bytes=file_size,
            metadata=parsed_metadata,
            uploaded_by_user_id=current_user.email,
            created_at=uploaded_at,
        )
        await commit_database_transaction(db)
    except asyncio.CancelledError as exc:
        if getattr(exc, "vista_commit_succeeded", False):
            cache_manager.invalidate_project_images(project_id)
        else:
            with suppress(Exception):
                await db.rollback()
            await cleanup_batch_upload_objects([object_storage_key])
        raise
    except Exception as exc:
        with suppress(Exception):
            await db.rollback()
        await cleanup_batch_upload_objects([object_storage_key])
        raise ServiceError("Unable to save uploaded image record") from exc

    cache_manager.invalidate_project_images(project_id)
    return response_image
