"""Analyze artifact persistence and inspection-part attachment helpers."""

from __future__ import annotations

import base64
import io
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from analyze_toolbox import ToolboxExecutionResult, WorkflowGraph
from core import models
from repositories import images as image_repository
from repositories import inspection as inspection_repository
from schemas import images as image_schemas
from services.analyze import overlays as analyze_overlay_service
from services.analyze import sources as analyze_source_service

ArtifactUpload = Callable[..., Awaitable[bool]]


async def store_analysis_artifact_image(
    *,
    project_id: uuid.UUID,
    source_image_id: uuid.UUID,
    source_filename: str,
    artifact: dict[str, Any],
    db: AsyncSession,
    current_user: Any,
    bucket_name: str,
    upload_file_to_s3: ArtifactUpload,
) -> models.DataInstance:
    """Persist an image artifact produced by Analyze as a data instance."""
    encoded = artifact.get("data_base64")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("Analyze artifact is missing image data")
    image_bytes = base64.b64decode(encoded)
    filename_suffix = str(
        artifact.get("filename_suffix") or "analyze-overlay.png"
    ).strip()
    source_stem = Path(source_filename or str(source_image_id)).stem
    output_id = uuid.uuid4()
    filename = f"{source_stem}_{output_id.hex[:8]}_{filename_suffix}"
    object_key = f"{project_id}/analysis/{source_image_id}/{output_id}/{filename}"
    content_type = str(artifact.get("content_type") or "image/png")
    uploaded = False
    try:
        uploaded = await upload_file_to_s3(
            bucket_name=bucket_name,
            object_name=object_key,
            file_data=io.BytesIO(image_bytes),
            length=len(image_bytes),
            content_type=content_type,
        )
    except Exception:
        uploaded = False

    artifact_metadata = (
        artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}
    )
    metadata = {
        **artifact_metadata,
        "analysis_output": True,
        "analysis_output_kind": artifact.get("kind") or "overlay_image",
        "analysis_source_image_id": str(source_image_id),
        "analysis_detections": artifact.get("detections")
        if isinstance(artifact.get("detections"), list)
        else [],
        "overlay": artifact.get("kind") == "overlay_image",
        "storage_status": "uploaded" if uploaded else "metadata_inline",
    }
    if not uploaded:
        metadata["analysis_inline_image_base64"] = encoded
    return await image_repository.create_data_instance(
        db=db,
        data_instance=image_schemas.DataInstanceCreate(
            project_id=project_id,
            filename=filename,
            object_storage_key=object_key,
            content_type=content_type,
            size_bytes=len(image_bytes),
            metadata=metadata,
            uploaded_by_user_id=current_user.email,
        ),
        created_by=current_user.email,
    )


async def store_analysis_artifact_volume(
    *,
    project_id: uuid.UUID,
    source_image_id: uuid.UUID,
    source_filename: str,
    artifact: dict[str, Any],
    db: AsyncSession,
    current_user: Any,
) -> models.DataInstance:
    """Persist a volume artifact produced by Analyze as a data instance."""
    object_key = str(artifact.get("object_key") or "").strip()
    if not object_key:
        raise ValueError("Analyze volume artifact is missing object_key")
    source_stem = Path(source_filename or str(source_image_id)).stem
    output_id = uuid.uuid4()
    filename = str(
        artifact.get("filename") or f"{source_stem}_{output_id.hex[:8]}_prediction.npy"
    )
    content_type = str(artifact.get("content_type") or "application/octet-stream")
    artifact_metadata = (
        artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}
    )
    metadata = {
        **artifact_metadata,
        "analysis_output": True,
        "analysis_output_kind": artifact.get("kind") or "volume_overlay",
        "analysis_source_image_id": str(source_image_id),
        "analysis_detections": artifact.get("detections")
        if isinstance(artifact.get("detections"), list)
        else [],
        "overlay": True,
        "storage_status": "uploaded",
        "object_storage_key": object_key,
    }
    return await image_repository.create_data_instance(
        db=db,
        data_instance=image_schemas.DataInstanceCreate(
            project_id=project_id,
            filename=filename,
            object_storage_key=object_key,
            content_type=content_type,
            size_bytes=artifact.get("size_bytes"),
            metadata=metadata,
            uploaded_by_user_id=current_user.email,
        ),
        created_by=current_user.email,
    )


async def attach_analysis_outputs_to_parts(
    *,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    result: ToolboxExecutionResult,
    db: AsyncSession,
    current_user: Any,
    bucket_name: str,
    upload_file_to_s3: ArtifactUpload,
) -> ToolboxExecutionResult:
    """Persist Analyze output artifacts and attach them to inspection-part metadata."""
    source = await analyze_source_service.load_default_part_images(db, project_id)
    source_by_image_id = {
        str(image.image_id): image for image in source.images if image.image_id
    }
    outputs_by_part: dict[uuid.UUID, list[dict[str, Any]]] = {}
    created_outputs = 0
    attached_artifact_keys: set[str] = set()

    for node_result in result.node_results:
        for artifact in node_result.artifacts:
            if artifact.get("kind") not in {"overlay_image", "volume_overlay"}:
                continue
            summary = (
                node_result.summary if isinstance(node_result.summary, dict) else {}
            )
            image_id_raw = analyze_overlay_service.artifact_source_image_identity(
                artifact, summary
            )
            source_record = source_by_image_id.get(str(image_id_raw or ""))
            if not source_record or not source_record.image_id:
                continue
            artifact_identity = str(
                artifact.get("object_key") or artifact.get("data_base64") or ""
            ).strip()
            if artifact_identity and artifact_identity in attached_artifact_keys:
                continue
            if artifact_identity:
                attached_artifact_keys.add(artifact_identity)
            if artifact.get("kind") == "volume_overlay":
                image = await store_analysis_artifact_volume(
                    project_id=project_id,
                    source_image_id=source_record.image_id,
                    source_filename=source_record.filename,
                    artifact=artifact,
                    db=db,
                    current_user=current_user,
                )
            else:
                image = await store_analysis_artifact_image(
                    project_id=project_id,
                    source_image_id=source_record.image_id,
                    source_filename=source_record.filename,
                    artifact=artifact,
                    db=db,
                    current_user=current_user,
                    bucket_name=bucket_name,
                    upload_file_to_s3=upload_file_to_s3,
                )
            artifact_metadata = (
                artifact.get("metadata")
                if isinstance(artifact.get("metadata"), dict)
                else {}
            )
            output_record = {
                "filename": image.filename,
                "image_id": str(image.id),
                "label": str(artifact.get("label") or "Analyze Overlay"),
                "overlay": True,
                "analysis_output": True,
                "analysis_method_id": artifact.get("method_id"),
                "analysis_method_name": artifact.get("method_name"),
                "analysis_detections": artifact.get("detections")
                if isinstance(artifact.get("detections"), list)
                else [],
                "analysis_workflow_name": workflow.name,
                "analysis_source_image_id": str(source_record.image_id),
                "analysis_source_filename": source_record.filename,
                "overlay_base_image_id": str(source_record.image_id),
                "overlay_base_filename": source_record.filename,
                "side": source_record.side or "analyze",
                "modality": "analyze-overlay",
                "slice_axis": source_record.slice_axis,
                "slice_index": source_record.slice_index,
                "content_type": image.content_type,
                "metadata": artifact_metadata,
                **artifact_metadata,
            }
            outputs_by_part.setdefault(source_record.part_id, []).append(output_record)
            created_outputs += 1

    for part_id, output_records in outputs_by_part.items():
        part = await inspection_repository.get_inspection_part(
            db=db, project_id=project_id, part_id=part_id
        )
        if not part:
            continue
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        source_images, analysis_outputs = (
            analyze_overlay_service.split_source_and_analysis_records(metadata)
        )
        overlay_layers = list(metadata.get("overlay_layers") or [])
        analysis_outputs = analyze_overlay_service.append_unique_records(
            analysis_outputs, output_records
        )
        for record in output_records:
            layer_id = f"analyze-{record['image_id']}"
            overlay_layers.append(
                {
                    "id": layer_id,
                    "label": record.get("label") or "Analyze Overlay",
                    "color": "#22c55e",
                    "image_id": record["image_id"],
                    "source_image_id": record["analysis_source_image_id"],
                    "detections": record.get("analysis_detections") or [],
                }
            )
        normalized = {
            **analyze_overlay_service.rebuild_analyze_part_image_maps(
                {
                    **metadata,
                    "source_images": source_images,
                    "analysis_outputs": analysis_outputs,
                }
            ),
            "analysis_outputs": analysis_outputs,
            "overlay_layers": overlay_layers,
        }
        await inspection_repository.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part_id,
            metadata_patch=normalized,
            updated_by=current_user.email,
        )

    if created_outputs == 0:
        return result
    warnings = [
        *result.warnings,
        f"Attached {created_outputs} Analyze overlay output(s) to inspection parts.",
    ]
    return result.model_copy(update={"warnings": warnings})
