"""Tests for bounding box classes and user annotation endpoints."""
import pytest
import uuid
import io


@pytest.fixture
def _setup_project_and_image(client):
    """Create a project and upload an image, returning both IDs."""
    resp = client.post("/api/projects", json={
        "name": "BBox Test Project",
        "description": "Project for bbox annotation tests",
        "meta_group_id": "test-group",
    })
    assert resp.status_code in (200, 201)
    project = resp.json()
    project_id = project["id"]

    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("test.png", fake_image, "image/png")},
    )
    assert resp.status_code in (200, 201)
    image = resp.json()
    image_id = image["id"]

    return project_id, image_id


@pytest.fixture
def _setup_with_bbox_class(client, _setup_project_and_image):
    """Create a project, image, and bbox class."""
    project_id, image_id = _setup_project_and_image

    resp = client.post(f"/api/projects/{project_id}/bbox-classes", json={
        "name": "Vehicle",
        "description": "Cars, trucks, etc.",
        "color": "#FF0000",
    })
    assert resp.status_code == 201
    bbox_class = resp.json()
    bbox_class_id = bbox_class["id"]

    return project_id, image_id, bbox_class_id


class TestBBoxClassAPI:
    """Test the bbox class CRUD endpoints."""

    def test_create_bbox_class(self, client, _setup_project_and_image):
        project_id, _image_id = _setup_project_and_image
        resp = client.post(f"/api/projects/{project_id}/bbox-classes", json={
            "name": "Pedestrian",
            "description": "People walking",
            "color": "#00FF00",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Pedestrian"
        assert data["description"] == "People walking"
        assert data["color"] == "#00FF00"
        assert data["project_id"] == project_id
        assert data["id"] is not None
        assert data["created_at"] is not None

    def test_list_bbox_classes(self, client, _setup_project_and_image):
        project_id, _image_id = _setup_project_and_image

        client.post(f"/api/projects/{project_id}/bbox-classes", json={
            "name": "Car",
            "color": "#FF0000",
        })
        client.post(f"/api/projects/{project_id}/bbox-classes", json={
            "name": "Truck",
            "color": "#0000FF",
        })

        resp = client.get(f"/api/projects/{project_id}/bbox-classes")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        names = {c["name"] for c in data}
        assert names == {"Car", "Truck"}

    def test_update_bbox_class(self, client, _setup_project_and_image):
        project_id, _image_id = _setup_project_and_image

        create_resp = client.post(
            f"/api/projects/{project_id}/bbox-classes",
            json={"name": "Old Name", "color": "#111111"},
        )
        class_id = create_resp.json()["id"]

        resp = client.patch(f"/api/bbox-classes/{class_id}", json={
            "name": "New Name",
            "color": "#222222",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "New Name"
        assert data["color"] == "#222222"

    def test_delete_bbox_class(self, client, _setup_project_and_image):
        project_id, _image_id = _setup_project_and_image

        create_resp = client.post(
            f"/api/projects/{project_id}/bbox-classes",
            json={"name": "ToDelete", "color": "#333333"},
        )
        class_id = create_resp.json()["id"]

        resp = client.delete(f"/api/bbox-classes/{class_id}")
        assert resp.status_code == 204

        # Confirm it is gone from the list
        resp = client.get(f"/api/projects/{project_id}/bbox-classes")
        ids = [c["id"] for c in resp.json()]
        assert class_id not in ids

    def test_delete_bbox_class_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.delete(f"/api/bbox-classes/{fake_id}")
        assert resp.status_code == 404


class TestUserAnnotationAPI:
    """Test the user annotation CRUD endpoints."""

    def test_create_annotation(self, client, _setup_with_bbox_class):
        project_id, image_id, bbox_class_id = _setup_with_bbox_class
        resp = client.post(f"/api/images/{image_id}/user-annotations", json={
            "bbox_class_id": bbox_class_id,
            "bbox_x_min": 10.0,
            "bbox_y_min": 20.0,
            "bbox_x_max": 100.0,
            "bbox_y_max": 200.0,
            "image_width": 640,
            "image_height": 480,
            "notes": "Test annotation",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["bbox_class_id"] == bbox_class_id
        assert data["image_id"] == image_id
        assert data["project_id"] == project_id
        assert data["bbox_x_min"] == 10.0
        assert data["bbox_y_max"] == 200.0
        assert data["image_width"] == 640
        assert data["id"] is not None

    def test_list_annotations_for_image(self, client, _setup_with_bbox_class):
        _project_id, image_id, bbox_class_id = _setup_with_bbox_class

        # Create two annotations
        for x_min in (10.0, 200.0):
            client.post(f"/api/images/{image_id}/user-annotations", json={
                "bbox_class_id": bbox_class_id,
                "bbox_x_min": x_min,
                "bbox_y_min": 20.0,
                "bbox_x_max": x_min + 50.0,
                "bbox_y_max": 70.0,
                "image_width": 640,
                "image_height": 480,
            })

        resp = client.get(f"/api/images/{image_id}/user-annotations")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_update_annotation(self, client, _setup_with_bbox_class):
        _project_id, image_id, bbox_class_id = _setup_with_bbox_class

        create_resp = client.post(
            f"/api/images/{image_id}/user-annotations",
            json={
                "bbox_class_id": bbox_class_id,
                "bbox_x_min": 10.0,
                "bbox_y_min": 20.0,
                "bbox_x_max": 100.0,
                "bbox_y_max": 200.0,
                "image_width": 640,
                "image_height": 480,
            },
        )
        annotation_id = create_resp.json()["id"]

        resp = client.put(f"/api/user-annotations/{annotation_id}", json={
            "bbox_x_min": 15.0,
            "bbox_y_min": 25.0,
            "notes": "Adjusted position",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["bbox_x_min"] == 15.0
        assert data["bbox_y_min"] == 25.0
        assert data["notes"] == "Adjusted position"

    def test_delete_annotation(self, client, _setup_with_bbox_class):
        _project_id, image_id, bbox_class_id = _setup_with_bbox_class

        create_resp = client.post(
            f"/api/images/{image_id}/user-annotations",
            json={
                "bbox_class_id": bbox_class_id,
                "bbox_x_min": 10.0,
                "bbox_y_min": 20.0,
                "bbox_x_max": 100.0,
                "bbox_y_max": 200.0,
                "image_width": 640,
                "image_height": 480,
            },
        )
        annotation_id = create_resp.json()["id"]

        resp = client.delete(f"/api/user-annotations/{annotation_id}")
        assert resp.status_code == 204

        # Confirm it is gone
        resp = client.get(f"/api/images/{image_id}/user-annotations")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_create_annotation_invalid_class_id(
        self, client, _setup_project_and_image
    ):
        _project_id, image_id = _setup_project_and_image
        fake_class_id = str(uuid.uuid4())
        resp = client.post(f"/api/images/{image_id}/user-annotations", json={
            "bbox_class_id": fake_class_id,
            "bbox_x_min": 10.0,
            "bbox_y_min": 20.0,
            "bbox_x_max": 100.0,
            "bbox_y_max": 200.0,
            "image_width": 640,
            "image_height": 480,
        })
        assert resp.status_code == 400

    def test_export_coco_format(self, client, _setup_with_bbox_class):
        project_id, image_id, bbox_class_id = _setup_with_bbox_class

        # Create an annotation to export
        client.post(f"/api/images/{image_id}/user-annotations", json={
            "bbox_class_id": bbox_class_id,
            "bbox_x_min": 10.0,
            "bbox_y_min": 20.0,
            "bbox_x_max": 100.0,
            "bbox_y_max": 200.0,
            "image_width": 640,
            "image_height": 480,
        })

        resp = client.get(
            f"/api/projects/{project_id}/user-annotations/export",
            params={"format": "coco"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "images" in data
        assert "annotations" in data
        assert "categories" in data
        assert len(data["annotations"]) == 1
        bbox = data["annotations"][0]["bbox"]
        assert bbox[0] == 10.0  # x
        assert bbox[1] == 20.0  # y
        assert bbox[2] == 90.0  # width
        assert bbox[3] == 180.0  # height

    def test_annotation_for_nonexistent_image(self, client):
        fake_image_id = str(uuid.uuid4())
        fake_class_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/images/{fake_image_id}/user-annotations",
            json={
                "bbox_class_id": fake_class_id,
                "bbox_x_min": 0,
                "bbox_y_min": 0,
                "bbox_x_max": 50,
                "bbox_y_max": 50,
                "image_width": 100,
                "image_height": 100,
            },
        )
        assert resp.status_code == 404

    def test_delete_annotation_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.delete(f"/api/user-annotations/{fake_id}")
        assert resp.status_code == 404
