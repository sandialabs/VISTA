"""Characterization tests for the project load-test-data workflow."""

import io
from unittest.mock import patch

import numpy as np

from utils import pt3_test_fixtures

UPLOAD_TARGET = "services.inspection.test_fixture_images.upload_file_to_s3"
RAW_FILENAME = "set1sample5raw_center_cylinder_uint16.npy"


def _create_project(client, project_type, suffix, group="fixture-loader"):
    headers = {
        "X-User-Id": f"fixture-{suffix}@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    response = client.post(
        "/api/projects/",
        json={
            "name": f"Fixture {suffix}",
            "description": None,
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], headers


def _load(client, project_id, headers, fixture=None):
    query = f"?fixture={fixture}" if fixture else ""
    return client.post(
        f"/api/projects/{project_id}/load-test-data{query}", headers=headers
    )


def _images(client, project_id, headers):
    response = client.get(
        f"/api/projects/{project_id}/images?include_deleted=true&limit=2000",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_load_test_data_rejects_unknown_fixture(client):
    project_id, headers = _create_project(client, "PT3", "unknown")
    response = _load(client, project_id, headers, fixture="no-such-fixture")
    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown test-data fixture"


def test_load_test_data_rejects_nist_fixture_outside_pt3(client):
    project_id, headers = _create_project(client, "PT1", "nist-pt1")
    response = _load(client, project_id, headers, fixture="nist-cocr")
    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "The nist-cocr fixture is only available for PT3 projects"
    )


def test_pt1_load_leaves_images_ungrouped_and_unassigned(client):
    project_id, headers = _create_project(client, "PT1", "pt1-invariant")
    with patch(UPLOAD_TARGET, return_value=True):
        response = _load(client, project_id, headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_type"] == "PT1"
    assert body["images_created"] == body["images_received"] == 20
    assert body["ingest"]["counters"] == {
        "batches_received": 0,
        "parts_received": 0,
        "batches_created": 0,
        "parts_created": 0,
        "parts_skipped_existing": 0,
        "parts_skipped_discrepancy": 0,
    }
    images = _images(client, project_id, headers)
    assert len(images) == 20
    assert all(image.get("group_id") is None for image in images)
    assert client.get(f"/api/projects/{project_id}/parts", headers=headers).json() == []
    assert (
        client.get(f"/api/projects/{project_id}/batches", headers=headers).json() == []
    )

    with patch(UPLOAD_TARGET, return_value=True):
        repeat = _load(client, project_id, headers)
    assert repeat.status_code == 200, repeat.text
    assert repeat.json()["images_created"] == 0
    assert repeat.json()["images_received"] == 20


def test_pt1_upload_failure_returns_500(client):
    project_id, headers = _create_project(client, "PT1", "pt1-upload-false")
    with patch(UPLOAD_TARGET, return_value=False):
        response = _load(client, project_id, headers)
    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to upload test data image"


def test_pt1_upload_exception_returns_500(client):
    project_id, headers = _create_project(client, "PT1", "pt1-upload-raise")
    with patch(UPLOAD_TARGET, side_effect=RuntimeError("storage down")):
        response = _load(client, project_id, headers)
    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to upload test data image"


def test_pt2_load_builds_batches_from_hierarchy_filenames(client):
    project_id, headers = _create_project(client, "PT2", "pt2-hierarchy")
    with patch(UPLOAD_TARGET, return_value=True):
        response = _load(client, project_id, headers)
    assert response.status_code == 200, response.text
    counters = response.json()["ingest"]["counters"]
    assert counters["parts_created"] == counters["parts_received"] > 0
    parts = client.get(f"/api/projects/{project_id}/parts", headers=headers).json()
    for part in parts:
        metadata = part["metadata"]
        assert metadata["source"] == "vista-test-data"
        assert metadata["configured_views"] == sorted(metadata["configured_views"])
        assert metadata["source_images"]


def test_nist_load_reports_missing_volumes(client, monkeypatch, tmp_path):
    monkeypatch.setattr(pt3_test_fixtures, "PT3_TEST_DATA_ROOT", tmp_path)
    project_id, headers = _create_project(client, "PT3", "nist-missing")
    response = _load(client, project_id, headers, fixture="nist-cocr")
    assert response.status_code == 404
    assert response.json()["detail"] == "NIST CoCr test volumes not found"


def test_nist_load_rejects_conflicting_existing_image(client):
    project_id, headers = _create_project(client, "PT3", "nist-conflict")
    buffer = io.BytesIO()
    np.save(buffer, np.zeros((2, 2, 2), dtype=np.uint16), allow_pickle=False)
    buffer.seek(0)
    upload = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (RAW_FILENAME, buffer, "application/octet-stream")},
        headers=headers,
    )
    assert upload.status_code == 201, upload.text

    with patch(UPLOAD_TARGET, return_value=False):
        response = _load(client, project_id, headers, fixture="nist-cocr")
    assert response.status_code == 409
    assert response.json()["detail"].startswith(
        f"Existing image conflicts with built-in NIST fixture {RAW_FILENAME}: "
    )
    assert "object_storage_key" in response.json()["detail"]


def test_load_test_data_rejects_unreadable_project(client):
    project_id, _ = _create_project(client, "PT1", "outsider")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        response = _load(client, project_id, {"X-User-Id": "outsider@example.com"})
    assert response.status_code == 403


def test_load_test_data_rejects_api_key_callers(client):
    project_id, _ = _create_project(
        client, "PT1", "api-key", group="project-alpha-group"
    )
    key_response = client.post("/api/api-keys", json={"name": "fixture-loader-key"})
    assert key_response.status_code == 201, key_response.text
    raw_key = key_response.json()["key"]

    with patch(UPLOAD_TARGET, return_value=True):
        response = _load(client, project_id, {"Authorization": f"Bearer {raw_key}"})

    assert response.status_code == 403
    assert "API key access is not allowed" in response.json()["detail"]
    assert _images(client, project_id, {}) == []
