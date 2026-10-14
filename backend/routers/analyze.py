import asyncio
import uuid
from collections.abc import Callable
from typing import Any

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

import utils.boto3_client as object_storage
from analyze_toolbox import (
    AnalyzeExecutionCancelled,
    ToolboxExecutionResult,
    ToolboxManifest,
    WorkflowGraph,
    WorkflowImageInput,
    execute_image_workflow,
    get_manifest,
    validate_workflow,
)
from core import models
from core.config import settings
from core.database import AsyncSessionLocal, get_db
from schemas import analyze as analyze_schemas
from schemas import inspection_parts as inspection_part_schemas
from schemas import users as user_schemas
from services.analyze import artifacts as analyze_artifact_service
from services.analyze import execution as analyze_execution_service
from services.analyze import overlays as analyze_overlay_service
from services.analyze import runs as analyze_run_service
from services.analyze import sources as analyze_source_service
from services.checkpoints import (
    checkpoint_diagnostics_from_file,
    checkpoint_graph_response,
    checkpoint_record_response,
    create_uploaded_checkpoint,
    list_checkpoint_response,
    workflow_with_checkpoint_paths,
)
from utils.dependencies import (
    get_current_user,
    get_project_or_403,
    get_project_or_403_writable,
)
from utils.file_security import sanitize_filename

router = APIRouter(tags=["Analyze"])
ANALYZE_WORKFLOW_METADATA_KEY = "vista.analyze.workflow"
ANALYZE_OVERLAY_DELETE_RETENTION_HOURS = 48
MODEL_SERVICE_METHOD_IDS = {
    "ml.yolov8.detect",
    "ml.yolov8.segment",
    "ml.yolo.ultralytics",
}
EXAMPLE_IMAGE_SELECTION_SOURCE_ID = "example-image-selection"


def _analyze_run_snapshot(run_id: str) -> analyze_schemas.AnalyzeRunStatusResponse:
    record = analyze_run_service.analyze_run_record(run_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Analyze run not found"
        )
    remote_jobs = analyze_run_service.refresh_remote_job_snapshots(record)
    return analyze_schemas.AnalyzeRunStatusResponse(
        run_id=run_id,
        status=str(record.get("status") or "unknown"),
        result=record.get("result"),
        error=record.get("error"),
        remote_jobs=remote_jobs,
    )


async def _execute_workflow_with_fallback(
    workflow: WorkflowGraph,
    images: list[WorkflowImageInput],
    *,
    cancel_check: Callable[[], bool] | None,
    remote_job_callback: Callable[[str, str], None] | None,
) -> ToolboxExecutionResult:
    model_service_warning = None
    try:
        result = await analyze_execution_service.execute_workflow_via_model_service(
            workflow,
            images,
            service_url=str(settings.TOOLBOX_MODEL_SERVICE_URL or ""),
            model_service_method_ids=MODEL_SERVICE_METHOD_IDS,
            async_client_factory=httpx.AsyncClient,
        )
    except Exception as exc:
        result = None
        model_service_warning = f"Configured toolbox model service was unavailable; used local executor fallback ({exc})."
    if result is None:
        result = await asyncio.to_thread(
            execute_image_workflow,
            workflow,
            images,
            cancel_check=cancel_check,
            remote_job_callback=remote_job_callback,
        )
        if model_service_warning:
            result = result.model_copy(
                update={"warnings": [model_service_warning, *result.warnings]}
            )
    return result


def _remote_job_registrar(run_id: str) -> Callable[[str, str], None]:
    def register(fastapi_url: str, job_id: str) -> None:
        analyze_run_service.register_remote_analyze_job(run_id, fastapi_url, job_id)

    return register


async def _execute_analyze_workflow_body(
    *,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession,
    current_user: user_schemas.User,
    run_id: str | None = None,
) -> ToolboxExecutionResult:
    cancel_event = analyze_run_service.start_analyze_run(run_id) if run_id else None
    cancel_check = cancel_event.is_set if cancel_event else None
    images = await analyze_execution_service.load_execution_images(
        db=db,
        project_id=project_id,
        workflow=workflow,
        example_image_selection_source_id=EXAMPLE_IMAGE_SELECTION_SOURCE_ID,
        read_object_storage_bytes=_read_object_storage_bytes,
        s3_bucket=settings.S3_BUCKET,
        s3_namespace=settings.S3_NAMESPACE,
        to_thread=asyncio.to_thread,
    )
    result = await _execute_workflow_with_fallback(
        workflow,
        images,
        cancel_check=cancel_check,
        remote_job_callback=_remote_job_registrar(run_id) if run_id else None,
    )
    if cancel_check and cancel_check():
        raise AnalyzeExecutionCancelled(
            "Analyze workflow execution was stopped by the user."
        )
    attached_result = await analyze_artifact_service.attach_analysis_outputs_to_parts(
        project_id=project_id,
        workflow=workflow,
        result=result,
        db=db,
        current_user=current_user,
        bucket_name=settings.S3_BUCKET,
        upload_file_to_s3=object_storage.upload_file_to_s3,
    )
    if run_id:
        analyze_run_service.mark_analyze_run(
            run_id, status=attached_result.status, result=attached_result, error=None
        )
    return attached_result


def _read_object_storage_bytes(object_key: str) -> bytes:
    if object_storage.boto3_client is None:
        raise ValueError(
            "Object storage client is not available; cannot execute Analyze workflow on actual image bytes."
        )
    response = object_storage.boto3_client.get_object(
        Bucket=settings.S3_BUCKET, Key=object_key
    )
    body = response.get("Body")
    if body is None:
        raise ValueError(f"Object storage returned no body for '{object_key}'.")
    return body.read()


async def _execute_analyze_workflow_background(
    *,
    run_id: str,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    current_user: user_schemas.User,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            await _execute_analyze_workflow_body(
                project_id=project_id,
                workflow=workflow,
                db=db,
                current_user=current_user,
                run_id=run_id,
            )
        except AnalyzeExecutionCancelled as exc:
            cancelled = ToolboxExecutionResult(
                workflow_name=workflow.name,
                status="failed",
                execution_mode="execution",
                image_count=0,
                warnings=[str(exc)],
            )
            analyze_run_service.mark_analyze_run(
                run_id, status="stopped", result=cancelled, error=str(exc)
            )
        except Exception as exc:
            analyze_run_service.mark_analyze_run(
                run_id, status="failed", error=str(exc)
            )


def _serialize_inspection_part(part: models.InspectionPart) -> dict[str, Any]:
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


async def _workflow_with_server_source(
    *,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession,
) -> WorkflowGraph:
    try:
        return await analyze_source_service.workflow_with_server_source(
            project_id=project_id,
            workflow=workflow,
            db=db,
            example_image_selection_source_id=EXAMPLE_IMAGE_SELECTION_SOURCE_ID,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/analyze/toolbox", response_model=ToolboxManifest)
async def get_analyze_toolbox(
    current_user: user_schemas.User = Depends(get_current_user),
):
    _ = current_user
    return get_manifest()


@router.get(
    "/projects/{project_id}/analyze/input-source",
    response_model=analyze_schemas.AnalyzeInputSourceResponse,
)
async def get_analyze_input_source(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return await analyze_source_service.load_default_part_images(db, project_id)


@router.post(
    "/projects/{project_id}/analyze/checkpoints/diagnose",
    response_model=analyze_schemas.CheckpointDiagnosticsResponse,
)
async def diagnose_checkpoint_upload(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    filename = sanitize_filename(file.filename or "checkpoint")
    diagnostics = await asyncio.to_thread(
        checkpoint_diagnostics_from_file, filename, file.file
    )
    if diagnostics["filesize_bytes"] <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Checkpoint file is empty"
        )
    return analyze_schemas.CheckpointDiagnosticsResponse(**diagnostics)


@router.post(
    "/projects/{project_id}/analyze/checkpoints",
    response_model=analyze_schemas.CheckpointRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_checkpoint_upload(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    project = await get_project_or_403_writable(project_id, db, current_user)
    filename = sanitize_filename(file.filename or "checkpoint")
    diagnostics = await asyncio.to_thread(
        checkpoint_diagnostics_from_file, filename, file.file
    )
    size_bytes = int(diagnostics["filesize_bytes"])
    if size_bytes <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Checkpoint file is empty"
        )
    checkpoint = await create_uploaded_checkpoint(
        db=db,
        project=project,
        filename=filename,
        file_obj=file.file,
        content_type=file.content_type or "application/octet-stream",
        diagnostics=diagnostics,
        uploaded_by_user_id=current_user.email,
        bucket_name=settings.S3_BUCKET,
        upload_file_to_s3=object_storage.upload_file_to_s3,
        tag_object=object_storage.boto3_client.put_object_tagging
        if object_storage.boto3_client is not None
        else None,
        to_thread=asyncio.to_thread,
    )
    return checkpoint_record_response(checkpoint)


@router.get(
    "/projects/{project_id}/analyze/checkpoints",
    response_model=analyze_schemas.CheckpointListResponse,
)
async def list_analyze_checkpoints(
    project_id: uuid.UUID,
    scope: str = Query("project", pattern="^(project|authorized)$"),
    model_family: str | None = Query(
        default=None, pattern="^(yolo|sam|anomalib|other)$"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    project = await get_project_or_403(project_id, db, current_user)
    return await list_checkpoint_response(
        db=db,
        project=project,
        current_user=current_user,
        scope=scope,
        model_family=model_family,
    )


@router.get(
    "/projects/{project_id}/analyze/checkpoints/{checkpoint_id}/graph",
    response_model=analyze_schemas.CheckpointGraphResponse,
)
async def get_checkpoint_graph(
    project_id: uuid.UUID,
    checkpoint_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return await checkpoint_graph_response(
        db=db,
        checkpoint_id=checkpoint_id,
        current_user=current_user,
    )


@router.get(
    "/projects/{project_id}/analyze/overlays/recently-deleted",
    response_model=list[analyze_schemas.AnalyzeDeletedOverlayRecord],
)
async def list_recently_deleted_analyze_overlays(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return await analyze_overlay_service.list_recently_deleted_overlays(
        db=db, project_id=project_id, actor_email=current_user.email
    )


@router.delete(
    "/projects/{project_id}/analyze/overlays/{overlay_image_id}",
    response_model=inspection_part_schemas.InspectionPart,
)
async def delete_analyze_overlay(
    project_id: uuid.UUID,
    overlay_image_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403_writable(project_id, db, current_user)
    updated = await analyze_overlay_service.delete_analyze_overlay(
        db=db,
        project_id=project_id,
        overlay_image_id=overlay_image_id,
        actor_email=current_user.email,
        retention_hours=ANALYZE_OVERLAY_DELETE_RETENTION_HOURS,
    )
    return _serialize_inspection_part(updated)


@router.post(
    "/projects/{project_id}/analyze/overlays/{overlay_image_id}/restore",
    response_model=inspection_part_schemas.InspectionPart,
)
async def restore_analyze_overlay(
    project_id: uuid.UUID,
    overlay_image_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403_writable(project_id, db, current_user)
    updated = await analyze_overlay_service.restore_analyze_overlay(
        db=db,
        project_id=project_id,
        overlay_image_id=overlay_image_id,
        actor_email=current_user.email,
    )
    return _serialize_inspection_part(updated)


@router.post(
    "/projects/{project_id}/analyze/workflows/validate",
    response_model=ToolboxExecutionResult,
)
async def validate_analyze_workflow(
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    project = await get_project_or_403(project_id, db, current_user)
    workflow = await _workflow_with_server_source(
        project_id=project_id, workflow=workflow, db=db
    )
    workflow = await workflow_with_checkpoint_paths(
        workflow=workflow,
        db=db,
        current_user=current_user,
        project=project,
        materialize=False,
    )
    try:
        return validate_workflow(workflow)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.post(
    "/projects/{project_id}/analyze/workflows/execute",
    response_model=ToolboxExecutionResult,
)
async def execute_analyze_workflow(
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    x_analyze_run_id: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    project = await get_project_or_403(project_id, db, current_user)
    workflow = await _workflow_with_server_source(
        project_id=project_id, workflow=workflow, db=db
    )
    workflow = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db, current_user=current_user, project=project
    )
    try:
        return await _execute_analyze_workflow_body(
            project_id=project_id,
            workflow=workflow,
            db=db,
            current_user=current_user,
            run_id=str(x_analyze_run_id or "").strip() or None,
        )
    except AnalyzeExecutionCancelled as exc:
        cancelled = ToolboxExecutionResult(
            workflow_name=workflow.name,
            status="failed",
            execution_mode="execution",
            image_count=0,
            warnings=[str(exc)],
        )
        return cancelled
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analyze execution failed: {exc}",
        ) from exc


@router.post(
    "/projects/{project_id}/analyze/workflows/start",
    response_model=analyze_schemas.AnalyzeRunStartResponse,
)
async def start_analyze_workflow(
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    project = await get_project_or_403(project_id, db, current_user)
    workflow = await _workflow_with_server_source(
        project_id=project_id, workflow=workflow, db=db
    )
    workflow = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db, current_user=current_user, project=project
    )
    run_id = uuid.uuid4().hex
    analyze_run_service.start_analyze_run(run_id)
    background_tasks.add_task(
        _execute_analyze_workflow_background,
        run_id=run_id,
        project_id=project_id,
        workflow=workflow,
        current_user=current_user,
    )
    return analyze_schemas.AnalyzeRunStartResponse(run_id=run_id)


@router.get(
    "/projects/{project_id}/analyze/runs/{run_id}",
    response_model=analyze_schemas.AnalyzeRunStatusResponse,
)
async def get_analyze_run_status(
    project_id: uuid.UUID,
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return _analyze_run_snapshot(run_id)


@router.post(
    "/projects/{project_id}/analyze/runs/{run_id}/stop",
    response_model=analyze_schemas.AnalyzeRunStatusResponse,
)
async def stop_analyze_run(
    project_id: uuid.UUID,
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    if not analyze_run_service.stop_analyze_run(run_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Analyze run not found"
        )
    return _analyze_run_snapshot(run_id)
