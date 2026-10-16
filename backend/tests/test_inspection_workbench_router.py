import asyncio
import base64
import io
import json
import math
import uuid
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image, ImageDraw
from sqlalchemy import text

from tests.conftest import engine
from utils.dependencies import ARCHIVED_PROJECT_DETAIL


@pytest.mark.smoke
def test_batches_and_parts_support_three_simulated_users_with_progressive_workflows(
    client,
):
    """
    Simulate three progressively complex PT2 workflows, while type-specific tests
    cover PT1/PT2/PT3 branching elsewhere in this module.
    """
    project_type = "PT2"
    scenarios = [
        {
            "email": f"basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-ops-basic",
            "project_name": f"{project_type} basic project",
            "batches": [{"name": "batch-basic", "description": "single intake batch"}],
            "parts": [
                {
                    "serial_number": f"{project_type}-BASIC-0001",
                    "display_name": "basic-part",
                    "metadata": {"angle": "front", "synthetic_level": 1},
                }
            ],
        },
        {
            "email": f"intermediate-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-ops-intermediate",
            "project_name": f"{project_type} intermediate project",
            "batches": [
                {"name": "batch-incoming", "description": "incoming line"},
                {"name": "batch-recheck", "description": "follow-up checks"},
            ],
            "parts": [
                {
                    "serial_number": f"{project_type}-MID-0101",
                    "display_name": "mid-front",
                    "metadata": {
                        "angle": "front",
                        "synthetic_level": 2,
                        "defect_hint": "scratch",
                    },
                },
                {
                    "serial_number": f"{project_type}-MID-0102",
                    "display_name": "mid-back",
                    "metadata": {
                        "angle": "back",
                        "synthetic_level": 2,
                        "checkpoint": "qa-pass-1",
                    },
                },
            ],
        },
        {
            "email": f"advanced-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-ops-advanced",
            "project_name": f"{project_type} advanced project",
            "batches": [
                {"name": "batch-stress-a", "description": "high-volume synthetic set"},
                {"name": "batch-stress-b", "description": "adversarial synthetic set"},
            ],
            "parts": [
                {
                    "serial_number": f"{project_type}-ADV-9001",
                    "display_name": "adv-left",
                    "metadata": {
                        "angle": "left",
                        "synthetic_level": 3,
                        "nested": {"severity": "high"},
                    },
                },
                {
                    "serial_number": f"{project_type}-ADV-9002",
                    "display_name": "adv-right",
                    "metadata": {
                        "angle": "right",
                        "synthetic_level": 3,
                        "workflow_stage": "triage",
                    },
                },
                {
                    "serial_number": f"{project_type}-ADV-9003",
                    "display_name": "adv-top",
                    "metadata": {
                        "angle": "top",
                        "synthetic_level": 3,
                        "workflow_stage": "review",
                    },
                },
            ],
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f'["{scenario["group"]}"]',
        }

        project_payload = {
            "name": scenario["project_name"],
            "description": "inspection workbench synthetic workflow",
            "meta_group_id": scenario["group"],
            "project_type": project_type,
        }
        project_resp = client.post(
            "/api/projects/", json=project_payload, headers=headers
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        created_batches = []
        for batch_payload in scenario["batches"]:
            batch_resp = client.post(
                f"/api/projects/{project_id}/batches",
                json=batch_payload,
                headers=headers,
            )
            assert batch_resp.status_code == 201, batch_resp.text
            created_batches.append(batch_resp.json())

        list_batches_resp = client.get(
            f"/api/projects/{project_id}/batches", headers=headers
        )
        assert list_batches_resp.status_code == 200
        assert len(list_batches_resp.json()) == len(scenario["batches"])

        first_batch_id = created_batches[0]["id"]
        for idx, part_payload in enumerate(scenario["parts"]):
            payload = {
                **part_payload,
                "batch_id": first_batch_id,
                "review_state": "in_review" if idx else "unreviewed",
            }
            part_resp = client.post(
                f"/api/projects/{project_id}/parts",
                json=payload,
                headers=headers,
            )
            assert part_resp.status_code == 201, part_resp.text
            assert part_resp.json()["serial_number"] == part_payload["serial_number"]
            assert part_resp.json()["batch_id"] == first_batch_id

        list_parts_resp = client.get(
            f"/api/projects/{project_id}/parts", headers=headers
        )
        assert list_parts_resp.status_code == 200
        assert len(list_parts_resp.json()) == len(scenario["parts"])

        filtered_parts_resp = client.get(
            f"/api/projects/{project_id}/parts?batch_id={first_batch_id}",
            headers=headers,
        )
        assert filtered_parts_resp.status_code == 200
        assert len(filtered_parts_resp.json()) == len(scenario["parts"])


def test_create_part_rejects_batch_from_other_project(client):
    headers = {
        "X-User-Id": "cross-project@example.com",
        "X-User-Groups": '["cross-group"]',
    }

    project_payload = {
        "name": "Cross project parent",
        "description": "parent",
        "meta_group_id": "cross-group",
        "project_type": "PT1",
    }
    project_a = client.post("/api/projects/", json=project_payload, headers=headers)
    assert project_a.status_code == 201

    project_payload["name"] = "Cross project child"
    project_b = client.post("/api/projects/", json=project_payload, headers=headers)
    assert project_b.status_code == 201

    batch_resp = client.post(
        f"/api/projects/{project_a.json()['id']}/batches",
        json={"name": "batch-a", "description": "owned by project A"},
        headers=headers,
    )
    assert batch_resp.status_code == 201

    part_resp = client.post(
        f"/api/projects/{project_b.json()['id']}/parts",
        json={
            "serial_number": "PT1-CROSS-0001",
            "display_name": "invalid-link",
            "batch_id": batch_resp.json()["id"],
        },
        headers=headers,
    )
    assert part_resp.status_code == 400
    assert "does not belong" in part_resp.json()["detail"]


def test_batches_support_owner_status_and_part_manual_assignment(client):
    headers = {
        "X-User-Id": "batch-editor@example.com",
        "X-User-Groups": '["batch-editor-group"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Batch metadata project",
            "description": "batch metadata",
            "meta_group_id": "batch-editor-group",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201
    project_id = project_resp.json()["id"]

    batch_resp = client.post(
        f"/api/projects/{project_id}/batches",
        json={"name": "Batch A", "description": "initial"},
        headers=headers,
    )
    assert batch_resp.status_code == 201
    batch_id = batch_resp.json()["id"]

    patch_batch_resp = client.patch(
        f"/api/projects/{project_id}/batches/{batch_id}",
        json={"owner": "alice", "status": "in_progress"},
        headers=headers,
    )
    assert patch_batch_resp.status_code == 200
    assert patch_batch_resp.json()["owner"] == "alice"
    assert patch_batch_resp.json()["status"] == "in_progress"

    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "PT1-BATCH-1", "display_name": "Part 1"},
        headers=headers,
    )
    assert part_resp.status_code == 201
    part_id = part_resp.json()["id"]

    assign_resp = client.post(
        f"/api/projects/{project_id}/parts/batch-assignments",
        json={"part_id": part_id, "to_batch_id": batch_id},
        headers=headers,
    )
    assert assign_resp.status_code == 200
    assert assign_resp.json()["to_batch_id"] == batch_id

    foreign_batch_resp = client.post(
        f"/api/projects/{project_id}/parts/batch-assignments",
        json={"part_id": part_id, "to_batch_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert foreign_batch_resp.status_code == 400
    assert foreign_batch_resp.json()["detail"] == (
        "to_batch_id does not belong to this project"
    )
    missing_part_resp = client.post(
        f"/api/projects/{project_id}/parts/batch-assignments",
        json={"part_id": str(uuid.uuid4()), "to_batch_id": None},
        headers=headers,
    )
    assert missing_part_resp.status_code == 404
    assert missing_part_resp.json()["detail"] == "Inspection part not found"

    manual_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/manual-flag",
        json={"manual_flagged": True},
        headers=headers,
    )
    assert manual_resp.status_code == 200
    assert manual_resp.json()["metadata"]["manual_flagged"] is True


def test_part_review_workflow_supports_three_simulated_users_with_progressive_data(
    client,
):
    project_type = "PT2"
    scenarios = [
        {
            "email": f"review-basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-review-basic",
            "parts": [
                {"serial_number": f"{project_type}-RB-0001", "display_name": "rb-1"}
            ],
            "target_state": "in_review",
        },
        {
            "email": f"review-intermediate-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-review-intermediate",
            "parts": [
                {"serial_number": f"{project_type}-RI-0101", "display_name": "ri-1"},
                {"serial_number": f"{project_type}-RI-0102", "display_name": "ri-2"},
            ],
            "target_state": "reject_pending",
        },
        {
            "email": f"review-advanced-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-review-advanced",
            "parts": [
                {"serial_number": f"{project_type}-RA-9001", "display_name": "ra-1"},
                {"serial_number": f"{project_type}-RA-9002", "display_name": "ra-2"},
                {"serial_number": f"{project_type}-RA-9003", "display_name": "ra-3"},
            ],
            "target_state": "pass",
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f'["{scenario["group"]}"]',
        }
        project_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} review workflow {scenario['group']}",
                "description": "workflow project",
                "meta_group_id": scenario["group"],
                "project_type": project_type,
            },
            headers=headers,
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        batch_resp = client.post(
            f"/api/projects/{project_id}/batches",
            json={"name": "review-batch", "description": "review batch"},
            headers=headers,
        )
        assert batch_resp.status_code == 201
        batch_id = batch_resp.json()["id"]

        created_parts = []
        for part in scenario["parts"]:
            part_resp = client.post(
                f"/api/projects/{project_id}/parts",
                json={**part, "batch_id": batch_id, "review_state": "unreviewed"},
                headers=headers,
            )
            assert part_resp.status_code == 201, part_resp.text
            created_parts.append(part_resp.json())

        target_part = created_parts[-1]
        update_resp = client.patch(
            f"/api/projects/{project_id}/parts/{target_part['id']}",
            json={"review_state": scenario["target_state"]},
            headers=headers,
        )
        assert update_resp.status_code == 200, update_resp.text
        assert update_resp.json()["review_state"] == scenario["target_state"]

        filtered_resp = client.get(
            f"/api/projects/{project_id}/parts?review_state={scenario['target_state']}",
            headers=headers,
        )
        assert filtered_resp.status_code == 200
        filtered = filtered_resp.json()
        assert len(filtered) == 1
        assert filtered[0]["id"] == target_part["id"]


def test_segmentation_and_measurement_invocation_supports_progressive_users(client):
    project_type = "PT2"
    scenarios = [
        {
            "email": f"ml-basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-ml-basic",
            "synthetic_level": 1,
        },
        {
            "email": f"ml-intermediate-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-ml-intermediate",
            "synthetic_level": 2,
        },
        {
            "email": f"ml-advanced-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-ml-advanced",
            "synthetic_level": 3,
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f'["{scenario["group"]}"]',
        }
        project_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} ml workflow {scenario['group']}",
                "description": "ml invocation workflow",
                "meta_group_id": scenario["group"],
                "project_type": project_type,
            },
            headers=headers,
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        batch_resp = client.post(
            f"/api/projects/{project_id}/batches",
            json={"name": "ml-batch", "description": "ml test batch"},
            headers=headers,
        )
        assert batch_resp.status_code == 201, batch_resp.text

        part_resp = client.post(
            f"/api/projects/{project_id}/parts",
            json={
                "serial_number": f"{project_type}-ML-{scenario['synthetic_level']}",
                "display_name": f"ml-part-{scenario['synthetic_level']}",
                "batch_id": batch_resp.json()["id"],
                "metadata": {"synthetic_level": scenario["synthetic_level"]},
            },
            headers=headers,
        )
        assert part_resp.status_code == 201, part_resp.text
        part_id = part_resp.json()["id"]

        segmentation_resp = client.post(
            f"/api/projects/{project_id}/parts/{part_id}/segmentation-runs",
            json={"axis": "axial", "slice_index": scenario["synthetic_level"]},
            headers=headers,
        )
        assert segmentation_resp.status_code == 202, segmentation_resp.text
        segmentation = segmentation_resp.json()
        assert segmentation["status"] == "completed"
        assert segmentation["axis"] == "axial"
        assert (
            segmentation["overlay_id"]
            == f"segmentation-axial-{scenario['synthetic_level']}"
        )

        measurement_resp = client.post(
            f"/api/projects/{project_id}/parts/{part_id}/measurement-runs",
            json={
                "measurement_profile": "workbench-default",
                "include_overlays": [segmentation["overlay_id"]],
            },
            headers=headers,
        )
        assert measurement_resp.status_code == 202, measurement_resp.text
        measurement = measurement_resp.json()
        assert measurement["status"] == "completed"
        assert measurement["measurement_profile"] == "workbench-default"
        assert measurement["units"] == "mm"
        assert measurement["values"]["crack_length_mm"] > 0

        listed_parts = client.get(f"/api/projects/{project_id}/parts", headers=headers)
        assert listed_parts.status_code == 200, listed_parts.text
        persisted_part = listed_parts.json()[0]
        assert len(persisted_part["metadata"]["segmentation_runs"]) == 1
        assert len(persisted_part["metadata"]["measurement_runs"]) == 1


def test_slice_segmentation_selects_clicked_toolbox_region(client):
    headers = {
        "X-User-Id": "slice-helper@example.com",
        "X-User-Groups": '["slice-helper-group"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT3 slice helper",
            "description": "slice helper toolbox workflow",
            "meta_group_id": "slice-helper-group",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    batch_resp = client.post(
        f"/api/projects/{project_id}/batches",
        json={"name": "slice-batch"},
        headers=headers,
    )
    assert batch_resp.status_code == 201, batch_resp.text
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "PT3-SLICE-1",
            "display_name": "slice-part",
            "batch_id": batch_resp.json()["id"],
            "metadata": {"volume_shape": {"axial": 16, "coronal": 64, "sagittal": 64}},
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    image = Image.new("L", (64, 64), 0)
    draw = ImageDraw.Draw(image)
    draw.rectangle([8, 8, 24, 24], fill=255)
    draw.rectangle([38, 38, 55, 55], fill=255)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    response = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/slice-segmentation",
        json={
            "axis": "axial",
            "slice_index": 4,
            "method_id": "segmentation.opencv.placeholder",
            "parameters": {"integration_mode": "placeholder"},
            "image_data_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "filename": "slice-z-004.png",
            "click_x": 44,
            "click_y": 44,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["method_id"] == "segmentation.opencv.placeholder"
    assert payload["summary"]["region_count"] == 2
    assert len(payload["regions"]) == 2
    assert payload["selected_region"]["bbox"] == [38.0, 38.0, 56.0, 56.0]
    assert payload["selected_region"]["area_px"] == 289.0
    assert payload["selected_region"]["class_name"] == "region_2"


def _create_slice_segmentation_project(client, name):
    project_id, headers = _create_project_for_part_image_tests(client, name)
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SLICE-ERROR-1", "metadata": {"sentinel": True}},
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    return project_id, part_resp.json()["id"], headers


@pytest.mark.parametrize(
    ("path_suffix", "body"),
    [
        ("segmentation-runs", {"axis": "axial", "slice_index": 1}),
        ("measurement-runs", {"measurement_profile": "workbench-default"}),
        (
            "slice-segmentation",
            {
                "method_id": "segmentation.opencv.placeholder",
                "image_data_base64": "aGVsbG8=",
                "click_x": 1,
                "click_y": 1,
            },
        ),
    ],
)
def test_segmentation_and_measurement_endpoints_reject_missing_part(
    client, path_suffix, body
):
    project_id, _part_id, headers = _create_slice_segmentation_project(
        client, f"Missing part {path_suffix}"
    )
    missing_part_id = str(uuid.uuid4())

    response = client.post(
        f"/api/projects/{project_id}/parts/{missing_part_id}/{path_suffix}",
        json=body,
        headers=headers,
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Inspection part not found"


def test_slice_segmentation_rejects_unsupported_method_without_mutation(client):
    project_id, part_id, headers = _create_slice_segmentation_project(
        client, "Unsupported slice segmentation method"
    )

    response = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/slice-segmentation",
        json={
            "method_id": "segmentation.unknown.method",
            "image_data_base64": "aGVsbG8=",
            "click_x": 1,
            "click_y": 1,
        },
        headers=headers,
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Unsupported slice segmentation method"
    listed = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["metadata"] == {"sentinel": True}


@pytest.mark.parametrize(
    ("image_data", "raised", "expected_status", "expected_detail"),
    [
        ("not base64!", None, 400, "Invalid slice image payload"),
        ("aGVsbG8=", ValueError("bad slice"), 400, "bad slice"),
        (
            "aGVsbG8=",
            RuntimeError("boom"),
            500,
            "Slice segmentation failed: boom",
        ),
    ],
)
def test_slice_segmentation_translates_decode_and_workflow_errors(
    client, monkeypatch, image_data, raised, expected_status, expected_detail
):
    from services.inspection import measurements as inspection_measurement_service

    def fake_execute_image_workflow(workflow, images):
        raise raised

    monkeypatch.setattr(
        inspection_measurement_service,
        "execute_image_workflow",
        fake_execute_image_workflow,
    )
    project_id, part_id, headers = _create_slice_segmentation_project(
        client, f"Slice segmentation error {expected_status}"
    )

    response = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/slice-segmentation",
        json={
            "method_id": "segmentation.opencv.placeholder",
            "image_data_base64": image_data,
            "click_x": 1,
            "click_y": 1,
        },
        headers=headers,
    )

    assert response.status_code == expected_status, response.text
    assert response.json()["detail"] == expected_detail


@pytest.mark.parametrize(
    ("method_id", "runtime"),
    [
        ("segmentation.yolo.placeholder", "analysis_toolkit.yolo"),
        ("segmentation.anomalib.placeholder", "analysis_toolkit.anomalib"),
    ],
)
def test_slice_segmentation_endpoint_sends_sample_image_to_toolkit_analysis(
    client, monkeypatch, method_id, runtime
):
    from backend.utils.segmentation_integrations import anomalib_backend, yolo_backend

    headers = {
        "X-User-Id": "slice-toolkit@example.com",
        "X-User-Groups": '["slice-toolkit-group"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT3 toolkit slice helper",
            "description": "slice helper toolkit workflow",
            "meta_group_id": "slice-toolkit-group",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "PT3-TOOLKIT-1",
            "display_name": "toolkit-part",
            "metadata": {},
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    calls = {}

    class FakeInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class FakeRuntime:
        def __init__(self, **config):
            calls["config"] = config

        def run(self, data):
            calls["data"] = data
            return type(
                "Output",
                (),
                {
                    "mode": "predict"
                    if method_id.endswith("yolo.placeholder")
                    else "inference",
                    "metadata": {
                        "masks": [
                            {
                                "bbox": [20, 15, 26, 26],
                                "area": 676,
                                "score": 0.8,
                                "label": "toolkit-region",
                            }
                        ],
                    },
                },
            )()

    if method_id.endswith("yolo.placeholder"):
        monkeypatch.setattr(
            yolo_backend, "_load_yolo_runtime", lambda: (FakeRuntime, FakeInput)
        )
    else:
        monkeypatch.setattr(
            anomalib_backend, "_load_anomalib_runtime", lambda: (FakeRuntime, FakeInput)
        )

    image = Image.new("L", (80, 60), 0)
    draw = ImageDraw.Draw(image)
    draw.rectangle([20, 15, 45, 40], fill=255)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    response = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/slice-segmentation",
        json={
            "axis": "axial",
            "slice_index": 2,
            "method_id": method_id,
            "parameters": {"integration_mode": "placeholder"},
            "image_data_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "filename": "slice-z-002.png",
            "click_x": 30,
            "click_y": 30,
        },
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["method_id"] == method_id
    assert payload["summary"]["metrics"]["runtime"] == runtime
    assert payload["selected_region"]["bbox"] == [20.0, 15.0, 46.0, 41.0]
    assert payload["selected_region"]["class_name"] == "toolkit-region"
    assert calls["data"].mode == "default"


def test_workspace_state_persistence_supports_progressive_users(client):
    project_type = "PT2"
    scenarios = [
        {
            "email": f"workspace-basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-workspace-basic",
            "state": {
                "selected_batch_id": "batch-basic",
                "defect_filter": "all",
                "sort_mode": "defect_desc",
                "inspector": {
                    "shortcut_help_visible": False,
                    "normalization_triage_field": "",
                    "image_enabled": True,
                    "modalities": ["visual"],
                    "view_name": "front",
                    "viewport_transform": {"zoom": 1.2, "panX": 14, "panY": -10},
                    "measurements": [
                        {"id": "basic-length", "label": "Length", "value": "12.6"},
                    ],
                },
                "panel_layout": {
                    "part_list": {
                        "is_open": True,
                        "width_px": 310,
                        "height_px": 420,
                        "orientation": "vertical",
                    },
                    "inspector": {
                        "is_open": True,
                        "width_px": 355,
                        "height_px": 420,
                        "orientation": "horizontal",
                    },
                    "mpr_controls": {
                        "is_open": False,
                        "width_px": 330,
                        "height_px": 350,
                        "orientation": "vertical",
                    },
                },
            },
        },
        {
            "email": f"workspace-intermediate-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-workspace-intermediate",
            "state": {
                "selected_batch_id": "batch-mid-a",
                "defect_filter": "has_defects",
                "sort_mode": "serial_asc",
                "selected_part_id": "part-mid-1",
                "inspector": {
                    "shortcut_help_visible": True,
                    "normalization_triage_field": "segmentation_runs",
                    "image_enabled": False,
                    "modalities": ["infrared", "uv"],
                    "view_name": "left",
                    "viewport_transform": {"zoom": 2.6, "panX": -40, "panY": 85},
                    "measurements": [
                        {"id": "mid-length", "label": "Crack length", "value": 10.2},
                        {"id": "mid-area", "label": "Pore area", "value": "1.8"},
                    ],
                },
                "panel_layout": {
                    "part_list": {
                        "is_open": True,
                        "width_px": 360,
                        "height_px": 500,
                        "orientation": "vertical",
                    },
                    "inspector": {
                        "is_open": False,
                        "width_px": 420,
                        "height_px": 510,
                        "orientation": "horizontal",
                    },
                    "mpr_controls": {
                        "is_open": True,
                        "width_px": 400,
                        "height_px": 380,
                        "orientation": "horizontal",
                    },
                },
            },
            "expected_measurements": [
                {"id": "mid-length", "label": "Crack length", "value": "10.2"},
                {"id": "mid-area", "label": "Pore area", "value": "1.8"},
            ],
        },
        {
            "email": f"workspace-advanced-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-workspace-advanced",
            "state": {
                "selected_batch_id": "batch-adv-a",
                "defect_filter": "critical_only",
                "sort_mode": "defect_desc",
                "selected_part_id": "part-adv-1",
                "mpr": {
                    "slice_position": {"axial": 9, "coronal": 7, "sagittal": 5},
                    "viewport_transform": {"zoom": 1.3, "panX": 12, "panY": -8},
                    "contrast_percent": 112,
                    "active_overlay_ids": ["segmentation", "porosity"],
                    "cursor_probe": {"x": 67, "y": 42},
                },
                "inspector": {
                    "shortcut_help_visible": "yes",
                    "normalization_triage_field": 42,
                    "image_enabled": "no",
                    "modalities": "not-a-list",
                    "view_name": 99,
                    "viewport_transform": {"zoom": "fast", "panX": 999, "panY": -999},
                    "measurements": [
                        {"id": "adv-invalid-empty", "label": "  ", "value": "4.5"},
                        {"id": "adv-invalid-missing", "label": "Depth"},
                        "not-a-measurement-object",
                    ],
                },
                "panel_layout": {
                    "part_list": {
                        "is_open": "yes",
                        "width_px": -15,
                        "height_px": 9999,
                        "orientation": "diagonal",
                    },
                    "inspector": {
                        "is_open": True,
                        "width_px": 260,
                        "height_px": 460,
                        "orientation": "vertical",
                    },
                    "mpr_controls": {
                        "is_open": True,
                        "width_px": "400",
                        "height_px": "420",
                        "orientation": "horizontal",
                    },
                },
            },
            "expected_panel_layout": {
                "part_list": {
                    "is_open": True,
                    "width_px": 220,
                    "height_px": 1400,
                    "orientation": "vertical",
                },
                "inspector": {
                    "is_open": True,
                    "width_px": 260,
                    "height_px": 460,
                    "orientation": "vertical",
                },
                "mpr_controls": {
                    "is_open": True,
                    "width_px": 400,
                    "height_px": 420,
                    "orientation": "horizontal",
                },
            },
            "expected_shortcut_help_visible": False,
            "expected_normalization_triage_field": "",
            "expected_image_enabled": True,
            "expected_modalities": [],
            "expected_view_name": "",
            "expected_viewport_transform": {"zoom": 1.0, "panX": 200, "panY": -200},
            "expected_measurements": [],
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f'["{scenario["group"]}"]',
        }
        project_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} workspace {scenario['group']}",
                "description": "workspace persistence workflow",
                "meta_group_id": scenario["group"],
                "project_type": project_type,
            },
            headers=headers,
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        initial_resp = client.get(
            f"/api/projects/{project_id}/workspace-state", headers=headers
        )
        assert initial_resp.status_code == 200, initial_resp.text
        assert initial_resp.json()["state"]["panel_layout"] == {
            "part_list": {
                "is_open": True,
                "width_px": 320,
                "height_px": 420,
                "orientation": "vertical",
            },
            "inspector": {
                "is_open": True,
                "width_px": 360,
                "height_px": 420,
                "orientation": "vertical",
            },
            "mpr_controls": {
                "is_open": True,
                "width_px": 360,
                "height_px": 360,
                "orientation": "vertical",
            },
        }

        save_resp = client.put(
            f"/api/projects/{project_id}/workspace-state",
            json={"state": scenario["state"]},
            headers=headers,
        )
        assert save_resp.status_code == 200, save_resp.text
        expected_panel_layout = scenario.get(
            "expected_panel_layout", scenario["state"]["panel_layout"]
        )
        assert save_resp.json()["state"]["panel_layout"] == expected_panel_layout
        expected_shortcut_help_visible = scenario.get(
            "expected_shortcut_help_visible",
            scenario["state"].get("inspector", {}).get("shortcut_help_visible"),
        )
        expected_normalization_triage_field = scenario.get(
            "expected_normalization_triage_field",
            scenario["state"]
            .get("inspector", {})
            .get("normalization_triage_field", ""),
        )
        expected_image_enabled = scenario.get(
            "expected_image_enabled",
            scenario["state"].get("inspector", {}).get("image_enabled", True),
        )
        assert (
            save_resp.json()["state"]["inspector"]["shortcut_help_visible"]
            == expected_shortcut_help_visible
        )
        assert (
            save_resp.json()["state"]["inspector"]["normalization_triage_field"]
            == expected_normalization_triage_field
        )
        assert (
            save_resp.json()["state"]["inspector"]["image_enabled"]
            == expected_image_enabled
        )
        expected_modalities = scenario.get(
            "expected_modalities",
            scenario["state"].get("inspector", {}).get("modalities", []),
        )
        expected_view_name = scenario.get(
            "expected_view_name",
            scenario["state"].get("inspector", {}).get("view_name", ""),
        )
        expected_viewport_transform = scenario.get(
            "expected_viewport_transform",
            scenario["state"]
            .get("inspector", {})
            .get("viewport_transform", {"zoom": 1.0, "panX": 0, "panY": 0}),
        )
        assert (
            save_resp.json()["state"]["inspector"]["modalities"] == expected_modalities
        )
        assert save_resp.json()["state"]["inspector"]["view_name"] == expected_view_name
        assert (
            save_resp.json()["state"]["inspector"]["viewport_transform"]
            == expected_viewport_transform
        )
        expected_measurements = scenario.get(
            "expected_measurements",
            scenario["state"].get("inspector", {}).get("measurements", []),
        )
        assert (
            save_resp.json()["state"]["inspector"]["measurements"]
            == expected_measurements
        )

        reload_resp = client.get(
            f"/api/projects/{project_id}/workspace-state", headers=headers
        )
        assert reload_resp.status_code == 200, reload_resp.text
        assert reload_resp.json()["state"]["panel_layout"] == expected_panel_layout
        assert (
            reload_resp.json()["state"]["inspector"]["shortcut_help_visible"]
            == expected_shortcut_help_visible
        )
        assert (
            reload_resp.json()["state"]["inspector"]["normalization_triage_field"]
            == expected_normalization_triage_field
        )
        assert (
            reload_resp.json()["state"]["inspector"]["image_enabled"]
            == expected_image_enabled
        )
        assert (
            reload_resp.json()["state"]["inspector"]["modalities"]
            == expected_modalities
        )
        assert (
            reload_resp.json()["state"]["inspector"]["view_name"] == expected_view_name
        )
        assert (
            reload_resp.json()["state"]["inspector"]["viewport_transform"]
            == expected_viewport_transform
        )
        assert (
            reload_resp.json()["state"]["inspector"]["measurements"]
            == expected_measurements
        )

        update_payload = {**scenario["state"], "sort_mode": "serial_asc"}
        overwrite_resp = client.put(
            f"/api/projects/{project_id}/workspace-state",
            json={"state": update_payload},
            headers=headers,
        )
        assert overwrite_resp.status_code == 200, overwrite_resp.text
        assert overwrite_resp.json()["state"]["sort_mode"] == "serial_asc"
        assert overwrite_resp.json()["state"]["panel_layout"] == expected_panel_layout


def test_part_annotations_support_progressive_users_with_audit_trail(client):
    project_type = "PT2"
    scenarios = [
        {
            "email": f"annot-basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-annot-basic",
            "part_suffix": "001",
            "annotation": {
                "defect_class": "scratch",
                "modality": "visual",
                "comment": "baseline visible scratch",
                "disposition": "open",
                "measurements": {"length_mm": 3.2},
                "bbox": {"x": 10.0, "y": 14.0, "width": 22.0, "height": 8.0},
            },
        },
        {
            "email": f"annot-intermediate-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-annot-intermediate",
            "part_suffix": "010",
            "annotation": {
                "defect_class": "void_cluster",
                "modality": "infrared",
                "comment": "cluster detected in two adjacent regions",
                "disposition": "needs_info",
                "measurements": {"area_mm2": 5.5, "diameter_mm": 2.1},
                "bbox": {"x": 20.0, "y": 26.0, "width": 35.0, "height": 16.0},
            },
        },
        {
            "email": f"annot-advanced-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-annot-advanced",
            "part_suffix": "900",
            "annotation": {
                "defect_class": "delamination",
                "modality": "uv",
                "comment": "multi-zone delamination requiring disposition update",
                "disposition": "open",
                "measurements": {"length_mm": 19.4, "depth_mm": 1.8, "area_mm2": 22.0},
                "bbox": {"x": 45.0, "y": 52.0, "width": 60.0, "height": 24.0},
            },
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f'["{scenario["group"]}"]',
        }
        project_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} annotation workflow {scenario['group']}",
                "description": "annotation + audit metadata workflow",
                "meta_group_id": scenario["group"],
                "project_type": project_type,
            },
            headers=headers,
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        batch_resp = client.post(
            f"/api/projects/{project_id}/batches",
            json={"name": "annotation-batch", "description": "annotation test batch"},
            headers=headers,
        )
        assert batch_resp.status_code == 201, batch_resp.text

        part_resp = client.post(
            f"/api/projects/{project_id}/parts",
            json={
                "serial_number": f"{project_type}-ANNOT-{scenario['part_suffix']}",
                "display_name": f"annot-part-{scenario['part_suffix']}",
                "batch_id": batch_resp.json()["id"],
            },
            headers=headers,
        )
        assert part_resp.status_code == 201, part_resp.text
        part_id = part_resp.json()["id"]
        annotation_payload = {
            **scenario["annotation"],
            "image_id": f"{project_type.lower()}-measurement-image-{scenario['part_suffix']}",
            "geometry": {
                "line": {
                    "x1": 10.0,
                    "y1": 12.0,
                    "x2": 42.0,
                    "y2": 48.0,
                    "imageWidth": 100.0,
                    "imageHeight": 80.0,
                }
            },
            "metadata": {"measurement_color": "#3b82f6"},
        }

        create_resp = client.post(
            f"/api/projects/{project_id}/parts/{part_id}/annotations",
            json=annotation_payload,
            headers=headers,
        )
        assert create_resp.status_code == 201, create_resp.text
        created_annotation = create_resp.json()
        assert (
            created_annotation["defect_class"] == scenario["annotation"]["defect_class"]
        )
        assert created_annotation["modality"] == scenario["annotation"]["modality"]
        assert created_annotation["image_id"] == annotation_payload["image_id"]
        assert created_annotation["geometry"] == annotation_payload["geometry"]
        assert created_annotation["metadata"]["measurement_color"] == "#3b82f6"
        assert created_annotation["hidden"] is False
        assert isinstance(created_annotation["created_by"], str)
        assert "@" in created_annotation["created_by"]
        assert created_annotation["updated_by"] == created_annotation["created_by"]
        assert created_annotation["created_at"]
        assert created_annotation["updated_at"]

        annotation_id = created_annotation["id"]
        update_resp = client.patch(
            f"/api/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
            json={
                "disposition": "accepted",
                "comment": f"{scenario['annotation']['comment']} [reviewed]",
                "geometry": {
                    "line": {
                        "x1": 10.0,
                        "y1": 12.0,
                        "x2": 60.0,
                        "y2": 52.0,
                        "imageWidth": 100.0,
                        "imageHeight": 80.0,
                    }
                },
                "metadata": {"measurement_color": "#ef4444"},
                "hidden": True,
            },
            headers=headers,
        )
        assert update_resp.status_code == 200, update_resp.text
        updated_annotation = update_resp.json()
        assert updated_annotation["disposition"] == "accepted"
        assert updated_annotation["geometry"]["line"]["x2"] == 60.0
        assert updated_annotation["metadata"]["measurement_color"] == "#ef4444"
        assert updated_annotation["hidden"] is True
        assert updated_annotation["updated_by"] == created_annotation["created_by"]
        assert updated_annotation["updated_at"] >= updated_annotation["created_at"]

        visible_list_resp = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/annotations?include_hidden=false",
            headers=headers,
        )
        assert visible_list_resp.status_code == 200, visible_list_resp.text
        assert visible_list_resp.json()["annotations"] == []

        full_list_resp = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/annotations",
            headers=headers,
        )
        assert full_list_resp.status_code == 200, full_list_resp.text
        returned_annotations = full_list_resp.json()["annotations"]
        assert len(returned_annotations) == 1
        assert returned_annotations[0]["id"] == annotation_id
        assert returned_annotations[0]["hidden"] is True

        delete_resp = client.delete(
            f"/api/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
            headers=headers,
        )
        assert delete_resp.status_code == 204, delete_resp.text

        deleted_list_resp = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/annotations",
            headers=headers,
        )
        assert deleted_list_resp.status_code == 200, deleted_list_resp.text
        assert deleted_list_resp.json()["annotations"] == []


def test_reject_part_annotation_sets_part_review_state(client):
    headers = {
        "X-User-Id": "reject-annotation@example.com",
        "X-User-Groups": '["reject-annotation-group"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Reject annotation workflow",
            "description": "reject annotation workflow",
            "meta_group_id": "reject-annotation-group",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "REJECT-ANNOT-001", "display_name": "Reject Annot Part"},
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    create_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "defect_class": "Crack",
            "modality": "visual",
            "comment": "rejecting crack",
            "disposition": "reject_part",
        },
        headers=headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    annotation_id = create_resp.json()["id"]

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    assert parts_resp.json()[0]["review_state"] == "reject_confirmed"

    reset_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}",
        json={"review_state": "pass"},
        headers=headers,
    )
    assert reset_resp.status_code == 200, reset_resp.text

    update_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
        json={"comment": "still rejecting"},
        headers=headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    assert parts_resp.json()[0]["review_state"] == "reject_confirmed"


def test_part_annotations_support_legacy_kind_and_valid_vista_segment_geometry(client):
    headers = {
        "X-User-Id": "segment-author@example.com",
        "X-User-Groups": '["segment-authors"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT3 segment annotations",
            "meta_group_id": "segment-authors",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "PT3-SEGMENT-001", "display_name": "Segmented volume"},
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    legacy_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "defect_class": "scratch",
            "modality": "visual",
            "geometry": {"line": {"x1": 1, "y1": 2, "x2": 3, "y2": 4}},
        },
        headers=headers,
    )
    assert legacy_resp.status_code == 201, legacy_resp.text
    assert legacy_resp.json()["annotation_kind"] == "measurement"
    stored_legacy_annotation = dict(legacy_resp.json())
    stored_legacy_annotation.pop("annotation_kind")
    with patch(
        "services.inspection.annotations.part_annotations",
        return_value=[stored_legacy_annotation],
    ):
        legacy_list_resp = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/annotations",
            headers=headers,
        )
    assert legacy_list_resp.status_code == 200, legacy_list_resp.text
    assert legacy_list_resp.json()["annotations"][0]["annotation_kind"] == "measurement"

    legacy_segment_annotation = {
        **stored_legacy_annotation,
        "id": str(uuid.uuid4()),
        "defect_class": "legacy helper segment",
        "geometry": {
            "segment": {
                "axis": "coronal",
                "slice_index": 4,
                "imageWidth": 64,
                "imageHeight": 48,
                "areas": [],
            },
        },
    }
    with patch(
        "services.inspection.annotations.part_annotations",
        return_value=[legacy_segment_annotation],
    ):
        legacy_segment_list_resp = client.get(
            f"/api/projects/{project_id}/parts/{part_id}/annotations",
            headers=headers,
        )
    assert legacy_segment_list_resp.status_code == 200, legacy_segment_list_resp.text
    normalized_legacy_segment = legacy_segment_list_resp.json()["annotations"][0]
    assert normalized_legacy_segment["annotation_kind"] == "vista_segment"
    assert normalized_legacy_segment["geometry"]["segment"] == {
        "axis": "coronal",
        "slice_index": 4,
        "imageWidth": 64,
        "imageHeight": 48,
        "areas": [],
        "version": 1,
        "min_slice": 4,
        "max_slice": 4,
        "image_width": 64,
        "image_height": 48,
    }

    segment_geometry = {
        "segment": {
            "version": 1,
            "axis": "axial",
            "min_slice": 7,
            "max_slice": 7,
            "image_width": 512,
            "image_height": 384,
            "areas": [
                {
                    "id": "polygon-1",
                    "tool": "polygon",
                    "operation": "add",
                    "points": [
                        {"x": 10.5, "y": 12.25},
                        {"x": 24, "y": 14},
                        {"x": 18, "y": 31},
                    ],
                },
                {
                    "id": "rectangle-1",
                    "tool": "rectangle",
                    "operation": "subtract",
                    "points": [],
                    "start": {"x": 14, "y": 16},
                    "end": {"x": 17, "y": 20},
                },
            ],
        }
    }
    create_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "annotation_kind": "vista_segment",
            "defect_class": "internal pore",
            "modality": "volume",
            "geometry": segment_geometry,
            "metadata": {"annotation_color": "#22d3ee"},
        },
        headers=headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()
    assert created["annotation_kind"] == "vista_segment"
    assert created["geometry"] == segment_geometry
    assert (
        created["geometry"]["segment"]["min_slice"]
        == created["geometry"]["segment"]["max_slice"]
    )

    hidden_update_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/annotations/{created['id']}",
        json={"hidden": True},
        headers=headers,
    )
    assert hidden_update_resp.status_code == 200, hidden_update_resp.text
    assert hidden_update_resp.json()["hidden"] is True
    assert hidden_update_resp.json()["geometry"] == segment_geometry

    mismatched_segment_kind_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "annotation_kind": "annotation",
            "defect_class": "misclassified segment",
            "modality": "volume",
            "geometry": segment_geometry,
        },
        headers=headers,
    )
    assert mismatched_segment_kind_resp.status_code == 422, (
        mismatched_segment_kind_resp.text
    )
    assert (
        "geometry.segment requires annotation_kind vista_segment"
        in mismatched_segment_kind_resp.text
    )

    invalid_kind_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "annotation_kind": "segment",
            "defect_class": "invalid kind",
            "modality": "volume",
        },
        headers=headers,
    )
    assert invalid_kind_resp.status_code == 422, invalid_kind_resp.text

    invalid_kind_update_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/annotations/{legacy_resp.json()['id']}",
        json={"annotation_kind": "vista_segment"},
        headers=headers,
    )
    assert invalid_kind_update_resp.status_code == 422, invalid_kind_update_resp.text
    invalid_kind_detail = invalid_kind_update_resp.json()["detail"]
    assert isinstance(invalid_kind_detail, list)
    assert any(
        "vista_segment annotations require geometry.segment" in entry["msg"]
        for entry in invalid_kind_detail
    )


def test_part_annotations_reject_invalid_vista_segment_geometry_on_create_and_update(
    client,
):
    headers = {
        "X-User-Id": "segment-validator@example.com",
        "X-User-Groups": '["segment-validators"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT3 segment validation",
            "meta_group_id": "segment-validators",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "PT3-SEGMENT-INVALID",
            "display_name": "Invalid segment cases",
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    base_segment = {
        "version": 1,
        "axis": "coronal",
        "min_slice": 2,
        "max_slice": 5,
        "image_width": 128,
        "image_height": 96,
        "areas": [{"tool": "polygon", "points": [{"x": 1, "y": 2}]}],
    }
    invalid_segments = [
        {**base_segment, "version": 3},
        {**base_segment, "version": 1.0},
        {**base_segment, "axis": "oblique"},
        {**base_segment, "min_slice": -1},
        {**base_segment, "min_slice": 6, "max_slice": 5},
        {**base_segment, "min_slice": 1.5},
        {**base_segment, "image_width": 0},
        {**base_segment, "areas": [None]},
        {**base_segment, "areas": [{"points": [{"x": "NaN", "y": 2}]}]},
        {**base_segment, "areas": [{}] * 513},
        {
            **base_segment,
            "areas": [{"points": [{"x": index, "y": 1} for index in range(10_001)]}],
        },
    ]
    for invalid_segment in invalid_segments:
        response = client.post(
            f"/api/projects/{project_id}/parts/{part_id}/annotations",
            json={
                "annotation_kind": "vista_segment",
                "defect_class": "invalid segment",
                "modality": "volume",
                "geometry": {"segment": invalid_segment},
            },
            headers=headers,
        )
        assert response.status_code == 422, response.text

    oversize_dimension_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "annotation_kind": "vista_segment",
            "defect_class": "oversize segment dimension",
            "modality": "volume",
            "geometry": {
                "segment": {**base_segment, "image_width": 65_537},
            },
        },
        headers=headers,
    )
    assert oversize_dimension_resp.status_code == 422, oversize_dimension_resp.text
    oversize_detail = oversize_dimension_resp.json()["detail"]
    assert isinstance(oversize_detail, list)
    assert oversize_detail[0]["loc"][0] == "body"
    assert (
        "geometry.segment.image_width must be at most 65536"
        in oversize_detail[0]["msg"]
    )

    from schemas.inspection_annotations import InspectionAnnotationCreate

    with pytest.raises(ValueError, match="finite number"):
        InspectionAnnotationCreate.model_validate(
            {
                "annotation_kind": "vista_segment",
                "defect_class": "nonfinite segment",
                "modality": "volume",
                "geometry": {
                    "segment": {
                        **base_segment,
                        "areas": [{"points": [{"x": float("inf"), "y": 2}]}],
                    }
                },
            }
        )

    valid_resp = client.post(
        f"/api/projects/{project_id}/parts/{part_id}/annotations",
        json={
            "annotation_kind": "vista_segment",
            "defect_class": "valid before update",
            "modality": "volume",
            "geometry": {"segment": base_segment},
        },
        headers=headers,
    )
    assert valid_resp.status_code == 201, valid_resp.text
    invalid_update_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/annotations/{valid_resp.json()['id']}",
        json={
            "geometry": {
                "segment": {**base_segment, "min_slice": 9, "max_slice": 4},
            }
        },
        headers=headers,
    )
    assert invalid_update_resp.status_code == 422, invalid_update_resp.text
    invalid_update_detail = invalid_update_resp.json()["detail"]
    assert isinstance(invalid_update_detail, list)
    assert (
        "geometry.segment.min_slice must be less than or equal to max_slice"
        in invalid_update_detail[0]["msg"]
    )


def test_part_annotation_collection_limits_have_exact_and_legacy_safe_boundaries():
    from services.inspection import annotations as annotation_service

    def check(annotations, **limits):
        annotation_service.validate_annotation_collection_limits(annotations, **limits)

    check([{}, {}], max_annotations=2)
    with pytest.raises(
        annotation_service.AnnotationLimitError, match="at most 2 annotations"
    ) as count_error:
        check([{}, {}, {}], max_annotations=2)
    assert count_error.value.status_code == 422

    legacy_segment = {"geometry": {"segment": {}}}
    check([legacy_segment], max_annotations=10, max_vista_segments=1)
    with pytest.raises(
        annotation_service.AnnotationLimitError, match="at most 1 VISTA segment"
    ) as segment_error:
        check(
            [legacy_segment, {"annotation_kind": "vista_segment"}],
            max_annotations=10,
            max_vista_segments=1,
        )
    assert segment_error.value.status_code == 422

    collection = [{"comment": "exact utf-8 size: µ"}]
    serialized_size = len(
        json.dumps(
            collection,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    check(collection, max_json_bytes=serialized_size)
    with pytest.raises(
        annotation_service.AnnotationLimitError, match="serialized bytes"
    ) as size_error:
        check(collection, max_json_bytes=serialized_size - 1)
    assert size_error.value.status_code == 422

    with pytest.raises(annotation_service.AnnotationLimitError, match="only JSON objects"):
        check(["invalid"])

    with pytest.raises(
        annotation_service.AnnotationLimitError, match="JSON-compatible finite values"
    ):
        check([{"value": float("nan")}])

    circular_annotation = {}
    circular_annotation["self"] = circular_annotation
    with pytest.raises(
        annotation_service.AnnotationLimitError, match="JSON-compatible finite values"
    ):
        check([circular_annotation])


def _create_pt3_guide_configuration_project(client, suffix, headers=None):
    resolved_headers = headers or {
        "X-User-Id": f"pt3-guide-{suffix}@example.com",
        "X-User-Groups": f'["pt3-guide-{suffix}"]',
    }
    response = client.post(
        "/api/projects/",
        json={
            "name": f"PT3 guide configuration {suffix}",
            "description": "PT3 3D guide configuration persistence",
            "meta_group_id": json.loads(resolved_headers["X-User-Groups"])[0],
            "project_type": "PT3",
        },
        headers=resolved_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], resolved_headers


def test_project_configuration_defaults_pt3_3d_guides(client):
    project_id, headers = _create_pt3_guide_configuration_project(client, "defaults")

    response = client.get(f"/api/projects/{project_id}/configuration", headers=headers)

    assert response.status_code == 200, response.text
    assert (
        response.json()["config"]["display_settings"]["inspection_tile_max_columns"]
        == 8
    )
    assert response.json()["config"]["display_settings"]["pt3_3d_guides"] == {
        "crosshair_transparency_percent": 50,
        "crosshair_line_width_px": 1.25,
        "plane_outline_transparency_percent": 0,
        "plane_outline_line_width_px": 1.25,
    }


def test_project_configuration_pt3_3d_guides_round_trip(client):
    project_id, headers = _create_pt3_guide_configuration_project(client, "round-trip")
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_response.status_code == 200, initial_response.text
    config = initial_response.json()["config"]
    config["display_settings"]["inspection_tile_max_columns"] = 12
    config["display_settings"]["pt3_3d_guides"] = {
        "crosshair_transparency_percent": 25,
        "crosshair_line_width_px": 2,
        "plane_outline_transparency_percent": 80,
        "plane_outline_line_width_px": 4.75,
    }

    save_response = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )

    assert save_response.status_code == 200, save_response.text
    saved_guides = save_response.json()["config"]["display_settings"]["pt3_3d_guides"]
    assert saved_guides == {
        "crosshair_transparency_percent": 25,
        "crosshair_line_width_px": 2.0,
        "plane_outline_transparency_percent": 80,
        "plane_outline_line_width_px": 4.75,
    }
    assert isinstance(saved_guides["crosshair_line_width_px"], float)
    assert (
        save_response.json()["config"]["display_settings"][
            "inspection_tile_max_columns"
        ]
        == 12
    )

    reload_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_response.status_code == 200, reload_response.text
    assert (
        reload_response.json()["config"]["display_settings"]["pt3_3d_guides"]
        == saved_guides
    )
    assert (
        reload_response.json()["config"]["display_settings"][
            "inspection_tile_max_columns"
        ]
        == 12
    )


def test_project_configuration_accepts_legacy_display_settings_without_pt3_3d_guides(
    client,
):
    project_id, headers = _create_pt3_guide_configuration_project(client, "legacy")
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_response.status_code == 200, initial_response.text
    legacy_config = initial_response.json()["config"]
    legacy_config["display_settings"].pop("pt3_3d_guides")

    save_response = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": legacy_config},
        headers=headers,
    )

    assert save_response.status_code == 200, save_response.text
    assert "pt3_3d_guides" not in save_response.json()["config"]["display_settings"]
    reload_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_response.status_code == 200, reload_response.text
    assert "pt3_3d_guides" not in reload_response.json()["config"]["display_settings"]


def test_project_configuration_clone_preserves_pt3_3d_guides(client):
    headers = {
        "X-User-Id": "pt3-guide-clone@example.com",
        "X-User-Groups": '["pt3-guide-clone"]',
    }
    source_project_id, _ = _create_pt3_guide_configuration_project(
        client, "clone-source", headers=headers
    )
    target_project_id, _ = _create_pt3_guide_configuration_project(
        client, "clone-target", headers=headers
    )
    source_response = client.get(
        f"/api/projects/{source_project_id}/configuration", headers=headers
    )
    assert source_response.status_code == 200, source_response.text
    source_config = source_response.json()["config"]
    expected_guides = {
        "crosshair_transparency_percent": 100,
        "crosshair_line_width_px": 0.5,
        "plane_outline_transparency_percent": 35,
        "plane_outline_line_width_px": 6.0,
    }
    source_config["display_settings"]["pt3_3d_guides"] = expected_guides
    save_response = client.put(
        f"/api/projects/{source_project_id}/configuration",
        json={"config": source_config},
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text

    clone_response = client.post(
        f"/api/projects/{target_project_id}/configuration/clone",
        json={"source_project_id": source_project_id},
        headers=headers,
    )

    assert clone_response.status_code == 200, clone_response.text
    assert (
        clone_response.json()["config"]["display_settings"]["pt3_3d_guides"]
        == expected_guides
    )
    target_response = client.get(
        f"/api/projects/{target_project_id}/configuration", headers=headers
    )
    assert target_response.status_code == 200, target_response.text
    assert (
        target_response.json()["config"]["display_settings"]["pt3_3d_guides"]
        == expected_guides
    )


def test_project_configuration_calibration_round_trip_and_clone(client):
    headers = {
        "X-User-Id": "project-calibration@example.com",
        "X-User-Groups": '["project-calibration"]',
    }
    source_project_id, _ = _create_pt3_guide_configuration_project(
        client,
        "calibration-source",
        headers=headers,
    )
    target_project_id, _ = _create_pt3_guide_configuration_project(
        client,
        "calibration-target",
        headers=headers,
    )

    initial_response = client.get(
        f"/api/projects/{source_project_id}/configuration",
        headers=headers,
    )
    assert initial_response.status_code == 200, initial_response.text
    source_config = initial_response.json()["config"]
    assert "calibration" not in source_config

    expected_calibration = {
        "pixels_per_mm": 12.5,
        "pixels_per_inch": 317.5,
        "unit": "mm",
        "updated_at": "2026-07-26T18:30:00Z",
    }
    source_config["calibration"] = expected_calibration
    save_response = client.put(
        f"/api/projects/{source_project_id}/configuration",
        json={"config": source_config},
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    assert save_response.json()["config"]["calibration"] == expected_calibration

    reload_response = client.get(
        f"/api/projects/{source_project_id}/configuration",
        headers=headers,
    )
    assert reload_response.status_code == 200, reload_response.text
    assert reload_response.json()["config"]["calibration"] == expected_calibration

    clone_response = client.post(
        f"/api/projects/{target_project_id}/configuration/clone",
        json={"source_project_id": source_project_id},
        headers=headers,
    )
    assert clone_response.status_code == 200, clone_response.text
    assert clone_response.json()["config"]["calibration"] == expected_calibration
    target_response = client.get(
        f"/api/projects/{target_project_id}/configuration",
        headers=headers,
    )
    assert target_response.status_code == 200, target_response.text
    assert target_response.json()["config"]["calibration"] == expected_calibration


def test_project_configuration_accepts_absent_and_null_calibration(client):
    project_id, headers = _create_pt3_guide_configuration_project(
        client,
        "calibration-optional",
    )
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration",
        headers=headers,
    )
    assert initial_response.status_code == 200, initial_response.text
    config = initial_response.json()["config"]
    assert "calibration" not in config

    config["calibration"] = None
    clear_response = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )
    assert clear_response.status_code == 200, clear_response.text
    assert clear_response.json()["config"]["calibration"] is None

    reload_response = client.get(
        f"/api/projects/{project_id}/configuration",
        headers=headers,
    )
    assert reload_response.status_code == 200, reload_response.text
    assert reload_response.json()["config"]["calibration"] is None


def test_archived_project_rejects_configuration_update_without_mutation(client):
    project_id, headers = _create_pt3_guide_configuration_project(
        client,
        "archived-configuration",
    )
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration",
        headers=headers,
    )
    assert initial_response.status_code == 200, initial_response.text
    initial_config = initial_response.json()["config"]

    archive_response = client.patch(
        f"/api/projects/{project_id}/archive",
        headers=headers,
    )
    assert archive_response.status_code == 200, archive_response.text

    attempted_config = {
        **initial_config,
        "calibration": {
            "pixels_per_mm": 10,
            "pixels_per_inch": 254,
            "unit": "mm",
        },
    }
    update_response = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": attempted_config},
        headers=headers,
    )
    assert update_response.status_code == 403, update_response.text
    assert update_response.json()["detail"] == ARCHIVED_PROJECT_DETAIL

    reload_response = client.get(
        f"/api/projects/{project_id}/configuration",
        headers=headers,
    )
    assert reload_response.status_code == 200, reload_response.text
    assert reload_response.json()["config"] == initial_config


def test_archived_target_rejects_configuration_clone_without_mutation(client):
    headers = {
        "X-User-Id": "archived-clone@example.com",
        "X-User-Groups": '["archived-clone"]',
    }
    source_project_id, _ = _create_pt3_guide_configuration_project(
        client,
        "archived-clone-source",
        headers=headers,
    )
    target_project_id, _ = _create_pt3_guide_configuration_project(
        client,
        "archived-clone-target",
        headers=headers,
    )

    source_response = client.get(
        f"/api/projects/{source_project_id}/configuration",
        headers=headers,
    )
    assert source_response.status_code == 200, source_response.text
    source_config = source_response.json()["config"]
    source_config["calibration"] = {
        "pixels_per_mm": 10,
        "pixels_per_inch": 254,
        "unit": "mm",
    }
    save_source_response = client.put(
        f"/api/projects/{source_project_id}/configuration",
        json={"config": source_config},
        headers=headers,
    )
    assert save_source_response.status_code == 200, save_source_response.text

    target_before_response = client.get(
        f"/api/projects/{target_project_id}/configuration",
        headers=headers,
    )
    assert target_before_response.status_code == 200, target_before_response.text
    target_before = target_before_response.json()["config"]
    archive_response = client.patch(
        f"/api/projects/{target_project_id}/archive",
        headers=headers,
    )
    assert archive_response.status_code == 200, archive_response.text

    clone_response = client.post(
        f"/api/projects/{target_project_id}/configuration/clone",
        json={"source_project_id": source_project_id},
        headers=headers,
    )
    assert clone_response.status_code == 403, clone_response.text
    assert clone_response.json()["detail"] == ARCHIVED_PROJECT_DETAIL

    target_after_response = client.get(
        f"/api/projects/{target_project_id}/configuration",
        headers=headers,
    )
    assert target_after_response.status_code == 200, target_after_response.text
    assert target_after_response.json()["config"] == target_before
    assert "calibration" not in target_after_response.json()["config"]


@pytest.mark.parametrize(
    "invalid_calibration",
    [
        {},
        {"pixels_per_mm": 0, "pixels_per_inch": 254, "unit": "mm"},
        {"pixels_per_mm": -1, "pixels_per_inch": 254, "unit": "mm"},
        {"pixels_per_mm": True, "pixels_per_inch": 254, "unit": "mm"},
        {"pixels_per_mm": "10", "pixels_per_inch": 254, "unit": "mm"},
        {"pixels_per_mm": float("nan"), "pixels_per_inch": 254, "unit": "mm"},
        {"pixels_per_mm": 10, "pixels_per_inch": float("inf"), "unit": "mm"},
        {"pixels_per_mm": 10, "pixels_per_inch": 255, "unit": "mm"},
        {"pixels_per_mm": 1e308, "pixels_per_inch": 1e308, "unit": "mm"},
        {"pixels_per_mm": 10, "pixels_per_inch": 254, "unit": "cm"},
        {
            "pixels_per_mm": 10,
            "pixels_per_inch": 254,
            "unit": "mm",
            "updated_at": "not-a-date",
        },
    ],
)
def test_project_configuration_rejects_invalid_calibration(
    client,
    invalid_calibration,
):
    project_id, headers = _create_pt3_guide_configuration_project(
        client,
        f"invalid-calibration-{uuid.uuid4()}",
    )
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration",
        headers=headers,
    )
    assert initial_response.status_code == 200, initial_response.text
    config = initial_response.json()["config"]
    config["calibration"] = invalid_calibration

    payload = {"config": config}
    contains_non_finite = any(
        isinstance(value, float) and not math.isfinite(value)
        for value in invalid_calibration.values()
    )
    if contains_non_finite:
        response = client.put(
            f"/api/projects/{project_id}/configuration",
            content=json.dumps(payload),
            headers={**headers, "Content-Type": "application/json"},
        )
    else:
        response = client.put(
            f"/api/projects/{project_id}/configuration",
            json=payload,
            headers=headers,
        )

    assert response.status_code == 422, response.text


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("crosshair_transparency_percent", True),
        ("crosshair_transparency_percent", "50"),
        ("crosshair_transparency_percent", 50.0),
        ("crosshair_transparency_percent", float("nan")),
        ("crosshair_transparency_percent", -1),
        ("plane_outline_transparency_percent", 101),
        ("plane_outline_transparency_percent", float("inf")),
        ("crosshair_line_width_px", True),
        ("crosshair_line_width_px", "1.25"),
        ("crosshair_line_width_px", float("nan")),
        ("plane_outline_line_width_px", float("inf")),
        ("crosshair_line_width_px", 0.49),
        ("plane_outline_line_width_px", 6.01),
    ],
)
def test_project_configuration_rejects_invalid_pt3_3d_guides(
    client,
    field_name,
    invalid_value,
):
    project_id, headers = _create_pt3_guide_configuration_project(
        client, f"invalid-{field_name}"
    )
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_response.status_code == 200, initial_response.text
    config = initial_response.json()["config"]
    config["display_settings"]["pt3_3d_guides"][field_name] = invalid_value
    payload = {"config": config}

    if isinstance(invalid_value, float) and not math.isfinite(invalid_value):
        response = client.put(
            f"/api/projects/{project_id}/configuration",
            content=json.dumps(payload),
            headers={**headers, "Content-Type": "application/json"},
        )
    else:
        response = client.put(
            f"/api/projects/{project_id}/configuration",
            json=payload,
            headers=headers,
        )

    assert response.status_code == 422, response.text
    reload_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_response.status_code == 200, reload_response.text
    assert reload_response.json()["config"]["display_settings"]["pt3_3d_guides"] == {
        "crosshair_transparency_percent": 50,
        "crosshair_line_width_px": 1.25,
        "plane_outline_transparency_percent": 0,
        "plane_outline_line_width_px": 1.25,
    }


@pytest.mark.parametrize("invalid_value", [0, 65, "8", 8.5])
def test_project_configuration_rejects_invalid_inspection_tile_max_columns(
    client, invalid_value
):
    project_id, headers = _create_pt3_guide_configuration_project(
        client, "invalid-tile-columns"
    )
    initial_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_response.status_code == 200, initial_response.text
    config = initial_response.json()["config"]
    config["display_settings"]["inspection_tile_max_columns"] = invalid_value

    response = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    reload_response = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_response.status_code == 200, reload_response.text
    assert (
        reload_response.json()["config"]["display_settings"][
            "inspection_tile_max_columns"
        ]
        == 8
    )


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_defaults_use_project_type_defect_names(
    client, project_type
):
    group = f"{project_type.lower()}-configuration-defaults"
    headers = {
        "X-User-Id": f"{project_type.lower()}-configuration-defaults@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} configuration defaults",
            "description": "project-type configuration contract",
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text

    config_resp = client.get(
        f"/api/projects/{project_resp.json()['id']}/configuration",
        headers=headers,
    )
    assert config_resp.status_code == 200, config_resp.text
    config = config_resp.json()["config"]
    assert config["image_modalities"][0]["id"] == "visual"
    assert [defect["name"] for defect in config["defect_types"]] == [
        f"DefectType1_{project_type}",
        f"DefectType2_{project_type}",
        f"DefectType3_{project_type}",
    ]


def test_project_configuration_round_trip_supports_progressive_pt2_users(client):
    project_type = "PT2"
    scenarios = [
        {
            "email": f"config-basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-config-basic",
            "payload": {
                "image_modalities": [
                    {
                        "id": "visual",
                        "label": "Visual",
                        "calibration_required": False,
                        "example_image_uploaded": False,
                    }
                ],
                "part_views": [
                    {
                        "id": "front",
                        "label": "Front",
                        "required_modalities": ["visual"],
                        "source": "manual",
                    }
                ],
                "defect_types": [
                    {
                        "name": "scratch",
                        "color": "#ef4444",
                        "definition": "Linear visible surface scratch",
                    }
                ],
                "process_settings": {
                    "require_disposition_on_submit": True,
                    "require_measurement_for_critical": False,
                    "require_second_reviewer_for_reject": False,
                    "configurable_hotkeys": {
                        "accept_classification": "a",
                        "reject_classification": "r",
                        "toggle_shortcut_help": "h",
                    },
                },
                "display_settings": {
                    "default_colormap": "grayscale",
                    "anomaly_colormap": "viridis",
                    "grayscale_base_image": True,
                },
            },
        },
        {
            "email": f"config-intermediate-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-config-intermediate",
            "payload": {
                "image_modalities": [
                    {
                        "id": "visual",
                        "label": "Visual",
                        "calibration_required": False,
                        "example_image_uploaded": True,
                    },
                    {
                        "id": "infrared",
                        "label": "Infrared",
                        "calibration_required": True,
                        "example_image_uploaded": False,
                    },
                ],
                "part_views": [
                    {
                        "id": "front",
                        "label": "Front",
                        "required_modalities": ["visual", "infrared"],
                        "source": "manual",
                    },
                    {
                        "id": "top",
                        "label": "Top",
                        "required_modalities": ["visual"],
                        "source": "auto",
                    },
                ],
                "defect_types": [
                    {
                        "name": "void_cluster",
                        "color": "#8b5cf6",
                        "definition": "Cluster of internal voids",
                    },
                    {
                        "name": "inclusion",
                        "color": "#f59e0b",
                        "definition": "Foreign inclusion in substrate",
                    },
                ],
                "process_settings": {
                    "require_disposition_on_submit": True,
                    "require_measurement_for_critical": True,
                    "require_second_reviewer_for_reject": False,
                    "configurable_hotkeys": {
                        "accept_classification": "s",
                        "reject_classification": "d",
                        "toggle_shortcut_help": "f",
                    },
                },
                "display_settings": {
                    "default_colormap": "grayscale",
                    "anomaly_colormap": "magma",
                    "grayscale_base_image": True,
                },
            },
        },
        {
            "email": f"config-advanced-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-config-advanced",
            "payload": {
                "image_modalities": [
                    {
                        "id": "visual",
                        "label": "Visual",
                        "calibration_required": False,
                        "example_image_uploaded": True,
                    },
                    {
                        "id": "infrared",
                        "label": "Infrared",
                        "calibration_required": True,
                        "example_image_uploaded": True,
                    },
                    {
                        "id": "uv",
                        "label": "UV",
                        "calibration_required": True,
                        "example_image_uploaded": True,
                    },
                ],
                "part_views": [
                    {
                        "id": "front",
                        "label": "Front",
                        "required_modalities": ["visual", "infrared", "uv"],
                        "source": "manual",
                    },
                    {
                        "id": "sagittal",
                        "label": "Sagittal",
                        "required_modalities": ["infrared", "uv"],
                        "source": "auto",
                    },
                    {
                        "id": "axial",
                        "label": "Axial",
                        "required_modalities": ["uv"],
                        "source": "auto",
                    },
                ],
                "defect_types": [
                    {
                        "name": "delamination",
                        "color": "#dc2626",
                        "definition": "Layer separation",
                    },
                    {
                        "name": "porosity",
                        "color": "#0284c7",
                        "definition": "Distributed pore network",
                    },
                    {
                        "name": "burn_through",
                        "color": "#7c3aed",
                        "definition": "Material burn-through",
                    },
                ],
                "process_settings": {
                    "require_disposition_on_submit": True,
                    "require_measurement_for_critical": True,
                    "require_second_reviewer_for_reject": True,
                    "configurable_hotkeys": {
                        "accept_classification": "z",
                        "reject_classification": "x",
                        "toggle_shortcut_help": "c",
                    },
                },
                "display_settings": {
                    "default_colormap": "grayscale",
                    "anomaly_colormap": "turbo",
                    "grayscale_base_image": False,
                },
            },
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f'["{scenario["group"]}"]',
        }
        project_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} config workflow {scenario['group']}",
                "description": "project configuration workflow",
                "meta_group_id": scenario["group"],
                "project_type": project_type,
            },
            headers=headers,
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        initial_resp = client.get(
            f"/api/projects/{project_id}/configuration", headers=headers
        )
        assert initial_resp.status_code == 200, initial_resp.text
        initial_config = initial_resp.json()["config"]
        assert "image_modalities" in initial_config
        assert "part_views" in initial_config
        assert "defect_types" in initial_config
        assert initial_config["defect_types"] == [
            {
                "name": f"DefectType1_{project_type}",
                "color": "#ef4444",
                "definition": "",
            },
            {
                "name": f"DefectType2_{project_type}",
                "color": "#f59e0b",
                "definition": "",
            },
            {
                "name": f"DefectType3_{project_type}",
                "color": "#3b82f6",
                "definition": "",
            },
        ]

        save_resp = client.put(
            f"/api/projects/{project_id}/configuration",
            json={"config": scenario["payload"]},
            headers=headers,
        )
        assert save_resp.status_code == 200, save_resp.text
        saved_config = save_resp.json()["config"]
        for key, value in scenario["payload"].items():
            assert saved_config[key] == value

        reload_resp = client.get(
            f"/api/projects/{project_id}/configuration", headers=headers
        )
        assert reload_resp.status_code == 200, reload_resp.text
        reloaded_config = reload_resp.json()["config"]
        for key, value in scenario["payload"].items():
            assert reloaded_config[key] == value


def test_project_configuration_file_naming_scheme_survives_save_and_reload(client):
    headers = {
        "X-User-Id": "config-filename-hierarchy@example.com",
        "X-User-Groups": '["config-filename-hierarchy"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Filename hierarchy persistence",
            "description": "Verify filename decoding config persists",
            "meta_group_id": "config-filename-hierarchy",
            "project_type": "PT2",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    initial_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_resp.status_code == 200, initial_resp.text
    initial_config = initial_resp.json()["config"]
    assert "file_naming_scheme" in initial_config

    payload = {
        **initial_config,
        "file_naming_scheme": {
            "use_filename_convention": False,
            "hierarchy_levels": [
                {"id": "drawing_number", "label": "Drawing", "abbreviation": "DWG"},
                {"id": "lot_number", "label": "Lot", "abbreviation": "LT"},
                {"id": "part_number", "label": "Part", "abbreviation": "PN"},
                {"id": "serial_number", "label": "Serial", "abbreviation": "SN"},
            ],
            "image_descriptors": [
                {"id": "view", "label": "View", "abbreviation": "VW"},
                {"id": "modality", "label": "Modality", "abbreviation": "MD"},
            ],
        },
    }

    save_resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": payload},
        headers=headers,
    )
    assert save_resp.status_code == 200, save_resp.text
    assert (
        save_resp.json()["config"]["file_naming_scheme"]
        == payload["file_naming_scheme"]
    )

    reload_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_resp.status_code == 200, reload_resp.text
    assert (
        reload_resp.json()["config"]["file_naming_scheme"]
        == payload["file_naming_scheme"]
    )


def test_pt1_project_configuration_strips_file_naming_scheme(client):
    headers = {
        "X-User-Id": "config-pt1-no-filenames@example.com",
        "X-User-Groups": '["config-pt1-no-filenames"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT1 no filename configuration",
            "description": "Verify PT1 hides filename decoding config",
            "meta_group_id": "config-pt1-no-filenames",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    initial_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_resp.status_code == 200, initial_resp.text
    initial_config = initial_resp.json()["config"]
    assert "file_naming_scheme" not in initial_config

    payload = {
        **initial_config,
        "file_naming_scheme": {
            "use_filename_convention": True,
            "hierarchy_levels": [
                {"id": "drawing_number", "label": "Drawing", "abbreviation": "D"},
            ],
            "image_descriptors": [
                {"id": "view", "label": "View", "abbreviation": "V"},
            ],
        },
    }
    save_resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": payload},
        headers=headers,
    )
    assert save_resp.status_code == 200, save_resp.text
    assert "file_naming_scheme" not in save_resp.json()["config"]

    reload_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_resp.status_code == 200, reload_resp.text
    assert "file_naming_scheme" not in reload_resp.json()["config"]


def test_project_configuration_metadata_parsers_survives_save_and_reload(client):
    headers = {
        "X-User-Id": "config-metadata-parsers@example.com",
        "X-User-Groups": '["config-metadata-parsers"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Metadata parser persistence",
            "description": "Verify .nsipro parser config persists",
            "meta_group_id": "config-metadata-parsers",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    initial_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert initial_resp.status_code == 200, initial_resp.text
    initial_config = initial_resp.json()["config"]
    assert initial_config["metadata_parsers"]["nsipro"]["parser_id"] == "default"

    payload = {
        **initial_config,
        "metadata_parsers": {
            "nsipro": {
                "parser_id": "deployment_a",
            },
        },
    }

    save_resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": payload},
        headers=headers,
    )
    assert save_resp.status_code == 200, save_resp.text
    assert save_resp.json()["config"]["metadata_parsers"] == payload["metadata_parsers"]

    reload_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert reload_resp.status_code == 200, reload_resp.text
    assert (
        reload_resp.json()["config"]["metadata_parsers"] == payload["metadata_parsers"]
    )


def test_project_configuration_rejects_invalid_hotkeys(client):
    project_type = "PT2"
    headers = {
        "X-User-Id": f"config-hotkey-invalid-{project_type.lower()}@example.com",
        "X-User-Groups": f'["{project_type.lower()}-config-hotkey-invalid"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} config hotkey invalid",
            "description": "project configuration hotkey validation",
            "meta_group_id": f"{project_type.lower()}-config-hotkey-invalid",
            "project_type": project_type,
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    invalid_payload = {
        "image_modalities": [],
        "part_views": [],
        "defect_types": [],
        "process_settings": {
            "require_disposition_on_submit": True,
            "require_measurement_for_critical": False,
            "require_second_reviewer_for_reject": False,
            "configurable_hotkeys": {
                "accept_classification": "ab",
                "reject_classification": "r",
                "toggle_shortcut_help": "h",
            },
        },
        "display_settings": {
            "default_colormap": "grayscale",
            "anomaly_colormap": "viridis",
            "grayscale_base_image": True,
        },
    }

    save_resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": invalid_payload},
        headers=headers,
    )
    assert save_resp.status_code == 422, save_resp.text


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_clone_allows_same_project_type(client, project_type):
    group = f"{project_type.lower()}-clone-same-type"
    headers = {
        "X-User-Id": f"{project_type.lower()}-clone-same-type@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    project_ids = []
    for role in ("source", "target"):
        response = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} clone {role}",
                "description": f"{role} for same-type clone contract",
                "meta_group_id": group,
                "project_type": project_type,
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
        project_ids.append(response.json()["id"])
    source_project_id, target_project_id = project_ids

    source_config_resp = client.get(
        f"/api/projects/{source_project_id}/configuration",
        headers=headers,
    )
    assert source_config_resp.status_code == 200, source_config_resp.text
    source_config = source_config_resp.json()["config"]
    source_config["defect_types"][0]["definition"] = (
        f"{project_type} same-type clone marker"
    )
    save_resp = client.put(
        f"/api/projects/{source_project_id}/configuration",
        json={"config": source_config},
        headers=headers,
    )
    assert save_resp.status_code == 200, save_resp.text
    source_config = save_resp.json()["config"]

    clone_resp = client.post(
        f"/api/projects/{target_project_id}/configuration/clone",
        json={"source_project_id": source_project_id},
        headers=headers,
    )
    assert clone_resp.status_code == 200, clone_resp.text
    clone_payload = clone_resp.json()
    assert clone_payload["project_id"] == target_project_id
    assert clone_payload["source_project_id"] == source_project_id
    assert clone_payload["config"]["defect_types"] == source_config["defect_types"]

    target_config_resp = client.get(
        f"/api/projects/{target_project_id}/configuration",
        headers=headers,
    )
    assert target_config_resp.status_code == 200, target_config_resp.text
    assert target_config_resp.json()["config"] == source_config


def test_project_configuration_clone_requires_access_to_source_project(client):
    project_type = "PT2"
    source_headers = {
        "X-User-Id": f"clone-source-{project_type.lower()}@example.com",
        "X-User-Groups": f'["{project_type.lower()}-clone-source"]',
    }
    target_headers = {
        "X-User-Id": f"clone-target-{project_type.lower()}@example.com",
        "X-User-Groups": f'["{project_type.lower()}-clone-target"]',
    }

    source_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} clone access source",
            "description": "source access control",
            "meta_group_id": f"{project_type.lower()}-clone-source",
            "project_type": project_type,
        },
        headers=source_headers,
    )
    target_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} clone access target",
            "description": "target access control",
            "meta_group_id": f"{project_type.lower()}-clone-target",
            "project_type": project_type,
        },
        headers=target_headers,
    )
    assert source_resp.status_code == 201, source_resp.text
    assert target_resp.status_code == 201, target_resp.text
    source_project_id = source_resp.json()["id"]
    target_project_id = target_resp.json()["id"]

    with patch("utils.dependencies.is_user_in_group", return_value=False):
        clone_resp = client.post(
            f"/api/projects/{target_project_id}/configuration/clone",
            json={"source_project_id": source_project_id},
            headers=target_headers,
        )
    assert clone_resp.status_code == 403, clone_resp.text
    assert "does not have access to project" in clone_resp.json()["detail"]


def test_project_configuration_clone_rejects_same_source_and_target_project(client):
    project_type = "PT2"
    headers = {
        "X-User-Id": f"clone-self-{project_type.lower()}@example.com",
        "X-User-Groups": f'["{project_type.lower()}-clone-self"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} clone self",
            "description": "clone self guard",
            "meta_group_id": f"{project_type.lower()}-clone-self",
            "project_type": project_type,
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    clone_resp = client.post(
        f"/api/projects/{project_id}/configuration/clone",
        json={"source_project_id": project_id},
        headers=headers,
    )
    assert clone_resp.status_code == 400, clone_resp.text
    assert (
        clone_resp.json()["detail"]
        == "source_project_id must be different from project_id"
    )


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_clone_rejects_cross_project_type_source(
    client, project_type
):
    source_type_by_target = {"PT1": "PT2", "PT2": "PT3", "PT3": "PT1"}
    source_project_type = source_type_by_target[project_type]

    group = f"{project_type.lower()}-clone-type-guard"
    headers = {
        "X-User-Id": f"{project_type.lower()}-clone-type-guard@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    target_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} clone target",
            "description": "target project for type guard",
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=headers,
    )
    source_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{source_project_type} clone source",
            "description": "cross-type source project",
            "meta_group_id": group,
            "project_type": source_project_type,
        },
        headers=headers,
    )
    assert target_resp.status_code == 201, target_resp.text
    assert source_resp.status_code == 201, source_resp.text

    clone_resp = client.post(
        f"/api/projects/{target_resp.json()['id']}/configuration/clone",
        json={"source_project_id": source_resp.json()["id"]},
        headers=headers,
    )
    assert clone_resp.status_code == 400, clone_resp.text
    assert (
        clone_resp.json()["detail"]
        == "source_project_id must belong to a project with the same project_type as the target project"
    )


def test_project_configuration_interface_layout_default_save_and_load(client):
    project_type = "PT2"
    group = f"{project_type.lower()}-layout-default"
    headers = {
        "X-User-Id": f"{project_type.lower()}-layout-default@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} layout default project",
            "description": "layout default workflow",
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    layout_model = {
        "global": {"tabEnableClose": False},
        "layout": {
            "type": "row",
            "children": [
                {
                    "type": "tabset",
                    "children": [
                        {"type": "tab", "component": "inspection", "name": "Inspection"}
                    ],
                }
            ],
        },
    }
    save_resp = client.post(
        f"/api/projects/{project_id}/configuration/interface-layout/default",
        json={"layout_model": layout_model},
        headers=headers,
    )
    assert save_resp.status_code == 200, save_resp.text
    assert (
        save_resp.json()["config"]["interface_layout"]["default_model"] == layout_model
    )

    get_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
    assert get_resp.status_code == 200, get_resp.text
    assert (
        get_resp.json()["config"]["interface_layout"]["default_model"] == layout_model
    )


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_type_interface_layout_default_requires_admin_and_applies_to_matching_projects(
    client, project_type
):
    group = f"{project_type.lower()}-layout-type-default"
    admin_headers = {
        "X-User-Id": f"{project_type.lower()}-layout-type-admin@example.com",
        "X-User-Groups": f'["{group}","admins"]',
    }
    non_admin_headers = {
        "X-User-Id": f"{project_type.lower()}-layout-type-user@example.com",
        "X-User-Groups": f'["{group}"]',
    }
    source_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} layout type source",
            "description": "layout type source",
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=admin_headers,
    )
    target_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} layout type target",
            "description": "layout type target",
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=admin_headers,
    )
    assert source_resp.status_code == 201, source_resp.text
    assert target_resp.status_code == 201, target_resp.text
    source_project_id = source_resp.json()["id"]
    target_project_id = target_resp.json()["id"]

    layout_model = {
        "global": {"tabEnableClose": False},
        "layout": {"type": "row", "children": [{"type": "tabset", "children": []}]},
    }
    forbidden_resp = client.post(
        f"/api/projects/{source_project_id}/configuration/interface-layout/project-type-default",
        json={"layout_model": layout_model},
        headers=non_admin_headers,
    )
    assert forbidden_resp.status_code == 403, forbidden_resp.text

    save_resp = client.post(
        f"/api/projects/{source_project_id}/configuration/interface-layout/project-type-default",
        json={"layout_model": layout_model},
        headers=admin_headers,
    )
    assert save_resp.status_code == 200, save_resp.text

    target_config_resp = client.get(
        f"/api/projects/{target_project_id}/configuration", headers=admin_headers
    )
    assert target_config_resp.status_code == 200, target_config_resp.text
    assert (
        target_config_resp.json()["config"]["interface_layout"]["default_model"]
        == layout_model
    )


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_load_test_data_seeds_project_type_fixtures(client, project_type):
    headers = {
        "X-User-Id": f"loader-{project_type.lower()}@example.com",
        "X-User-Groups": f'["{project_type.lower()}-loader"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": f"{project_type} loader project",
            "description": "test data loader coverage",
            "meta_group_id": f"{project_type.lower()}-loader",
            "project_type": project_type,
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    with patch("services.inspection.test_fixture_images.upload_file_to_s3", return_value=True):
        load_resp = client.post(
            f"/api/projects/{project_id}/load-test-data", headers=headers
        )

    assert load_resp.status_code == 200, load_resp.text
    payload = load_resp.json()
    assert payload["project_type"] == project_type
    assert payload["images_received"] > 0
    if project_type == "PT1":
        assert payload["ingest"]["counters"]["parts_received"] == 0
    else:
        assert payload["ingest"]["counters"]["parts_received"] > 0

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    parts = parts_resp.json()
    if project_type == "PT1":
        assert parts == []
        assert payload["images_received"] == 20
        images_resp = client.get(
            f"/api/projects/{project_id}/images?include_deleted=true&limit=2000",
            headers=headers,
        )
        assert images_resp.status_code == 200, images_resp.text
        images = images_resp.json()
        filenames = {image["filename"] for image in images}
        assert "D1001_LOT01_SET01_SN0001_front_visual_false.jpg" in filenames
        assert "D1002_LOT02_SET01_SN0004_back_heatmap_true.jpg" in filenames
        assert "D1001_LOT01_SET01_SN0001_front_segmentation_true.txt" in filenames
        assert "D1002_LOT02_SET01_SN0004_back_segmentation_true.txt" in filenames
        first_image_metadata = images[0]["metadata"]
        assert first_image_metadata["source"] == "vista-test-data"
        assert first_image_metadata["design_number"].startswith("D")
        assert all("source_images" not in image["metadata"] for image in images)
        return

    assert parts
    if project_type == "PT3":
        assert parts[0]["metadata"]["mpr"]["axis_labels"] == ["XY", "XZ", "YZ"]
        assert parts[0]["metadata"]["volume_shape"] == {
            "axial": 64,
            "coronal": 96,
            "sagittal": 128,
        }
        source_images = parts[0]["metadata"]["source_images"]
        assert len(source_images) == 128
        base_images = [
            source_image
            for source_image in source_images
            if not source_image["metadata"].get("overlay")
        ]
        overlay_images = [
            source_image
            for source_image in source_images
            if source_image["metadata"].get("overlay")
        ]
        assert len(base_images) == 64
        assert len(overlay_images) == 64
        slice_16 = next(
            source_image
            for source_image in base_images
            if source_image["filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png"
        )
        assert slice_16["metadata"]["slice_index"] == 16
        overlay_16 = next(
            source_image
            for source_image in overlay_images
            if source_image["filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016_overlay.png"
        )
        assert (
            overlay_16["metadata"]["overlay_base_filename"]
            == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png"
        )
        assert overlay_16["metadata"]["modality"] == "segmentation"
        nsipro_metadata = parts[0]["metadata"]["nsipro_metadata"]
        assert nsipro_metadata["source_filename"] == "PT3_GEOMETRIC_DUAL_LABEL.nsipro"
        assert nsipro_metadata["parser"] == "nsipro-key-value"
        assert nsipro_metadata["metadata"]["Application"][
            "application_info"
        ].startswith("NIS-Elements")
        assert (
            nsipro_metadata["metadata"]["Microscope"]["microscope_name"]
            == "Nikon Ti2-E Inverted Microscope"
        )
        assert nsipro_metadata["metadata"]["Camera"]["exposure_ms"] == 12.5
        assert nsipro_metadata["metadata"]["Volume"]["slices"] == 64
    else:
        source_images = [
            source_image
            for part in parts
            for source_image in part["metadata"].get("source_images", [])
        ]
        filenames = {source_image["filename"] for source_image in source_images}
        assert payload["images_received"] == 20
        assert "D1001_LOT01_SET01_SN0001_front_segmentation_true.txt" in filenames
        assert "D1002_LOT02_SET01_SN0004_back_segmentation_true.txt" in filenames
        text_overlay = next(
            source_image
            for source_image in source_images
            if source_image["filename"]
            == "D1001_LOT01_SET01_SN0001_front_segmentation_true.txt"
        )
        assert text_overlay["overlay"] is True
        assert text_overlay["modality"] == "segmentation"
        assert parts[0]["metadata"]["design_number"].startswith("D")


def test_pt1_load_test_data_invalidates_cached_empty_image_list(client):
    headers = {
        "X-User-Id": "loader-pt1-cache@example.com",
        "X-User-Groups": '["pt1-loader-cache"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT1 loader cache regression",
            "description": "reproduce stale image-list cache after load test data",
            "meta_group_id": "pt1-loader-cache",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    empty_images_resp = client.get(
        f"/api/projects/{project_id}/images?include_deleted=true&limit=2000",
        headers=headers,
    )
    assert empty_images_resp.status_code == 200, empty_images_resp.text
    assert empty_images_resp.json() == []

    with patch("services.inspection.test_fixture_images.upload_file_to_s3", return_value=True):
        load_resp = client.post(
            f"/api/projects/{project_id}/load-test-data", headers=headers
        )

    assert load_resp.status_code == 200, load_resp.text
    assert load_resp.json()["images_received"] == 20

    images_resp = client.get(
        f"/api/projects/{project_id}/images?include_deleted=true&limit=2000",
        headers=headers,
    )
    assert images_resp.status_code == 200, images_resp.text
    images = images_resp.json()
    assert len(images) == 20
    image_ids = {image["id"] for image in images}

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    assert parts_resp.json() == []
    assert image_ids == {image["id"] for image in images}


def test_pt3_load_test_data_survives_fixture_image_upload_failure(client):
    headers = {
        "X-User-Id": "loader-pt3-nos3@example.com",
        "X-User-Groups": '["pt3-loader-nos3"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT3 loader without object storage",
            "description": "reproduce load test data button failure",
            "meta_group_id": "pt3-loader-nos3",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    with patch("services.inspection.test_fixture_images.upload_file_to_s3", return_value=False):
        load_resp = client.post(
            f"/api/projects/{project_id}/load-test-data", headers=headers
        )

    assert load_resp.status_code == 200, load_resp.text
    payload = load_resp.json()
    assert payload["project_type"] == "PT3"
    assert payload["images_created"] == 128
    assert payload["ingest"]["counters"]["parts_created"] == 1

    images_resp = client.get(
        f"/api/projects/{project_id}/images?include_deleted=true&limit=2000",
        headers=headers,
    )
    assert images_resp.status_code == 200, images_resp.text
    images = images_resp.json()
    assert len(images) == 128
    assert images[0]["metadata"]["storage_status"] == "metadata_only"
    assert images[0]["metadata"]["builtin_fixture_filename"] == images[0]["filename"]
    slice_16 = next(
        image
        for image in images
        if image["filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png"
    )
    assert slice_16["metadata"]["slice_index"] == 16
    overlay_16 = next(
        image
        for image in images
        if image["filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016_overlay.png"
    )
    assert overlay_16["metadata"]["overlay"] is True
    assert (
        overlay_16["metadata"]["overlay_base_filename"]
        == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png"
    )

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    part_metadata = parts_resp.json()[0]["metadata"]
    assert part_metadata["mpr"]["axis_labels"] == ["XY", "XZ", "YZ"]
    assert part_metadata["volume_shape"] == {
        "axial": 64,
        "coronal": 96,
        "sagittal": 128,
    }
    assert len(part_metadata["source_images"]) == 128


def test_pt3_load_test_data_survives_fixture_image_upload_exception(client):
    headers = {
        "X-User-Id": "loader-pt3-exception@example.com",
        "X-User-Groups": '["pt3-loader-exception"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "PT3 loader with object storage exception",
            "description": "reproduce load test data button runtime upload failure",
            "meta_group_id": "pt3-loader-exception",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    with patch(
        "services.inspection.test_fixture_images.upload_file_to_s3",
        side_effect=RuntimeError("storage unavailable"),
    ):
        load_resp = client.post(
            f"/api/projects/{project_id}/load-test-data", headers=headers
        )

    assert load_resp.status_code == 200, load_resp.text
    payload = load_resp.json()
    assert payload["project_type"] == "PT3"
    assert payload["images_created"] == 128
    assert payload["ingest"]["counters"]["parts_created"] == 1

    images_resp = client.get(
        f"/api/projects/{project_id}/images?include_deleted=true&limit=2000",
        headers=headers,
    )
    assert images_resp.status_code == 200, images_resp.text
    images = images_resp.json()
    assert len(images) == 128
    assert images[0]["metadata"]["storage_status"] == "metadata_only"


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_bulk_ingest_supports_progressive_users_with_discrepancy_counters(
    client, project_type
):
    scenarios = [
        {
            "name": "basic",
            "group": f"{project_type.lower()}-ingest-basic",
            "payload": {
                "batches": [
                    {
                        "name": "batch-basic-a",
                        "description": "Basic ingest",
                        "parts": [
                            {
                                "serial_number": "SN-BASIC-001",
                                "display_name": "Basic Housing 1",
                            },
                        ],
                    }
                ]
            },
            "expected": {
                "batches_received": 1,
                "parts_received": 1,
                "batches_created": 1,
                "parts_created": 1,
                "parts_skipped_existing": 0,
                "parts_skipped_discrepancy": 0,
            },
        },
        {
            "name": "unassigned",
            "group": f"{project_type.lower()}-ingest-unassigned",
            "payload": {
                "batches": [],
                "unassigned_parts": [
                    {
                        "serial_number": "SN-SET-001",
                        "display_name": "D1001 LOT01 SET01 SN-SET-001",
                        "metadata": {
                            "design_number": "D1001",
                            "lot_number": "LOT01",
                            "set_number": "SET01",
                        },
                    },
                ],
            },
            "expected": {
                "batches_received": 0,
                "parts_received": 1,
                "batches_created": 0,
                "parts_created": 1,
                "parts_skipped_existing": 0,
                "parts_skipped_discrepancy": 0,
            },
            "expect_unassigned": True,
        },
        {
            "name": "intermediate",
            "group": f"{project_type.lower()}-ingest-intermediate",
            "payload": {
                "batches": [
                    {
                        "name": "batch-mid-a",
                        "description": "Mid ingest A",
                        "parts": [
                            {
                                "serial_number": "SN-MID-001",
                                "display_name": "Mid Housing 1",
                            },
                            {
                                "serial_number": "SN-MID-002",
                                "display_name": "Mid Housing 2",
                            },
                        ],
                    },
                    {
                        "name": "batch-mid-b",
                        "description": "Mid ingest B",
                        "parts": [
                            {
                                "serial_number": "SN-MID-001",
                                "display_name": "Mid Housing Duplicate",
                            },
                        ],
                    },
                ]
            },
            "expected": {
                "batches_received": 2,
                "parts_received": 3,
                "batches_created": 2,
                "parts_created": 2,
                "parts_skipped_existing": 0,
                "parts_skipped_discrepancy": 1,
            },
            "expected_discrepancy_codes": {"duplicate_serial_in_payload"},
        },
        {
            "name": "advanced",
            "group": f"{project_type.lower()}-ingest-advanced",
            "seed_first": {
                "batches": [
                    {
                        "name": "batch-seed",
                        "description": "Seed",
                        "parts": [
                            {
                                "serial_number": "SN-ADV-EXISTING",
                                "display_name": "Existing Seed Part",
                            },
                            {
                                "serial_number": "SN-ADV-CONFLICT",
                                "display_name": "Conflict Seed Part",
                            },
                        ],
                    }
                ]
            },
            "payload": {
                "batches": [
                    {
                        "name": "batch-seed",
                        "description": "Seed",
                        "parts": [
                            {
                                "serial_number": "SN-ADV-EXISTING",
                                "display_name": "Existing Same Batch",
                            },
                        ],
                    },
                    {
                        "name": "batch-adv-b",
                        "description": "Advanced ingest",
                        "parts": [
                            {
                                "serial_number": "SN-ADV-CONFLICT",
                                "display_name": "Cross-Batch Conflict",
                            },
                            {
                                "serial_number": "SN-ADV-NEW-001",
                                "display_name": "Advanced New Part",
                            },
                        ],
                    },
                ]
            },
            "expected": {
                "batches_received": 2,
                "parts_received": 3,
                "batches_created": 1,
                "parts_created": 1,
                "parts_skipped_existing": 1,
                "parts_skipped_discrepancy": 1,
            },
            "expected_discrepancy_codes": {"serial_already_assigned_to_other_batch"},
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": f"{scenario['name']}-{project_type.lower()}@example.com",
            "X-User-Groups": f'["{scenario["group"]}"]',
        }
        project_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} ingest workflow {scenario['name']}",
                "description": "bulk ingest discrepancy workflow",
                "meta_group_id": scenario["group"],
                "project_type": project_type,
            },
            headers=headers,
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        if scenario.get("seed_first"):
            seed_resp = client.post(
                f"/api/projects/{project_id}/ingest",
                json=scenario["seed_first"],
                headers=headers,
            )
            assert seed_resp.status_code == 200, seed_resp.text

        ingest_resp = client.post(
            f"/api/projects/{project_id}/ingest",
            json=scenario["payload"],
            headers=headers,
        )
        assert ingest_resp.status_code == 200, ingest_resp.text
        payload = ingest_resp.json()
        assert payload["project_id"] == project_id
        assert payload["counters"] == scenario["expected"]

        expected_codes = scenario.get("expected_discrepancy_codes", set())
        discrepancy_codes = {entry["code"] for entry in payload["discrepancies"]}
        assert discrepancy_codes == expected_codes

        if scenario.get("expect_unassigned"):
            parts_resp = client.get(
                f"/api/projects/{project_id}/parts", headers=headers
            )
            assert parts_resp.status_code == 200, parts_resp.text
            parts = parts_resp.json()
            assert len(parts) == 1
            assert parts[0]["batch_id"] is None
            assert parts[0]["metadata"]["set_number"] == "SET01"


def test_bulk_ingest_dereferences_associated_nsipro_metadata(client):
    headers = {
        "X-User-Id": "nsipro-ingest@example.com",
        "X-User-Groups": '["nsipro-ingest"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Nsipro ingest project",
            "description": "backend authoritative associated metadata ingest",
            "meta_group_id": "nsipro-ingest",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    metadata_key = "associated_upload_metadata:scan.nsipro:testhash"
    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": metadata_key,
            "value": {
                "kind": "associated_image_upload_metadata",
                "filename": "scan.nsipro",
                "file_type": "nsipro",
                "parser": "nsipro-key-value",
                "parser_id": "default",
                "parser_version": "1.0.0",
                "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
                "source_filename": "scan.nsipro",
                "content_hash": "testhash",
                "metadata": {"capture": {"operator": "alice", "exposure": 12}},
            },
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    ingest_resp = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "batches": [],
            "unassigned_parts": [
                {
                    "serial_number": "NSIPRO-001",
                    "display_name": "NSIPRO part",
                    "metadata": {
                        "associated_metadata_ref": metadata_key,
                        "associated_metadata": {
                            "project_metadata_key": metadata_key,
                            "file_type": "nsipro",
                            "parser_id": "default",
                            "parser_version": "1.0.0",
                            "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
                        },
                        "source_images": [
                            {
                                "filename": "front.png",
                                "side": "front",
                                "modality": "visual",
                                "associated_metadata_ref": metadata_key,
                                "associated_metadata": {
                                    "project_metadata_key": metadata_key,
                                    "file_type": "nsipro",
                                    "parser_id": "default",
                                    "parser_version": "1.0.0",
                                    "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
                                },
                            }
                        ],
                    },
                }
            ],
        },
        headers=headers,
    )
    assert ingest_resp.status_code == 200, ingest_resp.text

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    parts = parts_resp.json()
    assert len(parts) == 1
    metadata = parts[0]["metadata"]
    assert metadata["nsipro_metadata"] == {
        "capture": {"operator": "alice", "exposure": 12}
    }
    assert metadata["nsipro_payload"]["parser_id"] == "default"
    assert (
        metadata["nsipro_payload"]["parser_hash"]
        == "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df"
    )
    source_image = metadata["source_images"][0]
    assert (
        source_image["nsipro_payload_ref"]
        == metadata["nsipro_payload_ref"]
        == metadata_key
    )
    assert "nsipro_payload" not in source_image
    assert metadata["nsipro_payload"]["metadata"] == metadata["nsipro_metadata"]

    replacement_key = "associated_upload_metadata:scan-updated.nsipro:updatedhash"
    replacement_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": replacement_key,
            "value": {
                "kind": "associated_image_upload_metadata",
                "filename": "scan-updated.nsipro",
                "file_type": "nsipro",
                "parser": "nsipro-key-value",
                "parser_id": "default",
                "parser_version": "1.0.0",
                "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
                "source_filename": "scan-updated.nsipro",
                "content_hash": "updatedhash",
                "metadata": {"capture": {"operator": "bob", "exposure": 18}},
            },
        },
        headers=headers,
    )
    assert replacement_resp.status_code == 201, replacement_resp.text

    update_resp = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "batches": [],
            "unassigned_parts": [
                {
                    "serial_number": "NSIPRO-001",
                    "display_name": "NSIPRO part",
                    "metadata": {
                        "source_images": [
                            {
                                "filename": "front.png",
                                "side": "front",
                                "modality": "visual",
                                "associated_metadata_ref": replacement_key,
                                "associated_metadata": {
                                    "project_metadata_key": replacement_key,
                                    "file_type": "nsipro",
                                    "parser_id": "default",
                                    "parser_version": "1.0.0",
                                    "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
                                },
                            }
                        ],
                    },
                }
            ],
        },
        headers=headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    assert update_resp.json()["counters"]["parts_skipped_existing"] == 1

    updated_parts_resp = client.get(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert updated_parts_resp.status_code == 200, updated_parts_resp.text
    updated_metadata = updated_parts_resp.json()[0]["metadata"]
    assert updated_metadata["nsipro_metadata"] == {
        "capture": {"operator": "bob", "exposure": 18}
    }
    updated_source = updated_metadata["source_images"][0]
    assert (
        updated_source["nsipro_payload_ref"]
        == updated_metadata["nsipro_payload_ref"]
        == replacement_key
    )
    assert "nsipro_payload" not in updated_source
    assert (
        updated_metadata["nsipro_payload"]["source_filename"] == "scan-updated.nsipro"
    )
    assert (
        updated_metadata["nsipro_payload"]["metadata"]
        == updated_metadata["nsipro_metadata"]
    )


def test_bulk_ingest_persists_deployment_nsipro_custom_fields_after_dereference(client):
    headers = {
        "X-User-Id": "nsipro-deployment@example.com",
        "X-User-Groups": '["nsipro-deployment"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Deployment nsipro ingest project",
            "description": "backend authoritative deployment .nsipro ingest",
            "meta_group_id": "nsipro-deployment",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    config_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert config_resp.status_code == 200, config_resp.text
    config = config_resp.json()["config"]
    config["metadata_parsers"] = {"nsipro": {"parser_id": "deployment_a"}}
    save_config_resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )
    assert save_config_resp.status_code == 200, save_config_resp.text

    metadata_key = "associated_upload_metadata:deployment-a.nsipro:deploymenthash"
    metadata_text = "\n".join(
        [
            "[Deployment]",
            "Deployment ID = DEP-42",
            "Line ID = LINE-7",
            "Build Number = 118",
            "[Custom Fields]",
            "Inspection Lot = LOT-ALPHA",
            "Operator Badge = QA-17",
            "Scan Mode = micro CT",
        ]
    )
    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": metadata_key,
            "value": {
                "kind": "associated_image_upload_metadata",
                "filename": "deployment-a.nsipro",
                "file_type": "nsipro",
                "parser": "nsipro-key-value",
                "parser_id": "deployment_a",
                "parser_version": "1.0.0",
                "parser_hash": "sha256:d1c01fbbf53558bc44e1fcc73a8f537f0feec684ef38b8c919beefb59c1be6bb",
                "source_filename": "deployment-a.nsipro",
                "content_hash": "deploymenthash",
                "raw_text": metadata_text,
            },
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    ingest_resp = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "batches": [
                {
                    "name": "PT3_DEPLOYMENT_STACK",
                    "description": "PT3 deployment stack",
                    "parts": [
                        {
                            "serial_number": "DEP-PT3-001",
                            "display_name": "Deployment PT3 part",
                            "metadata": {
                                "project_type": "PT3",
                                "volume_stack_id": "stack-deployment-a",
                                "associated_metadata_ref": metadata_key,
                                "associated_metadata": {
                                    "project_metadata_key": metadata_key,
                                    "file_type": "nsipro",
                                    "parser_id": "deployment_a",
                                    "parser_version": "1.0.0",
                                    "parser_hash": "sha256:d1c01fbbf53558bc44e1fcc73a8f537f0feec684ef38b8c919beefb59c1be6bb",
                                },
                                "source_images": [
                                    {
                                        "filename": "slice-001.png",
                                        "image_id": "slice-001",
                                        "slice_axis": "z",
                                        "slice_index": 1,
                                        "associated_metadata_ref": metadata_key,
                                        "associated_metadata": {
                                            "project_metadata_key": metadata_key,
                                            "file_type": "nsipro",
                                            "parser_id": "deployment_a",
                                            "parser_version": "1.0.0",
                                            "parser_hash": "sha256:d1c01fbbf53558bc44e1fcc73a8f537f0feec684ef38b8c919beefb59c1be6bb",
                                        },
                                    }
                                ],
                            },
                        }
                    ],
                }
            ],
            "unassigned_parts": [],
        },
        headers=headers,
    )
    assert ingest_resp.status_code == 200, ingest_resp.text

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    parts = parts_resp.json()
    assert len(parts) == 1
    metadata = parts[0]["metadata"]
    assert metadata["nsipro_metadata"] == {
        "deployment": {
            "deployment_id": "DEP-42",
            "line_id": "LINE-7",
            "build_number": 118,
        },
        "custom_fields": {
            "inspection_lot": "LOT-ALPHA",
            "operator_badge": "QA-17",
            "scan_mode": "micro CT",
        },
    }
    assert metadata["nsipro_payload"]["parser_id"] == "deployment_a"
    source_image = metadata["source_images"][0]
    assert (
        source_image["nsipro_payload_ref"]
        == metadata["nsipro_payload_ref"]
        == metadata_key
    )
    assert "nsipro_payload" not in source_image
    assert metadata["nsipro_payload"]["metadata"] == metadata["nsipro_metadata"]
    assert (
        metadata["nsipro_payload"]["parser_hash"]
        == "sha256:d1c01fbbf53558bc44e1fcc73a8f537f0feec684ef38b8c919beefb59c1be6bb"
    )


def test_bulk_ingest_strict_nsipro_parser_contract_rejects_mismatched_payload(client):
    headers = {
        "X-User-Id": "nsipro-strict@example.com",
        "X-User-Groups": '["nsipro-strict"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Strict nsipro ingest project",
            "description": "strict parser contract",
            "meta_group_id": "nsipro-strict",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    config_resp = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    )
    assert config_resp.status_code == 200, config_resp.text
    config = config_resp.json()["config"]
    config["metadata_parsers"] = {
        "nsipro": {
            "parser_id": "default",
            "parser_version": "1.0.0",
            "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
            "strict_version_match": True,
        }
    }
    save_resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )
    assert save_resp.status_code == 200, save_resp.text

    metadata_key = "associated_upload_metadata:strict.nsipro:testhash"
    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": metadata_key,
            "value": {
                "filename": "strict.nsipro",
                "file_type": "nsipro",
                "parser_id": "default",
                "parser_version": "1.0.0",
                "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
                "metadata": {"operator": "alice"},
            },
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    ingest_resp = client.post(
        f"/api/projects/{project_id}/ingest",
        json={
            "unassigned_parts": [
                {
                    "serial_number": "NSIPRO-STRICT-001",
                    "metadata": {
                        "associated_metadata_ref": metadata_key,
                        "associated_metadata": {
                            "project_metadata_key": metadata_key,
                            "file_type": "nsipro",
                            "parser_id": "deployment_b",
                            "parser_version": "1.0.0",
                            "parser_hash": "sha256:5992e0724aa1667d6069e6943dac78a43c6a2526b070f7f8d78980cead254ba0",
                        },
                    },
                }
            ]
        },
        headers=headers,
    )
    assert ingest_resp.status_code == 422
    assert ".nsipro parser contract mismatch" in ingest_resp.json()["detail"]


def _create_project_for_part_image_tests(client, name="Part Image Project"):
    headers = {
        "X-User-Id": "parts-images@example.com",
        "X-User-Groups": '["parts-images"]',
    }
    response = client.post(
        "/api/projects/",
        json={
            "name": name,
            "description": None,
            "meta_group_id": "parts-images",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], headers


def _upload_part_test_image(
    client, project_id, headers, filename="part-image.png", metadata=None
):
    image = Image.new("RGB", (8, 8), (12, 34, 56))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    data = {"metadata": json.dumps(metadata)} if metadata is not None else None
    response = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, buffer, "image/png")},
        data=data,
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _upload_part_test_volume(
    client, project_id, headers, filename, array, metadata=None
):
    buffer = io.BytesIO()
    np.save(buffer, np.asarray(array), allow_pickle=False)
    buffer.seek(0)
    data = {"metadata": json.dumps(metadata)} if metadata is not None else None
    response = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, buffer, "application/octet-stream")},
        data=data,
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_image_display_order_canonicalizes_aliases_and_appends_omitted_images(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Image display order project",
    )
    original_metadata = {
        "view_images": {
            "rear": "rear.png",
            "front": "front.png",
            "legacy": "view-only-legacy.png",
        },
        "source_images": [
            {
                "filename": "front.png",
                "image_id": "front-id",
                "side": "front",
                "metadata": {"preserve": "front"},
            },
            {
                "filename": "rear.png",
                "image_id": "rear-id",
                "side": "rear",
                "metadata": {"preserve": "rear"},
            },
            {
                "filename": "side.png",
                "image_id": "side-id",
                "side": "side",
            },
            {
                "filename": "legacy-without-id.png",
                "side": "legacy",
            },
        ],
        "analysis_outputs": [
            {
                "filename": "overlay.png",
                "image_id": "overlay-id",
                "analysis_output": True,
                "metadata": {"threshold": 17},
            }
        ],
        "unrelated": {"nested": ["must", "survive"]},
        "image_display_order": ["stale-value"],
    }
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DISPLAY-ORDER-1",
            "metadata": original_metadata,
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    response = client.put(
        f"/api/projects/{project_id}/parts/{part_id}/image-display-order",
        json={"image_refs": ["  overlay.png  ", "front.png"]},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    metadata = response.json()["metadata"]
    assert metadata["image_display_order"] == [
        "overlay-id",
        "front-id",
        "rear-id",
        "view-only-legacy.png",
        "side-id",
        "legacy-without-id.png",
    ]
    assert metadata["view_images"] == original_metadata["view_images"]
    assert metadata["source_images"] == original_metadata["source_images"]
    assert metadata["analysis_outputs"] == original_metadata["analysis_outputs"]
    assert metadata["unrelated"] == original_metadata["unrelated"]


@pytest.mark.parametrize(
    ("image_refs", "detail_fragment"),
    [
        ([], None),
        (["   "], None),
        (["front-id", " front-id "], None),
        (["missing.png"], "Unknown image reference"),
        (["front-id", "front.png"], "duplicates another image"),
    ],
)
def test_image_display_order_rejects_invalid_references(
    client,
    image_refs,
    detail_fragment,
):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Invalid image display order project",
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DISPLAY-ORDER-INVALID",
            "metadata": {
                "view_images": {"front": "front.png"},
                "source_images": [
                    {"filename": "front.png", "image_id": "front-id"},
                ],
            },
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text

    response = client.put(
        (
            f"/api/projects/{project_id}/parts/{part_response.json()['id']}/image-display-order"
        ),
        json={"image_refs": image_refs},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    if detail_fragment:
        assert detail_fragment in response.json()["detail"]


def test_image_display_order_rejects_ambiguous_filename_alias(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Ambiguous image display order project",
    )
    original_source_images = [
        {"filename": "shared.png", "image_id": "front-id", "side": "front"},
        {"filename": "shared.png", "image_id": "back-id", "side": "back"},
    ]
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DISPLAY-ORDER-AMBIGUOUS",
            "metadata": {
                "source_images": original_source_images,
                "unrelated": "preserve me",
            },
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    response = client.put(
        f"/api/projects/{project_id}/parts/{part_id}/image-display-order",
        json={"image_refs": ["shared.png"]},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    assert "Ambiguous image filename" in response.json()["detail"]
    persisted = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    ).json()[0]["metadata"]
    assert "image_display_order" not in persisted
    assert persisted["source_images"] == original_source_images
    assert persisted["unrelated"] == "preserve me"


def test_image_display_order_excludes_stale_view_mapping_for_deleted_source(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Deleted image display mapping project",
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DISPLAY-ORDER-DELETED-MAPPING",
            "metadata": {
                "view_images": {
                    "front": "deleted.png",
                    "back": "alive.png",
                    "overlay": "deleted-overlay.png",
                },
                "source_images": [
                    {
                        "filename": "deleted.png",
                        "image_id": "deleted-id",
                        "side": "front",
                        "delete_candidate": True,
                    },
                    {
                        "filename": "alive.png",
                        "image_id": "alive-id",
                        "side": "back",
                        "delete_candidate": "false",
                    },
                ],
                "analysis_outputs": [
                    {
                        "filename": "deleted-overlay.png",
                        "image_id": "deleted-overlay-id",
                        "analysis_output": True,
                        "overlay_delete_candidate": True,
                    },
                ],
            },
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text

    response = client.put(
        (
            f"/api/projects/{project_id}/parts/{part_response.json()['id']}/image-display-order"
        ),
        json={"image_refs": ["alive-id"]},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["metadata"]["image_display_order"] == ["alive-id"]


def test_image_display_order_does_not_resurrect_deleted_view_id_from_shared_filename(
    client,
):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Deleted shared-filename image mapping project",
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DISPLAY-ORDER-DELETED-SHARED-FILENAME",
            "metadata": {
                "view_images": {
                    "front": {
                        "image_id": "deleted-id",
                        "filename": "shared.png",
                    },
                },
                "source_images": [
                    {
                        "filename": "shared.png",
                        "image_id": "deleted-id",
                        "side": "front",
                        "delete_candidate": True,
                    },
                    {
                        "filename": "shared.png",
                        "image_id": "active-id",
                        "side": "back",
                    },
                ],
            },
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text

    response = client.put(
        (
            f"/api/projects/{project_id}/parts/{part_response.json()['id']}/image-display-order"
        ),
        json={"image_refs": ["active-id"]},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["metadata"]["image_display_order"] == ["active-id"]


def test_image_display_order_rejects_archived_project_mutation(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Archived image display order project",
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DISPLAY-ORDER-ARCHIVED",
            "metadata": {
                "source_images": [
                    {
                        "filename": "front.png",
                        "image_id": "front-id",
                        "side": "front",
                    },
                    {
                        "filename": "back.png",
                        "image_id": "back-id",
                        "side": "back",
                    },
                ],
            },
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    archive_response = client.patch(
        f"/api/projects/{project_id}/archive",
        headers=headers,
    )
    assert archive_response.status_code == 200, archive_response.text

    response = client.put(
        (
            f"/api/projects/{project_id}/parts/{part_response.json()['id']}/image-display-order"
        ),
        json={"image_refs": ["back-id", "front-id"]},
        headers=headers,
    )

    assert response.status_code == 403, response.text
    assert "archived" in response.json()["detail"].lower()


def test_image_assignment_can_move_image_back_to_unassigned(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Unassign image project"
    )
    uploaded = _upload_part_test_image(client, project_id, headers, "assignable.png")
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-UNASSIGN", "display_name": "Unassign Target"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    assign_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": uploaded["filename"], "to_part_id": part_id},
        headers=headers,
    )
    assert assign_response.status_code == 200, assign_response.text

    unassign_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": uploaded["filename"], "to_part_id": None},
        headers=headers,
    )
    assert unassign_response.status_code == 200, unassign_response.text
    assert unassign_response.json()["from_part_id"] == part_id
    assert unassign_response.json()["to_part_id"] is None

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200
    assert parts_response.json()[0]["metadata"]["source_images"] == []


def test_image_assignment_preserves_crop_child_metadata(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Crop child image project"
    )
    crop_metadata = {
        "crop_child_image": True,
        "parent_image_id": "parent-image-1",
        "parent_image_filename": "parent.png",
        "crop_annotation_id": "annotation-box-1",
        "crop_title": "12_34_crop of parent.png",
        "crop_bbox": {"x": 12, "y": 34, "width": 56, "height": 78},
        "side": "crop",
        "modality": "visual",
    }
    uploaded = _upload_part_test_image(
        client,
        project_id,
        headers,
        "12_34_crop of parent.png.png",
        metadata=crop_metadata,
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-CROP", "display_name": "Crop Target"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    assign_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": uploaded["filename"], "to_part_id": part_id},
        headers=headers,
    )
    assert assign_response.status_code == 200, assign_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    source_image = parts_response.json()[0]["metadata"]["source_images"][0]
    assert source_image["crop_child_image"] is True
    assert source_image["parent_image_id"] == "parent-image-1"
    assert source_image["parent_image_filename"] == "parent.png"
    assert source_image["crop_annotation_id"] == "annotation-box-1"
    assert source_image["crop_bbox"] == {"x": 12, "y": 34, "width": 56, "height": 78}


def test_delete_part_removes_part_without_deleting_images(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Delete part project"
    )
    uploaded = _upload_part_test_image(
        client, project_id, headers, "survives-part-delete.png"
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "SN-DELETE",
            "display_name": "Delete Target",
            "metadata": {"indexed_delete_marker": "remove-with-part"},
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    retained_part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "SN-KEEP",
            "display_name": "Retained Target",
            "metadata": {"indexed_delete_marker": "must-remain"},
        },
        headers=headers,
    )
    assert retained_part_response.status_code == 201, retained_part_response.text
    assign_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": uploaded["filename"], "to_part_id": part_id},
        headers=headers,
    )
    assert assign_response.status_code == 200, assign_response.text

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts/{part_id}", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200
    assert [part["serial_number"] for part in parts_response.json()] == ["SN-KEEP"]
    assert (
        parts_response.json()[0]["metadata"]["indexed_delete_marker"] == "must-remain"
    )
    images_response = client.get(f"/api/projects/{project_id}/images", headers=headers)
    assert images_response.status_code == 200
    assert [image["filename"] for image in images_response.json()] == [
        uploaded["filename"]
    ]


def _drop_part_metadata_fields_table():
    async def drop_table():
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE inspection_part_metadata_fields"))

    asyncio.get_event_loop().run_until_complete(drop_table())


def _replace_part_metadata_fields_table_without_project_id(part_id):
    async def replace_table():
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE inspection_part_metadata_fields"))
            await conn.execute(
                text(
                    """
                CREATE TABLE inspection_part_metadata_fields (
                    id VARCHAR PRIMARY KEY,
                    part_id VARCHAR NOT NULL,
                    source_ref VARCHAR NOT NULL,
                    field_path_hash VARCHAR NOT NULL
                )
                """
                )
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO inspection_part_metadata_fields (
                        id,
                        part_id,
                        source_ref,
                        field_path_hash
                    ) VALUES (
                        :id,
                        :part_id,
                        'legacy-source',
                        'legacy-path-hash'
                    )
                    """
                ),
                {"id": str(uuid.uuid4()), "part_id": str(part_id)},
            )

    asyncio.get_event_loop().run_until_complete(replace_table())


def test_delete_part_succeeds_when_metadata_field_table_is_missing(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Delete part without metadata fields table project",
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-DELETE-MISSING-FIELDS"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    _drop_part_metadata_fields_table()

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts/{part_id}", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    assert parts_response.json() == []


def test_delete_part_succeeds_when_metadata_field_table_lacks_project_id(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Delete part with legacy metadata fields table project",
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-DELETE-LEGACY-FIELDS"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    _replace_part_metadata_fields_table_without_project_id(part_id)

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts/{part_id}", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    assert parts_response.json() == []


def test_delete_all_parts_succeeds_when_metadata_field_table_lacks_project_id(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Bulk delete with legacy metadata fields table project",
    )
    part_ids = []
    for serial_number in ("SN-BULK-LEGACY-FIELDS-1", "SN-BULK-LEGACY-FIELDS-2"):
        part_response = client.post(
            f"/api/projects/{project_id}/parts",
            json={"serial_number": serial_number},
            headers=headers,
        )
        assert part_response.status_code == 201, part_response.text
        part_ids.append(part_response.json()["id"])
    _replace_part_metadata_fields_table_without_project_id(part_ids[0])

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    assert parts_response.json() == []


def test_delete_all_parts_succeeds_when_metadata_field_table_is_missing(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Bulk delete without metadata fields table project",
    )
    for serial_number in ("SN-BULK-MISSING-FIELDS-1", "SN-BULK-MISSING-FIELDS-2"):
        part_response = client.post(
            f"/api/projects/{project_id}/parts",
            json={"serial_number": serial_number},
            headers=headers,
        )
        assert part_response.status_code == 201, part_response.text
    _drop_part_metadata_fields_table()

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    assert parts_response.json() == []


def test_delete_all_parts_is_project_scoped_idempotent_and_preserves_images_and_batches(
    client,
):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Bulk delete parts project"
    )
    other_project_id, _ = _create_project_for_part_image_tests(
        client, "Bulk delete isolation project"
    )
    uploaded = _upload_part_test_image(
        client, project_id, headers, "survives-bulk-part-delete.png"
    )

    batch_response = client.post(
        f"/api/projects/{project_id}/batches",
        json={"name": "preserved-batch", "description": "must survive part deletion"},
        headers=headers,
    )
    assert batch_response.status_code == 201, batch_response.text
    batch_id = batch_response.json()["id"]

    for serial_number in ("SN-BULK-ONE", "SN-BULK-TWO"):
        part_response = client.post(
            f"/api/projects/{project_id}/parts",
            json={
                "serial_number": serial_number,
                "display_name": serial_number,
                "batch_id": batch_id,
            },
            headers=headers,
        )
        assert part_response.status_code == 201, part_response.text

    other_part_response = client.post(
        f"/api/projects/{other_project_id}/parts",
        json={"serial_number": "SN-OTHER", "display_name": "Other project part"},
        headers=headers,
    )
    assert other_part_response.status_code == 201, other_part_response.text

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text
    assert client.get(f"/api/projects/{project_id}/parts", headers=headers).json() == []

    remaining_batches = client.get(
        f"/api/projects/{project_id}/batches", headers=headers
    )
    assert remaining_batches.status_code == 200, remaining_batches.text
    assert [batch["id"] for batch in remaining_batches.json()] == [batch_id]

    remaining_images = client.get(f"/api/projects/{project_id}/images", headers=headers)
    assert remaining_images.status_code == 200, remaining_images.text
    assert [image["filename"] for image in remaining_images.json()] == [
        uploaded["filename"]
    ]

    other_parts = client.get(f"/api/projects/{other_project_id}/parts", headers=headers)
    assert other_parts.status_code == 200, other_parts.text
    assert [part["serial_number"] for part in other_parts.json()] == ["SN-OTHER"]

    repeated_delete_response = client.delete(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert repeated_delete_response.status_code == 204, repeated_delete_response.text


def test_delete_all_parts_requires_project_access(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Bulk delete access project"
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-ACCESS", "display_name": "Access protected part"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text

    with patch("utils.dependencies.is_user_in_group", return_value=False):
        forbidden_response = client.delete(
            f"/api/projects/{project_id}/parts",
            headers={"X-User-Id": "outsider@example.com"},
        )
    assert forbidden_response.status_code == 403, forbidden_response.text

    remaining_parts = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert [part["serial_number"] for part in remaining_parts.json()] == ["SN-ACCESS"]


def test_delete_all_parts_matches_single_part_delete_behavior_for_archived_projects(
    client,
):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Archived bulk delete project"
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-ARCHIVED", "display_name": "Archived project part"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    archive_response = client.patch(
        f"/api/projects/{project_id}/archive", headers=headers
    )
    assert archive_response.status_code == 200, archive_response.text

    delete_response = client.delete(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert delete_response.status_code == 204, delete_response.text
    assert client.get(f"/api/projects/{project_id}/parts", headers=headers).json() == []


def test_overlay_assignment_maps_overlay_to_base_image(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Overlay assignment project"
    )
    base = _upload_part_test_image(
        client, project_id, headers, "base.png", {"side": "front", "modality": "visual"}
    )
    overlay = _upload_part_test_image(
        client,
        project_id,
        headers,
        "overlay.png",
        {"modality": "heatmap", "overlay": True},
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-OVERLAY", "display_name": "Overlay Target"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    assign_base = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": base["filename"], "to_part_id": part_id},
        headers=headers,
    )
    assert assign_base.status_code == 200, assign_base.text

    assign_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": overlay["filename"],
            "base_filename": base["filename"],
        },
        headers=headers,
    )
    assert assign_overlay.status_code == 200, assign_overlay.text
    assert assign_overlay.json()["to_part_id"] == part_id

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    metadata = parts_response.json()[0]["metadata"]
    overlay_records = [
        record for record in metadata["source_images"] if record.get("overlay")
    ]
    assert len(overlay_records) == 1
    assert overlay_records[0]["filename"] == "overlay.png"
    assert overlay_records[0]["overlay_base_filename"] == "base.png"
    assert overlay_records[0]["overlay_base_image_id"] == base["id"]
    assert overlay_records[0]["side"] == "front"


def test_volume_assignment_preserves_scalar_source_and_rgba_overlay_layout(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Scalar source with RGBA overlay project",
    )
    base = _upload_part_test_volume(
        client,
        project_id,
        headers,
        "base-volume.npy",
        np.arange(2 * 3 * 4, dtype=np.uint16).reshape((2, 3, 4)),
        {"side": "axial", "modality": "volume"},
    )
    overlay_array = np.zeros((2, 3, 4, 4), dtype=np.uint8)
    overlay_array[..., 0] = 255
    overlay_array[..., 3] = 128
    overlay = _upload_part_test_volume(
        client,
        project_id,
        headers,
        "segments-rgba.npy",
        overlay_array,
        {"modality": "segments", "overlay": True},
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "PT3-RGBA", "display_name": "RGBA overlay target"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    assign_base = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": base["filename"],
            "image_id": base["id"],
            "to_part_id": part_id,
        },
        headers=headers,
    )
    assert assign_base.status_code == 200, assign_base.text
    assign_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": overlay["filename"],
            "overlay_image_id": overlay["id"],
            "base_filename": base["filename"],
            "base_image_id": base["id"],
        },
        headers=headers,
    )
    assert assign_overlay.status_code == 200, assign_overlay.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    source_images = parts_response.json()[0]["metadata"]["source_images"]
    base_record = next(
        record for record in source_images if record["image_id"] == base["id"]
    )
    overlay_record = next(
        record for record in source_images if record["image_id"] == overlay["id"]
    )

    assert base_record["volume_shape"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert base_record["channel_count"] == 1
    assert base_record["color_mode"] == "scalar"
    assert base_record["metadata"]["color_mode"] == "scalar"
    assert overlay_record["volume_shape"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert overlay_record["channel_count"] == 4
    assert overlay_record["color_mode"] == "rgba"
    assert overlay_record["metadata"]["channel_count"] == 4
    assert overlay_record["overlay"] is True
    assert overlay_record["overlay_base_image_id"] == base["id"]


def test_reassignment_refreshes_legacy_volume_layout_and_keeps_assignment_state(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Refresh legacy volume assignment metadata",
    )
    base = _upload_part_test_volume(
        client,
        project_id,
        headers,
        "fresh-scalar.npy",
        np.zeros((2, 3, 4), dtype=np.uint16),
        {"side": "axial", "modality": "volume"},
    )
    overlay_array = np.zeros((2, 3, 4, 4), dtype=np.uint8)
    overlay_array[..., 1] = 255
    overlay_array[..., 3] = 160
    overlay = _upload_part_test_volume(
        client,
        project_id,
        headers,
        "fresh-segments.npy",
        overlay_array,
        {
            "modality": "segments",
            "overlay": True,
            "slice_axis": "axial",
            "slice_index": 1,
        },
    )
    stale_shape = {"axial": 9, "coronal": 9, "sagittal": 9}
    source_part = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "LEGACY-SOURCE",
            "metadata": {
                "source_images": [
                    {
                        "filename": base["filename"],
                        "image_id": base["id"],
                        "overlay": False,
                        "hidden": True,
                        "assignment_note": "keep base state",
                        "volume_shape": stale_shape,
                        "channel_count": 4,
                        "color_mode": "rgba",
                        "metadata": {
                            "volume_shape": stale_shape,
                            "channel_count": 4,
                            "color_mode": "rgba",
                            "assignment_detail": "keep nested base state",
                        },
                    },
                    {
                        "filename": overlay["filename"],
                        "image_id": overlay["id"],
                        "overlay": True,
                        "hidden": True,
                        "assignment_note": "keep overlay state",
                        "volume_shape": stale_shape,
                        "channel_count": 1,
                        "color_mode": "scalar",
                        "slice_axis": "coronal",
                        "slice_index": 9,
                        "metadata": {
                            "volume_shape": stale_shape,
                            "channel_count": 1,
                            "color_mode": "scalar",
                            "assignment_detail": "keep nested overlay state",
                        },
                    },
                ],
            },
        },
        headers=headers,
    )
    assert source_part.status_code == 201, source_part.text
    target_part = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "LEGACY-TARGET"},
        headers=headers,
    )
    assert target_part.status_code == 201, target_part.text
    target_part_id = target_part.json()["id"]

    move_base = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": base["filename"],
            "image_id": base["id"],
            "to_part_id": target_part_id,
        },
        headers=headers,
    )
    assert move_base.status_code == 200, move_base.text
    move_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": overlay["filename"],
            "overlay_image_id": overlay["id"],
            "base_filename": base["filename"],
            "base_image_id": base["id"],
        },
        headers=headers,
    )
    assert move_overlay.status_code == 200, move_overlay.text

    parts = client.get(f"/api/projects/{project_id}/parts", headers=headers).json()
    target_records = next(part for part in parts if part["id"] == target_part_id)[
        "metadata"
    ]["source_images"]
    refreshed_base = next(
        record for record in target_records if record["image_id"] == base["id"]
    )
    refreshed_overlay = next(
        record for record in target_records if record["image_id"] == overlay["id"]
    )

    assert refreshed_base["volume_shape"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert refreshed_base["channel_count"] == 1
    assert refreshed_base["color_mode"] == "scalar"
    assert refreshed_base["hidden"] is True
    assert refreshed_base["assignment_note"] == "keep base state"
    assert refreshed_base["metadata"]["assignment_detail"] == "keep nested base state"
    assert refreshed_base["metadata"]["color_mode"] == "scalar"
    assert refreshed_overlay["volume_shape"] == {
        "axial": 2,
        "coronal": 3,
        "sagittal": 4,
    }
    assert refreshed_overlay["channel_count"] == 4
    assert refreshed_overlay["color_mode"] == "rgba"
    assert refreshed_overlay["hidden"] is True
    assert refreshed_overlay["assignment_note"] == "keep overlay state"
    assert (
        refreshed_overlay["metadata"]["assignment_detail"]
        == "keep nested overlay state"
    )
    assert refreshed_overlay["metadata"]["color_mode"] == "rgba"
    assert refreshed_overlay["slice_axis"] == "axial"
    assert refreshed_overlay["slice_index"] == 1
    assert refreshed_overlay["overlay_base_image_id"] == base["id"]


def test_overlay_hidden_patch_preserves_assigned_source_metadata(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Overlay visibility project"
    )
    base = _upload_part_test_image(
        client,
        project_id,
        headers,
        "visibility-base.png",
        {"side": "front", "modality": "volume"},
    )
    overlay = _upload_part_test_image(
        client,
        project_id,
        headers,
        "visibility-overlay.png",
        {
            "modality": "mask",
            "overlay": True,
            "crop_subtitle": "legacy metadata must survive",
            "pixel_dtype": "uint16",
            "pixel_value_range": [0, 4095],
            "signed": False,
        },
    )
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "PT3-OVERLAY-HIDDEN",
            "display_name": "Overlay visibility",
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/image-assignments",
            json={
                "filename": base["filename"],
                "image_id": base["id"],
                "to_part_id": part_id,
            },
            headers=headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/image-assignments",
            json={
                "filename": overlay["filename"],
                "image_id": overlay["id"],
                "to_part_id": part_id,
            },
            headers=headers,
        ).status_code
        == 200
    )
    assign_overlay_resp = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": overlay["filename"],
            "overlay_image_id": overlay["id"],
            "base_filename": base["filename"],
            "base_image_id": base["id"],
        },
        headers=headers,
    )
    assert assign_overlay_resp.status_code == 200, assign_overlay_resp.text

    before_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert before_resp.status_code == 200, before_resp.text
    before_overlay = next(
        record
        for record in before_resp.json()[0]["metadata"]["source_images"]
        if record.get("image_id") == overlay["id"]
    )
    assert "hidden" not in before_overlay

    patch_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/source-images/{overlay['id']}",
        json={"hidden": True},
        headers=headers,
    )
    assert patch_resp.status_code == 200, patch_resp.text
    after_overlay = next(
        record
        for record in patch_resp.json()["metadata"]["source_images"]
        if record.get("image_id") == overlay["id"]
    )
    assert after_overlay == {**before_overlay, "hidden": True}
    assert after_overlay["overlay_base_image_id"] == base["id"]
    assert after_overlay["crop_subtitle"] == "legacy metadata must survive"
    assert after_overlay["metadata"]["pixel_value_range"] == [0, 4095]


def test_overlay_style_patch_updates_assigned_source_metadata(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Overlay style project"
    )
    base = _upload_part_test_image(
        client,
        project_id,
        headers,
        "style-base.png",
        {"side": "front", "modality": "volume"},
    )
    overlay = _upload_part_test_image(
        client,
        project_id,
        headers,
        "style-overlay.png",
        {
            "modality": "mask",
            "overlay": True,
            "overlay_color": "#ff0000",
            "overlay_opacity": 0.25,
        },
    )
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "PT3-OVERLAY-STYLE", "display_name": "Overlay style"},
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/image-assignments",
            json={
                "filename": base["filename"],
                "image_id": base["id"],
                "to_part_id": part_id,
            },
            headers=headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/image-assignments",
            json={
                "filename": overlay["filename"],
                "image_id": overlay["id"],
                "to_part_id": part_id,
            },
            headers=headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/overlay-assignments",
            json={
                "overlay_filename": overlay["filename"],
                "overlay_image_id": overlay["id"],
                "base_filename": base["filename"],
                "base_image_id": base["id"],
            },
            headers=headers,
        ).status_code
        == 200
    )

    patch_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/source-images/{overlay['id']}",
        json={"overlay_color": "#22c55e", "overlay_opacity": 0.35},
        headers=headers,
    )

    assert patch_resp.status_code == 200, patch_resp.text
    after_overlay = next(
        record
        for record in patch_resp.json()["metadata"]["source_images"]
        if record.get("image_id") == overlay["id"]
    )
    assert after_overlay["overlay_color"] == "#22c55e"
    assert after_overlay["overlay_opacity"] == 0.35


def test_overlay_hidden_patch_updates_analysis_output_when_no_source_image_record_exists(
    client,
):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Analysis output visibility project"
    )
    analysis_output = {
        "filename": "analysis-only-overlay.png",
        "image_id": "analysis-only-overlay-id",
        "label": "Analysis-only overlay",
        "overlay": True,
        "analysis_output": True,
        "overlay_base_image_id": "base-image-id",
        "metadata": {"method": "watershed", "threshold": 17},
    }
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "ANALYSIS-OUTPUT-ONLY",
            "display_name": "Analysis output visibility",
            "metadata": {"analysis_outputs": [analysis_output]},
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/source-images/{analysis_output['image_id']}",
        json={"hidden": True},
        headers=headers,
    )
    assert patch_resp.status_code == 200, patch_resp.text
    updated_output = patch_resp.json()["metadata"]["analysis_outputs"][0]
    assert updated_output == {**analysis_output, "hidden": True}
    assert updated_output["metadata"] == analysis_output["metadata"]


def test_overlay_assignment_can_unassign_overlay(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Overlay unassignment project"
    )
    base = _upload_part_test_image(
        client, project_id, headers, "base-unassign.png", {"side": "front"}
    )
    overlay = _upload_part_test_image(
        client, project_id, headers, "overlay-unassign.png", {"overlay": True}
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "SN-OVERLAY-UNASSIGN",
            "display_name": "Overlay Unassign Target",
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/image-assignments",
            json={"filename": base["filename"], "to_part_id": part_id},
            headers=headers,
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/projects/{project_id}/parts/overlay-assignments",
            json={
                "overlay_filename": overlay["filename"],
                "base_filename": base["filename"],
            },
            headers=headers,
        ).status_code
        == 200
    )

    unassign_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={"overlay_filename": overlay["filename"], "base_filename": None},
        headers=headers,
    )
    assert unassign_overlay.status_code == 200, unassign_overlay.text
    assert unassign_overlay.json()["from_part_id"] == part_id
    assert unassign_overlay.json()["to_part_id"] is None

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    assert [
        record
        for record in parts_response.json()[0]["metadata"]["source_images"]
        if record.get("overlay")
    ] == []


@pytest.mark.parametrize(
    ("overlay_value", "expected"),
    [
        ("overlay", True),
        ("ov", True),
        ("mask", True),
        ("heatmap", True),
        ("true", True),
        ("yes", True),
        ("1", True),
        ("false", False),
        ("no", False),
        ("0", False),
        ("off", False),
    ],
)
def test_filename_metadata_overlay_coercion_preserves_keywords_and_strict_false_values(
    overlay_value,
    expected,
):
    from services.inspection import fixture_metadata

    coerced = fixture_metadata.coerce_filename_metadata({"overlay": overlay_value})

    assert coerced["overlay"] is expected


def test_image_assignment_requires_id_for_duplicate_filename_without_mutation(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Duplicate filename image assignment",
    )
    images = [
        _upload_part_test_image(
            client,
            project_id,
            headers,
            "shared.png",
            {
                "side": side,
                "modality": "mask",
                "overlay": "false",
            },
        )
        for side in ("front", "back", "top")
    ]
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DUPLICATE-IMAGE-ASSIGNMENT",
            "metadata": {"sentinel": "unchanged"},
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    original_metadata = part_response.json()["metadata"]

    ambiguous_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": "shared.png", "to_part_id": part_id},
        headers=headers,
    )
    assert ambiguous_response.status_code == 422, ambiguous_response.text
    assert "image_id" in ambiguous_response.json()["detail"]
    unchanged_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert unchanged_response.status_code == 200, unchanged_response.text
    assert unchanged_response.json()[0]["metadata"] == original_metadata

    selected_image = images[1]
    exact_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": "stale-client-name.png",
            "image_id": selected_image["id"],
            "to_part_id": part_id,
        },
        headers=headers,
    )
    assert exact_response.status_code == 200, exact_response.text
    assert exact_response.json()["filename"] == "shared.png"

    assigned_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert assigned_response.status_code == 200, assigned_response.text
    assigned_metadata = assigned_response.json()[0]["metadata"]
    assert [record["image_id"] for record in assigned_metadata["source_images"]] == [
        selected_image["id"]
    ]
    assert assigned_metadata["source_images"][0]["overlay"] is False

    stale_response = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": "shared.png",
            "image_id": str(uuid.uuid4()),
            "to_part_id": part_id,
        },
        headers=headers,
    )
    assert stale_response.status_code == 404, stale_response.text
    after_stale_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert after_stale_response.status_code == 200, after_stale_response.text
    assert after_stale_response.json()[0]["metadata"] == assigned_metadata


def test_overlay_assignment_resolves_duplicate_names_by_ids_before_mutation(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Duplicate filename overlay assignment",
    )
    base = _upload_part_test_image(
        client,
        project_id,
        headers,
        "scan.png",
        {"side": "axial", "modality": "volume", "overlay": "false"},
    )
    overlays = [
        _upload_part_test_image(
            client,
            project_id,
            headers,
            "scan.png",
            {"modality": "mask", "overlay": "true"},
        )
        for _ in range(2)
    ]
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "DUPLICATE-OVERLAY-ASSIGNMENT"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    base_assignment = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": "scan.png",
            "image_id": base["id"],
            "to_part_id": part_id,
        },
        headers=headers,
    )
    assert base_assignment.status_code == 200, base_assignment.text
    before_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert before_response.status_code == 200, before_response.text
    before_metadata = before_response.json()[0]["metadata"]

    ambiguous_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": "scan.png",
            "base_filename": "scan.png",
        },
        headers=headers,
    )
    assert ambiguous_overlay.status_code == 422, ambiguous_overlay.text
    assert "overlay_image_id" in ambiguous_overlay.json()["detail"]

    ambiguous_base = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": "scan.png",
            "overlay_image_id": overlays[0]["id"],
            "base_filename": "scan.png",
        },
        headers=headers,
    )
    assert ambiguous_base.status_code == 422, ambiguous_base.text
    assert "base_image_id" in ambiguous_base.json()["detail"]

    stale_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": "scan.png",
            "overlay_image_id": str(uuid.uuid4()),
            "base_image_id": base["id"],
        },
        headers=headers,
    )
    assert stale_overlay.status_code == 404, stale_overlay.text

    stale_base = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": "scan.png",
            "overlay_image_id": overlays[0]["id"],
            "base_filename": "scan.png",
            "base_image_id": str(uuid.uuid4()),
        },
        headers=headers,
    )
    assert stale_base.status_code == 404, stale_base.text

    unchanged_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert unchanged_response.status_code == 200, unchanged_response.text
    assert unchanged_response.json()[0]["metadata"] == before_metadata

    exact_response = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": "stale-client-name.png",
            "overlay_image_id": overlays[0]["id"],
            "base_image_id": base["id"],
        },
        headers=headers,
    )
    assert exact_response.status_code == 200, exact_response.text
    assert exact_response.json()["overlay_filename"] == "scan.png"
    assert exact_response.json()["base_filename"] == "scan.png"
    assert exact_response.json()["to_part_id"] == part_id

    assigned_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert assigned_response.status_code == 200, assigned_response.text
    source_images = assigned_response.json()[0]["metadata"]["source_images"]
    assert {record["image_id"] for record in source_images} == {
        base["id"],
        overlays[0]["id"],
    }
    overlay_record = next(
        record for record in source_images if record["image_id"] == overlays[0]["id"]
    )
    assert overlay_record["overlay_base_image_id"] == base["id"]


def test_overlay_assignment_keeps_existing_overlay_when_base_is_not_assigned(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Unassigned overlay base preserves source",
    )
    current_base = _upload_part_test_image(
        client,
        project_id,
        headers,
        "current-base.png",
        {"side": "front", "modality": "visual", "overlay": False},
    )
    unassigned_base = _upload_part_test_image(
        client,
        project_id,
        headers,
        "unassigned-base.png",
        {"side": "back", "modality": "visual", "overlay": False},
    )
    overlay = _upload_part_test_image(
        client,
        project_id,
        headers,
        "assigned-overlay.png",
        {"modality": "mask", "overlay": True},
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "OVERLAY-SOURCE-PRESERVED"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    base_assignment = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": current_base["filename"],
            "image_id": current_base["id"],
            "to_part_id": part_id,
        },
        headers=headers,
    )
    assert base_assignment.status_code == 200, base_assignment.text
    overlay_assignment = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": overlay["filename"],
            "overlay_image_id": overlay["id"],
            "base_filename": current_base["filename"],
            "base_image_id": current_base["id"],
        },
        headers=headers,
    )
    assert overlay_assignment.status_code == 200, overlay_assignment.text
    before_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert before_response.status_code == 200, before_response.text
    before_metadata = before_response.json()[0]["metadata"]

    invalid_target = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": overlay["filename"],
            "overlay_image_id": overlay["id"],
            "base_filename": unassigned_base["filename"],
            "base_image_id": unassigned_base["id"],
        },
        headers=headers,
    )
    assert invalid_target.status_code == 404, invalid_target.text
    assert "not assigned" in invalid_target.json()["detail"]

    after_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert after_response.status_code == 200, after_response.text
    assert after_response.json()[0]["metadata"] == before_metadata


def test_source_image_patch_rejects_ambiguous_filename_and_prefers_exact_id(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Duplicate filename source patch",
    )
    first_id = str(uuid.uuid4())
    second_id = str(uuid.uuid4())
    analysis_id = str(uuid.uuid4())
    original_metadata = {
        "sentinel": {"preserve": True},
        "source_images": [
            {
                "filename": "repeat.png",
                "image_id": first_id,
                "side": "front",
                "modality": "visual",
                "overlay": "false",
                "hidden": False,
            },
            {
                "filename": "repeat.png",
                "image_id": second_id,
                "side": "front",
                "modality": "mask",
                "overlay": "true",
                "hidden": False,
            },
        ],
        "analysis_outputs": [
            {
                "filename": "repeat.png",
                "image_id": analysis_id,
                "analysis_output": True,
                "overlay": True,
                "hidden": False,
            }
        ],
    }
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "DUPLICATE-SOURCE-PATCH",
            "metadata": original_metadata,
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    ambiguous_response = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/source-images/repeat.png",
        json={"hidden": True},
        headers=headers,
    )
    assert ambiguous_response.status_code == 422, ambiguous_response.text
    assert "exact image_id" in ambiguous_response.json()["detail"]
    unchanged_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert unchanged_response.status_code == 200, unchanged_response.text
    assert unchanged_response.json()[0]["metadata"] == original_metadata

    exact_response = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/source-images/{second_id}",
        json={"hidden": True},
        headers=headers,
    )
    assert exact_response.status_code == 200, exact_response.text
    exact_metadata = exact_response.json()["metadata"]
    source_by_id = {
        record["image_id"]: record for record in exact_metadata["source_images"]
    }
    assert source_by_id[first_id]["hidden"] is False
    assert source_by_id[first_id]["overlay"] is False
    assert source_by_id[second_id]["hidden"] is True
    assert source_by_id[second_id]["overlay"] is True
    assert exact_metadata["analysis_outputs"][0]["hidden"] is False
    assert exact_metadata["sentinel"] == original_metadata["sentinel"]


def test_source_image_patch_does_not_fallback_from_missing_uuid_to_filename(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "UUID-shaped source filename collision",
    )
    missing_image_id = str(uuid.uuid4())
    actual_image_id = str(uuid.uuid4())
    original_metadata = {
        "sentinel": {"preserve": True},
        "source_images": [
            {
                "filename": missing_image_id,
                "image_id": actual_image_id,
                "side": "front",
                "modality": "visual",
                "overlay": "false",
                "hidden": False,
            },
        ],
    }
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "UUID-SOURCE-FILENAME-COLLISION",
            "metadata": original_metadata,
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    missing_id_response = client.patch(
        (
            f"/api/projects/{project_id}/parts/{part_id}/source-images/{missing_image_id}"
        ),
        json={"hidden": True},
        headers=headers,
    )
    assert missing_id_response.status_code == 404, missing_id_response.text

    unchanged_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert unchanged_response.status_code == 200, unchanged_response.text
    assert unchanged_response.json()[0]["metadata"] == original_metadata

    exact_response = client.patch(
        (f"/api/projects/{project_id}/parts/{part_id}/source-images/{actual_image_id}"),
        json={"hidden": True},
        headers=headers,
    )
    assert exact_response.status_code == 200, exact_response.text
    assert exact_response.json()["metadata"]["source_images"][0]["hidden"] is True


def test_source_image_patch_rejects_missing_part(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Source image patch missing part",
    )
    missing_part_id = str(uuid.uuid4())

    response = client.patch(
        f"/api/projects/{project_id}/parts/{missing_part_id}/source-images/front.png",
        json={"hidden": True},
        headers=headers,
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Inspection part not found"


def test_source_image_patch_rejects_missing_filename_without_mutation(client):
    project_id, headers = _create_project_for_part_image_tests(
        client,
        "Source image patch missing filename",
    )
    original_metadata = {
        "sentinel": {"preserve": True},
        "source_images": [
            {
                "filename": "front.png",
                "image_id": str(uuid.uuid4()),
                "side": "front",
                "modality": "visual",
                "overlay": "false",
                "hidden": False,
            },
        ],
    }
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "MISSING-SOURCE-FILENAME",
            "metadata": original_metadata,
        },
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    response = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/source-images/missing.png",
        json={"hidden": True},
        headers=headers,
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Source image not found"
    unchanged_response = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert unchanged_response.status_code == 200, unchanged_response.text
    assert unchanged_response.json()[0]["metadata"] == original_metadata


def test_duplicate_filename_assignment_and_overlay_use_image_ids(client):
    project_id, headers = _create_project_for_part_image_tests(
        client, "Duplicate filename PT3 overlay project"
    )
    base = _upload_part_test_image(
        client, project_id, headers, "scan.png", {"side": "axial", "modality": "volume"}
    )
    overlay = _upload_part_test_image(
        client, project_id, headers, "scan.png", {"modality": "mask", "overlay": True}
    )
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "PT3-DUP", "display_name": "PT3 duplicate stack"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]

    assign_base = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": "scan.png", "image_id": base["id"], "to_part_id": part_id},
        headers=headers,
    )
    assert assign_base.status_code == 200, assign_base.text

    assign_overlay = client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={
            "overlay_filename": "scan.png",
            "overlay_image_id": overlay["id"],
            "base_filename": "scan.png",
            "base_image_id": base["id"],
        },
        headers=headers,
    )
    assert assign_overlay.status_code == 200, assign_overlay.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    source_images = parts_response.json()[0]["metadata"]["source_images"]
    base_records = [record for record in source_images if not record.get("overlay")]
    overlay_records = [record for record in source_images if record.get("overlay")]
    assert [record["image_id"] for record in base_records] == [base["id"]]
    assert [record["image_id"] for record in overlay_records] == [overlay["id"]]
    assert overlay_records[0]["overlay_base_image_id"] == base["id"]


@pytest.mark.parametrize("assignment_kind", ["image", "overlay"])
def test_part_image_assignments_transform_fresh_locked_source_records(
    client,
    monkeypatch,
    assignment_kind,
):
    from repositories import inspection as inspection_repository

    project_id, headers = _create_project_for_part_image_tests(
        client,
        f"Concurrent {assignment_kind} assignment project",
    )
    moving = _upload_part_test_image(
        client,
        project_id,
        headers,
        f"concurrent-{assignment_kind}.png",
        (
            {"modality": "mask", "overlay": True}
            if assignment_kind == "overlay"
            else {"side": "back", "modality": "visual"}
        ),
    )
    base = None
    if assignment_kind == "overlay":
        base = _upload_part_test_image(
            client,
            project_id,
            headers,
            "concurrent-base.png",
            {"side": "front", "modality": "visual"},
        )
    target_anchor = base or _upload_part_test_image(
        client,
        project_id,
        headers,
        "concurrent-target-anchor.png",
        {"side": "front", "modality": "reference"},
    )

    part_ids = {}
    seed_annotations = {}
    for role in ("source", "target"):
        seed_annotation = {
            "id": f"seed-{role}",
            "defect_class": f"seed {role} annotation",
        }
        part_resp = client.post(
            f"/api/projects/{project_id}/parts",
            json={
                "serial_number": f"CONCURRENT-{assignment_kind.upper()}-{role.upper()}",
                "display_name": f"Concurrent {role}",
                "metadata": {
                    "annotations": [seed_annotation],
                    "unrelated_state": {"revision": "stale", "role": role},
                },
            },
            headers=headers,
        )
        assert part_resp.status_code == 201, part_resp.text
        part_ids[role] = part_resp.json()["id"]
        seed_annotations[part_ids[role]] = seed_annotation

    initial_moving_assignment = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": moving["filename"],
            "image_id": moving["id"],
            "to_part_id": part_ids["source"],
        },
        headers=headers,
    )
    assert initial_moving_assignment.status_code == 200, initial_moving_assignment.text
    initial_anchor_assignment = client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={
            "filename": target_anchor["filename"],
            "image_id": target_anchor["id"],
            "to_part_id": part_ids["target"],
        },
        headers=headers,
    )
    assert initial_anchor_assignment.status_code == 200, initial_anchor_assignment.text

    original_update = (
        inspection_repository.update_inspection_part_metadata
    )
    original_locked_mutation = inspection_repository.mutate_inspection_part_metadata_locked
    injected_part_ids = set()

    before_assignment_resp = client.get(
        f"/api/projects/{project_id}/parts",
        headers=headers,
    )
    assert before_assignment_resp.status_code == 200, before_assignment_resp.text
    source_images_before = {
        part["id"]: part["metadata"].get("source_images", [])
        for part in before_assignment_resp.json()
    }
    role_by_part_id = {part_id: role for role, part_id in part_ids.items()}

    async def mutate_after_concurrent_source_record_save(*args, **kwargs):
        mutation_part_id = str(kwargs.get("part_id"))
        if (
            mutation_part_id in seed_annotations
            and mutation_part_id not in injected_part_ids
        ):
            injected_part_ids.add(mutation_part_id)
            mutation_role = role_by_part_id[mutation_part_id]
            concurrent_annotation = {
                "id": f"concurrent-{mutation_part_id}",
                "defect_class": "saved after assignment read",
            }
            concurrently_edited_source_images = []
            for record in source_images_before[mutation_part_id]:
                edited_record = dict(record)
                if mutation_role == "source" and record.get("image_id") == moving["id"]:
                    edited_record.update(
                        {
                            "hidden": True,
                            "concurrent_record_revision": "source-fresh",
                        }
                    )
                if (
                    mutation_role == "target"
                    and record.get("image_id") == target_anchor["id"]
                ):
                    edited_record.update(
                        {
                            "hidden": True,
                            "concurrent_record_revision": "target-fresh",
                            "side": "fresh-front",
                        }
                    )
                concurrently_edited_source_images.append(edited_record)
            await original_update(
                db=kwargs["db"],
                project_id=kwargs["project_id"],
                part_id=kwargs["part_id"],
                metadata_patch={
                    "annotations": [
                        seed_annotations[mutation_part_id],
                        concurrent_annotation,
                    ],
                    "unrelated_state": {
                        "revision": "fresh",
                        "writer": "annotation-save",
                    },
                    "source_images": concurrently_edited_source_images,
                },
                updated_by="concurrent-source-edit@example.com",
            )
        return await original_locked_mutation(*args, **kwargs)

    monkeypatch.setattr(
        inspection_repository,
        "mutate_inspection_part_metadata_locked",
        mutate_after_concurrent_source_record_save,
    )

    if assignment_kind == "image":
        assignment_resp = client.post(
            f"/api/projects/{project_id}/parts/image-assignments",
            json={
                "filename": moving["filename"],
                "image_id": moving["id"],
                "to_part_id": part_ids["target"],
            },
            headers=headers,
        )
    else:
        assignment_resp = client.post(
            f"/api/projects/{project_id}/parts/overlay-assignments",
            json={
                "overlay_filename": moving["filename"],
                "overlay_image_id": moving["id"],
                "base_filename": base["filename"],
                "base_image_id": base["id"],
            },
            headers=headers,
        )
    assert assignment_resp.status_code == 200, assignment_resp.text
    assert assignment_resp.json()["from_part_id"] == part_ids["source"]
    assert assignment_resp.json()["to_part_id"] == part_ids["target"]
    assert injected_part_ids == set(part_ids.values())

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    parts_by_id = {part["id"]: part for part in parts_resp.json()}
    for part_id in part_ids.values():
        metadata = parts_by_id[part_id]["metadata"]
        assert metadata["annotations"] == [
            seed_annotations[part_id],
            {
                "id": f"concurrent-{part_id}",
                "defect_class": "saved after assignment read",
            },
        ]
        assert metadata["unrelated_state"] == {
            "revision": "fresh",
            "writer": "annotation-save",
        }

    source_records = parts_by_id[part_ids["source"]]["metadata"]["source_images"]
    target_records = parts_by_id[part_ids["target"]]["metadata"]["source_images"]
    assert all(record.get("image_id") != moving["id"] for record in source_records)
    moved_record = next(
        record for record in target_records if record.get("image_id") == moving["id"]
    )
    assert moved_record["hidden"] is True
    assert moved_record["concurrent_record_revision"] == "source-fresh"
    target_anchor_record = next(
        record
        for record in target_records
        if record.get("image_id") == target_anchor["id"]
    )
    assert target_anchor_record["hidden"] is True
    assert target_anchor_record["concurrent_record_revision"] == "target-fresh"
    assert target_anchor_record["side"] == "fresh-front"
    if assignment_kind == "overlay":
        assert moved_record["overlay_base_image_id"] == base["id"]
        assert moved_record["overlay"] is True
        assert moved_record["side"] == "fresh-front"


def _png_bytes(color):
    img = Image.new("RGB", (12, 10), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _upload_image(client, project_id, filename, metadata, color):
    response = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, _png_bytes(color), "image/png")},
        data={"metadata": json.dumps(metadata)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_multi_part_multi_modality_overlay_project_can_be_reset_to_empty(
    client,
    monkeypatch,
):
    headers = {
        "X-User-Id": "reset-workflow@example.com",
        "X-User-Groups": '["reset-workflow"]',
    }
    deleted_storage_keys = []

    def delete_fixture_object(_bucket_name, object_name):
        deleted_storage_keys.append(object_name)
        return True

    monkeypatch.setattr(
        "routers.images.delete_file_from_s3",
        delete_fixture_object,
    )
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Reset regression project",
            "description": "several parts with repeated views, modalities, overlays, and annotations",
            "meta_group_id": "reset-workflow",
            "project_type": "PT2",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    uploaded_images = []
    modalities = ["visible", "infrared"]
    colors = [(20, 80, 160), (160, 80, 20), (80, 160, 20), (160, 20, 80)]

    for part_index in range(3):
        part_resp = client.post(
            f"/api/projects/{project_id}/parts",
            json={
                "serial_number": f"RESET-{part_index + 1:03d}",
                "display_name": f"Reset part {part_index + 1}",
            },
            headers=headers,
        )
        assert part_resp.status_code == 201, part_resp.text
        part = part_resp.json()
        base_images = []
        for repeat_index, modality in enumerate(modalities):
            image = _upload_image(
                client,
                project_id,
                filename=f"part-{part_index + 1}-top-{modality}-{repeat_index + 1}.png",
                metadata={
                    "side": "top",
                    "modality": modality,
                    "capture_index": repeat_index + 1,
                },
                color=colors[(part_index + repeat_index) % len(colors)],
            )
            uploaded_images.append(image)
            base_images.append(image)
            assign_resp = client.post(
                f"/api/projects/{project_id}/parts/image-assignments",
                json={
                    "filename": image["filename"],
                    "image_id": image["id"],
                    "to_part_id": part["id"],
                },
                headers=headers,
            )
            assert assign_resp.status_code == 200, assign_resp.text

        overlay = _upload_image(
            client,
            project_id,
            filename=f"part-{part_index + 1}-top-mask-overlay.png",
            metadata={"side": "top", "modality": "mask", "overlay": True},
            color=(255, 0, 0),
        )
        uploaded_images.append(overlay)
        overlay_resp = client.post(
            f"/api/projects/{project_id}/parts/overlay-assignments",
            json={
                "overlay_filename": overlay["filename"],
                "overlay_image_id": overlay["id"],
                "base_filename": base_images[0]["filename"],
                "base_image_id": base_images[0]["id"],
            },
            headers=headers,
        )
        assert overlay_resp.status_code == 200, overlay_resp.text

        analysis_resp = client.post(
            f"/api/images/{base_images[0]['id']}/analyses",
            json={
                "image_id": base_images[0]["id"],
                "model_name": "resnet50_classifier",
                "model_version": "reset-regression",
                "parameters": {"part": part["serial_number"]},
            },
            headers=headers,
        )
        assert analysis_resp.status_code == 201, analysis_resp.text
        bulk_resp = client.post(
            f"/api/analyses/{analysis_resp.json()['id']}/annotations:bulk",
            json={
                "annotations": [
                    {
                        "annotation_type": "bounding_box",
                        "class_name": "scratch",
                        "confidence": 0.91,
                        "data": {"x": 1, "y": 2, "width": 4, "height": 5},
                    },
                    {
                        "annotation_type": "heatmap",
                        "class_name": "thermal",
                        "confidence": 0.72,
                        "data": {"artifact": overlay["filename"]},
                    },
                ]
            },
            headers=headers,
        )
        assert bulk_resp.status_code == 200, bulk_resp.text

        part_annotation_resp = client.post(
            f"/api/projects/{project_id}/parts/{part['id']}/annotations",
            json={
                "image_id": base_images[1]["id"],
                "defect_class": "operator-markup",
                "modality": "infrared",
                "comment": "Vista-created overlay annotation",
                "disposition": "open",
                "bbox": {"x": 2, "y": 2, "width": 5, "height": 4},
                "metadata": {"overlay_color": "#ff0000"},
            },
            headers=headers,
        )
        assert part_annotation_resp.status_code == 201, part_annotation_resp.text

    populated_parts_resp = client.get(
        f"/api/projects/{project_id}/parts", headers=headers
    )
    assert populated_parts_resp.status_code == 200, populated_parts_resp.text
    assert len(populated_parts_resp.json()) == 3
    for part in populated_parts_resp.json():
        metadata = part["metadata"]
        assert len(metadata["source_images"]) == 3
        expected_top_view = next(
            record["filename"]
            for record in metadata["source_images"]
            if not record.get("overlay")
        )
        assert metadata["view_images"] == {"top": expected_top_view}
        assert metadata["overlay_images"]["top"]["mask"].endswith("mask-overlay.png")
        assert len(metadata["annotations"]) == 1

    images_resp = client.get(f"/api/projects/{project_id}/images", headers=headers)
    assert images_resp.status_code == 200, images_resp.text
    assert len(images_resp.json()) == 9

    for part in populated_parts_resp.json():
        delete_part_resp = client.delete(
            f"/api/projects/{project_id}/parts/{part['id']}", headers=headers
        )
        assert delete_part_resp.status_code == 204, delete_part_resp.text

    for image in uploaded_images:
        delete_image_resp = client.request(
            "DELETE",
            f"/api/projects/{project_id}/images/{image['id']}",
            json={"reason": "reset regression cleanup", "force": True},
            headers=headers,
        )
        assert delete_image_resp.status_code == 200, delete_image_resp.text
        assert delete_image_resp.json()["deleted_at"] is not None
        assert delete_image_resp.json()["storage_deleted"] is True
    assert deleted_storage_keys == [
        image["object_storage_key"] for image in uploaded_images
    ]

    empty_parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert empty_parts_resp.status_code == 200, empty_parts_resp.text
    assert empty_parts_resp.json() == []

    empty_images_resp = client.get(
        f"/api/projects/{project_id}/images", headers=headers
    )
    assert empty_images_resp.status_code == 200, empty_images_resp.text
    assert empty_images_resp.json() == []

    deleted_images_resp = client.get(
        f"/api/projects/{project_id}/images?deleted_only=true", headers=headers
    )
    assert deleted_images_resp.status_code == 200, deleted_images_resp.text
    assert len(deleted_images_resp.json()) == 9
