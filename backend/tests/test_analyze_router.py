import base64
import io

import pytest
from PIL import Image
from core.config import settings


def _png_bytes(color=(180, 20, 20)):
    image = Image.new("RGB", (12, 12), color)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _overlay_png_base64():
    image = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
    image.putpixel((1, 1), (250, 204, 21, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _create_project_with_part_image(client):
    headers = {"X-User-Id": "analyze-user@example.com", "X-User-Groups": '["analyze-group"]'}
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Analyze Project",
            "description": "typed toolbox contract",
            "meta_group_id": "analyze-group",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    image_resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("slice-002.png", _png_bytes(), "image/png")},
        data={"metadata": '{"modality":"ct","slice_index":2,"slice_axis":"axial","analysis_inline_image_base64":"' + base64.b64encode(_png_bytes().getvalue()).decode("ascii") + '"}'},
        headers=headers,
    )
    assert image_resp.status_code == 201, image_resp.text
    image = image_resp.json()

    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "AN-001",
            "display_name": "Analyze Part",
            "metadata": {
                "source_images": [
                    {
                        "filename": image["filename"],
                        "image_id": image["id"],
                        "modality": "ct",
                        "slice_axis": "axial",
                        "slice_index": 2,
                    }
                ]
            },
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    return headers, project_id, image


def test_analyze_toolbox_manifest_contains_segmentation_placeholders_and_core_image_methods(client):
    resp = client.get("/api/analyze/toolbox")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    method_ids = {method["id"] for method in payload["methods"]}
    assert payload["contract_version"] == "vista-analyze.v1"
    assert "segmentation.yolo.placeholder" in method_ids
    assert "segmentation.anomalib.placeholder" in method_ids
    assert "segmentation.sam.placeholder" in method_ids
    assert "segmentation.opencv.placeholder" in method_ids
    assert "ml.yolov8.detect" not in method_ids
    assert "ml.yolov8.segment" not in method_ids
    assert "ml.yolo.ultralytics" not in method_ids
    assert "ml.sam.segment_anything" not in method_ids
    assert "ml.mask2former.universal_segment" not in method_ids
    assert "ml.oneformer.universal_segment" not in method_ids
    assert "output.versioned_image_artifact" in method_ids
    assert "preprocess.window_level_normalization" in method_ids
    assert "segmentation.watershed_seeds" not in method_ids
    region_method = next(method for method in payload["methods"] if method["id"] == "measure.region_properties")
    assert region_method["name"] == "Region Properties (placeholder)"
    assert "filter.gaussian_blur" not in method_ids
    assert "filter.median" not in method_ids
    assert "morphology.open" not in method_ids
    assert "morphology.close" not in method_ids


def test_analyze_input_source_defaults_to_loaded_part_images(client):
    headers, project_id, image = _create_project_with_part_image(client)

    resp = client.get(f"/api/projects/{project_id}/analyze/input-source", headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["source"]["kind"] == "project_parts"
    assert payload["source"]["part_count"] == 1
    assert payload["source"]["image_count"] == 1
    assert payload["parts"][0]["serial_number"] == "AN-001"
    assert payload["images"][0]["image_id"] == image["id"]
    assert payload["images"][0]["slice_index"] == 2


def test_analyze_workflow_validation_and_execution_use_pydantic_contract(client):
    headers, project_id, _image = _create_project_with_part_image(client)
    source_resp = client.get(f"/api/projects/{project_id}/analyze/input-source", headers=headers)
    source = source_resp.json()["source"]
    workflow = {
        "name": "QA workflow",
        "source": source,
        "nodes": [
            {"id": "input", "method_id": "source.project_part_images", "label": "Input", "parameters": {}},
            {
                "id": "window",
                "method_id": "preprocess.window_level_normalization",
                "label": "Window",
                "parameters": {"window": 300, "level": 30, "clip": True},
            },
            {
                "id": "yolo",
                "method_id": "ml.yolov8.detect",
                "label": "YOLOv8",
                "parameters": {"model": "yolov8n.pt", "confidence": 0.25},
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "label": "Versioned Output",
                "parameters": {
                    "mode": "processing_sequence",
                    "export_policy": "materialize_on_export",
                    "materialize_processed_images": False,
                },
            },
        ],
        "edges": [
            {"source_node": "input", "target_node": "window"},
            {"source_node": "window", "target_node": "yolo"},
            {"source_node": "yolo", "target_node": "output"},
        ],
        "output": {
            "mode": "processing_sequence",
            "version_strategy": "recipe_metadata",
            "artifact_policy": "automatic_by_output_type",
            "cache_policy": "local_on_demand",
            "invalidation_policy": "source_workflow_toolbox_model",
            "provenance_level": "full",
            "export_policy": "materialize_on_export",
            "volume_policy": "recipe_volume_sparse_artifacts",
            "preserve_original": True,
            "write_detection_metadata": True,
            "write_segmentation_overlays": True,
            "write_measurement_tables": True,
            "materialize_processed_images": False,
        },
    }

    validate_resp = client.post(f"/api/projects/{project_id}/analyze/workflows/validate", json=workflow, headers=headers)
    assert validate_resp.status_code == 200, validate_resp.text
    assert validate_resp.json()["status"] == "validated"
    assert len(validate_resp.json()["node_results"]) == 4

    execute_resp = client.post(f"/api/projects/{project_id}/analyze/workflows/execute", json=workflow, headers=headers)
    assert execute_resp.status_code == 200, execute_resp.text
    assert execute_resp.json()["status"] == "completed"
    assert execute_resp.json()["execution_mode"] == "execution"
    assert execute_resp.json()["image_count"] == 1
    assert any("YOLO model 'yolov8n.pt' was not used" in warning for warning in execute_resp.json()["warnings"])
    yolo_node = next(node for node in execute_resp.json()["node_results"] if node["node_id"] == "yolo")
    assert yolo_node["status"] == "skipped"
    assert yolo_node["summary"]["runtime"] == "unavailable"
    assert yolo_node["summary"]["detection_count"] == 0

    workflow["nodes"][1]["method_id"] = "missing.method"
    reject_resp = client.post(f"/api/projects/{project_id}/analyze/workflows/validate", json=workflow, headers=headers)
    assert reject_resp.status_code == 400
    detail = reject_resp.json()["detail"]
    message = detail.get("message") if isinstance(detail, dict) else detail
    assert "Unknown toolbox method" in message


def test_analyze_workflow_yolov8_detection_suppresses_overlay_when_runtime_unavailable(client):
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = {
        "name": "YOLO detection overlay regression",
        "source": {
            "id": "example-selection",
            "label": "Example image",
            "kind": "manual_selection",
            "project_id": project_id,
            "selected_image_ids": [image["id"]],
            "example_image_id": image["id"],
            "image_count": 1,
            "part_count": 1,
        },
        "nodes": [
            {"id": "input", "method_id": "source.project_part_images", "label": "Input", "parameters": {}},
            {
                "id": "yolo",
                "method_id": "ml.yolov8.detect",
                "label": "YOLOv8 Object Detection",
                "parameters": {"model": "yolov8n.pt", "confidence": 0.25},
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "label": "Versioned Output",
                "parameters": {"mode": "overlay_artifact"},
            },
        ],
        "edges": [
            {"source_node": "input", "target_node": "yolo"},
            {"source_node": "yolo", "target_node": "output"},
        ],
        "output": {"mode": "overlay_artifact", "version_strategy": "recipe_metadata"},
    }

    resp = client.post(f"/api/projects/{project_id}/analyze/workflows/execute", json=workflow, headers=headers)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["status"] == "completed"
    assert any("Ultralytics runtime is unavailable" in warning for warning in payload["warnings"])
    assert not any("Attached 1 Analyze overlay output" in warning for warning in payload["warnings"])
    yolo_node = next(node for node in payload["node_results"] if node["node_id"] == "yolo")
    assert yolo_node["status"] == "skipped"
    assert yolo_node["summary"]["runtime"] == "unavailable"
    output_node = next(node for node in payload["node_results"] if node["node_id"] == "output")
    assert output_node["status"] == "skipped"
    assert output_node["summary"]["artifact_count"] == 0
    assert output_node["artifacts"] == []

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    part = parts_resp.json()[0]
    assert "analysis_outputs" not in part["metadata"]


@pytest.mark.asyncio
async def test_analyze_workflow_uses_configured_model_service_and_preserves_yolo_labels(monkeypatch):
    from routers import analyze as analyze_router
    from backend.analyze_toolbox import WorkflowGraph, WorkflowImageInput

    image_id = "11111111-1111-4111-8111-111111111111"
    detection = {
        "class_id": 0,
        "class_name": "person",
        "confidence": 0.93,
        "bbox": {"x": 1, "y": 1, "width": 4, "height": 5, "image_width": 12, "image_height": 12},
    }
    captured_payload = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "workflow_name": "YOLO detection via model service",
                "status": "completed",
                "execution_mode": "execution",
                "image_count": 1,
                "warnings": [],
                "node_results": [
                    {
                        "node_id": "input",
                        "method_id": "source.project_part_images",
                        "status": "completed",
                        "output_types": ["image"],
                        "message": "Loaded source image bytes.",
                        "summary": {"image_id": image_id},
                        "artifacts": [],
                    },
                    {
                        "node_id": "yolo",
                        "method_id": "ml.yolov8.detect",
                        "status": "completed",
                        "output_types": ["detections", "measurements"],
                        "message": "Computed YOLOv8 object detections.",
                        "summary": {
                            "image_id": image_id,
                            "runtime": "ultralytics",
                            "model": "yolov8n.pt",
                            "detection_count": 1,
                            "measurement_count": 1,
                            "detection_classes": {"person": 1},
                            "detections": [detection],
                        },
                        "artifacts": [],
                    },
                    {
                        "node_id": "output",
                        "method_id": "output.versioned_image_artifact",
                        "status": "completed",
                        "output_types": ["metadata"],
                        "message": "Prepared recipe/artifact output metadata.",
                        "summary": {"image_id": image_id, "artifact_count": 1},
                        "artifacts": [
                            {
                                "kind": "overlay_image",
                                "label": "Detection Overlay :: YOLOv8 Object Detection",
                                "method_id": "ml.yolov8.detect",
                                "method_name": "YOLOv8 Object Detection",
                                "detections": [detection],
                                "content_type": "image/png",
                                "filename_suffix": "analyze-overlay.png",
                                "data_base64": _overlay_png_base64(),
                                "width": 12,
                                "height": 12,
                            }
                        ],
                    },
                ],
            }

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json):
            captured_payload["url"] = url
            captured_payload["json"] = json
            return FakeResponse()

    monkeypatch.setattr(analyze_router, "settings", settings.patch({"TOOLBOX_MODEL_SERVICE_URL": "http://toolbox-models:8010"}))
    monkeypatch.setattr(analyze_router.httpx, "AsyncClient", FakeAsyncClient)

    workflow = WorkflowGraph(
        name="YOLO detection via model service",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1, "part_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "label": "Input", "parameters": {}},
            {
                "id": "yolo",
                "method_id": "ml.yolov8.detect",
                "label": "YOLOv8 Object Detection",
                "parameters": {"model": "yolov8n.pt", "confidence": 0.25},
            },
        ],
        edges=[{"source_node": "input", "target_node": "yolo"}],
    )
    result = await analyze_router._execute_workflow_via_model_service(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="slice.png", content_type="image/png", data=_png_bytes().getvalue())],
    )

    assert result is not None
    assert captured_payload["url"] == "http://toolbox-models:8010/workflows/execute"
    assert captured_payload["json"]["images"][0]["data_base64"]
    yolo_node = next(node for node in result.node_results if node.node_id == "yolo")
    assert yolo_node.status == "completed"
    assert yolo_node.summary["runtime"] == "ultralytics"
    assert yolo_node.summary["detections"][0]["class_name"] == "person"


def test_analyze_workflow_manual_selection_counts_selected_images(client):
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = {
        "name": "Example workflow",
        "source": {
            "id": "example-selection",
            "label": "Example image",
            "kind": "manual_selection",
            "project_id": project_id,
            "selected_image_ids": [image["id"]],
            "example_image_id": image["id"],
            "image_count": 99,
            "part_count": 99,
        },
        "nodes": [
            {
                "id": "input",
                "method_id": "source.project_part_images",
                "label": "Input",
                "parameters": {"example_image_id": image["id"]},
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "label": "Versioned Output",
                "parameters": {"mode": "overlay_artifact"},
            },
        ],
        "edges": [{"source_node": "input", "target_node": "output"}],
        "output": {"mode": "overlay_artifact", "version_strategy": "recipe_metadata"},
    }
    resp = client.post(f"/api/projects/{project_id}/analyze/workflows/execute", json=workflow, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "completed"
    assert resp.json()["image_count"] == 1


def test_analyze_workflow_yolov8_instance_segmentation_suppresses_overlay_when_runtime_unavailable(client):
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = {
        "name": "YOLOv8 instance segmentation",
        "source": {
            "id": "example-selection",
            "label": "Example image",
            "kind": "manual_selection",
            "project_id": project_id,
            "selected_image_ids": [image["id"]],
            "example_image_id": image["id"],
            "image_count": 1,
            "part_count": 1,
        },
        "nodes": [
            {"id": "input", "method_id": "source.project_part_images", "label": "Input", "parameters": {}},
            {
                "id": "segment",
                "method_id": "ml.yolov8.segment",
                "label": "YOLOv8 Instance Segmentation",
                "parameters": {"model": "yolov8n-seg.pt", "confidence": 0.35},
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "label": "Versioned Output",
                "parameters": {"mode": "overlay_artifact"},
            },
        ],
        "edges": [
            {"source_node": "input", "target_node": "segment"},
            {"source_node": "segment", "target_node": "output"},
        ],
        "output": {"mode": "overlay_artifact", "version_strategy": "recipe_metadata"},
    }

    resp = client.post(f"/api/projects/{project_id}/analyze/workflows/execute", json=workflow, headers=headers)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["status"] == "completed"
    assert any("YOLO model 'yolov8n-seg.pt' was not used" in warning for warning in payload["warnings"])
    assert not any("Attached 1 Analyze overlay output" in warning for warning in payload["warnings"])
    segment_node = next(node for node in payload["node_results"] if node["node_id"] == "segment")
    assert segment_node["status"] == "skipped"
    assert segment_node["summary"]["runtime"] == "unavailable"
    output_node = next(node for node in payload["node_results"] if node["node_id"] == "output")
    assert output_node["status"] == "skipped"
    assert output_node["summary"]["artifact_count"] == 0
    assert output_node["artifacts"] == []


def test_analyze_workflow_uses_server_source_counts_and_rejects_cross_project_source(client):
    headers, project_id, _image = _create_project_with_part_image(client)
    workflow = {
        "name": "Mismatched source workflow",
        "source": {
            "id": "all-loaded-part-images",
            "label": "All images from loaded parts",
            "kind": "project_parts",
            "project_id": project_id,
            "image_count": 9999,
            "part_count": 9999,
        },
        "nodes": [{"id": "input", "method_id": "source.project_part_images", "label": "Input", "parameters": {}}],
        "edges": [],
    }
    resp = client.post(f"/api/projects/{project_id}/analyze/workflows/validate", json=workflow, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["image_count"] == 1

    workflow["source"]["project_id"] = "00000000-0000-0000-0000-000000000000"
    mismatch_resp = client.post(f"/api/projects/{project_id}/analyze/workflows/validate", json=workflow, headers=headers)
    assert mismatch_resp.status_code == 400
    detail = mismatch_resp.json()["detail"]
    message = detail.get("message") if isinstance(detail, dict) else detail
    assert "does not match" in message


def test_delete_and_restore_analyze_overlay_accept_non_uuid_overlay_image_ids(client):
    headers, project_id, image = _create_project_with_part_image(client)
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "AN-OVERLAY-STRING",
            "display_name": "Analyze Overlay Part",
            "metadata": {
                "source_images": [
                    {
                        "filename": image["filename"],
                        "image_id": image["id"],
                        "side": "front",
                        "modality": "visual",
                        "overlay": False,
                    },
                    {
                        "filename": "source_analyze_overlay.png",
                        "image_id": "overlay-image-1",
                        "side": "front",
                        "modality": "analyze-overlay",
                        "overlay": True,
                        "analysis_output": True,
                        "overlay_base_image_id": image["id"],
                        "overlay_base_filename": image["filename"],
                    },
                ],
                "analysis_outputs": [
                    {
                        "filename": "source_analyze_overlay.png",
                        "image_id": "overlay-image-1",
                        "overlay": True,
                        "overlay_base_image_id": image["id"],
                        "overlay_base_filename": image["filename"],
                    }
                ],
            },
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text

    delete_resp = client.delete(
        f"/api/projects/{project_id}/analyze/overlays/overlay-image-1",
        headers=headers,
    )
    assert delete_resp.status_code == 200, delete_resp.text
    deleted_overlay = next(
        record for record in delete_resp.json()["metadata"]["analysis_outputs"] if record.get("image_id") == "overlay-image-1"
    )
    assert deleted_overlay["overlay_delete_candidate"] is True

    restore_resp = client.post(
        f"/api/projects/{project_id}/analyze/overlays/overlay-image-1/restore",
        headers=headers,
    )
    assert restore_resp.status_code == 200, restore_resp.text
    restored_overlay = next(
        record for record in restore_resp.json()["metadata"]["analysis_outputs"] if record.get("image_id") == "overlay-image-1"
    )
    assert "overlay_delete_candidate" not in restored_overlay


def test_delete_analyze_overlay_rejects_original_project_images(client):
    headers, project_id, image = _create_project_with_part_image(client)
    resp = client.delete(
        f"/api/projects/{project_id}/analyze/overlays/{image['id']}",
        headers=headers,
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json().get("detail")
    if isinstance(detail, dict):
        detail = detail.get("message", "")
    assert "Move the image out of the part" in str(detail)


def test_analyze_workflow_allows_multiple_input_rooted_processing_chains(client):
    headers, project_id, _image = _create_project_with_part_image(client)
    source_resp = client.get(f"/api/projects/{project_id}/analyze/input-source", headers=headers)
    source = source_resp.json()["source"]
    workflow = {
        "name": "Parallel chains",
        "source": source,
        "nodes": [
            {"id": "input-1", "method_id": "source.project_part_images", "label": "Input", "chain_id": "chain-1", "parameters": {}},
            {
                "id": "yolo",
                "method_id": "ml.yolov8.detect",
                "label": "YOLOv8",
                "chain_id": "chain-1",
                "parameters": {"model": "yolov8n.pt", "confidence": 0.25},
            },
            {"id": "input-2", "method_id": "source.project_part_images", "label": "Input 2", "chain_id": "chain-2", "parameters": {}},
            {
                "id": "segment",
                "method_id": "segmentation.watershed_seeds",
                "label": "Segmentation",
                "chain_id": "chain-2",
                "parameters": {"seed_spacing_px": 18, "compactness": 0.01},
            },
        ],
        "edges": [
            {"source_node": "input-1", "target_node": "yolo"},
            {"source_node": "input-2", "target_node": "segment"},
        ],
        "output": {"mode": "processing_sequence"},
    }

    validate_resp = client.post(f"/api/projects/{project_id}/analyze/workflows/validate", json=workflow, headers=headers)
    assert validate_resp.status_code == 200, validate_resp.text
    assert validate_resp.json()["status"] == "validated"
    assert len(validate_resp.json()["node_results"]) == 4


def test_analyze_input_source_skips_stale_filename_only_sources(client):
    headers = {"X-User-Id": "analyze-stale@example.com", "X-User-Groups": '["analyze-stale"]'}
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Analyze Stale Project",
            "description": "stale source refs",
            "meta_group_id": "analyze-stale",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "STALE-001",
            "metadata": {"source_images": [{"filename": "missing.png", "modality": "visible"}]},
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text

    source_resp = client.get(f"/api/projects/{project_id}/analyze/input-source", headers=headers)
    assert source_resp.status_code == 200, source_resp.text
    assert source_resp.json()["source"]["part_count"] == 1
    assert source_resp.json()["source"]["image_count"] == 0
    assert source_resp.json()["images"] == []
