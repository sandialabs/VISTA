"""Minimal, replaceable image-segmentation integration surface for VISTA.

The functions deliberately share VISTA's small result contract.  A deployed
application can replace this module with its own implementation without
changing the workflow executor or the integration adapters.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from pydantic import BaseModel, Field


def _score(value: Any, default: float) -> float:
    """Coerce a confidence value to the normalized external API range."""

    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = default
    return max(0.0, min(1.0, numeric))


def _center_box_result(
    image: Any, *, label: str, runtime: str, score: float
) -> dict[str, Any]:
    """Return one centered XYWH box occupying exactly 25% of each dimension."""

    if hasattr(image, "size") and isinstance(image.size, tuple):
        width, height = image.size
    elif hasattr(image, "shape") and len(image.shape) >= 2:
        height, width = image.shape[:2]
    else:
        raise TypeError(
            "image must be a Pillow image or an array-like object with a shape"
        )

    box_width = float(width) * 0.25
    box_height = float(height) * 0.25
    bbox = [
        (float(width) - box_width) / 2.0,
        (float(height) - box_height) / 2.0,
        box_width,
        box_height,
    ]
    return {
        "masks": [
            {
                "segmentation": None,
                "bbox": bbox,
                "area": box_width * box_height,
                "score": score,
                "label": label,
            }
        ],
        "metrics": {"runtime": runtime, "placeholder": True},
    }


class OpenCVSegmentationConfig(BaseModel):
    """Configuration contract used by the deployable OpenCV component."""

    min_mask_area_px: float = Field(default=1.0, ge=0.0)
    min_peak_distance_px: int = Field(default=20, ge=1)
    mean_shift_sp: int = Field(default=21, ge=1)
    mean_shift_sr: int = Field(default=51, ge=1)


class SegmentationInput(BaseModel):
    """Minimal input model matching the deployable component's public contract."""

    model_config = {"arbitrary_types_allowed": True}

    file: str | None = None
    image: Any = None
    run_mode: str = "default"


class OpenCVSegmentation:
    """Drop-in placeholder for the deployment ``OpenCVSegmentation`` class.

    Its constructor, ``from_config`` factory, and ``run(data)`` entry point
    intentionally match the real component.  Replacing this module therefore
    does not require changing VISTA's adapter.
    """

    def __init__(
        self,
        *,
        min_mask_area_px: float = 1.0,
        min_peak_distance_px: int = 20,
        mean_shift_sp: int = 21,
        mean_shift_sr: int = 51,
    ) -> None:
        self.config = OpenCVSegmentationConfig(
            min_mask_area_px=min_mask_area_px,
            min_peak_distance_px=min_peak_distance_px,
            mean_shift_sp=mean_shift_sp,
            mean_shift_sr=mean_shift_sr,
        )

    @staticmethod
    def from_config(config: OpenCVSegmentationConfig) -> OpenCVSegmentation:
        return OpenCVSegmentation(**config.model_dump())

    def run(self, data: Any) -> dict[str, Any]:
        return self._run(data)

    def _run(self, data: Any) -> dict[str, Any]:
        run_mode = "watershed" if data.run_mode == "default" else data.run_mode
        if run_mode != "watershed":
            raise ValueError(f"Unsupported OpenCV segmentation mode: {run_mode}")

        image = self._load_image(data)
        result = _center_box_result(
            image, label="foreground", runtime="opencv_placeholder", score=1.0
        )
        result.update({"backend": "opencv", "mode": run_mode, "raw_output": image})
        return result

    @staticmethod
    def _load_image(data: Any) -> Any:
        if data.file is not None:
            file_path = Path(data.file).expanduser().resolve()
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            # Match cv.imread's BGR channel order for the placeholder contract.
            return np.asarray(Image.open(file_path).convert("RGB"))[:, :, ::-1].copy()
        return data.image


def Yolo(
    image: Any,
    *,
    model: str = "yolo11n-seg.pt",
    conf: float = 0.25,
    iou: float = 0.7,
    **predict_kwargs: Any,
) -> dict[str, Any]:
    """Ultralytics ``YOLO(...).predict(source, conf, iou, ...)`` placeholder."""

    del model, iou, predict_kwargs
    return _center_box_result(
        image, label="object", runtime="yolo_placeholder", score=_score(conf, 0.25)
    )


def anomalib(
    image: Any,
    *,
    model: Any = None,
    threshold: float = 0.5,
    **predict_kwargs: Any,
) -> dict[str, Any]:
    """Anomalib ``Engine.predict(model=..., dataloaders=...)`` style placeholder.

    The image is the inference input while ``model`` and extra prediction
    options provide the same extension points used by an Anomalib Engine.
    """

    del model, predict_kwargs
    return _center_box_result(
        image,
        label="anomaly",
        runtime="anomalib_placeholder",
        score=_score(threshold, 0.5),
    )


def SAM(
    image: Any,
    *,
    point_coords: Any = None,
    point_labels: Any = None,
    box: Any = None,
    multimask_output: bool = False,
    **predict_kwargs: Any,
) -> dict[str, Any]:
    """SAM ``predict(point_coords, point_labels, box, multimask_output)`` placeholder."""

    del point_coords, point_labels, box, multimask_output, predict_kwargs
    return _center_box_result(
        image, label="sam-region", runtime="sam_placeholder", score=1.0
    )


__all__ = [
    "SegmentationInput",
    "OpenCVSegmentationConfig",
    "OpenCVSegmentation",
    "Yolo",
    "anomalib",
    "SAM",
]
