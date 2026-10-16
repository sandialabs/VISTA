"""Focused coverage for the paired NIST CoCr PT3 fixture."""

from __future__ import annotations

import io
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image

from routers import images as images_router
from services.images import volume_sources as image_volume_source_service
from services.inspection import test_fixture_images, test_fixtures
from utils import pt3_test_fixtures

RAW_FILENAME = "set1sample5raw_center_cylinder_uint16.npy"
SEGMENTED_FILENAME = "set1sample5segmented_center_cylinder_uint8.npy"


def _create_project(client, project_type: str, suffix: str):
    group = f"nist-fixture-{suffix}"
    headers = {
        "X-User-Id": f"nist-{suffix}@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    response = client.post(
        "/api/projects/",
        headers=headers,
        json={
            "name": f"NIST fixture {suffix}",
            "description": "paired volume fixture coverage",
            "meta_group_id": group,
            "project_type": project_type,
        },
    )
    assert response.status_code == 201, response.text
    return headers, response.json()


def test_nist_cocr_load_is_paired_metadata_only_and_idempotent(client):
    headers, project = _create_project(client, "PT3", "load")
    load_url = f"/api/projects/{project['id']}/load-test-data?fixture=nist-cocr"

    with patch(
        "services.inspection.test_fixture_images.upload_file_to_s3", return_value=False
    ):
        first = client.post(load_url, headers=headers)
        second = client.post(load_url, headers=headers)

    assert first.status_code == 200, first.text
    assert first.json()["images_received"] == 2
    assert first.json()["images_created"] == 2
    assert first.json()["ingest"]["counters"]["batches_created"] == 1
    assert first.json()["ingest"]["counters"]["parts_created"] == 1
    assert second.status_code == 200, second.text
    assert second.json()["images_received"] == 2
    assert second.json()["images_created"] == 0
    assert second.json()["ingest"]["counters"]["batches_created"] == 0
    assert second.json()["ingest"]["counters"]["parts_skipped_existing"] == 1

    images_response = client.get(
        f"/api/projects/{project['id']}/images?include_deleted=true&limit=10",
        headers=headers,
    )
    assert images_response.status_code == 200, images_response.text
    images = images_response.json()
    assert len(images) == 2
    by_name = {image["filename"]: image for image in images}
    raw = by_name[RAW_FILENAME]
    segmented = by_name[SEGMENTED_FILENAME]

    for image in images:
        assert image["metadata"]["storage_status"] == "metadata_only"
        assert image["metadata"]["builtin_fixture_id"] == "nist-cocr"
        assert image["metadata"]["fixture_id"] == "nist-cocr"
        assert image["metadata"]["load_mode"] == "volume"
        assert image["metadata"]["frame_count"] == 749
        assert image["metadata"]["volume_shape"] == {
            "axial": 749,
            "coronal": 257,
            "sagittal": 257,
        }
    assert raw["metadata"]["voxel_dtype"] == "uint16"
    assert raw["metadata"]["bit_depth"] == 16
    assert raw["metadata"]["overlay"] is False
    assert segmented["metadata"]["voxel_dtype"] == "uint8"
    assert segmented["metadata"]["bit_depth"] == 8
    assert segmented["metadata"]["overlay"] is True
    assert segmented["metadata"]["overlay_base_filename"] == RAW_FILENAME
    assert segmented["metadata"]["overlay_base_image_id"] == raw["id"]

    batches = client.get(f"/api/projects/{project['id']}/batches", headers=headers)
    parts = client.get(f"/api/projects/{project['id']}/parts", headers=headers)
    assert batches.status_code == 200, batches.text
    assert parts.status_code == 200, parts.text
    assert len(batches.json()) == 1
    assert len(parts.json()) == 1
    part = parts.json()[0]
    assert part["batch_id"] == batches.json()[0]["id"]
    assert part["metadata"]["fixture_id"] == "nist-cocr"
    assert part["metadata"]["load_mode"] == "volume"
    assert len(part["metadata"]["source_images"]) == 2


def test_metadata_only_nist_content_headers_and_slices_use_repository_files(client):
    headers, project = _create_project(client, "PT3", "content")
    with patch(
        "services.inspection.test_fixture_images.upload_file_to_s3", return_value=False
    ):
        loaded = client.post(
            f"/api/projects/{project['id']}/load-test-data?fixture=nist-cocr",
            headers=headers,
        )
    assert loaded.status_code == 200, loaded.text
    images = client.get(
        f"/api/projects/{project['id']}/images?include_deleted=true&limit=10",
        headers=headers,
    ).json()
    by_name = {image["filename"]: image for image in images}
    raw = by_name[RAW_FILENAME]
    segmented = by_name[SEGMENTED_FILENAME]

    with patch(
        "routers.images.get_presigned_download_url",
        side_effect=AssertionError("S3 must not be used"),
    ):
        header = client.get(f"/api/images/{raw['id']}/volume-metadata", headers=headers)
        raw_slice = client.get(
            f"/api/images/{raw['id']}/volume-slice?axis=axial&index=374",
            headers=headers,
        )
        segment_slice = client.get(
            f"/api/images/{segmented['id']}/volume-slice?axis=coronal&index=128",
            headers=headers,
        )
        content = client.get(
            f"/api/images/{segmented['id']}/content?convert=false",
            headers=headers,
        )

    assert header.status_code == 200, header.text
    assert header.json()["dimensions"] == {
        "axial": 749,
        "coronal": 257,
        "sagittal": 257,
    }
    assert header.json()["voxel_dtype"] == "uint16"
    assert raw_slice.status_code == 200, raw_slice.text
    assert segment_slice.status_code == 200, segment_slice.text
    with Image.open(io.BytesIO(raw_slice.content)) as image:
        assert image.size == (257, 257)
    with Image.open(io.BytesIO(segment_slice.content)) as image:
        assert image.size == (257, 749)
    assert content.status_code == 200, content.text
    assert content.content.startswith(b"\x93NUMPY")
    loaded_segment = np.load(io.BytesIO(content.content), allow_pickle=False)
    assert loaded_segment.shape == (749, 257, 257)
    assert loaded_segment.dtype == np.uint8


@pytest.mark.asyncio
async def test_nist_header_fallback_uses_allowlisted_repository_file():
    project_id = uuid.uuid4()
    image = SimpleNamespace(
        id=uuid.uuid4(),
        project_id=project_id,
        filename=RAW_FILENAME,
        object_storage_key=f"{project_id}/test-data/{RAW_FILENAME}",
        metadata_json={
            "source": "vista-test-data",
            "project_type": "PT3",
            "builtin_fixture_id": "nist-cocr",
            "builtin_fixture_filename": RAW_FILENAME,
        },
    )
    with patch(
        "routers.images.get_presigned_download_url",
        side_effect=AssertionError("S3 must not be used"),
    ):
        shape, dtype = await image_volume_source_service.read_authorized_npy_header(
            image, images_router._volume_source_access()
        )
    assert shape == (749, 257, 257)
    assert np.dtype(dtype) == np.dtype("uint16")


@pytest.mark.parametrize(
    ("fixture_id", "fixture_filename", "image_filename", "storage_key"),
    [
        ("unknown", RAW_FILENAME, RAW_FILENAME, "expected"),
        ("default", RAW_FILENAME, RAW_FILENAME, "expected"),
        ("nist-cocr", f"../{RAW_FILENAME}", RAW_FILENAME, "expected"),
        ("nist-cocr", RAW_FILENAME, SEGMENTED_FILENAME, "expected"),
        ("nist-cocr", RAW_FILENAME, RAW_FILENAME, "wrong-key"),
    ],
)
def test_fixture_resolver_rejects_unknown_cross_fixture_traversal_and_mismatches(
    fixture_id,
    fixture_filename,
    image_filename,
    storage_key,
):
    project_id = uuid.uuid4()
    if storage_key == "expected":
        storage_key = f"{project_id}/test-data/{image_filename}"
    assert (
        pt3_test_fixtures.resolve_pt3_test_fixture_file(
            fixture_id=fixture_id,
            fixture_filename=fixture_filename,
            image_filename=image_filename,
            object_storage_key=storage_key,
            project_id=project_id,
        )
        is None
    )


def test_fixture_resolver_rejects_allowlisted_symlink_escape(monkeypatch, tmp_path):
    fixture_root = tmp_path / "fixtures"
    fixture_dir = fixture_root / "nist_cocr"
    fixture_dir.mkdir(parents=True)
    outside = tmp_path / "outside.npy"
    outside.write_bytes(b"not a fixture")
    (fixture_dir / RAW_FILENAME).symlink_to(outside)
    monkeypatch.setattr(pt3_test_fixtures, "PT3_TEST_DATA_ROOT", fixture_root)
    project_id = uuid.uuid4()
    assert (
        pt3_test_fixtures.resolve_pt3_test_fixture_file(
            fixture_id="nist-cocr",
            fixture_filename=RAW_FILENAME,
            image_filename=RAW_FILENAME,
            object_storage_key=f"{project_id}/test-data/{RAW_FILENAME}",
            project_id=project_id,
        )
        is None
    )


def test_nist_fixture_query_rejects_unknown_and_non_pt3_projects(client):
    pt3_headers, pt3_project = _create_project(client, "PT3", "unknown")
    unknown = client.post(
        f"/api/projects/{pt3_project['id']}/load-test-data?fixture=../../nist-cocr",
        headers=pt3_headers,
    )
    assert unknown.status_code == 400, unknown.text

    pt1_headers, pt1_project = _create_project(client, "PT1", "wrong-type")
    wrong_type = client.post(
        f"/api/projects/{pt1_project['id']}/load-test-data?fixture=nist-cocr",
        headers=pt1_headers,
    )
    assert wrong_type.status_code == 400, wrong_type.text


def test_nist_load_rejects_same_filename_non_fixture_image_collision(client):
    headers, project = _create_project(client, "PT3", "filename-collision")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint16))
    payload.seek(0)
    uploaded = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": (RAW_FILENAME, payload, "application/octet-stream")},
    )
    assert uploaded.status_code == 201, uploaded.text

    loaded = client.post(
        f"/api/projects/{project['id']}/load-test-data?fixture=nist-cocr",
        headers=headers,
    )

    assert loaded.status_code == 409, loaded.text
    assert "conflicts with built-in NIST fixture" in loaded.json()["detail"]
    assert "object_storage_key" in loaded.json()["detail"]


def test_nist_reuse_validation_covers_stable_metadata_and_overlay_relationship():
    project_id = uuid.uuid4()
    raw_image_id = uuid.uuid4()
    expected_metadata = {
        "source": "vista-test-data",
        "project_type": "PT3",
        "builtin_fixture_id": "nist-cocr",
        "fixture_id": "nist-cocr",
        "builtin_fixture_filename": SEGMENTED_FILENAME,
        "fixture_role": "overlay",
        "volume_stack_id": "PT3_NIST_COCR_SET1SAMPLE5_001",
        "volume_shape": {"axial": 749, "coronal": 257, "sagittal": 257},
        "axis_labels": ["XY", "XZ", "YZ"],
        "load_mode": "volume",
        "frame_count": 749,
        "voxel_dtype": "uint8",
        "pixel_dtype": "uint8",
        "bit_depth": 8,
        "overlay": True,
        "modality": "segmentation",
        "overlay_base_filename": RAW_FILENAME,
        "overlay_base_image_id": str(raw_image_id),
    }
    image = SimpleNamespace(
        metadata_json=dict(expected_metadata),
        object_storage_key=f"{project_id}/test-data/{SEGMENTED_FILENAME}",
    )
    assert (
        test_fixture_images.nist_fixture_reuse_conflicts(
            image=image,
            expected_metadata=expected_metadata,
            project_id=project_id,
            filename=SEGMENTED_FILENAME,
        )
        == []
    )
    assert {
        "load_mode",
        "frame_count",
        "overlay_base_filename",
        "overlay_base_image_id",
    }.issubset(test_fixture_images.NIST_FIXTURE_REUSE_FIELDS)

    for field in test_fixture_images.NIST_FIXTURE_REUSE_FIELDS:
        image.metadata_json = {**expected_metadata, field: "conflicting-value"}
        assert test_fixture_images.nist_fixture_reuse_conflicts(
            image=image,
            expected_metadata=expected_metadata,
            project_id=project_id,
            filename=SEGMENTED_FILENAME,
        ) == [field]

    image.metadata_json = dict(expected_metadata)
    image.object_storage_key = f"{project_id}/unrelated/{SEGMENTED_FILENAME}"
    assert test_fixture_images.nist_fixture_reuse_conflicts(
        image=image,
        expected_metadata=expected_metadata,
        project_id=project_id,
        filename=SEGMENTED_FILENAME,
    ) == ["object_storage_key"]


@pytest.mark.parametrize(
    ("overlay_shape", "overlay_dtype", "expected_detail"),
    [
        ((3, 4, 6), np.uint8, "not aligned"),
        ((3, 4, 5), np.uint16, "expected a 3D uint8 array"),
    ],
)
def test_nist_load_validates_both_headers_before_creating_records(
    client,
    monkeypatch,
    tmp_path,
    overlay_shape,
    overlay_dtype,
    expected_detail,
):
    fixture_dir = tmp_path / "nist_cocr"
    fixture_dir.mkdir()
    np.save(fixture_dir / RAW_FILENAME, np.zeros((3, 4, 5), dtype=np.uint16))
    np.save(
        fixture_dir / SEGMENTED_FILENAME, np.zeros(overlay_shape, dtype=overlay_dtype)
    )
    monkeypatch.setattr(pt3_test_fixtures, "PT3_TEST_DATA_ROOT", tmp_path)
    fixture = pt3_test_fixtures.PT3Fixture(
        "nist-cocr",
        (
            pt3_test_fixtures.PT3FixtureFile(
                RAW_FILENAME,
                f"nist_cocr/{RAW_FILENAME}",
                "base",
                "uint16",
            ),
            pt3_test_fixtures.PT3FixtureFile(
                SEGMENTED_FILENAME,
                f"nist_cocr/{SEGMENTED_FILENAME}",
                "overlay",
                "uint8",
            ),
        ),
    )
    monkeypatch.setattr(
        test_fixtures, "get_pt3_test_fixture", lambda fixture_id: fixture
    )
    headers, project = _create_project(
        client, "PT3", f"bad-header-{overlay_dtype.__name__}"
    )

    loaded = client.post(
        f"/api/projects/{project['id']}/load-test-data?fixture=nist-cocr",
        headers=headers,
    )

    assert loaded.status_code == 500, loaded.text
    assert expected_detail in loaded.json()["detail"]
    images = client.get(
        f"/api/projects/{project['id']}/images?include_deleted=true&limit=10",
        headers=headers,
    )
    assert images.status_code == 200, images.text
    assert images.json() == []
