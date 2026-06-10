import io

from PIL import Image


def _png_bytes(color):
    image = Image.new("RGB", (4, 4), color=color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer.getvalue()


def test_project_list_includes_loaded_image_and_part_counts_for_dashboard_cards(client):
    headers = {"X-User-Id": "dashboard-counts@example.com", "X-User-Groups": '["dashboard-counts-group"]'}
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Dashboard counts project",
            "description": "Regression coverage for project cards",
            "meta_group_id": "dashboard-counts-group",
            "project_type": "PT1",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    image_ids = []
    for filename, color in [("front.png", "red"), ("back.png", "blue"), ("removed.png", "green")]:
        image_resp = client.post(
            f"/api/projects/{project_id}/images",
            files={"file": (filename, _png_bytes(color), "image/png")},
            data={"metadata": "{}"},
            headers=headers,
        )
        assert image_resp.status_code == 201, image_resp.text
        image_ids.append(image_resp.json()["id"])

    delete_resp = client.request(
        "DELETE",
        f"/api/projects/{project_id}/images/{image_ids[-1]}",
        json={"reason": "not loaded anymore"},
        headers=headers,
    )
    assert delete_resp.status_code == 200, delete_resp.text

    for serial in ["PART-001", "PART-002"]:
        part_resp = client.post(
            f"/api/projects/{project_id}/parts",
            json={"serial_number": serial, "display_name": serial},
            headers=headers,
        )
        assert part_resp.status_code == 201, part_resp.text

    list_resp = client.get("/api/projects/", headers=headers)
    assert list_resp.status_code == 200, list_resp.text
    project = next(item for item in list_resp.json() if item["id"] == project_id)

    assert project["image_count"] == 2
    assert project["part_count"] == 2
