"""Thumbnail, content, and web-format helpers for image responses."""

from __future__ import annotations

import io
import logging
from collections.abc import Iterable
from typing import Callable

import httpx
from PIL import Image

from core import models
from core.config import settings
from services.errors import (
    ServiceError,
    UpstreamError,
    UpstreamTimeoutError,
    ValidationFailedError,
)
from services.images import metadata as image_metadata_service
from services.images import volume_sources as image_volume_source_service
from utils import cache_manager

logger = logging.getLogger(__name__)

WEB_FRIENDLY_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
}


def _prepare_thumbnail_image(image: Image.Image) -> tuple[Image.Image, str]:
    return image_metadata_service.prepare_thumbnail_image(image)


def convert_to_web_format(image_data: bytes, content_type: str) -> tuple[bytes, str]:
    """Convert non-web-friendly image bytes to PNG/JPEG when possible."""
    if content_type in WEB_FRIENDLY_CONTENT_TYPES:
        return image_data, content_type

    try:
        img = Image.open(io.BytesIO(image_data))
        normalized_scalar = image_metadata_service.normalize_scalar_image_to_uint8(img)
        if normalized_scalar is not None:
            output_buffer = io.BytesIO()
            normalized_scalar.save(output_buffer, format="PNG")
            output_buffer.seek(0)
            return output_buffer.getvalue(), "image/png"

        if img.mode in ("RGBA", "LA", "PA") or (
            img.mode == "P" and "transparency" in img.info
        ):
            if img.mode == "P" or img.mode in ("LA", "PA"):
                img = img.convert("RGBA")
            output_format = "PNG"
            output_content_type = "image/png"
        else:
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            output_format = "JPEG"
            output_content_type = "image/jpeg"

        output_buffer = io.BytesIO()
        if output_format == "JPEG":
            img.save(output_buffer, format=output_format, quality=95)
        else:
            img.save(output_buffer, format=output_format)
        output_buffer.seek(0)
        return output_buffer.getvalue(), output_content_type
    except Exception:
        return image_data, content_type


def _render_thumbnail(
    *,
    image_data: bytes,
    filename: str | None,
    width: int,
    height: int,
) -> tuple[bytes, str, str]:
    img = Image.open(io.BytesIO(image_data))
    img.thumbnail((width, height))
    img, img_format = _prepare_thumbnail_image(img)

    output_buffer = io.BytesIO()
    img.save(output_buffer, format=img_format)
    output_buffer.seek(0)

    content_type_map = {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "GIF": "image/gif",
        "WEBP": "image/webp",
    }
    content_type = content_type_map.get(img_format, "image/jpeg")
    thumbnail_filename = f"thumbnail_{filename}" if filename else "thumbnail"
    return output_buffer.getvalue(), content_type, thumbnail_filename


ThumbnailPayload = tuple[bytes, str, str]


async def get_image_thumbnail(
    *,
    db_image: models.DataInstance,
    width: int,
    height: int,
    inline_image_bytes: Callable[[models.DataInstance], bytes | None],
    get_presigned_download_url: Callable[..., str | None],
) -> ThumbnailPayload:
    """Generate and cache a thumbnail as ``(data, content_type, filename)``."""
    if width <= 0 or height <= 0:
        raise ValidationFailedError("Width and height must be positive integers")

    cache = cache_manager.get_cache()
    cache_key = cache_manager.thumbnail_key(db_image.id, width, height)
    cached_thumbnail = cache.get(cache_key)
    if cached_thumbnail:
        return tuple(cached_thumbnail)

    image_data = inline_image_bytes(db_image)
    if image_data is None:
        image_data = await _fetch_stored_image(db_image, get_presigned_download_url)
    try:
        thumbnail = _render_thumbnail(
            image_data=image_data,
            filename=db_image.filename,
            width=width,
            height=height,
        )
    except Exception as exc:
        logger.exception("Thumbnail generation failed for image %s", db_image.id)
        raise ServiceError("Error generating thumbnail") from exc
    cache.set(cache_key, thumbnail, expire=24 * 3600)
    return thumbnail


async def _fetch_stored_image(
    db_image: models.DataInstance,
    get_presigned_download_url: Callable[..., str | None],
) -> bytes:
    internal_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET, object_name=db_image.object_storage_key
    )
    if not internal_url:
        raise ServiceError("Could not generate download URL")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(internal_url)
            response.raise_for_status()
            return await response.aread()
        except httpx.TimeoutException as exc:
            raise UpstreamTimeoutError("Object storage request timed out") from exc
        except httpx.HTTPError as exc:
            raise UpstreamError(
                "Unable to retrieve image data from object storage"
            ) from exc


ImageContentPayload = tuple[Iterable[bytes] | io.IOBase, str]


async def get_image_content(
    *,
    db_image: models.DataInstance,
    convert: bool,
    inline_image_bytes: Callable[[models.DataInstance], bytes | None],
    get_presigned_download_url: Callable[..., str | None],
) -> ImageContentPayload:
    """Resolve displayable image content as ``(content, media_type)``.

    Sources resolve as inline analysis bytes, trusted built-in PT3 fixtures,
    then object storage. Non-web formats are converted when ``convert`` is set.
    """
    inline_data = inline_image_bytes(db_image)
    if inline_data is not None:
        return io.BytesIO(inline_data), db_image.content_type or "image/png"

    fixture_path = image_volume_source_service.builtin_pt3_fixture_path(db_image)
    if fixture_path is not None:
        return (
            fixture_path.open("rb"),
            db_image.content_type or "application/octet-stream",
        )

    internal_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET, object_name=db_image.object_storage_key
    )
    if not internal_url:
        raise ServiceError("Could not generate download URL")
    async with httpx.AsyncClient() as client:
        try:
            return await _fetch_content(client, internal_url, db_image, convert)
        except httpx.HTTPError as exc:
            raise image_volume_source_service.storage_read_error(exc) from exc
        except ServiceError:
            raise
        except Exception as exc:
            raise ServiceError("Unexpected error while retrieving image data") from exc


async def _fetch_content(
    client: httpx.AsyncClient,
    internal_url: str,
    db_image: models.DataInstance,
    convert: bool,
) -> ImageContentPayload:
    response = await client.get(internal_url)
    response.raise_for_status()
    content_type = db_image.content_type or "application/octet-stream"
    if convert and content_type not in WEB_FRIENDLY_CONTENT_TYPES:
        image_data = await response.aread()
        converted_data, converted_type = convert_to_web_format(image_data, content_type)
        return io.BytesIO(converted_data), converted_type
    return response.iter_bytes(), content_type
