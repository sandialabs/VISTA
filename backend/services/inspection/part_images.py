"""Inspection part image metadata and matching helpers."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from repositories import images as image_repository
from repositories import inspection as inspection_repository
from schemas import inspection_parts as inspection_part_schemas
from services.errors import NotFoundError
from services.inspection import part_source_images
from utils.metadata_values import parse_metadata_boolean

ASSIGNED_SOURCE_IMAGE_METADATA_FIELDS = (
    "load_mode",
    "tiff_dimensionality",
    "frame_count",
    "volume_shape",
    "pixel_dtype",
    "voxel_dtype",
    "bit_depth",
    "bits_per_sample",
    "pixel_value_range",
    "data_value_range",
    "voxel_value_range",
    "scalar_range",
    "value_range",
    "intensity_range",
    "display_range",
    "signed",
    "channel_count",
    "color_mode",
)

ASSIGNED_SOURCE_IMAGE_RECORD_FIELDS = (
    "filename",
    "image_id",
    "side",
    "modality",
    "overlay",
    "content_type",
    "slice_axis",
    "slice_index",
    *ASSIGNED_SOURCE_IMAGE_METADATA_FIELDS,
)


def record_matches_filename(record: object, filename: str) -> bool:
    """Return whether a metadata record has the requested filename."""
    return (
        isinstance(record, dict)
        and str(record.get("filename") or "").strip() == filename
    )


def record_matches_image_identity(
    record: object, *, filename: str = "", image_id: uuid.UUID | str | None = None
) -> bool:
    """Return whether a record matches an image by id when available, else filename."""
    if not isinstance(record, dict):
        return False
    if image_id and str(record.get("image_id") or "").strip() == str(image_id):
        return True
    if image_id:
        return False
    return str(record.get("filename") or "").strip() == filename


def remove_source_image_records(
    source_images: list,
    *,
    filename: str,
    image_id: uuid.UUID | str | None,
    fallback_image_id: uuid.UUID | str | None = None,
) -> tuple[list, dict | None]:
    """Remove source-image records matching a filename/id identity."""
    retained = []
    removed_entry = None
    for record in source_images:
        if record_matches_image_identity(record, filename=filename, image_id=image_id):
            removed_entry = {
                **record,
                "filename": str(record.get("filename") or filename).strip(),
                "image_id": record.get("image_id")
                or (str(fallback_image_id) if fallback_image_id else None),
            }
            continue
        retained.append(record)
    return retained, removed_entry


def replace_source_image_record(
    source_images: list,
    *,
    entry: dict,
    filename: str,
    image_id: uuid.UUID | str | None,
) -> list:
    """Replace records matching a filename/id identity with a new entry."""
    retained = [
        record
        for record in source_images
        if not record_matches_image_identity(
            record,
            filename=filename,
            image_id=image_id,
        )
    ]
    return [*retained, dict(entry)]


def assigned_source_image_metadata(image_metadata: dict) -> dict:
    """Keep persisted volume/layout fields self-contained on part assignments."""
    copied = {
        key: image_metadata[key]
        for key in ASSIGNED_SOURCE_IMAGE_METADATA_FIELDS
        if key in image_metadata
    }
    if not copied:
        return {}
    return {**copied, "metadata": dict(copied)}


def metadata_for_overlay_assignment(image: Any) -> dict:
    """Build metadata for assigning an overlay image to an inspection part."""
    image_metadata = (
        image.metadata_json if isinstance(image.metadata_json, dict) else {}
    )
    return {
        "filename": image.filename,
        "image_id": str(image.id),
        "side": str(image_metadata.get("side") or "").strip().lower(),
        "modality": str(image_metadata.get("modality") or "overlay").strip().lower()
        or "overlay",
        "overlay": True,
        "content_type": image.content_type,
        "slice_axis": image_metadata.get("slice_axis"),
        "slice_index": image_metadata.get("slice_index"),
        **assigned_source_image_metadata(image_metadata),
    }


def metadata_for_source_assignment(image: Any) -> dict:
    """Build metadata for assigning a source image to an inspection part."""
    image_metadata = (
        image.metadata_json if isinstance(image.metadata_json, dict) else {}
    )
    entry = {
        "filename": image.filename,
        "image_id": str(image.id),
        "side": str(image_metadata.get("side") or "").strip().lower(),
        "modality": str(image_metadata.get("modality") or "").strip().lower(),
        "overlay": parse_metadata_boolean(image_metadata.get("overlay")),
        "content_type": image.content_type,
        "slice_axis": image_metadata.get("slice_axis"),
        "slice_index": image_metadata.get("slice_index"),
    }
    for metadata_key in (
        "crop_child_image",
        "parent_image_id",
        "parent_image_filename",
        "crop_annotation_id",
        "crop_title",
        "crop_subtitle",
        "crop_bbox",
    ):
        if metadata_key in image_metadata:
            entry[metadata_key] = image_metadata.get(metadata_key)
    entry.update(assigned_source_image_metadata(image_metadata))
    return entry


def refresh_assigned_source_image_record(
    existing: dict | None, authoritative: dict
) -> dict:
    """Refresh file metadata while retaining assignment and visibility state."""
    refreshed = dict(existing) if isinstance(existing, dict) else {}
    for key in ASSIGNED_SOURCE_IMAGE_RECORD_FIELDS:
        if key not in authoritative:
            refreshed.pop(key, None)
    refreshed.update(authoritative)

    existing_metadata = (
        existing.get("metadata")
        if isinstance(existing, dict) and isinstance(existing.get("metadata"), dict)
        else {}
    )
    authoritative_metadata = (
        authoritative.get("metadata")
        if isinstance(authoritative.get("metadata"), dict)
        else {}
    )
    merged_metadata = {
        key: value
        for key, value in existing_metadata.items()
        if key not in ASSIGNED_SOURCE_IMAGE_METADATA_FIELDS
    }
    merged_metadata.update(authoritative_metadata)
    if merged_metadata:
        refreshed["metadata"] = merged_metadata
    else:
        refreshed.pop("metadata", None)
    return refreshed


def safe_stack_filename(filename: object, index: int) -> str:
    """Return a safe materialized name from the authoritative image record."""
    raw_name = str(filename or f"slice-{index:04d}.png").strip()
    name = Path(raw_name).name or f"slice-{index:04d}.png"
    return f"{index:04d}-{name}"


async def _resolve_assignment_image(*, db, project_id: uuid.UUID, payload) -> Any:
    filename = payload.filename.strip()
    payload_image_id = payload.image_id
    if payload_image_id:
        image = await image_repository.get_active_project_image(
            db=db,
            project_id=project_id,
            image_id=payload_image_id,
        )
    else:
        image = await part_source_images.get_active_project_image_by_filename(
            db=db,
            project_id=project_id,
            filename=filename,
            image_id_field="image_id",
        )
    if not image:
        raise NotFoundError("Image not found")
    return image


async def _detach_source_image_from_parts(
    *,
    db,
    project_id: uuid.UUID,
    all_parts,
    filename: str,
    payload_image_id,
    user_email: str,
) -> tuple[dict | None, uuid.UUID | None]:
    """Remove the image's source-image record from any part that holds it."""
    source_entry = None
    from_part_id = None
    for part in all_parts:
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        source_records = metadata.get("source_images")
        if not isinstance(source_records, list):
            continue
        if not any(
            record_matches_image_identity(
                record,
                filename=filename,
                image_id=payload_image_id,
            )
            for record in source_records
        ):
            continue
        (
            _,
            removed_entry,
        ) = await part_source_images.mutate_part_source_images_locked(
            db=db,
            project_id=project_id,
            part_id=part.id,
            transform=lambda fresh_records: remove_source_image_records(
                fresh_records,
                filename=filename,
                image_id=payload_image_id,
                fallback_image_id=payload_image_id,
            ),
            updated_by=user_email,
        )
        if removed_entry is not None:
            source_entry = removed_entry
            from_part_id = part.id
    return source_entry, from_part_id


async def _attach_source_image_to_target(
    *,
    db,
    project_id: uuid.UUID,
    target_part,
    source_entry: dict,
    filename: str,
    payload_image_id,
    user_email: str,
) -> None:
    if not target_part:
        return
    persisted_target, _ = await part_source_images.mutate_part_source_images_locked(
        db=db,
        project_id=project_id,
        part_id=target_part.id,
        transform=lambda fresh_records: (
            replace_source_image_record(
                fresh_records,
                entry=source_entry,
                filename=filename,
                image_id=payload_image_id,
            ),
            source_entry,
        ),
        updated_by=user_email,
    )
    if not persisted_target:
        raise NotFoundError("Target part not found")


async def assign_image_to_part(
    *, db, project_id: uuid.UUID, payload, user_email: str
) -> inspection_part_schemas.InspectionPartImageAssignmentResponse:
    """Move an image's source-image record from its current part to another."""
    target_part = None
    if payload.to_part_id:
        target_part = await inspection_repository.get_inspection_part(
            db=db, project_id=project_id, part_id=payload.to_part_id
        )
        if not target_part:
            raise NotFoundError("Target part not found")

    all_parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    image = await _resolve_assignment_image(
        db=db, project_id=project_id, payload=payload
    )
    filename = image.filename
    payload_image_id = payload.image_id

    source_entry, from_part_id = await _detach_source_image_from_parts(
        db=db,
        project_id=project_id,
        all_parts=all_parts,
        filename=filename,
        payload_image_id=payload_image_id,
        user_email=user_email,
    )

    source_entry = refresh_assigned_source_image_record(
        source_entry,
        metadata_for_source_assignment(image),
    )

    await _attach_source_image_to_target(
        db=db,
        project_id=project_id,
        target_part=target_part,
        source_entry=source_entry,
        filename=filename,
        payload_image_id=payload_image_id,
        user_email=user_email,
    )

    return inspection_part_schemas.InspectionPartImageAssignmentResponse(
        project_id=project_id,
        filename=filename,
        from_part_id=from_part_id,
        to_part_id=payload.to_part_id,
    )
