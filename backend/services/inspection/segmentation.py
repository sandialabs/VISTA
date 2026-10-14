"""Inspection slice-segmentation helper functions."""

from __future__ import annotations

import base64
import contextlib
from typing import Any

from analyze_toolbox import WorkflowGraph


def decode_slice_image_payload(value: str) -> bytes:
    """Decode a base64 image payload, allowing data URL wrappers."""
    encoded = str(value or "").strip()
    if "," in encoded and encoded.lower().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("Invalid slice image payload") from exc


def slice_segmentation_workflow(method_id: str, parameters: dict) -> WorkflowGraph:
    """Build the toolbox workflow for one inspection slice segmentation request."""
    return WorkflowGraph(
        name=f"Inspection slice segmentation {method_id}",
        source={"kind": "manual_selection", "image_count": 1, "part_count": 1},
        output={"mode": "metadata_only", "artifact_policy": "metadata_only"},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images"},
            {"id": "segment", "method_id": method_id, "parameters": parameters or {}},
        ],
        edges=[
            {"source_node": "input", "target_node": "segment"},
        ],
    )


def normalize_segment_region(entry: object, index: int) -> dict | None:
    """Normalize a toolbox detection or measurement into a segment region."""
    if not isinstance(entry, dict):
        return None
    bbox = entry.get("bbox")
    if not isinstance(bbox, list) or len(bbox) < 4:
        detection_bbox = (
            entry.get("bbox") if isinstance(entry.get("bbox"), dict) else None
        )
        if detection_bbox:
            x = float(detection_bbox.get("x", 0) or 0)
            y = float(detection_bbox.get("y", 0) or 0)
            width = float(detection_bbox.get("width", 0) or 0)
            height = float(detection_bbox.get("height", 0) or 0)
            bbox = [x, y, x + width, y + height]
    if not isinstance(bbox, list) or len(bbox) < 4:
        return None
    try:
        x1, y1, x2, y2 = [float(value) for value in bbox[:4]]
    except (TypeError, ValueError):
        return None
    if x2 <= x1 or y2 <= y1:
        return None
    raw_centroid = entry.get("centroid")
    centroid = None
    if isinstance(raw_centroid, list) and len(raw_centroid) >= 2:
        try:
            centroid = [float(raw_centroid[0]), float(raw_centroid[1])]
        except (TypeError, ValueError):
            centroid = None
    raw_label = entry.get("label", index + 1)
    try:
        label = int(raw_label)
    except (TypeError, ValueError):
        label = index + 1
    area = entry.get("area_px", (x2 - x1) * (y2 - y1))
    try:
        area_px = float(area)
    except (TypeError, ValueError):
        area_px = float((x2 - x1) * (y2 - y1))
    confidence = entry.get("confidence")
    try:
        confidence_value = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence_value = None
    return {
        "label": label,
        "area_px": area_px,
        "bbox": [x1, y1, x2, y2],
        "centroid": centroid,
        "confidence": confidence_value,
        "class_name": str(entry.get("class_name"))
        if entry.get("class_name") is not None
        else None,
    }


def apply_measurement_fields(region: dict, measurement: object) -> dict:
    """Overlay measurement values onto a normalized segment region."""
    if not isinstance(measurement, dict):
        return region
    updated = dict(region)
    if measurement.get("area_px") is not None:
        with contextlib.suppress(TypeError, ValueError):
            updated["area_px"] = float(measurement["area_px"])
    raw_centroid = measurement.get("centroid")
    if isinstance(raw_centroid, list) and len(raw_centroid) >= 2:
        with contextlib.suppress(TypeError, ValueError):
            updated["centroid"] = [float(raw_centroid[0]), float(raw_centroid[1])]
    return updated


def regions_from_toolbox_result(result: Any) -> list[dict]:
    """Extract and deduplicate normalized segment regions from a toolbox result."""
    regions: list[dict] = []
    for node_result in result.node_results:
        summary = node_result.summary if isinstance(node_result.summary, dict) else {}
        measurements = (
            summary.get("measurements")
            if isinstance(summary.get("measurements"), list)
            else []
        )
        detections = (
            summary.get("detections")
            if isinstance(summary.get("detections"), list)
            else []
        )
        if detections:
            for index, detection in enumerate(detections):
                region = normalize_segment_region(detection, len(regions))
                if not region:
                    continue
                measurement = measurements[index] if index < len(measurements) else None
                regions.append(apply_measurement_fields(region, measurement))
            continue
        for entry in measurements:
            region = normalize_segment_region(entry, len(regions))
            if region:
                regions.append(region)
    deduped = {}
    for region in regions:
        key = tuple(round(value, 3) for value in region["bbox"])
        deduped[key] = region
    return list(deduped.values())


def select_clicked_region(
    regions: list[dict], click_x: float, click_y: float
) -> dict | None:
    """Return the smallest detected region containing the click location."""
    containing = []
    for region in regions:
        x1, y1, x2, y2 = region["bbox"]
        if x1 <= click_x <= x2 and y1 <= click_y <= y2:
            containing.append(region)
    if not containing:
        return None
    return min(containing, key=lambda region: region.get("area_px") or float("inf"))
