import asyncio
import io
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core import models
from core.database import Base
from routers import images as images_router
from services.images import listing as image_listing_service
from services.images import storage_limits as image_storage_limit_service
from services.images import upload as image_upload_service
from utils import cache_manager
from utils import dependencies as dependencies_module


def _create_project(client, *, name="Batch images", project_type="PT1"):
    response = client.post(
        "/api/projects/",
        json={
            "name": name,
            "description": None,
            "meta_group_id": "g",
            "project_type": project_type,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _batch_request(client, project_id, payloads, manifest):
    files = [
        ("files", (source_name, payload, content_type))
        for source_name, payload, content_type in payloads
    ]
    files.append(
        (
            "manifest",
            (
                "manifest.json",
                json.dumps(manifest).encode("utf-8"),
                "application/json",
            ),
        )
    )
    return client.post(
        f"/api/projects/{project_id}/images/batch",
        files=files,
    )


def _manifest_entry(client_index, filename, *, marker=None, group_identifier=None):
    metadata = {} if marker is None else {"marker": marker}
    entry = {
        "client_index": client_index,
        "filename": filename,
        "metadata": metadata,
    }
    if group_identifier is not None:
        entry["group_identifier"] = group_identifier
    return entry


def _image_bytes(*, image_format="PNG", marker=b""):
    payload = io.BytesIO()
    Image.new("RGB", (2, 2), color=(20, 40, 60)).save(payload, format=image_format)
    return payload.getvalue() + marker


@pytest.mark.smoke
def test_batch_upload_authorizes_and_commits_once_preserving_client_order_and_groups(
    client,
    monkeypatch,
):
    project_id = _create_project(client)
    authorization_calls = 0
    commit_calls = 0
    flush_calls = 0
    invalidations = []
    upload_completion = []

    original_access_check = dependencies_module.get_project_or_403_writable
    original_commit = AsyncSession.commit
    original_flush = AsyncSession.flush

    async def tracked_access_check(*args, **kwargs):
        nonlocal authorization_calls
        authorization_calls += 1
        return await original_access_check(*args, **kwargs)

    async def tracked_commit(session, *args, **kwargs):
        nonlocal commit_calls
        commit_calls += 1
        return await original_commit(session, *args, **kwargs)

    async def tracked_flush(session, *args, **kwargs):
        nonlocal flush_calls
        flush_calls += 1
        return await original_flush(session, *args, **kwargs)

    async def out_of_order_upload(*, object_name, file_data, **_kwargs):
        payload = file_data.read()
        file_data.seek(0)
        marker = next(
            marker
            for marker in (b"slow", b"fast", b"middle")
            if payload.endswith(marker)
        )
        delay = {b"slow": 0.04, b"fast": 0.001, b"middle": 0.02}[marker]
        await asyncio.sleep(delay)
        upload_completion.append(marker.decode())
        assert object_name.endswith("/duplicate.png")
        return True

    class Cache:
        def clear_pattern(self, pattern):
            invalidations.append(pattern)

    monkeypatch.setattr(
        dependencies_module, "get_project_or_403_writable", tracked_access_check
    )
    monkeypatch.setattr(AsyncSession, "commit", tracked_commit)
    monkeypatch.setattr(AsyncSession, "flush", tracked_flush)
    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", out_of_order_upload)
    monkeypatch.setattr(cache_manager, "get_cache", lambda: Cache())

    response = _batch_request(
        client,
        project_id,
        [
            ("source.png", _image_bytes(marker=b"slow"), "image/png"),
            ("source.png", _image_bytes(marker=b"fast"), "image/png"),
            ("source.png", _image_bytes(marker=b"middle"), "image/png"),
        ],
        [
            _manifest_entry(
                9, "duplicate.png", marker="nine", group_identifier="part-a"
            ),
            _manifest_entry(
                2, "duplicate.png", marker="two", group_identifier="part-a"
            ),
            _manifest_entry(5, "duplicate.png", marker="five"),
        ],
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert [item["client_index"] for item in body["uploaded"]] == [2, 5, 9]
    assert [item["image"]["metadata"]["marker"] for item in body["uploaded"]] == [
        "two",
        "five",
        "nine",
    ]
    assert len({item["image"]["object_storage_key"] for item in body["uploaded"]}) == 3
    grouped = [
        item["image"]["group_id"]
        for item in body["uploaded"]
        if item["client_index"] in {2, 9}
    ]
    assert grouped[0] and grouped[0] == grouped[1]
    assert upload_completion == ["fast", "middle", "slow"]
    assert authorization_calls == 1
    assert flush_calls == 1
    assert commit_calls == 1
    assert invalidations == [f"project_images:{project_id}:"]


def test_batch_upload_materializes_response_before_commit_without_cleanup(
    client,
    monkeypatch,
):
    project_id = _create_project(client, name="Batch immutable response")
    original_commit = image_upload_service.commit_database_transaction
    original_refresh = AsyncSession.refresh
    commit_finished = False
    uploaded_objects = []
    deleted_objects = []

    async def track_upload(*, object_name, **_kwargs):
        uploaded_objects.append(object_name)
        return True

    def track_delete(_bucket, object_storage_key):
        deleted_objects.append(object_storage_key)
        return True

    async def commit_and_expire(session):
        nonlocal commit_finished
        await original_commit(session)
        session.expire_all()
        commit_finished = True

    async def reject_post_commit_refresh(session, *args, **kwargs):
        if commit_finished:
            raise AssertionError("batch response must not refresh after commit")
        return await original_refresh(session, *args, **kwargs)

    def reject_orm_serialization(_db_image):
        raise AssertionError("batch response must use pre-commit scalar values")

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", track_delete)
    monkeypatch.setattr(
        image_upload_service, "commit_database_transaction", commit_and_expire
    )
    monkeypatch.setattr(AsyncSession, "refresh", reject_post_commit_refresh)
    monkeypatch.setattr(
        image_listing_service, "to_data_instance_schema", reject_orm_serialization
    )

    response = _batch_request(
        client,
        project_id,
        [("source.png", _image_bytes(marker=b"known"), "image/png")],
        [_manifest_entry(7, "materialized.png", marker="known-values")],
    )

    assert response.status_code == 201, response.text
    uploaded = response.json()["uploaded"]
    assert [item["client_index"] for item in uploaded] == [7]
    assert uploaded[0]["image"]["filename"] == "materialized.png"
    assert uploaded[0]["image"]["metadata"]["marker"] == "known-values"
    assert uploaded[0]["image"]["created_at"]
    assert len(uploaded_objects) == 1
    assert deleted_objects == []


def test_batch_upload_s3_concurrency_is_capped_at_six(client, monkeypatch):
    project_id = _create_project(client, name="Concurrency")
    active = 0
    maximum_active = 0

    async def concurrent_upload(**_kwargs):
        nonlocal active, maximum_active
        active += 1
        maximum_active = max(maximum_active, active)
        await asyncio.sleep(0.02)
        active -= 1
        return True

    monkeypatch.setattr(
        image_upload_service.settings, "MAX_BATCH_UPLOAD_CONCURRENCY", 99
    )
    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", concurrent_upload)
    payloads = [
        (
            f"source-{index}.jpg",
            _image_bytes(image_format="JPEG", marker=bytes([index])),
            "image/jpeg",
        )
        for index in range(12)
    ]
    manifest = [_manifest_entry(index, f"final-{index}.jpg") for index in range(12)]

    response = _batch_request(client, project_id, payloads, manifest)

    assert response.status_code == 201, response.text
    assert len(response.json()["uploaded"]) == 12
    assert maximum_active == 6


def test_batch_upload_reports_inspection_and_storage_failures_without_losing_successes(
    client,
    monkeypatch,
):
    project_id = _create_project(client, name="Partial failures")

    async def selectively_fail_upload(*, file_data, **_kwargs):
        payload = file_data.read()
        file_data.seek(0)
        return not payload.endswith(b"storage-failure")

    monkeypatch.setattr(
        image_upload_service, "upload_file_to_s3", selectively_fail_upload
    )
    response = _batch_request(
        client,
        project_id,
        [
            ("ok.jpg", _image_bytes(image_format="JPEG", marker=b"ok"), "image/jpeg"),
            (
                "bad.jpg",
                _image_bytes(image_format="JPEG", marker=b"storage-failure"),
                "image/jpeg",
            ),
            ("bad.npy", b"not-a-numpy-file", "application/octet-stream"),
        ],
        [
            _manifest_entry(8, "ok.jpg"),
            _manifest_entry(3, "storage.jpg"),
            _manifest_entry(6, "invalid.npy"),
        ],
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert [item["client_index"] for item in body["uploaded"]] == [8]
    assert [(item["client_index"], item["code"]) for item in body["failed"]] == [
        (3, "storage_upload_failed"),
        (6, "validation_failed"),
    ]
    assert "not-a-numpy-file" not in response.text

    listed = client.get(f"/api/projects/{project_id}/images?limit=20")
    assert listed.status_code == 200
    assert [item["filename"] for item in listed.json()] == ["ok.jpg"]


def test_batch_upload_rejects_malformed_manifest_before_storage_writes(
    client, monkeypatch
):
    project_id = _create_project(client, name="Malformed manifest")
    upload_calls = 0

    async def track_upload(**_kwargs):
        nonlocal upload_calls
        upload_calls += 1
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    response = client.post(
        f"/api/projects/{project_id}/images/batch",
        files=[
            ("files", ("one.png", b"one", "image/png")),
            (
                "manifest",
                (
                    "manifest.json",
                    json.dumps([{"client_index": 0, "filename": "../one.png"}]).encode(
                        "utf-8"
                    ),
                    "application/json",
                ),
            ),
        ],
    )

    assert response.status_code == 400
    assert upload_calls == 0
    assert client.get(f"/api/projects/{project_id}/images").json() == []


def test_batch_upload_rejects_count_and_size_limits_before_storage_writes(
    client, monkeypatch
):
    project_id = _create_project(client, name="Limits")
    upload_calls = 0

    async def track_upload(**_kwargs):
        nonlocal upload_calls
        upload_calls += 1
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    monkeypatch.setattr(image_upload_service.settings, "MAX_BATCH_UPLOAD_FILES", 1)
    too_many = _batch_request(
        client,
        project_id,
        [("a.jpg", b"a", "image/jpeg"), ("b.jpg", b"b", "image/jpeg")],
        [_manifest_entry(0, "a.jpg"), _manifest_entry(1, "b.jpg")],
    )
    assert too_many.status_code == 413

    monkeypatch.setattr(image_upload_service.settings, "MAX_BATCH_UPLOAD_FILES", 10)
    monkeypatch.setattr(image_upload_service.settings, "MAX_BATCH_UPLOAD_BYTES", 3)
    aggregate_too_large = _batch_request(
        client,
        project_id,
        [("a.jpg", b"aa", "image/jpeg"), ("b.jpg", b"bb", "image/jpeg")],
        [_manifest_entry(0, "a.jpg"), _manifest_entry(1, "b.jpg")],
    )
    assert aggregate_too_large.status_code == 413

    monkeypatch.setattr(image_upload_service.settings, "MAX_BATCH_UPLOAD_BYTES", 100)
    monkeypatch.setattr(image_upload_service.settings, "MAX_UPLOAD_BYTES", 3)
    per_file_too_large = _batch_request(
        client,
        project_id,
        [("large.jpg", b"four", "image/jpeg")],
        [_manifest_entry(0, "large.jpg")],
    )
    assert per_file_too_large.status_code == 413
    assert "MAX_UPLOAD_BYTES" in per_file_too_large.text

    assert upload_calls == 0
    assert client.get(f"/api/projects/{project_id}/images").json() == []


def test_batch_upload_cleans_uploaded_objects_when_database_commit_fails(
    client, monkeypatch
):
    project_id = _create_project(client, name="Database failure")
    uploaded_keys = []
    deleted_keys = []
    original_commit = AsyncSession.commit

    async def successful_upload(*, object_name, **_kwargs):
        uploaded_keys.append(object_name)
        return True

    def tracked_delete(bucket_name, object_name):
        assert bucket_name == image_upload_service.settings.S3_BUCKET
        deleted_keys.append(object_name)
        return True

    async def fail_commit(_session, *_args, **_kwargs):
        raise RuntimeError("database password should not be exposed")

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", successful_upload)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", tracked_delete)
    monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    try:
        response = _batch_request(
            client,
            project_id,
            [
                ("a.jpg", _image_bytes(image_format="JPEG"), "image/jpeg"),
                ("b.jpg", _image_bytes(image_format="JPEG"), "image/jpeg"),
            ],
            [_manifest_entry(0, "a.jpg"), _manifest_entry(1, "b.jpg")],
        )
    finally:
        monkeypatch.setattr(AsyncSession, "commit", original_commit)

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to save uploaded image records"
    assert "password" not in response.text
    assert sorted(deleted_keys) == sorted(uploaded_keys)


def test_pt3_volume_batch_defers_to_legacy_route_and_legacy_upload_still_works(client):
    project_id = _create_project(client, name="PT3 compatibility", project_type="PT3")
    volume = io.BytesIO()
    np.save(volume, np.zeros((2, 3, 4), dtype=np.uint8))
    payload = volume.getvalue()

    batch = _batch_request(
        client,
        project_id,
        [("volume.npy", payload, "application/octet-stream")],
        [_manifest_entry(4, "volume.npy")],
    )
    assert batch.status_code == 201, batch.text
    assert batch.json()["uploaded"] == []
    assert batch.json()["failed"][0]["code"] == "legacy_route_required"

    legacy = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("volume.npy", payload, "application/octet-stream")},
    )
    assert legacy.status_code == 201, legacy.text
    assert legacy.json()["filename"] == "volume.npy"


def test_batch_upload_cache_failure_does_not_turn_committed_upload_into_500(
    client, monkeypatch
):
    project_id = _create_project(client, name="Cache failure")

    class FailingCache:
        def clear_pattern(self, _pattern):
            raise RuntimeError("cache unavailable")

    monkeypatch.setattr(cache_manager, "get_cache", lambda: FailingCache())
    response = _batch_request(
        client,
        project_id,
        [("source.jpg", _image_bytes(image_format="JPEG"), "image/jpeg")],
        [_manifest_entry(0, "source.jpg")],
    )

    assert response.status_code == 201, response.text
    assert response.json()["uploaded"][0]["image"]["filename"] == "source.jpg"


def test_batch_upload_manifest_and_total_request_bytes_are_bounded_before_storage(
    client, monkeypatch
):
    project_id = _create_project(client, name="Manifest limits")
    upload_calls = 0

    async def track_upload(**_kwargs):
        nonlocal upload_calls
        upload_calls += 1
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    payload = _image_bytes(image_format="JPEG")
    manifest = [_manifest_entry(0, "source.jpg", marker="manifest-padding")]
    manifest_json = json.dumps(manifest)

    monkeypatch.setattr(
        image_upload_service.settings,
        "MAX_BATCH_UPLOAD_MANIFEST_BYTES",
        len(manifest_json.encode("utf-8")) - 1,
    )
    manifest_too_large = _batch_request(
        client,
        project_id,
        [("source.jpg", payload, "image/jpeg")],
        manifest,
    )
    assert manifest_too_large.status_code == 413
    assert "MAX_BATCH_UPLOAD_MANIFEST_BYTES" in manifest_too_large.text

    monkeypatch.setattr(
        image_upload_service.settings, "MAX_BATCH_UPLOAD_MANIFEST_BYTES", 100000
    )
    monkeypatch.setattr(
        image_upload_service.settings,
        "MAX_BATCH_UPLOAD_BYTES",
        len(payload) + len(manifest_json.encode("utf-8")) - 1,
    )
    total_too_large = _batch_request(
        client,
        project_id,
        [("source.jpg", payload, "image/jpeg")],
        manifest,
    )
    assert total_too_large.status_code == 413
    assert "file-and-manifest" in total_too_large.text
    assert "MAX_BATCH_UPLOAD_BYTES" in total_too_large.text
    assert upload_calls == 0


def test_batch_upload_accepts_json_file_manifest_larger_than_one_mib(
    client, monkeypatch
):
    project_id = _create_project(client, name="Large file manifest")

    async def successful_upload(**_kwargs):
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", successful_upload)
    padding = "x" * 600_000
    response = _batch_request(
        client,
        project_id,
        [
            ("one.jpg", _image_bytes(image_format="JPEG"), "image/jpeg"),
            ("two.jpg", _image_bytes(image_format="JPEG"), "image/jpeg"),
        ],
        [
            {
                "client_index": 0,
                "filename": "one.jpg",
                "metadata": {"padding": padding},
            },
            {
                "client_index": 1,
                "filename": "two.jpg",
                "metadata": {"padding": padding},
            },
        ],
    )

    assert response.status_code == 201, response.text
    assert len(response.json()["uploaded"]) == 2


def test_batch_upload_rejects_manifest_file_over_eight_mib_before_json_parse_or_storage(
    client,
    monkeypatch,
):
    project_id = _create_project(client, name="Eight MiB manifest ceiling")
    upload_calls = 0
    parse_calls = 0

    async def track_upload(**_kwargs):
        nonlocal upload_calls
        upload_calls += 1
        return True

    def unexpected_parse(_payload):
        nonlocal parse_calls
        parse_calls += 1
        raise AssertionError("oversized manifests must not be parsed")

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    monkeypatch.setattr(image_upload_service._json, "loads", unexpected_parse)
    response = client.post(
        f"/api/projects/{project_id}/images/batch",
        files=[
            ("files", ("one.jpg", _image_bytes(image_format="JPEG"), "image/jpeg")),
            (
                "manifest",
                (
                    "manifest.json",
                    b"[" + (b" " * (8 * 1024 * 1024)) + b"]",
                    "application/json",
                ),
            ),
        ],
    )

    assert response.status_code == 413
    assert "MAX_BATCH_UPLOAD_MANIFEST_BYTES" in response.text
    assert parse_calls == 0
    assert upload_calls == 0


def test_batch_upload_rejects_non_utf8_manifest_file_before_json_parse(
    client, monkeypatch
):
    project_id = _create_project(client, name="Invalid UTF-8 manifest")
    parse_calls = 0

    def unexpected_parse(_payload):
        nonlocal parse_calls
        parse_calls += 1
        raise AssertionError("invalid UTF-8 must not be parsed")

    monkeypatch.setattr(image_upload_service._json, "loads", unexpected_parse)
    response = client.post(
        f"/api/projects/{project_id}/images/batch",
        files=[
            ("files", ("one.jpg", _image_bytes(image_format="JPEG"), "image/jpeg")),
            ("manifest", ("manifest.json", b"\xff\xfe", "application/json")),
        ],
    )

    assert response.status_code == 400
    assert "UTF-8" in response.text
    assert parse_calls == 0


def test_batch_upload_false_storage_result_removes_ambiguous_target(
    client, monkeypatch
):
    project_id = _create_project(client, name="False storage cleanup")
    uploaded_keys = []
    deleted_keys = []

    async def false_upload(*, object_name, **_kwargs):
        uploaded_keys.append(object_name)
        return False

    def tracked_delete(_bucket, object_name):
        deleted_keys.append(object_name)
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", false_upload)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", tracked_delete)
    response = _batch_request(
        client,
        project_id,
        [("one.jpg", _image_bytes(image_format="JPEG"), "image/jpeg")],
        [_manifest_entry(0, "one.jpg")],
    )

    assert response.status_code == 201
    assert response.json()["uploaded"] == []
    assert response.json()["failed"][0]["code"] == "storage_upload_failed"
    assert deleted_keys == uploaded_keys


def test_upload_and_copy_helpers_delete_targets_only_after_cancelled_operation_settles(
    monkeypatch,
):
    async def exercise(kind):
        started = asyncio.Event()
        release = asyncio.Event()
        operation_settled = asyncio.Event()
        deleted = []

        async def cancelled_operation(*_args, **_kwargs):
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                await release.wait()
                operation_settled.set()
                raise

        def tracked_delete(_bucket, object_name):
            assert operation_settled.is_set()
            deleted.append(object_name)
            return True

        monkeypatch.setattr(image_upload_service, "delete_file_from_s3", tracked_delete)
        target = f"project/image/{kind}.png"
        if kind == "upload":
            monkeypatch.setattr(
                image_upload_service, "upload_file_to_s3", cancelled_operation
            )
            coroutine = image_upload_service.upload_target_with_cleanup(
                object_storage_key=target,
                file_data=io.BytesIO(b"data"),
                length=4,
                content_type="image/png",
            )
        else:
            monkeypatch.setattr(
                image_upload_service, "copy_s3_object_to_s3", cancelled_operation
            )
            coroutine = image_upload_service.copy_target_with_cleanup(
                source_bucket="source",
                source_key="incoming/a.png",
                source_etag='"source-version"',
                object_storage_key=target,
            )

        task = asyncio.create_task(coroutine)
        await started.wait()
        task.cancel()
        await asyncio.sleep(0)
        assert deleted == []
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert deleted == [target]

    asyncio.run(exercise("upload"))
    asyncio.run(exercise("copy"))


def test_batch_upload_metadata_structure_limits_name_the_override(client, monkeypatch):
    project_id = _create_project(client, name="Metadata limits")
    payloads = [("source.jpg", _image_bytes(image_format="JPEG"), "image/jpeg")]
    cases = [
        (
            "MAX_BATCH_METADATA_DEPTH",
            "2",
            {"outer": {"middle": {"inner": True}}},
        ),
        ("MAX_BATCH_METADATA_ITEMS", "1", {"one": 1, "two": 2}),
        ("MAX_BATCH_METADATA_STRING_BYTES", "3", {"value": "four"}),
        ("MAX_BATCH_METADATA_KEY_BYTES", "3", {"four": 1}),
        ("MAX_BATCH_METADATA_BYTES", "5", {"value": "six"}),
    ]

    for environment_name, configured_limit, metadata in cases:
        original_limit = getattr(image_upload_service.settings, environment_name)
        monkeypatch.setattr(
            image_upload_service.settings, environment_name, int(configured_limit)
        )
        response = _batch_request(
            client,
            project_id,
            payloads,
            [{"client_index": 0, "filename": "source.jpg", "metadata": metadata}],
        )
        assert response.status_code == 413, (environment_name, response.text)
        assert environment_name in response.text
        monkeypatch.setattr(
            image_upload_service.settings, environment_name, original_limit
        )


def test_batch_upload_reports_json_parser_recursion_limit_before_storage(
    client, monkeypatch
):
    project_id = _create_project(client, name="Parser recursion")
    upload_calls = 0

    async def track_upload(**_kwargs):
        nonlocal upload_calls
        upload_calls += 1
        return True

    def recurse(_payload):
        raise RecursionError("maximum recursion depth exceeded")

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    monkeypatch.setattr(image_upload_service._json, "loads", recurse)
    response = _batch_request(
        client,
        project_id,
        [("source.jpg", _image_bytes(image_format="JPEG"), "image/jpeg")],
        [_manifest_entry(0, "source.jpg")],
    )

    assert response.status_code == 413
    assert "built-in limit" in response.text
    assert "MAX_BATCH_METADATA_DEPTH" in response.text
    assert upload_calls == 0


def test_batch_rejects_empty_and_invalid_ordinary_image_headers_but_legacy_is_compatible(
    client,
    monkeypatch,
):
    project_id = _create_project(client, name="Header validation")
    upload_calls = 0

    async def track_upload(**_kwargs):
        nonlocal upload_calls
        upload_calls += 1
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    batch = _batch_request(
        client,
        project_id,
        [
            ("empty.png", b"", "image/png"),
            ("broken.jpg", b"not-a-jpeg", "image/jpeg"),
        ],
        [
            _manifest_entry(0, "empty.png"),
            _manifest_entry(1, "broken.jpg"),
        ],
    )

    assert batch.status_code == 201, batch.text
    assert batch.json()["uploaded"] == []
    assert [
        (item["client_index"], item["code"]) for item in batch.json()["failed"]
    ] == [
        (0, "validation_failed"),
        (1, "validation_failed"),
    ]
    assert "Empty image file" in batch.json()["failed"][0]["detail"]
    assert "header" in batch.json()["failed"][1]["detail"]
    assert upload_calls == 0

    legacy = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("broken.jpg", b"not-a-jpeg", "image/jpeg")},
    )
    assert legacy.status_code == 201, legacy.text
    assert upload_calls == 1


def test_process_wide_storage_limiter_caps_operations_across_event_loops():
    limiter = image_storage_limit_service.ProcessWideStorageLimiter(3)
    state_lock = threading.Lock()
    active = 0
    maximum_active = 0

    async def operation():
        nonlocal active, maximum_active
        async with limiter.slot():
            with state_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            await asyncio.sleep(0.015)
            with state_lock:
                active -= 1

    # asyncio.gather must be constructed inside the target loop.
    def run_worker_loop():
        async def run_all():
            await asyncio.gather(*(operation() for _ in range(8)))

        asyncio.run(run_all())

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run_worker_loop) for _ in range(2)]
            for future in futures:
                future.result(timeout=10)
    finally:
        limiter.shutdown()

    assert maximum_active == 3


def test_concurrent_group_resolution_uses_one_unique_group(tmp_path):
    async def exercise():
        database_path = tmp_path / "group-race.db"
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{database_path}",
            connect_args={"timeout": 10},
        )
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        project_id = uuid.uuid4()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            session.add(
                models.Project(
                    id=project_id,
                    name="Concurrent group project",
                    meta_group_id="g",
                    project_type="PT1",
                )
            )
            await session.commit()

        async def resolve_once():
            async with session_factory() as session:
                groups = await image_upload_service.resolve_batch_image_groups(
                    session,
                    project_id=project_id,
                    identifiers=["shared-part"],
                )
                # Keep the winning write open briefly so the second session
                # exercises ON CONFLICT's wait-and-requery behavior.
                await asyncio.sleep(0.02)
                await session.commit()
                return groups["shared-part"].id

        try:
            group_ids = await asyncio.gather(resolve_once(), resolve_once())
            async with session_factory() as session:
                count = await session.scalar(
                    select(func.count(models.ImageGroup.id)).where(
                        models.ImageGroup.project_id == project_id,
                        models.ImageGroup.identifier == "shared-part",
                    )
                )
        finally:
            await engine.dispose()

        assert group_ids[0] == group_ids[1]
        assert count == 1

    asyncio.run(exercise())
