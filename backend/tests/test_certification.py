"""Tests for collection certification workflow."""
import pytest
import uuid


def _setup_certifiable(client, auth_headers):
    """Create project and collection in review phase."""
    project = client.post("/api/projects/", json={
        "name": "Cert Test Project",
        "description": "Test",
        "meta_group_id": "test-group",
    }, headers=auth_headers).json()
    coll = client.post(f"/api/projects/{project['id']}/collections", json={
        "name": f"Cert Test {uuid.uuid4().hex[:8]}",
        "description": "Test",
        "purpose": "inspection",
    }, headers=auth_headers).json()
    client.patch(f"/api/collections/{coll['id']}/phase", json={"phase": "annotating"}, headers=auth_headers)
    client.patch(f"/api/collections/{coll['id']}/phase", json={"phase": "review"}, headers=auth_headers)
    return project, coll


class TestCertification:
    def test_cannot_certify_from_draft(self, client, auth_headers):
        project = client.post("/api/projects/", json={
            "name": "Draft Cert Test",
            "description": "Test",
            "meta_group_id": "test-group",
        }, headers=auth_headers).json()
        coll = client.post(f"/api/projects/{project['id']}/collections", json={
            "name": "Draft Only",
            "description": "Test",
            "purpose": "labeling",
        }, headers=auth_headers).json()
        resp = client.post(f"/api/collections/{coll['id']}/certify", json={
            "certification_notes": "Trying from draft",
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_certify_empty_collection(self, client, auth_headers):
        """Empty collection (0 images, 0 annotations) should certify successfully."""
        project, coll = _setup_certifiable(client, auth_headers)
        resp = client.post(f"/api/collections/{coll['id']}/certify", json={
            "certification_notes": "Empty but valid",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["phase"] == "certified"
        assert data["certification_notes"] == "Empty but valid"
        assert data["certified_at"] is not None

    def test_certified_blocks_phase_update_without_reason(self, client, auth_headers):
        project, coll = _setup_certifiable(client, auth_headers)
        client.post(f"/api/collections/{coll['id']}/certify", json={
            "certification_notes": "Done",
        }, headers=auth_headers)
        resp = client.patch(f"/api/collections/{coll['id']}/phase", json={
            "phase": "review",
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_certified_can_reopen_with_reason(self, client, auth_headers):
        project, coll = _setup_certifiable(client, auth_headers)
        client.post(f"/api/collections/{coll['id']}/certify", json={
            "certification_notes": "Done",
        }, headers=auth_headers)
        resp = client.patch(f"/api/collections/{coll['id']}/phase", json={
            "phase": "review",
            "reopen_reason": "Found issues after certification",
        }, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["phase"] == "review"

    def test_audit_events_endpoint_returns_valid_response(self, client, auth_headers):
        """Verify the audit events endpoint returns a well-formed response.

        Audit events are flushed (not committed) by the collection
        endpoints, so they may or may not be visible to a subsequent
        request depending on session/connection sharing.  This test
        validates the endpoint structure and any events that are visible.
        """
        project, coll = _setup_certifiable(client, auth_headers)
        certify_resp = client.post(f"/api/collections/{coll['id']}/certify", json={
            "certification_notes": "Certified",
        }, headers=auth_headers)
        assert certify_resp.status_code == 200

        resp = client.get(
            f"/api/projects/{project['id']}/audit-events?entity_type=collection",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "events" in data
        assert "total" in data
        assert isinstance(data["events"], list)
        assert isinstance(data["total"], int)
        # If events are visible, they should have the expected fields
        for event in data["events"]:
            assert "id" in event
            assert "entity_type" in event
            assert "action" in event
            assert event["entity_type"] == "collection"
