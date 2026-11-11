import base64

from fastapi import FastAPI
from pydantic import BaseModel, Field

from utils.accelerator import accelerator_status

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
    images: list[WorkflowImagePayload] = Field(default_factory=list)


app = FastAPI(title="VISTA backend analyze toolbox model service", version="0.1.0")


def _accelerator_status() -> dict:
    return accelerator_status()


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
