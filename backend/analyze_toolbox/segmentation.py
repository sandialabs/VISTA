"""SegmentComponent abstraction for user-supplied segmentation integrations.

The placeholders exposed in the Pipeline Studio all flow through this module so
teams can swap a local Python callable or remote FastAPI endpoint without
changing workflow/executor code.
"""

from __future__ import annotations

import base64
import importlib
import io
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Literal, Optional

import requests
from PIL import Image
from pydantic import BaseModel, Field, model_validator
from typing_extensions import Self



class ToolkitBaseModel(BaseModel):
    """Small local equivalent of the deployed toolkit base model."""

    model_config = {"arbitrary_types_allowed": True}


class ToolkitIDBaseModel(ToolkitBaseModel):
    id: Optional[str] = None


class ToolkitComponent(ABC):
    COMPONENT_TYPE: str = "ToolkitComponent"

    @abstractmethod
    def cleanup(self) -> None:
        raise NotImplementedError


class ImageInput(ToolkitIDBaseModel):
    """Common image input model.

    ``image_data_base64`` is used for Pipeline Studio / FastAPI JSON transport.
    ``image`` is available for in-process PIL integrations.
    """

    file: Optional[str] = None
    image: Optional[Image.Image] = Field(default=None, exclude=True)
    image_data_base64: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_source(self) -> Self:
        sources = [self.file is not None, self.image is not None, self.image_data_base64 is not None]
        if sum(sources) != 1:
            raise ValueError('Exactly one of "file", "image", or "image_data_base64" must be provided')
        return self


class ImageOutput(ToolkitIDBaseModel):
    metrics: Dict[str, Any] = Field(default_factory=dict)


class SegmentationMask(ToolkitBaseModel):
    segmentation: Any = None
    bbox: List[float] = Field(default_factory=list)
    area: float | int | None = None
    score: float | None = None
    label: str | None = None


class SegmentationInput(ImageInput):
    backend: Literal["yolo", "anomalib", "sam", "opencv"] = "opencv"
    mode: str = "default"
    prompts: Dict[str, Any] = Field(default_factory=dict)
    options: Dict[str, Any] = Field(default_factory=dict)


class SegmentationOutput(ImageOutput):
    backend: str
    mode: str
    masks: List[SegmentationMask] = Field(default_factory=list)
    raw_output: Any = None


class ImageComponent(ToolkitComponent, ABC):
    COMPONENT_TYPE: str = "ImageComponent"

    @abstractmethod
    def run(self, data: ImageInput) -> ImageOutput:
        raise NotImplementedError

    def _load_image(self, data: ImageInput) -> Image.Image:
        if data.image is not None:
            return data.image.convert("RGB")
        if data.file is not None:
            return Image.open(data.file).convert("RGB")
        if data.image_data_base64 is not None:
            return Image.open(io.BytesIO(base64.b64decode(data.image_data_base64))).convert("RGB")
        raise ValueError('Exactly one of "file", "image", or "image_data_base64" must be provided')


class SegmentationComponent(ImageComponent):
    """Toolkit-facing segmentation component with pluggable backends."""

    COMPONENT_TYPE: str = "SegmentationComponent"

    def run(self, data: SegmentationInput) -> SegmentationOutput:
        integration_mode = str(data.options.get("integration_mode") or "placeholder")
        self._load_image(data)  # validates image input before dispatch

        if integration_mode == "placeholder":
            return SegmentationOutput(
                backend=data.backend,
                mode=data.mode,
                masks=[],
                metrics={
                    "status": "placeholder",
                    "message": f"{data.backend} segmentation placeholder is not connected to an implementation.",
                },
                raw_output=None,
            )
        if integration_mode == "local_import":
            raw = self._run_local_import(data)
        elif integration_mode == "fastapi":
            raw = self._run_fastapi(data)
        else:
            raise ValueError(f"Unsupported segmentation integration_mode: {integration_mode}")
        return self._normalize_result(raw, data.backend, data.mode)

    def _run_local_import(self, data: SegmentationInput) -> Any:
        function_path = str(data.options.get("function_path") or "")
        if not function_path or "." not in function_path:
            raise ValueError("local_import mode requires options.function_path, e.g. my_package.segmenters.run")
        module_name, function_name = function_path.rsplit(".", 1)
        module = importlib.import_module(module_name)
        function = getattr(module, function_name)
        try:
            return function(data)
        except TypeError:
            return function(data.model_dump(mode="python", exclude={"image"}))

    def _run_fastapi(self, data: SegmentationInput) -> Any:
        fastapi_url = str(data.options.get("fastapi_url") or "")
        if not fastapi_url:
            raise ValueError("fastapi mode requires options.fastapi_url")
        payload = data.model_dump(mode="json", exclude={"image"})
        response = requests.post(fastapi_url, json=payload, timeout=float(data.options.get("timeout_seconds", 60)))
        response.raise_for_status()
        return response.json()

    def _normalize_result(self, result: Any, backend: str, mode: str) -> SegmentationOutput:
        if isinstance(result, SegmentationOutput):
            return result
        if isinstance(result, BaseModel):
            result = result.model_dump(mode="python")

        masks_data: List[Any] = []
        metrics: Dict[str, Any] = {}
        if isinstance(result, dict):
            masks_data = result.get("masks", []) or []
            metrics = result.get("metrics", {}) or {}
        elif isinstance(result, list):
            masks_data = result

        masks = [mask if isinstance(mask, SegmentationMask) else SegmentationMask.model_validate(mask) for mask in masks_data]
        return SegmentationOutput(backend=backend, mode=mode, masks=masks, metrics=metrics, raw_output=result)

    def cleanup(self) -> None:
        return None


def pil_image_to_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


SEGMENTATION_METHOD_BACKENDS = {
    "segmentation.yolo.placeholder": "yolo",
    "segmentation.anomalib.placeholder": "anomalib",
    "segmentation.sam.placeholder": "sam",
    "segmentation.opencv.placeholder": "opencv",
}
