"""Cached reads of project image lists, keyset pages, and image records.

Callers verify project or image access before calling these functions so a
revoked membership never serves cached data. Every stale-TIFF repair is a
mutation and invalidates the affected image caches before the re-read.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories import images as image_repository
from schemas import images as image_schemas
from services.errors import ValidationFailedError
from services.images import metadata as image_metadata_service
from services.images import pagination as image_pagination_service
from utils import cache_manager
from utils.serialization import to_data_instance_schema

logger = logging.getLogger(__name__)

PROJECT_IMAGES_CACHE_SECONDS = 30 * 60
IMAGE_METADATA_CACHE_SECONDS = 60 * 60


@dataclass(frozen=True)
class ImageListFilters:
    """Shared image-list filters; construction rejects conflicting filters."""

    include_deleted: bool = False
    deleted_only: bool = False
    search_field: str | None = None
    search_value: str | None = None
    group_id: uuid.UUID | None = None
    ungrouped: bool = False

    def __post_init__(self) -> None:
        """Reject filter combinations the listing endpoints do not support."""
        if self.group_id is not None and self.ungrouped:
            raise ValidationFailedError(
                "group_id and ungrouped=true are mutually exclusive"
            )
        if self.deleted_only and (self.group_id is not None or self.ungrouped):
            raise ValidationFailedError(
                "group_id and ungrouped filters cannot be combined with deleted_only"
            )

    def repository_kwargs(self) -> dict[str, Any]:
        """Return the keyword filters the image repository query accepts."""
        return {
            "search_field": self.search_field,
            "search_value": self.search_value,
            "group_id": self.group_id,
            "ungrouped": self.ungrouped,
            "include_deleted": self.include_deleted,
        }


async def _fetch_project_images(
    db: AsyncSession,
    project_id: uuid.UUID,
    filters: ImageListFilters,
    skip: int,
    limit: int,
) -> list[models.DataInstance]:
    if filters.deleted_only:
        return await image_repository.get_deleted_images_for_project(
            db=db, project_id=project_id, skip=skip, limit=limit
        )
    return await image_repository.get_data_instances_for_project(
        db=db,
        project_id=project_id,
        skip=skip,
        limit=limit,
        **filters.repository_kwargs(),
    )


def _serialize_listed_images(
    images: list[models.DataInstance], filters: ImageListFilters
) -> list[image_schemas.DataInstance]:
    response_images = []
    for img in images:
        try:
            if (
                img.deleted_at is not None
                and not filters.include_deleted
                and not filters.deleted_only
            ):
                continue
            response_images.append(to_data_instance_schema(img))
        except Exception as e:
            logger.warning("Error serializing image %s: %s", img.id, e)
    return response_images


async def list_project_images(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    user_email: str,
    filters: ImageListFilters,
    skip: int,
    limit: int,
) -> list[image_schemas.DataInstance]:
    """Return one offset page of project images through a per-user cache."""
    cache = cache_manager.get_cache()
    cache_key = cache_manager.project_images_key(
        project_id, user_email, skip=skip, limit=limit, **_cache_filters(filters)
    )
    cached_images = cache.get(cache_key)
    if cached_images is not None:
        return cached_images

    images = await _fetch_project_images(db, project_id, filters, skip, limit)
    if images and await image_metadata_service.repair_stale_single_frame_tiff_records(
        db, images
    ):
        cache_manager.invalidate_images(project_id, [image.id for image in images])
        images = await image_repository.get_data_instances_for_project(
            db=db,
            project_id=project_id,
            skip=skip,
            limit=limit,
            **filters.repository_kwargs(),
        )

    response_images = _serialize_listed_images(images or [], filters)
    cache.set(cache_key, response_images, expire=PROJECT_IMAGES_CACHE_SECONDS)
    return response_images


def _cache_filters(filters: ImageListFilters) -> dict[str, Any]:
    return {
        "include_deleted": filters.include_deleted,
        "deleted_only": filters.deleted_only,
        "search_field": filters.search_field,
        "search_value": filters.search_value,
        "group_id": filters.group_id,
        "ungrouped": filters.ungrouped,
    }


async def _fetch_image_page(
    db: AsyncSession,
    project_id: uuid.UUID,
    filters: ImageListFilters,
    limit: int,
    cursor: tuple[datetime | None, uuid.UUID | None],
) -> tuple[list[models.DataInstance], int]:
    raw_items, total = await image_repository.get_data_instance_page(
        db,
        project_id=project_id,
        limit=limit,
        cursor_created_at=cursor[0],
        cursor_id=cursor[1],
        deleted_only=filters.deleted_only,
        **filters.repository_kwargs(),
    )
    return list(raw_items), total


async def list_project_image_page(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    filters: ImageListFilters,
    limit: int,
    cursor: str | None,
) -> image_schemas.DataInstancePage:
    """Return an exact-count, stable keyset page of project images."""
    decoded_cursor = image_pagination_service.parse_optional_image_page_cursor(cursor)
    started = time.perf_counter()
    raw_items, total = await _fetch_image_page(
        db, project_id, filters, limit, decoded_cursor
    )
    page_items = raw_items[:limit]
    if page_items and (
        await image_metadata_service.repair_stale_single_frame_tiff_records(
            db, page_items
        )
    ):
        cache_manager.invalidate_images(project_id, [image.id for image in page_items])
        raw_items, total = await _fetch_image_page(
            db, project_id, filters, limit, decoded_cursor
        )
        page_items = raw_items[:limit]
    has_more = len(raw_items) > limit
    next_cursor = None
    if has_more and page_items:
        last_item = page_items[-1]
        next_cursor = image_pagination_service.encode_image_page_cursor(
            last_item.created_at, last_item.id
        )
    logger.info(
        "PROJECT_IMAGES_PAGE",
        extra={
            "project_id": str(project_id),
            "returned": len(page_items),
            "total": total,
            "has_more": has_more,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
        },
    )
    return image_schemas.DataInstancePage(
        items=[to_data_instance_schema(item) for item in page_items],
        total=total,
        next_cursor=next_cursor,
        has_more=has_more,
    )


async def get_image_record(
    db: AsyncSession, *, db_image: models.DataInstance, user_email: str
) -> image_schemas.DataInstance:
    """Serialize one authorized image record through a per-user cache."""
    cache = cache_manager.get_cache()
    cache_key = cache_manager.image_metadata_key(db_image.id, user_email)
    cached_metadata = cache.get(cache_key)
    if cached_metadata is not None:
        return cached_metadata

    if str(db_image.filename or "").lower().endswith((".tif", ".tiff")):
        repaired_metadata = image_metadata_service.repaired_single_frame_tiff_metadata(
            (db_image.metadata_json if isinstance(db_image.metadata_json, dict) else {})
        )
        if repaired_metadata is not None:
            return await image_metadata_service.persist_image_metadata(
                db=db,
                db_image=db_image,
                image_id=db_image.id,
                project_id=db_image.project_id,
                metadata=repaired_metadata,
            )

    result = to_data_instance_schema(db_image)
    cache.set(cache_key, result, expire=IMAGE_METADATA_CACHE_SECONDS)
    return result
