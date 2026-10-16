"""Anomalib segmentation adapter for VISTA local_import placeholders."""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from ._shared import (
    NativeRuntime,
    SegmentationBackend,
    foreground_fallback_output,
    is_file_like,
    masks_from_entries,
    options_from_payload,
    rgb_image_from_payload,
)

_CONFIG_OPTION_NAMES = {
    "model_name",
    "mode",
    "threshold",
    "min_mask_area_px",
    "checkpoint_path",
    "results_root",
    "accelerator",
    "devices",
    "return_predictions",
    "batch_size",
}


def _load_anomalib_runtime() -> tuple[type, type]:
    """Return the operational Anomalib runtime.

    Dependency-free NumPy and Pillow PatchCore-like fallback.
    """
    return _builtin_patchcore_runtime()


def _builtin_patchcore_runtime() -> tuple[type, type]:
    """Return the dependency-free PatchCore-like runtime (NumPy and Pillow only)."""

    class RuntimeSegmentationInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class RuntimeAnomalib:
        def __init__(self, **config):
            self.config = config

        def run(self, data):
            image = (
                data.image
                if getattr(data, "image", None) is not None
                else Image.open(data.source).convert("RGB")
            )
            heatmap = _patchcore_like_heatmap(image)
            anomaly_score = float(heatmap.max()) if heatmap.size else 0.0
            mask = heatmap >= max(0.05, float(self.config.get("threshold", 0.5)))
            bbox = _bbox_from_mask(mask)
            masks = []
            if bbox is not None:
                masks.append(
                    {
                        "bbox": bbox,
                        "area": bbox[2] * bbox[3],
                        "score": 1.0,
                        "label": str(self.config.get("model_name") or "patchcore"),
                    }
                )
            return type(
                "VistaPatchCoreResult",
                (),
                {
                    "mode": getattr(data, "mode", "default"),
                    "metadata": {
                        "backend": "anomalib",
                        "runtime": "vista.patchcore",
                        "model_name": str(self.config.get("model_name") or "patchcore"),
                        "heatmap": heatmap.tolist(),
                        "anomaly_score": anomaly_score,
                        "masks": masks,
                    },
                },
            )()

    return RuntimeAnomalib, RuntimeSegmentationInput


def _patchcore_like_heatmap(image: Image.Image) -> np.ndarray:
    gray_image = image.convert("L")
    gray = np.asarray(gray_image, dtype=np.float32) / 255.0
    local_mean = (
        np.asarray(
            gray_image.filter(
                ImageFilter.GaussianBlur(radius=max(3, min(image.size) // 24))
            ),
            dtype=np.float32,
        )
        / 255.0
    )
    local_residual = np.abs(gray - local_mean)
    gradient = (
        np.asarray(gray_image.filter(ImageFilter.FIND_EDGES), dtype=np.float32) / 255.0
    )
    score = (0.7 * local_residual) + (0.3 * gradient)
    low = float(np.percentile(score, 2.0))
    high = float(np.percentile(score, 98.0))
    if high <= low:
        high = float(score.max())
        low = float(score.min())
    if high <= low:
        return np.zeros_like(score, dtype=np.float32)
    return np.clip((score - low) / (high - low), 0.0, 1.0).astype(np.float32)


def _patchcore_like_mask(image: Image.Image, *, threshold: float) -> np.ndarray:
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    median = float(np.median(gray))
    mad = float(np.median(np.abs(gray - median)))
    scale = max(mad * 6.0, 0.05)
    score = np.abs(gray - median) / scale
    return score >= max(0.05, threshold)


def _bbox_from_mask(mask: np.ndarray) -> list[float] | None:
    y_indices, x_indices = np.where(mask)
    if x_indices.size == 0 or y_indices.size == 0:
        return None
    x_min = int(x_indices.min())
    y_min = int(y_indices.min())
    x_max = int(x_indices.max()) + 1
    y_max = int(y_indices.max()) + 1
    return [float(x_min), float(y_min), float(x_max - x_min), float(y_max - y_min)]


def _runtime_config(options: dict[str, Any]) -> dict[str, Any]:
    config = {
        name: options[name]
        for name in _CONFIG_OPTION_NAMES
        if options.get(name) not in (None, "")
    }
    config.setdefault("model_name", "patchcore")
    config.setdefault("threshold", 0.5)
    config.setdefault("min_mask_area_px", 1.0)
    config.setdefault("accelerator", "cpu")
    config.setdefault("devices", 1)
    config.setdefault("return_predictions", True)
    config.setdefault("batch_size", 1)
    return config


def _uses_default_patchcore(options: dict[str, Any]) -> bool:
    model_name = str(options.get("model_name") or "patchcore").lower()
    if model_name != "patchcore":
        return False
    checkpoint_path = str(options.get("checkpoint_path") or "").strip()
    if not checkpoint_path:
        return True
    object_key = str(options.get("checkpoint_object_key") or "")
    return object_key.endswith("/checkpoints/default/default_patchcore.ckpt")


def _metadata_value(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _normalize_toolkit_output(result: Any, payload: dict[str, Any]) -> dict[str, Any]:
    metadata = getattr(result, "metadata", None)
    if not isinstance(metadata, dict):
        metadata = result.get("metadata", {}) if isinstance(result, dict) else {}
    masks = masks_from_entries(
        metadata.get("masks") if isinstance(metadata, dict) else [],
        label_prefix="anomaly_",
    )
    heatmap = _first_present_value(
        metadata,
        result,
        keys=("heatmap", "anomaly_map", "pred_mask", "pred_masks"),
    )
    anomaly_score = _anomaly_score_from_sources(metadata, result)
    return {
        "backend": "anomalib",
        "mode": str(
            getattr(result, "mode", payload.get("mode") or "inference") or "inference"
        ),
        "masks": masks,
        "metrics": {
            "runtime": str(metadata.get("runtime") or "analysis_toolkit.anomalib"),
            "mask_count": len(masks),
        },
        "raw_output": {
            **({"heatmap": heatmap} if heatmap is not None else {}),
            **({"anomaly_score": anomaly_score} if anomaly_score is not None else {}),
        }
        or None,
    }


def _first_present_value(*sources: Any, keys: tuple[str, ...]) -> Any:
    for source in sources:
        for key in keys:
            value = _metadata_value(source, key)
            if value is not None:
                return value
    return None


def _anomaly_score_from_sources(*sources: Any) -> float | None:
    for source in sources:
        for key in ("anomaly_score", "pred_score", "score", "image_score"):
            try:
                value = _metadata_value(source, key)
                if value is not None:
                    return float(value)
            except (TypeError, ValueError):
                continue
    return None


def _fallback_output(payload: dict[str, Any], reason: str) -> dict[str, Any]:
    return foreground_fallback_output(
        payload,
        reason,
        backend="anomalib",
        display_name="Anomalib",
        label="anomaly-fallback-region",
    )


def _run_native(payload: dict[str, Any], runtime: NativeRuntime) -> dict[str, Any]:
    options = options_from_payload(payload)
    if not runtime.available and _uses_default_patchcore(options):
        # The built-in PatchCore-like scorer has no native dependencies, so the
        # default model stays usable while native runtimes are disabled.
        anomalib_cls, input_cls = _builtin_patchcore_runtime()
    else:
        anomalib_cls, input_cls = runtime.load()
    segmenter = anomalib_cls(**_runtime_config(options))
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
            image=rgb_image_from_payload(payload).convert("RGB"),
            mode=payload.get("mode", "default"),
            metadata={},
        )
    return _normalize_toolkit_output(segmenter.run(data), payload)


BACKEND = SegmentationBackend(
    display_name="Anomalib",
    module_name=__name__,
    loader_name="_load_anomalib_runtime",
    run_native=_run_native,
    fallback=_fallback_output,
)
run = BACKEND.run
