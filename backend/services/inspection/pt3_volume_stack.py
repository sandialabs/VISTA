"""Materialize a PT3 part's attached source images into a local volume stack.

Background splat fitters read a server-owned copy of the part's sources from
the PT3 cache. Every source is written with a hard byte limit and published
atomically through a ``.part`` sibling so an interrupted copy never leaves a
truncated slice behind.
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path
from typing import Any

import httpx

from core import models
from core.config import settings
from repositories import images as image_repository
from services.errors import (
    NotFoundError,
    PayloadTooLargeError,
    ServiceError,
    ServiceUnavailableError,
    UpstreamError,
    ValidationFailedError,
)
from services.inspection import part_images as inspection_part_image_service
from services.inspection import pt3_cache as inspection_pt3_cache_service
from utils.boto3_client import get_presigned_download_url
from utils.metadata_values import parse_metadata_boolean
from utils.pt3_test_fixtures import resolve_pt3_test_fixture_file
from utils.volume_loader import REFERENCE_VOLUME_READ_LIMITS

PT3_REAL_3DGS_MATERIALIZATION_LIMIT_BYTES = int(2.5 * 1024 * 1024 * 1024)
PT3_MAX_MATERIALIZED_FILE_BYTES = PT3_REAL_3DGS_MATERIALIZATION_LIMIT_BYTES
PT3_MAX_MATERIALIZED_STACK_BYTES = PT3_REAL_3DGS_MATERIALIZATION_LIMIT_BYTES
PT3_DOWNLOAD_CHUNK_BYTES = 64 * 1024


def _source_too_large(image: Any, byte_limit: int) -> PayloadTooLargeError:
    return PayloadTooLargeError(
        f"PT3 source {image.filename} exceeds the "
        f"{byte_limit}-byte materialization limit"
    )


def _materialize_inline_source(
    image: Any, encoded: str, partial: Path, destination: Path, byte_limit: int
) -> int:
    max_encoded_length = 4 * ((byte_limit + 2) // 3)
    if len(encoded) > max_encoded_length:
        raise _source_too_large(image, byte_limit)
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValidationFailedError(
            f"Inline image data for {image.filename} is invalid"
        ) from exc
    if len(payload) > byte_limit:
        raise _source_too_large(image, byte_limit)
    partial.write_bytes(payload)
    partial.replace(destination)
    return len(payload)


def _builtin_fixture_path(image: Any, metadata: dict) -> Path | None:
    # Built-in PT3 fixtures may intentionally be metadata-only when object storage is
    # unavailable. Persisted provenance is untrusted; resolve it through the central
    # server-owned allowlist rather than joining a metadata-derived path.
    if (
        metadata.get("source") != "vista-test-data"
        or metadata.get("project_type") != "PT3"
    ):
        return None
    return resolve_pt3_test_fixture_file(
        fixture_id=metadata.get("builtin_fixture_id"),
        fixture_filename=metadata.get("builtin_fixture_filename") or image.filename,
        image_filename=image.filename,
        object_storage_key=image.object_storage_key,
        project_id=image.project_id,
    )


def _materialize_fixture_source(
    image: Any, fixture_path: Path, partial: Path, destination: Path, byte_limit: int
) -> int:
    if fixture_path.stat().st_size > byte_limit:
        raise _source_too_large(image, byte_limit)
    written = 0
    try:
        with fixture_path.open("rb") as source, partial.open("wb") as target:
            while chunk := source.read(PT3_DOWNLOAD_CHUNK_BYTES):
                written += len(chunk)
                if written > byte_limit:
                    raise PayloadTooLargeError(
                        "PT3 fixture exceeds the materialization limit"
                    )
                target.write(chunk)
        partial.replace(destination)
        return written
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def _check_declared_content_length(response: Any, image: Any, byte_limit: int):
    raw_content_length = (getattr(response, "headers", {}) or {}).get("content-length")
    if raw_content_length is None:
        return
    try:
        content_length = int(raw_content_length)
    except (TypeError, ValueError) as exc:
        raise UpstreamError(
            "Object storage returned an invalid content length"
        ) from exc
    if content_length < 0:
        raise UpstreamError("Object storage returned an invalid content length")
    if content_length > byte_limit:
        raise _source_too_large(image, byte_limit)


async def _download_object_source(
    image: Any, partial: Path, destination: Path, byte_limit: int
) -> int:
    presigned_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=image.object_storage_key,
    )
    if not presigned_url:
        raise ServiceError(
            f"Could not read image stack slice {image.filename} from object storage"
        )
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", presigned_url) as response:
                response.raise_for_status()
                _check_declared_content_length(response, image, byte_limit)
                written = 0
                with partial.open("wb") as target:
                    async for chunk in response.aiter_bytes(
                        chunk_size=PT3_DOWNLOAD_CHUNK_BYTES
                    ):
                        written += len(chunk)
                        if written > byte_limit:
                            raise _source_too_large(image, byte_limit)
                        target.write(chunk)
                partial.replace(destination)
                return written
    except ServiceError:
        partial.unlink(missing_ok=True)
        raise
    except Exception as exc:
        partial.unlink(missing_ok=True)
        raise ServiceError(
            f"Could not materialize image stack slice {image.filename}"
        ) from exc


async def write_image_record_to_stack_dir(
    image: models.DataInstance,
    destination: Path,
    *,
    max_bytes: int | None = None,
) -> int:
    """Materialize one source with a hard byte limit and atomic publication."""
    byte_limit = min(
        PT3_MAX_MATERIALIZED_FILE_BYTES,
        max_bytes if max_bytes is not None else PT3_MAX_MATERIALIZED_FILE_BYTES,
    )
    if byte_limit < 1:
        raise PayloadTooLargeError("PT3 source stack exceeds the materialization limit")
    partial = destination.with_name(f".{destination.name}.part")
    partial.unlink(missing_ok=True)

    metadata = image.metadata_json if isinstance(image.metadata_json, dict) else {}
    encoded = metadata.get("analysis_inline_image_base64")
    if isinstance(encoded, str) and encoded:
        return _materialize_inline_source(
            image, encoded, partial, destination, byte_limit
        )
    fixture_path = _builtin_fixture_path(image, metadata)
    if fixture_path is not None:
        return _materialize_fixture_source(
            image, fixture_path, partial, destination, byte_limit
        )
    return await _download_object_source(image, partial, destination, byte_limit)


def _ordered_stack_records(metadata: dict) -> list[dict]:
    source_images = [
        record
        for record in metadata.get("source_images") or []
        if isinstance(record, dict)
    ]
    stack_records = [
        record
        for record in source_images
        if record.get("image_id") and not parse_metadata_boolean(record.get("overlay"))
    ]
    if not stack_records:
        raise ValidationFailedError(
            "No image stack slices are attached to this part for "
            "Gaussian splat generation"
        )
    if len(stack_records) > REFERENCE_VOLUME_READ_LIMITS.max_container_members:
        raise PayloadTooLargeError("PT3 source stack contains too many files")

    def sort_key(item: dict):
        raw_index = item.get("slice_index")
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            index = 10**9
        return (index, str(item.get("filename") or ""))

    return sorted(stack_records, key=sort_key)


def _prepare_stack_dir(
    project_id: uuid.UUID, part_id: Any, materialization_key: str | None
) -> Path:
    try:
        cache_components: list[object] = [project_id, part_id]
        if materialization_key:
            cache_components.append(materialization_key)
        stack_dir = inspection_pt3_cache_service.pt3_cache_directory(
            "pt3_volume_stacks",
            *cache_components,
            create=True,
            repair_mode=True,
        )
        for existing in stack_dir.iterdir():
            if existing.is_file():
                existing.unlink()
    except (inspection_pt3_cache_service.PT3CacheUnavailableError, OSError) as exc:
        raise ServiceUnavailableError(
            "PT3 fitting cache is unavailable because a writable job "
            "directory could not be prepared"
        ) from exc
    return stack_dir


async def _copy_stack_sources(
    *, project_id: uuid.UUID, stack_records: list[dict], stack_dir: Path, db: Any
) -> tuple[list[Path], list[str]]:
    source_image_ids: list[str] = []
    materialized_paths: list[Path] = []
    materialized_bytes = 0
    try:
        for index, record in enumerate(stack_records):
            image_id = uuid.UUID(str(record.get("image_id")))
            image = await image_repository.get_active_project_image(
                db=db, project_id=project_id, image_id=image_id
            )
            if not image:
                raise NotFoundError(
                    f"Image stack slice {record.get('image_id')} was not found"
                )
            source_image_ids.append(str(image.id))
            # The part metadata filename is display metadata and can be stale or
            # attacker-controlled. Preserve the storage object's actual format by
            # deriving the suffix from the authoritative DataInstance instead.
            destination = stack_dir / inspection_part_image_service.safe_stack_filename(
                image.filename, index
            )
            remaining_bytes = PT3_MAX_MATERIALIZED_STACK_BYTES - materialized_bytes
            written = await write_image_record_to_stack_dir(
                image,
                destination,
                max_bytes=remaining_bytes,
            )
            materialized_bytes += written
            materialized_paths.append(destination)
    except Exception:
        for path in materialized_paths:
            path.unlink(missing_ok=True)
        for partial in stack_dir.glob(".*.part"):
            partial.unlink(missing_ok=True)
        raise
    return materialized_paths, source_image_ids


async def materialize_part_volume_stack(
    *,
    project_id: uuid.UUID,
    part: Any,
    db: Any,
    materialization_key: str | None = None,
) -> tuple[str, list[str]]:
    """Copy the part's non-overlay sources into a job-owned cache directory."""
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    stack_records = _ordered_stack_records(metadata)
    stack_dir = _prepare_stack_dir(project_id, part.id, materialization_key)
    materialized_paths, source_image_ids = await _copy_stack_sources(
        project_id=project_id,
        stack_records=stack_records,
        stack_dir=stack_dir,
        db=db,
    )

    # A single implicit volume container must remain a file so load_volume can
    # distinguish NumPy arrays and multi-page TIFFs from a directory of slices.
    # A one-frame TIFF is still a valid depth-one volume. Multiple image files
    # retain the historical slice-stack interpretation.
    if len(materialized_paths) == 1 and materialized_paths[0].suffix.lower() in {
        ".npy",
        ".npz",
        ".tif",
        ".tiff",
    }:
        return str(materialized_paths[0]), source_image_ids
    if any(path.suffix.lower() in {".npy", ".npz"} for path in materialized_paths):
        raise ValidationFailedError(
            "A NumPy voxel volume must be the part's only source volume"
        )
    return str(stack_dir), source_image_ids
