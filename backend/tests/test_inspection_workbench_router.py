import pytest
from unittest.mock import patch
import base64
import io
import json

from PIL import Image, ImageDraw


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_batches_and_parts_support_three_simulated_users_with_progressive_workflows(client, project_type):
    """
    For each project type, simulate three users with progressively more complex synthetic
    workflows that create batches and parts, then verify filtered list behavior.
    """
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
                    "metadata": {"angle": "front", "synthetic_level": 2, "defect_hint": "scratch"},
                },
                {
                    "serial_number": f"{project_type}-MID-0102",
                    "display_name": "mid-back",
                    "metadata": {"angle": "back", "synthetic_level": 2, "checkpoint": "qa-pass-1"},
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
                    "metadata": {"angle": "left", "synthetic_level": 3, "nested": {"severity": "high"}},
                },
                {
                    "serial_number": f"{project_type}-ADV-9002",
                    "display_name": "adv-right",
                    "metadata": {"angle": "right", "synthetic_level": 3, "workflow_stage": "triage"},
                },
                {
                    "serial_number": f"{project_type}-ADV-9003",
                    "display_name": "adv-top",
                    "metadata": {"angle": "top", "synthetic_level": 3, "workflow_stage": "review"},
                },
            ],
        },
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f"[\"{scenario['group']}\"]",
        }

        project_payload = {
            "name": scenario["project_name"],
            "description": "inspection workbench synthetic workflow",
            "meta_group_id": scenario["group"],
            "project_type": project_type,
        }
        project_resp = client.post("/api/projects/", json=project_payload, headers=headers)
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

        list_batches_resp = client.get(f"/api/projects/{project_id}/batches", headers=headers)
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

        list_parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
        assert list_parts_resp.status_code == 200
        assert len(list_parts_resp.json()) == len(scenario["parts"])

        filtered_parts_resp = client.get(
            f"/api/projects/{project_id}/parts?batch_id={first_batch_id}",
            headers=headers,
        )
        assert filtered_parts_resp.status_code == 200
        assert len(filtered_parts_resp.json()) == len(scenario["parts"])


def test_create_part_rejects_batch_from_other_project(client):
    headers = {"X-User-Id": "cross-project@example.com", "X-User-Groups": '["cross-group"]'}

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
    headers = {"X-User-Id": "batch-editor@example.com", "X-User-Groups": '["batch-editor-group"]'}
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

    manual_resp = client.patch(
        f"/api/projects/{project_id}/parts/{part_id}/manual-flag",
        json={"manual_flagged": True},
        headers=headers,
    )
    assert manual_resp.status_code == 200
    assert manual_resp.json()["metadata"]["manual_flagged"] is True


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_part_review_workflow_supports_three_simulated_users_with_progressive_data(client, project_type):
    scenarios = [
        {
            "email": f"review-basic-{project_type.lower()}@example.com",
            "group": f"{project_type.lower()}-review-basic",
            "parts": [{"serial_number": f"{project_type}-RB-0001", "display_name": "rb-1"}],
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
            "X-User-Groups": f"[\"{scenario['group']}\"]",
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


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_segmentation_and_measurement_invocation_supports_progressive_users(client, project_type):
    scenarios = [
        {"email": f"ml-basic-{project_type.lower()}@example.com", "group": f"{project_type.lower()}-ml-basic", "synthetic_level": 1},
        {"email": f"ml-intermediate-{project_type.lower()}@example.com", "group": f"{project_type.lower()}-ml-intermediate", "synthetic_level": 2},
        {"email": f"ml-advanced-{project_type.lower()}@example.com", "group": f"{project_type.lower()}-ml-advanced", "synthetic_level": 3},
    ]

    for scenario in scenarios:
        headers = {
            "X-User-Id": scenario["email"],
            "X-User-Groups": f"[\"{scenario['group']}\"]",
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
        assert segmentation["overlay_id"] == f"segmentation-axial-{scenario['synthetic_level']}"

        measurement_resp = client.post(
            f"/api/projects/{project_id}/parts/{part_id}/measurement-runs",
            json={"measurement_profile": "workbench-default", "include_overlays": [segmentation["overlay_id"]]},
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
    assert payload["summary"]["region_count"] == 0
    assert payload["regions"] == []
    assert payload["selected_region"] is None


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_workspace_state_persistence_supports_progressive_users(client, project_type):
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
                    "part_list": {"is_open": True, "width_px": 310, "height_px": 420, "orientation": "vertical"},
                    "inspector": {"is_open": True, "width_px": 355, "height_px": 420, "orientation": "horizontal"},
                    "mpr_controls": {"is_open": False, "width_px": 330, "height_px": 350, "orientation": "vertical"},
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
                    "part_list": {"is_open": True, "width_px": 360, "height_px": 500, "orientation": "vertical"},
                    "inspector": {"is_open": False, "width_px": 420, "height_px": 510, "orientation": "horizontal"},
                    "mpr_controls": {"is_open": True, "width_px": 400, "height_px": 380, "orientation": "horizontal"},
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
                    "part_list": {"is_open": "yes", "width_px": -15, "height_px": 9999, "orientation": "diagonal"},
                    "inspector": {"is_open": True, "width_px": 260, "height_px": 460, "orientation": "vertical"},
                    "mpr_controls": {"is_open": True, "width_px": "400", "height_px": "420", "orientation": "horizontal"},
                },
            },
            "expected_panel_layout": {
                "part_list": {"is_open": True, "width_px": 220, "height_px": 1400, "orientation": "vertical"},
                "inspector": {"is_open": True, "width_px": 260, "height_px": 460, "orientation": "vertical"},
                "mpr_controls": {"is_open": True, "width_px": 400, "height_px": 420, "orientation": "horizontal"},
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
            "X-User-Groups": f"[\"{scenario['group']}\"]",
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

        initial_resp = client.get(f"/api/projects/{project_id}/workspace-state", headers=headers)
        assert initial_resp.status_code == 200, initial_resp.text
        assert initial_resp.json()["state"]["panel_layout"] == {
            "part_list": {"is_open": True, "width_px": 320, "height_px": 420, "orientation": "vertical"},
            "inspector": {"is_open": True, "width_px": 360, "height_px": 420, "orientation": "vertical"},
            "mpr_controls": {"is_open": True, "width_px": 360, "height_px": 360, "orientation": "vertical"},
        }

        save_resp = client.put(
            f"/api/projects/{project_id}/workspace-state",
            json={"state": scenario["state"]},
            headers=headers,
        )
        assert save_resp.status_code == 200, save_resp.text
        expected_panel_layout = scenario.get("expected_panel_layout", scenario["state"]["panel_layout"])
        assert save_resp.json()["state"]["panel_layout"] == expected_panel_layout
        expected_shortcut_help_visible = scenario.get(
            "expected_shortcut_help_visible",
            scenario["state"].get("inspector", {}).get("shortcut_help_visible"),
        )
        expected_normalization_triage_field = scenario.get(
            "expected_normalization_triage_field",
            scenario["state"].get("inspector", {}).get("normalization_triage_field", ""),
        )
        expected_image_enabled = scenario.get(
            "expected_image_enabled",
            scenario["state"].get("inspector", {}).get("image_enabled", True),
        )
        assert save_resp.json()["state"]["inspector"]["shortcut_help_visible"] == expected_shortcut_help_visible
        assert save_resp.json()["state"]["inspector"]["normalization_triage_field"] == expected_normalization_triage_field
        assert save_resp.json()["state"]["inspector"]["image_enabled"] == expected_image_enabled
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
            scenario["state"].get("inspector", {}).get("viewport_transform", {"zoom": 1.0, "panX": 0, "panY": 0}),
        )
        assert save_resp.json()["state"]["inspector"]["modalities"] == expected_modalities
        assert save_resp.json()["state"]["inspector"]["view_name"] == expected_view_name
        assert save_resp.json()["state"]["inspector"]["viewport_transform"] == expected_viewport_transform
        expected_measurements = scenario.get(
            "expected_measurements",
            scenario["state"].get("inspector", {}).get("measurements", []),
        )
        assert save_resp.json()["state"]["inspector"]["measurements"] == expected_measurements

        reload_resp = client.get(f"/api/projects/{project_id}/workspace-state", headers=headers)
        assert reload_resp.status_code == 200, reload_resp.text
        assert reload_resp.json()["state"]["panel_layout"] == expected_panel_layout
        assert reload_resp.json()["state"]["inspector"]["shortcut_help_visible"] == expected_shortcut_help_visible
        assert reload_resp.json()["state"]["inspector"]["normalization_triage_field"] == expected_normalization_triage_field
        assert reload_resp.json()["state"]["inspector"]["image_enabled"] == expected_image_enabled
        assert reload_resp.json()["state"]["inspector"]["modalities"] == expected_modalities
        assert reload_resp.json()["state"]["inspector"]["view_name"] == expected_view_name
        assert reload_resp.json()["state"]["inspector"]["viewport_transform"] == expected_viewport_transform
        assert reload_resp.json()["state"]["inspector"]["measurements"] == expected_measurements

        update_payload = {**scenario["state"], "sort_mode": "serial_asc"}
        overwrite_resp = client.put(
            f"/api/projects/{project_id}/workspace-state",
            json={"state": update_payload},
            headers=headers,
        )
        assert overwrite_resp.status_code == 200, overwrite_resp.text
        assert overwrite_resp.json()["state"]["sort_mode"] == "serial_asc"
        assert overwrite_resp.json()["state"]["panel_layout"] == expected_panel_layout


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_part_annotations_support_progressive_users_with_audit_trail(client, project_type):
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
            "X-User-Groups": f"[\"{scenario['group']}\"]",
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
        assert created_annotation["defect_class"] == scenario["annotation"]["defect_class"]
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


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_round_trip_supports_progressive_users(client, project_type):
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
                    {"id": "front", "label": "Front", "required_modalities": ["visual"], "source": "manual"}
                ],
                "defect_types": [
                    {"name": "scratch", "color": "#ef4444", "definition": "Linear visible surface scratch"}
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
                    {"id": "top", "label": "Top", "required_modalities": ["visual"], "source": "auto"},
                ],
                "defect_types": [
                    {"name": "void_cluster", "color": "#8b5cf6", "definition": "Cluster of internal voids"},
                    {"name": "inclusion", "color": "#f59e0b", "definition": "Foreign inclusion in substrate"},
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
                    {"id": "axial", "label": "Axial", "required_modalities": ["uv"], "source": "auto"},
                ],
                "defect_types": [
                    {"name": "delamination", "color": "#dc2626", "definition": "Layer separation"},
                    {"name": "porosity", "color": "#0284c7", "definition": "Distributed pore network"},
                    {"name": "burn_through", "color": "#7c3aed", "definition": "Material burn-through"},
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
            "X-User-Groups": f"[\"{scenario['group']}\"]",
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

        initial_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
        assert initial_resp.status_code == 200, initial_resp.text
        initial_config = initial_resp.json()["config"]
        assert "image_modalities" in initial_config
        assert "part_views" in initial_config
        assert "defect_types" in initial_config
        assert initial_config["defect_types"] == [
            {"name": f"DefectType1_{project_type}", "color": "#ef4444", "definition": ""},
            {"name": f"DefectType2_{project_type}", "color": "#f59e0b", "definition": ""},
            {"name": f"DefectType3_{project_type}", "color": "#3b82f6", "definition": ""},
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

        reload_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
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
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    initial_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
    assert initial_resp.status_code == 200, initial_resp.text
    initial_config = initial_resp.json()["config"]
    assert "file_naming_scheme" in initial_config

    payload = {
        **initial_config,
        "file_naming_scheme": {
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
    assert save_resp.json()["config"]["file_naming_scheme"] == payload["file_naming_scheme"]

    reload_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
    assert reload_resp.status_code == 200, reload_resp.text
    assert reload_resp.json()["config"]["file_naming_scheme"] == payload["file_naming_scheme"]


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

    initial_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
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

    reload_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
    assert reload_resp.status_code == 200, reload_resp.text
    assert reload_resp.json()["config"]["metadata_parsers"] == payload["metadata_parsers"]


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_rejects_invalid_hotkeys(client, project_type):
    headers = {
        "X-User-Id": f"config-hotkey-invalid-{project_type.lower()}@example.com",
        "X-User-Groups": f"[\"{project_type.lower()}-config-hotkey-invalid\"]",
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
def test_project_configuration_clone_supports_progressive_users(client, project_type):
    scenarios = [
        {"name": "basic", "view_id": "front", "hotkeys": {"accept_classification": "a", "reject_classification": "r", "toggle_shortcut_help": "h"}},
        {"name": "intermediate", "view_id": "top", "hotkeys": {"accept_classification": "s", "reject_classification": "d", "toggle_shortcut_help": "f"}},
        {"name": "advanced", "view_id": "axial", "hotkeys": {"accept_classification": "z", "reject_classification": "x", "toggle_shortcut_help": "c"}},
    ]

    for index, scenario in enumerate(scenarios, start=1):
        email = f"clone-{scenario['name']}-{project_type.lower()}@example.com"
        group = f"{project_type.lower()}-clone-{scenario['name']}"
        headers = {"X-User-Id": email, "X-User-Groups": f"[\"{group}\"]"}

        source_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} clone source {scenario['name']}",
                "description": "source config for clone",
                "meta_group_id": group,
                "project_type": project_type,
            },
            headers=headers,
        )
        target_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} clone target {scenario['name']}",
                "description": "target config for clone",
                "meta_group_id": group,
                "project_type": project_type,
            },
            headers=headers,
        )
        assert source_resp.status_code == 201, source_resp.text
        assert target_resp.status_code == 201, target_resp.text
        source_project_id = source_resp.json()["id"]
        target_project_id = target_resp.json()["id"]

        source_payload = {
            "image_modalities": [{"id": "visual", "label": "Visual", "calibration_required": index > 1, "example_image_uploaded": True}],
            "part_views": [{"id": scenario["view_id"], "label": scenario["view_id"].title(), "required_modalities": ["visual"], "source": "manual"}],
            "defect_types": [{"name": f"defect_{scenario['name']}", "color": "#ef4444", "definition": f"Synthetic {scenario['name']} defect"}],
            "process_settings": {
                "require_disposition_on_submit": True,
                "require_measurement_for_critical": index >= 2,
                "require_second_reviewer_for_reject": index == 3,
                "configurable_hotkeys": scenario["hotkeys"],
            },
            "display_settings": {"default_colormap": "grayscale", "anomaly_colormap": "viridis", "grayscale_base_image": index < 3},
        }
        save_resp = client.put(
            f"/api/projects/{source_project_id}/configuration",
            json={"config": source_payload},
            headers=headers,
        )
        assert save_resp.status_code == 200, save_resp.text

        clone_resp = client.post(
            f"/api/projects/{target_project_id}/configuration/clone",
            json={"source_project_id": source_project_id},
            headers=headers,
        )
        assert clone_resp.status_code == 200, clone_resp.text
        clone_payload = clone_resp.json()
        assert clone_payload["project_id"] == target_project_id
        assert clone_payload["source_project_id"] == source_project_id
        assert clone_payload["config"] == source_payload

        target_get_resp = client.get(f"/api/projects/{target_project_id}/configuration", headers=headers)
        assert target_get_resp.status_code == 200, target_get_resp.text
        assert target_get_resp.json()["config"] == source_payload


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_clone_requires_access_to_source_project(client, project_type):
    source_headers = {"X-User-Id": f"clone-source-{project_type.lower()}@example.com", "X-User-Groups": f"[\"{project_type.lower()}-clone-source\"]"}
    target_headers = {"X-User-Id": f"clone-target-{project_type.lower()}@example.com", "X-User-Groups": f"[\"{project_type.lower()}-clone-target\"]"}

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

    with patch("routers.inspection_workbench.is_user_in_group", return_value=False):
        clone_resp = client.post(
            f"/api/projects/{target_project_id}/configuration/clone",
            json={"source_project_id": source_project_id},
            headers=target_headers,
        )
    assert clone_resp.status_code == 403, clone_resp.text
    assert "does not have access to project" in clone_resp.json()["detail"]


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_clone_rejects_same_source_and_target_project(client, project_type):
    headers = {
        "X-User-Id": f"clone-self-{project_type.lower()}@example.com",
        "X-User-Groups": f"[\"{project_type.lower()}-clone-self\"]",
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
    assert clone_resp.json()["detail"] == "source_project_id must be different from project_id"


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_clone_rejects_cross_project_type_sources_progressive_users(client, project_type):
    scenarios = [
        {"name": "basic"},
        {"name": "intermediate"},
        {"name": "advanced"},
    ]
    source_type_by_target = {"PT1": "PT2", "PT2": "PT3", "PT3": "PT1"}
    source_project_type = source_type_by_target[project_type]

    for scenario in scenarios:
        group = f"{project_type.lower()}-clone-type-guard-{scenario['name']}"
        headers = {
            "X-User-Id": f"{project_type.lower()}-{scenario['name']}-clone-type-guard@example.com",
            "X-User-Groups": f"[\"{group}\"]",
        }
        target_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{project_type} target {scenario['name']}",
                "description": "target project for type guard",
                "meta_group_id": group,
                "project_type": project_type,
            },
            headers=headers,
        )
        source_resp = client.post(
            "/api/projects/",
            json={
                "name": f"{source_project_type} source {scenario['name']}",
                "description": "cross type source project",
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


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_configuration_interface_layout_default_save_and_load(client, project_type):
    group = f"{project_type.lower()}-layout-default"
    headers = {
        "X-User-Id": f"{project_type.lower()}-layout-default@example.com",
        "X-User-Groups": f"[\"{group}\"]",
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
                    "children": [{"type": "tab", "component": "inspection", "name": "Inspection"}],
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
    assert save_resp.json()["config"]["interface_layout"]["default_model"] == layout_model

    get_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["config"]["interface_layout"]["default_model"] == layout_model


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_project_type_interface_layout_default_requires_admin_and_applies_to_matching_projects(client, project_type):
    group = f"{project_type.lower()}-layout-type-default"
    admin_headers = {
        "X-User-Id": f"{project_type.lower()}-layout-type-admin@example.com",
        "X-User-Groups": f"[\"{group}\",\"admins\"]",
    }
    non_admin_headers = {
        "X-User-Id": f"{project_type.lower()}-layout-type-user@example.com",
        "X-User-Groups": f"[\"{group}\"]",
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

    target_config_resp = client.get(f"/api/projects/{target_project_id}/configuration", headers=admin_headers)
    assert target_config_resp.status_code == 200, target_config_resp.text
    assert target_config_resp.json()["config"]["interface_layout"]["default_model"] == layout_model

@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_load_test_data_seeds_project_type_fixtures(client, project_type):
    headers = {
        "X-User-Id": f"loader-{project_type.lower()}@example.com",
        "X-User-Groups": f"[\"{project_type.lower()}-loader\"]",
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

    with patch("routers.inspection_workbench.upload_file_to_s3", return_value=True):
        load_resp = client.post(f"/api/projects/{project_id}/load-test-data", headers=headers)

    assert load_resp.status_code == 200, load_resp.text
    payload = load_resp.json()
    assert payload["project_type"] == project_type
    assert payload["images_received"] > 0
    assert payload["ingest"]["counters"]["parts_received"] > 0

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    parts = parts_resp.json()
    assert parts
    if project_type == "PT3":
        assert parts[0]["metadata"]["mpr"]["axis_labels"] == ["XY", "XZ", "YZ"]
        assert parts[0]["metadata"]["volume_shape"] == {"axial": 64, "coronal": 96, "sagittal": 128}
        source_images = parts[0]["metadata"]["source_images"]
        assert len(source_images) == 128
        base_images = [source_image for source_image in source_images if not source_image["metadata"].get("overlay")]
        overlay_images = [source_image for source_image in source_images if source_image["metadata"].get("overlay")]
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
        assert overlay_16["metadata"]["overlay_base_filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png"
        assert overlay_16["metadata"]["modality"] == "segmentation"
        nsipro_metadata = parts[0]["metadata"]["nsipro_metadata"]
        assert nsipro_metadata["source_filename"] == "PT3_GEOMETRIC_DUAL_LABEL.nsipro"
        assert nsipro_metadata["parser"] == "nsipro-key-value"
        assert nsipro_metadata["metadata"]["Application"]["application_info"].startswith("NIS-Elements")
        assert nsipro_metadata["metadata"]["Microscope"]["microscope_name"] == "Nikon Ti2-E Inverted Microscope"
        assert nsipro_metadata["metadata"]["Camera"]["exposure_ms"] == 12.5
        assert nsipro_metadata["metadata"]["Volume"]["slices"] == 64
    elif project_type == "PT1":
        source_images = [
            source_image
            for part in parts
            for source_image in part["metadata"].get("source_images", [])
        ]
        filenames = {source_image["filename"] for source_image in source_images}
        assert payload["images_received"] == 20
        assert "D1001_LOT01_SET01_SN0001_front_visual_false.jpg" in filenames
        assert "D1002_LOT02_SET01_SN0004_back_heatmap_true.jpg" in filenames
        assert "D1001_LOT01_SET01_SN0001_front_segmentation_true.txt" in filenames
        assert "D1002_LOT02_SET01_SN0004_back_segmentation_true.txt" in filenames
        text_overlay = next(
            source_image
            for source_image in source_images
            if source_image["filename"] == "D1001_LOT01_SET01_SN0001_front_segmentation_true.txt"
        )
        assert text_overlay["overlay"] is True
        assert text_overlay["modality"] == "segmentation"
        assert len(parts) == 4
        assert all(part["batch_id"] is None for part in parts)
        assert parts[0]["metadata"]["source"] == "vista-test-data"
        assert parts[0]["metadata"]["design_number"].startswith("D")
        assert parts[0]["metadata"]["set_number"].startswith("SET")
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
            if source_image["filename"] == "D1001_LOT01_SET01_SN0001_front_segmentation_true.txt"
        )
        assert text_overlay["overlay"] is True
        assert text_overlay["modality"] == "segmentation"
        assert parts[0]["metadata"]["design_number"].startswith("D")


def test_pt3_load_test_data_survives_fixture_image_upload_failure(client):
    headers = {
        "X-User-Id": "loader-pt3-nos3@example.com",
        "X-User-Groups": "[\"pt3-loader-nos3\"]",
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

    with patch("routers.inspection_workbench.upload_file_to_s3", return_value=False):
        load_resp = client.post(f"/api/projects/{project_id}/load-test-data", headers=headers)

    assert load_resp.status_code == 200, load_resp.text
    payload = load_resp.json()
    assert payload["project_type"] == "PT3"
    assert payload["images_created"] == 128
    assert payload["ingest"]["counters"]["parts_created"] == 1

    images_resp = client.get(f"/api/projects/{project_id}/images?include_deleted=true&limit=2000", headers=headers)
    assert images_resp.status_code == 200, images_resp.text
    images = images_resp.json()
    assert len(images) == 128
    assert images[0]["metadata"]["storage_status"] == "metadata_only"
    slice_16 = next(image for image in images if image["filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png")
    assert slice_16["metadata"]["slice_index"] == 16
    overlay_16 = next(image for image in images if image["filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016_overlay.png")
    assert overlay_16["metadata"]["overlay"] is True
    assert overlay_16["metadata"]["overlay_base_filename"] == "PT3_GEOMETRIC_DUAL_LABEL_Z016.png"

    parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_resp.status_code == 200, parts_resp.text
    part_metadata = parts_resp.json()[0]["metadata"]
    assert part_metadata["mpr"]["axis_labels"] == ["XY", "XZ", "YZ"]
    assert part_metadata["volume_shape"] == {"axial": 64, "coronal": 96, "sagittal": 128}
    assert len(part_metadata["source_images"]) == 128


def test_pt3_load_test_data_survives_fixture_image_upload_exception(client):
    headers = {
        "X-User-Id": "loader-pt3-exception@example.com",
        "X-User-Groups": "[\"pt3-loader-exception\"]",
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

    with patch("routers.inspection_workbench.upload_file_to_s3", side_effect=RuntimeError("storage unavailable")):
        load_resp = client.post(f"/api/projects/{project_id}/load-test-data", headers=headers)

    assert load_resp.status_code == 200, load_resp.text
    payload = load_resp.json()
    assert payload["project_type"] == "PT3"
    assert payload["images_created"] == 128
    assert payload["ingest"]["counters"]["parts_created"] == 1

    images_resp = client.get(f"/api/projects/{project_id}/images?include_deleted=true&limit=2000", headers=headers)
    assert images_resp.status_code == 200, images_resp.text
    images = images_resp.json()
    assert len(images) == 128
    assert images[0]["metadata"]["storage_status"] == "metadata_only"


@pytest.mark.parametrize("project_type", ["PT1", "PT2", "PT3"])
def test_bulk_ingest_supports_progressive_users_with_discrepancy_counters(client, project_type):
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
                            {"serial_number": "SN-BASIC-001", "display_name": "Basic Housing 1"},
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
                            {"serial_number": "SN-MID-001", "display_name": "Mid Housing 1"},
                            {"serial_number": "SN-MID-002", "display_name": "Mid Housing 2"},
                        ],
                    },
                    {
                        "name": "batch-mid-b",
                        "description": "Mid ingest B",
                        "parts": [
                            {"serial_number": "SN-MID-001", "display_name": "Mid Housing Duplicate"},
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
                            {"serial_number": "SN-ADV-EXISTING", "display_name": "Existing Seed Part"},
                            {"serial_number": "SN-ADV-CONFLICT", "display_name": "Conflict Seed Part"},
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
                            {"serial_number": "SN-ADV-EXISTING", "display_name": "Existing Same Batch"},
                        ],
                    },
                    {
                        "name": "batch-adv-b",
                        "description": "Advanced ingest",
                        "parts": [
                            {"serial_number": "SN-ADV-CONFLICT", "display_name": "Cross-Batch Conflict"},
                            {"serial_number": "SN-ADV-NEW-001", "display_name": "Advanced New Part"},
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
            "X-User-Groups": f"[\"{scenario['group']}\"]",
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
            parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
            assert parts_resp.status_code == 200, parts_resp.text
            parts = parts_resp.json()
            assert len(parts) == 1
            assert parts[0]["batch_id"] is None
            assert parts[0]["metadata"]["set_number"] == "SET01"


def test_bulk_ingest_dereferences_associated_nsipro_metadata(client):
    headers = {"X-User-Id": "nsipro-ingest@example.com", "X-User-Groups": '["nsipro-ingest"]'}
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
    assert metadata["nsipro_metadata"] == {"capture": {"operator": "alice", "exposure": 12}}
    assert metadata["nsipro_payload"]["parser_id"] == "default"
    assert metadata["nsipro_payload"]["parser_hash"] == "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df"
    assert metadata["source_images"][0]["nsipro_payload"]["metadata"] == metadata["nsipro_metadata"]

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

    updated_parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert updated_parts_resp.status_code == 200, updated_parts_resp.text
    updated_metadata = updated_parts_resp.json()[0]["metadata"]
    assert updated_metadata["nsipro_metadata"] == {"capture": {"operator": "bob", "exposure": 18}}
    assert updated_metadata["source_images"][0]["nsipro_payload"]["source_filename"] == "scan-updated.nsipro"
    assert updated_metadata["source_images"][0]["nsipro_payload"]["metadata"] == updated_metadata["nsipro_metadata"]


def test_bulk_ingest_persists_deployment_nsipro_custom_fields_after_dereference(client):
    headers = {"X-User-Id": "nsipro-deployment@example.com", "X-User-Groups": '["nsipro-deployment"]'}
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

    config_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
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
        "deployment": {"deployment_id": "DEP-42", "line_id": "LINE-7", "build_number": 118},
        "custom_fields": {
            "inspection_lot": "LOT-ALPHA",
            "operator_badge": "QA-17",
            "scan_mode": "micro CT",
        },
    }
    assert metadata["nsipro_payload"]["parser_id"] == "deployment_a"
    assert metadata["source_images"][0]["nsipro_payload"]["metadata"] == metadata["nsipro_metadata"]
    assert metadata["source_images"][0]["nsipro_payload"]["parser_hash"] == "sha256:d1c01fbbf53558bc44e1fcc73a8f537f0feec684ef38b8c919beefb59c1be6bb"

def test_bulk_ingest_strict_nsipro_parser_contract_rejects_mismatched_payload(client):
    headers = {"X-User-Id": "nsipro-strict@example.com", "X-User-Groups": '["nsipro-strict"]'}
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

    config_resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
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
    save_resp = client.put(f"/api/projects/{project_id}/configuration", json={"config": config}, headers=headers)
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
    headers = {"X-User-Id": "parts-images@example.com", "X-User-Groups": '["parts-images"]'}
    response = client.post(
        "/api/projects/",
        json={"name": name, "description": None, "meta_group_id": "parts-images", "project_type": "PT1"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], headers


def _upload_part_test_image(client, project_id, headers, filename="part-image.png", metadata=None):
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


def test_image_assignment_can_move_image_back_to_unassigned(client):
    project_id, headers = _create_project_for_part_image_tests(client, "Unassign image project")
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
    project_id, headers = _create_project_for_part_image_tests(client, "Crop child image project")
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
    project_id, headers = _create_project_for_part_image_tests(client, "Delete part project")
    uploaded = _upload_part_test_image(client, project_id, headers, "survives-part-delete.png")
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-DELETE", "display_name": "Delete Target"},
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

    delete_response = client.delete(f"/api/projects/{project_id}/parts/{part_id}", headers=headers)
    assert delete_response.status_code == 204, delete_response.text

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200
    assert parts_response.json() == []
    images_response = client.get(f"/api/projects/{project_id}/images", headers=headers)
    assert images_response.status_code == 200
    assert [image["filename"] for image in images_response.json()] == [uploaded["filename"]]


def test_overlay_assignment_maps_overlay_to_base_image(client):
    project_id, headers = _create_project_for_part_image_tests(client, "Overlay assignment project")
    base = _upload_part_test_image(client, project_id, headers, "base.png", {"side": "front", "modality": "visual"})
    overlay = _upload_part_test_image(client, project_id, headers, "overlay.png", {"modality": "heatmap", "overlay": True})
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
        json={"overlay_filename": overlay["filename"], "base_filename": base["filename"]},
        headers=headers,
    )
    assert assign_overlay.status_code == 200, assign_overlay.text
    assert assign_overlay.json()["to_part_id"] == part_id

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    metadata = parts_response.json()[0]["metadata"]
    overlay_records = [record for record in metadata["source_images"] if record.get("overlay")]
    assert len(overlay_records) == 1
    assert overlay_records[0]["filename"] == "overlay.png"
    assert overlay_records[0]["overlay_base_filename"] == "base.png"
    assert overlay_records[0]["overlay_base_image_id"] == base["id"]
    assert overlay_records[0]["side"] == "front"


def test_overlay_assignment_can_unassign_overlay(client):
    project_id, headers = _create_project_for_part_image_tests(client, "Overlay unassignment project")
    base = _upload_part_test_image(client, project_id, headers, "base-unassign.png", {"side": "front"})
    overlay = _upload_part_test_image(client, project_id, headers, "overlay-unassign.png", {"overlay": True})
    part_response = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-OVERLAY-UNASSIGN", "display_name": "Overlay Unassign Target"},
        headers=headers,
    )
    assert part_response.status_code == 201, part_response.text
    part_id = part_response.json()["id"]
    assert client.post(
        f"/api/projects/{project_id}/parts/image-assignments",
        json={"filename": base["filename"], "to_part_id": part_id},
        headers=headers,
    ).status_code == 200
    assert client.post(
        f"/api/projects/{project_id}/parts/overlay-assignments",
        json={"overlay_filename": overlay["filename"], "base_filename": base["filename"]},
        headers=headers,
    ).status_code == 200

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
    assert [record for record in parts_response.json()[0]["metadata"]["source_images"] if record.get("overlay")] == []


def test_duplicate_filename_assignment_and_overlay_use_image_ids(client):
    project_id, headers = _create_project_for_part_image_tests(client, "Duplicate filename PT3 overlay project")
    base = _upload_part_test_image(client, project_id, headers, "scan.png", {"side": "axial", "modality": "volume"})
    overlay = _upload_part_test_image(client, project_id, headers, "scan.png", {"modality": "mask", "overlay": True})
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
