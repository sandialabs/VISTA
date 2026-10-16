"""Project report payload builders for export endpoints."""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func as _func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from services.export import bundles as export_bundle_service


def normalize_part_report_status(review_state: object) -> str:
    """Map a part's raw review state to a report status of pass/reject/unreviewed."""
    state = str(review_state or "").strip().lower()
    if state == "pass":
        return "pass"
    if state in {"reject_pending", "reject_confirmed", "reject"}:
        return "reject"
    return "unreviewed"


async def build_legacy_project_report_payload(
    project_id: uuid.UUID,
    db: AsyncSession,
    db_project: models.Project,
) -> dict:
    """Preserve the report payload shipped before the concise schema."""

    async def count_rows(model, *criteria):
        result = await db.execute(
            select(_func.count()).select_from(model).where(*criteria)
        )
        return result.scalar_one()

    total_images = await count_rows(
        models.DataInstance,
        models.DataInstance.project_id == project_id,
        models.DataInstance.deleted_at.is_(None),
    )
    total_parts = await count_rows(
        models.InspectionPart,
        models.InspectionPart.project_id == project_id,
    )
    total_batches = await count_rows(
        models.InspectionBatch,
        models.InspectionBatch.project_id == project_id,
    )
    reviewed_states = ("pass", "reject_pending", "reject_confirmed")
    reviewed_parts = await count_rows(
        models.InspectionPart,
        models.InspectionPart.project_id == project_id,
        models.InspectionPart.review_state.in_(reviewed_states),
    )

    part_metadata_result = await db.execute(
        select(models.InspectionPart.metadata_json).where(
            models.InspectionPart.project_id == project_id
        )
    )
    metadata_drop_counts = {
        "annotations": 0,
        "overlay_layers": 0,
        "segmentation_runs": 0,
        "measurement_runs": 0,
    }
    for (metadata,) in part_metadata_result:
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        for key in metadata_drop_counts:
            _, dropped = export_bundle_service.normalize_metadata_dict_list(
                metadata_obj, key
            )
            metadata_drop_counts[key] += dropped

    part_rows_result = await db.execute(
        select(
            models.InspectionPart.id,
            models.InspectionPart.serial_number,
            models.InspectionPart.review_state,
            models.InspectionPart.updated_at,
            models.InspectionPart.metadata_json,
            models.InspectionBatch.owner,
        )
        .outerjoin(
            models.InspectionBatch,
            models.InspectionBatch.id == models.InspectionPart.batch_id,
        )
        .where(models.InspectionPart.project_id == project_id)
        .order_by(models.InspectionPart.serial_number.asc())
    )
    part_rows = part_rows_result.all()
    image_rows_result = await db.execute(
        select(
            models.DataInstance.id,
            models.DataInstance.filename,
            models.DataInstance.metadata_json,
        )
        .where(
            models.DataInstance.project_id == project_id,
            models.DataInstance.deleted_at.is_(None),
        )
        .order_by(models.DataInstance.created_at.asc())
    )

    image_part_map: dict[str, list[dict]] = defaultdict(list)
    for image_id, filename, metadata in image_rows_result.all():
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        raw_part_id = metadata_obj.get("part_id")
        if raw_part_id:
            image_part_map[str(raw_part_id)].append(
                {"image_id": str(image_id), "filename": filename or ""}
            )

    part_assignments = []
    part_review_summary = []
    image_part_mappings = []
    part_status_counts = {"pass": 0, "reject": 0, "unreviewed": 0}
    for (
        part_id,
        serial_number,
        review_state,
        updated_at,
        metadata,
        batch_owner,
    ) in part_rows:
        report_status = normalize_part_report_status(review_state)
        part_status_counts[report_status] += 1
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        assigned_by = (
            metadata_obj.get("review_state_assigned_by")
            or metadata_obj.get("pass_fail_assigned_by")
            or metadata_obj.get("review_assigned_by")
            or "unknown"
        )
        assigned_at = (
            metadata_obj.get("review_state_assigned_at")
            or metadata_obj.get("pass_fail_assigned_at")
            or metadata_obj.get("review_assigned_at")
        )
        if not assigned_at and updated_at:
            assigned_at = updated_at.isoformat()
        part_assignments.append(
            {
                "part_id": str(part_id),
                "part_identifier": serial_number,
                "pass_fail": review_state,
                "review_status": report_status,
                "username": assigned_by,
                "batch_owner": batch_owner or "",
                "assigned_at": assigned_at or "",
            }
        )
        part_review_summary.append(
            {
                "part_id": str(part_id),
                "part_identifier": serial_number,
                "review_status": report_status,
                "raw_review_state": review_state,
            }
        )
        for image_record in image_part_map.get(str(part_id), []):
            image_part_mappings.append(
                {
                    "part_id": str(part_id),
                    "part_identifier": serial_number,
                    "image_id": image_record["image_id"],
                    "filename": image_record["filename"],
                }
            )

    return {
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "project_type": db_project.project_type,
            "meta_group_id": db_project.meta_group_id,
        },
        "summary": {
            "total_images": total_images,
            "total_batches": total_batches,
            "total_parts": total_parts,
            "reviewed_parts": reviewed_parts,
            "unreviewed_parts": max(total_parts - reviewed_parts, 0),
            "part_status_counts": part_status_counts,
            "metadata_normalization": {
                "dropped_non_object_items": metadata_drop_counts,
            },
        },
        "part_assignments": part_assignments,
        "part_review_summary": part_review_summary,
        "image_part_mappings": image_part_mappings,
    }


async def build_project_report_payload(
    project_id: uuid.UUID,
    db: AsyncSession,
    db_project: models.Project,
    schema_version: int = 3,
) -> dict:
    """Build the current concise project report payload."""
    part_rows_result = await db.execute(
        select(
            models.InspectionPart.id,
            models.InspectionPart.serial_number,
            models.InspectionPart.review_state,
        )
        .where(models.InspectionPart.project_id == project_id)
        .order_by(
            models.InspectionPart.serial_number.asc(),
            models.InspectionPart.id.asc(),
        )
    )
    part_rows = part_rows_result.all()

    parts = []
    part_status_counts = {"pass": 0, "reject": 0, "unreviewed": 0}
    for part_id, serial_number, review_state in part_rows:
        inspection_result = normalize_part_report_status(review_state)
        part_status_counts[inspection_result] += 1
        part = {
            "part_id": str(part_id),
            "part_identifier": serial_number,
            "inspection_result": inspection_result,
        }
        if schema_version == 2:
            part["reviewed"] = inspection_result != "unreviewed"
        parts.append(part)

    total_parts = len(parts)
    reviewed_parts = part_status_counts["pass"] + part_status_counts["reject"]

    return {
        "schema_version": schema_version,
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "project_type": db_project.project_type,
            "meta_group_id": db_project.meta_group_id,
        },
        "summary": {
            "total_parts": total_parts,
            "reviewed_parts": reviewed_parts,
            "unreviewed_parts": part_status_counts["unreviewed"],
            "part_status_counts": part_status_counts,
        },
        "parts": parts,
    }
