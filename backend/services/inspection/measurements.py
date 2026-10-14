"""Inspection part segmentation runs, slice segmentation, and measurement runs."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from analyze_toolbox import WorkflowImageInput, execute_image_workflow
from repositories import inspection as inspection_repository
from services.errors import NotFoundError, ServiceError, ValidationFailedError
from services.inspection import segmentation as inspection_segmentation_service

PART_NOT_FOUND_DETAIL = "Inspection part not found"

SLICE_SEGMENTATION_METHOD_IDS = {
    "segmentation.yolo.placeholder",
    "segmentation.anomalib.placeholder",
    "segmentation.sam.placeholder",
    "segmentation.opencv.placeholder",
}


def _existing_metadata_runs(part, key: str) -> list:
    if isinstance(part.metadata_json, dict):
        return list(part.metadata_json.get(key) or [])
    return []


async def _append_part_metadata_run(
    db,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    part,
    key: str,
    entry: dict,
    user_email: str,
) -> None:
    existing_runs = _existing_metadata_runs(part, key)
    updated_part = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={key: [*existing_runs, entry]},
        updated_by=user_email,
    )
    if not updated_part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)


async def invoke_part_segmentation(
    db,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    axis: str,
    slice_index: int,
    user_email: str,
) -> dict[str, Any]:
    """Record a completed segmentation run on the part and return its summary."""
    part = await inspection_repository.get_inspection_part_for_update(
        db=db,
        project_id=project_id,
        part_id=part_id,
    )
    if not part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)

    created_at = datetime.now(UTC)
    run_id = uuid.uuid4()
    overlay_id = f"segmentation-{axis}-{slice_index}"
    run_entry = {
        "run_id": str(run_id),
        "axis": axis,
        "slice_index": slice_index,
        "status": "completed",
        "overlay_id": overlay_id,
        "created_at": created_at.isoformat(),
        "requested_by": user_email,
    }
    await _append_part_metadata_run(
        db,
        project_id=project_id,
        part_id=part_id,
        part=part,
        key="segmentation_runs",
        entry=run_entry,
        user_email=user_email,
    )
    return {
        "run_id": run_id,
        "part_id": part_id,
        "axis": axis,
        "slice_index": slice_index,
        "status": "completed",
        "overlay_id": overlay_id,
        "created_at": created_at,
    }


def _decode_slice_image(value: str) -> bytes:
    try:
        return inspection_segmentation_service.decode_slice_image_payload(value)
    except ValueError as exc:
        raise ValidationFailedError("Invalid slice image payload") from exc


def _run_slice_workflow(part_id: uuid.UUID, payload, image_bytes: bytes):
    workflow = inspection_segmentation_service.slice_segmentation_workflow(
        payload.method_id,
        payload.parameters,
    )
    image_input = WorkflowImageInput(
        image_id=uuid.uuid4(),
        filename=payload.filename,
        content_type="image/png",
        data=image_bytes,
        metadata={
            "part_id": str(part_id),
            "axis": payload.axis,
            "slice_index": payload.slice_index,
        },
    )
    try:
        return execute_image_workflow(workflow, [image_input])
    except (OSError, ValueError) as exc:
        raise ValidationFailedError(str(exc)) from exc
    except Exception as exc:
        raise ServiceError(
            f"Slice segmentation failed: {exc}", status_code=500
        ) from exc


def _slice_summary(result, payload, region_count: int) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "workflow_name": result.workflow_name,
        "image_count": result.image_count,
        "region_count": region_count,
        "click": {"x": payload.click_x, "y": payload.click_y},
    }
    for node_result in result.node_results:
        if node_result.method_id == payload.method_id and isinstance(
            node_result.summary, dict
        ):
            summary.update(
                {
                    key: value
                    for key, value in node_result.summary.items()
                    if key not in {"measurements", "detections"}
                }
            )
    return summary


async def segment_inspection_slice(
    db, *, project_id: uuid.UUID, part_id: uuid.UUID, payload
) -> dict[str, Any]:
    """Run toolbox segmentation on one slice image and select the clicked region."""
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)
    if payload.method_id not in SLICE_SEGMENTATION_METHOD_IDS:
        raise ValidationFailedError("Unsupported slice segmentation method")

    image_bytes = _decode_slice_image(payload.image_data_base64)
    result = _run_slice_workflow(part_id, payload, image_bytes)
    regions = inspection_segmentation_service.regions_from_toolbox_result(result)
    selected_region = inspection_segmentation_service.select_clicked_region(
        regions, payload.click_x, payload.click_y
    )
    return {
        "run_id": result.run_id,
        "part_id": part_id,
        "axis": payload.axis,
        "slice_index": payload.slice_index,
        "method_id": payload.method_id,
        "status": result.status,
        "cached": False,
        "regions": regions,
        "selected_region": selected_region,
        "summary": _slice_summary(result, payload, len(regions)),
        "warnings": result.warnings,
    }


def _measurement_values(
    part, measurement_profile: str, include_overlays: list[str]
) -> dict[str, float]:
    synthetic_level = 0
    if isinstance(part.metadata_json, dict):
        synthetic_level = int(part.metadata_json.get("synthetic_level") or 0)
    complexity_multiplier = max(1, synthetic_level)
    return {
        "crack_length_mm": round(
            (12.4 + len(include_overlays) * 1.7) * complexity_multiplier, 2
        ),
        "pore_area_mm2": round(
            (2.1 + len(measurement_profile) * 0.08) * complexity_multiplier, 2
        ),
        "edge_offset_mm": round((0.35 + (complexity_multiplier * 0.11)), 2),
    }


async def invoke_ai_measurements(
    db,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    measurement_profile: str,
    include_overlays: list[str],
    user_email: str,
) -> dict[str, Any]:
    """Record a completed measurement run on the part and return its values."""
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)

    values = _measurement_values(part, measurement_profile, include_overlays)
    created_at = datetime.now(UTC)
    run_id = uuid.uuid4()
    result_entry = {
        "run_id": str(run_id),
        "measurement_profile": measurement_profile,
        "include_overlays": include_overlays,
        "status": "completed",
        "units": "mm",
        "values": values,
        "created_at": created_at.isoformat(),
        "requested_by": user_email,
    }
    await _append_part_metadata_run(
        db,
        project_id=project_id,
        part_id=part_id,
        part=part,
        key="measurement_runs",
        entry=result_entry,
        user_email=user_email,
    )
    return {
        "run_id": run_id,
        "part_id": part_id,
        "status": "completed",
        "measurement_profile": measurement_profile,
        "units": "mm",
        "values": values,
        "created_at": created_at,
    }
