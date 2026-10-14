"""YOLO segmentation adapter for VISTA local_import placeholders."""

from __future__ import annotations

from typing import Any

import numpy as np

from ._shared import (
    NativeRuntime,
    SegmentationBackend,
    foreground_fallback_output,
    is_file_like,
    masks_from_entries,
    options_from_payload,
    rgb_image_from_payload,
)

_CONFIG_OPTION_NAMES = {"pretrained_model"}
_PREDICT_OPTION_NAMES = {
    "conf",
    "iou",
    "imgsz",
    "device",
    "max_det",
    "classes",
    "agnostic_nms",
    "retina_masks",
    "verbose",
}
_CONTROL_OPTION_NAMES = {
    "integration_mode",
    "function_path",
    "fastapi_url",
    "timeout_seconds",
    "model",
    "pretrained_model",
    "threshold_delta",
    "score",
    *_PREDICT_OPTION_NAMES,
}


def _load_yolo_runtime() -> tuple[type, type]:
    """Return the operational YOLO runtime (``ultralytics`` only)."""
    from ultralytics import YOLO  # noqa: PLC0415

    class UltralyticsYOLOSegmentationInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class UltralyticsYOLOSegmentation:
        def __init__(self, **config):
            self.model = YOLO(config.get("pretrained_model") or "yolo11n-seg.pt")

        def run(self, data):
            predict_kwargs = {
                name: getattr(data, name)
                for name in _PREDICT_OPTION_NAMES
                if hasattr(data, name)
            }
            source = (
                data.source if getattr(data, "source", None) is not None else data.image
            )
            raw_output = self.model.predict(source, **predict_kwargs)
            return type(
                "UltralyticsYOLOResult",
                (),
                {
                    "mode": getattr(data, "mode", "predict"),
                    "metadata": {"raw_output": raw_output},
                },
            )()

    return UltralyticsYOLOSegmentation, UltralyticsYOLOSegmentationInput


def _as_numpy(value: Any) -> np.ndarray | None:
    if value is None:
        return None
    try:
        if hasattr(value, "detach"):
            value = value.detach().cpu().numpy()
        elif hasattr(value, "cpu"):
            value = value.cpu().numpy()
        else:
            value = np.asarray(value)
    except Exception:
        return None
    return value


def _bbox_xywh_from_xyxy(values: Any) -> list[float] | None:
    try:
        x1, y1, x2, y2 = [float(value) for value in list(values)[:4]]
    except (TypeError, ValueError):
        return None
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    return [x1, y1, width, height]


def _mask_entry_from_bbox(
    bbox: list[float], *, label: str, score: float | None
) -> dict[str, Any]:
    return {
        "segmentation": None,
        "bbox": bbox,
        "area": bbox[2] * bbox[3],
        "score": score,
        "label": label,
    }


def _masks_from_ultralytics_result(raw_result: Any) -> list[dict[str, Any]]:
    if isinstance(raw_result, (list, tuple)):
        raw_result = raw_result[0] if raw_result else None
    if raw_result is None:
        return []
    boxes = getattr(raw_result, "boxes", None)
    xyxy = _as_numpy(getattr(boxes, "xyxy", None))
    if xyxy is None:
        return []
    conf = _as_numpy(getattr(boxes, "conf", None))
    classes = _as_numpy(getattr(boxes, "cls", None))
    names = getattr(raw_result, "names", {}) or {}
    masks = []
    for index, row in enumerate(xyxy):
        bbox = _bbox_xywh_from_xyxy(row)
        if not bbox:
            continue
        class_id = (
            int(classes[index])
            if classes is not None and len(classes) > index
            else None
        )
        label = (
            str(names.get(class_id, f"object_{index + 1}"))
            if isinstance(names, dict)
            else f"object_{index + 1}"
        )
        score = float(conf[index]) if conf is not None and len(conf) > index else None
        masks.append(_mask_entry_from_bbox(bbox, label=label, score=score))
    return masks


def _normalize_toolkit_output(result: Any, payload: dict[str, Any]) -> dict[str, Any]:
    metadata = getattr(result, "metadata", None)
    if not isinstance(metadata, dict):
        metadata = result.get("metadata", {}) if isinstance(result, dict) else {}
    raw_output = metadata.get("raw_output") if isinstance(metadata, dict) else None
    masks = masks_from_entries(
        metadata.get("masks") if isinstance(metadata, dict) else [],
        label_prefix="object_",
    )
    if not masks:
        masks = _masks_from_ultralytics_result(raw_output)
    return {
        "backend": "yolo",
        "mode": str(
            getattr(result, "mode", payload.get("mode") or "predict") or "predict"
        ),
        "masks": masks,
        "metrics": {"runtime": "analysis_toolkit.yolo", "mask_count": len(masks)},
        "raw_output": None,
    }


def _fallback_output(payload: dict[str, Any], reason: str) -> dict[str, Any]:
    return foreground_fallback_output(
        payload,
        reason,
        backend="yolo",
        display_name="YOLO",
        label="yolo-fallback-object",
    )


def _runtime_config(options: dict[str, Any]) -> dict[str, Any]:
    model = options.get("pretrained_model") or options.get("model") or "yolo11n-seg.pt"
    return {
        "pretrained_model": model,
        **{name: options[name] for name in _CONFIG_OPTION_NAMES if name in options},
    }


def _predict_kwargs(options: dict[str, Any]) -> dict[str, Any]:
    values = {name: options[name] for name in _PREDICT_OPTION_NAMES if name in options}
    values.setdefault("conf", options.get("confidence", 0.25))
    values.setdefault("iou", 0.7)
    values.setdefault("verbose", False)
    return values


def _run_native(payload: dict[str, Any], runtime: NativeRuntime) -> dict[str, Any]:
    options = options_from_payload(payload)
    yolo_cls, input_cls = runtime.load()
    segmenter = yolo_cls(**_runtime_config(options))
    file_value = payload.get("file")
    if file_value is not None and not is_file_like(file_value):
        data = input_cls(
            source=file_value,
            image=None,
            mode=payload.get("mode", "default"),
            metadata={},
        )
    else:
        data = input_cls(
            source=None,
            image=np.asarray(rgb_image_from_payload(payload).convert("RGB")),
            mode=payload.get("mode", "default"),
            metadata={},
            **_predict_kwargs(options),
        )
    return _normalize_toolkit_output(segmenter.run(data), payload)


BACKEND = SegmentationBackend(
    display_name="YOLO",
    module_name=__name__,
    loader_name="_load_yolo_runtime",
    run_native=_run_native,
    fallback=_fallback_output,
)
run = BACKEND.run
