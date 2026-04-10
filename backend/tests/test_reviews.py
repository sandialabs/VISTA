"""Tests for the review verification workflow."""
import pytest
import uuid


@pytest.fixture
def _setup_project_and_image(client):
    """Create a project, then upload an image, returning both IDs."""
    # Create project
    resp = client.post("/api/projects", json={
        "name": "Review Test Project",
        "description": "Project for review tests",
        "meta_group_id": "test-group",
    })
    assert resp.status_code == 200 or resp.status_code == 201
    project = resp.json()
    project_id = project["id"]

    # Upload a minimal image
    import io
    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("test.png", fake_image, "image/png")},
    )
    assert resp.status_code in (200, 201)
    image = resp.json()
    image_id = image["id"]

    return project_id, image_id


class TestReviewAPI:
    """Test the review CRUD endpoints."""

    def test_create_review_pass(self, client, _setup_project_and_image):
        project_id, image_id = _setup_project_and_image
        resp = client.post(f"/api/images/{image_id}/reviews", json={
            "status": "pass",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "pass"
        assert data["image_id"] == image_id
        assert data["project_id"] == project_id
        assert data["reviewer_id"] is not None
        assert data["id"] is not None

    def test_create_review_reject_pending(self, client, _setup_project_and_image):
        project_id, image_id = _setup_project_and_image
        resp = client.post(f"/api/images/{image_id}/reviews", json={
            "status": "reject_pending",
            "notes": "Bounding boxes are inaccurate",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "reject_pending"
        assert data["notes"] == "Bounding boxes are inaccurate"

    def test_create_review_reject_confirmed(self, client, _setup_project_and_image):
        _project_id, image_id = _setup_project_and_image
        resp = client.post(f"/api/images/{image_id}/reviews", json={
            "status": "reject_confirmed",
        })
        assert resp.status_code == 201
        assert resp.json()["status"] == "reject_confirmed"

    def test_create_review_invalid_status(self, client, _setup_project_and_image):
        _project_id, image_id = _setup_project_and_image
        resp = client.post(f"/api/images/{image_id}/reviews", json={
            "status": "invalid_status",
        })
        assert resp.status_code == 422

    def test_list_reviews(self, client, _setup_project_and_image):
        _project_id, image_id = _setup_project_and_image
        # Create two reviews
        client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        client.post(f"/api/images/{image_id}/reviews", json={"status": "reject_pending"})

        resp = client.get(f"/api/images/{image_id}/reviews")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        statuses = {r["status"] for r in data}
        assert statuses == {"pass", "reject_pending"}
        assert all("reviewer_email" in r for r in data)

    def test_get_image_review_status(self, client, _setup_project_and_image):
        _project_id, image_id = _setup_project_and_image

        # Before any reviews
        resp = client.get(f"/api/images/{image_id}/review-status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "unreviewed"
        assert data["review_count"] == 0

        # After a review
        client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        resp = client.get(f"/api/images/{image_id}/review-status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "pass"
        assert data["review_count"] == 1

    def test_delete_review(self, client, _setup_project_and_image):
        _project_id, image_id = _setup_project_and_image

        # Create a review
        create_resp = client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        review_id = create_resp.json()["id"]

        # Delete it
        resp = client.delete(f"/api/reviews/{review_id}")
        assert resp.status_code == 204

        # Confirm it's gone
        resp = client.get(f"/api/images/{image_id}/reviews")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_delete_review_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.delete(f"/api/reviews/{fake_id}")
        assert resp.status_code == 404

    def test_project_review_status(self, client, _setup_project_and_image):
        project_id, image_id = _setup_project_and_image

        resp = client.get(f"/api/projects/{project_id}/review-status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_images"] >= 1
        assert data["unreviewed"] >= 1
        assert data["reviewed"] == 0

        # Review the image
        client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        resp = client.get(f"/api/projects/{project_id}/review-status")
        data = resp.json()
        assert data["passed"] == 1
        assert data["reviewed"] == 1

    def test_image_review_statuses_bulk(self, client, _setup_project_and_image):
        project_id, image_id = _setup_project_and_image

        resp = client.get(f"/api/projects/{project_id}/image-review-statuses")
        assert resp.status_code == 200
        data = resp.json()
        assert data[image_id] == "unreviewed"

        client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        resp = client.get(f"/api/projects/{project_id}/image-review-statuses")
        data = resp.json()
        assert data[image_id] == "pass"

    def test_review_for_nonexistent_image(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.post(f"/api/images/{fake_id}/reviews", json={"status": "pass"})
        assert resp.status_code == 404

    def test_create_review_blocked_on_archived_project(self, client, _setup_project_and_image):
        """Creating a review should be rejected when the project is archived."""
        project_id, image_id = _setup_project_and_image
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_delete_review_blocked_on_archived_project(self, client, _setup_project_and_image):
        """Deleting a review should be rejected when the project is archived."""
        project_id, image_id = _setup_project_and_image
        # Create a review while project is still active
        resp = client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        assert resp.status_code == 201
        review_id = resp.json()["id"]
        # Archive the project
        client.patch(f"/api/projects/{project_id}/archive")
        # Attempt to delete the review
        resp = client.delete(f"/api/reviews/{review_id}")
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_read_reviews_allowed_on_archived_project(self, client, _setup_project_and_image):
        """Reading reviews should still work when the project is archived."""
        project_id, image_id = _setup_project_and_image
        client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.get(f"/api/images/{image_id}/reviews")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
