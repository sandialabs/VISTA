"""Characterization tests for ``POST /api/projects/{project_id}/s3/import``.

These pin the HTTP contract (status codes, detail strings, response shape),
per-object partial failures, and rollback behavior. Storage is replaced at the
boto3 client boundary so the tests do not depend on internal module seams.
"""

import asyncio

import pytest
from botocore.exceptions import ClientError
from sqlalchemy.ext.asyncio import AsyncSession

import utils.boto3_client as boto3_client_module
from utils import cache_manager
from utils.dependencies import ARCHIVED_PROJECT_DETAIL

S3_URL = "s3://source-bucket/incoming"


def _create_project(client, name="S3 Import Characterization"):
    response = client.post(
        "/api/projects/", json={"name": name, "description": None, "meta_group_id": "g"}
    )
    assert response.status_code == 201
    return response.json()["id"]


def _client_error(code="403"):
    return ClientError({"Error": {"Code": code, "Message": "denied"}}, "HeadObject")


class FakeS3Client:
    """Minimal boto3 client double for HEAD, COPY, and DELETE."""

    def __init__(self, heads=None, copy_failures=()):
        self.heads = heads or {}
        self.copy_failures = set(copy_failures)
        self.head_calls = []
        self.copy_calls = []
        self.deleted = []
        self.stored = set()

    def head_object(self, Bucket, Key):
        self.head_calls.append((Bucket, Key))
        head = self.heads.get(
            Key,
            {"ContentLength": 12, "ContentType": "image/png", "ETag": '"etag"'},
        )
        if isinstance(head, Exception):
            raise head
        return head

    def copy_object(self, **kwargs):
        self.copy_calls.append(kwargs)
        source_key = kwargs["CopySource"]["Key"]
        if source_key in self.copy_failures:
            raise _client_error("PreconditionFailed")
        self.stored.add(kwargs["Key"])
        return {}

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)
        self.stored.discard(Key)
        return {}


@pytest.fixture
def fake_s3(monkeypatch):
    fake = FakeS3Client()
    monkeypatch.setattr(boto3_client_module, "boto3_client", fake)
    return fake


@pytest.fixture
def invalidations(monkeypatch):
    calls = []

    class Cache:
        def get(self, _key):
            return None

        def set(self, *_args, **_kwargs):
            return None

        def clear_pattern(self, pattern):
            calls.append(pattern)

    monkeypatch.setattr(cache_manager, "get_cache", lambda: Cache())
    return calls


def _import(client, pid, keys, **extra):
    return client.post(
        f"/api/projects/{pid}/s3/import",
        json={"s3_url": extra.pop("s3_url", S3_URL), "keys": keys, **extra},
    )


def test_success_response_shape_and_record_fields(client, fake_s3, invalidations):
    pid = _create_project(client)

    response = _import(client, pid, ["incoming/a.png"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == {"imported", "failed"}
    assert body["failed"] == []
    [imported] = body["imported"]
    assert imported["project_id"] == pid
    assert imported["group_id"] is None
    assert imported["filename"] == "a.png"
    assert imported["object_storage_key"] == f"{pid}/{imported['id']}/a.png"
    assert imported["content_type"] == "image/png"
    assert imported["size_bytes"] == 12
    assert imported["uploaded_by_user_id"] == "test@example.com"
    assert imported["metadata"] == {
        "source": "s3_import",
        "source_s3_url": S3_URL,
        "source_s3_bucket": "source-bucket",
        "source_s3_key": "incoming/a.png",
    }
    assert fake_s3.copy_calls == [
        {
            "Bucket": boto3_client_module.settings.S3_BUCKET,
            "Key": imported["object_storage_key"],
            "CopySource": {"Bucket": "source-bucket", "Key": "incoming/a.png"},
            "CopySourceIfMatch": '"etag"',
        }
    ]
    assert fake_s3.deleted == []
    assert invalidations == [f"project_images:{pid}:"]


def test_content_type_falls_back_to_filename_guess(client, fake_s3):
    pid = _create_project(client)
    fake_s3.heads["incoming/b.tiff"] = {"ContentLength": 5, "ETag": '"e"'}

    response = _import(client, pid, ["incoming/b.tiff"])

    assert response.status_code == 201, response.text
    assert response.json()["imported"][0]["content_type"] == "image/tiff"


def test_https_path_style_url_is_accepted(client, fake_s3):
    pid = _create_project(client)

    response = _import(
        client,
        pid,
        ["incoming/a.png"],
        s3_url="https://s3.example.com/source-bucket/incoming",
    )

    assert response.status_code == 201, response.text
    assert fake_s3.head_calls == [("source-bucket", "incoming/a.png")]


def test_pt1_import_without_group_identifiers_assigns_no_group_or_part(client, fake_s3):
    pid = _create_project(client)

    response = _import(client, pid, ["incoming/a.png", "incoming/b.npy"])

    assert response.status_code == 201, response.text
    assert [item["group_id"] for item in response.json()["imported"]] == [None, None]
    assert client.get(f"/api/projects/{pid}/groups").json()["groups"] == []
    assert client.get(f"/api/projects/{pid}/parts").json() == []


def test_new_group_identifier_creates_group(client, fake_s3):
    pid = _create_project(client)

    response = _import(
        client,
        pid,
        ["incoming/a.png", "incoming/b.png"],
        group_identifiers={"incoming/a.png": "  new-part  "},
    )

    assert response.status_code == 201, response.text
    imported = response.json()["imported"]
    groups = client.get(f"/api/projects/{pid}/groups").json()["groups"]
    assert [group["identifier"] for group in groups] == ["new-part"]
    assert imported[0]["group_id"] == groups[0]["id"]
    assert imported[1]["group_id"] is None


@pytest.mark.parametrize(
    ("body", "detail"),
    [
        ({"s3_url": S3_URL, "keys": []}, "Select at least one S3 file to import"),
        (
            {"s3_url": "ftp://source-bucket/incoming", "keys": ["incoming/a.png"]},
            "Use an s3://, http://, or https:// S3 URL",
        ),
        ({"s3_url": "   ", "keys": ["incoming/a.png"]}, "S3 URL is required"),
        (
            {"s3_url": "s3:///incoming", "keys": ["incoming/a.png"]},
            "S3 URL must include a bucket",
        ),
        (
            {"s3_url": S3_URL, "keys": ["incoming/a.png", "elsewhere/b.png"]},
            "Selected key is outside the requested S3 URL prefix: elsewhere/b.png",
        ),
    ],
)
def test_request_level_validation_errors(client, fake_s3, body, detail):
    pid = _create_project(client)

    response = client.post(f"/api/projects/{pid}/s3/import", json=body)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == detail
    assert fake_s3.head_calls == []
    assert fake_s3.copy_calls == []


def test_project_access_is_checked_before_key_validation(client, fake_s3):
    missing = "00000000-0000-0000-0000-000000000000"

    empty = _import(client, missing, [])
    duplicate = _import(client, missing, ["incoming/a.png", "incoming/a.png"])
    not_found = _import(client, missing, ["incoming/a.png"])

    for response in (empty, duplicate, not_found):
        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"
    assert fake_s3.head_calls == []


def test_duplicate_key_detail_lists_sorted_unique_duplicates(client, fake_s3):
    pid = _create_project(client)

    response = _import(
        client, pid, ["incoming/b.png", "incoming/a.png", "incoming/b.png"] * 2
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "S3 import keys must be unique; duplicate keys: incoming/a.png, incoming/b.png"
    )
    assert fake_s3.head_calls == []


def test_archived_project_is_rejected_before_storage(client, fake_s3):
    pid = _create_project(client)
    assert client.patch(f"/api/projects/{pid}/archive").status_code == 200

    response = _import(client, pid, ["incoming/a.png"])

    assert response.status_code == 403
    assert response.json()["detail"] == ARCHIVED_PROJECT_DETAIL
    assert fake_s3.head_calls == []


def test_metadata_structure_limit_is_rejected_before_storage(
    client, fake_s3, monkeypatch
):
    pid = _create_project(client)
    monkeypatch.setattr(boto3_client_module.settings, "MAX_BATCH_METADATA_DEPTH", 2)

    response = _import(
        client,
        pid,
        ["incoming/a.png"],
        per_file_metadata={"incoming/a.png": {"a": {"b": {"c": 1}}}},
    )

    assert response.status_code == 413, response.text
    assert response.json()["detail"].startswith(
        "Batch upload manifest entry 1 metadata nesting depth is 3;"
    )
    assert fake_s3.head_calls == []


def test_per_key_validation_failures_are_reported_in_request_order(
    client, fake_s3, invalidations
):
    pid = _create_project(client)
    keys = [
        "incoming/readme.txt",
        "incoming/good.png",
        "incoming/bad\x01name.png",
        "incoming/grouped.png",
    ]

    response = _import(
        client,
        pid,
        keys,
        group_identifiers={"incoming/grouped.png": "g" * 256},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert [item["filename"] for item in body["imported"]] == ["good.png"]
    failed = body["failed"]
    assert [item["key"] for item in failed] == [
        "incoming/readme.txt",
        "incoming/bad\x01name.png",
        "incoming/grouped.png",
    ]
    assert failed[0]["error"] == "Unsupported file type"
    assert "path separators or control characters" in failed[1]["error"]
    assert "at most 255 characters" in failed[2]["error"]
    assert all(set(item) == {"key", "error"} for item in failed)
    assert fake_s3.head_calls == [("source-bucket", "incoming/good.png")]
    assert invalidations == [f"project_images:{pid}:"]


def test_inspection_failures_are_per_object(client, fake_s3, monkeypatch):
    pid = _create_project(client)
    monkeypatch.setattr(boto3_client_module.settings, "MAX_UPLOAD_BYTES", 100)
    fake_s3.heads.update(
        {
            "incoming/denied.png": _client_error(),
            "incoming/no-etag.png": {"ContentLength": 4, "ETag": "  "},
            "incoming/negative.png": {"ContentLength": -1, "ETag": '"e"'},
            "incoming/huge.png": {"ContentLength": 101, "ETag": '"e"'},
        }
    )
    keys = [
        "incoming/denied.png",
        "incoming/no-etag.png",
        "incoming/ok.png",
        "incoming/negative.png",
        "incoming/huge.png",
    ]

    response = _import(client, pid, keys)

    assert response.status_code == 201, response.text
    body = response.json()
    assert [item["filename"] for item in body["imported"]] == ["ok.png"]
    errors = {item["key"]: item["error"] for item in body["failed"]}
    assert list(errors) == [key for key in keys if key != "incoming/ok.png"]
    assert errors["incoming/denied.png"] == "S3 object not found or inaccessible"
    assert errors["incoming/no-etag.png"] == (
        "S3 object did not provide an ETag required for a size-safe conditional copy"
    )
    assert errors["incoming/negative.png"] == (
        "S3 object reported an invalid negative size"
    )
    assert errors["incoming/huge.png"].startswith("huge.png is too large")
    assert [call["CopySource"]["Key"] for call in fake_s3.copy_calls] == [
        "incoming/ok.png"
    ]


def test_missing_s3_client_reports_every_object_as_failed(
    client, monkeypatch, invalidations
):
    pid = _create_project(client)
    monkeypatch.setattr(boto3_client_module, "boto3_client", None)

    response = _import(client, pid, ["incoming/a.png", "incoming/b.png"])

    assert response.status_code == 201, response.text
    assert response.json() == {
        "imported": [],
        "failed": [
            {"key": "incoming/a.png", "error": "S3 object not found or inaccessible"},
            {"key": "incoming/b.png", "error": "S3 object not found or inaccessible"},
        ],
    }
    assert invalidations == []
    assert client.get(f"/api/projects/{pid}/images").json() == []


def test_copy_failure_cleans_target_and_keeps_other_objects(client, fake_s3):
    pid = _create_project(client)
    fake_s3.copy_failures.add("incoming/b.png")

    response = _import(client, pid, ["incoming/a.png", "incoming/b.png"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert [item["filename"] for item in body["imported"]] == ["a.png"]
    assert body["failed"] == [
        {"key": "incoming/b.png", "error": "Failed to copy file to project storage"}
    ]
    assert len(fake_s3.deleted) == 1
    assert fake_s3.deleted[0].endswith("/b.png")
    assert fake_s3.stored == {body["imported"][0]["object_storage_key"]}
    listed = client.get(f"/api/projects/{pid}/images").json()
    assert [item["filename"] for item in listed] == ["a.png"]


def test_commit_failure_rolls_back_and_removes_all_copies(
    client, fake_s3, monkeypatch, invalidations
):
    pid = _create_project(client)
    rollbacks = 0
    original_rollback = AsyncSession.rollback

    async def fail_commit(_session, *_args, **_kwargs):
        raise RuntimeError("commit failed")

    async def tracked_rollback(session, *args, **kwargs):
        nonlocal rollbacks
        rollbacks += 1
        return await original_rollback(session, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    monkeypatch.setattr(AsyncSession, "rollback", tracked_rollback)

    response = _import(client, pid, ["incoming/a.png", "incoming/b.png"])

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to save imported image records"
    assert rollbacks == 1
    assert len(fake_s3.deleted) == 2
    assert fake_s3.stored == set()
    assert invalidations == []


def test_cancellation_before_commit_rolls_back_and_removes_copies(
    client, fake_s3, monkeypatch, invalidations
):
    pid = _create_project(client)
    original_flush = AsyncSession.flush

    async def cancel_flush(_session, *_args, **_kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(AsyncSession, "flush", cancel_flush)

    with pytest.raises(RuntimeError, match="No response returned"):
        _import(client, pid, ["incoming/a.png"])

    assert len(fake_s3.deleted) == 1
    assert fake_s3.stored == set()
    assert invalidations == []
    monkeypatch.setattr(AsyncSession, "flush", original_flush)
    assert client.get(f"/api/projects/{pid}/images").json() == []
