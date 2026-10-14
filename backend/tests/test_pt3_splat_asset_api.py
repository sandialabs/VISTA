import asyncio
import base64
import io
import json
import os
import stat
import threading
import uuid
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import BackgroundTasks
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from repositories import inspection as inspection_repository
from routers import inspection_workbench
from schemas import inspection_pt3 as inspection_pt3_schemas
from services.errors import ServiceError
from services.inspection import pt3_assets as pt3_asset_service
from services.inspection import pt3_cache as pt3_cache_service
from services.inspection import (
    pt3_jobs,
    pt3_splat_jobs,
    pt3_splat_status,
    pt3_volume_stack,
)


def test_pt3_cache_root_honors_configured_cache_dir(monkeypatch, tmp_path):
    configured_root = tmp_path / "writable-cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))

    assert pt3_cache_service.pt3_cache_root() == configured_root.resolve()
    assert all(
        (configured_root / namespace).is_dir()
        for namespace in pt3_cache_service.PT3_CACHE_NAMESPACES
    )
    assert stat.S_IMODE(configured_root.stat().st_mode) == 0o700
    assert all(
        stat.S_IMODE((configured_root / namespace).stat().st_mode) == 0o700
        for namespace in pt3_cache_service.PT3_CACHE_NAMESPACES
    )


def test_pt3_cache_directory_repairs_service_owned_read_only_descendants(
    monkeypatch,
    tmp_path,
):
    configured_root = tmp_path / "writable-cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))
    pt3_cache_service.pt3_cache_root()
    descendants = [
        configured_root / "pt3_volume_stacks" / "project-id",
        configured_root / "pt3_volume_stacks" / "project-id" / "part-id",
        configured_root / "pt3_volume_stacks" / "project-id" / "part-id" / "job-id",
    ]
    descendants[-1].mkdir(parents=True)
    for directory in reversed(descendants):
        directory.chmod(0o555)

    prepared = pt3_cache_service.pt3_cache_directory(
        "pt3_volume_stacks",
        "project-id",
        "part-id",
        "job-id",
        create=True,
        repair_mode=True,
    )

    assert prepared == descendants[-1]
    assert all(
        stat.S_IMODE(directory.stat().st_mode) == 0o700 for directory in descendants
    )


def test_pt3_cache_directory_rejects_stale_job_symlink_without_touching_target(
    monkeypatch,
    tmp_path,
):
    configured_root = tmp_path / "writable-cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))
    pt3_cache_service.pt3_cache_root()
    part_root = configured_root / "pt3_volume_stacks" / "project-id" / "part-id"
    part_root.mkdir(parents=True)
    external = tmp_path / "external-job"
    external.mkdir()
    marker = external / "must-remain.txt"
    marker.write_text("outside cache", encoding="utf-8")
    stale_job = part_root / "job-id"
    stale_job.symlink_to(external, target_is_directory=True)

    with pytest.raises(OSError):
        pt3_cache_service.pt3_cache_directory(
            "pt3_volume_stacks",
            "project-id",
            "part-id",
            "job-id",
            create=True,
            repair_mode=True,
        )

    assert stale_job.is_symlink()
    assert marker.read_text(encoding="utf-8") == "outside cache"


def test_pt3_cache_cleanup_does_not_follow_symlinked_stale_part(
    monkeypatch,
    tmp_path,
):
    configured_root = tmp_path / "writable-cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))
    pt3_cache_service.pt3_cache_root()
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    job_id = "stale-job"
    project_root = configured_root / "pt3_volume_stacks" / str(project_id)
    project_root.mkdir()
    external_part = tmp_path / "external-part"
    external_job = external_part / job_id
    external_job.mkdir(parents=True)
    marker = external_job / "must-remain.txt"
    marker.write_text("outside cache", encoding="utf-8")
    (project_root / str(part_id)).symlink_to(external_part, target_is_directory=True)

    pt3_asset_service.cleanup_pt3_real_splat_job_cache(
        project_id=project_id,
        part_id=part_id,
        job_id=job_id,
        remove_output=False,
    )

    assert marker.read_text(encoding="utf-8") == "outside cache"


def test_backend_startup_repairs_stale_directory_modes_without_following_links():
    script = (
        Path(inspection_workbench.__file__).resolve().parents[1]
        / "scripts"
        / "start_dev_server.sh"
    ).read_text(encoding="utf-8")

    assert "find -P" in script
    assert "-exec chown --no-dereference appuser:appuser {} +" in script
    assert "-exec chmod 0700 {} +" in script


def test_pt3_cache_root_falls_back_when_concrete_namespace_is_not_writable(
    monkeypatch,
    tmp_path,
):
    configured_root = tmp_path / "configured"
    configured_root.mkdir()
    (configured_root / "pt3_volume_stacks").write_text(
        "not a directory", encoding="utf-8"
    )
    fallback_parent = tmp_path / "temporary"
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))
    monkeypatch.setattr(
        pt3_cache_service.tempfile, "gettempdir", lambda: str(fallback_parent)
    )

    cache_root = pt3_cache_service.pt3_cache_root()

    assert cache_root == (fallback_parent / f"vista-pt3-cache-{os.getuid()}").resolve()
    assert all(
        (cache_root / namespace).is_dir()
        for namespace in pt3_cache_service.PT3_CACHE_NAMESPACES
    )
    assert stat.S_IMODE(cache_root.stat().st_mode) == 0o700
    assert all(
        stat.S_IMODE((cache_root / namespace).stat().st_mode) == 0o700
        for namespace in pt3_cache_service.PT3_CACHE_NAMESPACES
    )


@pytest.mark.parametrize(
    "link_location", ["root", "namespace", "namespace-within-root"]
)
def test_pt3_cache_root_rejects_symbolic_links(
    monkeypatch,
    tmp_path,
    link_location,
):
    configured_root = tmp_path / "configured"
    linked_target = tmp_path / "linked-target"
    linked_target.mkdir()
    if link_location == "root":
        configured_root.symlink_to(linked_target, target_is_directory=True)
    else:
        configured_root.mkdir()
        target = (
            configured_root / "pt3_real_splat_assets"
            if link_location == "namespace-within-root"
            else linked_target
        )
        if link_location == "namespace-within-root":
            target.mkdir()
        (configured_root / "pt3_volume_stacks").symlink_to(
            target,
            target_is_directory=True,
        )
    fallback_parent = tmp_path / "temporary"
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))
    monkeypatch.setattr(
        pt3_cache_service.tempfile,
        "gettempdir",
        lambda: str(fallback_parent),
    )

    cache_root = pt3_cache_service.pt3_cache_root()

    assert cache_root == (fallback_parent / f"vista-pt3-cache-{os.getuid()}").resolve()
    assert stat.S_IMODE(cache_root.stat().st_mode) == 0o700


def test_pt3_cache_root_falls_back_from_parent_symlink_loop(monkeypatch, tmp_path):
    loop = tmp_path / "loop"
    loop.symlink_to(loop, target_is_directory=True)
    fallback_parent = tmp_path / "temporary"
    monkeypatch.setattr(settings, "CACHE_DIR", str(loop / "cache"))
    monkeypatch.setattr(
        pt3_cache_service.tempfile,
        "gettempdir",
        lambda: str(fallback_parent),
    )

    cache_root = pt3_cache_service.pt3_cache_root()

    assert cache_root == (fallback_parent / f"vista-pt3-cache-{os.getuid()}").resolve()


def test_pt3_cache_root_reports_sanitized_error_when_fallback_is_unavailable(
    monkeypatch,
    tmp_path,
):
    configured_root = tmp_path / "configured"
    fallback_parent = tmp_path / "temporary"
    configured_root.write_text("not a directory", encoding="utf-8")
    fallback_parent.write_text("not a directory", encoding="utf-8")
    monkeypatch.setattr(settings, "CACHE_DIR", str(configured_root))
    monkeypatch.setattr(
        pt3_cache_service.tempfile, "gettempdir", lambda: str(fallback_parent)
    )

    with pytest.raises(
        pt3_cache_service.PT3CacheUnavailableError,
        match="job directories are not writable",
    ) as exc_info:
        pt3_cache_service.pt3_cache_root()

    assert str(configured_root) not in str(exc_info.value)
    assert str(fallback_parent) not in str(exc_info.value)


@pytest.mark.asyncio
async def test_volume_materialization_translates_cache_failure_to_sanitized_503(
    monkeypatch,
):
    private_path = "/private/root-owned/pt3_volume_stacks"

    def unavailable_cache():
        raise PermissionError(private_path)

    monkeypatch.setattr(pt3_cache_service, "pt3_cache_root", unavailable_cache)
    part = SimpleNamespace(
        id=uuid.uuid4(),
        metadata_json={
            "source_images": [
                {
                    "image_id": str(uuid.uuid4()),
                    "filename": "source.npy",
                    "slice_index": 0,
                }
            ]
        },
    )

    with pytest.raises(ServiceError) as exc_info:
        await pt3_volume_stack.materialize_part_volume_stack(
            project_id=uuid.uuid4(),
            part=part,
            db=object(),
            materialization_key="job-id",
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == (
        "PT3 fitting cache is unavailable because a writable job directory could not be prepared"
    )
    assert private_path not in exc_info.value.detail


@pytest.mark.asyncio
async def test_real_splat_create_preserves_sanitized_503_when_cleanup_cache_is_unavailable(
    monkeypatch,
):
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    private_path = "/private/root-owned/pt3_volume_stacks"

    async def inspection_part(**_kwargs):
        return SimpleNamespace(
            id=part_id,
            metadata_json={
                "source_images": [
                    {
                        "image_id": str(uuid.uuid4()),
                        "filename": "source.npy",
                        "slice_index": 0,
                    }
                ]
            },
        )

    class FakeDB:
        async def rollback(self):
            return None

    def unavailable_cache():
        raise pt3_cache_service.PT3CacheUnavailableError(private_path)

    monkeypatch.setattr(
        inspection_repository,
        "get_inspection_part",
        inspection_part,
    )
    monkeypatch.setattr(pt3_cache_service, "pt3_cache_root", unavailable_cache)

    with pytest.raises(ServiceError) as exc_info:
        await inspection_workbench.create_pt3_real_gaussian_splat_asset(
            project_id=project_id,
            project=SimpleNamespace(project_type="PT3"),
            part_id=part_id,
            payload=inspection_pt3_schemas.PT3RealSplatOptimizationRequest(),
            background_tasks=BackgroundTasks(),
            db=FakeDB(),
            current_user=SimpleNamespace(email="cache-test@example.com"),
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == (
        "PT3 fitting cache is unavailable because a writable job directory could not be prepared"
    )
    assert private_path not in exc_info.value.detail
    # Both cleanup variants are deliberately safe to call in the same outage.
    pt3_asset_service.cleanup_pt3_simplified_splat_job_input(
        project_id=project_id,
        part_id=part_id,
        job_id="cleanup-test",
    )


def test_public_real_splat_error_redacts_arbitrary_absolute_provider_paths(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    private_error = RuntimeError(
        "/opt/private-models/weights.pt: permission denied; "
        "'C:\\private models\\weights.bin'; "
        "'\\\\server\\share\\model.bin'"
    )

    public_error = pt3_asset_service.public_pt3_real_splat_error(private_error)

    assert "permission denied" in public_error
    assert public_error.count("<path>") == 3
    assert "/opt/private-models" not in public_error
    assert "C:\\private models" not in public_error
    assert "\\\\server\\share" not in public_error


def test_pending_real_splat_status_hides_internal_fallback_path_and_resolves_old_cache_key():
    previous = {
        "job_id": "published-job",
        "status": "ready",
        "cache_key": "published-cache-key",
        "asset_path": "/private/cache/published.json",
        "asset_url": "/api/published-cache-key",
        "splat_count": 12,
    }
    pending = {
        "job_id": "recompute-job",
        "status": "pending",
        "stage": "optimizing",
        "progress_percent": 42,
        "previous_ready_asset": previous,
    }

    status_payload = pt3_splat_status.real_splat_status_from_metadata(
        uuid.uuid4(),
        uuid.uuid4(),
        {"pt3_real_splat_asset": pending},
    ).model_dump(mode="json")

    assert status_payload["status"] == "pending"
    assert "previous_ready_asset" not in status_payload["metadata"]
    assert "/private/cache" not in json.dumps(status_payload)
    assert (
        pt3_asset_service.pt3_real_splat_asset_for_cache(
            pending,
            "published-cache-key",
        )
        == previous
    )


def test_real_splat_status_rejects_forged_paths_and_derives_internal_url(
    monkeypatch,
    tmp_path,
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    cache_key = "pt3-voxel-direct-contained"
    external_path = tmp_path / f"{cache_key}.json"
    external_path.write_text("{}", encoding="utf-8")
    forged = {
        "job_id": "forged-job",
        "status": "ready",
        "cache_key": cache_key,
        "asset_path": str(external_path),
        "asset_url": "https://attacker.example/forged-real-asset",
        "source_files": ["/private/cache/source.npy"],
        "splat_count": 1,
        "progress_percent": 100,
    }

    rejected = pt3_splat_status.real_splat_status_from_metadata(
        project_id,
        part_id,
        {"pt3_real_splat_asset": forged},
    ).model_dump(mode="json")

    assert rejected["status"] == "missing"
    assert rejected["asset_url"] is None
    assert "attacker.example" not in json.dumps(rejected)
    assert "/private/cache" not in json.dumps(rejected)
    assert (
        pt3_asset_service.usable_previous_pt3_real_splat_asset(
            forged,
            project_id=project_id,
            part_id=part_id,
        )
        is None
    )

    contained_path = (
        cache_root
        / "pt3_real_splat_assets"
        / str(project_id)
        / str(part_id)
        / "contained-job"
        / "canonical.json"
    )
    contained_path.parent.mkdir(parents=True)
    contained_path.write_text("{}", encoding="utf-8")
    contained = {
        **forged,
        "job_id": "contained-job",
        "asset_path": str(contained_path),
    }
    accepted = pt3_splat_status.real_splat_status_from_metadata(
        project_id,
        part_id,
        {"pt3_real_splat_asset": contained},
    ).model_dump(mode="json")

    expected_url = f"/api/projects/{project_id}/parts/{part_id}/real-gaussian-splat-assets/{cache_key}"
    assert accepted["status"] == "ready"
    assert accepted["asset_url"] == expected_url
    assert accepted["metadata"]["asset_url"] == expected_url
    assert "asset_path" not in accepted["metadata"]
    assert "source_files" not in accepted["metadata"]
    assert "attacker.example" not in json.dumps(accepted)


def test_provider_camera_binding_keeps_voxel_sources_separate_from_generated_views():
    assert (
        pt3_asset_service.pt3_provider_camera_view_binding(
            source_image_ids=["server-owned-container-id"],
            camera_image_ids={"generated-view-a", "generated-view-b"},
        )
        == "generated_from_voxel_volume"
    )

    assert (
        pt3_asset_service.pt3_provider_camera_view_binding(
            source_image_ids=["source-view-a", "source-view-b"],
            camera_image_ids={"source-view-a", "source-view-b"},
        )
        == "server_inferred_source_views"
    )

    # A directory of axial/slice images is still a voxel volume, not an
    # exterior camera stack, so independently generated views are valid here.
    assert (
        pt3_asset_service.pt3_provider_camera_view_binding(
            source_image_ids=["slice-z000", "slice-z001", "slice-z002"],
            camera_image_ids={"generated-view-a", "generated-view-b"},
        )
        == "generated_from_voxel_volume"
    )


@pytest.mark.asyncio
async def test_stale_simplified_worker_cannot_publish_over_newer_recompute(
    db_session,
    monkeypatch,
    tmp_path,
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    old_job_id = "older-simplified-job"
    newer_asset = {
        "job_id": "newer-simplified-job",
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
    }
    project = models.Project(
        id=project_id,
        name="PT3 stale Simplified worker regression",
        meta_group_id="pt3-stale-simplified",
        project_type="PT3",
    )
    part = models.InspectionPart(
        id=part_id,
        project_id=project_id,
        serial_number="PT3-STALE-SIMPLIFIED-001",
        metadata_json={
            "volume_stack_id": "stale-simplified-volume",
            "pt3_splat_asset": {
                "job_id": old_job_id,
                "status": "pending",
                "stage": "queued",
                "progress_percent": 0,
            },
        },
    )
    db_session.add_all([project, part])
    await db_session.commit()

    input_path = pt3_splat_jobs.simplified_splat_job_input_path(
        project_id=project_id,
        part_id=part_id,
        job_id=old_job_id,
    )
    input_path.mkdir(parents=True)
    source_path = input_path / "volume.npy"
    np.save(source_path, np.ones((1, 1, 1), dtype=np.uint8))
    converter_started = threading.Event()
    allow_completion = threading.Event()
    output_root = cache_root / "pt3_splat_assets" / str(project_id) / str(part_id)

    def blocking_converter(*_args, **_kwargs):
        converter_started.set()
        if not allow_completion.wait(timeout=5):
            raise AssertionError("test did not release the Simplified converter")
        output_root.mkdir(parents=True, exist_ok=True)
        output_path = output_root / "stale-simplified-output.json"
        output_path.write_text("{}", encoding="utf-8")
        return SimpleNamespace(
            cache_key="stale-simplified-output",
            path=str(output_path),
            output_format="json",
            splat_count=1,
            metadata={"volume_stack_id": "stale-simplified-volume"},
        )

    monkeypatch.setattr(
        pt3_splat_jobs,
        "convert_volume_to_splat_asset",
        blocking_converter,
    )
    payload_data = inspection_pt3_schemas.PT3SplatConversionRequest(
        volume_stack_id="stale-simplified-volume",
        max_splats=1,
        output_format="json",
    ).model_dump(mode="json")

    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        worker = asyncio.create_task(
            pt3_jobs.run_pt3_job(
                pt3_splat_jobs.SIMPLIFIED_SPLAT_JOB,
                project_id=project_id,
                part_id=part_id,
                source_path_text=str(source_path),
                payload_data=payload_data,
                job_id=old_job_id,
                requested_by="stale-simplified@example.com",
                job_db=job_db,
            )
        )
        assert await asyncio.to_thread(converter_started.wait, 5)
        part.metadata_json = {
            **part.metadata_json,
            "pt3_splat_asset": newer_asset,
        }
        await db_session.commit()
        allow_completion.set()
        await asyncio.wait_for(worker, timeout=5)

    await db_session.refresh(part)
    assert part.metadata_json["pt3_splat_asset"] == newer_asset
    assert not input_path.exists()


@pytest.mark.asyncio
async def test_simplified_worker_rechecks_ownership_after_compute_slot_wait(
    db_session,
    monkeypatch,
    tmp_path,
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    old_job_id = "waiting-simplified-job"
    newer_asset = {
        "job_id": "replacement-simplified-job",
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
    }
    project = models.Project(
        id=project_id,
        name="PT3 waiting Simplified worker regression",
        meta_group_id="pt3-waiting-simplified",
        project_type="PT3",
    )
    part = models.InspectionPart(
        id=part_id,
        project_id=project_id,
        serial_number="PT3-WAITING-SIMPLIFIED-001",
        metadata_json={
            "volume_stack_id": "waiting-simplified-volume",
            "pt3_splat_asset": {
                "job_id": old_job_id,
                "status": "pending",
                "stage": "queued",
                "progress_percent": 0,
            },
        },
    )
    db_session.add_all([project, part])
    await db_session.commit()

    input_path = pt3_splat_jobs.simplified_splat_job_input_path(
        project_id=project_id,
        part_id=part_id,
        job_id=old_job_id,
    )
    input_path.mkdir(parents=True)
    source_path = input_path / "volume.npy"
    np.save(source_path, np.ones((1, 1, 1), dtype=np.uint8))
    converter_called = False

    def converter_must_not_run(*_args, **_kwargs):
        nonlocal converter_called
        converter_called = True
        raise AssertionError("superseded Simplified job entered conversion")

    monkeypatch.setattr(
        pt3_splat_jobs,
        "convert_volume_to_splat_asset",
        converter_must_not_run,
    )
    wait_started = asyncio.Event()
    acquire_compute_slot = pt3_jobs.acquire_compute_slot

    async def observed_compute_slot_wait():
        wait_started.set()
        await acquire_compute_slot()

    monkeypatch.setattr(
        pt3_jobs,
        "acquire_compute_slot",
        observed_compute_slot_wait,
    )
    payload_data = inspection_pt3_schemas.PT3SplatConversionRequest(
        volume_stack_id="waiting-simplified-volume",
        max_splats=1,
        output_format="json",
    ).model_dump(mode="json")

    await acquire_compute_slot()
    slot_held_by_test = True
    try:
        async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
            worker = asyncio.create_task(
                pt3_jobs.run_pt3_job(
                    pt3_splat_jobs.SIMPLIFIED_SPLAT_JOB,
                    project_id=project_id,
                    part_id=part_id,
                    source_path_text=str(source_path),
                    payload_data=payload_data,
                    job_id=old_job_id,
                    requested_by="waiting-simplified@example.com",
                    job_db=job_db,
                )
            )
            await asyncio.wait_for(wait_started.wait(), timeout=5)
            assert worker.done() is False
            part.metadata_json = {
                **part.metadata_json,
                "pt3_splat_asset": newer_asset,
            }
            await db_session.commit()
            pt3_jobs.COMPUTE_SEMAPHORE.release()
            slot_held_by_test = False
            await asyncio.wait_for(worker, timeout=5)
    finally:
        if slot_held_by_test:
            pt3_jobs.COMPUTE_SEMAPHORE.release()

    await db_session.refresh(part)
    assert part.metadata_json["pt3_splat_asset"] == newer_asset
    assert converter_called is False
    assert not input_path.exists()


@pytest.mark.asyncio
async def test_stale_identity_mapped_worker_cannot_reclaim_newer_recompute(
    db_session, monkeypatch, tmp_path
):
    """Locked worker rereads must refresh expire_on_commit=False identity state."""

    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    old_job_id = "older-background-job"
    newer_asset = {
        "job_id": "newer-recompute-job",
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
    }
    project = models.Project(
        id=project_id,
        name="PT3 stale worker regression",
        meta_group_id="pt3-stale-worker",
        project_type="PT3",
    )
    part = models.InspectionPart(
        id=part_id,
        project_id=project_id,
        serial_number="PT3-STALE-WORKER-001",
        metadata_json={
            "volume_stack_id": "stale-worker-volume",
            "pt3_real_splat_asset": {
                "job_id": old_job_id,
                "status": "pending",
                "stage": "optimizing",
                "progress_percent": 25,
            },
        },
    )
    db_session.add_all([project, part])
    await db_session.commit()

    # Two old worker sessions retain the original ORM row after commit, exactly
    # as the production sessionmaker does with expire_on_commit=False.
    async with (
        AsyncSession(bind=db_session.bind, expire_on_commit=False) as progress_db,
        AsyncSession(bind=db_session.bind, expire_on_commit=False) as completion_db,
    ):
        progress_part = (
            await progress_db.execute(
                select(models.InspectionPart).where(models.InspectionPart.id == part_id)
            )
        ).scalar_one()
        completion_part = (
            await completion_db.execute(
                select(models.InspectionPart).where(models.InspectionPart.id == part_id)
            )
        ).scalar_one()
        await progress_db.commit()
        await completion_db.commit()
        assert (
            progress_part.metadata_json["pt3_real_splat_asset"]["job_id"] == old_job_id
        )
        assert (
            completion_part.metadata_json["pt3_real_splat_asset"]["job_id"]
            == old_job_id
        )

        # A different request now owns the row, while both worker identity maps
        # still contain the older pending job.
        part.metadata_json = {
            **part.metadata_json,
            "pt3_real_splat_asset": newer_asset,
        }
        await db_session.commit()

        progress_was_published = await pt3_jobs.update_job_progress(
            metadata_key=pt3_splat_jobs.REAL_SPLAT_METADATA_KEY,
            project_id=project_id,
            part_id=part_id,
            job_id=old_job_id,
            progress_percent=75,
            stage="stale-progress",
            job_db=progress_db,
        )
        assert progress_was_published is False

        input_path, output_path = pt3_splat_jobs.real_splat_job_cache_paths(
            project_id=project_id,
            part_id=part_id,
            job_id=old_job_id,
        )
        input_path.mkdir(parents=True)
        output_path.mkdir(parents=True)
        source_path = input_path / "volume.npy"
        np.save(source_path, np.ones((1, 1, 1), dtype=np.uint8))

        optimizer_called = False

        def stale_optimizer(**_kwargs):
            nonlocal optimizer_called
            optimizer_called = True
            return SimpleNamespace(
                cache_key="stale-output",
                path=str(output_path / "stale.json"),
                splat_count=1,
                metadata={},
            )

        monkeypatch.setattr(
            pt3_splat_jobs,
            "optimize_real_gaussian_splat_asset",
            stale_optimizer,
        )
        payload_data = inspection_pt3_schemas.PT3RealSplatOptimizationRequest(
            parameters={"max_splats": 1}
        ).model_dump(mode="json")
        await pt3_jobs.run_pt3_job(
            pt3_splat_jobs.REAL_SPLAT_JOB,
            project_id=project_id,
            part_id=part_id,
            source_path_text=str(source_path),
            payload_data=payload_data,
            job_id=old_job_id,
            requested_by="stale-worker@example.com",
            job_db=completion_db,
        )

    await db_session.refresh(part)
    assert part.metadata_json["pt3_real_splat_asset"] == newer_asset
    assert optimizer_called is False
    assert not input_path.exists()
    assert not output_path.exists()


@pytest.mark.asyncio
async def test_progress_update_cannot_reopen_a_completed_real_splat_job():
    asset = {
        "job_id": "completed-job",
        "status": "ready",
        "stage": "ready",
        "progress_percent": 100,
    }
    part = SimpleNamespace(metadata_json={"pt3_real_splat_asset": asset})

    class Result:
        def scalar_one_or_none(self):
            return part

    class FakeDB:
        committed = False

        async def rollback(self):
            return None

        async def execute(self, _statement):
            return Result()

        async def commit(self):
            self.committed = True

    job_db = FakeDB()
    published = await pt3_jobs.update_job_progress(
        metadata_key=pt3_splat_jobs.REAL_SPLAT_METADATA_KEY,
        project_id=uuid.uuid4(),
        part_id=uuid.uuid4(),
        job_id="completed-job",
        progress_percent=80,
        stage="late-progress",
        job_db=job_db,
    )

    assert published is False
    assert job_db.committed is False
    assert part.metadata_json["pt3_real_splat_asset"] == asset


@pytest.mark.asyncio
async def test_superseding_running_job_makes_progress_callback_abort_compute(
    db_session, monkeypatch, tmp_path
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    job_id = "running-job"
    pending_asset = {
        "job_id": job_id,
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
    }
    newer_asset = {
        "job_id": "replacement-job",
        "status": "pending",
        "stage": "queued",
        "progress_percent": 0,
    }
    project = models.Project(
        id=project_id,
        name="PT3 superseded compute regression",
        meta_group_id="pt3-superseded-compute",
        project_type="PT3",
    )
    part = models.InspectionPart(
        id=part_id,
        project_id=project_id,
        serial_number="PT3-SUPERSEDED-COMPUTE-001",
        metadata_json={
            "volume_stack_id": "superseded-compute-volume",
            "pt3_real_splat_asset": pending_asset,
        },
    )
    db_session.add_all([project, part])
    await db_session.commit()

    input_path, output_path = pt3_splat_jobs.real_splat_job_cache_paths(
        project_id=project_id,
        part_id=part_id,
        job_id=job_id,
    )
    input_path.mkdir(parents=True)
    source_path = input_path / "volume.npy"
    np.save(source_path, np.ones((1, 1, 1), dtype=np.uint8))
    optimizer_started = threading.Event()
    allow_progress = threading.Event()
    continued_after_progress = False

    def cancellable_optimizer(**kwargs):
        nonlocal continued_after_progress
        output_path.mkdir(parents=True, exist_ok=True)
        (output_path / "partial.json").write_text("{}", encoding="utf-8")
        optimizer_started.set()
        if not allow_progress.wait(timeout=5):
            raise AssertionError("test did not release the fake optimizer")
        kwargs["progress_callback"](40, "running-test-fit")
        continued_after_progress = True
        raise AssertionError(
            "a superseded optimizer continued after reporting progress"
        )

    monkeypatch.setattr(
        pt3_splat_jobs,
        "optimize_real_gaussian_splat_asset",
        cancellable_optimizer,
    )
    payload_data = inspection_pt3_schemas.PT3RealSplatOptimizationRequest(
        parameters={"max_splats": 1}
    ).model_dump(mode="json")

    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        worker = asyncio.create_task(
            pt3_jobs.run_pt3_job(
                pt3_splat_jobs.REAL_SPLAT_JOB,
                project_id=project_id,
                part_id=part_id,
                source_path_text=str(source_path),
                payload_data=payload_data,
                job_id=job_id,
                requested_by="superseded-worker@example.com",
                job_db=job_db,
            )
        )
        assert await asyncio.to_thread(optimizer_started.wait, 5)
        part.metadata_json = {
            **part.metadata_json,
            "pt3_real_splat_asset": newer_asset,
        }
        await db_session.commit()
        allow_progress.set()
        await asyncio.wait_for(worker, timeout=5)

    await db_session.refresh(part)
    assert part.metadata_json["pt3_real_splat_asset"] == newer_asset
    assert continued_after_progress is False
    assert not input_path.exists()
    assert not output_path.exists()


@pytest.mark.asyncio
async def test_real_splat_progress_timeout_cancels_update_before_publication(
    db_session,
    monkeypatch,
    tmp_path,
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    job_id = "progress-timeout-job"
    project = models.Project(
        id=project_id,
        name="PT3 progress timeout regression",
        meta_group_id="pt3-progress-timeout",
        project_type="PT3",
    )
    part = models.InspectionPart(
        id=part_id,
        project_id=project_id,
        serial_number="PT3-PROGRESS-TIMEOUT-001",
        metadata_json={
            "volume_stack_id": "progress-timeout-volume",
            "pt3_real_splat_asset": {
                "job_id": job_id,
                "status": "pending",
                "stage": "queued",
                "progress_percent": 0,
            },
        },
    )
    db_session.add_all([project, part])
    await db_session.commit()
    input_path, output_path = pt3_splat_jobs.real_splat_job_cache_paths(
        project_id=project_id,
        part_id=part_id,
        job_id=job_id,
    )
    input_path.mkdir(parents=True)
    source_path = input_path / "volume.npy"
    np.save(source_path, np.ones((1, 1, 1), dtype=np.uint8))
    progress_started = asyncio.Event()
    progress_cancelled = asyncio.Event()

    async def blocked_progress_update(**_kwargs):
        progress_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            progress_cancelled.set()
            raise

    def optimizer_with_stalled_progress(**kwargs):
        kwargs["progress_callback"](10, "stalled-progress")
        raise AssertionError("optimizer continued after a timed-out progress update")

    monkeypatch.setattr(
        pt3_jobs,
        "update_job_progress_in_session",
        blocked_progress_update,
    )
    monkeypatch.setattr(
        pt3_jobs,
        "PROGRESS_TIMEOUT_SECONDS",
        0.05,
    )
    monkeypatch.setattr(
        pt3_splat_jobs,
        "optimize_real_gaussian_splat_asset",
        optimizer_with_stalled_progress,
    )
    payload_data = inspection_pt3_schemas.PT3RealSplatOptimizationRequest(
        parameters={"max_splats": 1}
    ).model_dump(mode="json")

    async with AsyncSession(bind=db_session.bind, expire_on_commit=False) as job_db:
        await pt3_jobs.run_pt3_job(
            pt3_splat_jobs.REAL_SPLAT_JOB,
            project_id=project_id,
            part_id=part_id,
            source_path_text=str(source_path),
            payload_data=payload_data,
            job_id=job_id,
            requested_by="progress-timeout@example.com",
            job_db=job_db,
        )

    await asyncio.wait_for(progress_started.wait(), timeout=1)
    await asyncio.wait_for(progress_cancelled.wait(), timeout=1)
    await db_session.refresh(part)
    assert part.metadata_json["pt3_real_splat_asset"]["status"] == "failed"
    assert not input_path.exists()
    assert not output_path.exists()


@pytest.mark.asyncio
async def test_real_splat_compute_slot_serializes_jobs():
    await pt3_jobs.acquire_compute_slot()
    waiter = asyncio.create_task(pt3_jobs.acquire_compute_slot())
    try:
        await asyncio.sleep(0.12)
        assert waiter.done() is False
        pt3_jobs.COMPUTE_SEMAPHORE.release()
        await asyncio.wait_for(waiter, timeout=1)
    finally:
        if not waiter.done():
            waiter.cancel()
            pt3_jobs.COMPUTE_SEMAPHORE.release()
        elif not waiter.cancelled() and waiter.exception() is None:
            pt3_jobs.COMPUTE_SEMAPHORE.release()


@pytest.mark.asyncio
async def test_create_real_splat_reloads_locked_part_after_materialization_for_fallback(
    monkeypatch, tmp_path
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    source_id = str(uuid.uuid4())
    published_job_id = "job-that-finished-during-download"
    published_path = (
        cache_root
        / "pt3_real_splat_assets"
        / str(project_id)
        / str(part_id)
        / published_job_id
        / "published.json"
    )
    published_path.parent.mkdir(parents=True)
    published_path.write_text("{}", encoding="utf-8")
    late_ready_asset = {
        "job_id": published_job_id,
        "status": "ready",
        "cache_key": "late-ready-cache",
        "asset_path": str(published_path),
        "asset_url": "/api/late-ready-cache",
        "splat_count": 5,
    }
    initial_part = SimpleNamespace(
        id=part_id,
        metadata_json={
            "volume_stack_id": "stale-stack-id",
            "source_images": [{"image_id": source_id, "filename": "volume.npy"}],
        },
    )
    current_part = SimpleNamespace(
        id=part_id,
        metadata_json={
            "volume_stack_id": "fresh-stack-id",
            "source_images": [{"image_id": source_id, "filename": "volume.npy"}],
        },
    )
    events = []

    class Result:
        def scalar_one_or_none(self):
            return current_part

    class Database:
        bind = object()

        async def rollback(self):
            events.append("rollback")

        async def execute(self, statement):
            events.append(("locked_reload", str(statement)))
            return Result()

    class Tasks:
        def __init__(self):
            self.calls = []

        def add_task(self, function, *args, **kwargs):
            self.calls.append((function, kwargs, args))

    async def stale_part_lookup(**_kwargs):
        return initial_part

    async def materialize(**_kwargs):
        events.append("materialize")
        # Simulate another job committing while this request copied its input.
        current_part.metadata_json["pt3_real_splat_asset"] = late_ready_asset
        return str(tmp_path / "volume.npy"), [source_id]

    captured_patch = {}

    async def update_metadata(**kwargs):
        captured_patch.update(kwargs["metadata_patch"])
        current_part.metadata_json = {
            **current_part.metadata_json,
            **kwargs["metadata_patch"],
        }
        return current_part

    monkeypatch.setattr(
        inspection_repository,
        "get_inspection_part",
        stale_part_lookup,
    )
    monkeypatch.setattr(pt3_volume_stack, "materialize_part_volume_stack", materialize)
    monkeypatch.setattr(
        inspection_repository,
        "update_inspection_part_metadata",
        update_metadata,
    )
    monkeypatch.setattr(
        settings,
        "PT3_REAL_3DGS_PROVIDER",
        "tests.fake.provider",
    )
    tasks = Tasks()
    camera_payloads = [
        {
            "image_id": image_id,
            "width": 16,
            "height": 16,
            "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
            "rotation_quaternion": [1, 0, 0, 0],
            "translation": [index, 0, 0],
        }
        for index, image_id in enumerate(("generated-view-a", "generated-view-b"))
    ]

    response = await inspection_workbench.create_pt3_real_gaussian_splat_asset(
        project_id=project_id,
        project=SimpleNamespace(project_type="PT3"),
        part_id=part_id,
        payload=inspection_pt3_schemas.PT3RealSplatOptimizationRequest(
            fit_mode="synthetic_views",
            cameras=camera_payloads,
        ),
        background_tasks=tasks,
        db=Database(),
        current_user=SimpleNamespace(email="concurrency@example.com"),
    )

    pending = captured_patch["pt3_real_splat_asset"]
    assert response.status == "pending"
    assert pending["volume_stack_id"] == "fresh-stack-id"
    assert pending["previous_ready_asset"] == {
        **late_ready_asset,
        "asset_url": (
            f"/api/projects/{project_id}/parts/{part_id}/"
            "real-gaussian-splat-assets/late-ready-cache"
        ),
    }
    assert pending["source_image_ids"] == [source_id]
    assert pending["camera_view_binding"] == "generated_from_voxel_volume"
    assert events[0:3] == ["rollback", "materialize", "rollback"]
    assert events[3][0] == "locked_reload"
    assert "FOR UPDATE" in events[3][1]
    assert len(tasks.calls) == 1
    assert tasks.calls[0][0] is pt3_jobs.run_pt3_job_in_session
    assert tasks.calls[0][2] == (pt3_splat_jobs.REAL_SPLAT_JOB,)
    assert tasks.calls[0][1]["session_bind"] is Database.bind
    assert "job_db" not in tasks.calls[0][1]
    assert tasks.calls[0][1]["payload_data"]["source_image_ids"] == [source_id]
    assert tasks.calls[0][1]["payload_data"]["camera_view_binding"] == (
        "generated_from_voxel_volume"
    )


@pytest.mark.asyncio
async def test_pending_recompute_keeps_previous_asset_downloadable(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    cache_key = "published-cache-key"
    asset_path = (
        tmp_path
        / "cache"
        / "pt3_real_splat_assets"
        / str(project_id)
        / str(part_id)
        / "published-job"
        / "published.json"
    )
    asset_path.parent.mkdir(parents=True)
    asset_path.write_text("{}", encoding="utf-8")
    previous = {
        "job_id": "published-job",
        "status": "ready",
        "cache_key": cache_key,
        "asset_path": str(asset_path),
        "asset_url": f"/api/{cache_key}",
    }
    part = SimpleNamespace(
        metadata_json={
            "pt3_real_splat_asset": {
                "job_id": "recompute-job",
                "status": "pending",
                "previous_ready_asset": previous,
            }
        }
    )

    async def get_part(**_kwargs):
        return part

    monkeypatch.setattr(inspection_repository, "get_inspection_part", get_part)

    response = await inspection_workbench.get_pt3_real_gaussian_splat_asset(
        project_id=project_id,
        project=object(),
        part_id=part_id,
        cache_key=cache_key,
        db=object(),
        current_user=SimpleNamespace(email="reader@example.com"),
    )

    assert Path(response.path) == asset_path


@pytest.mark.parametrize("project_type", ["PT1", "PT2"])
def test_pt3_reconstruction_routes_reject_non_pt3_projects(client, project_type):
    group = f"{project_type.lower()}-pt3-reconstruction-boundary"
    headers = {
        "X-User-Id": f"{project_type.lower()}-pt3-reconstruction-boundary@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    project_response = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": f"{project_type} reconstruction boundary",
            "description": "non-volume project",
            "meta_group_id": group,
            "project_type": project_type,
        },
    )
    assert project_response.status_code == 201, project_response.text
    project = project_response.json()
    part_response = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={"serial_number": f"{project_type}-NON-VOLUME-001"},
    )
    assert part_response.status_code == 201, part_response.text
    part = part_response.json()

    route_contracts = [
        (
            "volume-splat-assets",
            "Volume splat assets are only supported for PT3 projects",
        ),
        (
            "real-gaussian-splat-assets",
            "Real Gaussian splat assets are only supported for PT3 projects",
        ),
    ]
    for route, expected_detail in route_contracts:
        response = client.post(
            f"/api/projects/{project['id']}/parts/{part['id']}/{route}",
            headers=headers,
            json={},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == expected_detail


def test_pt3_part_volume_splat_asset_route_rejects_readable_client_source_path(
    client,
    tmp_path,
):
    headers = {
        "X-User-Id": "pt3-splat@example.com",
        "X-User-Groups": '["pt3-splat-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 splat",
            "description": "",
            "meta_group_id": "pt3-splat-group",
            "project_type": "PT3",
        },
    ).json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-SPLAT-001",
            "metadata": {"volume_stack_id": "stack-from-part"},
        },
    ).json()
    stack_dir = tmp_path / "stack"
    stack_dir.mkdir()
    image = Image.new("L", (2, 2), color=0)
    image.putpixel((0, 1), 250)
    image.save(stack_dir / "z000.png")

    # The file is valid and readable by the service, but project-part routes
    # must derive their inputs from server-owned image records only.
    response = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
        headers=headers,
        json={
            "source_path": str(stack_dir),
            "source_image_ids": ["slice-image-1"],
            "transfer_function": {"threshold": 200},
            "output_format": "json",
        },
    )

    assert response.status_code == 422, response.text
    assert "source_path is not accepted" in response.json()["detail"]

    status_response = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    )
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "missing"

    parts = client.get(f"/api/projects/{project['id']}/parts", headers=headers).json()
    assert "pt3_splat_asset" not in parts[0]["metadata"]


def test_pt3_part_volume_splat_status_reports_missing_after_rejected_path(client):
    headers = {
        "X-User-Id": "pt3-splat-status@example.com",
        "X-User-Groups": '["pt3-splat-status-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 splat status",
            "description": "",
            "meta_group_id": "pt3-splat-status-group",
            "project_type": "PT3",
        },
    ).json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-SPLAT-STATUS-001",
            "metadata": {"volume_stack_id": "stack-status"},
        },
    ).json()

    missing = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    )
    assert missing.status_code == 200
    assert missing.json()["status"] == "missing"

    response = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
        headers=headers,
        json={"source_path": "/definitely/not/a/volume", "output_format": "json"},
    )
    assert response.status_code == 422
    still_missing = client.get(
        f"/api/projects/{project['id']}/volume-stacks/stack-status/splat-status",
        headers=headers,
    )
    assert still_missing.status_code == 200
    assert still_missing.json()["status"] == "missing"


def test_pt3_splat_creation_infers_source_path_from_part_image_stack(
    client,
    monkeypatch,
    tmp_path,
):
    import base64
    import io

    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    headers = {
        "X-User-Id": "pt3-splat-stack@example.com",
        "X-User-Groups": '["pt3-splat-stack-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 inferred splat",
            "description": "",
            "meta_group_id": "pt3-splat-stack-group",
            "project_type": "PT3",
        },
    ).json()

    buffer = io.BytesIO()
    image = Image.new("L", (2, 2), color=0)
    image.putpixel((1, 1), 255)
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()
    encoded = base64.b64encode(image_bytes).decode("ascii")
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": ("stack-z000.png", io.BytesIO(image_bytes), "image/png")},
        data={
            "metadata": json.dumps(
                {
                    "volume_stack_id": "stack-inferred",
                    "slice_index": 0,
                    "analysis_inline_image_base64": encoded,
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image_record = upload.json()

    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-SPLAT-INFERRED-001",
            "metadata": {
                "volume_stack_id": "stack-inferred",
                "source_images": [
                    {
                        "filename": "stack-z000.png",
                        "image_id": image_record["id"],
                        "slice_index": 0,
                    }
                ],
            },
        },
    ).json()

    response = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
        headers=headers,
        json={"transfer_function": {"threshold": 200}, "output_format": "json"},
    )

    assert response.status_code == 200, response.text
    queued_payload = response.json()
    assert queued_payload["status"] == "pending"
    assert queued_payload["metadata"]["job_id"]
    assert "asset_path" not in queued_payload["metadata"]
    assert "source_files" not in queued_payload["metadata"]
    assert "source_path" not in queued_payload["metadata"]["conversion_parameters"]
    status_response = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    )
    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["status"] == "ready"
    assert payload["splat_count"] == 1
    assert payload["metadata"]["source_image_ids"] == [image_record["id"]]
    assert "asset_path" not in payload["metadata"]
    assert "source_files" not in payload["metadata"]
    assert "source_path" not in payload["metadata"]["conversion_parameters"]
    downloaded = client.get(payload["asset_url"], headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.json()["metadata"]["source_files"] == ["0000-stack-z000.png"]
    output_root = cache_root / "pt3_splat_assets" / project["id"] / part["id"]
    input_root = cache_root / "pt3_volume_stacks" / project["id"] / part["id"]
    first_asset_path = output_root / f"{payload['cache_key']}.json"
    assert first_asset_path.is_file()
    assert not any(candidate.is_dir() for candidate in input_root.iterdir())

    recompute = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
        headers=headers,
        json={"transfer_function": {"threshold": 210}, "output_format": "json"},
    )
    assert recompute.status_code == 200, recompute.text
    recomputed = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    ).json()
    assert recomputed["status"] == "ready"
    assert recomputed["cache_key"] != payload["cache_key"]
    assert not first_asset_path.exists()
    assert (output_root / f"{recomputed['cache_key']}.json").is_file()
    assert not any(candidate.is_dir() for candidate in input_root.iterdir())


def test_pt3_simplified_asset_api_rejects_forged_metadata_paths(
    client,
    monkeypatch,
    tmp_path,
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    expected_root = cache_root / "pt3_splat_assets" / str(project_id) / str(part_id)
    expected_root.mkdir(parents=True)
    headers = {
        "X-User-Id": "pt3-splat-forged@example.com",
        "X-User-Groups": '["pt3-splat-forged-group"]',
    }
    part = SimpleNamespace(id=part_id, metadata_json={})

    async def access_check(*_args, **_kwargs):
        return SimpleNamespace(project_type="PT3")

    async def get_part(**_kwargs):
        return part

    monkeypatch.setattr("utils.dependencies.get_project_or_403", access_check)
    monkeypatch.setattr(inspection_repository, "get_inspection_part", get_part)

    outside_key = "outside-key"
    outside_file = tmp_path / f"{outside_key}.json"
    outside_file.write_text('{"secret":"do-not-disclose"}', encoding="utf-8")

    traversal_key = "traversal-key"
    traversal_target = expected_root.parent / f"{traversal_key}.json"
    traversal_target.write_text('{"secret":"do-not-disclose"}', encoding="utf-8")
    traversal_path = expected_root / ".." / f"{traversal_key}.json"

    symlink_key = "symlink-key"
    symlink_target = tmp_path / f"{symlink_key}.json"
    symlink_target.write_text('{"secret":"do-not-disclose"}', encoding="utf-8")
    symlink_path = expected_root / f"{symlink_key}.json"
    symlink_path.symlink_to(symlink_target)

    extension_key = "extension-key"
    extension_path = expected_root / f"{extension_key}.txt"
    extension_path.write_text("do-not-disclose", encoding="utf-8")

    mismatched_key = "declared-key"
    mismatched_path = expected_root / "different-key.json"
    mismatched_path.write_text('{"secret":"do-not-disclose"}', encoding="utf-8")

    forged_cases = [
        (outside_key, outside_file),
        (traversal_key, traversal_path),
        (symlink_key, symlink_path),
        (extension_key, extension_path),
        (mismatched_key, mismatched_path),
    ]
    for cache_key, asset_path in forged_cases:
        part.metadata_json = {
            "pt3_splat_asset": {
                "status": "ready",
                "cache_key": cache_key,
                "asset_path": str(asset_path),
                "asset_url": "https://attacker.example/forged",
                "output_format": "json",
                "splat_count": 1,
            }
        }
        status_response = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/volume-splat-assets/status",
            headers=headers,
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "missing"
        assert "asset_path" not in status_response.json()["metadata"]
        assert "attacker.example" not in status_response.text

        download = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/volume-splat-assets/{cache_key}",
            headers=headers,
        )
        assert download.status_code == 404
        assert b"do-not-disclose" not in download.content


def test_pt3_simplified_asset_api_serves_only_ready_or_safe_legacy_cache_file(
    client,
    monkeypatch,
    tmp_path,
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    cache_key = "pt3-splat-safe-cache-key"
    asset_path = (
        cache_root
        / "pt3_splat_assets"
        / str(project_id)
        / str(part_id)
        / f"{cache_key}.json"
    )
    asset_path.parent.mkdir(parents=True)
    asset_path.write_text('{"safe":true}', encoding="utf-8")
    headers = {
        "X-User-Id": "pt3-splat-contained@example.com",
        "X-User-Groups": '["pt3-splat-contained-group"]',
    }
    asset = {
        "status": "ready",
        "cache_key": cache_key,
        "asset_path": str(asset_path),
        "asset_url": "https://attacker.example/forged",
        "output_format": "json",
        "splat_count": 1,
        "conversion_parameters": {"source_path": "/private/source/stack"},
    }
    part = SimpleNamespace(id=part_id, metadata_json={"pt3_splat_asset": asset})

    async def access_check(*_args, **_kwargs):
        return SimpleNamespace(project_type="PT3")

    async def get_part(**_kwargs):
        return part

    monkeypatch.setattr("utils.dependencies.get_project_or_403", access_check)
    monkeypatch.setattr(inspection_repository, "get_inspection_part", get_part)
    status_url = (
        f"/api/projects/{project_id}/parts/{part_id}/volume-splat-assets/status"
    )
    download_url = (
        f"/api/projects/{project_id}/parts/{part_id}/volume-splat-assets/{cache_key}"
    )

    ready = client.get(status_url, headers=headers)
    assert ready.status_code == 200
    ready_payload = ready.json()
    assert ready_payload["status"] == "ready"
    assert ready_payload["asset_url"] == download_url
    assert "asset_path" not in ready_payload["metadata"]
    assert "source_path" not in ready_payload["metadata"]["conversion_parameters"]
    assert "attacker.example" not in ready.text
    download = client.get(download_url, headers=headers)
    assert download.status_code == 200
    assert download.json() == {"safe": True}

    asset["status"] = "pending"
    pending = client.get(status_url, headers=headers)
    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"
    assert pending.json()["asset_url"] is None
    assert client.get(download_url, headers=headers).status_code == 404

    # Status-less metadata predates lifecycle states. It remains readable only
    # when the file satisfies the same strict cache containment contract.
    asset.pop("status")
    legacy = client.get(status_url, headers=headers)
    assert legacy.status_code == 200
    assert legacy.json()["status"] == "ready"
    assert client.get(download_url, headers=headers).status_code == 200


def test_real_3dgs_status_exposes_builtin_voxel_fit_and_view_mode_requires_provider(
    client, monkeypatch
):
    monkeypatch.setattr(settings, "PT3_REAL_3DGS_PROVIDER", None)
    headers = {
        "X-User-Id": "pt3-real@example.com",
        "X-User-Groups": '["pt3-real-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 real splat",
            "description": "",
            "meta_group_id": "pt3-real-group",
            "project_type": "PT3",
        },
    ).json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-REAL-001",
            "metadata": {"volume_stack_id": "real-stack"},
        },
    ).json()

    status_response = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets/status",
        headers=headers,
    )
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "missing"
    assert status_response.json()["metadata"]["provider_configured"] is False
    assert status_response.json()["metadata"]["voxel_direct_available"] is True

    create_response = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets",
        headers=headers,
        json={
            "cameras": [
                {
                    "image_id": "view-a",
                    "width": 16,
                    "height": 16,
                    "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
                    "rotation_quaternion": [1, 0, 0, 0],
                    "translation": [0, 0, 0],
                },
                {
                    "image_id": "view-b",
                    "width": 16,
                    "height": 16,
                    "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
                    "rotation_quaternion": [1, 0, 0, 0],
                    "translation": [1, 0, 0],
                },
            ],
        },
    )
    assert create_response.status_code == 503
    assert (
        create_response.json()["detail"]
        == "synthetic_views requires a configured Real 3DGS provider"
    )


def test_real_3dgs_direct_voxel_fit_runs_without_cameras_or_provider(
    client, monkeypatch
):
    monkeypatch.setattr(settings, "PT3_REAL_3DGS_PROVIDER", None)
    headers = {
        "X-User-Id": "pt3-direct@example.com",
        "X-User-Groups": '["pt3-direct-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 direct voxel fit",
            "description": "",
            "meta_group_id": "pt3-direct-group",
            "project_type": "PT3",
        },
    ).json()

    image = Image.new("L", (2, 2), color=0)
    image.putpixel((0, 0), 160)
    image.putpixel((1, 0), 160)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": ("direct-z000.png", io.BytesIO(image_bytes), "image/png")},
        data={
            "metadata": json.dumps(
                {
                    "volume_stack_id": "direct-stack",
                    "slice_index": 0,
                    "analysis_inline_image_base64": base64.b64encode(
                        image_bytes
                    ).decode("ascii"),
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image_record = upload.json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-DIRECT-001",
            "metadata": {
                "volume_stack_id": "direct-stack",
                "spacing": [2.0, 3.0, 4.0],
                "source_images": [
                    {
                        "filename": "direct-z000.png",
                        "image_id": image_record["id"],
                        "slice_index": 0,
                    }
                ],
                "pt3_segmentation": {
                    "segments": [
                        {"id": 1, "label": "Left", "color": "#ff0000"},
                        {"id": 2, "label": "Right", "color": "#00ff00"},
                    ],
                    "labels": [[[1, 2], [0, 0]]],
                },
            },
        },
    ).json()

    created = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets",
        headers=headers,
        json={"fit_mode": "voxel_direct", "parameters": {"max_splats": 2}},
    )
    assert created.status_code == 202, created.text
    assert created.json()["status"] == "pending"

    status_response = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets/status",
        headers=headers,
    )
    assert status_response.status_code == 200
    fitted = status_response.json()
    assert fitted["status"] == "ready", fitted
    assert fitted["splat_count"] == 2
    assert fitted["progress_percent"] == 100
    assert fitted["metadata"]["fit_mode"] == "voxel_direct"
    assert fitted["metadata"]["optimization_domain"] == "voxel_field"
    assert fitted["metadata"]["camera_model"] == "none"
    assert fitted["metadata"]["physical_space"]["spacing"] == [2.0, 3.0, 4.0]
    assert "asset_path" not in fitted["metadata"]

    asset_response = client.get(fitted["asset_url"], headers=headers)
    assert asset_response.status_code == 200
    asset = asset_response.json()
    assert asset["sh_degree"] == 0
    assert asset["segment_ids"] == [1, 2]
    assert asset["scalar_values"] == [160.0, 160.0]


def test_real_3dgs_route_rejects_rgb_slice_stack_without_grayscale_fallback(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(settings, "PT3_REAL_3DGS_PROVIDER", None)
    headers = {"X-User-Id": "pt3-rgb@example.com", "X-User-Groups": '["pt3-rgb-group"]'}
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 RGB rejection",
            "description": "",
            "meta_group_id": "pt3-rgb-group",
            "project_type": "PT3",
        },
    ).json()

    image = Image.new("RGB", (2, 2), color=(10, 20, 30))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": ("rgb-z000.png", io.BytesIO(image_bytes), "image/png")},
        data={
            "metadata": json.dumps(
                {
                    "volume_stack_id": "rgb-stack",
                    "slice_index": 0,
                    "analysis_inline_image_base64": base64.b64encode(
                        image_bytes
                    ).decode("ascii"),
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image_record = upload.json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-RGB-001",
            "metadata": {
                "volume_stack_id": "rgb-stack",
                "source_images": [
                    {
                        "filename": "rgb-z000.png",
                        "image_id": image_record["id"],
                        "slice_index": 0,
                    }
                ],
            },
        },
    ).json()

    created = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets",
        headers=headers,
        json={"fit_mode": "voxel_direct", "parameters": {"max_splats": 2}},
    )
    assert created.status_code == 202, created.text

    status_response = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets/status",
        headers=headers,
    )
    assert status_response.status_code == 200
    failed = status_response.json()
    assert failed["status"] == "failed"
    assert "supports scalar volumes only" in failed["error"]
    assert "received RGB volume data" in failed["error"]


def test_real_3dgs_preserves_numpy_volume_format_and_prunes_recompute_jobs(
    client, monkeypatch, tmp_path
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    monkeypatch.setattr(settings, "PT3_REAL_3DGS_PROVIDER", None)
    headers = {
        "X-User-Id": "pt3-numpy@example.com",
        "X-User-Groups": '["pt3-numpy-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 numpy",
            "description": "",
            "meta_group_id": "pt3-numpy-group",
            "project_type": "PT3",
        },
    ).json()
    volume = np.full((2, 2, 2), 80, dtype=np.float32)
    buffer = io.BytesIO()
    np.save(buffer, volume)
    volume_bytes = buffer.getvalue()
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={
            "file": ("volume.npy", io.BytesIO(volume_bytes), "application/octet-stream")
        },
        data={
            "metadata": json.dumps(
                {
                    "analysis_inline_image_base64": base64.b64encode(
                        volume_bytes
                    ).decode("ascii")
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image_record = upload.json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-NUMPY-001",
            "metadata": {
                "volume_stack_id": "numpy-stack",
                "source_images": [
                    {
                        "filename": "volume.npy",
                        "image_id": image_record["id"],
                        "slice_index": 0,
                    }
                ],
            },
        },
    ).json()

    endpoint = (
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets"
    )
    first = client.post(
        endpoint,
        headers=headers,
        json={"fit_mode": "voxel_direct", "parameters": {"max_splats": 1}},
    )
    assert first.status_code == 202, first.text
    first_status = client.get(f"{endpoint}/status", headers=headers).json()
    assert first_status["status"] == "ready", first_status
    assert first_status["metadata"]["dimensions"] == [2, 2, 2]
    first_job_id = first_status["job_id"]
    input_root = cache_root / "pt3_volume_stacks" / project["id"] / part["id"]
    output_root = cache_root / "pt3_real_splat_assets" / project["id"] / part["id"]
    assert not (input_root / first_job_id).exists()
    assert (output_root / first_job_id).is_dir()

    second = client.post(
        endpoint,
        headers=headers,
        json={"fit_mode": "voxel_direct", "parameters": {"max_splats": 1}},
    )
    assert second.status_code == 202, second.text
    second_status = client.get(f"{endpoint}/status", headers=headers).json()
    assert second_status["status"] == "ready", second_status
    second_job_id = second_status["job_id"]
    second_asset_url = second_status["asset_url"]
    assert second_job_id != first_job_id
    assert not (input_root / second_job_id).exists()
    assert not (output_root / first_job_id).exists()
    assert (output_root / second_job_id).is_dir()

    rejected = client.post(
        endpoint,
        headers=headers,
        json={"fit_mode": "voxel_direct", "source_image_ids": ["not-the-owned-image"]},
    )
    assert rejected.status_code == 422
    assert not any(candidate.is_dir() for candidate in input_root.iterdir())

    def fail_fit(**_kwargs):
        raise RuntimeError("synthetic fitter failure")

    monkeypatch.setattr(pt3_splat_jobs, "optimize_real_gaussian_splat_asset", fail_fit)
    failed = client.post(
        endpoint,
        headers=headers,
        json={"fit_mode": "voxel_direct", "parameters": {"max_splats": 1}},
    )
    assert failed.status_code == 202
    failed_status = client.get(f"{endpoint}/status", headers=headers).json()
    assert failed_status["status"] == "ready"
    assert failed_status["job_id"] == second_job_id
    assert failed_status["asset_url"] == second_asset_url
    assert failed_status["metadata"]["last_recompute_status"] == "failed"
    assert (
        failed_status["metadata"]["last_recompute_error"] == "synthetic fitter failure"
    )
    assert failed_status["metadata"]["last_recompute_job_id"] != second_job_id
    assert not any(candidate.is_dir() for candidate in input_root.iterdir())
    assert [
        candidate.name for candidate in output_root.iterdir() if candidate.is_dir()
    ] == [second_job_id]
    assert client.get(second_asset_url, headers=headers).status_code == 200


@pytest.mark.asyncio
async def test_materialization_uses_authoritative_image_suffix_for_http_fetch(
    monkeypatch, tmp_path
):
    cache_root = tmp_path / "cache"
    monkeypatch.setattr(settings, "CACHE_DIR", str(cache_root))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    image_id = uuid.uuid4()
    volume = np.arange(8, dtype=np.float32).reshape(2, 2, 2)
    buffer = io.BytesIO()
    np.save(buffer, volume)
    volume_bytes = buffer.getvalue()
    image = SimpleNamespace(
        id=image_id,
        project_id=project_id,
        filename="authoritative-volume.npy",
        object_storage_key=f"{project_id}/authoritative-volume.npy",
        metadata_json={},
    )
    part = SimpleNamespace(
        id=part_id,
        metadata_json={
            "source_images": [
                {
                    "filename": "stale-or-forged.png",
                    "image_id": str(image_id),
                    "slice_index": 0,
                }
            ]
        },
    )

    async def get_image(**_kwargs):
        return image

    class Response:
        headers = {"content-length": str(len(volume_bytes))}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size):
            for offset in range(0, len(volume_bytes), chunk_size):
                yield volume_bytes[offset : offset + chunk_size]

    class Stream:
        async def __aenter__(self):
            return Response()

        async def __aexit__(self, *_args):
            return None

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def stream(self, _method, _url):
            return Stream()

    monkeypatch.setattr(
        pt3_volume_stack.image_repository, "get_active_project_image", get_image
    )
    monkeypatch.setattr(
        pt3_volume_stack,
        "get_presigned_download_url",
        lambda **_kwargs: "https://example.test/volume",
    )
    monkeypatch.setattr(pt3_volume_stack.httpx, "AsyncClient", Client)

    source_path, source_ids = await pt3_volume_stack.materialize_part_volume_stack(
        project_id=project_id,
        part=part,
        db=object(),
        materialization_key="http-job",
    )

    assert Path(source_path).name == "0000-authoritative-volume.npy"
    assert source_ids == [str(image_id)]
    assert np.array_equal(np.load(source_path), volume)


@pytest.mark.asyncio
async def test_worker_cleans_job_cache_when_part_disappears_before_lookup(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    project_id = uuid.uuid4()
    part_id = uuid.uuid4()
    job_id = "part-deleted-job"
    input_path, output_path = pt3_splat_jobs.real_splat_job_cache_paths(
        project_id=project_id,
        part_id=part_id,
        job_id=job_id,
    )
    input_path.mkdir(parents=True)
    output_path.mkdir(parents=True)
    (input_path / "source.npy").write_bytes(b"source")
    (output_path / "partial.json").write_text("{}", encoding="utf-8")

    async def missing_part(**_kwargs):
        return None

    class FakeDB:
        async def rollback(self):
            return None

    monkeypatch.setattr(inspection_repository, "get_inspection_part", missing_part)
    monkeypatch.setattr(
        inspection_repository,
        "get_inspection_part_for_update",
        missing_part,
    )

    await pt3_jobs.run_pt3_job(
        pt3_splat_jobs.REAL_SPLAT_JOB,
        project_id=project_id,
        part_id=part_id,
        source_path_text=str(input_path / "source.npy"),
        payload_data={},
        job_id=job_id,
        requested_by="deleted-part@example.com",
        job_db=FakeDB(),
    )

    assert not input_path.exists()
    assert not output_path.exists()


def test_real_3dgs_preserves_multipage_tiff_frames(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(settings, "PT3_REAL_3DGS_PROVIDER", None)
    headers = {
        "X-User-Id": "pt3-tiff@example.com",
        "X-User-Groups": '["pt3-tiff-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 TIFF",
            "description": "",
            "meta_group_id": "pt3-tiff-group",
            "project_type": "PT3",
        },
    ).json()
    frames = [Image.new("L", (2, 2), color=value) for value in (50, 100, 150)]
    buffer = io.BytesIO()
    frames[0].save(buffer, format="TIFF", save_all=True, append_images=frames[1:])
    tiff_bytes = buffer.getvalue()
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": ("volume.tiff", io.BytesIO(tiff_bytes), "image/tiff")},
        data={
            "metadata": json.dumps(
                {
                    "analysis_inline_image_base64": base64.b64encode(tiff_bytes).decode(
                        "ascii"
                    )
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image_record = upload.json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-TIFF-001",
            "metadata": {
                "source_images": [
                    {
                        "filename": "volume.tiff",
                        "image_id": image_record["id"],
                        "slice_index": 0,
                    }
                ],
            },
        },
    ).json()
    endpoint = (
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets"
    )
    created = client.post(
        endpoint,
        headers=headers,
        json={"fit_mode": "voxel_direct", "parameters": {"max_splats": 3}},
    )
    assert created.status_code == 202, created.text
    fitted = client.get(f"{endpoint}/status", headers=headers).json()
    assert fitted["status"] == "ready", fitted
    assert fitted["volume_stack_id"] == part["id"]
    assert fitted["metadata"]["dimensions"] == [3, 2, 2]


def test_real_3dgs_camera_schema_rejects_invalid_calibration(client, monkeypatch):
    monkeypatch.setattr(settings, "PT3_REAL_3DGS_PROVIDER", "tests.fake.provider")
    headers = {
        "X-User-Id": "pt3-camera@example.com",
        "X-User-Groups": '["pt3-camera-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 camera",
            "description": "",
            "meta_group_id": "pt3-camera-group",
            "project_type": "PT3",
        },
    ).json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "PT3-CAMERA-001",
            "metadata": {"volume_stack_id": "camera-stack"},
        },
    ).json()
    response = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets",
        headers=headers,
        json={
            "cameras": [
                {
                    "image_id": "a",
                    "width": 16,
                    "height": 16,
                    "intrinsics": [0, 0, 8, 0, 1, 8, 0, 0, 1],
                    "rotation_quaternion": [1, 0, 0, 0],
                    "translation": [0, 0, 0],
                },
                {
                    "image_id": "b",
                    "width": 16,
                    "height": 16,
                    "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
                    "rotation_quaternion": [0, 0, 0, 0],
                    "translation": [0, 0, 0],
                },
            ]
        },
    )
    assert response.status_code == 422

    disabled_parameter = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/real-gaussian-splat-assets",
        headers=headers,
        json={
            "cameras": [
                {
                    "image_id": "a",
                    "width": 16,
                    "height": 16,
                    "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
                    "rotation_quaternion": [1, 0, 0, 0],
                    "translation": [0, 0, 0],
                },
                {
                    "image_id": "b",
                    "width": 16,
                    "height": 16,
                    "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
                    "rotation_quaternion": [1, 0, 0, 0],
                    "translation": [1, 0, 0],
                },
            ],
            "parameters": {"optimize_covariance": False},
        },
    )
    assert disabled_parameter.status_code == 422


def _fake_part_lookup(monkeypatch, metadata):
    part = SimpleNamespace(id=uuid.uuid4(), metadata_json=metadata)

    async def get_part(**_kwargs):
        return part

    monkeypatch.setattr(inspection_repository, "get_inspection_part", get_part)
    return part


async def _route_error(call):
    from fastapi import HTTPException

    with pytest.raises((HTTPException, ServiceError)) as exc_info:
        await call
    return exc_info.value.status_code, exc_info.value.detail


@pytest.mark.asyncio
async def test_pt3_splat_asset_routes_report_missing_assets(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    project_id, part_id = uuid.uuid4(), uuid.uuid4()
    common = {
        "project_id": project_id,
        "project": object(),
        "part_id": part_id,
        "cache_key": "missing-key",
        "db": object(),
        "current_user": SimpleNamespace(email="reader@example.com"),
    }
    _fake_part_lookup(monkeypatch, {"pt3_splat_asset": {"status": "pending"}})
    assert await _route_error(
        inspection_workbench.get_pt3_volume_splat_asset(**common)
    ) == (404, "Volume splat asset not found")
    _fake_part_lookup(monkeypatch, {"pt3_splat_asset": {"status": "ready"}})
    assert await _route_error(
        inspection_workbench.get_pt3_volume_splat_asset(**common)
    ) == (404, "Volume splat asset file not found")
    _fake_part_lookup(monkeypatch, {"pt3_real_splat_asset": {"status": "ready"}})
    assert await _route_error(
        inspection_workbench.get_pt3_real_gaussian_splat_asset(**common)
    ) == (404, "Real Gaussian splat asset file not found")


@pytest.mark.asyncio
async def test_pt3_splat_routes_report_missing_part(monkeypatch):
    async def no_part(**_kwargs):
        return None

    monkeypatch.setattr(inspection_repository, "get_inspection_part", no_part)
    common = {
        "project_id": uuid.uuid4(),
        "project": object(),
        "part_id": uuid.uuid4(),
        "db": object(),
        "current_user": SimpleNamespace(email="reader@example.com"),
    }
    calls = [
        inspection_workbench.get_pt3_part_volume_splat_status(**common),
        inspection_workbench.get_pt3_real_gaussian_splat_status(**common),
        inspection_workbench.get_pt3_volume_splat_asset(**common, cache_key="k"),
        inspection_workbench.get_pt3_real_gaussian_splat_asset(**common, cache_key="k"),
    ]
    for call in calls:
        assert await _route_error(call) == (404, "Inspection part not found")
