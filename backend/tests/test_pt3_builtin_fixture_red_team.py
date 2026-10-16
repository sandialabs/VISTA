"""Adversarial coverage for repository-owned PT3 fixture fallbacks."""

import io
import json
from unittest.mock import patch

from PIL import Image


def _create_pt3_project(client, suffix):
    headers = {
        "X-User-Id": f"pt3-red-{suffix}@example.com",
        "X-User-Groups": f'["pt3-red-{suffix}"]',
    }
    project = client.post(
        "/api/projects/",
        headers=headers,
        json={
            "name": f"PT3 red team {suffix}",
            "description": "fixture provenance boundary test",
            "meta_group_id": f"pt3-red-{suffix}",
            "project_type": "PT3",
        },
    ).json()
    return headers, project


def test_metadata_only_builtin_stack_serves_content_and_generates_splats(client):
    headers, project = _create_pt3_project(client, "builtin")

    with patch("services.inspection.test_fixture_images.upload_file_to_s3", return_value=False):
        loaded = client.post(
            f"/api/projects/{project['id']}/load-test-data", headers=headers
        )
    assert loaded.status_code == 200, loaded.text

    images = client.get(
        f"/api/projects/{project['id']}/images?include_deleted=true&limit=2000",
        headers=headers,
    ).json()
    source_slice = next(
        image for image in images if not image["metadata"].get("overlay")
    )
    content = client.get(f"/api/images/{source_slice['id']}/content", headers=headers)
    assert content.status_code == 200, content.text
    assert content.content.startswith(b"\x89PNG\r\n\x1a\n")

    part = client.get(f"/api/projects/{project['id']}/parts", headers=headers).json()[0]
    requested = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
        headers=headers,
        json={"output_format": "json", "transfer_function": {"threshold": 245}},
    )
    assert requested.status_code == 200, requested.text
    status = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    )
    assert status.status_code == 200, status.text
    assert status.json()["status"] == "ready", status.text
    assert status.json()["splat_count"] > 0


def test_forged_builtin_fixture_path_cannot_materialize_repository_slice(client):
    headers, project = _create_pt3_project(client, "forged")
    buffer = io.BytesIO()
    Image.new("L", (2, 2), color=0).save(buffer, format="PNG")

    forged_name = "../../geometric/PT3_GEOMETRIC_DUAL_LABEL_Z016.png"
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": ("untrusted.png", io.BytesIO(buffer.getvalue()), "image/png")},
        data={
            "metadata": json.dumps(
                {
                    "source": "vista-test-data",
                    "project_type": "PT3",
                    "builtin_fixture_filename": forged_name,
                    "storage_status": "metadata_only",
                    "volume_stack_id": "forged-stack",
                    "slice_index": 0,
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image = upload.json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "FORGED-PROVENANCE",
            "metadata": {
                "volume_stack_id": "forged-stack",
                "source_images": [
                    {
                        "image_id": image["id"],
                        "filename": "untrusted.png",
                        "slice_index": 0,
                    }
                ],
            },
        },
    ).json()

    # A client-supplied provenance claim must not grant access to any repository
    # fixture, even when its basename happens to match a real built-in slice.
    with patch(
        "services.inspection.pt3_volume_stack.get_presigned_download_url",
        return_value=None,
    ):
        requested = client.post(
            f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
            headers=headers,
            json={"output_format": "json", "transfer_function": {"threshold": 245}},
        )
    # Materialization now rejects the forged provenance before a background
    # conversion job is queued, which is safer than recording a delayed failure.
    assert requested.status_code == 500, requested.text
    assert (
        "Could not read image stack slice untrusted.png" in requested.json()["detail"]
    )
    status = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    )
    assert status.status_code == 200, status.text
    assert status.json()["status"] == "missing", status.text
