import uuid
from typing import List, Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import Field
from core import schemas
from core.config import settings
from core.database import get_db
from utils.dependencies import get_current_user, get_image_or_403, verify_hmac_signature_flexible
import utils.crud as crud
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

def sanitize_for_log(value: str) -> str:
    """Remove newlines and carriage returns from user input for safe logging."""
    if not isinstance(value, str):
        value = str(value)
    return value.replace('\r', '').replace('\n', '')

router = APIRouter(tags=["ML Analyses"])


# Dependency to get cached request body
async def get_raw_body(request: Request) -> bytes:
    """
    Get raw request body from cache.
    The BodyCacheMiddleware caches the body early in the request lifecycle.
    """
    if hasattr(request.state, "cached_body"):
        return request.state.cached_body
    # Fallback for non-cached requests (shouldn't happen for POST/PATCH/PUT)
    return await request.body()


@router.get("/ml/artifacts/download")
async def get_artifact_download_url(
    path: str,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get presigned download URL for ML artifact (heatmap, mask, etc.)"""
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")

    from utils.boto3_client import get_presigned_download_url, boto3_client
    from datetime import timedelta

    # Validate path starts with ml_outputs/
    if not path.startswith("ml_outputs/"):
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    # Extract analysis_id from path (format: ml_outputs/{analysis_id}/...)
    try:
        parts = path.split("/")
        if len(parts) < 3:
            raise ValueError("Invalid path format")
        analysis_id_str = parts[1]
        import uuid as uuid_lib
        analysis_id = uuid_lib.UUID(analysis_id_str)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid analysis ID in path")

    # Verify user has access to the analysis
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Access check via image
    await get_image_or_403(db_obj.image_id, db, current_user)

    if boto3_client is None:
        # Return mock URL for testing
        logger.warning("S3 client not available, returning mock download URL")
        return {"url": f"https://example.com/download/{path}?signature=fake"}

    # Generate real presigned download URL
    expires_delta = timedelta(seconds=settings.ML_PRESIGNED_URL_EXPIRY_SECONDS)
    download_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=path,
        expires_delta=expires_delta
    )

    if not download_url:
        raise HTTPException(status_code=500, detail="Failed to generate presigned download URL")

    return {"url": download_url}

@router.get("/ml/artifacts/content")
async def get_artifact_content(
    path: str,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Stream ML artifact content directly (proxy endpoint to avoid mixed content issues)"""
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")

    from utils.boto3_client import boto3_client
    from fastapi.responses import StreamingResponse
    from botocore.exceptions import ClientError

    # Validate path starts with ml_outputs/
    if not path.startswith("ml_outputs/"):
        raise HTTPException(status_code=400, detail="Invalid artifact path")

    # Extract analysis_id from path (format: ml_outputs/{analysis_id}/...)
    try:
        parts = path.split("/")
        if len(parts) < 3:
            raise ValueError("Invalid path format")
        analysis_id_str = parts[1]
        import uuid as uuid_lib
        analysis_id = uuid_lib.UUID(analysis_id_str)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid analysis ID in path")

    # Verify user has access to the analysis
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Access check via image
    await get_image_or_403(db_obj.image_id, db, current_user)

    if boto3_client is None:
        logger.error("S3 client not available, cannot stream artifact")
        raise HTTPException(status_code=503, detail="Storage service not available")

    # Stream the object from S3
    try:
        response = boto3_client.get_object(Bucket=settings.S3_BUCKET, Key=path)
        content_type = response.get('ContentType', 'application/octet-stream')

        # Stream the body
        return StreamingResponse(
            response['Body'].iter_chunks(chunk_size=8192),
            media_type=content_type,
            headers={
                'Cache-Control': 'max-age=3600',
                'Content-Disposition': f'inline; filename="{parts[-1]}"'
            }
        )
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code')
        if error_code == 'NoSuchKey':
            logger.warning("Artifact not found in storage", extra={
                "path": sanitize_for_log(path),
                "analysis_id": str(analysis_id)
            })
            raise HTTPException(status_code=404, detail="Artifact not found in storage")
        else:
            logger.error("S3 error retrieving artifact", extra={
                "path": sanitize_for_log(path),
                "error_code": error_code,
                "error": str(e)
            })
            raise HTTPException(status_code=500, detail="Failed to retrieve artifact from storage")
    except Exception as e:
        logger.error("Unexpected error streaming artifact", extra={
            "path": sanitize_for_log(path),
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="Failed to stream artifact") 

@router.post("/images/{image_id}/analyses", response_model=schemas.MLAnalysis, status_code=status.HTTP_201_CREATED)
async def create_ml_analysis(
    image_id: uuid.UUID,
    analysis_in: schemas.MLAnalysisCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    # Ensure path image id matches body
    if image_id != analysis_in.image_id:
        raise HTTPException(status_code=400, detail="Image ID mismatch")
    # Access check
    await get_image_or_403(image_id, db, current_user)
    # Basic per-image limit
    existing = await crud.list_ml_analyses_for_image(db, image_id, 0, settings.ML_MAX_ANALYSES_PER_IMAGE + 1)
    if len(existing) >= settings.ML_MAX_ANALYSES_PER_IMAGE:
        raise HTTPException(status_code=400, detail="Analysis limit reached for this image")
    # Model allow-list check
    allowed = [m.strip() for m in settings.ML_ALLOWED_MODELS.split(',') if m.strip()]
    if analysis_in.model_name not in allowed:
        raise HTTPException(status_code=400, detail="Model not allowed")
    db_obj = await crud.create_ml_analysis(db, analysis_in, requested_by_id=current_user.id, status=settings.ML_DEFAULT_STATUS)
    # Audit log
    logger.info("ML_ANALYSIS_CREATE", extra={
        "analysis_id": str(db_obj.id),
        "image_id": str(db_obj.image_id),
        "model": sanitize_for_log(db_obj.model_name),
        "requested_by": sanitize_for_log(str(current_user.id))
    })
    # Reload with annotations empty
    return schemas.MLAnalysis(
        id=db_obj.id,
        image_id=db_obj.image_id,
        model_name=db_obj.model_name,
        model_version=db_obj.model_version,
        status=db_obj.status,
        error_message=db_obj.error_message,
        parameters=db_obj.parameters,
        provenance=db_obj.provenance,
        requested_by_id=db_obj.requested_by_id,
        external_job_id=db_obj.external_job_id,
        priority=db_obj.priority,
        created_at=db_obj.created_at,
        started_at=db_obj.started_at,
        completed_at=db_obj.completed_at,
        updated_at=db_obj.updated_at,
        annotations=[]
    )

@router.get("/images/{image_id}/analyses", response_model=schemas.MLAnalysisList)
async def list_ml_analyses(
    image_id: uuid.UUID,
    skip: int = 0,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    await get_image_or_403(image_id, db, current_user)
    objs = await crud.list_ml_analyses_for_image(db, image_id, skip, limit)
    total_count = await crud.count_ml_analyses_for_image(db, image_id)
    # Convert to schemas (annotations excluded for list for performance)
    analyses = [
        schemas.MLAnalysis(
            id=o.id,
            image_id=o.image_id,
            model_name=o.model_name,
            model_version=o.model_version,
            status=o.status,
            error_message=o.error_message,
            parameters=o.parameters,
            provenance=o.provenance,
            requested_by_id=o.requested_by_id,
            external_job_id=o.external_job_id,
            priority=o.priority,
            created_at=o.created_at,
            started_at=o.started_at,
            completed_at=o.completed_at,
            updated_at=o.updated_at,
            annotations=[]
        ) for o in objs
    ]
    return schemas.MLAnalysisList(analyses=analyses, total=total_count)

@router.get("/analyses/{analysis_id}", response_model=schemas.MLAnalysis)
async def get_ml_analysis(
    analysis_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")
    # Access via image
    await get_image_or_403(db_obj.image_id, db, current_user)
    # Build response
    annotations = [
        schemas.MLAnnotation(
            id=a.id,
            analysis_id=a.analysis_id,
            annotation_type=a.annotation_type,
            class_name=a.class_name,
            confidence=float(a.confidence) if a.confidence is not None else None,
            data=a.data,
            storage_path=a.storage_path,
            ordering=a.ordering,
            created_at=a.created_at,
        ) for a in db_obj.annotations
    ]
    return schemas.MLAnalysis(
        id=db_obj.id,
        image_id=db_obj.image_id,
        model_name=db_obj.model_name,
        model_version=db_obj.model_version,
        status=db_obj.status,
        error_message=db_obj.error_message,
        parameters=db_obj.parameters,
        provenance=db_obj.provenance,
        requested_by_id=db_obj.requested_by_id,
        external_job_id=db_obj.external_job_id,
        priority=db_obj.priority,
        created_at=db_obj.created_at,
        started_at=db_obj.started_at,
        completed_at=db_obj.completed_at,
        updated_at=db_obj.updated_at,
        annotations=annotations
    )

@router.get("/analyses/{analysis_id}/annotations", response_model=schemas.MLAnnotationList)
async def list_analysis_annotations(
    analysis_id: uuid.UUID,
    skip: int = 0,
    limit: int = Query(200, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")
    # Access via image
    await get_image_or_403(db_obj.image_id, db, current_user)
    anns = await crud.list_ml_annotations(db, analysis_id, skip, limit)
    total_count = await crud.count_ml_annotations(db, analysis_id)
    items = [
        schemas.MLAnnotation(
            id=a.id,
            analysis_id=a.analysis_id,
            annotation_type=a.annotation_type,
            class_name=a.class_name,
            confidence=float(a.confidence) if a.confidence is not None else None,
            data=a.data,
            storage_path=a.storage_path,
            ordering=a.ordering,
            created_at=a.created_at,
        ) for a in anns
    ]
    return schemas.MLAnnotationList(annotations=items, total=total_count)


class StatusUpdatePayload(schemas.BaseModel):  # type: ignore[attr-defined]
    """Minimal payload for status updates (Phase 1)."""
    status: str
    error_message: Optional[str] = None


VALID_STATUS_TRANSITIONS = {
    "queued": {"processing", "canceled"},
    "processing": {"completed", "failed", "canceled"},
}


@router.patch("/analyses/{analysis_id}/status", response_model=schemas.MLAnalysis)
async def update_ml_analysis_status(
    analysis_id: uuid.UUID,
    payload: StatusUpdatePayload,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")

    # Use row-level locking to prevent race conditions in concurrent status updates
    db_obj = await crud.get_ml_analysis_for_update(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")
    # Access via image
    await get_image_or_403(db_obj.image_id, db, current_user)

    new_status = payload.status.lower()
    old_status = (db_obj.status or "").lower()
    # Sanitize status values before logging to avoid log injection
    sanitized_old_status = sanitize_for_log(old_status)
    sanitized_new_status = sanitize_for_log(new_status)
    if old_status == new_status:
        # No-op: status hasn't changed, but keep lock until commit
        await db.commit()  # Release lock
        return await get_ml_analysis(analysis_id, db, current_user)
    allowed = VALID_STATUS_TRANSITIONS.get(old_status, set())
    if new_status not in allowed:
        raise HTTPException(status_code=409, detail=f"Illegal transition {old_status}->{new_status}")

    # Update timestamps
    if new_status == "processing" and not db_obj.started_at:
        db_obj.started_at = datetime.now(timezone.utc)
    if new_status in {"completed", "failed", "canceled"}:
        db_obj.completed_at = datetime.now(timezone.utc)
    db_obj.status = new_status
    if payload.error_message:
        db_obj.error_message = payload.error_message
    await db.commit()
    await db.refresh(db_obj)
    logger.info("ML_ANALYSIS_STATUS", extra={
        "analysis_id": str(db_obj.id),
        "from": sanitized_old_status,
        "to": sanitized_new_status,
        "user": sanitize_for_log(str(current_user.id))
    })
    return await get_ml_analysis(analysis_id, db, current_user)


# ---------------- Phase 2 Callback / Pipeline Endpoints ---------------- #
class BulkAnnotationsPayload(schemas.BaseModel):  # type: ignore[attr-defined]
    annotations: List[schemas.MLAnnotationCreate]
    mode: str = "append"  # append|replace (replace not yet differentiating; future extension)


def _verify_pipeline_hmac(request: Request, body_bytes: bytes):
    """
    Verify HMAC signature for ML pipeline callbacks.

    This function implements dual-layer security for ML pipeline endpoints:
    1. User authentication (API key or user session) - verified by get_current_user() dependency
    2. HMAC signature verification - proves the request comes from an authorized ML pipeline

    The dual-layer approach prevents unauthorized pipelines from making callbacks even if they
    obtain valid user credentials (API keys). HMAC validation is optional when ML_PIPELINE_REQUIRE_HMAC=false
    for backward compatibility during migration.

    Args:
        request: FastAPI request object containing headers
        body_bytes: Raw request body bytes for signature verification

    Raises:
        HTTPException: If HMAC verification fails or is required but not configured
    """
    if not settings.ML_PIPELINE_REQUIRE_HMAC:
        return
    secret = settings.ML_CALLBACK_HMAC_SECRET
    if not secret:
        # Add debug logging to help diagnose why secret may be missing during tests
        logger.warning(
            "ML_HMAC_SECRET_MISSING",
            extra={
                "require_hmac": settings.ML_PIPELINE_REQUIRE_HMAC,
                "configured_secret": bool(secret),
                "settings_id": id(settings),
            },
        )
        raise HTTPException(status_code=500, detail="HMAC secret not configured")
    sig = request.headers.get("X-ML-Signature", "")
    ts = request.headers.get("X-ML-Timestamp", "0")
    if not verify_hmac_signature_flexible(secret, body_bytes, ts, sig):
        raise HTTPException(status_code=401, detail="Invalid HMAC signature")


@router.post("/analyses/{analysis_id}/annotations:bulk", response_model=schemas.MLAnnotationList)
async def bulk_upload_annotations(
    analysis_id: uuid.UUID,
    payload: BulkAnnotationsPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
    body_bytes: bytes = Depends(get_raw_body),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")
    # Access check (user must have image access)
    await get_image_or_403(db_obj.image_id, db, current_user)
    if len(payload.annotations) > settings.ML_MAX_BULK_ANNOTATIONS:
        raise HTTPException(status_code=400, detail="Too many annotations in one request")
    # HMAC verify using the raw original request body
    _verify_pipeline_hmac(request, body_bytes)
    # If mode == replace, we could delete existing first (future). For now always append.
    inserted = await crud.bulk_insert_ml_annotations(db, analysis_id, payload.annotations)
    anns = await crud.list_ml_annotations(db, analysis_id)
    total_count = await crud.count_ml_annotations(db, analysis_id)
    items = [
        schemas.MLAnnotation(
            id=a.id,
            analysis_id=a.analysis_id,
            annotation_type=a.annotation_type,
            class_name=a.class_name,
            confidence=float(a.confidence) if a.confidence is not None else None,
            data=a.data,
            storage_path=a.storage_path,
            ordering=a.ordering,
            created_at=a.created_at,
        ) for a in anns
    ]
    safe_analysis_id = sanitize_for_log(str(analysis_id))
    logger.info("ML_BULK_ANNOTATIONS", extra={"analysis_id": safe_analysis_id, "count": inserted})
    return schemas.MLAnnotationList(annotations=items, total=total_count)


class PresignRequest(schemas.BaseModel):  # type: ignore[attr-defined]
    artifact_type: Literal["heatmap", "mask", "segmentation", "log", "metadata"] = Field(
        ...,
        description="Type of artifact to upload"
    )
    filename: Optional[str] = Field(
        None,
        max_length=255,
        pattern=r'^[a-zA-Z0-9_\-\.]+$',
        description="Filename (alphanumeric, dash, underscore, dot only)"
    )

class PresignResponse(schemas.BaseModel):  # type: ignore[attr-defined]
    upload_url: str
    storage_path: str


@router.post("/analyses/{analysis_id}/artifacts/presign", response_model=PresignResponse)
async def presign_artifact_upload(
    analysis_id: uuid.UUID,
    req: PresignRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
    body_bytes: bytes = Depends(get_raw_body),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")
    await get_image_or_403(db_obj.image_id, db, current_user)
    # Use raw body for HMAC verification
    _verify_pipeline_hmac(request, body_bytes)

    # Generate real presigned upload URL
    from utils.boto3_client import get_presigned_upload_url, boto3_client
    from datetime import timedelta
    import os

    artifact_name = req.filename or f"{req.artifact_type}.bin"

    # Additional path traversal protection (pattern validation in Pydantic should prevent this, but defense in depth)
    if '..' in artifact_name or '/' in artifact_name or '\\' in artifact_name:
        raise HTTPException(status_code=400, detail="Invalid filename: path traversal not allowed")

    # Normalize path to prevent any path traversal attacks
    artifact_name = os.path.basename(artifact_name)
    storage_path = f"ml_outputs/{analysis_id}/{artifact_name}"

    # Determine content type based on artifact type
    content_type_map = {
        "heatmap": "image/png",
        "mask": "image/png",
        "segmentation": "image/png",
        "log": "text/plain",
        "metadata": "application/json"
    }
    content_type = content_type_map.get(req.artifact_type, "application/octet-stream")

    if boto3_client is None:
        # Fallback to fake URL for testing/dev when S3 not available
        logger.warning("S3 client not available, returning mock presigned URL")
        fake_url = f"https://example.com/upload/{storage_path}?signature=fake"
        return PresignResponse(upload_url=fake_url, storage_path=storage_path)

    # Generate real presigned URL
    expires_delta = timedelta(seconds=settings.ML_PRESIGNED_URL_EXPIRY_SECONDS)
    upload_url = get_presigned_upload_url(
        bucket_name=settings.S3_BUCKET,
        object_name=storage_path,
        expires_delta=expires_delta,
        content_type=content_type
    )

    if not upload_url:
        raise HTTPException(status_code=500, detail="Failed to generate presigned upload URL")

    return PresignResponse(upload_url=upload_url, storage_path=storage_path)


class FinalizeRequest(schemas.BaseModel):  # type: ignore[attr-defined]
    status: Optional[str] = None  # typically completed
    error_message: Optional[str] = None

@router.post("/analyses/{analysis_id}/finalize", response_model=schemas.MLAnalysis)
async def finalize_analysis(
    analysis_id: uuid.UUID,
    req: FinalizeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
    body_bytes: bytes = Depends(get_raw_body),
):
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")
    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")
    await get_image_or_403(db_obj.image_id, db, current_user)
    # Use raw body for HMAC verification
    _verify_pipeline_hmac(request, body_bytes)
    if req.status:
        # Special case: allow pipeline to finalize directly from queued -> completed|failed without requiring an explicit
        # intermediate PATCH to "processing". This is convenient for fast/atomic analyses and matches test expectations.
        normalized_new = req.status.lower()
        if db_obj.status == "queued" and normalized_new in {"completed", "failed"}:
            now = datetime.now(timezone.utc)
            if not db_obj.started_at:
                db_obj.started_at = now  # treat as if processing started just now
            db_obj.completed_at = now
            db_obj.status = normalized_new
            if req.error_message:
                db_obj.error_message = req.error_message
            await db.commit()
            await db.refresh(db_obj)
            sanitized_user_id = sanitize_for_log(str(current_user.id))
            logger.info("ML_ANALYSIS_STATUS", extra={
                "analysis_id": str(db_obj.id),
                "from": "queued",
                "to": sanitize_for_log(normalized_new),
                "user": sanitized_user_id
            })
            return db_obj  # Fast path return
        # Otherwise reuse the stricter status update logic (which enforces valid transitions)
        return await update_ml_analysis_status(analysis_id, StatusUpdatePayload(status=req.status, error_message=req.error_message), db, current_user)  # type: ignore
    return await get_ml_analysis(analysis_id, db, current_user)


@router.get("/analyses/{analysis_id}/export")
async def export_analysis(
    analysis_id: uuid.UUID,
    format: Literal["json", "csv"] = Query("json"),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Export full analysis with metadata, annotations, and artifact references.
    Supports JSON (full export) and CSV (annotations only).
    """
    if not settings.ML_ANALYSIS_ENABLED:
        raise HTTPException(status_code=404, detail="ML analysis feature disabled")

    db_obj = await crud.get_ml_analysis(db, analysis_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Access control via image ownership
    await get_image_or_403(db_obj.image_id, db, current_user)

    if format == "json":
        # Full export as JSON
        from fastapi.responses import JSONResponse

        annotations_data = [
            {
                "id": str(a.id),
                "annotation_type": a.annotation_type,
                "class_name": a.class_name,
                "confidence": float(a.confidence) if a.confidence is not None else None,
                "data": a.data,
                "storage_path": a.storage_path,
                "ordering": a.ordering,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in db_obj.annotations
        ]

        export_data = {
            "id": str(db_obj.id),
            "image_id": str(db_obj.image_id),
            "model_name": db_obj.model_name,
            "model_version": db_obj.model_version,
            "status": db_obj.status,
            "error_message": db_obj.error_message,
            "parameters": db_obj.parameters,
            "provenance": db_obj.provenance,
            "requested_by_id": str(db_obj.requested_by_id),
            "external_job_id": db_obj.external_job_id,
            "priority": db_obj.priority,
            "created_at": db_obj.created_at.isoformat() if db_obj.created_at else None,
            "started_at": db_obj.started_at.isoformat() if db_obj.started_at else None,
            "completed_at": db_obj.completed_at.isoformat() if db_obj.completed_at else None,
            "updated_at": db_obj.updated_at.isoformat() if db_obj.updated_at else None,
            "annotations": annotations_data,
            "annotation_count": len(annotations_data),
        }

        return JSONResponse(content=export_data)

    else:  # CSV format - annotations only
        from fastapi.responses import StreamingResponse
        import io
        import csv

        output = io.StringIO()
        writer = csv.writer(output)

        # CSV header
        writer.writerow([
            "annotation_id",
            "annotation_type",
            "class_name",
            "confidence",
            "storage_path",
            "ordering",
            "data_json",
            "created_at"
        ])

        # CSV rows
        for a in db_obj.annotations:
            import json
            writer.writerow([
                str(a.id),
                a.annotation_type,
                a.class_name or "",
                float(a.confidence) if a.confidence is not None else "",
                a.storage_path or "",
                a.ordering or "",
                json.dumps(a.data) if a.data else "",
                a.created_at.isoformat() if a.created_at else "",
            ])

        output.seek(0)

        # Generate filename
        filename = f"analysis_{db_obj.model_name}_{db_obj.created_at.strftime('%Y%m%d_%H%M%S')}.csv"

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
