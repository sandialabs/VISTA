"""Overlay rendering and overlay-input extraction for Analyze workflow outputs."""

import base64
import io
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from .image_ops import grayscale
from .workflow_state import ImageState

_DETECTION_COLOR = (250, 204, 21, 220)
_DETECTION_LABEL_FILL = (250, 204, 21, 210)
_DETECTION_TEXT_FILL = (17, 24, 39, 255)


def detection_class_summary(detections: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for detection in detections:
        class_name = str(
            detection.get("class_name") or detection.get("class_id") or "unknown"
        )
        counts[class_name] = counts.get(class_name, 0) + 1
    return counts


def _artifact_metadata_from_state(state: ImageState) -> dict[str, Any]:
    return {
        **({"analysis_overlay_type": "heatmap"} if state.heatmap is not None else {}),
        **(
            {"anomaly_score": state.anomaly_score}
            if state.anomaly_score is not None
            else {}
        ),
    }


def _overlay_image_artifact(
    state: ImageState, overlay: Image.Image, *, include_metadata: bool
) -> dict[str, Any]:
    buffer = io.BytesIO()
    overlay.save(buffer, format="PNG")
    artifact = {
        "kind": "overlay_image",
        "label": state.overlay_label,
        "method_id": state.overlay_method_id,
        "method_name": state.overlay_method_name,
        "detections": state.detections,
        "content_type": "image/png",
        "filename_suffix": "analyze-overlay.png",
        "data_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": state.source_image.width,
        "height": state.source_image.height,
    }
    if include_metadata:
        artifact["metadata"] = _artifact_metadata_from_state(state)
    return artifact


def _heatmap_overlay(state: ImageState) -> Image.Image:
    heatmap = grayscale(state.heatmap)
    if heatmap.size != state.source_image.size:
        heatmap = heatmap.resize(state.source_image.size)
    alpha = heatmap.point(lambda value: max(0, min(220, int(round(value * 0.86)))))
    overlay = ImageOps.colorize(heatmap, black="#2563eb", white="#f97316").convert(
        "RGBA"
    )
    overlay.putalpha(alpha)
    return overlay


def _mask_overlay(state: ImageState, overlay_source: Image.Image) -> Image.Image:
    mask = grayscale(overlay_source).point(lambda value: 150 if value > 0 else 0)
    overlay_color = (
        (239, 68, 68, 0)
        if (state.overlay_method_id or "").startswith("anomaly.")
        else (34, 197, 94, 0)
    )
    color = Image.new("RGBA", state.source_image.size, overlay_color)
    if mask.size != state.source_image.size:
        mask = mask.resize(state.source_image.size)
    color.putalpha(mask)
    return color


def analysis_overlay_png(state: ImageState) -> dict[str, Any] | None:
    """Render the heatmap, labels, or mask overlay for ``state``, if any."""
    if state.heatmap is not None:
        return _overlay_image_artifact(
            state, _heatmap_overlay(state), include_metadata=True
        )
    overlay_source = state.labels or state.mask
    if overlay_source is None:
        return None
    return _overlay_image_artifact(
        state, _mask_overlay(state, overlay_source), include_metadata=True
    )


def _draw_detection(
    draw: ImageDraw.ImageDraw,
    detection: Any,
    source_size: tuple[int, int],
    line_width: int,
    label_height: int,
) -> None:
    bbox = detection.get("bbox") if isinstance(detection, dict) else None
    if not isinstance(bbox, dict):
        return
    source_width, source_height = source_size
    x = float(bbox.get("x", 0) or 0)
    y = float(bbox.get("y", 0) or 0)
    width = float(bbox.get("width", 0) or 0)
    height = float(bbox.get("height", 0) or 0)
    if width <= 0 or height <= 0:
        return
    x1 = max(0, min(source_width, x))
    y1 = max(0, min(source_height, y))
    x2 = max(0, min(source_width, x + width))
    y2 = max(0, min(source_height, y + height))
    if x2 <= x1 or y2 <= y1:
        return
    draw.rectangle([x1, y1, x2, y2], outline=_DETECTION_COLOR, width=line_width)
    label = str(detection.get("class_name") or "object")
    confidence = detection.get("confidence")
    if isinstance(confidence, (int, float)):
        label = f"{label} {confidence:.2f}"
    label_width = min(source_width - x1, max(42, (len(label) * 7) + 8))
    label_top = max(0, y1 - label_height)
    draw.rectangle(
        [x1, label_top, x1 + label_width, label_top + label_height],
        fill=_DETECTION_LABEL_FILL,
    )
    draw.text((x1 + 4, label_top + 2), label, fill=_DETECTION_TEXT_FILL)


def analysis_detection_overlay_png(state: ImageState) -> dict[str, Any] | None:
    """Render detection boxes and labels for ``state``, if any are drawable."""
    if not state.detections:
        return None
    overlay = Image.new("RGBA", state.source_image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    line_width = max(2, min(state.source_image.size) // 80)
    label_height = max(12, line_width * 6)
    for detection in state.detections:
        _draw_detection(
            draw, detection, state.source_image.size, line_width, label_height
        )
    if overlay.getbbox() is None:
        return None
    return _overlay_image_artifact(state, overlay, include_metadata=False)


def _normalized_heatmap(candidate: Any) -> np.ndarray | None:
    try:
        array = np.asarray(candidate, dtype=np.float32)
    except (TypeError, ValueError):
        return None
    if array.ndim == 3 and array.shape[-1] in {3, 4}:
        array = array[..., :3].mean(axis=2)
    if array.ndim != 2 or array.size == 0:
        return None
    min_value = float(np.nanmin(array))
    max_value = float(np.nanmax(array))
    if (
        not np.isfinite(min_value)
        or not np.isfinite(max_value)
        or max_value <= min_value
    ):
        return None
    return (
        ((array - min_value) / (max_value - min_value) * 255.0)
        .clip(0, 255)
        .astype(np.uint8)
    )


def heatmap_from_result(result, target_size: tuple[int, int]) -> Image.Image | None:
    metrics = result.metrics if isinstance(result.metrics, dict) else {}
    raw_output = result.raw_output if isinstance(result.raw_output, dict) else {}
    for candidate in (metrics.get("heatmap"), raw_output.get("heatmap")):
        if candidate is None:
            continue
        normalized = _normalized_heatmap(candidate)
        if normalized is None:
            continue
        heatmap = Image.fromarray(normalized, mode="L")
        if heatmap.size != target_size:
            heatmap = heatmap.resize(target_size)
        return heatmap
    return None


def anomaly_score_from_result(result) -> float | None:
    metrics = result.metrics if isinstance(result.metrics, dict) else {}
    raw_output = result.raw_output if isinstance(result.raw_output, dict) else {}
    for source in (metrics, raw_output):
        for key in ("anomaly_score", "pred_score", "score", "image_score"):
            try:
                value = source.get(key)
                if value is not None:
                    return float(value)
            except (AttributeError, TypeError, ValueError):
                continue
    return None
