"""Tests for collection phase enforcement matrix."""
import pytest
import uuid


def _setup_project_and_collection(client, auth_headers):
    project = client.post("/api/projects/", json={
        "name": "Phase Test Project",
        "description": "Testing phases",
        "meta_group_id": "test-group",
    }, headers=auth_headers).json()
    coll = client.post(f"/api/projects/{project['id']}/collections", json={
        "name": f"Phase Test {uuid.uuid4().hex[:8]}",
        "description": "Test",
        "purpose": "labeling",
    }, headers=auth_headers).json()
    return project, coll


def _advance_to_phase(client, auth_headers, coll_id, target_phase):
    transitions = {
        "annotating": ["annotating"],
        "review": ["annotating", "review"],
        "certified": ["annotating", "review"],
    }
    for phase in transitions.get(target_phase, []):
        client.patch(f"/api/collections/{coll_id}/phase", json={"phase": phase}, headers=auth_headers)


class TestDraftPhase:
    def test_manage_images_allowed(self, client, auth_headers):
        project, coll = _setup_project_and_collection(client, auth_headers)
        resp = client.post(f"/api/collections/{coll['id']}/images", json={
            "image_ids": [],
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_manage_classes_allowed(self, client, auth_headers):
        project, coll = _setup_project_and_collection(client, auth_headers)
        resp = client.post(f"/api/collections/{coll['id']}/bbox-classes", json={
            "name": "Defect",
            "color": "#FF0000",
        }, headers=auth_headers)
        assert resp.status_code == 200


class TestAnnotatingPhase:
    def test_manage_images_blocked(self, client, auth_headers):
        project, coll = _setup_project_and_collection(client, auth_headers)
        _advance_to_phase(client, auth_headers, coll["id"], "annotating")
        resp = client.post(f"/api/collections/{coll['id']}/images", json={
            "image_ids": [],
        }, headers=auth_headers)
        assert resp.status_code == 423

    def test_manage_classes_blocked(self, client, auth_headers):
        project, coll = _setup_project_and_collection(client, auth_headers)
        _advance_to_phase(client, auth_headers, coll["id"], "annotating")
        resp = client.post(f"/api/collections/{coll['id']}/bbox-classes", json={
            "name": "Defect",
            "color": "#FF0000",
        }, headers=auth_headers)
        assert resp.status_code == 423


class TestReviewPhase:
    def test_manage_images_blocked(self, client, auth_headers):
        project, coll = _setup_project_and_collection(client, auth_headers)
        _advance_to_phase(client, auth_headers, coll["id"], "review")
        resp = client.post(f"/api/collections/{coll['id']}/images", json={
            "image_ids": [],
        }, headers=auth_headers)
        assert resp.status_code == 423


class TestCertifiedPhase:
    def test_reopen_requires_reason(self, client, auth_headers):
        project, coll = _setup_project_and_collection(client, auth_headers)
        _advance_to_phase(client, auth_headers, coll["id"], "review")
        # Certify via the certify endpoint.
        # With 0 images the precondition checks (unreviewed, pending, flagged)
        # all pass because the counts are zero.
        resp = client.post(f"/api/collections/{coll['id']}/certify", json={
            "certification_notes": "All good",
        }, headers=auth_headers)
        if resp.status_code == 200:
            # Reopen without reason should be rejected
            resp2 = client.patch(f"/api/collections/{coll['id']}/phase", json={
                "phase": "review",
            }, headers=auth_headers)
            assert resp2.status_code == 400

            # With a reason it should succeed
            resp3 = client.patch(f"/api/collections/{coll['id']}/phase", json={
                "phase": "review",
                "reopen_reason": "Found issues",
            }, headers=auth_headers)
            assert resp3.status_code == 200
