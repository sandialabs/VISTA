"""Tests for user annotation CRUD and review status."""
import pytest
import uuid


def _setup_for_annotations(client, auth_headers):
    """Create project, collection in annotating phase, with a bbox class."""
    project = client.post("/api/projects/", json={
        "name": "Annotation Test Project",
        "description": "Test",
        "meta_group_id": "test-group",
    }, headers=auth_headers).json()
    coll = client.post(f"/api/projects/{project['id']}/collections", json={
        "name": f"Ann Test {uuid.uuid4().hex[:8]}",
        "description": "Test",
        "purpose": "labeling",
    }, headers=auth_headers).json()
    # Create bbox class while in draft
    bbox_class = client.post(f"/api/collections/{coll['id']}/bbox-classes", json={
        "name": "Defect",
        "color": "#FF0000",
    }, headers=auth_headers).json()
    # Advance to annotating
    client.patch(f"/api/collections/{coll['id']}/phase", json={"phase": "annotating"}, headers=auth_headers)
    return project, coll, bbox_class


class TestAnnotationCRUD:
    def test_create_annotation_requires_valid_image(self, client, auth_headers):
        project, coll, bbox_class = _setup_for_annotations(client, auth_headers)
        # Use a non-existent image UUID -- the endpoint should return 404
        # because the image does not exist in the database.
        resp = client.post(f"/api/images/{uuid.uuid4()}/annotations", json={
            "image_id": str(uuid.uuid4()),
            "bbox_class_id": bbox_class["id"],
            "collection_id": coll["id"],
            "x_min": 10.0,
            "y_min": 20.0,
            "x_max": 100.0,
            "y_max": 200.0,
            "image_width": 1024,
            "image_height": 768,
        }, headers=auth_headers)
        assert resp.status_code == 404

    def test_list_annotations_requires_valid_image(self, client, auth_headers):
        project, coll, bbox_class = _setup_for_annotations(client, auth_headers)
        resp = client.get(f"/api/images/{uuid.uuid4()}/annotations", headers=auth_headers)
        assert resp.status_code == 404

    def test_origin_defaults_to_manual(self, client, auth_headers):
        from core.schemas_annotations import UserAnnotationCreate
        ann = UserAnnotationCreate(
            image_id=uuid.uuid4(),
            bbox_class_id=uuid.uuid4(),
            x_min=0, y_min=0, x_max=10, y_max=10,
            image_width=100, image_height=100,
        )
        assert ann.origin == "manual"


class TestAnnotationReviewStatus:
    def test_review_nonexistent_annotation(self, client, auth_headers):
        resp = client.post(f"/api/annotations/{uuid.uuid4()}/review", json={
            "review_status": "approved",
        }, headers=auth_headers)
        assert resp.status_code == 404

    def test_annotation_review_summary_requires_image(self, client, auth_headers):
        resp = client.get(f"/api/images/{uuid.uuid4()}/annotations/review-summary", headers=auth_headers)
        assert resp.status_code == 404
