import asyncio
import base64
import io
import uuid
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models, schemas
from core.config import settings
from core.database import get_db
import utils.boto3_client as object_storage

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from backend.analyze_toolbox import (
    ToolboxExecutionResult,
    ToolboxManifest,
    WorkflowGraph,
    WorkflowImageInput,
    WorkflowInputSource,
    execute_image_workflow,
    get_manifest,
    validate_workflow,
)
from utils.dependencies import get_current_user, get_project_or_403, get_project_or_403_writable
import utils.crud as crud


router = APIRouter(tags=["Analyze"])
ANALYZE_WORKFLOW_METADATA_KEY = "vista.analyze.workflow"
ANALYZE_OVERLAY_DELETE_RETENTION_HOURS = 48
MODEL_SERVICE_METHOD_IDS = {
    "ml.yolov8.detect",
    "ml.yolov8.segment",
    "ml.yolo.ultralytics",
}


class AnalyzeImageSourceRecord(BaseModel):
    image_id: Optional[uuid.UUID] = None
    filename: str
    part_id: uuid.UUID
    part_serial_number: str
    part_display_name: Optional[str] = None
    modality: Optional[str] = None
    side: Optional[str] = None
    overlay: bool = False
    slice_axis: Optional[str] = None
    slice_index: Optional[int] = None
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AnalyzePartSourceRecord(BaseModel):
    part_id: uuid.UUID
    serial_number: str
    display_name: Optional[str] = None
    image_count: int = 0


class AnalyzeInputSourceResponse(BaseModel):
    project_id: uuid.UUID
    source: WorkflowInputSource
    parts: List[AnalyzePartSourceRecord] = Field(default_factory=list)
    images: List[AnalyzeImageSourceRecord] = Field(default_factory=list)


class AnalyzeDeletedOverlayRecord(BaseModel):
    project_id: uuid.UUID
    part_id: uuid.UUID
    part_serial_number: str
    part_display_name: Optional[str] = None
    image_id: Optional[uuid.UUID] = None
    filename: str
    label: str
    deleted_at: str
    pending_hard_delete_at: str
    deleted_by: Optional[str] = None
    source_image_id: Optional[str] = None
    source_filename: Optional[str] = None


def _metadata_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _serialize_inspection_part(part: models.InspectionPart) -> Dict[str, Any]:
    return {
        "id": part.id,
        "project_id": part.project_id,
        "batch_id": part.batch_id,
        "serial_number": part.serial_number,
        "display_name": part.display_name,
        "metadata": part.metadata_json if isinstance(part.metadata_json, dict) else {},
        "review_state": part.review_state,
        "created_at": part.created_at,
        "updated_at": part.updated_at,
    }


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _overlay_record_image_id(record: Dict[str, Any]) -> str:
    return str(record.get("image_id") or "").strip()


def _record_identity(record: Dict[str, Any]) -> str:
    return _overlay_record_image_id(record) or str(record.get("filename") or "").strip()


def _is_analyze_output_record(record: Dict[str, Any]) -> bool:
    modality = str(record.get("modality") or "").strip().lower()
    return bool(
        record.get("analysis_output")
        or record.get("analysis_source_image_id")
        or record.get("overlay_base_image_id")
        or modality == "analyze-overlay"
    )


def _append_unique_records(existing: List[Dict[str, Any]], additions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged = list(existing)
    index_by_identity = {
        _record_identity(record): index
        for index, record in enumerate(merged)
        if isinstance(record, dict) and _record_identity(record)
    }
    for record in additions:
        if not isinstance(record, dict):
            continue
        identity = _record_identity(record)
        if identity and identity in index_by_identity:
            existing_index = index_by_identity[identity]
            merged[existing_index] = {**merged[existing_index], **record}
            continue
        if identity:
            index_by_identity[identity] = len(merged)
        merged.append(record)
    return merged


def _split_source_and_analysis_records(metadata: Dict[str, Any]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    source_records = metadata.get("source_images")
    source_records = source_records if isinstance(source_records, list) else []
    analysis_records = metadata.get("analysis_outputs")
    analysis_records = analysis_records if isinstance(analysis_records, list) else []
    clean_sources: List[Dict[str, Any]] = []
    moved_analysis: List[Dict[str, Any]] = []
    for record in source_records:
        if not isinstance(record, dict):
            continue
        if _is_analyze_output_record(record):
            moved_analysis.append(record)
        else:
            clean_sources.append(record)
    return clean_sources, _append_unique_records(
        [record for record in analysis_records if isinstance(record, dict)],
        moved_analysis,
    )


def _is_overlay_delete_candidate(record: Dict[str, Any]) -> bool:
    return bool(record.get("overlay_delete_candidate") or record.get("delete_candidate"))


def _is_expired_overlay_delete_candidate(record: Dict[str, Any], now: datetime) -> bool:
    if not _is_overlay_delete_candidate(record):
        return False
    pending_at = _parse_datetime(record.get("pending_hard_delete_at") or record.get("overlay_delete_after"))
    return bool(pending_at and pending_at <= now)


def _without_overlay_delete_fields(record: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = dict(record)
    for field_name in (
        "overlay_delete_candidate",
        "delete_candidate",
        "overlay_deleted_at",
        "deleted_at",
        "pending_hard_delete_at",
        "overlay_delete_after",
        "overlay_deleted_by",
        "deleted_by",
    ):
        cleaned.pop(field_name, None)
    return cleaned


def _rebuild_deleted_overlay_safe_image_maps(metadata: dict) -> dict:
    rebuilt = _rebuild_analyze_part_image_maps(metadata)
    return rebuilt


def _mark_overlay_deleted_in_metadata(
    metadata: Dict[str, Any],
    overlay_image_id: str,
    *,
    now: datetime,
    actor_email: str,
) -> tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    pending_at = now + timedelta(hours=ANALYZE_OVERLAY_DELETE_RETENTION_HOURS)
    deleted_fields = {
        "overlay_delete_candidate": True,
        "delete_candidate": True,
        "overlay_deleted_at": now.isoformat(),
        "deleted_at": now.isoformat(),
        "pending_hard_delete_at": pending_at.isoformat(),
        "overlay_delete_after": pending_at.isoformat(),
        "overlay_deleted_by": actor_email,
        "deleted_by": actor_email,
    }
    found_record: Optional[Dict[str, Any]] = None

    def mark_records(records: Any) -> List[Any]:
        nonlocal found_record
        if not isinstance(records, list):
            return []
        next_records = []
        for record in records:
            if not isinstance(record, dict):
                next_records.append(record)
                continue
            if _overlay_record_image_id(record) == overlay_image_id:
                marked = {**record, **deleted_fields}
                found_record = found_record or marked
                next_records.append(marked)
            else:
                next_records.append(record)
        return next_records

    source_images, analysis_outputs = _split_source_and_analysis_records(metadata)
    next_metadata = {
        **metadata,
        "source_images": mark_records(source_images),
        "analysis_outputs": mark_records(analysis_outputs),
        "overlay_layers": mark_records(metadata.get("overlay_layers")),
    }
    if found_record is None:
        return metadata, None
    return _rebuild_deleted_overlay_safe_image_maps(next_metadata), found_record


def _restore_overlay_in_metadata(metadata: Dict[str, Any], overlay_image_id: str) -> tuple[Dict[str, Any], bool]:
    restored = False

    def restore_records(records: Any) -> List[Any]:
        nonlocal restored
        if not isinstance(records, list):
            return []
        next_records = []
        for record in records:
            if not isinstance(record, dict):
                next_records.append(record)
                continue
            if _overlay_record_image_id(record) == overlay_image_id:
                restored = True
                next_records.append(_without_overlay_delete_fields(record))
            else:
                next_records.append(record)
        return next_records

    source_images, analysis_outputs = _split_source_and_analysis_records(metadata)
    next_metadata = {
        **metadata,
        "source_images": restore_records(source_images),
        "analysis_outputs": restore_records(analysis_outputs),
        "overlay_layers": restore_records(metadata.get("overlay_layers")),
    }
    return _rebuild_deleted_overlay_safe_image_maps(next_metadata), restored


def _record_is_deletable_analyze_overlay(record: Dict[str, Any]) -> bool:
    return bool(
        record.get("overlay")
        or record.get("analysis_output")
        or record.get("analysis_output_kind") == "overlay_image"
    )


def _is_original_project_image(metadata: Dict[str, Any], image_id: str) -> bool:
    records = metadata.get("source_images")
    if not isinstance(records, list):
        return False
    for record in records:
        if not isinstance(record, dict):
            continue
        if _overlay_record_image_id(record) != image_id:
            continue
        if not _record_is_deletable_analyze_overlay(record):
            return True
    return False


def _purge_expired_deleted_overlays_from_metadata(
    metadata: Dict[str, Any],
    *,
    now: datetime,
) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
    source_images, analysis_outputs = _split_source_and_analysis_records(metadata)
    expired_ids = set()
    purged_records: List[Dict[str, Any]] = []
    for records in (source_images, analysis_outputs, metadata.get("overlay_layers")):
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            image_id = _overlay_record_image_id(record)
            if image_id and _is_expired_overlay_delete_candidate(record, now):
                expired_ids.add(image_id)

    if not expired_ids:
        return metadata, []

    def keep_unexpired(records: Any) -> List[Any]:
        if not isinstance(records, list):
            return []
        next_records = []
        for record in records:
            if isinstance(record, dict) and _overlay_record_image_id(record) in expired_ids:
                purged_records.append(record)
                continue
            next_records.append(record)
        return next_records

    next_metadata = {
        **metadata,
        "source_images": keep_unexpired(source_images),
        "analysis_outputs": keep_unexpired(analysis_outputs),
        "overlay_layers": keep_unexpired(metadata.get("overlay_layers")),
    }
    return _rebuild_deleted_overlay_safe_image_maps(next_metadata), purged_records


def _source_images_for_part(part: models.InspectionPart) -> List[Dict[str, Any]]:
    source_images, _analysis_outputs = _split_source_and_analysis_records(_metadata_dict(part.metadata_json))
    return [
        record for record in source_images
        if isinstance(record, dict) and not _is_overlay_delete_candidate(record)
    ]


def _safe_uuid(value: Any) -> Optional[uuid.UUID]:
    if value in (None, ""):
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


async def _load_default_part_images(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> AnalyzeInputSourceResponse:
    parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    image_ids = set()
    filenames = set()
    part_sources: Dict[uuid.UUID, List[Dict[str, Any]]] = {}

    for part in parts:
        records = _source_images_for_part(part)
        part_sources[part.id] = records
        for record in records:
            record_image_id = _safe_uuid(record.get("image_id"))
            if record_image_id:
                image_ids.add(record_image_id)
            filename = str(record.get("filename") or "").strip()
            if filename:
                filenames.add(filename)

    image_lookup: Dict[str, models.DataInstance] = {}
    if image_ids or filenames:
        conditions = [models.DataInstance.project_id == project_id, models.DataInstance.deleted_at.is_(None)]
        image_filters = []
        if image_ids:
            image_filters.append(models.DataInstance.id.in_(image_ids))
        if filenames:
            image_filters.append(models.DataInstance.filename.in_(filenames))
        result = await db.execute(
            select(models.DataInstance).where(*conditions).where(image_filters[0] if len(image_filters) == 1 else image_filters[0] | image_filters[1])
        )
        for image in result.scalars().all():
            image_lookup[str(image.id)] = image
            image_lookup[image.filename] = image

    deduped_images: Dict[str, AnalyzeImageSourceRecord] = {}
    part_records: List[AnalyzePartSourceRecord] = []

    for part in parts:
        image_count = 0
        for record in part_sources.get(part.id, []):
            filename = str(record.get("filename") or "").strip()
            record_image_id = _safe_uuid(record.get("image_id"))
            image = image_lookup.get(str(record_image_id)) if record_image_id else None
            image = image or image_lookup.get(filename)
            if not image and record_image_id:
                continue
            if not image:
                continue
            image_count += 1
            image_metadata = _metadata_dict(image.metadata_json) if image else {}
            source_key = str(image.id) if image else f"{part.id}:{filename}"
            deduped_images[source_key] = AnalyzeImageSourceRecord(
                image_id=image.id if image else record_image_id,
                filename=image.filename if image else filename,
                part_id=part.id,
                part_serial_number=part.serial_number,
                part_display_name=part.display_name,
                modality=record.get("modality") or image_metadata.get("modality"),
                side=record.get("side") or image_metadata.get("side"),
                overlay=bool(record.get("overlay") or image_metadata.get("overlay")),
                slice_axis=record.get("slice_axis") or image_metadata.get("slice_axis"),
                slice_index=record.get("slice_index") if record.get("slice_index") is not None else image_metadata.get("slice_index"),
                content_type=image.content_type if image else None,
                size_bytes=image.size_bytes if image else None,
                metadata=record,
            )
        part_records.append(
            AnalyzePartSourceRecord(
                part_id=part.id,
                serial_number=part.serial_number,
                display_name=part.display_name,
                image_count=image_count,
            )
        )

    images = sorted(
        deduped_images.values(),
        key=lambda item: (
            item.part_serial_number,
            item.slice_index is None,
            item.slice_index if item.slice_index is not None else 0,
            item.filename,
        ),
    )
    return AnalyzeInputSourceResponse(
        project_id=project_id,
        source=WorkflowInputSource(
            project_id=project_id,
            image_count=len(images),
            part_count=len(parts),
        ),
        parts=part_records,
        images=images,
    )


async def _workflow_with_server_source(
    *,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession,
) -> WorkflowGraph:
    if workflow.source.project_id and workflow.source.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow source project_id does not match route project_id",
        )
    input_source = await _load_default_part_images(db, project_id)
    server_source = input_source.source
    if workflow.source.kind == "manual_selection":
        selected_image_ids = set(workflow.source.selected_image_ids)
        selected_part_ids = set(workflow.source.selected_part_ids)
        selected_images = [
            image for image in input_source.images
            if (image.image_id and image.image_id in selected_image_ids) or image.part_id in selected_part_ids
        ]
        selected_parts = {image.part_id for image in selected_images}
        server_source = workflow.source.model_copy(update={
            "project_id": project_id,
            "image_count": len(selected_images),
            "part_count": len(selected_parts),
        })
    return workflow.model_copy(update={"source": server_source})


def _inline_image_bytes(image: models.DataInstance) -> Optional[bytes]:
    metadata = _metadata_dict(image.metadata_json)
    encoded = metadata.get("analysis_inline_image_base64")
    if not isinstance(encoded, str) or not encoded:
        return None
    try:
        return base64.b64decode(encoded)
    except Exception:
        return None


def _read_object_storage_bytes(object_key: str) -> bytes:
    if object_storage.boto3_client is None:
        raise ValueError("Object storage client is not available; cannot execute Analyze workflow on actual image bytes.")
    response = object_storage.boto3_client.get_object(Bucket=settings.S3_BUCKET, Key=object_key)
    body = response.get("Body")
    if body is None:
        raise ValueError(f"Object storage returned no body for '{object_key}'.")
    return body.read()


async def _load_execution_images(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
) -> List[WorkflowImageInput]:
    input_source = await _load_default_part_images(db, project_id)
    if workflow.source.kind == "manual_selection":
        selected_image_ids = set(workflow.source.selected_image_ids)
        if workflow.source.example_image_id:
            selected_image_ids.add(workflow.source.example_image_id)
        selected_part_ids = set(workflow.source.selected_part_ids)
        image_ids = [
            image.image_id for image in input_source.images
            if image.image_id and (image.image_id in selected_image_ids or image.part_id in selected_part_ids)
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
    execution_images: List[WorkflowImageInput] = []
    for image_id in image_ids:
        image = images_by_id.get(image_id)
        if image is None:
            raise ValueError(f"Selected image '{image_id}' is not available for Analyze execution.")
        image_bytes = _inline_image_bytes(image)
        if image_bytes is None:
            image_bytes = await asyncio.to_thread(_read_object_storage_bytes, image.object_storage_key)
        execution_images.append(WorkflowImageInput(
            image_id=image.id,
            filename=image.filename,
            content_type=image.content_type,
            data=image_bytes,
            metadata=_metadata_dict(image.metadata_json),
        ))
    return execution_images


def _workflow_needs_model_service(workflow: WorkflowGraph) -> bool:
    return any(node.method_id in MODEL_SERVICE_METHOD_IDS for node in workflow.nodes)


def _model_service_url() -> str:
    return str(settings.TOOLBOX_MODEL_SERVICE_URL or "").strip().rstrip("/")


def _model_service_image_payload(image: WorkflowImageInput) -> Dict[str, Any]:
    return {
        "image_id": str(image.image_id),
        "filename": image.filename,
        "content_type": image.content_type,
        "data_base64": base64.b64encode(image.data).decode("ascii"),
        "metadata": image.metadata,
    }


async def _execute_workflow_via_model_service(
    workflow: WorkflowGraph,
    images: List[WorkflowImageInput],
) -> Optional[ToolboxExecutionResult]:
    service_url = _model_service_url()
    if not service_url or not _workflow_needs_model_service(workflow):
        return None
    payload = {
        "workflow": workflow.model_dump(mode="json"),
        "images": [_model_service_image_payload(image) for image in images],
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(f"{service_url}/workflows/execute", json=payload)
        response.raise_for_status()
        return ToolboxExecutionResult.model_validate(response.json())


async def _store_analysis_artifact_image(
    *,
    project_id: uuid.UUID,
    source_image_id: uuid.UUID,
    source_filename: str,
    artifact: Dict[str, Any],
    db: AsyncSession,
    current_user: schemas.User,
) -> models.DataInstance:
    encoded = artifact.get("data_base64")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("Analyze artifact is missing image data")
    image_bytes = base64.b64decode(encoded)
    filename_suffix = str(artifact.get("filename_suffix") or "analyze-overlay.png").strip()
    source_stem = Path(source_filename or str(source_image_id)).stem
    output_id = uuid.uuid4()
    filename = f"{source_stem}_{output_id.hex[:8]}_{filename_suffix}"
    object_key = f"{project_id}/analysis/{source_image_id}/{output_id}/{filename}"
    content_type = str(artifact.get("content_type") or "image/png")
    uploaded = False
    try:
        uploaded = await object_storage.upload_file_to_s3(
            bucket_name=settings.S3_BUCKET,
            object_name=object_key,
            file_data=io.BytesIO(image_bytes),
            length=len(image_bytes),
            content_type=content_type,
        )
    except Exception:
        uploaded = False

    metadata = {
        "analysis_output": True,
        "analysis_output_kind": artifact.get("kind") or "overlay_image",
        "analysis_source_image_id": str(source_image_id),
        "analysis_detections": artifact.get("detections") if isinstance(artifact.get("detections"), list) else [],
        "overlay": artifact.get("kind") == "overlay_image",
        "storage_status": "uploaded" if uploaded else "metadata_inline",
    }
    if not uploaded:
        metadata["analysis_inline_image_base64"] = encoded
    image = await crud.create_data_instance(
        db=db,
        data_instance=schemas.DataInstanceCreate(
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
    return image


async def _attach_analysis_outputs_to_parts(
    *,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    result: ToolboxExecutionResult,
    db: AsyncSession,
    current_user: schemas.User,
) -> ToolboxExecutionResult:
    source = await _load_default_part_images(db, project_id)
    source_by_image_id = {
        str(image.image_id): image
        for image in source.images
        if image.image_id
    }
    outputs_by_part: Dict[uuid.UUID, List[Dict[str, Any]]] = {}
    created_outputs = 0

    for node_result in result.node_results:
        image_id_raw = node_result.summary.get("image_id") if isinstance(node_result.summary, dict) else None
        source_record = source_by_image_id.get(str(image_id_raw or ""))
        if not source_record or not source_record.image_id:
            continue
        for artifact in node_result.artifacts:
            if artifact.get("kind") != "overlay_image":
                continue
            image = await _store_analysis_artifact_image(
                project_id=project_id,
                source_image_id=source_record.image_id,
                source_filename=source_record.filename,
                artifact=artifact,
                db=db,
                current_user=current_user,
            )
            output_record = {
                "filename": image.filename,
                "image_id": str(image.id),
                "label": str(artifact.get("label") or "Analyze Overlay"),
                "overlay": True,
                "analysis_output": True,
                "analysis_method_id": artifact.get("method_id"),
                "analysis_method_name": artifact.get("method_name"),
                "analysis_detections": artifact.get("detections") if isinstance(artifact.get("detections"), list) else [],
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
            }
            outputs_by_part.setdefault(source_record.part_id, []).append(output_record)
            created_outputs += 1

    for part_id, output_records in outputs_by_part.items():
        part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
        if not part:
            continue
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        source_images, analysis_outputs = _split_source_and_analysis_records(metadata)
        overlay_layers = list(metadata.get("overlay_layers") or [])
        analysis_outputs = _append_unique_records(analysis_outputs, output_records)
        for record in output_records:
            layer_id = f"analyze-{record['image_id']}"
            overlay_layers.append({
                "id": layer_id,
                "label": record.get("label") or "Analyze Overlay",
                "color": "#22c55e",
                "image_id": record["image_id"],
                "source_image_id": record["analysis_source_image_id"],
                "detections": record.get("analysis_detections") or [],
            })
        normalized = {
            **_rebuild_analyze_part_image_maps({
                **metadata,
                "source_images": source_images,
                "analysis_outputs": analysis_outputs,
            }),
            "analysis_outputs": analysis_outputs,
            "overlay_layers": overlay_layers,
        }
        await crud.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part_id,
            metadata_patch=normalized,
            updated_by=current_user.email,
        )

    if created_outputs == 0:
        return result
    warnings = [*result.warnings, f"Attached {created_outputs} Analyze overlay output(s) to inspection parts."]
    return result.model_copy(update={"warnings": warnings})


def _rebuild_analyze_part_image_maps(metadata: dict) -> dict:
    source_images, analysis_outputs = _split_source_and_analysis_records(metadata)
    view_images: Dict[str, str] = {}
    overlay_images: Dict[str, Dict[str, str]] = {}
    for record in source_images:
        if not isinstance(record, dict):
            continue
        if _is_overlay_delete_candidate(record):
            continue
        filename = str(record.get("filename") or "").strip()
        if not filename:
            continue
        side = str(record.get("side") or "").strip().lower()
        modality = str(record.get("modality") or "").strip().lower() or "image"
        if record.get("overlay"):
            overlay_images.setdefault(side or "analyze", {})[modality] = filename
        elif side and side not in view_images:
            view_images[side] = filename
    for record in analysis_outputs:
        if not isinstance(record, dict):
            continue
        if _is_overlay_delete_candidate(record):
            continue
        filename = str(record.get("filename") or "").strip()
        if not filename:
            continue
        side = str(record.get("side") or "").strip().lower() or "analyze"
        modality = str(record.get("modality") or "").strip().lower() or "analyze-overlay"
        overlay_images.setdefault(side, {})[modality] = filename
    return {
        **metadata,
        "source_images": source_images,
        "analysis_outputs": analysis_outputs,
        "view_images": view_images,
        "overlay_images": overlay_images,
    }


async def _purge_expired_deleted_overlays(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    current_user: schemas.User,
    now: Optional[datetime] = None,
) -> int:
    now = now or datetime.now(timezone.utc)
    purged_count = 0
    parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    for part in parts:
        metadata = _metadata_dict(part.metadata_json)
        next_metadata, purged_records = _purge_expired_deleted_overlays_from_metadata(metadata, now=now)
        if not purged_records:
            continue
        purged_count += len({
            _overlay_record_image_id(record)
            for record in purged_records
            if isinstance(record, dict) and _overlay_record_image_id(record)
        })
        await crud.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part.id,
            metadata_patch=next_metadata,
            updated_by=current_user.email,
        )
    return purged_count


def _deleted_overlay_records_for_part(
    *,
    project_id: uuid.UUID,
    part: models.InspectionPart,
) -> List[AnalyzeDeletedOverlayRecord]:
    metadata = _metadata_dict(part.metadata_json)
    _source_images, records = _split_source_and_analysis_records(metadata)
    deleted: List[AnalyzeDeletedOverlayRecord] = []
    seen = set()
    for record in records:
        if not isinstance(record, dict) or not _is_overlay_delete_candidate(record):
            continue
        image_id_raw = _overlay_record_image_id(record)
        if not image_id_raw or image_id_raw in seen:
            continue
        seen.add(image_id_raw)
        deleted_at = str(record.get("deleted_at") or record.get("overlay_deleted_at") or "")
        pending_at = str(record.get("pending_hard_delete_at") or record.get("overlay_delete_after") or "")
        deleted.append(AnalyzeDeletedOverlayRecord(
            project_id=project_id,
            part_id=part.id,
            part_serial_number=part.serial_number,
            part_display_name=part.display_name,
            image_id=_safe_uuid(image_id_raw),
            filename=str(record.get("filename") or ""),
            label=str(record.get("label") or "Analyze Overlay"),
            deleted_at=deleted_at,
            pending_hard_delete_at=pending_at,
            deleted_by=record.get("deleted_by") or record.get("overlay_deleted_by"),
            source_image_id=record.get("analysis_source_image_id") or record.get("overlay_base_image_id"),
            source_filename=record.get("analysis_source_filename") or record.get("overlay_base_filename"),
        ))
    return deleted


@router.get("/analyze/toolbox", response_model=ToolboxManifest)
async def get_analyze_toolbox(
    current_user: schemas.User = Depends(get_current_user),
):
    _ = current_user
    return get_manifest()


@router.get("/projects/{project_id}/analyze/input-source", response_model=AnalyzeInputSourceResponse)
async def get_analyze_input_source(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return await _load_default_part_images(db, project_id)


@router.get("/projects/{project_id}/analyze/overlays/recently-deleted", response_model=List[AnalyzeDeletedOverlayRecord])
async def list_recently_deleted_analyze_overlays(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    await _purge_expired_deleted_overlays(db=db, project_id=project_id, current_user=current_user)
    parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    deleted_records: List[AnalyzeDeletedOverlayRecord] = []
    for part in parts:
        deleted_records.extend(_deleted_overlay_records_for_part(project_id=project_id, part=part))
    return sorted(deleted_records, key=lambda record: record.deleted_at, reverse=True)


@router.delete("/projects/{project_id}/analyze/overlays/{overlay_image_id}", response_model=schemas.InspectionPart)
async def delete_analyze_overlay(
    project_id: uuid.UUID,
    overlay_image_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403_writable(project_id, db, current_user)
    await _purge_expired_deleted_overlays(db=db, project_id=project_id, current_user=current_user)
    parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    overlay_id = str(overlay_image_id).strip()
    now = datetime.now(timezone.utc)
    for part in parts:
        metadata = _metadata_dict(part.metadata_json)
        if _is_original_project_image(metadata, overlay_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete original project image. Move the image out of the part if you do not want to view it.",
            )
        next_metadata, deleted_record = _mark_overlay_deleted_in_metadata(
            metadata,
            overlay_id,
            now=now,
            actor_email=current_user.email,
        )
        if deleted_record is None:
            continue
        updated = await crud.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part.id,
            metadata_patch=next_metadata,
            updated_by=current_user.email,
        )
        return _serialize_inspection_part(updated)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyze overlay not found")


@router.post("/projects/{project_id}/analyze/overlays/{overlay_image_id}/restore", response_model=schemas.InspectionPart)
async def restore_analyze_overlay(
    project_id: uuid.UUID,
    overlay_image_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403_writable(project_id, db, current_user)
    parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    overlay_id = str(overlay_image_id).strip()
    for part in parts:
        metadata = _metadata_dict(part.metadata_json)
        next_metadata, restored = _restore_overlay_in_metadata(metadata, overlay_id)
        if not restored:
            continue
        updated = await crud.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part.id,
            metadata_patch=next_metadata,
            updated_by=current_user.email,
        )
        return _serialize_inspection_part(updated)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recently deleted Analyze overlay not found")


@router.post("/projects/{project_id}/analyze/workflows/validate", response_model=ToolboxExecutionResult)
async def validate_analyze_workflow(
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    workflow = await _workflow_with_server_source(project_id=project_id, workflow=workflow, db=db)
    try:
        return validate_workflow(workflow)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/projects/{project_id}/analyze/workflows/execute", response_model=ToolboxExecutionResult)
async def execute_analyze_workflow(
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    workflow = await _workflow_with_server_source(project_id=project_id, workflow=workflow, db=db)
    try:
        images = await _load_execution_images(db=db, project_id=project_id, workflow=workflow)
        model_service_warning = None
        try:
            result = await _execute_workflow_via_model_service(workflow, images)
        except Exception as exc:
            result = None
            model_service_warning = f"Configured toolbox model service was unavailable; used local executor fallback ({exc})."
        if result is None:
            result = execute_image_workflow(workflow, images)
            if model_service_warning:
                result = result.model_copy(update={"warnings": [model_service_warning, *result.warnings]})
        return await _attach_analysis_outputs_to_parts(
            project_id=project_id,
            workflow=workflow,
            result=result,
            db=db,
            current_user=current_user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Analyze execution failed: {exc}") from exc
