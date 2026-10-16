"""Analyze overlay metadata helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories import inspection as inspection_repository
from schemas.analyze import AnalyzeDeletedOverlayRecord
from services.errors import NotFoundError, ValidationFailedError


class AnalyzeOverlayNotFoundError(NotFoundError, ValueError):
    """Raised when an Analyze overlay cannot be found in part metadata."""


class OriginalProjectImageDeletionError(ValidationFailedError, ValueError):
    """Raised when a deletion request targets an original project image."""


def parse_datetime(value: Any) -> datetime | None:
    """Parse an ISO datetime string and ensure timezone awareness."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def overlay_record_image_id(record: dict[str, Any]) -> str:
    """Return the normalized image identifier for an overlay metadata record."""
    return str(record.get("image_id") or "").strip()


def record_identity(record: dict[str, Any]) -> str:
    """Return the stable identity for a metadata record."""
    return overlay_record_image_id(record) or str(record.get("filename") or "").strip()


def is_analyze_output_record(record: dict[str, Any]) -> bool:
    """Return whether a metadata record represents Analyze-generated output."""
    modality = str(record.get("modality") or "").strip().lower()
    return bool(
        record.get("analysis_output")
        or record.get("analysis_source_image_id")
        or record.get("overlay_base_image_id")
        or modality == "analyze-overlay"
    )


def append_unique_records(
    existing: list[dict[str, Any]], additions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Append records, merging by image or filename identity when present."""
    merged = list(existing)
    index_by_identity = {
        record_identity(record): index
        for index, record in enumerate(merged)
        if isinstance(record, dict) and record_identity(record)
    }
    for record in additions:
        if not isinstance(record, dict):
            continue
        identity = record_identity(record)
        if identity and identity in index_by_identity:
            existing_index = index_by_identity[identity]
            merged[existing_index] = {**merged[existing_index], **record}
            continue
        if identity:
            index_by_identity[identity] = len(merged)
        merged.append(record)
    return merged


def split_source_and_analysis_records(
    metadata: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Separate original source images from Analyze output records."""
    source_records = metadata.get("source_images")
    source_records = source_records if isinstance(source_records, list) else []
    analysis_records = metadata.get("analysis_outputs")
    analysis_records = analysis_records if isinstance(analysis_records, list) else []
    clean_sources: list[dict[str, Any]] = []
    moved_analysis: list[dict[str, Any]] = []
    for record in source_records:
        if not isinstance(record, dict):
            continue
        if is_analyze_output_record(record):
            moved_analysis.append(record)
        else:
            clean_sources.append(record)
    return clean_sources, append_unique_records(
        [record for record in analysis_records if isinstance(record, dict)],
        moved_analysis,
    )


def is_overlay_delete_candidate(record: dict[str, Any]) -> bool:
    """Return whether a record is pending overlay hard deletion."""
    return bool(
        record.get("overlay_delete_candidate") or record.get("delete_candidate")
    )


def is_expired_overlay_delete_candidate(record: dict[str, Any], now: datetime) -> bool:
    """Return whether an overlay delete candidate reached its retention cutoff."""
    if not is_overlay_delete_candidate(record):
        return False
    pending_at = parse_datetime(
        record.get("pending_hard_delete_at") or record.get("overlay_delete_after")
    )
    return bool(pending_at and pending_at <= now)


def artifact_source_image_identity(
    artifact: dict[str, Any],
    node_summary: dict[str, Any],
) -> str:
    """Return the source image identity for an Analyze artifact."""
    metadata = (
        artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}
    )
    for candidate in (
        node_summary.get("image_id"),
        artifact.get("source_image_id"),
        artifact.get("analysis_source_image_id"),
        artifact.get("overlay_base_image_id"),
        metadata.get("source_image_id"),
        metadata.get("analysis_source_image_id"),
        metadata.get("overlay_base_image_id"),
    ):
        identity = str(candidate or "").strip()
        if identity:
            return identity
    return ""


def without_overlay_delete_fields(record: dict[str, Any]) -> dict[str, Any]:
    """Remove transient overlay deletion fields from a metadata record."""
    cleaned = dict(record)
    for field_name in (
        "overlay_delete_candidate",
        "delete_candidate",
        "overlay_deleted_at",
        "deleted_at",
        "pending_hard_delete_at",
        "overlay_delete_after",
        "overlay_deleted_by",
        "deleted_by",
    ):
        cleaned.pop(field_name, None)
    return cleaned


def rebuild_analyze_part_image_maps(metadata: dict) -> dict:
    """Rebuild view and overlay image maps from source and analysis records."""
    source_images, analysis_outputs = split_source_and_analysis_records(metadata)
    view_images: dict[str, str] = {}
    overlay_images: dict[str, dict[str, str]] = {}
    for record in source_images:
        if not isinstance(record, dict):
            continue
        if is_overlay_delete_candidate(record):
            continue
        filename = str(record.get("filename") or "").strip()
        if not filename:
            continue
        side = str(record.get("side") or "").strip().lower()
        modality = str(record.get("modality") or "").strip().lower() or "image"
        if record.get("overlay"):
            overlay_images.setdefault(side or "analyze", {})[modality] = filename
        elif side and side not in view_images:
            view_images[side] = filename
    for record in analysis_outputs:
        if not isinstance(record, dict):
            continue
        if is_overlay_delete_candidate(record):
            continue
        filename = str(record.get("filename") or "").strip()
        if not filename:
            continue
        side = str(record.get("side") or "").strip().lower() or "analyze"
        modality = (
            str(record.get("modality") or "").strip().lower() or "analyze-overlay"
        )
        overlay_images.setdefault(side, {})[modality] = filename
    return {
        **metadata,
        "source_images": source_images,
        "analysis_outputs": analysis_outputs,
        "view_images": view_images,
        "overlay_images": overlay_images,
    }


def rebuild_deleted_overlay_safe_image_maps(metadata: dict) -> dict:
    """Rebuild image maps while excluding deleted Analyze overlay records."""
    return rebuild_analyze_part_image_maps(metadata)


def mark_overlay_deleted_in_metadata(
    metadata: dict[str, Any],
    overlay_image_id: str,
    *,
    now: datetime,
    actor_email: str,
    retention_hours: int,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Mark an Analyze overlay record deleted in part metadata."""
    pending_at = now + timedelta(hours=retention_hours)
    deleted_fields = {
        "overlay_delete_candidate": True,
        "delete_candidate": True,
        "overlay_deleted_at": now.isoformat(),
        "deleted_at": now.isoformat(),
        "pending_hard_delete_at": pending_at.isoformat(),
        "overlay_delete_after": pending_at.isoformat(),
        "overlay_deleted_by": actor_email,
        "deleted_by": actor_email,
    }
    found_record: dict[str, Any] | None = None

    def mark_records(records: Any) -> list[Any]:
        nonlocal found_record
        if not isinstance(records, list):
            return []
        next_records = []
        for record in records:
            if not isinstance(record, dict):
                next_records.append(record)
                continue
            if overlay_record_image_id(record) == overlay_image_id:
                marked = {**record, **deleted_fields}
                found_record = found_record or marked
                next_records.append(marked)
            else:
                next_records.append(record)
        return next_records

    source_images, analysis_outputs = split_source_and_analysis_records(metadata)
    next_metadata = {
        **metadata,
        "source_images": mark_records(source_images),
        "analysis_outputs": mark_records(analysis_outputs),
        "overlay_layers": mark_records(metadata.get("overlay_layers")),
    }
    if found_record is None:
        return metadata, None
    return rebuild_deleted_overlay_safe_image_maps(next_metadata), found_record


def restore_overlay_in_metadata(
    metadata: dict[str, Any], overlay_image_id: str
) -> tuple[dict[str, Any], bool]:
    """Restore a soft-deleted Analyze overlay in part metadata."""
    restored = False

    def restore_records(records: Any) -> list[Any]:
        nonlocal restored
        if not isinstance(records, list):
            return []
        next_records = []
        for record in records:
            if not isinstance(record, dict):
                next_records.append(record)
                continue
            if overlay_record_image_id(record) == overlay_image_id:
                restored = True
                next_records.append(without_overlay_delete_fields(record))
            else:
                next_records.append(record)
        return next_records

    source_images, analysis_outputs = split_source_and_analysis_records(metadata)
    next_metadata = {
        **metadata,
        "source_images": restore_records(source_images),
        "analysis_outputs": restore_records(analysis_outputs),
        "overlay_layers": restore_records(metadata.get("overlay_layers")),
    }
    return rebuild_deleted_overlay_safe_image_maps(next_metadata), restored


def record_is_deletable_analyze_overlay(record: dict[str, Any]) -> bool:
    """Return whether a metadata record represents a deletable Analyze overlay."""
    return bool(
        record.get("overlay")
        or record.get("analysis_output")
        or record.get("analysis_output_kind") == "overlay_image"
    )


def is_original_project_image(metadata: dict[str, Any], image_id: str) -> bool:
    """Return whether an image id points at an original project image."""
    records = metadata.get("source_images")
    if not isinstance(records, list):
        return False
    for record in records:
        if not isinstance(record, dict):
            continue
        if overlay_record_image_id(record) != image_id:
            continue
        if not record_is_deletable_analyze_overlay(record):
            return True
    return False


def purge_expired_deleted_overlays_from_metadata(
    metadata: dict[str, Any],
    *,
    now: datetime,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Remove deleted overlay metadata records after their retention cutoff."""
    source_images, analysis_outputs = split_source_and_analysis_records(metadata)
    expired_ids = set()
    purged_records: list[dict[str, Any]] = []
    for records in (source_images, analysis_outputs, metadata.get("overlay_layers")):
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            image_id = overlay_record_image_id(record)
            if image_id and is_expired_overlay_delete_candidate(record, now):
                expired_ids.add(image_id)

    if not expired_ids:
        return metadata, []

    def keep_unexpired(records: Any) -> list[Any]:
        if not isinstance(records, list):
            return []
        next_records = []
        for record in records:
            if (
                isinstance(record, dict)
                and overlay_record_image_id(record) in expired_ids
            ):
                purged_records.append(record)
                continue
            next_records.append(record)
        return next_records

    next_metadata = {
        **metadata,
        "source_images": keep_unexpired(source_images),
        "analysis_outputs": keep_unexpired(analysis_outputs),
        "overlay_layers": keep_unexpired(metadata.get("overlay_layers")),
    }
    return rebuild_deleted_overlay_safe_image_maps(next_metadata), purged_records


async def purge_expired_deleted_overlays(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    actor_email: str,
    now: datetime | None = None,
) -> int:
    """Purge expired soft-deleted Analyze overlay records from part metadata."""
    now = now or datetime.now(UTC)
    purged_count = 0
    parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    for part in parts:
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        next_metadata, purged_records = purge_expired_deleted_overlays_from_metadata(
            metadata, now=now
        )
        if not purged_records:
            continue
        purged_count += len(
            {
                overlay_record_image_id(record)
                for record in purged_records
                if isinstance(record, dict) and overlay_record_image_id(record)
            }
        )
        await inspection_repository.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part.id,
            metadata_patch=next_metadata,
            updated_by=actor_email,
        )
    return purged_count


def deleted_overlay_records_for_part(
    *,
    project_id: uuid.UUID,
    part: models.InspectionPart,
) -> list[AnalyzeDeletedOverlayRecord]:
    """Return recently deleted Analyze overlay records from an inspection part."""
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    _source_images, records = split_source_and_analysis_records(metadata)
    deleted: list[AnalyzeDeletedOverlayRecord] = []
    seen = set()
    for record in records:
        if not isinstance(record, dict) or not is_overlay_delete_candidate(record):
            continue
        image_id_raw = overlay_record_image_id(record)
        if not image_id_raw or image_id_raw in seen:
            continue
        seen.add(image_id_raw)
        deleted_at = str(
            record.get("deleted_at") or record.get("overlay_deleted_at") or ""
        )
        pending_at = str(
            record.get("pending_hard_delete_at")
            or record.get("overlay_delete_after")
            or ""
        )
        image_id = None
        try:
            image_id = uuid.UUID(image_id_raw)
        except ValueError:
            image_id = None
        deleted.append(
            AnalyzeDeletedOverlayRecord(
                project_id=project_id,
                part_id=part.id,
                part_serial_number=part.serial_number,
                part_display_name=part.display_name,
                image_id=image_id,
                filename=str(record.get("filename") or ""),
                label=str(record.get("label") or "Analyze Overlay"),
                deleted_at=deleted_at,
                pending_hard_delete_at=pending_at,
                deleted_by=record.get("deleted_by") or record.get("overlay_deleted_by"),
                source_image_id=record.get("analysis_source_image_id")
                or record.get("overlay_base_image_id"),
                source_filename=record.get("analysis_source_filename")
                or record.get("overlay_base_filename"),
            )
        )
    return deleted


async def list_recently_deleted_overlays(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    actor_email: str,
) -> list[AnalyzeDeletedOverlayRecord]:
    """Purge expired records, then list remaining recently deleted overlays."""
    await purge_expired_deleted_overlays(
        db=db, project_id=project_id, actor_email=actor_email
    )
    parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    deleted_records: list[AnalyzeDeletedOverlayRecord] = []
    for part in parts:
        deleted_records.extend(
            deleted_overlay_records_for_part(project_id=project_id, part=part)
        )
    return sorted(deleted_records, key=lambda record: record.deleted_at, reverse=True)


async def delete_analyze_overlay(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    overlay_image_id: str,
    actor_email: str,
    retention_hours: int,
) -> models.InspectionPart:
    """Soft-delete an Analyze overlay record from part metadata."""
    await purge_expired_deleted_overlays(
        db=db, project_id=project_id, actor_email=actor_email
    )
    parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    overlay_id = str(overlay_image_id).strip()
    now = datetime.now(UTC)
    for part in parts:
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        if is_original_project_image(metadata, overlay_id):
            raise OriginalProjectImageDeletionError(
                "Cannot delete original project image. Move the image out of the "
                "part if you do not want to view it."
            )
        next_metadata, deleted_record = mark_overlay_deleted_in_metadata(
            metadata,
            overlay_id,
            now=now,
            actor_email=actor_email,
            retention_hours=retention_hours,
        )
        if deleted_record is None:
            continue
        return await inspection_repository.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part.id,
            metadata_patch=next_metadata,
            updated_by=actor_email,
        )
    raise AnalyzeOverlayNotFoundError("Analyze overlay not found")


async def restore_analyze_overlay(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    overlay_image_id: str,
    actor_email: str,
) -> models.InspectionPart:
    """Restore a soft-deleted Analyze overlay record in part metadata."""
    parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    overlay_id = str(overlay_image_id).strip()
    for part in parts:
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        next_metadata, restored = restore_overlay_in_metadata(metadata, overlay_id)
        if not restored:
            continue
        return await inspection_repository.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part.id,
            metadata_patch=next_metadata,
            updated_by=actor_email,
        )
    raise AnalyzeOverlayNotFoundError("Recently deleted Analyze overlay not found")
