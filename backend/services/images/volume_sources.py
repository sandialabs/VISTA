"""Authorized byte access for image volume sources.

Volume sources resolve in a fixed order: inline analysis bytes stored on the
image record, trusted built-in PT3 fixture files, then object storage through
a presigned URL. Every storage failure maps to a client-safe upstream error.
"""

from __future__ import annotations

import asyncio
import io
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from core import models
from core.config import settings
from services.errors import ServiceError, UpstreamError, UpstreamTimeoutError
from utils.pt3_test_fixtures import resolve_pt3_test_fixture_file
from utils.volume_cache import (
    VolumeSourceIdentity,
    VolumeSourceReadError,
    build_volume_source_identity,
)
from utils.volume_loader import MAX_NPY_HEADER_BYTES, read_npy_header

STORAGE_CHUNK_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class VolumeSourceAccess:
    """Request-scoped callables used to read one authorized image source."""

    inline_image_bytes: Callable[[models.DataInstance], bytes | None]
    get_presigned_download_url: Callable[..., str | None]


def storage_read_error(exc: Exception) -> ServiceError:
    """Map an object-storage failure to a client-safe upstream error."""
    if isinstance(exc, httpx.TimeoutException) or getattr(exc, "timed_out", False):
        return UpstreamTimeoutError("Object storage request timed out")
    return UpstreamError("Unable to retrieve image data from object storage")


def _image_metadata(db_image: models.DataInstance) -> dict:
    return db_image.metadata_json if isinstance(db_image.metadata_json, dict) else {}


def volume_source_identity(db_image: models.DataInstance) -> VolumeSourceIdentity:
    """Build the cache identity that versions one image's volume source."""
    return build_volume_source_identity(
        image_id=db_image.id,
        storage_key=db_image.object_storage_key,
        size_bytes=db_image.size_bytes,
        metadata=_image_metadata(db_image),
        created_at=db_image.created_at,
        updated_at=db_image.updated_at,
    )


def builtin_pt3_fixture_path(db_image: models.DataInstance) -> Path | None:
    """Resolve trusted built-in fixture provenance from an image record."""
    metadata = _image_metadata(db_image)
    if (
        metadata.get("source") != "vista-test-data"
        or metadata.get("project_type") != "PT3"
    ):
        return None
    return resolve_pt3_test_fixture_file(
        fixture_id=metadata.get("builtin_fixture_id"),
        fixture_filename=metadata.get("builtin_fixture_filename") or db_image.filename,
        image_filename=db_image.filename,
        object_storage_key=db_image.object_storage_key,
        project_id=db_image.project_id,
    )


def enforce_materialized_volume_source_limit(
    source_bytes: int,
    *,
    max_bytes: int,
) -> None:
    """Refuse a connected-selection source larger than ``max_bytes``."""
    if source_bytes < 0 or source_bytes > max_bytes:
        raise ValueError(
            "Volume source exceeds the connected-selection "
            f"{max_bytes}-byte source limit"
        )


def read_npy_header_from_path(path: Path) -> tuple[tuple[int, ...], str]:
    """Read a NumPy header from a local file."""
    with path.open("rb") as file_obj:
        return read_npy_header(file_obj)


def _presigned_storage_url(
    db_image: models.DataInstance, access: VolumeSourceAccess
) -> str:
    internal_url = access.get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=db_image.object_storage_key,
    )
    if not internal_url:
        raise ServiceError("Could not generate download URL")
    return internal_url


def _enforce_inline_encoded_limit(
    db_image: models.DataInstance, max_bytes: int
) -> None:
    encoded = _image_metadata(db_image).get("analysis_inline_image_base64")
    if isinstance(encoded, str) and encoded:
        # Base64 expands source bytes by roughly four thirds. Refuse an
        # obviously oversized inline object before allocating its decode.
        maximum_encoded_bytes = ((max_bytes + 2) // 3) * 4
        if len(encoded) > maximum_encoded_bytes:
            enforce_materialized_volume_source_limit(
                max_bytes + 1,
                max_bytes=max_bytes,
            )


async def _read_fixture_bytes(fixture_path: Path, max_bytes: int | None) -> bytes:
    if max_bytes is not None:
        fixture_stat = await asyncio.to_thread(fixture_path.stat)
        enforce_materialized_volume_source_limit(
            int(fixture_stat.st_size),
            max_bytes=max_bytes,
        )
    fixture_bytes = await asyncio.to_thread(fixture_path.read_bytes)
    if max_bytes is not None:
        enforce_materialized_volume_source_limit(
            len(fixture_bytes),
            max_bytes=max_bytes,
        )
    return fixture_bytes


def _enforce_declared_content_length(
    content_length: str | None, max_bytes: int
) -> None:
    if content_length is None:
        return
    try:
        declared_length = int(content_length)
    except (TypeError, ValueError):
        return
    enforce_materialized_volume_source_limit(declared_length, max_bytes=max_bytes)


async def _read_bounded_storage_bytes(
    client: httpx.AsyncClient, internal_url: str, max_bytes: int
) -> bytes:
    async with client.stream("GET", internal_url) as response:
        response.raise_for_status()
        _enforce_declared_content_length(
            response.headers.get("content-length"), max_bytes
        )
        buffered = io.BytesIO()
        source_bytes = 0
        async for chunk in response.aiter_bytes(chunk_size=STORAGE_CHUNK_BYTES):
            if not chunk:
                continue
            source_bytes += len(chunk)
            enforce_materialized_volume_source_limit(
                source_bytes,
                max_bytes=max_bytes,
            )
            buffered.write(chunk)
        return buffered.getvalue()


async def read_authorized_image_bytes(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    *,
    max_bytes: int | None = None,
) -> bytes:
    """Read one authorized source fully, optionally refusing oversized sources."""
    if max_bytes is not None:
        _enforce_inline_encoded_limit(db_image, max_bytes)
    inline_data = access.inline_image_bytes(db_image)
    if inline_data is not None:
        if max_bytes is not None:
            enforce_materialized_volume_source_limit(
                len(inline_data),
                max_bytes=max_bytes,
            )
        return inline_data
    fixture_path = builtin_pt3_fixture_path(db_image)
    if fixture_path is not None:
        return await _read_fixture_bytes(fixture_path, max_bytes)
    internal_url = _presigned_storage_url(db_image, access)
    try:
        async with httpx.AsyncClient() as client:
            if max_bytes is not None:
                return await _read_bounded_storage_bytes(
                    client, internal_url, max_bytes
                )
            response = await client.get(internal_url)
            response.raise_for_status()
            return await response.aread()
    except httpx.HTTPError as exc:
        raise storage_read_error(exc) from exc


async def iter_authorized_npy_bytes(
    db_image: models.DataInstance, access: VolumeSourceAccess
) -> AsyncIterator[bytes]:
    """Stream one authorized NumPy object without buffering it in RAM."""
    inline_data = access.inline_image_bytes(db_image)
    if inline_data is not None:
        yield inline_data
        return
    fixture_path = builtin_pt3_fixture_path(db_image)
    if fixture_path is not None:
        with fixture_path.open("rb") as fixture_file:
            while chunk := await asyncio.to_thread(
                fixture_file.read, STORAGE_CHUNK_BYTES
            ):
                yield chunk
        return
    internal_url = _presigned_storage_url(db_image, access)
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", internal_url) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes(chunk_size=STORAGE_CHUNK_BYTES):
                    if chunk:
                        yield chunk
    except httpx.HTTPError as exc:
        raise VolumeSourceReadError(
            timed_out=isinstance(exc, httpx.TimeoutException)
        ) from exc


async def _read_storage_prefix(internal_url: str, max_prefix_bytes: int) -> bytes:
    prefix = bytearray()
    try:
        async with (
            httpx.AsyncClient() as client,
            client.stream(
                "GET",
                internal_url,
                headers={"Range": f"bytes=0-{max_prefix_bytes - 1}"},
            ) as response,
        ):
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                remaining = max_prefix_bytes - len(prefix)
                if remaining <= 0:
                    break
                prefix.extend(chunk[:remaining])
                if len(prefix) >= max_prefix_bytes:
                    break
    except httpx.HTTPError as exc:
        raise storage_read_error(exc) from exc
    return bytes(prefix)


async def read_authorized_npy_header(
    db_image: models.DataInstance, access: VolumeSourceAccess
) -> tuple[tuple[int, ...], str]:
    """Read at most the bounded NumPy header prefix from object storage."""
    max_prefix_bytes = MAX_NPY_HEADER_BYTES + 12
    inline_data = access.inline_image_bytes(db_image)
    if inline_data is not None:
        return read_npy_header(io.BytesIO(inline_data[:max_prefix_bytes]))
    fixture_path = builtin_pt3_fixture_path(db_image)
    if fixture_path is not None:
        return await asyncio.to_thread(read_npy_header_from_path, fixture_path)
    internal_url = _presigned_storage_url(db_image, access)
    prefix = await _read_storage_prefix(internal_url, max_prefix_bytes)
    return read_npy_header(io.BytesIO(prefix))
