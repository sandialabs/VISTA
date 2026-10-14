import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from repositories import inspection as inspection_repository
from schemas import inspection_annotations as inspection_annotation_schemas
from schemas import inspection_parts as inspection_part_schemas
from schemas import inspection_pt3 as inspection_pt3_schemas
from schemas import inspection_volumes as inspection_volume_schemas
from schemas import inspection_workspace as inspection_workspace_schemas
from schemas import users as user_schemas
from services.inspection import annotations as inspection_annotation_service
from services.inspection import batches as inspection_batch_service
from services.inspection import measurements as inspection_measurement_service
from services.inspection import (
    overlay_assignment,
    part_ingest,
    part_metadata_sources,
    part_source_images,
    pt3_splat_job_start,
    pt3_splat_status,
    test_fixtures,
)
from services.inspection import (
    part_image_identities as inspection_part_image_identity_service,
)
from services.inspection import part_images as inspection_part_image_service
from services.inspection import parts as inspection_part_service
from services.inspection import workspace as inspection_workspace_service
from utils.dependencies import (
    ReadableProject,
    WritableProject,
    get_current_user,
    get_project_or_403,
    get_project_or_403_writable,
    require_authenticated_user,
)

router = APIRouter(tags=["Inspection Workbench"])

WORKSPACE_STATE_KEY_PREFIX = "inspection_workbench.workspace_state"
PROJECT_CONFIGURATION_KEY = "inspection_workbench.project_configuration"
PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX = (
    "inspection_workbench.project_type_interface_layout_default"
)
ANNOTATIONS_METADATA_KEY = inspection_annotation_service.ANNOTATIONS_METADATA_KEY
REJECT_PART_DISPOSITION = inspection_annotation_service.REJECT_PART_DISPOSITION
PROJECT_CONFIGURATION_KEY = inspection_workspace_service.PROJECT_CONFIGURATION_KEY
PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX = (
    inspection_workspace_service.PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX
)
WORKSPACE_PANEL_LAYOUT_DEFAULTS = (
    inspection_workspace_service.WORKSPACE_PANEL_LAYOUT_DEFAULTS
)
WORKSPACE_INSPECTOR_DEFAULTS = inspection_workspace_service.WORKSPACE_INSPECTOR_DEFAULTS
DEFAULT_DEFECT_TYPE_COLORS = inspection_workspace_service.DEFAULT_DEFECT_TYPE_COLORS


def _workspace_state_metadata_key(user_email: str) -> str:
    return f"{WORKSPACE_STATE_KEY_PREFIX}:{user_email.strip().lower()}"


def _normalize_layout_model(candidate: object) -> dict:
    try:
        return inspection_workspace_service.normalize_layout_model(candidate)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc


@router.post(
    "/projects/{project_id}/batches",
    response_model=inspection_part_schemas.InspectionBatch,
    status_code=status.HTTP_201_CREATED,
)
async def create_inspection_batch(
    project_id: uuid.UUID,
    project: ReadableProject,
    batch: inspection_part_schemas.InspectionBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_batch_service.create_inspection_batch(
        db=db,
        project_id=project_id,
        batch=batch,
        created_by=current_user.email,
    )


@router.get(
    "/projects/{project_id}/batches",
    response_model=list[inspection_part_schemas.InspectionBatch],
)
async def list_inspection_batches(
    project_id: uuid.UUID,
    project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_batch_service.list_inspection_batches(
        db=db,
        project_id=project_id,
    )


@router.delete(
    "/projects/{project_id}/batches/{batch_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_inspection_batch(
    project_id: uuid.UUID,
    project: ReadableProject,
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await inspection_batch_service.delete_inspection_batch(
        db=db,
        project_id=project_id,
        batch_id=batch_id,
        deleted_by=current_user.email,
    )
    return None


@router.patch(
    "/projects/{project_id}/batches/{batch_id}",
    response_model=inspection_part_schemas.InspectionBatch,
)
async def update_inspection_batch(
    project_id: uuid.UUID,
    project: ReadableProject,
    batch_id: uuid.UUID,
    payload: inspection_part_schemas.InspectionBatchUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_batch_service.update_inspection_batch(
        db=db,
        project_id=project_id,
        batch_id=batch_id,
        patch=payload,
        updated_by=current_user.email,
    )


@router.post(
    "/projects/{project_id}/parts",
    response_model=inspection_part_schemas.InspectionPart,
    status_code=status.HTTP_201_CREATED,
)
async def create_inspection_part(
    project_id: uuid.UUID,
    project: ReadableProject,
    part: inspection_part_schemas.InspectionPartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_part_service.create_inspection_part(
        db=db,
        project_id=project_id,
        part=part,
        created_by=current_user.email,
    )


@router.get(
    "/projects/{project_id}/parts",
    response_model=list[inspection_part_schemas.InspectionPart],
)
async def list_inspection_parts(
    project_id: uuid.UUID,
    project: ReadableProject,
    batch_id: uuid.UUID | None = None,
    review_state: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_part_service.list_inspection_parts(
        db=db,
        project_id=project_id,
        batch_id=batch_id,
        review_state=review_state,
    )


@router.delete("/projects/{project_id}/parts", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_inspection_parts(
    project_id: uuid.UUID,
    project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await inspection_part_service.delete_all_inspection_parts(
        db=db,
        project_id=project_id,
        deleted_by=current_user.email,
    )
    return None


@router.put(
    "/projects/{project_id}/parts/{part_id}/image-display-order",
    response_model=inspection_part_schemas.InspectionPart,
)
async def update_inspection_part_image_display_order(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_part_schemas.InspectionPartImageDisplayOrderUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403_writable(project_id, db, current_user)
    updated = (
        await inspection_part_image_identity_service.update_part_image_display_order(
            db=db,
            project_id=project_id,
            part_id=part_id,
            image_refs=payload.image_refs,
            updated_by=current_user.email,
        )
    )
    return inspection_part_service.serialize_inspection_part(updated)


@router.put(
    "/projects/{project_id}/parts/{part_id}/metadata-sources",
    response_model=inspection_part_schemas.InspectionPart,
)
async def update_inspection_part_metadata_sources(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_part_schemas.InspectionPartMetadataSourcesUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await part_metadata_sources.update_inspection_part_metadata_sources(
        db=db,
        project=project,
        project_id=project_id,
        part_id=part_id,
        payload=payload,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/parts/{part_id}/volume-splat-assets",
    response_model=inspection_pt3_schemas.PT3SplatGenerationStatus,
)
async def create_pt3_volume_splat_asset(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3SplatConversionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    launch = await pt3_splat_job_start.launch_simplified_splat_job(
        db,
        project_type=project.project_type,
        project_id=project_id,
        part_id=part_id,
        payload=payload,
        requested_by=current_user.email,
    )
    background_tasks.add_task(launch.task, *launch.task_args, **launch.task_kwargs)
    return launch.status


@router.get(
    "/projects/{project_id}/parts/{part_id}/volume-splat-assets/status",
    response_model=inspection_pt3_schemas.PT3SplatGenerationStatus,
)
async def get_pt3_part_volume_splat_status(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await pt3_splat_status.get_part_splat_status(
        db, project_id=project_id, part_id=part_id
    )


@router.post(
    "/projects/{project_id}/parts/{part_id}/real-gaussian-splat-assets",
    response_model=inspection_pt3_schemas.PT3RealSplatGenerationStatus,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_pt3_real_gaussian_splat_asset(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    launch = await pt3_splat_job_start.launch_real_splat_job(
        db,
        project_type=project.project_type,
        project_id=project_id,
        part_id=part_id,
        payload=payload,
        requested_by=current_user.email,
    )
    background_tasks.add_task(launch.task, *launch.task_args, **launch.task_kwargs)
    return launch.status


@router.get(
    "/projects/{project_id}/parts/{part_id}/real-gaussian-splat-assets/status",
    response_model=inspection_pt3_schemas.PT3RealSplatGenerationStatus,
)
async def get_pt3_real_gaussian_splat_status(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await pt3_splat_status.get_part_real_splat_status(
        db, project_id=project_id, part_id=part_id
    )


@router.get(
    "/projects/{project_id}/parts/{part_id}/real-gaussian-splat-assets/{cache_key}"
)
async def get_pt3_real_gaussian_splat_asset(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    cache_key: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    asset_path = await pt3_splat_status.real_splat_asset_file(
        db, project_id=project_id, part_id=part_id, cache_key=cache_key
    )
    return FileResponse(
        asset_path, media_type="application/json", filename=asset_path.name
    )


@router.get(
    "/projects/{project_id}/volume-stacks/{volume_stack_id}/splat-status",
    response_model=inspection_pt3_schemas.PT3SplatGenerationStatus,
)
async def get_pt3_volume_stack_splat_status(
    project_id: uuid.UUID,
    project: ReadableProject,
    volume_stack_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await pt3_splat_status.get_volume_stack_splat_status(
        db, project_id=project_id, volume_stack_id=volume_stack_id
    )


@router.get("/projects/{project_id}/parts/{part_id}/volume-splat-assets/{cache_key}")
async def get_pt3_volume_splat_asset(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    cache_key: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    asset_path, media_type = await pt3_splat_status.simplified_splat_asset_file(
        db, project_id=project_id, part_id=part_id, cache_key=cache_key
    )
    return FileResponse(asset_path, media_type=media_type, filename=asset_path.name)


@router.patch(
    "/projects/{project_id}/parts/{part_id}",
    response_model=inspection_part_schemas.InspectionPart,
)
async def update_inspection_part_review_state(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_part_schemas.InspectionPartUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_annotation_service.update_part_review_state(
        db=db,
        project_id=project_id,
        part_id=part_id,
        review_state=payload.review_state,
        updated_by=current_user.email,
    )


@router.delete(
    "/projects/{project_id}/parts/{part_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_inspection_part(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await inspection_part_service.delete_inspection_part(
        db=db,
        project_id=project_id,
        part_id=part_id,
        deleted_by=current_user.email,
    )
    return None


@router.post(
    "/projects/{project_id}/parts/image-assignments",
    response_model=inspection_part_schemas.InspectionPartImageAssignmentResponse,
)
async def assign_image_to_part(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_part_schemas.InspectionPartImageAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_part_image_service.assign_image_to_part(
        db=db,
        project_id=project_id,
        payload=payload,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/parts/overlay-assignments",
    response_model=inspection_part_schemas.InspectionOverlayAssignmentResponse,
)
async def assign_overlay_to_base_image(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_part_schemas.InspectionOverlayAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await overlay_assignment.assign_overlay_to_base_image(
        db=db, project_id=project_id, payload=payload, user_email=current_user.email
    )


@router.post(
    "/projects/{project_id}/parts/batch-assignments",
    response_model=inspection_part_schemas.InspectionPartBatchAssignmentResponse,
)
async def assign_part_to_batch(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_part_schemas.InspectionPartBatchAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    assignment = await inspection_part_service.assign_part_to_batch(
        db=db,
        project_id=project_id,
        part_id=payload.part_id,
        to_batch_id=payload.to_batch_id,
        updated_by=current_user.email,
    )
    return inspection_part_schemas.InspectionPartBatchAssignmentResponse(**assignment)


@router.patch(
    "/projects/{project_id}/parts/{part_id}/source-images/{image_ref:path}",
    response_model=inspection_part_schemas.InspectionPart,
)
async def update_inspection_part_source_image(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    image_ref: str,
    payload: inspection_part_schemas.InspectionPartSourceImageUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await part_source_images.update_part_source_image(
        db=db,
        project_id=project_id,
        part_id=part_id,
        image_ref=image_ref,
        payload=payload,
        user_email=current_user.email,
    )


@router.patch(
    "/projects/{project_id}/parts/{part_id}/manual-flag",
    response_model=inspection_part_schemas.InspectionPart,
)
async def update_inspection_part_manual_flag(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_part_schemas.InspectionPartManualFlagUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    updated = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={"manual_flagged": bool(payload.manual_flagged)},
        updated_by=current_user.email,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found"
        )
    return inspection_part_service.serialize_inspection_part(updated)


@router.post(
    "/projects/{project_id}/parts/{part_id}/segmentation-runs",
    response_model=inspection_volume_schemas.InspectionSegmentationInvokeResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def invoke_part_segmentation(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_volume_schemas.InspectionSegmentationInvokeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_measurement_service.invoke_part_segmentation(
        db,
        project_id=project_id,
        part_id=part_id,
        axis=payload.axis,
        slice_index=payload.slice_index,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/parts/{part_id}/slice-segmentation",
    response_model=inspection_volume_schemas.InspectionSliceSegmentationResponse,
)
async def segment_inspection_slice(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_volume_schemas.InspectionSliceSegmentationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_measurement_service.segment_inspection_slice(
        db, project_id=project_id, part_id=part_id, payload=payload
    )


@router.post(
    "/projects/{project_id}/parts/{part_id}/measurement-runs",
    response_model=inspection_volume_schemas.InspectionMeasurementInvokeResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def invoke_ai_measurements(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_volume_schemas.InspectionMeasurementInvokeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_measurement_service.invoke_ai_measurements(
        db,
        project_id=project_id,
        part_id=part_id,
        measurement_profile=payload.measurement_profile,
        include_overlays=payload.include_overlays,
        user_email=current_user.email,
    )


@router.get(
    "/projects/{project_id}/parts/{part_id}/annotations",
    response_model=inspection_annotation_schemas.InspectionAnnotationListResponse,
)
async def list_part_annotations(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    include_hidden: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found"
        )

    annotations = inspection_annotation_service.part_annotations(part)
    if not include_hidden:
        annotations = [
            annotation
            for annotation in annotations
            if not annotation.get("hidden", False)
        ]
    return {"part_id": part_id, "annotations": annotations}


@router.post(
    "/projects/{project_id}/parts/{part_id}/annotations",
    response_model=inspection_annotation_schemas.InspectionAnnotation,
    status_code=status.HTTP_201_CREATED,
)
async def create_part_annotation(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    payload: inspection_annotation_schemas.InspectionAnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    part = await inspection_repository.get_inspection_part_for_update(
        db=db,
        project_id=project_id,
        part_id=part_id,
    )
    if not part:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found"
        )

    return await inspection_annotation_service.create_part_annotation(
        db=db,
        project_id=project_id,
        part_id=part_id,
        part=part,
        payload=payload,
        current_user_email=current_user.email,
    )


@router.patch(
    "/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
    response_model=inspection_annotation_schemas.InspectionAnnotation,
)
async def update_part_annotation(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    annotation_id: uuid.UUID,
    payload: inspection_annotation_schemas.InspectionAnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    part = await inspection_repository.get_inspection_part_for_update(
        db=db,
        project_id=project_id,
        part_id=part_id,
    )
    if not part:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found"
        )

    return await inspection_annotation_service.update_part_annotation(
        db=db,
        project_id=project_id,
        part_id=part_id,
        part=part,
        annotation_id=annotation_id,
        payload=payload,
        current_user_email=current_user.email,
    )


@router.delete(
    "/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_part_annotation(
    project_id: uuid.UUID,
    project: ReadableProject,
    part_id: uuid.UUID,
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    part = await inspection_repository.get_inspection_part_for_update(
        db=db,
        project_id=project_id,
        part_id=part_id,
    )
    if not part:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found"
        )

    await inspection_annotation_service.delete_part_annotation(
        db=db,
        project_id=project_id,
        part_id=part_id,
        part=part,
        annotation_id=annotation_id,
        current_user_email=current_user.email,
    )


@router.get(
    "/projects/{project_id}/workspace-state",
    response_model=inspection_workspace_schemas.InspectionWorkspaceStateResponse,
)
async def get_inspection_workspace_state(
    project_id: uuid.UUID,
    project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_workspace_service.get_workspace_state(
        db=db,
        project_id=project_id,
        user_email=current_user.email,
    )


@router.put(
    "/projects/{project_id}/workspace-state",
    response_model=inspection_workspace_schemas.InspectionWorkspaceStateResponse,
)
async def update_inspection_workspace_state(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_workspace_schemas.InspectionWorkspaceStatePayload,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_workspace_service.update_workspace_state(
        db=db,
        project_id=project_id,
        user_email=current_user.email,
        state=payload.state,
    )


@router.get(
    "/projects/{project_id}/configuration",
)
async def get_project_configuration(
    project_id: uuid.UUID,
    project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_workspace_service.get_project_configuration(
        db=db,
        project_id=project_id,
        project=project,
    )


@router.put(
    "/projects/{project_id}/configuration",
    response_model=inspection_workspace_schemas.InspectionProjectConfigurationResponse,
    response_model_exclude_unset=True,
)
async def update_project_configuration(
    project_id: uuid.UUID,
    project: WritableProject,
    payload: inspection_workspace_schemas.InspectionProjectConfigurationPayload,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_workspace_service.update_project_configuration(
        db=db,
        project_id=project_id,
        project=project,
        config=payload.config,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/configuration/interface-layout/default",
    response_model=inspection_workspace_schemas.InspectionProjectConfigurationResponse,
    response_model_exclude_unset=True,
)
async def save_project_default_interface_layout(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_workspace_schemas.InspectionInterfaceLayoutDefaultPayload,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await inspection_workspace_service.save_project_default_interface_layout(
        db=db,
        project_id=project_id,
        project=project,
        layout_model=payload.layout_model,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/configuration/interface-layout/project-type-default",
    response_model=inspection_workspace_schemas.InspectionProjectConfigurationResponse,
)
async def save_project_type_default_interface_layout(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_workspace_schemas.InspectionInterfaceLayoutDefaultPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    raw_groups_header = request.headers.get("X-User-Groups", "[]")
    try:
        parsed_groups = (
            json.loads(raw_groups_header) if isinstance(raw_groups_header, str) else []
        )
    except json.JSONDecodeError:
        parsed_groups = []
    normalized_groups = {
        str(group).strip().lower() for group in parsed_groups if isinstance(group, str)
    }
    if not ({"admin", "admins"} & normalized_groups):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required to save project type defaults",
        )
    await inspection_workspace_service.save_project_type_default_interface_layout(
        db=db,
        project_id=project_id,
        project=project,
        layout_model=payload.layout_model,
        user_email=current_user.email,
    )
    return await inspection_workspace_service.get_project_configuration(
        db=db,
        project_id=project_id,
        project=project,
    )


@router.post(
    "/projects/{project_id}/configuration/clone",
)
async def clone_project_configuration(
    project_id: uuid.UUID,
    target_project: WritableProject,
    payload: inspection_workspace_schemas.InspectionProjectConfigurationCloneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    if payload.source_project_id == project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_project_id must be different from project_id",
        )
    source_project = await get_project_or_403(
        payload.source_project_id, db, current_user
    )
    if source_project.project_type != target_project.project_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "source_project_id must belong to a project with the same project_type "
                "as the target project"
            ),
        )

    return await inspection_workspace_service.clone_project_configuration(
        db=db,
        project_id=project_id,
        target_project=target_project,
        source_project=source_project,
        source_project_id=payload.source_project_id,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/load-test-data",
)
async def load_project_test_data(
    project_id: uuid.UUID,
    project: ReadableProject,
    fixture: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(require_authenticated_user),
):
    return await test_fixtures.load_project_test_data(
        db=db,
        project=project,
        project_id=project_id,
        fixture=fixture,
        user_email=current_user.email,
    )


@router.post(
    "/projects/{project_id}/ingest",
    response_model=inspection_part_schemas.InspectionBulkIngestResponse,
)
async def bulk_ingest_project_parts(
    project_id: uuid.UUID,
    project: ReadableProject,
    payload: inspection_part_schemas.InspectionBulkIngestPayload,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await part_ingest.bulk_ingest_project_parts(
        db=db,
        project_id=project_id,
        payload=payload,
        user_email=current_user.email,
        project_type=project.project_type,
    )
