"""Method handler that runs registered segmentation component backends."""

from typing import Any

from PIL import Image, ImageDraw

from . import uploaded_predictions
from .overlays import anomaly_score_from_result, heatmap_from_result
from .segmentation import (
    SEGMENTATION_METHOD_BACKENDS,
    SegmentationComponent,
    SegmentationInput,
    pil_image_to_base64,
)
from .workflow_state import ImageState, NodeOutput, RunCallbacks, mark_overlay

FASTAPI_REMOTE_METHOD_ID = "segmentation.fastapi.remote"

_FORWARDED_OPTION_KEYS = (
    "integration_mode",
    "function_path",
    "fastapi_url",
    "request_format",
    "timeout_seconds",
    "job_stall_timeout_seconds",
    "wait_for_completion",
    "job_timeout_seconds",
    "poll_interval_seconds",
)


def fastapi_runtime_message(result) -> str | None:
    metrics = result.metrics if isinstance(result.metrics, dict) else {}
    diagnostics = (
        metrics.get("fastapi_diagnostics")
        if isinstance(metrics.get("fastapi_diagnostics"), dict)
        else {}
    )
    if not diagnostics:
        return None

    def flag(value) -> str:
        return "yes" if value is True else "no" if value is False else "unknown"

    details = [
        f"connected={flag(diagnostics.get('endpoint_connected'))}",
        "endpoint_attempted_execution="
        f"{diagnostics.get('endpoint_attempted_execution') or 'unknown'}",
        f"result_returned={flag(diagnostics.get('result_returned'))}",
        f"overlay_ready={flag(diagnostics.get('result_usable_for_overlay'))}",
    ]
    if diagnostics.get("http_status") is not None:
        details.append(f"http_status={diagnostics['http_status']}")
    if diagnostics.get("remote_job_id"):
        details.append(f"job_id={diagnostics['remote_job_id']}")
    if diagnostics.get("remote_job_status"):
        details.append(f"job_status={diagnostics['remote_job_status']}")
    if diagnostics.get("remote_return_code") is not None:
        details.append(f"return_code={diagnostics['remote_return_code']}")
    if diagnostics.get("failure_stage"):
        details.append(f"failure_stage={diagnostics['failure_stage']}")
    if diagnostics.get("detail"):
        details.append(f"detail={diagnostics['detail']}")
    return "FastAPI diagnostic: " + "; ".join(details) + "."


def _segmentation_options(
    method, params: dict[str, Any], callbacks: RunCallbacks
) -> dict[str, Any]:
    options = dict(params.get("options") or {})
    for key in _FORWARDED_OPTION_KEYS:
        if params.get(key) not in (None, ""):
            options[key] = params.get(key)
    if method.id != FASTAPI_REMOTE_METHOD_ID:
        return options
    options["integration_mode"] = "fastapi"
    options["request_format"] = "gpu_inference_presigned"
    options["disable_proxy"] = True
    options["timeout_seconds"] = float(params.get("timeout_seconds") or 60.0)
    options["wait_for_completion"] = True
    options["job_stall_timeout_seconds"] = float(
        params.get("job_stall_timeout_seconds") or 600.0
    )
    options["poll_interval_seconds"] = float(params.get("poll_interval_seconds") or 2.0)
    options.setdefault("output_prefix", "vista/analyze/predictions")
    if callbacks.cancel_check:
        options["_cancel_check"] = callbacks.cancel_check
    if callbacks.remote_job_callback:
        options["_remote_job_callback"] = callbacks.remote_job_callback
    return options


def _segmentation_input(
    state: ImageState, method, params: dict[str, Any], backend: str, options: dict
) -> SegmentationInput:
    prompts = params.get("prompts") or {}
    return SegmentationInput(
        image_data_base64=pil_image_to_base64(state.image),
        backend=backend,
        mode=str(params.get("mode") or "default"),
        prompts=prompts if isinstance(prompts, dict) else {},
        options=options,
        metadata={
            **state.source_metadata,
            "method_id": method.id,
            "method_name": method.name,
            "filename": params.get("filename")
            or state.source_metadata.get("filename")
            or "vista-analysis-image.png",
        },
    )


def _placeholder_output(state: ImageState, result, backend: str) -> NodeOutput:
    state.labels = None
    state.detections = []
    state.measurements = []
    state.artifact_block_reason = result.metrics.get("message")
    return (
        state,
        result.metrics.get("message", "Segmentation placeholder is not connected."),
        {
            "_node_status": "skipped",
            "runtime": "placeholder",
            "backend": backend,
            "mode": result.mode,
            "mask_count": 0,
            "placeholder": True,
            "connection_required": True,
        },
        [],
    )


def _rasterize_result_masks(
    result, size: tuple[int, int], backend: str
) -> tuple[Image.Image, list[dict[str, Any]], list[dict[str, Any]]]:
    labels = Image.new("L", size, 0)
    draw = ImageDraw.Draw(labels)
    detections = []
    measurements = []
    for index, mask in enumerate(result.masks, start=1):
        bbox = [float(value) for value in (mask.bbox or [])[:4]]
        if len(bbox) == 4:
            x, y, w, h = bbox
            # Pillow rectangles include both endpoints. Convert VISTA's XYWH
            # box (whose width and height are extents) to integer inclusive
            # endpoints so rasterized masks do not gain an extra row/column.
            raster_x = round(x)
            raster_y = round(y)
            raster_width = max(1, round(w))
            raster_height = max(1, round(h))
            draw.rectangle(
                [
                    raster_x,
                    raster_y,
                    raster_x + raster_width - 1,
                    raster_y + raster_height - 1,
                ],
                fill=min(index, 255),
            )
            detections.append(
                {
                    "id": f"{backend}-{index}",
                    "class_name": mask.label or backend,
                    "confidence": mask.score,
                    "bbox": {"x": x, "y": y, "width": w, "height": h},
                }
            )
        measurements.append(
            {
                "label": mask.label or f"{backend}-{index}",
                "area_px": mask.area,
                "bbox": bbox,
                "score": mask.score,
            }
        )
    return labels, detections, measurements


def _apply_uploaded_prediction(
    state: ImageState, method, result
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if method.id != FASTAPI_REMOTE_METHOD_ID or result.masks:
        return {}, []
    uploaded_labels, overlay_summary, artifacts = (
        uploaded_predictions.labels_or_volume_artifact_from_uploaded_prediction(
            result, state.source_image.size
        )
    )
    if uploaded_labels is not None:
        state.labels = uploaded_labels
    return overlay_summary, artifacts


def _completed_summary(
    state: ImageState,
    result,
    backend: str,
    options: dict[str, Any],
    uploaded_overlay_summary: dict[str, Any],
) -> dict[str, Any]:
    summary_metrics = dict(result.metrics)
    if backend == "anomalib" and state.anomaly_score is not None:
        summary_metrics["anomaly_score"] = state.anomaly_score
    return {
        "runtime": str(options.get("integration_mode") or "placeholder"),
        "backend": backend,
        "mode": result.mode,
        "mask_count": len(result.masks),
        "measurement_count": len(state.measurements),
        "detection_count": len(state.detections),
        "metrics": summary_metrics,
        "measurements": state.measurements,
        "detections": state.detections,
        **uploaded_overlay_summary,
        **(
            {"runtime_warning": result.metrics["runtime_warning"]}
            if result.metrics.get("runtime_warning")
            else {}
        ),
    }


def apply_segmentation_component(
    state: ImageState, method, params: dict[str, Any], callbacks: RunCallbacks
) -> NodeOutput:
    backend = SEGMENTATION_METHOD_BACKENDS[method.id]
    options = _segmentation_options(method, params, callbacks)
    data = _segmentation_input(state, method, params, backend, options)
    result = SegmentationComponent().run(data)
    state.heatmap = heatmap_from_result(result, state.source_image.size)
    if backend == "anomalib":
        state.anomaly_score = anomaly_score_from_result(result)
    if result.metrics.get("status") == "placeholder":
        return _placeholder_output(state, result, backend)

    uploaded_overlay_summary, uploaded_artifacts = _apply_uploaded_prediction(
        state, method, result
    )
    labels, state.detections, state.measurements = _rasterize_result_masks(
        result, state.image.size, backend
    )
    if result.masks:
        state.labels = labels
    mark_overlay(
        state,
        "Anomaly Heatmap"
        if backend == "anomalib" and state.heatmap is not None
        else "Segmentation",
        method,
    )
    message = (
        fastapi_runtime_message(result)
        or "Completed segmentation component integration."
    )
    summary = _completed_summary(
        state, result, backend, options, uploaded_overlay_summary
    )
    return state, message, summary, uploaded_artifacts
