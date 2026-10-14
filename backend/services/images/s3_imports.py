"""S3 import parsing and request validation for images.

Everything here runs before the first storage side effect of an import.
"""

from __future__ import annotations

import json
import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import unquote, urlparse

from pydantic import ValidationError

from core.config import settings
from schemas import images as image_schemas
from services.errors import PayloadTooLargeError, UpstreamError, ValidationFailedError
from services.images import limits as image_limit_service
from services.images import upload as image_upload_service
from utils.boto3_client import list_s3_objects

SUPPORTED_S3_IMPORT_EXTENSIONS = {
    ".bmp",
    ".gif",
    ".inspiro",
    ".jpeg",
    ".jpg",
    ".npy",
    ".npz",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}


def parse_s3_url(raw_url: str) -> tuple[str, str]:
    """Parse an S3-style URL into bucket and prefix."""
    value = (raw_url or "").strip()
    if not value:
        raise ValidationFailedError("S3 URL is required")

    parsed = urlparse(value)
    if parsed.scheme == "s3":
        bucket = parsed.netloc.strip()
        prefix = unquote(parsed.path.lstrip("/"))
    elif parsed.scheme in {"http", "https"}:
        host_parts = parsed.netloc.split(".")
        path_parts = [unquote(part) for part in parsed.path.split("/") if part]
        if len(host_parts) >= 4 and host_parts[1] == "s3":
            bucket = host_parts[0]
            prefix = "/".join(path_parts)
        elif (
            parsed.netloc.startswith("s3.")
            or ".amazonaws.com" in parsed.netloc
            or "localhost" in parsed.netloc
            or ":" in parsed.netloc
        ):
            if not path_parts:
                raise ValidationFailedError("S3 URL must include a bucket")
            bucket = path_parts[0]
            prefix = "/".join(path_parts[1:])
        else:
            if not path_parts:
                raise ValidationFailedError("S3 URL must include a bucket")
            bucket = path_parts[0]
            prefix = "/".join(path_parts[1:])
    else:
        raise ValidationFailedError("Use an s3://, http://, or https:// S3 URL")

    if not bucket:
        raise ValidationFailedError("S3 URL must include a bucket")
    return bucket, prefix


def filename_from_s3_key(key: str) -> str:
    """Return the file name component from an S3 object key."""
    filename = PurePosixPath(key).name
    if not filename:
        raise ValidationFailedError("S3 object key must reference a file")
    return filename


def is_supported_s3_file(key: str) -> bool:
    """Return whether an S3 key has a supported image/volume extension."""
    return PurePosixPath(key).suffix.lower() in SUPPORTED_S3_IMPORT_EXTENSIONS


def ensure_key_under_prefix(key: str, prefix: str) -> None:
    """Validate that a selected object key is within the requested prefix."""
    if not prefix:
        return
    normalized_prefix = prefix if prefix.endswith("/") else f"{prefix}/"
    if key != prefix and not key.startswith(normalized_prefix):
        raise ValidationFailedError(
            f"Selected key is outside the requested S3 URL prefix: {key}"
        )


def s3_import_failure(key: str, error: Any) -> dict[str, str]:
    """Normalize an S3 import failure for the API response."""
    cleaned_error = " ".join(str(error).replace("\x00", "").split())[:512]
    return {"key": key, "error": cleaned_error or "S3 object could not be imported"}


MAX_S3_IMPORT_KEYS = 100


@dataclass(frozen=True)
class S3ImportItem:
    """One selected object as it moves through validate, inspect, and copy."""

    position: int
    key: str
    filename: str
    metadata: dict[str, Any]
    group_identifier: str | None
    source_etag: str = ""
    source_content_type: str | None = None
    size_bytes: int = 0
    image_id: uuid.UUID | None = None
    object_storage_key: str = ""


@dataclass(frozen=True)
class S3ImportFailure:
    """A single failed S3 import, keyed by its position in the request."""

    position: int
    failure: dict[str, str]


StepResult = S3ImportItem | S3ImportFailure


def import_failure(position: int, key: str, error: Any) -> S3ImportFailure:
    """Build an `S3ImportFailure` from an exception or error payload."""
    return S3ImportFailure(position, s3_import_failure(key, error))


def validate_import_keys(keys: list[str]) -> None:
    """Reject empty, oversized, or duplicate key selections."""
    if not keys:
        raise ValidationFailedError("Select at least one S3 file to import")
    if len(keys) > MAX_S3_IMPORT_KEYS:
        raise ValidationFailedError(
            f"Import at most {MAX_S3_IMPORT_KEYS} S3 files at a time"
        )
    seen: set[str] = set()
    duplicates: set[str] = set()
    for key in keys:
        if key in seen:
            duplicates.add(key)
        seen.add(key)
    if duplicates:
        raise ValidationFailedError(
            "S3 import keys must be unique; duplicate keys: "
            + ", ".join(sorted(duplicates))
        )


def validate_import_request_metadata(request: image_schemas.S3ImportRequest) -> None:
    """Apply batch-upload resource bounds to JSON-only S3 imports."""
    request_dump = request.model_dump()
    try:
        serialized = json.dumps(
            request_dump, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError, RecursionError, UnicodeError) as exc:
        raise ValidationFailedError("S3 import metadata must be valid JSON") from exc

    limit = image_upload_service._batch_upload_manifest_byte_limit()
    if len(serialized) > limit:
        raise PayloadTooLargeError(
            f"S3 import request metadata is too large: {len(serialized)} bytes "
            f"exceeds the configured limit of {limit} bytes. "
            "Set MAX_BATCH_UPLOAD_MANIFEST_BYTES to adjust this limit."
        )

    validate_structure = image_upload_service.validate_batch_metadata_structure
    validate_structure(request_dump.get("metadata") or {}, position=0)
    per_file = (request_dump.get("per_file_metadata") or {}).values()
    for position, metadata in enumerate(per_file, start=1):
        validate_structure(metadata, position=position)


def validate_import_items(
    request: image_schemas.S3ImportRequest, *, bucket: str, prefix: str
) -> list[StepResult]:
    """Validate every key before any HEAD/COPY side effect.

    An out-of-prefix key fails the whole request so it cannot arrive after
    valid keys have already been copied; other per-key problems are failures.
    """
    results: list[StepResult] = []
    for position, key in enumerate(request.keys):
        ensure_key_under_prefix(key, prefix)
        try:
            results.append(_validated_item(request, position, key, bucket))
        except (ValidationError, ValueError) as exc:
            results.append(import_failure(position, key, exc))
    return results


def _validated_item(
    request: image_schemas.S3ImportRequest, position: int, key: str, bucket: str
) -> S3ImportItem:
    if not is_supported_s3_file(key):
        raise ValueError("Unsupported file type")
    # Provenance is assigned last and cannot be overridden by shared or
    # per-file user metadata.
    metadata = {
        **(request.metadata or {}),
        **((request.per_file_metadata or {}).get(key) or {}),
        "source": "s3_import",
        "source_s3_url": request.s3_url,
        "source_s3_bucket": bucket,
        "source_s3_key": key,
    }
    image_upload_service.validate_batch_metadata_structure(metadata, position=position)
    entry = image_schemas.BatchImageUploadManifestEntry(
        client_index=position,
        filename=filename_from_s3_key(key),
        metadata=metadata,
        group_identifier=(request.group_identifiers or {}).get(key),
    )
    return S3ImportItem(
        position=position,
        key=key,
        filename=entry.filename,
        metadata=entry.metadata,
        group_identifier=entry.group_identifier,
    )


def _is_listable_s3_key(key: str) -> bool:
    return bool(key) and not key.endswith("/") and is_supported_s3_file(key)


def _s3_object_summary(obj: dict[str, Any]) -> image_schemas.S3ObjectSummary | None:
    key = str(obj.get("key") or "")
    if not _is_listable_s3_key(key):
        return None
    last_modified = obj.get("last_modified")
    return image_schemas.S3ObjectSummary(
        key=key,
        filename=filename_from_s3_key(key),
        size=int(obj.get("size") or 0),
        content_type=mimetypes.guess_type(key)[0],
        last_modified=last_modified.isoformat()
        if hasattr(last_modified, "isoformat")
        else None,
    )


async def list_supported_s3_files(
    request: image_schemas.S3ListRequest,
) -> image_schemas.S3ListResponse:
    """List supported files under an S3 URL so the user can choose imports."""
    bucket, prefix = parse_s3_url(request.s3_url)
    configured_limit = image_limit_service.s3_list_key_limit(settings.MAX_S3_LIST_KEYS)
    max_keys = max(1, min(request.max_keys or configured_limit, configured_limit))
    try:
        objects = await list_s3_objects(
            bucket, prefix, max_keys=max_keys + 1, key_filter=_is_listable_s3_key
        )
    except Exception as exc:
        raise UpstreamError(f"Unable to list S3 objects: {exc}") from exc

    summaries = [
        summary
        for summary in (_s3_object_summary(obj) for obj in objects[:max_keys])
        if summary is not None
    ]
    return image_schemas.S3ListResponse(
        bucket=bucket,
        prefix=prefix,
        objects=summaries,
        truncated=(
            len(objects) > max_keys or bool(getattr(objects, "scan_truncated", False))
        ),
    )
