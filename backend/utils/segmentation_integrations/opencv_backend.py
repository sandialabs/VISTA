"""OpenCV segmentation adapter for VISTA local_import placeholders."""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from collections.abc import Callable
from typing import Any

import numpy as np
from pydantic import BaseModel

from ._shared import (
    NativeRuntime,
    SegmentationBackend,
    bytes_from_file_like,
    foreground_fallback_output,
    is_file_like,
    options_from_payload,
    rgb_image_from_payload,
    run_segmenter,
)

_CONFIG_OPTION_NAMES = {
    "min_mask_area_px",
    "min_peak_distance_px",
    "mean_shift_sp",
    "mean_shift_sr",
}
_SUBPROCESS_TIMEOUT_SECONDS = 60.0


class ToolkitSegmentationInput(BaseModel):
    """Local duck-type for tests and monkeypatched OpenCV runtimes."""

    model_config = {"arbitrary_types_allowed": True}

    file: str | None = None
    image: Any = None
    run_mode: str = "default"
    output_mode: str = "default"


def _load_opencv_runtime() -> tuple[type, Callable[..., Any]]:
    """Import the operational OpenCV runtime lazily.

    Importing OpenCV as a native extension can abort the interpreter on some
    CI workers if evaluated during pytest collection. Keeping the import
    behind the operational ``run`` path preserves the real deployment
    dependency while allowing tests to monkeypatch a safe runtime before any
    native OpenCV import happens.
    """
    return _builtin_watershed_runtime()


def _builtin_watershed_runtime() -> tuple[type, Callable[..., Any]]:
    """Return the watershed segmentation runtime (``opencv-python`` only).

    Implements the standard marker-based watershed technique (distance
    transform, local-maxima markers, watershed over the thresholded
    foreground) described at
    https://pyimagesearch.com/2015/11/02/watershed-opencv/.
    """
    import cv2 as cv  # noqa: PLC0415
    from scipy import ndimage  # noqa: PLC0415
    from skimage.feature import peak_local_max  # noqa: PLC0415
    from skimage.segmentation import watershed  # noqa: PLC0415

    class BuiltinSegmentationInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class BuiltinWatershedSegmentation:
        def __init__(self, **config):
            self.config = config

        def run(self, data):
            image = (
                data.image
                if getattr(data, "image", None) is not None
                else cv.imread(str(data.file))
            )
            masks = _watershed_masks(
                cv,
                ndimage,
                peak_local_max,
                watershed,
                image,
                min_mask_area_px=float(self.config.get("min_mask_area_px", 1.0)),
                min_peak_distance_px=int(self.config.get("min_peak_distance_px", 20)),
                mean_shift_sp=int(self.config.get("mean_shift_sp", 21)),
                mean_shift_sr=int(self.config.get("mean_shift_sr", 51)),
            )
            return type(
                "VistaWatershedResult",
                (),
                {
                    "mode": getattr(data, "run_mode", "watershed"),
                    "metadata": {
                        "backend": "opencv",
                        "runtime": "vista.watershed",
                        "masks": masks,
                    },
                },
            )()

    return BuiltinWatershedSegmentation, BuiltinSegmentationInput


def _watershed_masks(
    cv: Any,
    ndimage: Any,
    peak_local_max: Callable[..., Any],
    watershed: Callable[..., Any],
    image: np.ndarray,
    *,
    min_mask_area_px: float,
    min_peak_distance_px: int,
    mean_shift_sp: int,
    mean_shift_sr: int,
) -> list[dict[str, Any]]:
    shifted = cv.pyrMeanShiftFiltering(image, mean_shift_sp, mean_shift_sr)
    gray = cv.cvtColor(shifted, cv.COLOR_BGR2GRAY)
    thresh = cv.threshold(gray, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)[1]

    distance_map = ndimage.distance_transform_edt(thresh)
    local_max_coords = peak_local_max(
        distance_map, min_distance=min_peak_distance_px, labels=thresh
    )

    local_max_mask = np.zeros(distance_map.shape, dtype=bool)
    if local_max_coords.size > 0:
        local_max_mask[tuple(local_max_coords.T)] = True

    markers = ndimage.label(local_max_mask, structure=np.ones((3, 3), dtype=int))[0]
    labels = watershed(-distance_map, markers, mask=thresh.astype(bool))

    masks: list[dict[str, Any]] = []
    for label in (int(value) for value in np.unique(labels) if value > 0):
        mask = np.zeros(gray.shape, dtype="uint8")
        mask[labels == label] = 255

        contours_data = cv.findContours(
            mask.copy(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE
        )
        contours = contours_data[0] if len(contours_data) == 2 else contours_data[1]
        if not contours:
            continue

        contour = max(contours, key=cv.contourArea)
        area = float(cv.contourArea(contour))
        if area < min_mask_area_px:
            continue

        x, y, width, height = cv.boundingRect(contour)
        masks.append(
            {
                "bbox": [float(x), float(y), float(width), float(height)],
                "area": area,
                "score": None,
                "label": f"region_{label}",
            }
        )

    return masks


def _payload_for_subprocess(payload: dict[str, Any]) -> dict[str, Any]:
    child_payload = dict(payload)
    file_value = child_payload.get("file")
    if file_value is not None and is_file_like(file_value):
        child_payload["file"] = None
        child_payload["image_data_base64"] = base64.b64encode(
            bytes_from_file_like(file_value)
        ).decode("ascii")
    return child_payload


def _bgr_array_from_payload(payload: dict[str, Any]) -> np.ndarray:
    return np.asarray(rgb_image_from_payload(payload))[:, :, ::-1].copy()


def _annotate_runtime(result: Any):
    if isinstance(result, dict):
        result.setdefault("metrics", {})["runtime"] = "analysis_toolkit.opencv"
    elif isinstance(getattr(result, "metrics", None), dict):
        result.metrics.setdefault("runtime", "analysis_toolkit.opencv")
    return result


def _json_safe(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return _json_safe(value.model_dump(mode="python"))
    if isinstance(value, np.ndarray):
        return None
    if isinstance(value, dict):
        return {
            str(key): _json_safe(item)
            for key, item in value.items()
            if key != "raw_output"
        }
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _run_native_in_process(
    payload: dict[str, Any], load_runtime: Callable[[], tuple[type, Callable[..., Any]]]
) -> dict[str, Any]:
    options = options_from_payload(payload)
    config = {name: options[name] for name in _CONFIG_OPTION_NAMES if name in options}
    opencv_segmentation_cls, segmentation_input_cls = load_runtime()
    segmenter = opencv_segmentation_cls(**config)

    file_value = payload.get("file")
    if file_value is not None and not is_file_like(file_value):
        data = segmentation_input_cls(
            file=file_value,
            image=None,
            run_mode=payload.get("mode", "default"),
            output_mode=payload.get("output_mode", "default"),
        )
    else:
        data = segmentation_input_cls(
            file=None,
            image=_bgr_array_from_payload(payload),
            run_mode=payload.get("mode", "default"),
            output_mode=payload.get("output_mode", "default"),
        )
    return _annotate_runtime(run_segmenter(segmenter, data))


def _run_native_subprocess(payload: dict[str, Any]) -> dict[str, Any]:
    options = options_from_payload(payload)
    timeout = float(
        options.get("opencv_timeout_seconds")
        or options.get("timeout_seconds")
        or _SUBPROCESS_TIMEOUT_SECONDS
    )
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.utils.segmentation_integrations.opencv_backend",
        ],
        input=json.dumps(_payload_for_subprocess(payload)),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip().splitlines()
        detail = (
            stderr[-1] if stderr else f"process exited with code {completed.returncode}"
        )
        raise RuntimeError(f"OpenCV subprocess failed: {detail}")
    for line in reversed(completed.stdout.splitlines()):
        if line.startswith("__VISTA_OPENCV_RESULT__"):
            return json.loads(line.removeprefix("__VISTA_OPENCV_RESULT__"))
    raise RuntimeError("OpenCV subprocess did not return a result")


def _run_native(payload: dict[str, Any], runtime: NativeRuntime) -> dict[str, Any]:
    if runtime.patched:
        return _run_native_in_process(payload, runtime.load)
    # Real cv2 imports run in a child process so a native crash cannot take
    # down the worker; the gate is checked here, before the child starts.
    runtime.require()
    return _run_native_subprocess(payload)


def _fallback_output(payload: dict[str, Any], reason: str) -> dict[str, Any]:
    output = foreground_fallback_output(
        payload,
        reason,
        backend="opencv",
        display_name="OpenCV",
        label="opencv-fallback-region",
    )
    output["mode"] = str(payload.get("mode") or "default")
    return output


BACKEND = SegmentationBackend(
    display_name="OpenCV",
    module_name=__name__,
    loader_name="_load_opencv_runtime",
    run_native=_run_native,
    fallback=_fallback_output,
)
run = BACKEND.run


def _main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    # The parent process already passed the runtime gate before spawning us.
    result = _json_safe(_run_native_in_process(payload, _load_opencv_runtime))
    print(f"__VISTA_OPENCV_RESULT__{json.dumps(result)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
