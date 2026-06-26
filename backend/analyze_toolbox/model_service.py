import base64
import importlib
import importlib.util
import os
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .contracts import ToolboxExecutionResult, WorkflowGraph, WorkflowImageInput
from .executor import execute_image_workflow
from .registry import get_manifest


class WorkflowImagePayload(BaseModel):
    image_id: str
    filename: str
    content_type: str | None = None
    data_base64: str
    metadata: dict = Field(default_factory=dict)


class WorkflowExecutionPayload(BaseModel):
    workflow: WorkflowGraph
    images: List[WorkflowImagePayload] = Field(default_factory=list)


app = FastAPI(title="VISTA backend analyze toolbox model service", version="0.1.0")


def _accelerator_status() -> dict:
    requested_device = os.environ.get("VISTA_MODEL_SERVICE_DEVICE", "auto")
    status = {
        "requested_device": requested_device,
        "selected_device": "cpu",
        "cuda_available": False,
        "cuda_device_count": 0,
        "cuda_devices": [],
        "mps_available": False,
    }
    torch_spec = importlib.util.find_spec("torch")
    if torch_spec is None:
        status["torch_error"] = "torch is not installed"
        return status
    torch = importlib.import_module("torch")

    try:
        cuda_available = bool(torch.cuda.is_available())
        cuda_device_count = int(torch.cuda.device_count()) if cuda_available else 0
        cuda_devices = [
            torch.cuda.get_device_name(index)
            for index in range(cuda_device_count)
        ]
    except Exception as exc:
        status["cuda_error"] = str(exc)
        cuda_available = False
        cuda_device_count = 0
        cuda_devices = []

    mps_available = False
    try:
        mps_available = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception:
        mps_available = False

    selected_device = "cpu"
    if requested_device not in {"", "auto", "cpu"}:
        selected_device = requested_device
    elif cuda_available and cuda_device_count > 0:
        selected_device = "cuda:0"
    elif mps_available:
        selected_device = "mps"

    status.update({
        "selected_device": selected_device,
        "cuda_available": cuda_available,
        "cuda_device_count": cuda_device_count,
        "cuda_devices": cuda_devices,
        "mps_available": mps_available,
    })
    return status


@app.get("/health")
def health():
    accelerator = _accelerator_status()
    return {
        "status": "ok",
        "service": "backend-analyze-toolbox-models",
        "accelerator": accelerator,
    }


@app.get("/runtime")
def runtime():
    return _accelerator_status()


@app.get("/gpu")
def gpu():
    return _accelerator_status()


@app.get("/manifest")
def manifest():
    return get_manifest()


@app.post("/workflows/execute", response_model=ToolboxExecutionResult)
def execute_workflow(payload: WorkflowExecutionPayload):
    images = [
        WorkflowImageInput(
            image_id=image.image_id,
            filename=image.filename,
            content_type=image.content_type,
            data=base64.b64decode(image.data_base64),
            metadata=image.metadata,
        )
        for image in payload.images
    ]
    return execute_image_workflow(payload.workflow, images)
