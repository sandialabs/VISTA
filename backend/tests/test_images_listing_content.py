"""Characterization tests for image listing, S3 listing, and content errors."""

import io
import uuid
from datetime import UTC, datetime

import httpx
import pytest
from PIL import Image

MUTUALLY_EXCLUSIVE = "group_id and ungrouped=true are mutually exclusive"
DELETED_ONLY_COMBINED = (
    "group_id and ungrouped filters cannot be combined with deleted_only"
)


def _create_project(client, name="Listing characterization"):
    response = client.post(
        "/api/projects/", json={"name": name, "description": None, "meta_group_id": "g"}
    )
    assert response.status_code == 201
    return response.json()["id"]


def _image_bytes(fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (0, 0, 255)).save(buffer, format=fmt)
    return buffer.getvalue()


def _upload(client, pid, filename="ok.png", data=None, content_type="image/png"):
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": (filename, io.BytesIO(data or _image_bytes()), content_type)},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _storage_client(monkeypatch, *, data=None, error=None):
    class Resp:
        def raise_for_status(self):
            return None

        async def aread(self):
            return data

        def iter_bytes(self):
            yield data

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url):
            if error is not None:
                raise error
            return Resp()

    monkeypatch.setattr("services.images.thumbnails.httpx.AsyncClient", Client)


@pytest.mark.parametrize("path", ["images", "images/", "images-page"])
@pytest.mark.parametrize(
    "params,detail",
    [
        ({"group_id": str(uuid.uuid4()), "ungrouped": "true"}, MUTUALLY_EXCLUSIVE),
        ({"deleted_only": "true", "ungrouped": "true"}, DELETED_ONLY_COMBINED),
        (
            {"deleted_only": "true", "group_id": str(uuid.uuid4())},
            DELETED_ONLY_COMBINED,
        ),
    ],
)
def test_image_list_filter_conflicts_fail_before_project_lookup(
    client, path, params, detail
):
    missing_project = uuid.uuid4()
    response = client.get(f"/api/projects/{missing_project}/{path}", params=params)
    assert response.status_code == 400
    assert response.json()["detail"] == detail


def test_legacy_image_list_for_missing_project_returns_empty_list(client):
    response = client.get(f"/api/projects/{uuid.uuid4()}/images")
    assert response.status_code == 200
    assert response.json() == []


def test_legacy_image_list_requires_group_membership(client, monkeypatch):
    pid = _create_project(client)
    _upload(client, pid)
    assert len(client.get(f"/api/projects/{pid}/images").json()) == 1

    monkeypatch.setattr("utils.dependencies.is_user_in_group", lambda *_args: False)
    response = client.get(f"/api/projects/{pid}/images")
    assert response.status_code == 403


def test_image_page_invalid_cursor_detail_and_missing_project(client):
    pid = _create_project(client)
    invalid = client.get(f"/api/projects/{pid}/images-page", params={"cursor": "x"})
    assert invalid.status_code == 400
    assert invalid.json()["detail"] == "Invalid image page cursor"

    missing = client.get(f"/api/projects/{uuid.uuid4()}/images-page")
    assert missing.status_code == 404


def test_s3_list_storage_failure_maps_to_bad_gateway(client, monkeypatch):
    pid = _create_project(client)

    async def failing_list(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("services.images.s3_imports.list_s3_objects", failing_list)
    response = client.post(
        f"/api/projects/{pid}/s3/list", json={"s3_url": "s3://bucket/prefix"}
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Unable to list S3 objects: boom"


def test_s3_list_truncates_and_serializes_summaries(client, monkeypatch):
    pid = _create_project(client)
    modified = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    seen = {}

    async def fake_list(bucket, prefix, max_keys=1000, **_kwargs):
        seen["max_keys"] = max_keys
        return [
            {"key": "p/a.png", "size": 3, "last_modified": modified},
            {"key": "p/b.tif", "size": None, "last_modified": "not-a-date"},
            {"key": "p/c.png", "size": 1},
        ]

    monkeypatch.setattr("services.images.s3_imports.list_s3_objects", fake_list)
    response = client.post(
        f"/api/projects/{pid}/s3/list",
        json={"s3_url": "s3://bucket/p", "max_keys": 2},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert seen["max_keys"] == 3
    assert body["truncated"] is True
    assert body["objects"] == [
        {
            "key": "p/a.png",
            "filename": "a.png",
            "size": 3,
            "content_type": "image/png",
            "last_modified": modified.isoformat(),
        },
        {
            "key": "p/b.tif",
            "filename": "b.tif",
            "size": 0,
            "content_type": "image/tiff",
            "last_modified": None,
        },
    ]


def test_s3_list_missing_project_is_not_found(client):
    response = client.post(
        f"/api/projects/{uuid.uuid4()}/s3/list", json={"s3_url": "s3://bucket/p"}
    )
    assert response.status_code == 404


def test_content_without_download_url_is_server_error(client, monkeypatch):
    image_id = _upload(client, _create_project(client))
    monkeypatch.setattr(
        "routers.images.get_presigned_download_url", lambda **_kwargs: None
    )
    response = client.get(f"/api/images/{image_id}/content")
    assert response.status_code == 500
    assert response.json()["detail"] == "Could not generate download URL"


@pytest.mark.parametrize(
    "error,status_code,detail",
    [
        (httpx.ReadTimeout("slow 10.0.0.1"), 504, "Object storage request timed out"),
        (
            httpx.ConnectError("refused 10.0.0.1"),
            502,
            "Unable to retrieve image data from object storage",
        ),
        (RuntimeError("internal"), 500, "Unexpected error while retrieving image data"),
    ],
)
def test_content_storage_failures_keep_status_and_detail(
    client, monkeypatch, error, status_code, detail
):
    image_id = _upload(client, _create_project(client))
    _storage_client(monkeypatch, error=error)
    response = client.get(f"/api/images/{image_id}/content")
    assert response.status_code == status_code
    assert response.json()["detail"] == detail


def test_content_converts_non_web_formats_unless_disabled(client, monkeypatch):
    bmp = _image_bytes("BMP")
    image_id = _upload(
        client, _create_project(client), "scan.bmp", bmp, content_type="image/bmp"
    )
    _storage_client(monkeypatch, data=bmp)

    converted = client.get(f"/api/images/{image_id}/content")
    assert converted.status_code == 200
    assert converted.headers["content-type"] == "image/jpeg"
    assert 'filename="scan.bmp"' in converted.headers["content-disposition"]

    original = client.get(f"/api/images/{image_id}/content", params={"convert": False})
    assert original.status_code == 200
    assert original.headers["content-type"] == "image/bmp"
    assert original.content == bmp


def test_content_serves_inline_analysis_bytes_without_storage(client, monkeypatch):
    image_id = _upload(client, _create_project(client))
    _storage_client(monkeypatch, error=AssertionError("storage must not be read"))
    monkeypatch.setattr(
        "routers.images._inline_image_bytes", lambda _image: b"inline-bytes"
    )
    response = client.get(f"/api/images/{image_id}/content")
    assert response.status_code == 200
    assert response.content == b"inline-bytes"
    assert response.headers["content-type"] == "image/png"
