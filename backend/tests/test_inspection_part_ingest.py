"""Characterization tests for the bulk part-ingest route."""

from unittest.mock import patch


def _deep_metadata(depth: int) -> dict:
    node: dict = {"leaf": 1}
    for index in range(depth):
        node = {f"level{index}": node}
    return node


def _create_project(client, name, project_type="PT2"):
    headers = {
        "X-User-Id": "part-ingest@example.com",
        "X-User-Groups": '["part-ingest"]',
    }
    response = client.post(
        "/api/projects/",
        json={
            "name": name,
            "description": None,
            "meta_group_id": "part-ingest",
            "project_type": project_type,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], headers


def test_ingest_counts_created_existing_and_discrepancies(client):
    project_id, headers = _create_project(client, "Ingest counters")
    first = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "batches": [
                {"name": "B1", "parts": [{"serial_number": "SN1"}]},
                {"name": "B2", "parts": [{"serial_number": "SN2"}]},
            ]
        },
        headers=headers,
    )
    assert first.status_code == 200, first.text
    assert first.json()["counters"] == {
        "batches_received": 2,
        "parts_received": 2,
        "batches_created": 2,
        "parts_created": 2,
        "parts_skipped_existing": 0,
        "parts_skipped_discrepancy": 0,
    }

    second = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "batches": [
                {
                    "name": "B1",
                    "parts": [
                        {"serial_number": " SN1 "},
                        {"serial_number": "SN2"},
                        {"serial_number": "SN1"},
                    ],
                }
            ],
            "unassigned_parts": [{"serial_number": "SN3"}],
        },
        headers=headers,
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["project_id"] == project_id
    assert body["counters"] == {
        "batches_received": 1,
        "parts_received": 4,
        "batches_created": 0,
        "parts_created": 1,
        "parts_skipped_existing": 1,
        "parts_skipped_discrepancy": 2,
    }
    assert [item["code"] for item in body["discrepancies"]] == [
        "serial_already_assigned_to_other_batch",
        "duplicate_serial_in_payload",
    ]
    assert body["discrepancies"][0] == {
        "code": "serial_already_assigned_to_other_batch",
        "batch_name": "B1",
        "serial_number": "SN2",
        "message": "Serial number already belongs to a different batch in this project",
    }
    parts = client.get(f"/api/projects/{project_id}/parts", headers=headers).json()
    unassigned = next(part for part in parts if part["serial_number"] == "SN3")
    assert unassigned["batch_id"] is None


def test_ingest_field_limit_returns_422_and_rolls_back_batches_and_parts(client):
    project_id, headers = _create_project(client, "Ingest field limit")
    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": "associated_upload_metadata:deep.nsipro",
            "value": {
                "file_type": "nsipro",
                "source_filename": "deep.nsipro",
                "metadata": _deep_metadata(40),
            },
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    response = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "batches": [
                {
                    "name": "ROLLBACK-BATCH",
                    "parts": [
                        {
                            "serial_number": "SN-DEEP",
                            "metadata": {
                                "associated_metadata_ref": (
                                    "associated_upload_metadata:deep.nsipro"
                                )
                            },
                        }
                    ],
                }
            ]
        },
        headers=headers,
    )
    assert response.status_code == 422
    assert "maximum depth" in response.json()["detail"]
    assert client.get(f"/api/projects/{project_id}/parts", headers=headers).json() == []
    assert (
        client.get(f"/api/projects/{project_id}/batches", headers=headers).json() == []
    )


def test_ingest_stored_bundle_without_metadata_or_text_returns_422(client):
    project_id, headers = _create_project(client, "Ingest empty bundle")
    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": "associated_upload_metadata:empty.nsipro",
            "value": {"file_type": "nsipro", "source_filename": "empty.nsipro"},
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    response = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "unassigned_parts": [
                {
                    "serial_number": "SN-EMPTY",
                    "metadata": {
                        "associated_metadata_ref": (
                            "associated_upload_metadata:empty.nsipro"
                        )
                    },
                }
            ]
        },
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Associated .nsipro metadata does not contain parsed metadata or raw text."
    )
    assert client.get(f"/api/projects/{project_id}/parts", headers=headers).json() == []


def test_ingest_rejects_unreadable_project(client):
    project_id, _ = _create_project(client, "Ingest access")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        response = client.post(
            f"/api/projects/{project_id}/ingest",
            json={"unassigned_parts": [{"serial_number": "SN-X"}]},
            headers={"X-User-Id": "outsider@example.com"},
        )
    assert response.status_code == 403
