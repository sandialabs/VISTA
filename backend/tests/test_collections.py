"""Tests for collections and annotation review endpoints."""
import pytest
import uuid
import io


@pytest.fixture
def _setup_project_and_image(client):
    """Create a project and upload an image, returning both IDs."""
    resp = client.post("/api/projects", json={
        "name": "Collection Test Project",
        "description": "Project for collection tests",
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
def _setup_with_collection(client, _setup_project_and_image):
    """Create a project, image, and collection."""
    project_id, image_id = _setup_project_and_image

    resp = client.post(f"/api/projects/{project_id}/collections", json={
        "name": "Test Collection",
        "description": "A test collection",
    })
    assert resp.status_code == 201
    collection = resp.json()
    collection_id = collection["id"]

    return project_id, image_id, collection_id


@pytest.fixture
def _setup_with_annotation(client, _setup_project_and_image):
    """Create a project, image, bbox class, and annotation for review tests."""
    project_id, image_id = _setup_project_and_image

    resp = client.post(f"/api/projects/{project_id}/bbox-classes", json={
        "name": "Defect",
        "color": "#FF0000",
    })
    assert resp.status_code == 201
    bbox_class_id = resp.json()["id"]

    resp = client.post(f"/api/images/{image_id}/user-annotations", json={
        "bbox_class_id": bbox_class_id,
        "bbox_x_min": 10.0,
        "bbox_y_min": 20.0,
        "bbox_x_max": 100.0,
        "bbox_y_max": 200.0,
        "image_width": 640,
        "image_height": 480,
    })
    assert resp.status_code == 201
    annotation_id = resp.json()["id"]

    return project_id, image_id, annotation_id


class TestCollectionAPI:
    """Test the collection CRUD endpoints."""

    def test_create_collection(self, client, _setup_project_and_image):
        project_id, _image_id = _setup_project_and_image
        resp = client.post(f"/api/projects/{project_id}/collections", json={
            "name": "My Collection",
            "description": "Batch of inspection images",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "My Collection"
        assert data["description"] == "Batch of inspection images"
        assert data["project_id"] == project_id
        assert data["is_locked"] is False
        assert data["id"] is not None
        assert data["created_at"] is not None

    def test_list_collections(self, client, _setup_project_and_image):
        project_id, _image_id = _setup_project_and_image

        client.post(f"/api/projects/{project_id}/collections", json={
            "name": "Collection A",
        })
        client.post(f"/api/projects/{project_id}/collections", json={
            "name": "Collection B",
        })

        resp = client.get(f"/api/projects/{project_id}/collections")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        names = {c["name"] for c in data}
        assert names == {"Collection A", "Collection B"}

    def test_update_collection(self, client, _setup_with_collection):
        _project_id, _image_id, collection_id = _setup_with_collection

        resp = client.patch(f"/api/collections/{collection_id}", json={
            "name": "Updated Name",
            "description": "Updated description",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "Updated description"

    def test_delete_collection(self, client, _setup_with_collection):
        project_id, _image_id, collection_id = _setup_with_collection

        resp = client.delete(f"/api/collections/{collection_id}")
        assert resp.status_code == 204

        # Confirm it is gone
        resp = client.get(f"/api/projects/{project_id}/collections")
        ids = [c["id"] for c in resp.json()]
        assert collection_id not in ids

    def test_add_images_to_collection(self, client, _setup_with_collection):
        _project_id, image_id, collection_id = _setup_with_collection

        resp = client.post(f"/api/collections/{collection_id}/images", json={
            "image_ids": [image_id],
        })
        assert resp.status_code == 201
        data = resp.json()
        assert len(data) >= 1
        assert any(item["image_id"] == image_id for item in data)

    def test_list_collection_images(self, client, _setup_with_collection):
        _project_id, image_id, collection_id = _setup_with_collection

        # Add image first
        client.post(f"/api/collections/{collection_id}/images", json={
            "image_ids": [image_id],
        })

        resp = client.get(f"/api/collections/{collection_id}/images")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["image_id"] == image_id
        assert data[0]["collection_id"] == collection_id

    def test_remove_image_from_collection(
        self, client, _setup_with_collection
    ):
        _project_id, image_id, collection_id = _setup_with_collection

        # Add then remove
        client.post(f"/api/collections/{collection_id}/images", json={
            "image_ids": [image_id],
        })

        resp = client.delete(
            f"/api/collections/{collection_id}/images/{image_id}"
        )
        assert resp.status_code == 204

        # Confirm removal
        resp = client.get(f"/api/collections/{collection_id}/images")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_lock_collection(self, client, _setup_with_collection):
        _project_id, _image_id, collection_id = _setup_with_collection

        resp = client.post(f"/api/collections/{collection_id}/lock", json={
            "reason": "Ready for review",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_locked"] is True
        assert data["lock_reason"] == "Ready for review"

    def test_unlock_collection(self, client, _setup_with_collection):
        _project_id, _image_id, collection_id = _setup_with_collection

        # Lock first
        client.post(f"/api/collections/{collection_id}/lock", json={
            "reason": "Temporary lock",
        })

        # Then unlock
        resp = client.post(
            f"/api/collections/{collection_id}/unlock", json={}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_locked"] is False

    def test_locked_collection_rejects_modifications(
        self, client, _setup_with_collection
    ):
        _project_id, image_id, collection_id = _setup_with_collection

        # Lock the collection
        client.post(f"/api/collections/{collection_id}/lock", json={
            "reason": "Locked for testing",
        })

        # Attempt to update name -- should be rejected
        resp = client.patch(f"/api/collections/{collection_id}", json={
            "name": "Should Fail",
        })
        assert resp.status_code == 409

        # Attempt to delete -- should be rejected
        resp = client.delete(f"/api/collections/{collection_id}")
        assert resp.status_code == 409

        # Attempt to add images -- should be rejected
        resp = client.post(f"/api/collections/{collection_id}/images", json={
            "image_ids": [image_id],
        })
        assert resp.status_code == 409

        # Attempt to remove image -- should be rejected
        resp = client.delete(
            f"/api/collections/{collection_id}/images/{image_id}"
        )
        assert resp.status_code == 409

    def test_delete_collection_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.delete(f"/api/collections/{fake_id}")
        assert resp.status_code == 404


class TestAnnotationReviewAPI:
    """Test the annotation review endpoints."""

    def test_create_annotation_review(self, client, _setup_with_annotation):
        _project_id, _image_id, annotation_id = _setup_with_annotation

        resp = client.post(
            f"/api/user-annotations/{annotation_id}/reviews",
            json={
                "action": "approve",
                "comment": "Annotation looks correct",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["action"] == "approve"
        assert data["comment"] == "Annotation looks correct"
        assert data["annotation_id"] == annotation_id
        assert data["annotation_type"] == "user"
        assert data["id"] is not None

    def test_create_review_reject(self, client, _setup_with_annotation):
        _project_id, _image_id, annotation_id = _setup_with_annotation

        resp = client.post(
            f"/api/user-annotations/{annotation_id}/reviews",
            json={
                "action": "reject",
                "comment": "Bounding box is too loose",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["action"] == "reject"

    def test_create_review_flag_revision(
        self, client, _setup_with_annotation
    ):
        _project_id, _image_id, annotation_id = _setup_with_annotation

        resp = client.post(
            f"/api/user-annotations/{annotation_id}/reviews",
            json={
                "action": "flag_revision",
                "comment": "Needs tighter bounds",
                "edits_made": {"bbox_x_min": 15.0},
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["action"] == "flag_revision"
        assert data["edits_made"] == {"bbox_x_min": 15.0}

    def test_create_review_invalid_action(
        self, client, _setup_with_annotation
    ):
        _project_id, _image_id, annotation_id = _setup_with_annotation

        resp = client.post(
            f"/api/user-annotations/{annotation_id}/reviews",
            json={"action": "invalid_action"},
        )
        assert resp.status_code == 422

    def test_list_annotation_reviews(self, client, _setup_with_annotation):
        _project_id, _image_id, annotation_id = _setup_with_annotation

        # Create two reviews
        client.post(
            f"/api/user-annotations/{annotation_id}/reviews",
            json={"action": "reject", "comment": "Too wide"},
        )
        client.post(
            f"/api/user-annotations/{annotation_id}/reviews",
            json={"action": "approve", "comment": "Fixed now"},
        )

        resp = client.get(
            f"/api/user-annotations/{annotation_id}/reviews"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        actions = {r["action"] for r in data}
        assert actions == {"reject", "approve"}

    def test_list_reviews_empty(self, client, _setup_with_annotation):
        _project_id, _image_id, annotation_id = _setup_with_annotation

        resp = client.get(
            f"/api/user-annotations/{annotation_id}/reviews"
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 0
