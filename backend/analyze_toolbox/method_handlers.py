"""Runtime handler registry for Analyze workflow methods.

``METHOD_HANDLERS`` is keyed by the same method ids as
``registry._method_map()``. Each handler takes
``(state, method, params, callbacks)`` and returns a ``NodeOutput``.
"""

from collections.abc import Callable
from typing import Any

from .image_ops import (
    asphalt_anomaly_heatmap,
    blackhat_crack_heatmap,
    connected_components,
    edge_mask,
    frangi_ridge_heatmap,
    manual_threshold,
    minmax,
    otsu_threshold,
    seeded_regions,
    summarize_image,
    window_level,
)
from .model_handlers import (
    apply_universal_segmentation_fallback,
    apply_yolo_ultralytics,
    apply_yolov8_detect,
    apply_yolov8_segment,
)
from .overlays import (
    analysis_detection_overlay_png,
    analysis_overlay_png,
    detection_class_summary,
)
from .segmentation import SEGMENTATION_METHOD_BACKENDS
from .segmentation_step import apply_segmentation_component
from .workflow_state import ImageState, NodeOutput, RunCallbacks, mark_overlay

MethodHandler = Callable[[ImageState, Any, dict[str, Any], RunCallbacks], NodeOutput]

NO_HANDLER_MESSAGE = "No runtime operation registered for this method."


def _source_images(state, _method, _params, _callbacks) -> NodeOutput:
    return state, "Loaded source image bytes.", summarize_image(state.image), []


def _window_level_normalization(state, _method, params, _callbacks) -> NodeOutput:
    state.image = window_level(
        state.image,
        float(params["window"]),
        float(params["level"]),
        bool(params["clip"]),
    )
    message = "Applied window/level normalization."
    return state, message, summarize_image(state.image), []


def _minmax_normalization(state, _method, params, _callbacks) -> NodeOutput:
    state.image = minmax(
        state.image, float(params["output_min"]), float(params["output_max"])
    )
    message = "Applied min-max normalization."
    return state, message, summarize_image(state.image), []


def _otsu(state, method, _params, _callbacks) -> NodeOutput:
    state.mask, threshold = otsu_threshold(state.image)
    mark_overlay(state, "Segmentation", method)
    summary = {"threshold": threshold, **summarize_image(state.mask)}
    return state, "Applied Otsu threshold.", summary, []


def _manual(state, method, params, _callbacks) -> NodeOutput:
    state.mask = manual_threshold(
        state.image, float(params["threshold"]), bool(params["invert"])
    )
    mark_overlay(state, "Segmentation", method)
    return state, "Applied manual threshold.", summarize_image(state.mask), []


def _connected_components(state, method, params, _callbacks) -> NodeOutput:
    source_mask = state.mask or otsu_threshold(state.image)[0]
    state.labels, state.measurements = connected_components(
        source_mask, int(params["min_area_px"])
    )
    mark_overlay(state, "Segmentation", method)
    summary = {
        "region_count": len(state.measurements),
        "measurements": state.measurements,
    }
    return state, "Labeled connected components.", summary, []


def _watershed_seeds(state, method, params, _callbacks) -> NodeOutput:
    state.labels = seeded_regions(
        state.mask or state.image, int(params["seed_spacing_px"])
    )
    mark_overlay(state, "Segmentation", method)
    artifacts = [
        {"kind": "overlay", "label": "seeded_regions", "size": list(state.labels.size)}
    ]
    summary = {"label_image": summarize_image(state.labels)}
    return state, "Computed seeded segmentation labels.", summary, artifacts


def _canny(state, method, params, _callbacks) -> NodeOutput:
    state.mask = edge_mask(
        state.image, float(params["low_threshold"]), float(params["high_threshold"])
    )
    mark_overlay(state, "Feature Detection", method)
    return state, "Computed edge mask.", summarize_image(state.mask), []


def _edge_density_heatmap(state, method, params, _callbacks) -> NodeOutput:
    state.mask = asphalt_anomaly_heatmap(
        state.image, float(params["sensitivity"]), int(params["blur_radius"])
    )
    mark_overlay(state, "Anomaly Detection", method)
    message = "Detected crack/pothole anomaly regions."
    return state, message, summarize_image(state.mask), []


def _frangi_ridge(state, method, params, _callbacks) -> NodeOutput:
    state.mask = frangi_ridge_heatmap(
        state.image, float(params["sensitivity"]), int(params["blur_radius"])
    )
    mark_overlay(state, "Anomaly Detection", method)
    message = "Computed Frangi-style ridge anomaly response."
    return state, message, summarize_image(state.mask), []


def _blackhat_morphology(state, method, params, _callbacks) -> NodeOutput:
    state.mask = blackhat_crack_heatmap(
        state.image, int(params["kernel_radius"]), float(params["sensitivity"])
    )
    mark_overlay(state, "Anomaly Detection", method)
    message = "Computed black-hat morphological crack response."
    return state, message, summarize_image(state.mask), []


def _region_properties(state, _method, _params, _callbacks) -> NodeOutput:
    if not state.measurements:
        _, state.measurements = connected_components(
            state.labels or state.mask or otsu_threshold(state.image)[0], 0
        )
    summary = {"measurement_count": len(state.measurements)}
    return state, "Measured region properties.", summary, []


def _versioned_image_artifact(state, _method, params, _callbacks) -> NodeOutput:
    if state.artifact_block_reason:
        return (
            state,
            "Skipped output artifacts because an upstream model runtime is unavailable.",
            {
                "_node_status": "skipped",
                "artifact_count": 0,
                "artifact_block_reason": state.artifact_block_reason,
            },
            [],
        )
    artifacts = list(state.artifacts)
    overlay_artifact = analysis_overlay_png(state)
    if overlay_artifact is None:
        overlay_artifact = analysis_detection_overlay_png(state)
    if overlay_artifact:
        artifacts.append(overlay_artifact)
    artifacts.append(
        {
            "kind": "recipe",
            "mode": params.get("mode"),
            "detections": len(state.detections),
            "detection_annotations": state.detections,
            "detection_classes": detection_class_summary(state.detections),
            "measurements": len(state.measurements),
            "has_overlay": state.labels is not None or state.mask is not None,
        }
    )
    summary = {"artifact_count": len(artifacts)}
    return state, "Prepared recipe/artifact output metadata.", summary, artifacts


METHOD_HANDLERS: dict[str, MethodHandler] = {
    "source.project_part_images": _source_images,
    "preprocess.window_level_normalization": _window_level_normalization,
    "preprocess.minmax_normalization": _minmax_normalization,
    "threshold.otsu": _otsu,
    "threshold.manual": _manual,
    "segmentation.connected_components": _connected_components,
    "segmentation.watershed_seeds": _watershed_seeds,
    "edge.canny": _canny,
    "anomaly.edge_density_heatmap": _edge_density_heatmap,
    "anomaly.frangi_ridge": _frangi_ridge,
    "anomaly.blackhat_morphology": _blackhat_morphology,
    "measure.region_properties": _region_properties,
    **{
        method_id: apply_segmentation_component
        for method_id in SEGMENTATION_METHOD_BACKENDS
    },
    "ml.yolov8.segment": apply_yolov8_segment,
    "ml.yolo.ultralytics": apply_yolo_ultralytics,
    "ml.yolov8.detect": apply_yolov8_detect,
    "ml.sam.segment_anything": apply_universal_segmentation_fallback,
    "ml.mask2former.universal_segment": apply_universal_segmentation_fallback,
    "ml.oneformer.universal_segment": apply_universal_segmentation_fallback,
    "output.versioned_image_artifact": _versioned_image_artifact,
}


def _no_handler(state, _method, _params, _callbacks) -> NodeOutput:
    return state, NO_HANDLER_MESSAGE, {}, []


def handler_for(method_id: str) -> MethodHandler:
    """Return the runtime handler for ``method_id`` (a no-op if none exists)."""
    return METHOD_HANDLERS.get(method_id, _no_handler)
