import base64
import io
import os
import uuid

import pytest
import requests
from backend.analyze_toolbox.model_service import (
    WorkflowExecutionPayload,
    execute_workflow,
    health,
    manifest,
)
from PIL import Image


def _png_base64() -> str:
    image = Image.new("L", (6, 6), 0)
    pixels = image.load()
    for y in range(1, 5):
        for x in range(2, 5):
            pixels[x, y] = 220
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _workflow_payload(method_id="segmentation.yolo.placeholder", parameters=None):
    image_id = str(uuid.uuid4())
    return {
        "workflow": {
            "name": "Container model-service smoke workflow",
            "source": {
                "kind": "manual_selection",
                "selected_image_ids": [image_id],
                "image_count": 1,
                "part_count": 1,
            },
            "nodes": [
                {
                    "id": "input",
                    "method_id": "source.project_part_images",
                    "parameters": {},
                },
                {
                    "id": "model",
                    "method_id": method_id,
                    "parameters": parameters or {},
                },
                {
                    "id": "output",
                    "method_id": "output.versioned_image_artifact",
                    "parameters": {"mode": "overlay_artifact"},
                },
            ],
            "edges": [
                {"source_node": "input", "target_node": "model"},
                {"source_node": "model", "target_node": "output"},
            ],
        },
        "images": [
            {
                "image_id": image_id,
                "filename": "service-smoke.png",
                "content_type": "image/png",
                "data_base64": _png_base64(),
                "metadata": {"source": "model-service-test"},
            }
        ],
    }


def _live_service_url():
    return os.environ.get("VISTA_TOOLBOX_MODEL_SERVICE_URL", "").rstrip("/")


def _get_live(path):
    live_url = _live_service_url()
    if not live_url:
        pytest.skip(
            "Set VISTA_TOOLBOX_MODEL_SERVICE_URL to run live model-service container tests"
        )
    return requests.get(f"{live_url}{path}", timeout=20)


def _post_live(path, payload):
    live_url = _live_service_url()
    if not live_url:
        pytest.skip(
            "Set VISTA_TOOLBOX_MODEL_SERVICE_URL to run live model-service container tests"
        )
    return requests.post(f"{live_url}{path}", json=payload, timeout=60)


def _assert_manifest_payload(payload):
    method_ids = {method["id"] for method in payload["methods"]}
    assert "segmentation.yolo.placeholder" in method_ids
    assert "segmentation.anomalib.placeholder" in method_ids
    assert "segmentation.sam.placeholder" in method_ids
    assert "segmentation.opencv.placeholder" in method_ids


def test_backend_analyze_toolbox_model_service_handlers_expose_health_manifest_and_execution(
    monkeypatch,
):
    from backend.utils.segmentation_integrations import yolo_backend

    class FakeYOLOInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class FakeYOLO:
        def __init__(self, **config):
            self.config = config

        def run(self, data):
            return type(
                "Output",
                (),
                {
                    "mode": "predict",
                    "metadata": {
                        "backend": "YOLO",
                        "masks": [
                            {
                                "bbox": [2.25, 2.25, 1.5, 1.5],
                                "area": 2.25,
                                "score": 0.75,
                                "label": "object",
                            }
                        ],
                    },
                },
            )()

    monkeypatch.setattr(
        yolo_backend, "_load_yolo_runtime", lambda: (FakeYOLO, FakeYOLOInput)
    )

    health_payload = health()
    assert health_payload["service"] == "backend-analyze-toolbox-models"
    assert "accelerator" in health_payload
    assert "selected_device" in health_payload["accelerator"]
    _assert_manifest_payload(manifest().model_dump(mode="json"))

    result = execute_workflow(
        WorkflowExecutionPayload.model_validate(_workflow_payload())
    )
    payload = result.model_dump(mode="json")
    assert payload["status"] == "completed"
    model_node = next(
        node for node in payload["node_results"] if node["node_id"] == "model"
    )
    assert model_node["status"] == "completed"
    assert model_node["summary"]["runtime"] == "local"
    assert model_node["summary"]["mask_count"] == 1
    assert model_node["summary"]["detections"][0]["bbox"] == {
        "x": 2.25,
        "y": 2.25,
        "width": 1.5,
        "height": 1.5,
    }
    output_node = next(
        node for node in payload["node_results"] if node["node_id"] == "output"
    )
    assert output_node["status"] == "completed"
    assert output_node["summary"]["artifact_count"] == 2
    assert any(
        artifact["kind"] == "overlay_image" for artifact in output_node["artifacts"]
    )


def test_live_toolbox_model_service_health_and_manifest():
    health_response = _get_live("/health")
    assert health_response.status_code == 200, health_response.text
    health_payload = health_response.json()
    assert health_payload["service"] == "backend-analyze-toolbox-models"
    assert "selected_device" in health_payload["accelerator"]

    runtime_response = _get_live("/runtime")
    assert runtime_response.status_code == 200, runtime_response.text
    runtime_payload = runtime_response.json()
    assert "cuda_available" in runtime_payload
    assert "cuda_device_count" in runtime_payload

    manifest_response = _get_live("/manifest")
    assert manifest_response.status_code == 200, manifest_response.text
    _assert_manifest_payload(manifest_response.json())


def _assert_live_segmentation_overlay(payload, *, backend, metrics_runtime):
    assert payload["status"] == "completed"
    assert payload["execution_mode"] == "execution"
    model_node = next(
        node for node in payload["node_results"] if node["node_id"] == "model"
    )
    assert model_node["status"] == "completed"
    assert model_node["summary"]["backend"] == backend
    assert model_node["summary"]["metrics"]["runtime"] == metrics_runtime
    assert model_node["summary"]["mask_count"] == 1
    output_node = next(
        node for node in payload["node_results"] if node["node_id"] == "output"
    )
    assert output_node["status"] == "completed"
    assert output_node["summary"]["artifact_count"] == 2
    overlay = next(
        artifact
        for artifact in output_node["artifacts"]
        if artifact["kind"] == "overlay_image"
    )
    assert overlay["content_type"] == "image/png"
    assert overlay["data_base64"]


def test_live_toolbox_model_service_executes_yolo_workflow_with_overlay():
    response = _post_live("/workflows/execute", _workflow_payload())
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    model_node = next(
        node for node in payload["node_results"] if node["node_id"] == "model"
    )
    assert model_node["status"] == "completed"
    assert model_node["summary"]["backend"] == "yolo"
    assert model_node["summary"]["metrics"]["runtime"] in {
        "analysis_toolkit.yolo",
        "analysis_toolkit.yolo_fallback",
    }
    assert model_node["summary"]["mask_count"] == 1


def test_live_toolbox_model_service_executes_opencv_workflow_with_overlay():
    response = _post_live(
        "/workflows/execute",
        _workflow_payload(
            method_id="segmentation.opencv.placeholder",
            parameters={"options": {"min_peak_distance_px": 1}},
        ),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    _assert_live_segmentation_overlay(
        payload, backend="opencv", metrics_runtime="analysis_toolkit.opencv"
    )
    model_node = next(
        node for node in payload["node_results"] if node["node_id"] == "model"
    )
    assert model_node["summary"]["mode"] == "watershed"


def test_live_toolbox_model_service_executes_sam_workflow_with_overlay():
    response = _post_live(
        "/workflows/execute",
        _workflow_payload(
            method_id="segmentation.sam.placeholder",
            parameters={"prompts": {"box": [2, 1, 5, 5]}},
        ),
    )
    assert response.status_code == 200, response.text
    _assert_live_segmentation_overlay(
        response.json(),
        backend="sam",
        metrics_runtime="analysis_toolkit.sam_fallback",
    )
