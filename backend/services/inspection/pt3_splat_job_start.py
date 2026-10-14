"""Admit Simplified and Real 3DGS splat jobs for a PT3 inspection part.

Starting a job materializes the part's sources into a job-owned cache
directory, then publishes pending metadata carrying a fresh ``job_id`` under
the part's row lock. The caller schedules ``pt3_jobs.run_pt3_job_in_session``
with the returned values; publishing a new ``job_id`` supersedes any job that
is still queued or running for the same metadata key.
"""

from __future__ import annotations

import copy
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from repositories import inspection as inspection_repository
from schemas import inspection_pt3 as inspection_pt3_schemas
from services.errors import (
    NotFoundError,
    ServiceUnavailableError,
    UnprocessableError,
    ValidationFailedError,
)
from services.inspection import pt3_assets as inspection_pt3_asset_service
from services.inspection import pt3_jobs, pt3_splat_status, pt3_volume_stack
from services.inspection.pt3_splat_jobs import (
    REAL_SPLAT_JOB,
    REAL_SPLAT_METADATA_KEY,
    SIMPLIFIED_SPLAT_JOB,
    SIMPLIFIED_SPLAT_METADATA_KEY,
    cleanup_real_splat_job_input,
)

PART_NOT_FOUND_DETAIL = "Inspection part not found"


@dataclass(frozen=True)
class PT3JobStart:
    """Values the caller needs to schedule the runner and answer the request."""

    job_id: str
    source_path_text: str
    payload_data: dict
    pending_metadata: dict
    volume_stack_id: str


@dataclass(frozen=True)
class PT3JobLaunch:
    """Pending status to return plus the background task the caller schedules."""

    status: Any
    task: Callable[..., Any]
    task_args: tuple
    task_kwargs: dict


@dataclass(frozen=True)
class _MaterializedSources:
    job_id: str
    source_path_text: str
    source_image_ids: list[str]


async def _part_snapshot(
    db: AsyncSession, project_id: uuid.UUID, part_id: uuid.UUID
) -> SimpleNamespace:
    """Return a detached JSON snapshot of the part, or raise 404."""
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)
    return SimpleNamespace(
        id=part.id,
        metadata_json=copy.deepcopy(
            part.metadata_json if isinstance(part.metadata_json, dict) else {}
        ),
    )


async def _materialize_job_sources(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    materialization_part: SimpleNamespace,
    requested_source_image_ids: list[str],
    cleanup_input: Callable[..., None],
) -> _MaterializedSources:
    # Release the request's initial read transaction before object-store I/O.
    # Keep only an immutable JSON snapshot for locating the server-owned inputs;
    # the authoritative part row is reloaded and locked after materialization.
    await db.rollback()
    job_id = str(uuid.uuid4())
    try:
        (
            source_path,
            inferred_ids,
        ) = await pt3_volume_stack.materialize_part_volume_stack(
            project_id=project_id,
            part=materialization_part,
            db=db,
            materialization_key=job_id,
        )
        # Image lookups during materialization opened a new read transaction.
        # End it so the following lock observes a job that may have published
        # while the object-store copy was in flight.
        await db.rollback()
        source_image_ids = list(inferred_ids)
        if (
            requested_source_image_ids
            and requested_source_image_ids != source_image_ids
        ):
            raise UnprocessableError(
                "source_image_ids must exactly match the server-inferred image stack"
            )
    except Exception:
        await _abort_start(db, cleanup_input, project_id, part_id, job_id)
        raise
    return _MaterializedSources(job_id, source_path, source_image_ids)


async def _abort_start(db, cleanup_input, project_id, part_id, job_id) -> None:
    await db.rollback()
    cleanup_input(project_id=project_id, part_id=part_id, job_id=job_id)


async def _locked_current_metadata(
    db: AsyncSession, project_id: uuid.UUID, part_id: uuid.UUID
) -> tuple[Any, dict]:
    current_part = await inspection_repository.get_inspection_part_for_update(
        db=db, project_id=project_id, part_id=part_id
    )
    if not current_part:
        await db.rollback()
        raise NotFoundError(PART_NOT_FOUND_DETAIL)
    metadata = (
        current_part.metadata_json
        if isinstance(current_part.metadata_json, dict)
        else {}
    )
    return current_part, metadata


async def _publish_pending(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    metadata_key: str,
    pending_metadata: dict,
    requested_by: str,
) -> None:
    updated_part = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={metadata_key: pending_metadata},
        updated_by=requested_by,
    )
    if not updated_part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)


async def _simplified_pending_payload(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3SplatConversionRequest,
    sources: _MaterializedSources,
    requested_by: str,
) -> tuple[dict, dict, str]:
    """Build and publish Simplified pending metadata under the part lock."""
    current_part, current_metadata = await _locked_current_metadata(
        db, project_id, part_id
    )
    volume_stack_id = str(
        payload.volume_stack_id
        or current_metadata.get("volume_stack_id")
        or str(current_part.id)
    )
    conversion_parameters = payload.model_dump(mode="json")
    conversion_parameters["source_path"] = None
    conversion_parameters["source_image_ids"] = sources.source_image_ids
    pending_metadata = {
        "job_id": sources.job_id,
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
        "volume_stack_id": volume_stack_id,
        "source_image_ids": sources.source_image_ids,
        "requested_at": datetime.now(UTC).isoformat(),
        "conversion_parameters": conversion_parameters,
    }
    await _publish_pending(
        db,
        project_id=project_id,
        part_id=part_id,
        metadata_key=SIMPLIFIED_SPLAT_METADATA_KEY,
        pending_metadata=pending_metadata,
        requested_by=requested_by,
    )
    return conversion_parameters, pending_metadata, volume_stack_id


def _check_simplified_admission(
    project_type: str | None,
    payload: inspection_pt3_schemas.PT3SplatConversionRequest,
) -> None:
    if project_type != "PT3":
        raise ValidationFailedError(
            "Volume splat assets are only supported for PT3 projects"
        )
    if payload.source_path is not None:
        raise UnprocessableError(
            "source_path is not accepted for project-part conversion; "
            "attach source images to the part and let the server materialize them"
        )


async def start_simplified_splat_job(
    db: AsyncSession,
    *,
    project_type: str | None,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3SplatConversionRequest,
    requested_by: str,
) -> PT3JobStart:
    """Materialize sources and publish a pending Simplified splat job."""
    _check_simplified_admission(project_type, payload)
    cleanup_input = inspection_pt3_asset_service.cleanup_pt3_simplified_splat_job_input
    sources = await _materialize_job_sources(
        db,
        project_id=project_id,
        part_id=part_id,
        materialization_part=await _part_snapshot(db, project_id, part_id),
        requested_source_image_ids=payload.source_image_ids,
        cleanup_input=cleanup_input,
    )
    try:
        (
            conversion_parameters,
            pending_metadata,
            volume_stack_id,
        ) = await _simplified_pending_payload(
            db,
            project_id=project_id,
            part_id=part_id,
            payload=payload,
            sources=sources,
            requested_by=requested_by,
        )
    except Exception:
        await _abort_start(db, cleanup_input, project_id, part_id, sources.job_id)
        raise
    return PT3JobStart(
        sources.job_id,
        sources.source_path_text,
        conversion_parameters,
        pending_metadata,
        volume_stack_id,
    )


def _camera_view_binding(
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
    source_image_ids: list[str],
) -> str:
    if payload.fit_mode == "voxel_direct":
        return "none"
    return inspection_pt3_asset_service.pt3_provider_camera_view_binding(
        source_image_ids=source_image_ids,
        camera_image_ids={camera.image_id for camera in payload.cameras},
    )


def _real_pending_metadata(
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
    *,
    sources: _MaterializedSources,
    camera_view_binding: str,
    volume_stack_id: str,
) -> dict:
    return {
        "job_id": sources.job_id,
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
        "representation": "real_3dgs",
        "fit_mode": payload.fit_mode,
        "camera_view_binding": camera_view_binding,
        "volume_stack_id": volume_stack_id,
        "source_image_ids": sources.source_image_ids,
        "requested_at": datetime.now(UTC).isoformat(),
        "request_parameters": payload.parameters.model_dump(mode="json"),
    }


def _check_real_admission(
    project_type: str | None,
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
) -> None:
    if project_type != "PT3":
        raise ValidationFailedError(
            "Real Gaussian splat assets are only supported for PT3 projects"
        )
    if (
        payload.fit_mode != "voxel_direct"
        and not str(settings.PT3_REAL_3DGS_PROVIDER or "").strip()
    ):
        raise ServiceUnavailableError(
            f"{payload.fit_mode} requires a configured Real 3DGS provider"
        )


async def _real_pending_payload(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
    sources: _MaterializedSources,
    requested_by: str,
) -> tuple[dict, dict, str]:
    """Build and publish Real 3DGS pending metadata under the part lock."""
    camera_view_binding = _camera_view_binding(payload, sources.source_image_ids)
    current_part, current_metadata = await _locked_current_metadata(
        db, project_id, part_id
    )
    volume_stack_id = str(
        payload.volume_stack_id
        or current_metadata.get("volume_stack_id")
        or str(current_part.id)
    )
    payload_data = payload.model_dump(mode="json")
    payload_data["source_image_ids"] = sources.source_image_ids
    payload_data["camera_view_binding"] = camera_view_binding
    pending_metadata = _real_pending_metadata(
        payload,
        sources=sources,
        camera_view_binding=camera_view_binding,
        volume_stack_id=volume_stack_id,
    )
    previous_ready_asset = (
        inspection_pt3_asset_service.usable_previous_pt3_real_splat_asset(
            current_metadata.get(REAL_SPLAT_METADATA_KEY),
            project_id=project_id,
            part_id=part_id,
        )
    )
    if previous_ready_asset:
        pending_metadata["previous_ready_asset"] = previous_ready_asset
    await _publish_pending(
        db,
        project_id=project_id,
        part_id=part_id,
        metadata_key=REAL_SPLAT_METADATA_KEY,
        pending_metadata=pending_metadata,
        requested_by=requested_by,
    )
    return payload_data, pending_metadata, volume_stack_id


async def start_real_splat_job(
    db: AsyncSession,
    *,
    project_type: str | None,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
    requested_by: str,
) -> PT3JobStart:
    """Materialize sources and publish a pending Real 3DGS job."""
    _check_real_admission(project_type, payload)
    sources = await _materialize_job_sources(
        db,
        project_id=project_id,
        part_id=part_id,
        materialization_part=await _part_snapshot(db, project_id, part_id),
        requested_source_image_ids=payload.source_image_ids,
        cleanup_input=cleanup_real_splat_job_input,
    )
    try:
        payload_data, pending_metadata, volume_stack_id = await _real_pending_payload(
            db,
            project_id=project_id,
            part_id=part_id,
            payload=payload,
            sources=sources,
            requested_by=requested_by,
        )
    except Exception:
        await _abort_start(
            db, cleanup_real_splat_job_input, project_id, part_id, sources.job_id
        )
        raise
    return PT3JobStart(
        sources.job_id,
        sources.source_path_text,
        payload_data,
        pending_metadata,
        volume_stack_id,
    )


def _job_launch(
    job: PT3JobStart, definition, status, *, db, project_id, part_id, requested_by
) -> PT3JobLaunch:
    return PT3JobLaunch(
        status=status,
        task=pt3_jobs.run_pt3_job_in_session,
        task_args=(definition,),
        task_kwargs={
            "session_bind": db.bind,
            "project_id": project_id,
            "part_id": part_id,
            "source_path_text": job.source_path_text,
            "payload_data": job.payload_data,
            "job_id": job.job_id,
            "requested_by": requested_by,
        },
    )


async def launch_simplified_splat_job(
    db: AsyncSession,
    *,
    project_type: str | None,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3SplatConversionRequest,
    requested_by: str,
) -> PT3JobLaunch:
    """Start a Simplified splat job and describe the runner to schedule."""
    job = await start_simplified_splat_job(
        db,
        project_type=project_type,
        project_id=project_id,
        part_id=part_id,
        payload=payload,
        requested_by=requested_by,
    )
    status = pt3_splat_status.splat_status_from_metadata(
        project_id,
        part_id,
        {"pt3_splat_asset": job.pending_metadata},
        volume_stack_id=job.volume_stack_id,
    )
    return _job_launch(
        job,
        SIMPLIFIED_SPLAT_JOB,
        status,
        db=db,
        project_id=project_id,
        part_id=part_id,
        requested_by=requested_by,
    )


async def launch_real_splat_job(
    db: AsyncSession,
    *,
    project_type: str | None,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: inspection_pt3_schemas.PT3RealSplatOptimizationRequest,
    requested_by: str,
) -> PT3JobLaunch:
    """Start a Real 3DGS job and describe the runner to schedule."""
    job = await start_real_splat_job(
        db,
        project_type=project_type,
        project_id=project_id,
        part_id=part_id,
        payload=payload,
        requested_by=requested_by,
    )
    status = pt3_splat_status.real_splat_status_from_metadata(
        project_id,
        part_id,
        {"pt3_real_splat_asset": job.pending_metadata},
        volume_stack_id=job.volume_stack_id,
    )
    return _job_launch(
        job,
        REAL_SPLAT_JOB,
        status,
        db=db,
        project_id=project_id,
        part_id=part_id,
        requested_by=requested_by,
    )
