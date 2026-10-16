"""Storage helpers for export and backup routes."""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
from typing import Any
from urllib.parse import unquote, urlparse

from core.config import settings
from services.errors import (
    ServiceUnavailableError,
    UpstreamError,
    ValidationFailedError,
)
from utils import boto3_client as object_storage
from utils.streaming_zip import StreamingZipEntry, iter_streaming_zip

logger = logging.getLogger(__name__)


class InvalidBackupLocationError(ValidationFailedError, ValueError):
    """Raised when a backup S3 URL cannot name a bucket and object key."""


def _require_s3_client() -> Any:
    s3_client = object_storage.boto3_client
    if not s3_client:
        raise ServiceUnavailableError("S3 client is not configured for this backend")
    return s3_client


def parse_backup_s3_url(raw_url: str) -> tuple[str, str]:
    """Parse supported S3 URL formats into bucket and key."""
    cleaned = (raw_url or "").strip()
    parsed = urlparse(cleaned)
    if parsed.scheme == "s3":
        return parsed.netloc, unquote(parsed.path.lstrip("/"))
    if parsed.scheme in {"http", "https"}:
        path_parts = [part for part in parsed.path.split("/") if part]
        if ".s3." in parsed.netloc or parsed.netloc.endswith(".s3.amazonaws.com"):
            return parsed.netloc.split(".")[0], unquote(parsed.path.lstrip("/"))
        if (
            parsed.netloc.startswith("s3.")
            or ".amazonaws.com" in parsed.netloc
            or "localhost" in parsed.netloc
            or ":" in parsed.netloc
        ):
            if not path_parts:
                raise InvalidBackupLocationError("S3 URL must include a bucket")
            return path_parts[0], unquote("/".join(path_parts[1:]))
        return parsed.netloc.split(".")[0], unquote(parsed.path.lstrip("/"))
    raise InvalidBackupLocationError("Use an s3://, http://, or https:// S3 URL")


async def zip_entries_to_bytes(entries: list[StreamingZipEntry]) -> bytes:
    """Materialize streaming ZIP entries to bytes."""
    chunks = []
    async for chunk in iter_streaming_zip(entries):
        chunks.append(chunk)
    return b"".join(chunks)


async def upload_backup_bytes_to_s3(
    *,
    s3_url: str,
    payload: bytes,
    content_type: str,
) -> dict:
    """Upload backup bytes to object storage."""
    s3_client = _require_s3_client()
    bucket, key = parse_backup_s3_url(s3_url)
    if not bucket or not key or key.endswith("/"):
        raise InvalidBackupLocationError("S3 URL must include a bucket and object key")
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: s3_client.upload_fileobj(
                io.BytesIO(payload),
                bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            ),
        )
    except Exception as exc:
        logger.warning(
            "Backup upload to S3 failed",
            extra={"bucket": bucket, "key": key, "error": str(exc)},
        )
        raise UpstreamError("Unable to upload backup to S3") from exc
    return {
        "ok": True,
        "s3_url": s3_url,
        "bucket": bucket,
        "key": key,
        "bytes": len(payload),
    }


async def download_backup_from_s3(
    *,
    s3_url: str,
) -> io.BytesIO:
    """Download a backup object from object storage."""
    s3_client = _require_s3_client()
    bucket, key = parse_backup_s3_url(s3_url)
    if not bucket or not key:
        raise InvalidBackupLocationError("S3 URL must include a bucket and object key")
    buffer = io.BytesIO()
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: s3_client.download_fileobj(bucket, key, buffer),
        )
    except Exception as exc:
        logger.warning(
            "Backup download from S3 failed",
            extra={"bucket": bucket, "key": key, "error": str(exc)},
        )
        raise UpstreamError("Unable to download backup from S3") from exc
    buffer.seek(0)
    return buffer


def write_storage_object_to_zip_member_sync(
    object_storage_key: str, member: Any
) -> str | None:
    """Stream an object storage payload into a ZIP member and return its digest."""
    s3_client = object_storage.boto3_client
    if not s3_client or not object_storage_key:
        return None
    digest = hashlib.sha256()

    class _HashingWriter:
        def write(self, data: bytes | bytearray | memoryview) -> int:
            chunk = bytes(data)
            digest.update(chunk)
            return member.write(chunk)

    try:
        s3_client.download_fileobj(
            settings.S3_BUCKET, object_storage_key, _HashingWriter()
        )
    except Exception as exc:
        logger.warning(
            "Project backup could not read storage object",
            extra={"object_storage_key": object_storage_key, "error": str(exc)},
        )
        return None
    return digest.hexdigest()


def storage_enabled() -> bool:
    """Return whether this backend has an object storage client."""
    return bool(object_storage.boto3_client)


def write_storage_object_bytes_sync(
    object_storage_key: str, payload: bytes, content_type: str | None
) -> bool:
    """Write bytes to object storage synchronously."""
    s3_client = object_storage.boto3_client
    if not s3_client or not object_storage_key:
        return False
    try:
        s3_client.upload_fileobj(
            io.BytesIO(payload),
            settings.S3_BUCKET,
            object_storage_key,
            ExtraArgs={"ContentType": content_type or "application/octet-stream"},
        )
    except Exception as exc:
        logger.warning(
            "Project import could not write storage object",
            extra={"object_storage_key": object_storage_key, "error": str(exc)},
        )
        return False
    return True


def artifact_content_factory(
    image_ref: dict,
    manifest_payload: dict,
    artifact_counts: dict,
    missing_artifacts: list[dict],
):
    """Return a ZIP content factory for one image artifact."""

    def _record_missing_artifact(object_storage_key: str) -> None:
        artifact_counts["files_missing"] += 1
        missing_artifacts.append(
            {
                "image_id": image_ref.get("image_id", ""),
                "filename": image_ref.get("filename", ""),
                "archive_path": image_ref.get("archive_path", ""),
                "object_storage_key": object_storage_key,
            }
        )

    def _factory(member) -> None:
        object_storage_key = image_ref.get("object_storage_key") or ""
        checksum = write_storage_object_to_zip_member_sync(object_storage_key, member)
        if checksum is None:
            _record_missing_artifact(object_storage_key)
            return
        artifact_counts["files_written"] += 1
        checksums = manifest_payload.setdefault("checksums", {})
        checksums[image_ref.get("archive_path") or ""] = checksum

    return _factory
