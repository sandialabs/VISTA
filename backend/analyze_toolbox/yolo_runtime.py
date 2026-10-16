"""Ultralytics YOLO runtime adapter for Analyze workflow model methods.

Ultralytics is imported lazily inside ``run_ultralytics_yolo`` so importing
this module never loads native extensions.
"""

from importlib import import_module
from typing import Any

from PIL import Image

from core.config import settings

_YOLO_MODEL_CACHE: dict[str, Any] = {}

YoloResult = tuple[Image.Image | None, list[dict[str, Any]], list[dict[str, Any]]]


def yolo_model_name(family: str, task: str, size: str, custom_model: str) -> str:
    if family == "custom" and custom_model:
        return custom_model
    normalized_family = family if family in {"yolov8", "yolo11"} else "yolo11"
    normalized_size = size if size in {"n", "s", "m", "l", "x"} else "n"
    suffix = "-seg" if task == "segment" else ""
    return f"{normalized_family}{normalized_size}{suffix}.pt"


def yolo_runtime_unavailable_summary(
    model_name: str,
    exc: Exception,
    *,
    family: str | None = None,
    task: str | None = None,
) -> dict[str, Any]:
    runtime_warning = (
        f"YOLO model '{model_name}' was not used; Ultralytics runtime is unavailable. "
        f"No fallback detections, overlays, or artifacts were generated ({exc})."
    )
    return {
        "_node_status": "skipped",
        "runtime": "unavailable",
        "model": model_name,
        "detection_count": 0,
        "measurement_count": 0,
        **({"family": family} if family else {}),
        **({"task": task} if task else {}),
        **({"instance_count": 0} if task == "segment" else {}),
        "runtime_warning": runtime_warning,
    }


def _as_list(value) -> list:
    if value is None:
        return []
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    if hasattr(value, "tolist"):
        return value.tolist()
    return list(value)


def _load_yolo_model(model_name: str):
    if settings.VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME:
        raise RuntimeError(
            "Ultralytics runtime is disabled by VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME=true"
        )
    ultralytics = import_module("ultralytics")
    if model_name not in _YOLO_MODEL_CACHE:
        _YOLO_MODEL_CACHE[model_name] = ultralytics.YOLO(model_name)
    return _YOLO_MODEL_CACHE[model_name]


def _class_name(names, class_id: int) -> str:
    if isinstance(names, dict):
        return str(names.get(class_id, names.get(str(class_id), class_id)))
    if isinstance(names, (list, tuple)) and 0 <= class_id < len(names):
        return str(names[class_id])
    return str(class_id)


def _box_measurement(index: int, bbox: dict, score: float, class_name: str) -> dict:
    return {
        "label": index + 1,
        "area_px": bbox["width"] * bbox["height"],
        "bbox": [
            bbox["x"],
            bbox["y"],
            bbox["x"] + bbox["width"],
            bbox["y"] + bbox["height"],
        ],
        "centroid": [
            bbox["x"] + (bbox["width"] / 2),
            bbox["y"] + (bbox["height"] / 2),
        ],
        "confidence": score,
        "class_name": class_name,
    }


def _box_records(
    result, names, image: Image.Image, confidence: float
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    boxes = getattr(result, "boxes", None)
    xyxy_values = _as_list(getattr(boxes, "xyxy", []))
    confidence_values = _as_list(getattr(boxes, "conf", []))
    class_values = _as_list(getattr(boxes, "cls", []))
    detections: list[dict[str, Any]] = []
    measurements: list[dict[str, Any]] = []
    for index, coords in enumerate(xyxy_values):
        if len(coords) < 4:
            continue
        x1, y1, x2, y2 = [float(value) for value in coords[:4]]
        class_id = int(float(class_values[index])) if index < len(class_values) else 0
        score = (
            float(confidence_values[index])
            if index < len(confidence_values)
            else float(confidence)
        )
        bbox = {
            "x": max(0.0, x1),
            "y": max(0.0, y1),
            "width": max(0.0, x2 - x1),
            "height": max(0.0, y2 - y1),
            "image_width": image.width,
            "image_height": image.height,
        }
        class_name = _class_name(names, class_id)
        detections.append(
            {
                "class_id": class_id,
                "class_name": class_name,
                "confidence": score,
                "bbox": bbox,
            }
        )
        measurements.append(_box_measurement(index, bbox, score, class_name))
    return detections, measurements


def _rasterize_masks(mask_data: list, image: Image.Image) -> Image.Image:
    labels = Image.new("L", image.size, 0)
    label_pixels = labels.load()
    for label_index, mask in enumerate(mask_data, start=1):
        mask_height = len(mask)
        mask_width = len(mask[0]) if mask_height else 0
        if mask_width <= 0:
            continue
        for y in range(image.height):
            source_y = min(
                mask_height - 1, int((y / max(1, image.height)) * mask_height)
            )
            row = mask[source_y]
            for x in range(image.width):
                source_x = min(
                    mask_width - 1, int((x / max(1, image.width)) * mask_width)
                )
                if float(row[source_x]) > 0.5:
                    label_pixels[x, y] = ((label_index - 1) % 254) + 1
    return labels


def run_ultralytics_yolo(
    image: Image.Image, model_name: str, confidence: float, *, segment: bool = False
) -> YoloResult:
    model = _load_yolo_model(model_name)
    results = model(
        image.convert("RGB"), conf=max(0.0, min(1.0, float(confidence))), verbose=False
    )
    result = list(results)[0] if results else None
    if result is None:
        return None, [], []

    names = getattr(result, "names", None) or getattr(model, "names", None) or {}
    detections, measurements = _box_records(result, names, image, confidence)

    labels = None
    masks = getattr(result, "masks", None)
    mask_data = (
        _as_list(getattr(masks, "data", [])) if segment and masks is not None else []
    )
    if mask_data:
        labels = _rasterize_masks(mask_data, image)
        for index, detection in enumerate(detections):
            detection["mask_label"] = index + 1
    return labels, detections, measurements
