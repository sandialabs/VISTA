"""One background runner for PT3 splat fitting jobs.

Each job owns one metadata key on its inspection part (for example
``pt3_splat_asset``). The request that starts a job publishes pending
metadata carrying a fresh ``job_id``; a newer request supersedes an older job
by publishing a different ``job_id``. The runner re-checks that ownership
under a row lock before and after waiting for the shared compute slot, and
publishes its result with a compare-and-swap so a stale completion or
failure can never replace metadata owned by a newer request.
"""

from __future__ import annotations

import asyncio
import copy
import threading
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from repositories import inspection as inspection_repository

PROGRESS_TIMEOUT_SECONDS = 15.0
# Both bundled splat fitters are CPU- and memory-intensive. Keep one PT3 splat
# compute in flight per backend worker; deployments can scale workers
# deliberately instead of allowing an unbounded request burst in one process.
COMPUTE_SEMAPHORE = threading.BoundedSemaphore(value=1)


class JobSuperseded(RuntimeError):
    """Internal cancellation signal for a job that lost ownership of its part."""


async def acquire_compute_slot() -> None:
    """Acquire the process-local compute slot without blocking an event loop."""
    while not COMPUTE_SEMAPHORE.acquire(blocking=False):
        await asyncio.sleep(0.05)


@dataclass(frozen=True)
class PT3JobContext:
    """Everything an execute step may read; ``metadata`` is a detached copy."""

    project_id: uuid.UUID
    part_id: uuid.UUID
    job_id: str
    payload_data: dict
    source_path_text: str
    metadata: dict
    report_progress: Callable[..., None] | None = None


@dataclass(frozen=True)
class PT3JobDefinition:
    """Per-job-kind behaviour plugged into the shared runner.

    ``execute`` returns ``(ready_metadata, output_path)``. ``finalize_metadata``
    may rewrite the metadata about to be published given the latest owned
    asset. ``cleanup_input`` always runs; ``discard_output`` runs whenever this
    job's output is not published as ready; ``retain_output`` runs after a
    ready publication while the compute slot is still held.
    """

    metadata_key: str
    execute: Callable[[PT3JobContext], Awaitable[tuple[dict, Path]]]
    build_failure_metadata: Callable[[PT3JobContext, Exception], dict]
    cleanup_input: Callable[..., None]
    discard_output: Callable[..., None]
    retain_output: Callable[..., None]
    finalize_metadata: Callable[[dict, dict, PT3JobContext], dict] | None = None
    reports_progress: bool = False


def _owned_asset(metadata: dict, metadata_key: str, job_id: str) -> dict | None:
    asset = metadata.get(metadata_key)
    if not isinstance(asset, dict) or asset.get("job_id") != job_id:
        return None
    return asset


async def _locked_part_metadata(
    job_db: AsyncSession, project_id: uuid.UUID, part_id: uuid.UUID
) -> dict | None:
    # The task-owned session uses expire_on_commit=False and retains
    # identity-mapped rows. End any earlier transaction first; the repository
    # lookup uses populate_existing so the locked SELECT overwrites a stale
    # row instead of letting an older worker keep seeing its own job_id.
    await job_db.rollback()
    part = await inspection_repository.get_inspection_part_for_update(
        db=job_db, project_id=project_id, part_id=part_id
    )
    if part is None:
        return None
    return part.metadata_json if isinstance(part.metadata_json, dict) else {}


async def _owned_metadata_snapshot(
    definition: PT3JobDefinition,
    job_db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    job_id: str,
) -> dict | None:
    """Return a detached metadata copy while this job still owns the part."""
    metadata = await _locked_part_metadata(job_db, project_id, part_id)
    if (
        metadata is None
        or _owned_asset(metadata, definition.metadata_key, job_id) is None
    ):
        await job_db.rollback()
        return None
    # Keep only plain metadata after releasing the admission lock.
    snapshot = copy.deepcopy(metadata)
    await job_db.rollback()
    return snapshot


async def update_job_progress(
    *,
    metadata_key: str,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    job_id: str,
    progress_percent: float,
    stage: str,
    job_db: AsyncSession,
) -> bool:
    """Publish progress only while this job still owns a pending asset."""
    try:
        safe_progress = min(99.0, max(0.0, float(progress_percent)))
    except (TypeError, ValueError):
        return False
    await job_db.rollback()
    part = await inspection_repository.get_inspection_part_for_update(
        db=job_db, project_id=project_id, part_id=part_id
    )
    if not part:
        await job_db.rollback()
        return False
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    asset = _owned_asset(metadata, metadata_key, job_id)
    if asset is None or str(asset.get("status") or "").strip().lower() != "pending":
        await job_db.rollback()
        return False
    part.metadata_json = {
        **metadata,
        metadata_key: {
            **asset,
            "status": "pending",
            "stage": str(stage or "optimizing")[:120],
            "progress_percent": safe_progress,
            "progress_updated_at": datetime.now(UTC).isoformat(),
        },
    }
    await job_db.commit()
    return True


async def update_job_progress_in_session(*, session_bind: Any, **kwargs) -> bool:
    """Publish one progress update in an independent, short-lived session."""
    async with AsyncSession(
        bind=session_bind,
        expire_on_commit=False,
        autoflush=False,
    ) as progress_db:
        return await update_job_progress(job_db=progress_db, **kwargs)


def _progress_reporter(
    definition: PT3JobDefinition,
    job_db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    job_id: str,
) -> Callable[..., None]:
    """Build a thread-side callback that publishes progress on the event loop."""
    loop = asyncio.get_running_loop()
    session_bind = job_db.bind

    def report_progress(progress_percent: float, stage: str = "optimizing") -> None:
        future = asyncio.run_coroutine_threadsafe(
            update_job_progress_in_session(
                session_bind=session_bind,
                metadata_key=definition.metadata_key,
                project_id=project_id,
                part_id=part_id,
                job_id=job_id,
                progress_percent=progress_percent,
                stage=stage,
            ),
            loop,
        )
        try:
            progress_published = future.result(timeout=PROGRESS_TIMEOUT_SECONDS)
        except TimeoutError:
            # Do not leave a timed-out update running after the fitter unwinds
            # into final publication. Its independent session makes
            # cancellation safe even if the database call is slow to stop.
            future.cancel()
            raise
        if progress_published is not True:
            raise JobSuperseded()

    return report_progress


async def _execute(
    definition: PT3JobDefinition, context: PT3JobContext
) -> tuple[dict, Path | None] | None:
    """Run the execute step; ``None`` means the job was superseded."""
    try:
        return await definition.execute(context)
    except JobSuperseded:
        # Supersession is a normal internal cancellation path. Do not publish a
        # failure or expose implementation details to the polling client.
        return None
    except Exception as exc:  # failures must remain visible to polling clients
        return definition.build_failure_metadata(context, exc), None


async def _publish(
    definition: PT3JobDefinition,
    context: PT3JobContext,
    job_db: AsyncSession,
    *,
    final_metadata: dict,
    output_path: Path | None,
    requested_by: str,
) -> None:
    ids = {
        "project_id": context.project_id,
        "part_id": context.part_id,
        "job_id": context.job_id,
    }
    # Compare-and-swap at publication so an older completion or failure can
    # never replace metadata owned by a newer request. A failed preflight can
    # leave a read transaction open, so always start from a fresh one.
    latest_metadata = await _locked_part_metadata(
        job_db, context.project_id, context.part_id
    )
    latest_metadata = latest_metadata if latest_metadata is not None else {}
    latest_asset = latest_metadata.get(definition.metadata_key)
    if _owned_asset(latest_metadata, definition.metadata_key, context.job_id) is None:
        await job_db.rollback()
        definition.discard_output(
            **ids, output_path=output_path, latest_asset=latest_asset or {}
        )
        return
    job_succeeded = output_path is not None and final_metadata.get("status") == "ready"
    if definition.finalize_metadata is not None:
        final_metadata = definition.finalize_metadata(
            final_metadata, latest_asset, context
        )
    published_part = await inspection_repository.update_inspection_part_metadata(
        db=job_db,
        project_id=context.project_id,
        part_id=context.part_id,
        metadata_patch={definition.metadata_key: final_metadata},
        updated_by=requested_by,
    )
    if published_part is not None and job_succeeded:
        # The shared semaphore is still held, so no other splat fitter can be
        # creating a not-yet-published output while prior outputs are pruned
        # for this one-asset-per-part lifecycle.
        definition.retain_output(**ids, output_path=output_path)
    else:
        definition.discard_output(
            **ids, output_path=output_path, latest_asset=final_metadata
        )


async def run_pt3_job(
    definition: PT3JobDefinition,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    source_path_text: str,
    payload_data: dict,
    job_id: str,
    requested_by: str,
    job_db: AsyncSession,
) -> None:
    """Admit, compute, and publish one job while it still owns its part."""
    ids = {"project_id": project_id, "part_id": part_id, "job_id": job_id}
    compute_slot_acquired = False
    try:
        # Refresh under a row lock before doing any CPU work so a job that was
        # superseded while queued never waits for the compute slot.
        if await _owned_metadata_snapshot(definition, job_db, **ids) is None:
            definition.discard_output(**ids, output_path=None, latest_asset={})
            return
        await acquire_compute_slot()
        compute_slot_acquired = True
        # This job may have waited behind another Real or Simplified fit. Check
        # ownership again before decoding the volume or allocating splat state.
        metadata = await _owned_metadata_snapshot(definition, job_db, **ids)
        if metadata is None:
            definition.discard_output(**ids, output_path=None, latest_asset={})
            return
        context = PT3JobContext(
            **ids,
            payload_data=payload_data,
            source_path_text=source_path_text,
            metadata=metadata,
            report_progress=(
                _progress_reporter(definition, job_db, **ids)
                if definition.reports_progress
                else None
            ),
        )
        outcome = await _execute(definition, context)
        if outcome is None:
            definition.discard_output(**ids, output_path=None, latest_asset={})
            return
        final_metadata, output_path = outcome
        await _publish(
            definition,
            context,
            job_db,
            final_metadata=final_metadata,
            output_path=output_path,
            requested_by=requested_by,
        )
    finally:
        if compute_slot_acquired:
            COMPUTE_SEMAPHORE.release()
        definition.cleanup_input(**ids)


async def run_pt3_job_in_session(
    definition: PT3JobDefinition, *, session_bind: Any, **job_kwargs
) -> None:
    """Run a job in a session owned by the background task."""
    async with AsyncSession(
        bind=session_bind,
        expire_on_commit=False,
        autoflush=False,
    ) as job_db:
        await run_pt3_job(definition, job_db=job_db, **job_kwargs)
