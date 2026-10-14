"""Pure Analyze workflow execution helpers."""

from __future__ import annotations

import base64
import binascii
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from analyze_toolbox import ToolboxExecutionResult, WorkflowGraph, WorkflowImageInput
from core import models
from services.analyze import sources as analyze_source_service

ObjectStorageReader = Callable[[str], bytes]
AsyncClientFactory = Callable[..., Any]


def safe_uuid(value: Any) -> uuid.UUID | None:
    """Parse a UUID-like value, returning None for blank or invalid values."""
    if value in (None, ""):
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def decode_inline_image_base64(encoded: str, filename: str) -> bytes:
    """Decode an inline image payload, accepting optional data URL wrappers."""
    trimmed = encoded.strip()
    if trimmed.startswith("data:") and "," in trimmed:
        trimmed = trimmed.split(",", 1)[1]
    try:
        return base64.b64decode(trimmed, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"Inline image data for {filename} is invalid") from exc


def inline_image_bytes_from_metadata(
    metadata: dict[str, Any], filename: str
) -> bytes | None:
    """Return decoded inline image bytes from metadata when present."""
    encoded = metadata.get("analysis_inline_image_base64")
    if not isinstance(encoded, str) or not encoded:
        return None
    return decode_inline_image_base64(encoded, filename)


def workflow_needs_model_service(
    workflow: WorkflowGraph, model_service_method_ids: set[str]
) -> bool:
    """Return whether a workflow contains a model-service method."""
    return any(node.method_id in model_service_method_ids for node in workflow.nodes)


def model_service_image_payload(image: WorkflowImageInput) -> dict[str, Any]:
    """Serialize an execution image for the external model service."""
    return {
        "image_id": str(image.image_id),
        "filename": image.filename,
        "content_type": image.content_type,
        "data_base64": base64.b64encode(image.data).decode("ascii"),
        "metadata": image.metadata,
    }


async def load_execution_images(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    example_image_selection_source_id: str,
    read_object_storage_bytes: ObjectStorageReader,
    s3_bucket: str,
    s3_namespace: str,
    to_thread: Callable[..., Awaitable[Any]],
) -> list[WorkflowImageInput]:
    """Load selected Analyze source images with bytes for workflow execution."""
    input_source = await analyze_source_service.load_default_part_images(db, project_id)
    if workflow.source.kind == "manual_selection":
        selected_image_ids = set(workflow.source.selected_image_ids)
        if workflow.source.example_image_id:
            selected_image_ids.add(workflow.source.example_image_id)
        selected_part_ids = (
            set()
            if workflow.source.id == example_image_selection_source_id
            else set(workflow.source.selected_part_ids)
        )
        image_ids = [
            image.image_id
            for image in input_source.images
            if image.image_id
            and (
                image.image_id in selected_image_ids
                or image.part_id in selected_part_ids
            )
        ]
    else:
        image_ids = [image.image_id for image in input_source.images if image.image_id]

    image_ids = [image_id for image_id in dict.fromkeys(image_ids) if image_id]
    if not image_ids:
        return []

    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.is_(None))
        .where(models.DataInstance.id.in_(image_ids))
    )
    images_by_id = {image.id: image for image in result.scalars().all()}
    execution_images: list[WorkflowImageInput] = []
    for image_id in image_ids:
        image = images_by_id.get(image_id)
        if image is None:
            raise ValueError(
                f"Selected image '{image_id}' is not available for Analyze execution."
            )
        metadata = image.metadata_json if isinstance(image.metadata_json, dict) else {}
        image_bytes = inline_image_bytes_from_metadata(metadata, image.filename)
        if image_bytes is None:
            image_bytes = await to_thread(
                read_object_storage_bytes, image.object_storage_key
            )
        execution_images.append(
            WorkflowImageInput(
                image_id=image.id,
                filename=image.filename,
                content_type=image.content_type,
                data=image_bytes,
                metadata={
                    **metadata,
                    "filename": image.filename,
                    "object_storage_key": image.object_storage_key,
                    "s3_bucket": s3_bucket,
                    "s3_namespace": s3_namespace,
                    "s3_uri": f"s3://{s3_bucket}/{image.object_storage_key}",
                },
            )
        )
    return execution_images


async def execute_workflow_via_model_service(
    workflow: WorkflowGraph,
    images: list[WorkflowImageInput],
    *,
    service_url: str,
    model_service_method_ids: set[str],
    async_client_factory: AsyncClientFactory,
) -> ToolboxExecutionResult | None:
    """Execute a workflow on the configured model service when needed."""
    service_url = service_url.strip().rstrip("/")
    if not service_url or not workflow_needs_model_service(
        workflow, model_service_method_ids
    ):
        return None
    payload = {
        "workflow": workflow.model_dump(mode="json"),
        "images": [model_service_image_payload(image) for image in images],
    }
    async with async_client_factory(timeout=180.0) as client:
        response = await client.post(f"{service_url}/workflows/execute", json=payload)
        response.raise_for_status()
        return ToolboxExecutionResult.model_validate(response.json())
