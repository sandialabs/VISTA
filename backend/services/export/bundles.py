"""Bundle export formatting and normalization helpers."""

from __future__ import annotations

import json
import re
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func as _func
from sqlalchemy import select

from core import models


def tag_duplicate_filename(filename: str, occurrence: int) -> str:
    """Append a human-readable duplicate suffix to an import filename."""
    safe_filename = str(filename or "").strip() or "imported.bin"
    if occurrence <= 0:
        return safe_filename
    dot_index = safe_filename.rfind(".")
    suffix = " (duplicate)" if occurrence == 1 else f" (duplicate {occurrence})"
    if dot_index > 0:
        return f"{safe_filename[:dot_index]}{suffix}{safe_filename[dot_index:]}"
    return f"{safe_filename}{suffix}"


def dedupe_import_filename(filename: str, used_counts: dict[str, int]) -> str:
    """Return a duplicate-tagged import filename and update seen counts."""
    safe_filename = str(filename or "").strip() or "imported.bin"
    occurrence = used_counts.get(safe_filename, 0)
    used_counts[safe_filename] = occurrence + 1
    return tag_duplicate_filename(safe_filename, occurrence)


def normalize_part_artifact_records(
    part_id, serial_number, annotations, overlay_layers, measurement_runs
):
    """Flatten a part's annotations, overlays, and measurement runs for export."""
    annotation_records = []
    overlay_records = []
    measurement_records = []
    incomplete_annotations = 0
    missing_measurement_ids = 0

    for annotation in annotations:
        annotation_obj = annotation if isinstance(annotation, dict) else {}
        if not annotation_obj.get("defect_class") or not annotation_obj.get("modality"):
            incomplete_annotations += 1
        annotation_records.append(
            {
                "part_id": str(part_id),
                "part_serial_number": serial_number,
                "annotation_id": annotation_obj.get("id"),
                "defect_class": annotation_obj.get("defect_class"),
                "modality": annotation_obj.get("modality"),
                "disposition": annotation_obj.get("disposition"),
                "hidden": bool(annotation_obj.get("hidden", False)),
            }
        )

    for overlay in overlay_layers:
        overlay_obj = overlay if isinstance(overlay, dict) else {}
        overlay_records.append(
            {
                "part_id": str(part_id),
                "part_serial_number": serial_number,
                "overlay_id": overlay_obj.get("id"),
                "label": overlay_obj.get("label"),
                "color": overlay_obj.get("color"),
            }
        )

    for measurement in measurement_runs:
        measurement_obj = measurement if isinstance(measurement, dict) else {}
        if not measurement_obj.get("run_id"):
            missing_measurement_ids += 1
        measurement_records.append(
            {
                "part_id": str(part_id),
                "part_serial_number": serial_number,
                "run_id": measurement_obj.get("run_id"),
                "status": measurement_obj.get("status"),
            }
        )

    return {
        "annotation_records": annotation_records,
        "overlay_records": overlay_records,
        "measurement_records": measurement_records,
        "incomplete_annotations": incomplete_annotations,
        "missing_measurement_ids": missing_measurement_ids,
    }


def normalize_metadata_dict_list(metadata_obj, key):
    """Return the metadata list at `key` as dicts, dropping unusable entries."""
    candidate = metadata_obj.get(key)
    if not isinstance(candidate, list):
        return [], 0
    normalized = []
    dropped_count = 0
    for item in candidate:
        if isinstance(item, dict):
            normalized.append(item)
        elif key == "overlay_layers" and isinstance(item, str) and item.strip():
            normalized.append({"id": item, "label": item})
        else:
            dropped_count += 1
    return normalized, dropped_count


def json_safe(value):
    """Recursively convert UUIDs, decimals, and dates to JSON-serializable types."""
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return int(value) if value == int(value) else float(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def toml_scalar(value) -> str:
    """Render a single value as a TOML-compatible scalar literal."""
    value = json_safe(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, list) and all(
        not isinstance(item, (dict, list)) for item in value
    ):
        return "[" + ", ".join(toml_scalar(item) for item in value) + "]"
    if value is None:
        return '""'
    if isinstance(value, (dict, list)):
        return json.dumps(json.dumps(value, indent=2, sort_keys=True))
    return json.dumps(str(value))


def toml_table(name: str, values: dict) -> str:
    """Render a dict as a TOML `[name]` table block."""
    lines = [f"[{name}]"]
    for key in sorted(values.keys()):
        safe_key = re.sub(r"[^A-Za-z0-9_-]", "_", str(key))
        lines.append(f"{safe_key} = {toml_scalar(values[key])}")
    return "\n".join(lines)


def toml_array_table(name: str, rows: list[dict]) -> str:
    """Render a list of dicts as repeated TOML `[[name]]` array-table blocks."""
    blocks = []
    for row in rows:
        lines = [f"[[{name}]]"]
        for key in sorted(row.keys()):
            safe_key = re.sub(r"[^A-Za-z0-9_-]", "_", str(key))
            lines.append(f"{safe_key} = {toml_scalar(row[key])}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def build_toml_document(
    *,
    tables: dict[str, dict] | None = None,
    arrays: dict[str, list[dict]] | None = None,
) -> str:
    """Assemble TOML tables and array-tables into a single document string."""
    blocks = []
    for name, values in (tables or {}).items():
        blocks.append(toml_table(name, values))
    for name, rows in (arrays or {}).items():
        blocks.append(toml_array_table(name, rows))
    return "\n\n".join(block for block in blocks if block).strip() + "\n"


def json_bytes(payload: dict | list) -> bytes:
    """Return stable UTF-8 JSON bytes for bundle sidecars."""
    return json.dumps(json_safe(payload), indent=2, sort_keys=True).encode("utf-8")


def safe_export_name(value: str, fallback: str) -> str:
    """Sanitize a value into a safe archive filename, falling back if empty."""
    base = str(value or fallback).split("/")[-1].split("\\")[-1].strip()
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base)
    base = re.sub(r"\s+", " ", base).strip(" .")
    return base or fallback


def dedupe_archive_path(directory: str, filename: str, used_paths: set[str]) -> str:
    """Return a unique archive path for filename, appending a suffix on collision."""
    safe_name = safe_export_name(filename, "artifact.bin")
    stem, dot, suffix = safe_name.rpartition(".")
    if not dot:
        stem, suffix = safe_name, ""
    candidate = f"{directory}/{safe_name}"
    index = 2
    while candidate in used_paths:
        candidate_name = f"{stem}-{index}.{suffix}" if suffix else f"{stem}-{index}"
        candidate = f"{directory}/{candidate_name}"
        index += 1
    used_paths.add(candidate)
    return candidate


def image_record_is_overlay(
    filename: str, metadata: dict | None, part_overlay_filenames: set[str]
) -> bool:
    """Return True if the image record represents a part overlay layer."""
    metadata = metadata if isinstance(metadata, dict) else {}
    if bool(metadata.get("overlay")):
        return True
    filename = str(filename or "").strip()
    if filename in part_overlay_filenames:
        return True
    image_role = str(
        metadata.get("artifact_type") or metadata.get("role") or ""
    ).lower()
    return "overlay" in image_role


async def collect_project_bundle_payload(
    *, project_id, db, db_project
) -> dict[str, Any]:
    """Collect DB rows and build the project export-bundle JSON payload."""
    image_totals_result = await db.execute(
        select(
            _func.count().label("total_images"),
            _func.coalesce(_func.sum(models.DataInstance.size_bytes), 0).label(
                "total_image_bytes"
            ),
        )
        .select_from(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.is_(None))
    )
    image_totals = image_totals_result.one()

    part_metadata_result = await db.execute(
        select(
            models.InspectionPart.id,
            models.InspectionPart.serial_number,
            models.InspectionPart.display_name,
            models.InspectionPart.metadata_json,
        ).where(models.InspectionPart.project_id == project_id)
    )
    part_metadata_rows = part_metadata_result.all()

    return build_project_bundle_payload(
        project={
            "id": str(db_project.id),
            "name": db_project.name,
            "project_type": db_project.project_type,
            "meta_group_id": db_project.meta_group_id,
        },
        total_images=image_totals.total_images,
        total_image_bytes=image_totals.total_image_bytes,
        part_metadata_rows=part_metadata_rows,
    )


def build_project_bundle_payload(
    *,
    project: dict[str, Any],
    total_images: int,
    total_image_bytes: Any,
    part_metadata_rows: list[Any],
) -> dict[str, Any]:
    """Build the project export-bundle JSON summary from queried rows."""
    annotations_count = 0
    overlay_layer_count = 0
    segmentation_run_count = 0
    measurement_run_count = 0
    annotation_records = []
    overlay_records = []
    measurement_records = []
    part_discrepancy_summaries = []

    for part_id, serial_number, display_name, metadata in part_metadata_rows:
        metadata_obj = metadata if isinstance(metadata, dict) else {}
        annotations, dropped_annotations = normalize_metadata_dict_list(
            metadata_obj, "annotations"
        )
        overlay_layers, dropped_overlay_layers = normalize_metadata_dict_list(
            metadata_obj, "overlay_layers"
        )
        segmentation_runs, dropped_segmentation_runs = normalize_metadata_dict_list(
            metadata_obj, "segmentation_runs"
        )
        measurement_runs, dropped_measurement_runs = normalize_metadata_dict_list(
            metadata_obj, "measurement_runs"
        )

        annotations_count += len(annotations)
        overlay_layer_count += len(overlay_layers)
        segmentation_run_count += len(segmentation_runs)
        measurement_run_count += len(measurement_runs)

        normalized_records = normalize_part_artifact_records(
            part_id=part_id,
            serial_number=serial_number,
            annotations=annotations,
            overlay_layers=overlay_layers,
            measurement_runs=measurement_runs,
        )
        annotation_records.extend(normalized_records["annotation_records"])
        overlay_records.extend(normalized_records["overlay_records"])
        measurement_records.extend(normalized_records["measurement_records"])

        incomplete_annotations = normalized_records["incomplete_annotations"]
        missing_measurement_ids = normalized_records["missing_measurement_ids"]
        dropped_metadata_items = (
            dropped_annotations
            + dropped_overlay_layers
            + dropped_segmentation_runs
            + dropped_measurement_runs
        )

        discrepancy_codes = []
        if segmentation_runs and not overlay_layers:
            discrepancy_codes.append("missing_overlay_layers")
        if incomplete_annotations:
            discrepancy_codes.append("incomplete_annotation_fields")
        if missing_measurement_ids:
            discrepancy_codes.append("measurement_run_missing_run_id")
        if dropped_metadata_items:
            discrepancy_codes.append("metadata_items_dropped_non_object")

        part_discrepancy_summaries.append(
            {
                "part_id": str(part_id),
                "serial_number": serial_number,
                "display_name": display_name,
                "counts": {
                    "annotations": len(annotations),
                    "overlay_layers": len(overlay_layers),
                    "segmentation_runs": len(segmentation_runs),
                    "measurement_runs": len(measurement_runs),
                    "incomplete_annotations": incomplete_annotations,
                    "measurement_runs_missing_run_id": missing_measurement_ids,
                    "dropped_non_object_metadata_items": dropped_metadata_items,
                },
                "discrepancy_codes": discrepancy_codes,
            }
        )

    discrepancy_total = sum(
        1 for summary in part_discrepancy_summaries if summary["discrepancy_codes"]
    )
    if isinstance(total_image_bytes, Decimal):
        total_image_bytes = int(total_image_bytes)

    return {
        "project": project,
        "bundle_summary": {
            "images": {
                "total": total_images,
                "total_bytes": total_image_bytes,
            },
            "parts": {
                "total": len(part_metadata_rows),
            },
            "annotations": {
                "total": annotations_count,
                "records": annotation_records,
            },
            "overlays": {
                "configured_layers": overlay_layer_count,
                "segmentation_runs": segmentation_run_count,
                "records": overlay_records,
            },
            "measurements": {
                "ai_runs": measurement_run_count,
                "records": measurement_records,
            },
            "discrepancies": {
                "parts_with_discrepancies": discrepancy_total,
                "per_part": part_discrepancy_summaries,
            },
        },
    }
