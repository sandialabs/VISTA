"""Characterization tests for the part metadata-sources workflow error paths."""

import uuid
from unittest.mock import patch


def _deep_metadata(depth: int) -> dict:
    node: dict = {"leaf": 1}
    for index in range(depth):
        node = {f"level{index}": node}
    return node


def _setup(client, name):
    headers = {
        "X-User-Id": "part-sources@example.com",
        "X-User-Groups": '["part-sources"]',
    }
    project = client.post(
        "/api/projects/",
        json={
            "name": name,
            "description": None,
            "meta_group_id": "part-sources",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]
    part = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "SN-SOURCES",
            "display_name": "Sources part",
            "metadata": {"keep": "me"},
        },
        headers=headers,
    )
    assert part.status_code == 201, part.text
    return project_id, part.json()["id"], headers


def _store_metadata(client, project_id, headers, key, value):
    response = client.post(
        f"/api/projects/{project_id}/metadata",
        json={"key": key, "value": value},
        headers=headers,
    )
    assert response.status_code == 201, response.text


def _put_sources(client, project_id, part_id, headers, keys):
    return client.put(
        f"/api/projects/{project_id}/parts/{part_id}/metadata-sources",
        json={"metadata_source_keys": keys},
        headers=headers,
    )


def test_metadata_sources_reports_missing_part(client):
    project_id, _, headers = _setup(client, "Sources missing part")
    response = _put_sources(client, project_id, uuid.uuid4(), headers, [])
    assert response.status_code == 404
    assert response.json()["detail"] == "Inspection part not found"


def test_metadata_sources_reports_missing_source_key(client):
    project_id, part_id, headers = _setup(client, "Sources missing key")
    response = _put_sources(client, project_id, part_id, headers, ["absent-key"])
    assert response.status_code == 404
    assert response.json()["detail"] == "Metadata source 'absent-key' not found"


def test_metadata_sources_non_nsipro_value_is_combined_without_nsipro(client):
    project_id, part_id, headers = _setup(client, "Sources plain value")
    _store_metadata(
        client,
        project_id,
        headers,
        "plain-source",
        {"filename": "plain.json", "file_type": "json", "metadata": {"a": 1}},
    )
    response = _put_sources(client, project_id, part_id, headers, ["plain-source"])
    assert response.status_code == 200, response.text
    metadata = response.json()["metadata"]
    assert metadata["keep"] == "me"
    assert metadata["associated_metadata_ref"] == "plain-source"
    assert metadata["associated_metadata"] == {
        "project_metadata_key": "plain-source",
        "filename": "plain.json",
        "file_type": "json",
        "parser": None,
        "parser_id": None,
    }
    assert metadata["project_metadata_combined"] == {"a": 1}
    assert metadata["nsipro_metadata_sources"] == []
    assert metadata["nsipro_metadata"] == {}

    cleared = _put_sources(client, project_id, part_id, headers, [])
    assert cleared.status_code == 200, cleared.text
    cleared_metadata = cleared.json()["metadata"]
    assert cleared_metadata["associated_metadata_ref"] is None
    assert cleared_metadata["associated_metadata"] is None
    assert cleared_metadata["project_metadata_combined"] == {}


def test_metadata_sources_field_limit_returns_422_and_rolls_back(client):
    project_id, part_id, headers = _setup(client, "Sources field limit")
    _store_metadata(
        client,
        project_id,
        headers,
        "associated_upload_metadata:deep.nsipro",
        {
            "filename": "deep.nsipro",
            "file_type": "nsipro",
            "parser_id": "default",
            "metadata": _deep_metadata(40),
        },
    )
    response = _put_sources(
        client,
        project_id,
        part_id,
        headers,
        ["associated_upload_metadata:deep.nsipro"],
    )
    assert response.status_code == 422
    assert "maximum depth" in response.json()["detail"]

    parts = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts.status_code == 200, parts.text
    assert parts.json()[0]["metadata"] == {"keep": "me"}


def test_metadata_sources_rejects_unreadable_project(client):
    project_id, part_id, _ = _setup(client, "Sources access")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        response = _put_sources(
            client, project_id, part_id, {"X-User-Id": "outsider@example.com"}, []
        )
    assert response.status_code == 403
