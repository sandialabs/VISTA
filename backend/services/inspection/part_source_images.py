"""Part ``source_images`` map maintenance and locked source-record mutation."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from repositories import images as image_repository
from repositories import inspection as inspection_repository
from services.errors import NotFoundError, UnprocessableError
from services.inspection import parts as inspection_part_service
from utils.metadata_values import parse_metadata_boolean

PART_IMAGE_MAP_METADATA_KEYS = (
    "source_images",
    "configured_views",
    "modalities",
    "view_images",
    "overlay_images",
)


def _normalized_source_record(record: dict) -> dict | None:
    filename = str(record.get("filename") or "").strip()
    if not filename:
        return None
    return {
        **record,
        "filename": filename,
        "side": str(record.get("side") or "").strip().lower(),
        "modality": str(record.get("modality") or "").strip().lower(),
        "overlay": parse_metadata_boolean(record.get("overlay")),
    }


def rebuild_part_image_maps(metadata: dict) -> dict:
    """Recompute view/overlay maps derived from a part's ``source_images``."""
    source_images = metadata.get("source_images")
    if not isinstance(source_images, list):
        source_images = []
    configured_views: set[str] = set()
    modalities: set[str] = set()
    view_images: dict[str, str] = {}
    overlay_images: dict[str, dict[str, str]] = {}
    normalized_source_images: list[dict] = []

    for record in source_images:
        if not isinstance(record, dict):
            continue
        normalized = _normalized_source_record(record)
        if normalized is None:
            continue
        normalized_source_images.append(normalized)
        side, modality = normalized["side"], normalized["modality"]
        filename, overlay = normalized["filename"], normalized["overlay"]
        if side:
            configured_views.add(side)
        if modality:
            modalities.add(modality)
        if side and overlay and modality:
            overlay_images.setdefault(side, {})[modality] = filename
        elif side and not overlay and side not in view_images:
            view_images[side] = filename

    return {
        **metadata,
        "source_images": normalized_source_images,
        "configured_views": sorted(configured_views),
        "modalities": sorted(modalities),
        "view_images": view_images,
        "overlay_images": overlay_images,
    }


def part_image_map_metadata_patch(metadata: dict) -> dict:
    """Return only fields derived from source_images for a locked metadata merge.

    Assignment routes discover source records from a project-wide snapshot. A
    concurrent annotation save can commit after that snapshot but before the
    assignment writes. Replaying the entire snapshot here would overwrite the
    fresh annotations (and any other unrelated metadata), even though the CRUD
    helper reloads the row under a lock. Keeping this patch key-scoped lets the
    locked merge retain the authoritative non-image fields.
    """
    normalized = rebuild_part_image_maps(metadata)
    return {key: normalized[key] for key in PART_IMAGE_MAP_METADATA_KEYS}


async def mutate_part_source_images_locked(
    *,
    db,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    transform: Callable[[list], tuple[list, Any]],
    updated_by: str,
):
    """Transform source_images from the authoritative row-lock snapshot."""

    def mutate_metadata(metadata: dict) -> tuple[dict, Any]:
        source_images = metadata.get("source_images")
        current_source_images = (
            list(source_images) if isinstance(source_images, list) else []
        )
        transformed_source_images, mutation_result = transform(current_source_images)
        if transformed_source_images == current_source_images:
            return {}, mutation_result
        return (
            part_image_map_metadata_patch(
                {**metadata, "source_images": transformed_source_images}
            ),
            mutation_result,
        )

    return await inspection_repository.mutate_inspection_part_metadata_locked(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_mutator=mutate_metadata,
        updated_by=updated_by,
    )


async def get_active_project_image_by_filename(
    *,
    db,
    project_id: uuid.UUID,
    filename: str,
    image_id_field: str = "image_id",
):
    """Return the single active image with ``filename``; reject ambiguity."""
    matches = await image_repository.list_active_project_images_by_filename(
        db=db, project_id=project_id, filename=filename, limit=2
    )
    if len(matches) > 1:
        raise UnprocessableError(
            f"Multiple active images share filename {filename!r}; "
            f"provide {image_id_field}."
        )
    return matches[0] if matches else None


def part_source_images(part) -> list | None:
    """Return a part's ``source_images`` list, or None when absent/invalid."""
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    source_images = metadata.get("source_images")
    return source_images if isinstance(source_images, list) else None


PART_SOURCE_IMAGE_COLLECTION_KEYS = ("source_images", "analysis_outputs")
PART_SOURCE_IMAGE_PATCH_KEYS = (
    "source_images",
    "analysis_outputs",
    "configured_views",
    "modalities",
    "view_images",
    "overlay_images",
)


def _part_image_collections(metadata: dict) -> dict[str, list]:
    collections: dict[str, list] = {}
    for collection_key in PART_SOURCE_IMAGE_COLLECTION_KEYS:
        records = metadata.get(collection_key)
        if isinstance(records, list):
            collections[collection_key] = records
    return collections


def _matching_record_positions(
    collections: dict[str, list], field: str, target_ref: str
) -> list[tuple[str, int]]:
    return [
        (collection_key, index)
        for collection_key, records in collections.items()
        for index, record in enumerate(records)
        if (
            isinstance(record, dict)
            and target_ref
            and str(record.get(field) or "").strip() == target_ref
        )
    ]


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (TypeError, ValueError, AttributeError):
        return False
    return True


def _resolve_targets_by_image_id(collections: dict[str, list], target_ref: str) -> bool:
    """Return True when ``target_ref`` matches image_ids, False for a filename.

    A UUID-shaped reference never falls back to filename matching, and a
    filename shared by several records is rejected as ambiguous.
    """
    if _matching_record_positions(collections, "image_id", target_ref):
        return True
    if _is_uuid(target_ref):
        raise NotFoundError("Source image not found")
    filename_matches = _matching_record_positions(collections, "filename", target_ref)
    if len(filename_matches) > 1:
        raise UnprocessableError(
            f"Multiple source image records share filename {target_ref!r}; "
            "use the exact image_id in the path."
        )
    if not filename_matches:
        raise NotFoundError("Source image not found")
    return False


def _apply_source_image_update(record: dict, payload) -> dict:
    next_record = dict(record)
    if payload.crop_subtitle is not None:
        next_record["crop_subtitle"] = payload.crop_subtitle.strip()
    if payload.hidden is not None:
        next_record["hidden"] = payload.hidden
    if payload.overlay_color is not None:
        next_record["overlay_color"] = payload.overlay_color.strip()
    if payload.overlay_opacity is not None:
        next_record["overlay_opacity"] = payload.overlay_opacity
    return next_record


def _updated_collections(
    collections: dict[str, list], target_ref: str, target_by_image_id: bool, payload
) -> dict[str, list]:
    match_field = "image_id" if target_by_image_id else "filename"
    updated_collections: dict[str, list] = {}
    for collection_key, records in collections.items():
        updated_collections[collection_key] = [
            _apply_source_image_update(record, payload)
            if isinstance(record, dict)
            and str(record.get(match_field) or "").strip() == target_ref
            else record
            for record in records
        ]
    return updated_collections


def _source_image_metadata_patch(
    metadata: dict, updated_collections: dict[str, list]
) -> dict:
    """Key-scoped patch of the updated collections plus rebuilt image maps."""
    updated_metadata = {**metadata, **updated_collections}
    rebuilds_maps = "source_images" in updated_collections
    normalized = (
        rebuild_part_image_maps(updated_metadata) if rebuilds_maps else updated_metadata
    )
    return {
        key: normalized[key]
        for key in PART_SOURCE_IMAGE_PATCH_KEYS
        if key in updated_collections
        or (rebuilds_maps and key in normalized and key != "analysis_outputs")
    }


async def update_part_source_image(
    *,
    db,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    image_ref: str,
    payload,
    user_email: str,
):
    """Update display fields of one part source/analysis image record."""
    part = await inspection_repository.get_inspection_part_for_update(
        db=db,
        project_id=project_id,
        part_id=part_id,
    )
    if not part:
        raise NotFoundError("Inspection part not found")
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    target_ref = str(image_ref or "").strip()
    collections = _part_image_collections(metadata)
    target_by_image_id = _resolve_targets_by_image_id(collections, target_ref)
    updated_collections = _updated_collections(
        collections, target_ref, target_by_image_id, payload
    )
    updated = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch=_source_image_metadata_patch(metadata, updated_collections),
        updated_by=user_email,
    )
    if not updated:
        raise NotFoundError("Inspection part not found")
    return inspection_part_service.serialize_inspection_part(updated)
