"""Tests for per-image review CRUD and progress."""
import pytest
import uuid


def _setup_review_env(client, auth_headers):
    project = client.post("/api/projects/", json={
        "name": "Review Test Project",
        "description": "Test",
        "meta_group_id": "test-group",
    }, headers=auth_headers).json()
    coll = client.post(f"/api/projects/{project['id']}/collections", json={
        "name": f"Review Test {uuid.uuid4().hex[:8]}",
        "description": "Test",
        "purpose": "labeling",
    }, headers=auth_headers).json()
    # Advance to review phase
    client.patch(f"/api/collections/{coll['id']}/phase", json={"phase": "annotating"}, headers=auth_headers)
    client.patch(f"/api/collections/{coll['id']}/phase", json={"phase": "review"}, headers=auth_headers)
    return project, coll


class TestImageReviewCRUD:
    def test_review_image_in_review_phase(self, client, auth_headers):
        project, coll = _setup_review_env(client, auth_headers)
        fake_image_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/collections/{coll['id']}/images/{fake_image_id}/review",
            json={"status": "reviewed", "notes": "Looks good"},
            headers=auth_headers,
        )
        # The important assertion: the phase check should NOT block this
        # (review_image is allowed in the review phase).
        # The endpoint may fail for other reasons (e.g. FK constraint on
        # the non-existent image in SQLite), but 423 would mean a phase
        # enforcement bug.
        assert resp.status_code != 423

    def test_get_nonexistent_review(self, client, auth_headers):
        project, coll = _setup_review_env(client, auth_headers)
        resp = client.get(
            f"/api/collections/{coll['id']}/images/{uuid.uuid4()}/review",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    def test_review_progress_empty_collection(self, client, auth_headers):
        project, coll = _setup_review_env(client, auth_headers)
        resp = client.get(
            f"/api/collections/{coll['id']}/review-progress",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_images"] == 0
        assert data["reviewed"] == 0
        assert data["unreviewed"] == 0

    def test_review_blocked_in_draft(self, client, auth_headers):
        project = client.post("/api/projects/", json={
            "name": "Draft Review Test",
            "description": "Test",
            "meta_group_id": "test-group",
        }, headers=auth_headers).json()
        coll = client.post(f"/api/projects/{project['id']}/collections", json={
            "name": "Draft Col",
            "description": "Test",
            "purpose": "labeling",
        }, headers=auth_headers).json()
        resp = client.post(
            f"/api/collections/{coll['id']}/images/{uuid.uuid4()}/review",
            json={"status": "reviewed"},
            headers=auth_headers,
        )
        assert resp.status_code == 423
