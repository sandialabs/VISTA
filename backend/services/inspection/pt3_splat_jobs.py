"""Simplified and Real 3DGS splat job definitions for the shared PT3 runner."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from core.config import settings
from schemas import inspection_pt3 as inspection_pt3_schemas
from services.inspection import pt3_assets as inspection_pt3_asset_service
from services.inspection import pt3_cache as inspection_pt3_cache_service
from services.inspection.pt3_assets import pt3_voxel_geometry
from services.inspection.pt3_jobs import PT3JobContext, PT3JobDefinition
from utils.gaussian_splat_converter import (
    SplatConversionParams,
    TransferFunction,
    convert_volume_to_splat_asset,
)
from utils.real_gaussian_splat_optimizer import optimize_real_gaussian_splat_asset
from utils.volume_loader import REFERENCE_VOLUME_READ_LIMITS, load_volume

SIMPLIFIED_SPLAT_METADATA_KEY = "pt3_splat_asset"
REAL_SPLAT_METADATA_KEY = "pt3_real_splat_asset"


def real_splat_job_cache_paths(
    *, project_id: uuid.UUID, part_id: uuid.UUID, job_id: str
) -> tuple[Path, Path]:
    """Return the input stack and output directories owned by one Real job."""
    root = inspection_pt3_cache_service.pt3_cache_root()
    input_path = root / "pt3_volume_stacks" / str(project_id) / str(part_id) / job_id
    output_path = (
        root / "pt3_real_splat_assets" / str(project_id) / str(part_id) / job_id
    )
    return input_path, output_path


def simplified_splat_job_input_path(
    *, project_id: uuid.UUID, part_id: uuid.UUID, job_id: str
) -> Path:
    """Return the input stack directory owned by one Simplified job."""
    return (
        inspection_pt3_cache_service.pt3_cache_root()
        / "pt3_volume_stacks"
        / str(project_id)
        / str(part_id)
        / job_id
    )


def _volume_stack_id(context: PT3JobContext, requested: str | None) -> str:
    # rollback() expires ORM instances even when the session uses
    # expire_on_commit=False. Keep background work on the immutable task
    # argument instead of triggering an async lazy load of the part.
    return str(
        requested or context.metadata.get("volume_stack_id") or str(context.part_id)
    )


async def _execute_simplified(context: PT3JobContext) -> tuple[dict, Path]:
    payload = inspection_pt3_schemas.PT3SplatConversionRequest(**context.payload_data)
    volume_info = load_volume(
        Path(context.source_path_text).expanduser().resolve(),
        limits=REFERENCE_VOLUME_READ_LIMITS,
    )
    params = SplatConversionParams(
        transfer_function=TransferFunction(**payload.transfer_function.model_dump()),
        downsample=payload.downsample,
        max_splats=payload.max_splats,
        output_format=payload.output_format,
    )
    output_dir = inspection_pt3_cache_service.pt3_cache_directory(
        "pt3_splat_assets",
        context.project_id,
        context.part_id,
        create=True,
        repair_mode=True,
    )
    segmentation = context.metadata.get("pt3_segmentation")
    asset = await asyncio.to_thread(
        convert_volume_to_splat_asset,
        volume_info,
        volume_stack_id=_volume_stack_id(context, payload.volume_stack_id),
        source_image_ids=payload.source_image_ids,
        params=params,
        output_dir=output_dir,
        segmentation=segmentation if isinstance(segmentation, dict) else None,
    )
    asset_url = (
        f"/api/projects/{context.project_id}/parts/{context.part_id}"
        f"/volume-splat-assets/{asset.cache_key}"
    )
    return {
        **asset.metadata,
        "job_id": context.job_id,
        "status": "ready",
        "stage": "ready",
        "progress_percent": 100,
        "asset_path": asset.path,
        "asset_url": asset_url,
        "output_format": asset.output_format,
        "splat_count": asset.splat_count,
        "conversion_parameters": payload.model_dump(mode="json"),
    }, Path(asset.path)


def _simplified_failure(context: PT3JobContext, exc: Exception) -> dict:
    return {
        "job_id": context.job_id,
        "status": "failed",
        "stage": "failed",
        "progress_percent": 0,
        "volume_stack_id": context.payload_data.get("volume_stack_id"),
        "source_image_ids": context.payload_data.get("source_image_ids") or [],
        "error": inspection_pt3_asset_service.public_pt3_real_splat_error(exc),
        "failed_at": datetime.now(UTC).isoformat(),
    }


def _discard_simplified_output(
    *, project_id, part_id, job_id, output_path, latest_asset
) -> None:
    inspection_pt3_asset_service.prune_stale_pt3_simplified_splat_output(
        output_path,
        project_id=project_id,
        part_id=part_id,
        latest_asset=latest_asset,
    )


def _retain_simplified_output(*, project_id, part_id, job_id, output_path) -> None:
    inspection_pt3_asset_service.prune_pt3_simplified_splat_outputs(
        project_id=project_id,
        part_id=part_id,
        keep_asset_path=output_path,
    )


SIMPLIFIED_SPLAT_JOB = PT3JobDefinition(
    metadata_key=SIMPLIFIED_SPLAT_METADATA_KEY,
    execute=_execute_simplified,
    build_failure_metadata=_simplified_failure,
    cleanup_input=inspection_pt3_asset_service.cleanup_pt3_simplified_splat_job_input,
    discard_output=_discard_simplified_output,
    retain_output=_retain_simplified_output,
)


async def _execute_real(context: PT3JobContext) -> tuple[dict, Path]:
    payload = inspection_pt3_schemas.PT3RealSplatOptimizationRequest(
        **context.payload_data
    )
    volume_info = load_volume(
        Path(context.source_path_text).expanduser().resolve(),
        limits=REFERENCE_VOLUME_READ_LIMITS,
    )
    volume_geometry = pt3_voxel_geometry(volume_info, context.metadata)
    volume_stack_id = _volume_stack_id(context, payload.volume_stack_id)
    output_dir = inspection_pt3_cache_service.pt3_cache_directory(
        "pt3_real_splat_assets",
        context.project_id,
        context.part_id,
        context.job_id,
        create=True,
        repair_mode=True,
    )
    asset = await asyncio.to_thread(
        optimize_real_gaussian_splat_asset,
        provider_path=str(settings.PT3_REAL_3DGS_PROVIDER or ""),
        volume_stack_id=volume_stack_id,
        source_image_ids=payload.source_image_ids,
        source_files=volume_info.source_files,
        cameras=[camera.model_dump(mode="json") for camera in payload.cameras],
        parameters=payload.parameters.model_dump(mode="json"),
        fit_mode=payload.fit_mode,
        volume_geometry=volume_geometry,
        # Preserve malformed declarations so the shared strict normalizer
        # rejects them instead of silently treating them as unsegmented.
        segmentation=context.metadata.get("pt3_segmentation"),
        output_dir=output_dir,
        progress_callback=context.report_progress,
    )
    return _real_ready_metadata(context, payload, asset, volume_stack_id), Path(
        asset.path
    )


def _real_ready_metadata(context, payload, asset, volume_stack_id: str) -> dict:
    asset_url = (
        f"/api/projects/{context.project_id}/parts/{context.part_id}"
        f"/real-gaussian-splat-assets/{asset.cache_key}"
    )
    parameters = payload.parameters.model_dump(mode="json")
    metadata = {
        **asset.metadata,
        "job_id": context.job_id,
        "status": "ready",
        "stage": "ready",
        "progress_percent": 100,
        "asset_path": asset.path,
        "asset_url": asset_url,
        "volume_stack_id": volume_stack_id,
        "source_image_ids": list(payload.source_image_ids),
        "splat_count": asset.splat_count,
        "request_parameters": parameters,
        "fit_mode": payload.fit_mode,
        "camera_view_binding": context.payload_data.get("camera_view_binding")
        or "none",
    }
    if payload.fit_mode != "voxel_direct":
        metadata["optimization_parameters"] = parameters
    return metadata


def _real_failure(context: PT3JobContext, exc: Exception) -> dict:
    payload_data = context.payload_data
    return {
        "job_id": context.job_id,
        "status": "failed",
        "stage": "failed",
        "progress_percent": 0,
        "representation": "real_3dgs",
        "fit_mode": payload_data.get("fit_mode") or "voxel_direct",
        "camera_view_binding": payload_data.get("camera_view_binding") or "none",
        "volume_stack_id": payload_data.get("volume_stack_id"),
        "source_image_ids": payload_data.get("source_image_ids") or [],
        "error": inspection_pt3_asset_service.public_pt3_real_splat_error(exc),
        "failed_at": datetime.now(UTC).isoformat(),
    }


def _keep_previous_real_asset(
    final_metadata: dict, latest_asset: dict, context: PT3JobContext
) -> dict:
    if final_metadata.get("status") == "ready":
        return final_metadata
    previous_ready_asset = (
        inspection_pt3_asset_service.usable_previous_pt3_real_splat_asset(
            latest_asset,
            project_id=context.project_id,
            part_id=context.part_id,
        )
    )
    if not previous_ready_asset:
        return final_metadata
    # A recompute is replace-on-success. If it fails, keep serving the last
    # published canonical asset and expose the failed attempt as diagnostic
    # metadata rather than turning a good asset into a 404.
    return {
        **previous_ready_asset,
        "last_recompute_status": "failed",
        "last_recompute_job_id": context.job_id,
        "last_recompute_error": final_metadata.get("error"),
        "last_recompute_failed_at": final_metadata.get("failed_at"),
    }


def cleanup_real_splat_job_input(*, project_id, part_id, job_id) -> None:
    """Remove the Real job's materialized input stack only."""
    inspection_pt3_asset_service.cleanup_pt3_real_splat_job_cache(
        project_id=project_id, part_id=part_id, job_id=job_id, remove_output=False
    )


def _discard_real_output(
    *, project_id, part_id, job_id, output_path, latest_asset
) -> None:
    inspection_pt3_asset_service.cleanup_pt3_real_splat_job_cache(
        project_id=project_id, part_id=part_id, job_id=job_id, remove_input=False
    )


def _retain_real_output(*, project_id, part_id, job_id, output_path) -> None:
    inspection_pt3_asset_service.prune_pt3_real_splat_job_cache(
        project_id=project_id, part_id=part_id, keep_output_job_id=job_id
    )


REAL_SPLAT_JOB = PT3JobDefinition(
    metadata_key=REAL_SPLAT_METADATA_KEY,
    execute=_execute_real,
    build_failure_metadata=_real_failure,
    cleanup_input=cleanup_real_splat_job_input,
    discard_output=_discard_real_output,
    retain_output=_retain_real_output,
    finalize_metadata=_keep_previous_real_asset,
    reports_progress=True,
)
