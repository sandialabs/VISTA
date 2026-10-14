"""Method handlers for YOLO and model-service segmentation methods."""

from typing import Any

from .model_fallbacks import universal_segmentation_fallback
from .overlays import detection_class_summary
from .workflow_state import (
    ImageState,
    NodeOutput,
    RunCallbacks,
    block_model_outputs,
    mark_overlay,
)
from .yolo_runtime import (
    run_ultralytics_yolo,
    yolo_model_name,
    yolo_runtime_unavailable_summary,
)


def _run_yolo_or_skip(
    state: ImageState,
    model_name: str,
    confidence: float,
    *,
    segment: bool,
    skip_message: str,
    task: str,
    family: str | None = None,
) -> NodeOutput | None:
    """Run YOLO into ``state``; return a skipped node output if unavailable."""
    try:
        labels, detections, measurements = run_ultralytics_yolo(
            state.image, model_name, confidence, segment=segment
        )
    except Exception as exc:
        summary = yolo_runtime_unavailable_summary(
            model_name, exc, family=family, task=task
        )
        block_model_outputs(state, summary["runtime_warning"])
        return state, skip_message, summary, []
    if segment:
        state.labels = labels
    state.detections = detections
    state.measurements = measurements
    return None


def apply_yolov8_segment(
    state: ImageState, method, params: dict[str, Any], _callbacks: RunCallbacks
) -> NodeOutput:
    model_name = str(params.get("model") or "yolov8n-seg.pt")
    confidence = float(params.get("confidence", 0.25))
    skipped = _run_yolo_or_skip(
        state,
        model_name,
        confidence,
        segment=True,
        task="segment",
        skip_message="Skipped YOLOv8 instance segmentation because the model runtime is unavailable.",
    )
    if skipped:
        return skipped
    mark_overlay(state, "Instance Segmentation", method)
    return (
        state,
        "Computed YOLOv8-compatible instance segmentation.",
        {
            "runtime": "ultralytics",
            "model": model_name,
            "instance_count": len(state.measurements),
            "detection_count": len(state.detections),
            "detection_classes": detection_class_summary(state.detections),
            "detections": state.detections,
            "measurements": state.measurements,
        },
        [],
    )


def apply_yolov8_detect(
    state: ImageState, method, params: dict[str, Any], _callbacks: RunCallbacks
) -> NodeOutput:
    model_name = str(params.get("model") or "yolov8n.pt")
    confidence = float(params.get("confidence", 0.25))
    skipped = _run_yolo_or_skip(
        state,
        model_name,
        confidence,
        segment=False,
        task="detect",
        skip_message="Skipped YOLOv8 object detection because the model runtime is unavailable.",
    )
    if skipped:
        return skipped
    mark_overlay(state, "Detection", method)
    return (
        state,
        "Computed YOLOv8-compatible object detections.",
        {
            "runtime": "ultralytics",
            "model": model_name,
            "detection_count": len(state.detections),
            "measurement_count": len(state.measurements),
            "detection_classes": detection_class_summary(state.detections),
            "detections": state.detections,
        },
        [],
    )


def apply_yolo_ultralytics(
    state: ImageState, method, params: dict[str, Any], _callbacks: RunCallbacks
) -> NodeOutput:
    family = str(params.get("family") or "yolo11")
    task = str(params.get("task") or "detect")
    confidence = float(params.get("confidence", 0.25))
    model_name = yolo_model_name(
        family=family,
        task=task,
        size=str(params.get("size") or "n"),
        custom_model=str(params.get("model") or ""),
    )
    segment = task == "segment"
    skipped = _run_yolo_or_skip(
        state,
        model_name,
        confidence,
        segment=segment,
        task=task,
        family=family,
        skip_message=(
            "Skipped YOLO instance segmentation because the model runtime is unavailable."
            if segment
            else "Skipped YOLO detection because the model runtime is unavailable."
        ),
    )
    if skipped:
        return skipped
    mark_overlay(state, "Instance Segmentation" if segment else "Detection", method)
    return (
        state,
        "Computed configurable YOLO analysis.",
        {
            "runtime": "ultralytics",
            "family": family,
            "task": task,
            "model": model_name,
            "detection_count": len(state.detections),
            "measurement_count": len(state.measurements),
            "detection_classes": detection_class_summary(state.detections),
            "detections": state.detections,
            "measurements": state.measurements,
            **({"instance_count": len(state.measurements)} if segment else {}),
        },
        [],
    )


def apply_universal_segmentation_fallback(
    state: ImageState, method, params: dict[str, Any], _callbacks: RunCallbacks
) -> NodeOutput:
    state.labels, state.measurements, segmentation_summary = (
        universal_segmentation_fallback(state.image, method.id, params)
    )
    mark_overlay(state, "Segmentation", method)
    return (
        state,
        "Computed model-service-compatible pixel segmentation fallback.",
        {
            "runtime": "fallback",
            "model": params.get("variant") or params.get("checkpoint"),
            "segment_count": len(state.measurements),
            "measurement_count": len(state.measurements),
            "measurements": state.measurements,
            **segmentation_summary,
        },
        [],
    )
