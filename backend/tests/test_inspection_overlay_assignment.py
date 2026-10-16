"""Characterization tests for the overlay-to-base assignment workflow."""

import io
import json
from unittest.mock import patch

from PIL import Image


def _create_project(client, name):
    headers = {
        "X-User-Id": "overlay-assign@example.com",
        "X-User-Groups": '["overlay-assign"]',
    }
    response = client.post(
        "/api/projects/",
        json={
            "name": name,
            "description": None,
            "meta_group_id": "overlay-assign",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], headers


def _upload(client, project_id, headers, filename, metadata):
    image = Image.new("RGB", (8, 8), (12, 34, 56))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    response = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, buffer, "image/png")},
        data={"metadata": json.dumps(metadata)},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_part(client, project_id, headers, serial):
    response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": serial, "display_name": serial},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _assign(client, project_id, headers, filename, part_id):
    response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": filename, "to_part_id": part_id},
        headers=headers,
    )
    assert response.status_code == 200, response.text


def _post_overlay(client, project_id, headers, payload):
    return client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json=payload,
        headers=headers,
    )


def _parts_by_id(client, project_id, headers):
    response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert response.status_code == 200, response.text
    return {part["id"]: part for part in response.json()}


def test_overlay_assignment_reports_missing_overlay(client):
    project_id, headers = _create_project(client, "Overlay missing overlay")
    response = _post_overlay(
        client, project_id, headers, {"overlay_filename": "absent.png"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Overlay image not found"


def test_overlay_assignment_reports_missing_base(client):
    project_id, headers = _create_project(client, "Overlay missing base")
    overlay = _upload(client, project_id, headers, "ov.png", {"overlay": True})
    response = _post_overlay(
        client,
        project_id,
        headers,
        {"overlay_filename": overlay["filename"], "base_filename": "absent.png"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Base image not found"


def test_overlay_assignment_rejects_self_assignment(client):
    project_id, headers = _create_project(client, "Overlay self assignment")
    overlay = _upload(client, project_id, headers, "self.png", {"overlay": True})
    response = _post_overlay(
        client,
        project_id,
        headers,
        {
            "overlay_image_id": overlay["id"],
            "overlay_filename": "self.png",
            "base_image_id": overlay["id"],
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Overlay image cannot be assigned to itself"


def test_overlay_assignment_requires_base_assigned_to_part(client):
    project_id, headers = _create_project(client, "Overlay unassigned base")
    base = _upload(client, project_id, headers, "b.png", {"side": "front"})
    overlay = _upload(client, project_id, headers, "o.png", {"overlay": True})
    response = _post_overlay(
        client,
        project_id,
        headers,
        {"overlay_filename": overlay["filename"], "base_filename": base["filename"]},
    )
    assert response.status_code == 404
    assert (
        response.json()["detail"] == "Base image is not assigned to an inspection part"
    )


def test_overlay_assignment_moves_overlay_and_detaches_stale_copy(client):
    project_id, headers = _create_project(client, "Overlay move between parts")
    base = _upload(
        client, project_id, headers, "base.png", {"side": "Back", "modality": "vis"}
    )
    overlay = _upload(
        client, project_id, headers, "heat.png", {"overlay": True, "modality": "Heat"}
    )
    source_part = _create_part(client, project_id, headers, "SN-SOURCE")
    target_part = _create_part(client, project_id, headers, "SN-TARGET")
    _assign(client, project_id, headers, base["filename"], target_part)
    _assign(client, project_id, headers, overlay["filename"], source_part)

    response = _post_overlay(
        client,
        project_id,
        headers,
        {"overlay_filename": overlay["filename"], "base_image_id": base["id"]},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "project_id": project_id,
        "overlay_filename": "heat.png",
        "base_filename": "base.png",
        "from_part_id": source_part,
        "to_part_id": target_part,
    }
    parts = _parts_by_id(client, project_id, headers)
    assert parts[source_part]["metadata"]["source_images"] == []
    target_records = parts[target_part]["metadata"]["source_images"]
    overlay_record = next(r for r in target_records if r["filename"] == "heat.png")
    assert overlay_record["overlay"] is True
    assert overlay_record["side"] == "back"
    assert overlay_record["modality"] == "heat"
    assert overlay_record["overlay_base_filename"] == "base.png"
    assert overlay_record["overlay_base_image_id"] == base["id"]
    assert parts[target_part]["metadata"]["overlay_images"] == {
        "back": {"heat": "heat.png"}
    }


def test_overlay_assignment_without_base_detaches_overlay(client):
    project_id, headers = _create_project(client, "Overlay detach")
    overlay = _upload(client, project_id, headers, "loose.png", {"overlay": True})
    part_id = _create_part(client, project_id, headers, "SN-DETACH")
    _assign(client, project_id, headers, overlay["filename"], part_id)

    response = _post_overlay(
        client, project_id, headers, {"overlay_filename": " loose.png "}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "project_id": project_id,
        "overlay_filename": "loose.png",
        "base_filename": None,
        "from_part_id": part_id,
        "to_part_id": None,
    }
    parts = _parts_by_id(client, project_id, headers)
    assert parts[part_id]["metadata"]["source_images"] == []


def test_overlay_assignment_blank_base_filename_is_treated_as_no_base(client):
    project_id, headers = _create_project(client, "Overlay blank base")
    overlay = _upload(client, project_id, headers, "blank.png", {"overlay": True})
    response = _post_overlay(
        client,
        project_id,
        headers,
        {"overlay_filename": overlay["filename"], "base_filename": "   "},
    )
    assert response.status_code == 200, response.text
    assert response.json()["base_filename"] is None
    assert response.json()["from_part_id"] is None
    assert response.json()["to_part_id"] is None


def test_overlay_assignment_requires_project_access(client):
    project_id, _ = _create_project(client, "Overlay access")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        response = _post_overlay(
            client,
            project_id,
            {"X-User-Id": "outsider@example.com"},
            {"overlay_filename": "any.png"},
        )
    assert response.status_code == 403
