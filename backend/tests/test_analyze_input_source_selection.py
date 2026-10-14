import base64
import io

from PIL import Image


def _image_bytes(fmt="JPEG", color=(180, 20, 20)):
    image = Image.new("RGB", (12, 12), color)
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    buf.seek(0)
    return buf


def _create_project(client):
    headers = {
        "X-User-Id": "analyze-input@example.com",
        "X-User-Groups": '["analyze-input"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Analyze Input Selection",
            "description": "source filtering regression",
            "meta_group_id": "analyze-input",
            "project_type": "PT2",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    return headers, project_resp.json()["id"]


def _upload_source(client, project_id, headers, filename, payload, content_type):
    payload_bytes = payload.getvalue()
    upload_resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, io.BytesIO(payload_bytes), content_type)},
        data={
            "metadata": '{"analysis_inline_image_base64":"'
            + base64.b64encode(payload_bytes).decode("ascii")
            + '"}'
        },
        headers=headers,
    )
    assert upload_resp.status_code == 201, upload_resp.text
    return upload_resp.json()


def _create_part(client, project_id, headers, source_images):
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "AN-SRC-001",
            "display_name": "Analyze source part",
            "metadata": {"source_images": source_images},
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    return part_resp.json()


def test_analyze_input_source_excludes_text_overlay_fixtures(client):
    headers, project_id = _create_project(client)
    visual = _upload_source(
        client, project_id, headers, "chosen-example.jpg", _image_bytes(), "image/jpeg"
    )
    text_overlay = _upload_source(
        client,
        project_id,
        headers,
        "chosen-example_segmentation_true.txt",
        io.BytesIO(b"mask"),
        "text/plain",
    )
    _create_part(
        client,
        project_id,
        headers,
        [
            {
                "filename": visual["filename"],
                "image_id": visual["id"],
                "modality": "visual",
                "overlay": False,
            },
            {
                "filename": text_overlay["filename"],
                "image_id": text_overlay["id"],
                "modality": "segmentation",
                "overlay": True,
            },
        ],
    )

    source_resp = client.get(
        f"/api/projects/{project_id}/analyze/input-source", headers=headers
    )

    assert source_resp.status_code == 200, source_resp.text
    payload = source_resp.json()
    assert payload["source"]["image_count"] == 1
    assert payload["parts"][0]["image_count"] == 1
    assert [image["filename"] for image in payload["images"]] == ["chosen-example.jpg"]


def test_run_example_source_id_does_not_expand_to_entire_part(client):
    headers, project_id = _create_project(client)
    first = _upload_source(
        client,
        project_id,
        headers,
        "first-example.jpg",
        _image_bytes(color=(200, 10, 10)),
        "image/jpeg",
    )
    second = _upload_source(
        client,
        project_id,
        headers,
        "second-example.jpg",
        _image_bytes(color=(10, 200, 10)),
        "image/jpeg",
    )
    part = _create_part(
        client,
        project_id,
        headers,
        [
            {
                "filename": first["filename"],
                "image_id": first["id"],
                "modality": "visual",
                "overlay": False,
            },
            {
                "filename": second["filename"],
                "image_id": second["id"],
                "modality": "visual",
                "overlay": False,
            },
        ],
    )
    workflow = {
        "name": "Run one example",
        "source": {
            "id": "example-image-selection",
            "label": "Chosen example image",
            "kind": "manual_selection",
            "project_id": project_id,
            "selected_image_ids": [first["id"]],
            "selected_part_ids": [part["id"]],
            "example_image_id": first["id"],
            "image_count": 1,
            "part_count": 1,
        },
        "nodes": [
            {
                "id": "input",
                "method_id": "source.project_part_images",
                "label": "Input",
                "parameters": {},
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "label": "Output",
                "parameters": {},
            },
        ],
        "edges": [{"source_node": "input", "target_node": "output"}],
        "output": {
            "mode": "processing_sequence",
            "version_strategy": "recipe_metadata",
        },
    }

    execute_resp = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert execute_resp.status_code == 200, execute_resp.text
    payload = execute_resp.json()
    assert payload["image_count"] == 1
    assert {node["summary"]["image_id"] for node in payload["node_results"]} == {
        first["id"]
    }

    validate_resp = client.post(
        f"/api/projects/{project_id}/analyze/workflows/validate",
        json=workflow,
        headers=headers,
    )

    assert validate_resp.status_code == 200, validate_resp.text
    assert validate_resp.json()["image_count"] == 1
