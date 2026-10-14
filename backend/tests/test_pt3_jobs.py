"""Focused coverage for the shared PT3 background job runner."""

import asyncio
import uuid
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from services.inspection import pt3_jobs

METADATA_KEY = "pt3_test_asset"


class RecordingJob:
    """A fake job definition whose hooks record every call."""

    def __init__(self, execute):
        self.calls: list[tuple[str, dict]] = []
        self.definition = pt3_jobs.PT3JobDefinition(
            metadata_key=METADATA_KEY,
            execute=execute,
            build_failure_metadata=self._failure,
            cleanup_input=self._recorder("cleanup_input"),
            discard_output=self._recorder("discard_output"),
            retain_output=self._recorder("retain_output"),
        )

    def _recorder(self, name):
        def record(**kwargs):
            self.calls.append((name, kwargs))

        return record

    @staticmethod
    def _failure(context, exc):
        return {"job_id": context.job_id, "status": "failed", "error": str(exc)}

    def hook_names(self) -> list[str]:
        return [name for name, _kwargs in self.calls]


async def _create_part(db_session, *, job_id: str) -> models.InspectionPart:
    project = models.Project(
        id=uuid.uuid4(),
        name="PT3 runner test",
        meta_group_id="pt3-runner-test",
        project_type="PT3",
    )
    part = models.InspectionPart(
        id=uuid.uuid4(),
        project_id=project.id,
        serial_number=f"PT3-RUNNER-{uuid.uuid4().hex[:8]}",
        metadata_json={METADATA_KEY: {"job_id": job_id, "status": "pending"}},
    )
    db_session.add_all([project, part])
    await db_session.commit()
    return part


def _run(job: RecordingJob, part, job_db, *, job_id: str):
    return pt3_jobs.run_pt3_job(
        job.definition,
        project_id=part.project_id,
        part_id=part.id,
        source_path_text="/unused",
        payload_data={},
        job_id=job_id,
        requested_by="runner@example.com",
        job_db=job_db,
    )


def _assert_compute_slot_free() -> None:
    assert pt3_jobs.COMPUTE_SEMAPHORE.acquire(blocking=False) is True
    pt3_jobs.COMPUTE_SEMAPHORE.release()


@pytest.mark.asyncio
async def test_superseded_job_never_overwrites_newer_job_and_discards_output(
    db_session, tmp_path
):
    part = await _create_part(db_session, job_id="old-job")
    newer_asset = {"job_id": "newer-job", "status": "pending"}
    execute_started = asyncio.Event()
    allow_completion = asyncio.Event()
    output_path = tmp_path / "old-output.json"

    async def execute(context):
        execute_started.set()
        await allow_completion.wait()
        return {"job_id": context.job_id, "status": "ready"}, output_path

    job = RecordingJob(execute)
    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        worker = asyncio.create_task(_run(job, part, job_db, job_id="old-job"))
        await asyncio.wait_for(execute_started.wait(), timeout=5)
        part.metadata_json = {**part.metadata_json, METADATA_KEY: newer_asset}
        await db_session.commit()
        allow_completion.set()
        await asyncio.wait_for(worker, timeout=5)

    await db_session.refresh(part)
    assert part.metadata_json[METADATA_KEY] == newer_asset
    assert job.hook_names() == ["discard_output", "cleanup_input"]
    discard_kwargs = job.calls[0][1]
    assert discard_kwargs["output_path"] == output_path
    assert discard_kwargs["latest_asset"] == newer_asset
    _assert_compute_slot_free()


@pytest.mark.asyncio
async def test_compute_slot_released_when_execute_raises(db_session):
    part = await _create_part(db_session, job_id="failing-job")

    async def execute(_context):
        raise RuntimeError("synthetic fit failure")

    job = RecordingJob(execute)
    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        await _run(job, part, job_db, job_id="failing-job")

    await db_session.refresh(part)
    assert part.metadata_json[METADATA_KEY] == {
        "job_id": "failing-job",
        "status": "failed",
        "error": "synthetic fit failure",
    }
    assert "retain_output" not in job.hook_names()
    assert job.hook_names()[-1] == "cleanup_input"
    _assert_compute_slot_free()


@pytest.mark.asyncio
async def test_compute_slot_released_when_job_is_superseded_mid_execute(db_session):
    part = await _create_part(db_session, job_id="superseded-job")
    original_asset = dict(part.metadata_json[METADATA_KEY])

    async def execute(_context):
        raise pt3_jobs.JobSuperseded()

    job = RecordingJob(execute)
    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        await _run(job, part, job_db, job_id="superseded-job")

    await db_session.refresh(part)
    # Supersession is not a failure: nothing is published for this job.
    assert part.metadata_json[METADATA_KEY] == original_asset
    assert job.hook_names() == ["discard_output", "cleanup_input"]
    _assert_compute_slot_free()


@pytest.mark.asyncio
async def test_compute_slot_released_when_job_task_is_cancelled(db_session):
    part = await _create_part(db_session, job_id="cancelled-job")
    execute_started = asyncio.Event()

    async def execute(_context):
        execute_started.set()
        await asyncio.Event().wait()
        return {}, Path("/unreachable")

    job = RecordingJob(execute)
    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        worker = asyncio.create_task(_run(job, part, job_db, job_id="cancelled-job"))
        await asyncio.wait_for(execute_started.wait(), timeout=5)
        assert pt3_jobs.COMPUTE_SEMAPHORE.acquire(blocking=False) is False
        worker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await worker

    assert job.hook_names() == ["cleanup_input"]
    _assert_compute_slot_free()


@pytest.mark.asyncio
async def test_ready_publication_retains_output_while_slot_is_held(
    db_session, tmp_path
):
    part = await _create_part(db_session, job_id="ready-job")
    output_path = tmp_path / "ready.json"
    slot_free_during_retain: list[bool] = []

    async def execute(context):
        return {"job_id": context.job_id, "status": "ready"}, output_path

    job = RecordingJob(execute)

    def retain_output(**kwargs):
        acquired = pt3_jobs.COMPUTE_SEMAPHORE.acquire(blocking=False)
        if acquired:
            pt3_jobs.COMPUTE_SEMAPHORE.release()
        slot_free_during_retain.append(acquired)
        job.calls.append(("retain_output", kwargs))

    definition = pt3_jobs.PT3JobDefinition(
        **{**job.definition.__dict__, "retain_output": retain_output}
    )
    job.definition = definition
    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        await _run(job, part, job_db, job_id="ready-job")

    await db_session.refresh(part)
    assert part.metadata_json[METADATA_KEY] == {
        "job_id": "ready-job",
        "status": "ready",
    }
    assert job.hook_names() == ["retain_output", "cleanup_input"]
    assert job.calls[0][1]["output_path"] == output_path
    assert slot_free_during_retain == [False]
    _assert_compute_slot_free()
