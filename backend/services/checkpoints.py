"""Checkpoint storage, diagnostics, and workflow-injection helpers for analyze."""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import re
import tempfile
import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta
from pathlib import Path
from typing import Any, BinaryIO
from zipfile import BadZipFile, ZipFile

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from analyze_toolbox import WorkflowGraph
from core import models
from core.config import settings
from core.group_auth_helper import is_user_in_group
from schemas import analyze as analyze_schemas
from schemas import users as user_schemas
from services.errors import (
    ForbiddenError,
    NotFoundError,
    ServiceUnavailableError,
    ValidationFailedError,
)
from services.model_introspection import (
    inspect_checkpoint_bytes,
    inspect_checkpoint_file,
)
from utils import boto3_client as object_storage

CHECKPOINT_STORAGE_PREFIX = "checkpoints"
CHECKPOINT_CACHE_DIR = Path(tempfile.gettempdir()) / "vista-checkpoints"
CHECKPOINT_READ_CHUNK_SIZE = 8 * 1024 * 1024
CHECKPOINT_PLACEHOLDER_METHOD_IDS = {
    "segmentation.yolo.placeholder",
    "segmentation.sam.placeholder",
    "segmentation.anomalib.placeholder",
}
DefaultCheckpointFactory = Callable[
    [AsyncSession, models.Project], Awaitable[models.ModelCheckpoint | None]
]
CheckpointUpload = Callable[..., Awaitable[bool]]
CheckpointTagger = Callable[..., Any]
DEFAULT_YOLO_CHECKPOINT_FILENAME = "yolo11n-seg.pt"
DEFAULT_YOLO_CHECKPOINT_PATH = (
    Path(__file__).resolve().parents[2]
    / "checkpoints"
    / DEFAULT_YOLO_CHECKPOINT_FILENAME
)
DEFAULT_SAM_CHECKPOINT_FILENAME = "sam_vit_b_01ec64.pth"
DEFAULT_SAM_CHECKPOINT_PATH = (
    Path(__file__).resolve().parents[2]
    / "checkpoints"
    / DEFAULT_SAM_CHECKPOINT_FILENAME
)
DEFAULT_ANOMALIB_CHECKPOINT_FILENAME = "default_patchcore.ckpt"
DEFAULT_ANOMALIB_CHECKPOINT_PATH = (
    Path(__file__).resolve().parents[2]
    / "checkpoints"
    / DEFAULT_ANOMALIB_CHECKPOINT_FILENAME
)
logger = logging.getLogger(__name__)


def checkpoint_object_key(
    project_id: uuid.UUID, checkpoint_id: uuid.UUID, filename: str
) -> str:
    """Build the object storage key for an uploaded project checkpoint."""
    return f"{project_id}/{CHECKPOINT_STORAGE_PREFIX}/{checkpoint_id}/{filename}"


def default_yolo_checkpoint_object_key(project_id: uuid.UUID) -> str:
    """Build the object storage key for a project's default YOLO checkpoint."""
    return (
        f"{project_id}/{CHECKPOINT_STORAGE_PREFIX}/default/"
        f"{DEFAULT_YOLO_CHECKPOINT_FILENAME}"
    )


def default_sam_checkpoint_object_key(project_id: uuid.UUID) -> str:
    """Build the object storage key for a project's default SAM checkpoint."""
    return (
        f"{project_id}/{CHECKPOINT_STORAGE_PREFIX}/default/"
        f"{DEFAULT_SAM_CHECKPOINT_FILENAME}"
    )


def default_anomalib_checkpoint_object_key(project_id: uuid.UUID) -> str:
    """Build the object storage key for a project's default Anomalib checkpoint."""
    return (
        f"{project_id}/{CHECKPOINT_STORAGE_PREFIX}/default/"
        f"{DEFAULT_ANOMALIB_CHECKPOINT_FILENAME}"
    )


def method_checkpoint_family(method_id: str) -> str | None:
    """Return the checkpoint family (yolo/sam/anomalib) a method_id requires, if any."""
    if method_id in {
        "segmentation.yolo.placeholder",
        "ml.yolov8.detect",
        "ml.yolov8.segment",
        "ml.yolo.ultralytics",
    }:
        return "yolo"
    if method_id in {"segmentation.sam.placeholder", "ml.sam.segment_anything"}:
        return "sam"
    if method_id == "segmentation.anomalib.placeholder":
        return "anomalib"
    return None


def checkpoint_id_from_params(params: dict[str, Any]) -> uuid.UUID | None:
    """Extract and validate a checkpoint UUID from workflow node parameters."""
    raw_value = params.get("checkpoint_id")
    options = params.get("options") if isinstance(params.get("options"), dict) else {}
    raw_value = raw_value or options.get("checkpoint_id")
    if not raw_value:
        return None
    try:
        return uuid.UUID(str(raw_value))
    except ValueError as exc:
        raise ValidationFailedError("Invalid checkpoint_id") from exc


def metadata_dict(value: Any) -> dict[str, Any]:
    """Return metadata JSON as a dictionary, ignoring non-dict legacy values."""
    return value if isinstance(value, dict) else {}


def checkpoint_record_response(
    checkpoint: models.ModelCheckpoint,
) -> analyze_schemas.CheckpointRecordResponse:
    """Build an Analyze checkpoint response schema from a checkpoint model."""
    diagnostics = metadata_dict(checkpoint.diagnostics)
    return analyze_schemas.CheckpointRecordResponse(
        id=checkpoint.id,
        project_id=checkpoint.project_id,
        meta_group_id=checkpoint.meta_group_id,
        filename=checkpoint.filename,
        object_storage_key=checkpoint.object_storage_key,
        content_type=checkpoint.content_type,
        size_bytes=int(checkpoint.size_bytes or 0),
        sha256=checkpoint.sha256,
        model_family=checkpoint.model_family,
        model_type=str(diagnostics.get("model_type") or checkpoint.model_family),
        model_version=checkpoint.model_version,
        parameter_count=checkpoint.parameter_count,
        diagnostics=diagnostics,
        uploaded_by_user_id=checkpoint.uploaded_by_user_id,
        created_at=checkpoint.created_at,
        updated_at=checkpoint.updated_at,
    )


async def create_uploaded_checkpoint(
    db: AsyncSession,
    *,
    project: models.Project,
    filename: str,
    file_obj: BinaryIO,
    content_type: str,
    diagnostics: dict[str, Any],
    uploaded_by_user_id: str,
    bucket_name: str,
    upload_file_to_s3: CheckpointUpload,
    tag_object: CheckpointTagger | None = None,
    to_thread: Callable[..., Awaitable[Any]] = asyncio.to_thread,
) -> models.ModelCheckpoint:
    """Store an uploaded checkpoint object and persist its database record."""
    size_bytes = int(diagnostics["filesize_bytes"])
    if size_bytes <= 0:
        raise ValidationFailedError("Checkpoint file is empty")
    checkpoint_id = uuid.uuid4()
    object_key = checkpoint_object_key(project.id, checkpoint_id, filename)
    uploaded = await upload_file_to_s3(
        bucket_name=bucket_name,
        object_name=object_key,
        file_data=file_obj,
        length=size_bytes,
        content_type=content_type,
    )
    if not uploaded:
        logger.error(
            "Failed to store checkpoint in object storage "
            "(bucket=%s, key=%s, size_bytes=%s)",
            bucket_name,
            object_key,
            size_bytes,
        )
        raise ServiceUnavailableError(
            "Failed to store checkpoint in object storage. "
            "Check S3/MinIO endpoint reachability, bucket permissions, "
            "and backend logs."
        )
    if tag_object is not None:
        try:
            await to_thread(
                tag_object,
                Bucket=bucket_name,
                Key=object_key,
                Tagging={
                    "TagSet": checkpoint_s3_tags(diagnostics, project.meta_group_id)
                },
            )
        except Exception as exc:
            diagnostics.setdefault("warnings", []).append(
                "Checkpoint stored, but object-storage tagging failed: "
                f"{type(exc).__name__}: {exc}"
            )
    checkpoint = models.ModelCheckpoint(
        id=checkpoint_id,
        project_id=project.id,
        meta_group_id=project.meta_group_id,
        filename=filename,
        object_storage_key=object_key,
        content_type=content_type,
        size_bytes=size_bytes,
        sha256=str(diagnostics["sha256"]),
        model_family=str(diagnostics.get("model_family") or "other"),
        model_version=diagnostics.get("model_version"),
        parameter_count=diagnostics.get("parameter_count"),
        diagnostics=diagnostics,
        uploaded_by_user_id=uploaded_by_user_id,
    )
    db.add(checkpoint)
    await db.commit()
    await db.refresh(checkpoint)
    return checkpoint


def checkpoint_s3_tags(
    diagnostics: dict[str, Any], meta_group_id: str
) -> list[dict[str, str]]:
    """Build the S3 object tags recorded alongside an uploaded checkpoint."""
    model_family = str(diagnostics.get("model_family") or "other")[:128]
    model_version = str(diagnostics.get("model_version") or "unknown")[:128]
    return [
        {"Key": "vista-kind", "Value": "model-checkpoint"},
        {"Key": "model-family", "Value": model_family},
        {"Key": "model-version", "Value": model_version},
        {"Key": "meta-group-id", "Value": meta_group_id[:128]},
    ]


def checkpoint_diagnostics(filename: str, data: bytes) -> dict[str, Any]:
    """Compute checkpoint diagnostics (hash, family, signals) from in-memory bytes."""
    return _checkpoint_diagnostics_from_bytes(
        filename,
        data,
        filesize_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )


def checkpoint_diagnostics_from_file(
    filename: str, file_obj: BinaryIO
) -> dict[str, Any]:
    """Stream-hash a checkpoint file and compute diagnostics without a full load."""
    max_inspection_bytes = max(
        0, int(settings.CHECKPOINT_DEEP_INSPECTION_MAX_BYTES or 0)
    )
    hasher = hashlib.sha256()
    filesize_bytes = 0
    inspection_bytes = bytearray()

    try:
        file_obj.seek(0)
    except Exception as exc:
        logger.warning(
            "Checkpoint upload stream could not seek before diagnostics",
            extra={"error": str(exc), "error_type": type(exc).__name__},
        )

    while True:
        chunk = file_obj.read(CHECKPOINT_READ_CHUNK_SIZE)
        if not chunk:
            break
        filesize_bytes += len(chunk)
        hasher.update(chunk)
        remaining = max_inspection_bytes - len(inspection_bytes)
        if remaining > 0:
            inspection_bytes.extend(chunk[:remaining])

    try:
        file_obj.seek(0)
    except Exception as exc:
        logger.warning(
            "Checkpoint upload stream could not rewind after diagnostics",
            extra={"error": str(exc), "error_type": type(exc).__name__},
        )

    diagnostics = _checkpoint_diagnostics_from_bytes(
        filename,
        bytes(inspection_bytes),
        filesize_bytes=filesize_bytes,
        sha256=hasher.hexdigest(),
        inspection_truncated=filesize_bytes > len(inspection_bytes),
        max_inspection_bytes=max_inspection_bytes,
    )
    if not diagnostics.get("deep_inspection_truncated"):
        local_path = _file_obj_path(file_obj)
        if local_path:
            _merge_model_introspection(diagnostics, local_path, filename)
        elif inspection_bytes and len(inspection_bytes) == filesize_bytes:
            _merge_model_introspection_bytes(
                diagnostics, bytes(inspection_bytes), filename
            )
    return diagnostics


def _checkpoint_diagnostics_from_bytes(
    filename: str,
    data: bytes,
    *,
    filesize_bytes: int,
    sha256: str,
    inspection_truncated: bool = False,
    max_inspection_bytes: int | None = None,
) -> dict[str, Any]:
    safe_name = Path(filename or "checkpoint").name
    suffix = Path(safe_name).suffix.lower()
    diagnostics: dict[str, Any] = {
        "filename": safe_name,
        "filesize_bytes": filesize_bytes,
        "sha256": sha256,
        "extension": suffix,
        "model_family": "other",
        "model_type": "Other",
        "model_version": None,
        "parameter_count": None,
        "parameter_count_kind": None,
        "confidence": "low",
        "deep_inspection_limit_bytes": max_inspection_bytes,
        "deep_inspection_truncated": inspection_truncated,
        "signals": [],
        "warnings": [],
    }
    if inspection_truncated:
        limit_text = _format_bytes(max_inspection_bytes or 0)
        diagnostics["warnings"].append(
            "Deep checkpoint inspection skipped because the file is "
            f"{_format_bytes(filesize_bytes)}, above the configured {limit_text} "
            "inspection limit. Classification uses filename and byte signatures only."
        )
        loaded = None
    else:
        loaded = _load_checkpoint_payload(safe_name, data, diagnostics)
    if loaded is not None:
        _classify_loaded_checkpoint(safe_name, loaded, diagnostics)
    if diagnostics["model_family"] == "other":
        _classify_from_bytes(safe_name, data, diagnostics)
    return diagnostics


def _format_bytes(value: int) -> str:
    if value >= 1024 * 1024 * 1024:
        return f"{value / (1024 * 1024 * 1024):.2f} GB"
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.2f} MB"
    if value >= 1024:
        return f"{value / 1024:.1f} KB"
    return f"{value} B"


async def list_accessible_checkpoints(
    db: AsyncSession,
    *,
    project: models.Project,
    current_user: user_schemas.User,
    scope: str,
    model_family: str | None = None,
) -> list[models.ModelCheckpoint]:
    """List checkpoints visible to the user for the given project or group scope."""
    try:
        query = select(models.ModelCheckpoint)
        if scope == "project":
            query = query.where(models.ModelCheckpoint.project_id == project.id)
        elif scope == "authorized":
            all_projects = (await db.execute(select(models.Project))).scalars().all()
            groups = sorted(
                {
                    p.meta_group_id
                    for p in all_projects
                    if is_user_in_group(current_user.email, p.meta_group_id)
                }
            )
            if not groups:
                return []
            query = query.where(models.ModelCheckpoint.meta_group_id.in_(groups))
        else:
            raise ValidationFailedError("scope must be project or authorized")
        if model_family:
            query = query.where(models.ModelCheckpoint.model_family == model_family)
        result = await db.execute(
            query.order_by(models.ModelCheckpoint.created_at.desc())
        )
        return list(result.scalars().all())
    except SQLAlchemyError as exc:
        if _is_missing_checkpoint_table_error(exc):
            await db.rollback()
            return []
        raise


async def list_checkpoint_response(
    db: AsyncSession,
    *,
    project: models.Project,
    current_user: user_schemas.User,
    scope: str,
    model_family: str | None = None,
) -> analyze_schemas.CheckpointListResponse:
    """Build the checkpoint list response, including default checkpoint diagnostics."""
    default_yolo_checkpoint = await ensure_project_default_yolo_checkpoint(
        db, project=project
    )
    default_sam_checkpoint = await ensure_project_default_sam_checkpoint(
        db, project=project
    )
    default_anomalib_checkpoint = await ensure_project_default_anomalib_checkpoint(
        db, project=project
    )
    checkpoints = await list_accessible_checkpoints(
        db,
        project=project,
        current_user=current_user,
        scope=scope,
        model_family=model_family,
    )
    return analyze_schemas.CheckpointListResponse(
        checkpoints=[
            checkpoint_record_response(checkpoint) for checkpoint in checkpoints
        ],
        diagnostics={
            "endpoint": "/analyze/checkpoints",
            "scope": scope,
            "model_family_filter": model_family,
            "default_yolo_filename": DEFAULT_YOLO_CHECKPOINT_FILENAME,
            "default_yolo_path": str(DEFAULT_YOLO_CHECKPOINT_PATH),
            "default_yolo_file_present": DEFAULT_YOLO_CHECKPOINT_PATH.is_file(),
            "default_yolo_registered": default_yolo_checkpoint is not None,
            "default_yolo_checkpoint_id": str(default_yolo_checkpoint.id)
            if default_yolo_checkpoint is not None
            else None,
            "default_sam_filename": DEFAULT_SAM_CHECKPOINT_FILENAME,
            "default_sam_path": str(DEFAULT_SAM_CHECKPOINT_PATH),
            "default_sam_file_present": DEFAULT_SAM_CHECKPOINT_PATH.is_file(),
            "default_sam_registered": default_sam_checkpoint is not None,
            "default_sam_checkpoint_id": str(default_sam_checkpoint.id)
            if default_sam_checkpoint is not None
            else None,
            "default_anomalib_filename": DEFAULT_ANOMALIB_CHECKPOINT_FILENAME,
            "default_anomalib_path": str(DEFAULT_ANOMALIB_CHECKPOINT_PATH),
            "default_anomalib_file_present": DEFAULT_ANOMALIB_CHECKPOINT_PATH.is_file(),
            "default_anomalib_registered": default_anomalib_checkpoint is not None,
            "default_anomalib_checkpoint_id": str(default_anomalib_checkpoint.id)
            if default_anomalib_checkpoint is not None
            else None,
        },
    )


async def ensure_project_default_yolo_checkpoint(
    db: AsyncSession,
    project: models.Project,
) -> models.ModelCheckpoint | None:
    """Register the project's bundled default YOLO checkpoint if present."""
    return await _ensure_project_default_checkpoint(
        db,
        project=project,
        filename=DEFAULT_YOLO_CHECKPOINT_FILENAME,
        checkpoint_path=DEFAULT_YOLO_CHECKPOINT_PATH,
        object_key=default_yolo_checkpoint_object_key(project.id),
        model_family="yolo",
        model_type="YOLO",
        default_model_version="YOLOv11",
    )


async def ensure_project_default_sam_checkpoint(
    db: AsyncSession,
    project: models.Project,
) -> models.ModelCheckpoint | None:
    """Register the project's bundled default SAM checkpoint if present."""
    return await _ensure_project_default_checkpoint(
        db,
        project=project,
        filename=DEFAULT_SAM_CHECKPOINT_FILENAME,
        checkpoint_path=DEFAULT_SAM_CHECKPOINT_PATH,
        object_key=default_sam_checkpoint_object_key(project.id),
        model_family="sam",
        model_type="SAM",
        default_model_version="SAM1",
    )


async def ensure_project_default_anomalib_checkpoint(
    db: AsyncSession,
    project: models.Project,
) -> models.ModelCheckpoint | None:
    """Register the project's bundled default Anomalib checkpoint if present."""
    return await _ensure_project_default_checkpoint(
        db,
        project=project,
        filename=DEFAULT_ANOMALIB_CHECKPOINT_FILENAME,
        checkpoint_path=DEFAULT_ANOMALIB_CHECKPOINT_PATH,
        object_key=default_anomalib_checkpoint_object_key(project.id),
        model_family="anomalib",
        model_type="Anomalib",
        default_model_version="PatchCore",
    )


_DEFAULT_CHECKPOINT_FACTORIES: dict[str, DefaultCheckpointFactory] = {
    "segmentation.yolo.placeholder": ensure_project_default_yolo_checkpoint,
    "segmentation.sam.placeholder": ensure_project_default_sam_checkpoint,
    "segmentation.anomalib.placeholder": ensure_project_default_anomalib_checkpoint,
}


async def workflow_with_checkpoint_paths(
    *,
    workflow: WorkflowGraph,
    db: AsyncSession,
    current_user: user_schemas.User,
    project: models.Project | None = None,
    materialize: bool = True,
) -> WorkflowGraph:
    """Inject resolved checkpoint identifiers and local paths into workflow nodes."""
    next_nodes = []
    for node in workflow.nodes:
        family = method_checkpoint_family(node.method_id)
        params = dict(node.parameters or {})
        checkpoint_id = checkpoint_id_from_params(params) if family else None
        checkpoint = None
        if (
            checkpoint_id is None
            and node.method_id in CHECKPOINT_PLACEHOLDER_METHOD_IDS
            and project is not None
        ):
            default_factory = _DEFAULT_CHECKPOINT_FACTORIES.get(node.method_id)
            if default_factory is not None:
                checkpoint = await default_factory(db, project)
            checkpoint_id = checkpoint.id if checkpoint is not None else None
        if checkpoint_id is None:
            next_nodes.append(node)
            continue
        if checkpoint is None:
            checkpoint = await get_accessible_checkpoint(
                db, checkpoint_id=checkpoint_id, current_user=current_user
            )
        if checkpoint.model_family != family:
            raise ValidationFailedError(
                f"Checkpoint '{checkpoint.filename}' is tagged for "
                f"{checkpoint.model_family}, not {family}."
            )
        params["checkpoint_id"] = str(checkpoint.id)
        checkpoint_s3_uri = f"s3://{settings.S3_BUCKET}/{checkpoint.object_storage_key}"
        options = dict(params.get("options") or {})
        options.update(
            {
                "checkpoint_id": str(checkpoint.id),
                "checkpoint_object_key": checkpoint.object_storage_key,
                "checkpoint_s3_uri": checkpoint_s3_uri,
                "checkpoint_model_family": checkpoint.model_family,
                "checkpoint_model_version": checkpoint.model_version,
            }
        )
        if materialize:
            checkpoint_path = await materialize_checkpoint_file(
                db, checkpoint_id=checkpoint.id, current_user=current_user
            )
            checkpoint_url = object_storage.get_presigned_download_url(
                settings.S3_BUCKET,
                checkpoint.object_storage_key,
                expires_delta=timedelta(
                    seconds=settings.ML_PRESIGNED_URL_EXPIRY_SECONDS
                ),
            )
            options["checkpoint_path"] = checkpoint_path
            if checkpoint_url:
                options["checkpoint_download_url"] = checkpoint_url
            if family == "yolo":
                options["model"] = checkpoint_path
                options["pretrained_model"] = checkpoint_path
                if node.method_id.startswith("ml.yolo"):
                    params["model"] = checkpoint_path
            elif family == "sam":
                options["model"] = checkpoint_path
                options["model_checkpoint"] = checkpoint_path
                if node.method_id == "ml.sam.segment_anything":
                    params["variant"] = checkpoint_path
            elif family == "anomalib":
                options["model"] = checkpoint_path
                options["checkpoint_path"] = checkpoint_path
        params["options"] = options
        next_nodes.append(node.model_copy(update={"parameters": params}))
    return workflow.model_copy(update={"nodes": next_nodes})


async def _ensure_project_default_checkpoint(
    db: AsyncSession,
    *,
    project: models.Project,
    filename: str,
    checkpoint_path: Path,
    object_key: str,
    model_family: str,
    model_type: str,
    default_model_version: str,
) -> models.ModelCheckpoint | None:
    if not checkpoint_path.exists():
        return None
    try:
        existing = (
            (
                await db.execute(
                    select(models.ModelCheckpoint).where(
                        models.ModelCheckpoint.object_storage_key == object_key
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            return existing

        diagnostics = _bundled_checkpoint_diagnostics(
            filename,
            checkpoint_path,
            model_family=model_family,
            model_type=model_type,
            default_model_version=default_model_version,
        )
        diagnostics.setdefault("signals", []).append("Bundled VISTA default checkpoint")
        diagnostics["builtin_checkpoint_path"] = str(checkpoint_path)

        checkpoint = models.ModelCheckpoint(
            id=uuid.uuid4(),
            project_id=project.id,
            meta_group_id=project.meta_group_id,
            filename=filename,
            object_storage_key=object_key,
            content_type="application/octet-stream",
            size_bytes=int(diagnostics["filesize_bytes"]),
            sha256=str(diagnostics["sha256"]),
            model_family=model_family,
            model_version=diagnostics.get("model_version"),
            parameter_count=diagnostics.get("parameter_count"),
            diagnostics=diagnostics,
            uploaded_by_user_id="system",
        )
        db.add(checkpoint)
        await db.commit()
        await db.refresh(checkpoint)
        return checkpoint
    except SQLAlchemyError as exc:
        await db.rollback()
        if _is_missing_checkpoint_table_error(exc):
            return None
        logger.warning(
            "Default checkpoint seed failed",
            extra={
                "error": str(exc),
                "error_type": type(exc).__name__,
                "model_family": model_family,
                "filename": filename,
            },
        )
        return None


def _bundled_checkpoint_diagnostics(
    filename: str,
    checkpoint_path: Path,
    *,
    model_family: str,
    model_type: str,
    default_model_version: str,
) -> dict[str, Any]:
    hasher = hashlib.sha256()
    filesize_bytes = 0
    with checkpoint_path.open("rb") as checkpoint_file:
        while True:
            chunk = checkpoint_file.read(CHECKPOINT_READ_CHUNK_SIZE)
            if not chunk:
                break
            filesize_bytes += len(chunk)
            hasher.update(chunk)
    return {
        "filename": filename,
        "filesize_bytes": filesize_bytes,
        "sha256": hasher.hexdigest(),
        "extension": checkpoint_path.suffix.lower(),
        "model_family": model_family,
        "model_type": model_type,
        "model_version": default_model_version,
        "parameter_count": None,
        "parameter_count_kind": None,
        "confidence": "high",
        "deep_inspection_limit_bytes": None,
        "deep_inspection_truncated": True,
        "signals": ["Bundled default checkpoint metadata"],
        "warnings": [
            "Bundled default checkpoint deep inspection is skipped during registration."
        ],
    }


def _file_obj_path(file_obj: BinaryIO) -> Path | None:
    raw_name = getattr(file_obj, "name", None)
    if not isinstance(raw_name, str) or raw_name.startswith("<"):
        return None
    path = Path(raw_name)
    return path if path.exists() and path.is_file() else None


def _merge_model_introspection(
    diagnostics: dict[str, Any], path: str | Path, filename: str | None = None
) -> None:
    try:
        details = inspect_checkpoint_file(path, filename)
    except Exception as exc:
        diagnostics.setdefault("warnings", []).append(
            f"Model introspection failed: {type(exc).__name__}: {exc}"
        )
        return
    parameter_count = details.get("parameter_count")
    if parameter_count is not None:
        diagnostics["parameter_count"] = int(parameter_count)
        diagnostics["parameter_count_kind"] = (
            details.get("parameter_count_kind") or "pytorch"
        )
    if details.get("graph"):
        diagnostics["model_graph"] = details["graph"]
    diagnostics.setdefault("warnings", []).extend(details.get("warnings") or [])
    diagnostics.setdefault("signals", []).extend(details.get("signals") or [])


def _merge_model_introspection_bytes(
    diagnostics: dict[str, Any], data: bytes, filename: str | None = None
) -> None:
    try:
        details = inspect_checkpoint_bytes(
            data, filename or str(diagnostics.get("filename") or "checkpoint")
        )
    except Exception as exc:
        diagnostics.setdefault("warnings", []).append(
            f"Model introspection failed: {type(exc).__name__}: {exc}"
        )
        return
    parameter_count = details.get("parameter_count")
    if parameter_count is not None:
        diagnostics["parameter_count"] = int(parameter_count)
        diagnostics["parameter_count_kind"] = (
            details.get("parameter_count_kind") or "pytorch"
        )
    if details.get("graph"):
        diagnostics["model_graph"] = details["graph"]
    diagnostics.setdefault("warnings", []).extend(details.get("warnings") or [])
    diagnostics.setdefault("signals", []).extend(details.get("signals") or [])


def _is_missing_checkpoint_table_error(exc: SQLAlchemyError) -> bool:
    error_text = str(exc).lower()
    return "model_checkpoints" in error_text and any(
        marker in error_text
        for marker in (
            "does not exist",
            "no such table",
            "undefined table",
            "undefinedtable",
        )
    )


async def get_accessible_checkpoint(
    db: AsyncSession,
    *,
    checkpoint_id: uuid.UUID,
    current_user: user_schemas.User,
) -> models.ModelCheckpoint:
    """Fetch a checkpoint by id, enforcing group membership on its project."""
    checkpoint = (
        (
            await db.execute(
                select(models.ModelCheckpoint).where(
                    models.ModelCheckpoint.id == checkpoint_id
                )
            )
        )
        .scalars()
        .first()
    )
    if checkpoint is None:
        raise NotFoundError("Checkpoint not found")
    if not is_user_in_group(current_user.email, checkpoint.meta_group_id):
        raise ForbiddenError("Access forbidden")
    return checkpoint


async def checkpoint_graph_response(
    db: AsyncSession,
    *,
    checkpoint_id: uuid.UUID,
    current_user: user_schemas.User,
) -> analyze_schemas.CheckpointGraphResponse:
    """Build a checkpoint graph response and persist refreshed diagnostics."""
    checkpoint = await get_accessible_checkpoint(
        db, checkpoint_id=checkpoint_id, current_user=current_user
    )
    local_path = await materialize_checkpoint_file(
        db, checkpoint_id=checkpoint_id, current_user=current_user
    )
    details = await asyncio.to_thread(
        inspect_checkpoint_file, local_path, checkpoint.filename
    )
    diagnostics = metadata_dict(checkpoint.diagnostics)
    parameter_count = details.get("parameter_count")
    parameter_count_kind = details.get("parameter_count_kind")
    diagnostics_changed = False
    if parameter_count is not None and parameter_count != checkpoint.parameter_count:
        checkpoint.parameter_count = int(parameter_count)
        diagnostics["parameter_count"] = int(parameter_count)
        diagnostics["parameter_count_kind"] = parameter_count_kind
        diagnostics_changed = True
    if details.get("graph"):
        diagnostics["model_graph"] = details["graph"]
        diagnostics_changed = True
    if diagnostics_changed:
        checkpoint.diagnostics = diagnostics
        await db.commit()
    return analyze_schemas.CheckpointGraphResponse(
        checkpoint_id=checkpoint.id,
        filename=checkpoint.filename,
        parameter_count=parameter_count
        if parameter_count is not None
        else checkpoint.parameter_count,
        parameter_count_kind=parameter_count_kind
        or diagnostics.get("parameter_count_kind"),
        graph=details.get("graph") or diagnostics.get("model_graph") or {},
        warnings=list(details.get("warnings") or []),
    )


async def materialize_checkpoint_file(
    db: AsyncSession,
    *,
    checkpoint_id: uuid.UUID,
    current_user: user_schemas.User,
) -> str:
    """Return a local filesystem path for a checkpoint, downloading it if needed."""
    checkpoint = await get_accessible_checkpoint(
        db, checkpoint_id=checkpoint_id, current_user=current_user
    )
    diagnostics = (
        checkpoint.diagnostics if isinstance(checkpoint.diagnostics, dict) else {}
    )
    builtin_path = diagnostics.get("builtin_checkpoint_path")
    if builtin_path:
        path = Path(str(builtin_path))
        if path.exists() and path.is_file():
            stat = path.stat()
            if stat.st_size == int(checkpoint.size_bytes or 0):
                return str(path)
            logger.error(
                "Bundled checkpoint size mismatch (path=%s, expected_bytes=%s, "
                "actual_bytes=%s)",
                path,
                checkpoint.size_bytes,
                stat.st_size,
            )
            raise ServiceUnavailableError(
                f"Bundled checkpoint '{checkpoint.filename}' exists but its size "
                "does not match the registered record."
            )
        logger.error("Bundled checkpoint missing at %s", path)
        raise ServiceUnavailableError(
            f"Bundled checkpoint '{checkpoint.filename}' is registered but missing."
        )
    CHECKPOINT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    local_path = CHECKPOINT_CACHE_DIR / f"{checkpoint.id}-{checkpoint.filename}"
    if local_path.exists() and local_path.stat().st_size == int(
        checkpoint.size_bytes or 0
    ):
        return str(local_path)
    if object_storage.boto3_client is None:
        raise ServiceUnavailableError("Object storage client is not available")

    def download() -> bytes:
        response = object_storage.boto3_client.get_object(
            Bucket=settings.S3_BUCKET,
            Key=checkpoint.object_storage_key,
        )
        body = response.get("Body")
        if body is None:
            raise RuntimeError("Object storage returned no checkpoint body")
        return body.read()

    data = await asyncio.to_thread(download)
    local_path.write_bytes(data)
    return str(local_path)


def _load_checkpoint_payload(
    filename: str, data: bytes, diagnostics: dict[str, Any]
) -> Any | None:
    suffix = Path(filename).suffix.lower()
    if suffix == ".safetensors":
        return _load_safetensors_payload(data, diagnostics)
    try:
        import torch  # noqa: PLC0415
    except Exception as exc:
        diagnostics["warnings"].append(
            f"PyTorch is not available for deep inspection: {exc}"
        )
        return None
    try:
        return torch.load(io.BytesIO(data), map_location="cpu", weights_only=True)
    except Exception as exc:
        if _is_expected_ultralytics_safe_load_failure(filename, data, exc):
            diagnostics.setdefault("signals", []).append(
                "Ultralytics checkpoint detected; skipped full PyTorch object "
                "inspection to avoid unsafe pickle execution"
            )
            return None
        diagnostics["warnings"].append(f"Safe PyTorch load failed: {exc}")
        return None


def _is_expected_ultralytics_safe_load_failure(
    filename: str, data: bytes, exc: Exception
) -> bool:
    message = str(exc).lower()
    if (
        "weights only load failed" not in message
        and "unsupported global" not in message
    ):
        return False
    if "ultralytics" in message:
        return True
    return "yolo" in filename.lower() or b"ultralytics" in data[:2_000_000].lower()


def _load_safetensors_payload(
    data: bytes, diagnostics: dict[str, Any]
) -> dict[str, Any] | None:
    try:
        from safetensors.torch import load  # noqa: PLC0415
    except Exception as exc:
        diagnostics["warnings"].append(
            f"safetensors is not available for deep inspection: {exc}"
        )
        return None
    try:
        return load(data)
    except Exception as exc:
        diagnostics["warnings"].append(f"safetensors load failed: {exc}")
        return None


def _classify_loaded_checkpoint(
    filename: str, loaded: Any, diagnostics: dict[str, Any]
) -> None:
    top_keys = (
        sorted(str(key) for key in loaded)[:80] if isinstance(loaded, dict) else []
    )
    diagnostics["top_level_keys"] = top_keys
    state = _extract_state_dict(loaded)
    state_keys = sorted(str(key) for key in state) if isinstance(state, dict) else []
    diagnostics["state_key_sample"] = state_keys[:80]
    if state:
        diagnostics["parameter_count"] = _count_tensors(state)
        diagnostics["parameter_count_kind"] = "state_dict_tensor_elements"
    if _looks_like_sam2(state_keys):
        _set_family(
            diagnostics,
            "sam",
            "SAM",
            _sam2_version(filename, state),
            "high",
            "SAM2/SAM2.1 state_dict keys",
        )
    elif _looks_like_sam1(state_keys):
        _set_family(
            diagnostics,
            "sam",
            "SAM",
            _sam1_version(filename, state),
            "high",
            "SAM1 state_dict keys",
        )
    elif _looks_like_anomalib(loaded, state_keys):
        _set_family(
            diagnostics,
            "anomalib",
            "Anomalib",
            _anomalib_version(filename, loaded, state_keys),
            "medium",
            "Lightning/Anomalib checkpoint keys",
        )
    elif _looks_like_yolo(loaded, state_keys, filename):
        _set_family(
            diagnostics,
            "yolo",
            "YOLO",
            _yolo_version(filename, loaded),
            "medium",
            "Ultralytics YOLO checkpoint keys",
        )


def _extract_state_dict(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    for key in ("state_dict", "model"):
        nested = value.get(key)
        if isinstance(nested, dict) and nested:
            return nested
    if value and all(
        hasattr(tensor, "shape") or hasattr(tensor, "numel")
        for tensor in value.values()
    ):
        return value
    return None


def _count_tensors(state: dict[str, Any]) -> int | None:
    total = 0
    found = False
    for tensor in state.values():
        numel = getattr(tensor, "numel", None)
        if callable(numel):
            try:
                total += int(numel())
                found = True
                continue
            except Exception:
                pass
        shape = getattr(tensor, "shape", None)
        if shape is not None:
            count = 1
            for dim in shape:
                count *= int(dim)
            total += count
            found = True
    return total if found else None


def _looks_like_sam1(keys: list[str]) -> bool:
    required = ("image_encoder.", "prompt_encoder.", "mask_decoder.")
    return all(
        any(key.startswith(prefix) for key in keys) for prefix in required
    ) and not any(key.startswith("image_encoder.trunk.") for key in keys)


def _looks_like_sam2(keys: list[str]) -> bool:
    return any(key.startswith("image_encoder.trunk.") for key in keys) and any(
        key.startswith(prefix)
        for prefix in ("memory_attention.", "memory_encoder.", "sam_mask_decoder.")
        for key in keys
    )


def _looks_like_anomalib(loaded: Any, keys: list[str]) -> bool:
    top_keys = set(loaded.keys()) if isinstance(loaded, dict) else set()
    lightning = {"state_dict", "epoch", "global_step"} & top_keys
    anomalib_keys = (
        "model.memory_bank",
        "model.gaussian.",
        "model.teacher",
        "model.student",
        "pre_processor.",
        "post_processor.",
        "evaluator.",
    )
    return bool(lightning) and any(
        any(key.startswith(prefix) for prefix in anomalib_keys) for key in keys
    )


def _looks_like_yolo(loaded: Any, keys: list[str], filename: str) -> bool:
    if re.search(r"\byolo(v?8|11)?", filename, re.IGNORECASE):
        return True
    if isinstance(loaded, dict):
        top_keys = {str(key) for key in loaded}
        if {"train_args", "version"} & top_keys and {"model", "ema"} & top_keys:
            return True
    return any(key.startswith("model.0.conv") for key in keys) and any(
        ".cv2." in key or ".cv3." in key for key in keys
    )


def _shape_of(state: dict[str, Any] | None, key: str) -> tuple[int, ...] | None:
    tensor = state.get(key) if isinstance(state, dict) else None
    shape = getattr(tensor, "shape", None)
    return tuple(int(dim) for dim in shape) if shape is not None else None


def _sam1_version(filename: str, state: dict[str, Any] | None) -> str:
    shape = _shape_of(state, "image_encoder.pos_embed")
    dim = shape[-1] if shape else None
    variant = {768: "vit_b", 1024: "vit_l", 1280: "vit_h"}.get(dim)
    return f"SAM1 {variant}" if variant else "SAM1"


def _sam2_version(filename: str, state: dict[str, Any] | None) -> str:
    lower = filename.lower()
    major = "SAM2.1" if "sam2.1" in lower else "SAM2"
    for token, label in (
        ("tiny", "tiny"),
        ("small", "small"),
        ("base_plus", "base_plus"),
        ("large", "large"),
    ):
        if token in lower:
            return f"{major} {label}"
    return major


def _yolo_version(filename: str, loaded: Any) -> str | None:
    name = filename.lower()
    if isinstance(loaded, dict):
        train_args = loaded.get("train_args")
        if isinstance(train_args, dict):
            name = f"{name} {str(train_args.get('model') or '')}".lower()
    if "yolo11" in name:
        return "YOLOv11"
    if "yolov8" in name or "yolo8" in name:
        return "YOLOv8"
    return "YOLO"


def _anomalib_version(filename: str, loaded: Any, keys: list[str]) -> str | None:
    if any(key.startswith("model.memory_bank") for key in keys):
        return "PatchCore"
    if any(key.startswith("model.gaussian.") or key == "model.idx" for key in keys):
        return "PaDiM"
    if any(key.startswith("model.teacher") for key in keys) and any(
        key.startswith("model.student") for key in keys
    ):
        return "STFPM/EfficientAD"
    if isinstance(loaded, dict) and loaded.get("pytorch-lightning_version"):
        return f"Lightning {loaded['pytorch-lightning_version']}"
    return None


def _classify_from_bytes(
    filename: str, data: bytes, diagnostics: dict[str, Any]
) -> None:
    lower = filename.lower()
    sample = data[:2_000_000].lower()
    if b"ultralytics" in sample or "yolo" in lower:
        _set_family(
            diagnostics,
            "yolo",
            "YOLO",
            _yolo_version(filename, {}),
            "low",
            "filename or pickle metadata mentions YOLO/Ultralytics",
        )
    elif "sam2" in lower or "sam_" in lower or lower.startswith("sam"):
        version = (
            "SAM2.1" if "sam2.1" in lower else "SAM2" if "sam2" in lower else "SAM1"
        )
        _set_family(diagnostics, "sam", "SAM", version, "low", "filename suggests SAM")
    elif "anomalib" in lower or lower.endswith(".ckpt"):
        _set_family(
            diagnostics,
            "anomalib",
            "Anomalib",
            None,
            "low",
            "filename or extension suggests Anomalib/Lightning",
        )
    try:
        with ZipFile(io.BytesIO(data)) as archive:
            names = "\n".join(archive.namelist()).lower()
            if diagnostics["model_family"] == "other" and "ultralytics" in names:
                _set_family(
                    diagnostics,
                    "yolo",
                    "YOLO",
                    _yolo_version(filename, {}),
                    "low",
                    "zip member names mention Ultralytics",
                )
    except BadZipFile:
        pass


def _set_family(
    diagnostics: dict[str, Any],
    family: str,
    model_type: str,
    version: str | None,
    confidence: str,
    signal: str,
) -> None:
    diagnostics["model_family"] = family
    diagnostics["model_type"] = model_type
    diagnostics["model_version"] = version
    diagnostics["confidence"] = confidence
    diagnostics.setdefault("signals", []).append(signal)
