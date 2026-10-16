"""Convert FastAPI-uploaded prediction arrays into labels or volume overlays."""

import io
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from core.config import settings

UploadedPrediction = tuple[Image.Image | None, dict[str, Any], list[dict[str, Any]]]


def _uploaded_output_object_key(record: Any, kind: str) -> str | None:
    if isinstance(record, dict) and str(record.get("kind") or "") == kind:
        return str(record.get("object_key") or "") or None
    if isinstance(record, str) and f"/{kind}." in record:
        return (
            record.rsplit("/", 1)[-1]
            if not record.startswith("s3://")
            else "/".join(record.split("/", 3)[3:])
        )
    return None


def _central_volume_slice(array: np.ndarray) -> np.ndarray:
    if array.ndim == 2:
        return array
    if array.ndim == 3:
        return array[array.shape[0] // 2]
    if array.ndim == 4 and array.shape[-1] in {1, 3, 4}:
        return array[array.shape[0] // 2, :, :, 0]
    raise ValueError(f"Unsupported prediction array shape {tuple(array.shape)}")


def _single_image_metadata(array: np.ndarray, channels: int, color_mode: str):
    return {
        "load_mode": "single_image",
        "image_shape": {
            "height": int(array.shape[0]),
            "width": int(array.shape[1]),
        },
        "channel_count": channels,
        "color_mode": color_mode,
        "pixel_dtype": str(array.dtype),
        "voxel_dtype": str(array.dtype),
    }


def _volume_metadata(array: np.ndarray, channels: int, color_mode: str):
    return {
        "load_mode": "volume",
        "volume_shape": {
            "axial": int(array.shape[0]),
            "coronal": int(array.shape[1]),
            "sagittal": int(array.shape[2]),
        },
        "frame_count": int(array.shape[0]),
        "channel_count": channels,
        "color_mode": color_mode,
        "pixel_dtype": str(array.dtype),
        "voxel_dtype": str(array.dtype),
    }


def _channel_color_mode(channels: int) -> str:
    return "rgba" if channels == 4 else "rgb" if channels == 3 else "scalar"


def _prediction_volume_metadata(array: np.ndarray) -> dict[str, Any]:
    if array.ndim == 2:
        return _single_image_metadata(array, 1, "scalar")
    if array.ndim == 3:
        if array.shape[-1] in {3, 4}:
            channels = int(array.shape[-1])
            return _single_image_metadata(
                array, channels, _channel_color_mode(channels)
            )
        return _volume_metadata(array, 1, "scalar")
    if array.ndim == 4 and array.shape[-1] in {1, 3, 4}:
        channels = int(array.shape[-1])
        return _volume_metadata(array, channels, _channel_color_mode(channels))
    raise ValueError(f"Unsupported prediction array shape {tuple(array.shape)}")


def _unavailable(reason: str, prediction_key: str | None = None):
    return (
        None,
        {
            "gpu_prediction_overlay": False,
            **({"gpu_prediction_object_key": prediction_key} if prediction_key else {}),
            "gpu_prediction_overlay_reason": reason,
        },
        [],
    )


def _volume_prediction(
    prediction_array: np.ndarray,
    prediction_key: str,
    prediction_metadata: dict[str, Any],
    uploaded_outputs: list,
    downloaded_bytes: int,
) -> UploadedPrediction:
    class_values, counts = np.unique(prediction_array, return_counts=True)
    class_counts = {
        str(int(value)): int(count)
        for value, count in zip(class_values, counts, strict=False)
        if np.isfinite(value) and int(value) != 0
    }
    size_bytes = next(
        (
            int(record.get("size_bytes"))
            for record in uploaded_outputs
            if isinstance(record, dict)
            and record.get("object_key") == prediction_key
            and record.get("size_bytes") is not None
        ),
        None,
    )
    return (
        None,
        {
            "gpu_prediction_overlay": True,
            "gpu_prediction_overlay_type": "volume",
            "gpu_prediction_object_key": prediction_key,
            "gpu_prediction_shape": list(prediction_array.shape),
            "gpu_prediction_class_counts": class_counts,
        },
        [
            {
                "kind": "volume_overlay",
                "label": "Segmentation Overlay :: FastAPI Segmentation",
                "method_id": "segmentation.fastapi.remote",
                "method_name": "FastAPI Segmentation",
                "object_key": prediction_key,
                "filename": Path(prediction_key).name or "prediction.npy",
                "content_type": "application/octet-stream",
                "size_bytes": size_bytes or downloaded_bytes,
                "metadata": prediction_metadata,
            }
        ],
    )


def _image_prediction(
    prediction_array: np.ndarray,
    prediction_key: str,
    target_size: tuple[int, int],
) -> UploadedPrediction:
    prediction_slice = _central_volume_slice(prediction_array)
    labels_array = np.asarray(prediction_slice)
    labels_array = np.where(labels_array > 0, labels_array, 0)
    if labels_array.max(initial=0) > 255:
        labels_array = np.where(labels_array > 0, 255, 0)
    labels = Image.fromarray(labels_array.astype(np.uint8), mode="L")
    if labels.size != target_size:
        labels = labels.resize(target_size, resample=Image.Resampling.NEAREST)
    class_values, counts = np.unique(labels_array, return_counts=True)
    class_counts = {
        str(int(value)): int(count)
        for value, count in zip(class_values, counts, strict=False)
        if int(value) != 0
    }
    return (
        labels,
        {
            "gpu_prediction_overlay": True,
            "gpu_prediction_overlay_type": "image",
            "gpu_prediction_object_key": prediction_key,
            "gpu_prediction_shape": list(prediction_array.shape),
            "gpu_prediction_slice_shape": list(np.asarray(prediction_slice).shape),
            "gpu_prediction_class_counts": class_counts,
        },
        [],
    )


def labels_or_volume_artifact_from_uploaded_prediction(
    result,
    target_size: tuple[int, int],
) -> UploadedPrediction:
    """Download the reported prediction object and build labels or a volume overlay."""
    metrics = result.metrics if isinstance(result.metrics, dict) else {}
    uploaded_outputs = (
        metrics.get("uploaded_outputs")
        if isinstance(metrics.get("uploaded_outputs"), list)
        else []
    )
    prediction_key = next(
        (
            _uploaded_output_object_key(record, "prediction")
            for record in uploaded_outputs
        ),
        None,
    )
    if not prediction_key:
        return _unavailable("No prediction output object was reported.")

    from utils import boto3_client as object_storage

    if not object_storage.boto3_client:
        return _unavailable("Object storage client is unavailable.")

    buffer = io.BytesIO()
    try:
        object_storage.boto3_client.download_fileobj(
            settings.S3_BUCKET, prediction_key, buffer
        )
        buffer.seek(0)
        prediction_array = np.asarray(np.load(buffer, allow_pickle=False))
        prediction_metadata = _prediction_volume_metadata(prediction_array)
        if prediction_metadata.get("load_mode") == "volume":
            return _volume_prediction(
                prediction_array,
                prediction_key,
                prediction_metadata,
                uploaded_outputs,
                int(buffer.getbuffer().nbytes),
            )
        return _image_prediction(prediction_array, prediction_key, target_size)
    except Exception as exc:
        return _unavailable(str(exc), prediction_key)
