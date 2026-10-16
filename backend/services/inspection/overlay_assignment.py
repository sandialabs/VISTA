"""Assign an overlay image to a base image's inspection part."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from repositories import images as image_repository
from repositories import inspection as inspection_repository
from schemas import inspection_parts as inspection_part_schemas
from services.errors import NotFoundError, ValidationFailedError
from services.inspection import part_images as inspection_part_image_service
from services.inspection import part_source_images
from utils.metadata_values import parse_metadata_boolean


@dataclass
class _OverlayTarget:
    overlay_image: object
    overlay_filename: str
    overlay_image_id: uuid.UUID | None
    base_image: object | None
    base_filename: str | None
    base_image_id: uuid.UUID | None


def _matches(record, *, filename, image_id) -> bool:
    return inspection_part_image_service.record_matches_image_identity(
        record, filename=filename, image_id=image_id
    )


def _is_base_record(record, *, filename, image_id) -> bool:
    return _matches(record, filename=filename, image_id=image_id) and (
        not parse_metadata_boolean(record.get("overlay"))
    )


def _part_has_image(part, *, filename, image_id) -> bool:
    source_images = part_source_images.part_source_images(part)
    return source_images is not None and any(
        _matches(record, filename=filename, image_id=image_id)
        for record in source_images
    )


async def _resolve_image(*, db, project_id, image_id, filename, image_id_field):
    if image_id:
        return await image_repository.get_active_project_image(
            db=db, project_id=project_id, image_id=image_id
        )
    if not filename:
        return None
    return await part_source_images.get_active_project_image_by_filename(
        db=db, project_id=project_id, filename=filename, image_id_field=image_id_field
    )


async def _resolve_target(*, db, project_id, payload) -> _OverlayTarget:
    base_filename = payload.base_filename.strip() if payload.base_filename else None
    base_filename = base_filename or None
    overlay_image = await _resolve_image(
        db=db,
        project_id=project_id,
        image_id=payload.overlay_image_id,
        filename=payload.overlay_filename.strip(),
        image_id_field="overlay_image_id",
    )
    if not overlay_image:
        raise NotFoundError("Overlay image not found")
    base_image = await _resolve_image(
        db=db,
        project_id=project_id,
        image_id=payload.base_image_id,
        filename=base_filename,
        image_id_field="base_image_id",
    )
    if (payload.base_image_id or base_filename) and not base_image:
        raise NotFoundError("Base image not found")
    if base_image is not None:
        base_filename = base_image.filename
        if base_image.id == overlay_image.id:
            raise ValidationFailedError("Overlay image cannot be assigned to itself")
    return _OverlayTarget(
        overlay_image=overlay_image,
        overlay_filename=overlay_image.filename,
        overlay_image_id=payload.overlay_image_id,
        base_image=base_image,
        base_filename=base_filename,
        base_image_id=payload.base_image_id,
    )


async def _discover_current_overlay(*, db, project_id, target, all_parts, user_email):
    """Find the overlay record under each holder's row lock, without mutating.

    When a base is requested, the target/base relationship must be revalidated
    under its row lock before the overlay is detached from another part.
    """
    identity = {
        "filename": target.overlay_filename,
        "image_id": target.overlay_image_id,
    }

    def find_overlay(fresh_records):
        found = next((r for r in fresh_records if _matches(r, **identity)), None)
        return fresh_records, found

    overlay_entry, from_part_id = None, None
    for part in all_parts:
        if not _part_has_image(part, **identity):
            continue
        _, fresh_entry = await part_source_images.mutate_part_source_images_locked(
            db=db,
            project_id=project_id,
            part_id=part.id,
            transform=find_overlay,
            updated_by=user_email,
        )
        if fresh_entry is not None:
            overlay_entry, from_part_id = fresh_entry, part.id
    return overlay_entry, from_part_id


def _refreshed_overlay_entry(overlay_entry, overlay_image) -> dict:
    refreshed = inspection_part_image_service.refresh_assigned_source_image_record(
        overlay_entry,
        inspection_part_image_service.metadata_for_overlay_assignment(overlay_image),
    )
    return {**refreshed, "overlay": True}


def _find_base_part(all_parts, target):
    for part in all_parts:
        source_images = part_source_images.part_source_images(part)
        if source_images is None:
            continue
        if any(
            _is_base_record(
                record, filename=target.base_filename, image_id=target.base_image_id
            )
            for record in source_images
        ):
            return part
    raise NotFoundError("Base image is not assigned to an inspection part")


def _attached_overlay_record(overlay_entry, base_entry, target) -> dict:
    side = str(base_entry.get("side") or overlay_entry.get("side") or "")
    modality = str(overlay_entry.get("modality") or "overlay").strip().lower()
    return {
        **overlay_entry,
        "overlay": True,
        "side": side.strip().lower(),
        "modality": modality or "overlay",
        "overlay_base_filename": target.base_filename,
        "overlay_base_image_id": str(
            base_entry.get("image_id") or target.base_image.id
        ),
    }


def _attach_transform(overlay_entry, target):
    def attach(fresh_records):
        base_entry = next(
            (
                record
                for record in fresh_records
                if _is_base_record(
                    record, filename=target.base_filename, image_id=target.base_image_id
                )
            ),
            None,
        )
        if base_entry is None:
            return fresh_records, None
        attached = _attached_overlay_record(overlay_entry, base_entry, target)
        records = inspection_part_image_service.replace_source_image_record(
            fresh_records,
            entry=attached,
            filename=target.overlay_filename,
            image_id=target.overlay_image_id,
        )
        return records, attached

    return attach


async def _attach_to_base_part(
    *, db, project_id, target, target_part, overlay_entry, user_email
):
    persisted, attached = await part_source_images.mutate_part_source_images_locked(
        db=db,
        project_id=project_id,
        part_id=target_part.id,
        transform=_attach_transform(overlay_entry, target),
        updated_by=user_email,
    )
    if not persisted:
        raise NotFoundError("Target part not found")
    if attached is None:
        raise NotFoundError("Base image is no longer assigned to the inspection part")
    return attached


async def _detach_from_parts(*, db, project_id, target, parts, user_email):
    """Remove stale overlay copies; return the first part that held one."""
    identity = {
        "filename": target.overlay_filename,
        "image_id": target.overlay_image_id,
    }
    first_removed_from = None
    for part in parts:
        if not _part_has_image(part, **identity):
            continue
        _, removed = await part_source_images.mutate_part_source_images_locked(
            db=db,
            project_id=project_id,
            part_id=part.id,
            transform=lambda fresh_records: (
                inspection_part_image_service.remove_source_image_records(
                    fresh_records,
                    **identity,
                    fallback_image_id=target.overlay_image.id,
                )
            ),
            updated_by=user_email,
        )
        if removed is not None and first_removed_from is None:
            first_removed_from = part.id
    return first_removed_from


async def assign_overlay_to_base_image(
    *, db, project_id: uuid.UUID, payload, user_email: str
) -> inspection_part_schemas.InspectionOverlayAssignmentResponse:
    """Attach an overlay to its base image's part, then detach stale copies.

    Attaching first means that if the base disappears between discovery and
    the locked mutation, the request fails without detaching the user's
    existing overlay.
    """
    target = await _resolve_target(db=db, project_id=project_id, payload=payload)
    all_parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    overlay_entry, from_part_id = await _discover_current_overlay(
        db=db,
        project_id=project_id,
        target=target,
        all_parts=all_parts,
        user_email=user_email,
    )
    overlay_entry = _refreshed_overlay_entry(overlay_entry, target.overlay_image)
    target_part, removal_parts = None, all_parts
    if target.base_image is not None:
        target_part = _find_base_part(all_parts, target)
        await _attach_to_base_part(
            db=db,
            project_id=project_id,
            target=target,
            target_part=target_part,
            overlay_entry=overlay_entry,
            user_email=user_email,
        )
        removal_parts = [p for p in all_parts if str(p.id) != str(target_part.id)]
    removed_from = await _detach_from_parts(
        db=db,
        project_id=project_id,
        target=target,
        parts=removal_parts,
        user_email=user_email,
    )
    return inspection_part_schemas.InspectionOverlayAssignmentResponse(
        project_id=project_id,
        overlay_filename=target.overlay_filename,
        base_filename=target.base_filename,
        from_part_id=from_part_id if from_part_id is not None else removed_from,
        to_part_id=target_part.id if target_part else None,
    )
