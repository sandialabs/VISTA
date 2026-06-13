"""Shared helpers for local segmentation placeholder adapter examples."""

from __future__ import annotations

import base64
import io
from typing import Any, Dict, Iterable

from PIL import Image


def payload_from_request(request: Any) -> Dict[str, Any]:
    """Return a plain dictionary for a Pydantic or dictionary request."""

    if hasattr(request, "model_dump"):
        return request.model_dump(mode="python", exclude={"image"})
    return dict(request or {})


def decode_request_image(payload: Dict[str, Any]) -> Image.Image:
    """Decode VISTA's base64 PNG payload into an RGB Pillow image."""

    encoded = str(payload.get("image_data_base64") or "")
    if encoded.startswith("data:") and "," in encoded:
        encoded = encoded.split(",", 1)[1]
    image_bytes = base64.b64decode(encoded)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def _float_option(options: Dict[str, Any], name: str, default: float) -> float:
    value = options.get(name, default)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return default
    return default


def centered_bbox_xywh(image: Image.Image, fraction: float = 0.4) -> list[float]:
    """Return a centered fallback bbox in [x, y, width, height] form."""

    width, height = image.size
    box_width = max(1.0, width * fraction)
    box_height = max(1.0, height * fraction)
    return [
        max(0.0, (width - box_width) / 2),
        max(0.0, (height - box_height) / 2),
        min(float(width), box_width),
        min(float(height), box_height),
    ]


def foreground_bbox_xywh(image: Image.Image, *, threshold_delta: float = 20.0) -> list[float]:
    """Estimate a simple foreground bbox by comparing luminance to corners.

    This is intentionally lightweight and dependency-free. Production adapters
    should replace this heuristic with their deployed model call while keeping
    the returned dictionary shape stable.
    """

    grayscale = image.convert("L")
    width, height = grayscale.size
    if width <= 0 or height <= 0:
        return [0.0, 0.0, 1.0, 1.0]

    pixels = grayscale.load()
    corners = [
        pixels[0, 0],
        pixels[width - 1, 0],
        pixels[0, height - 1],
        pixels[width - 1, height - 1],
    ]
    background = sum(corners) / len(corners)
    min_x = width
    min_y = height
    max_x = -1
    max_y = -1

    for y in range(height):
        for x in range(width):
            if abs(float(pixels[x, y]) - background) < threshold_delta:
                continue
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

    if max_x < min_x or max_y < min_y:
        return centered_bbox_xywh(image)
    return [float(min_x), float(min_y), float(max_x - min_x + 1), float(max_y - min_y + 1)]


def prompted_bbox_xywh(image: Image.Image, prompts: Dict[str, Any]) -> list[float]:
    """Build a bbox from SAM-like box prompts when present, else fallback."""

    box = prompts.get("box") or prompts.get("bbox")
    if isinstance(box, Iterable) and not isinstance(box, (str, bytes, dict)):
        try:
            values = [float(value) for value in list(box)[:4]]
        except (TypeError, ValueError):
            values = []
        if len(values) == 4:
            x1, y1, x2, y2 = values
            width = max(1.0, x2 - x1)
            height = max(1.0, y2 - y1)
            return [max(0.0, x1), max(0.0, y1), width, height]
    return centered_bbox_xywh(image, fraction=0.5)


def output_for_box(
    *,
    payload: Dict[str, Any],
    box: list[float],
    label: str,
    runtime: str,
    score: float,
    extra_metrics: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Return VISTA's shared segmentation output shape for one bbox mask."""

    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    metrics = {
        "runtime": runtime,
        "model": options.get("model", f"example-{runtime}"),
    }
    if extra_metrics:
        metrics.update(extra_metrics)
    return {
        "backend": payload.get("backend", runtime.split("_", 1)[0]),
        "mode": payload.get("mode", "default"),
        "masks": [
            {
                "segmentation": None,
                "bbox": box,
                "area": box[2] * box[3],
                "score": score,
                "label": label,
            }
        ],
        "metrics": metrics,
        "raw_output": None,
    }


def options_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    options = payload.get("options")
    return options if isinstance(options, dict) else {}


def threshold_delta_from_options(options: Dict[str, Any], default: float = 20.0) -> float:
    return _float_option(options, "threshold_delta", default)


def score_from_options(options: Dict[str, Any], default: float = 0.9) -> float:
    return max(0.0, min(1.0, _float_option(options, "score", default)))
