import uuid
import pytest


def test_projects_list_initially_empty(client):
    r = client.get("/api/projects/")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_read_project(client):
    payload = {"name": "P1", "description": "d", "meta_group_id": "g1"}
    r = client.post("/api/projects/", json=payload)
    assert r.status_code == 201
    proj = r.json()
    pid = proj["id"]
    r2 = client.get(f"/api/projects/{pid}")
    assert r2.status_code == 200
    assert r2.json()["name"] == "P1"


def test_create_project_stores_created_by(client):
    payload = {"name": "CreatorTest", "description": "", "meta_group_id": "g1"}
    r = client.post("/api/projects/", json=payload)
    assert r.status_code == 201
    proj = r.json()
    assert proj["created_by"] is not None
    assert proj["is_archived"] is False
    assert proj["archived_at"] is None


def test_archive_and_unarchive_project(client):
    payload = {"name": "ArchTest", "description": "", "meta_group_id": "g1"}
    r = client.post("/api/projects/", json=payload)
    assert r.status_code == 201
    pid = r.json()["id"]

    # Archive
    r2 = client.patch(f"/api/projects/{pid}/archive")
    assert r2.status_code == 200
    data = r2.json()
    assert data["is_archived"] is True
    assert data["archived_at"] is not None

    # Archived project should NOT appear in default listing
    r3 = client.get("/api/projects/")
    ids = [p["id"] for p in r3.json()]
    assert pid not in ids

    # Archived project SHOULD appear when include_archived=true
    r4 = client.get("/api/projects/?include_archived=true")
    ids4 = [p["id"] for p in r4.json()]
    assert pid in ids4

    # Unarchive
    r5 = client.patch(f"/api/projects/{pid}/unarchive")
    assert r5.status_code == 200
    assert r5.json()["is_archived"] is False
    assert r5.json()["archived_at"] is None

    # Should appear again in default listing
    r6 = client.get("/api/projects/")
    ids6 = [p["id"] for p in r6.json()]
    assert pid in ids6


def test_archived_project_is_read_only(client):
    """Image upload should be rejected for archived projects."""
    import io

    payload = {"name": "ROTest", "description": "", "meta_group_id": "g1"}
    r = client.post("/api/projects/", json=payload)
    assert r.status_code == 201
    pid = r.json()["id"]

    # Archive it
    client.patch(f"/api/projects/{pid}/archive")

    # Try to upload an image
    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    r2 = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("test.png", fake_image, "image/png")},
    )
    assert r2.status_code == 403
    assert "archived" in r2.json()["detail"].lower()


def test_archive_nonexistent_project_returns_404(client):
    fake_id = str(uuid.uuid4())
    r = client.patch(f"/api/projects/{fake_id}/archive")
    assert r.status_code == 404


def test_default_listing_excludes_archived(client):
    """The default GET /api/projects/ should exclude archived projects."""
    r1 = client.post("/api/projects/", json={"name": "Active", "description": "", "meta_group_id": "g1"})
    r2 = client.post("/api/projects/", json={"name": "ToArchive", "description": "", "meta_group_id": "g1"})
    assert r1.status_code == 201
    assert r2.status_code == 201
    archived_id = r2.json()["id"]
    client.patch(f"/api/projects/{archived_id}/archive")

    # Default listing should not include archived
    resp = client.get("/api/projects/")
    ids = [p["id"] for p in resp.json()]
    assert archived_id not in ids

    # Explicit include_archived should include it
    resp2 = client.get("/api/projects/?include_archived=true")
    ids2 = [p["id"] for p in resp2.json()]
    assert archived_id in ids2


def test_archived_project_blocks_metadata_mutation(client):
    """Project metadata mutations should be blocked for archived projects."""
    r = client.post("/api/projects/", json={"name": "MetaTest", "description": "", "meta_group_id": "g1"})
    assert r.status_code == 201
    pid = r.json()["id"]
    client.patch(f"/api/projects/{pid}/archive")

    r2 = client.post(f"/api/projects/{pid}/metadata", json={"key": "k", "value": "v"})
    assert r2.status_code == 403
    assert "archived" in r2.json()["detail"].lower()


def test_archived_project_blocks_class_creation(client):
    """Image class creation should be blocked for archived projects."""
    r = client.post("/api/projects/", json={"name": "ClassTest", "description": "", "meta_group_id": "g1"})
    assert r.status_code == 201
    pid = r.json()["id"]
    client.patch(f"/api/projects/{pid}/archive")

    r2 = client.post(
        f"/api/projects/{pid}/classes",
        json={"name": "TestClass", "project_id": pid},
    )
    assert r2.status_code == 403
    assert "archived" in r2.json()["detail"].lower()


def test_archived_project_blocks_group_creation(client):
    """Group creation should be blocked for archived projects."""
    r = client.post("/api/projects/", json={"name": "GroupArchTest", "description": "", "meta_group_id": "g1"})
    assert r.status_code == 201
    pid = r.json()["id"]
    client.patch(f"/api/projects/{pid}/archive")

    r2 = client.post(
        f"/api/projects/{pid}/groups",
        json={"identifier": "grp1", "project_id": pid},
    )
    assert r2.status_code == 403
    assert "archived" in r2.json()["detail"].lower()


def test_archived_project_blocks_comment_creation(client):
    """Comment creation should be blocked for archived projects."""
    import io

    # Create project and upload an image before archiving
    r = client.post("/api/projects/", json={"name": "CommentArchTest", "description": "", "meta_group_id": "g1"})
    assert r.status_code == 201
    pid = r.json()["id"]

    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    img_resp = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("test.png", fake_image, "image/png")},
    )
    assert img_resp.status_code == 201
    image_id = img_resp.json()["id"]

    # Archive the project
    client.patch(f"/api/projects/{pid}/archive")

    # Attempt to add a comment
    r2 = client.post(
        f"/api/images/{image_id}/comments",
        json={"text": "This should be blocked"},
    )
    assert r2.status_code == 403
    assert "archived" in r2.json()["detail"].lower()


def test_archived_project_blocks_image_deletion(client):
    """Image deletion should be blocked for archived projects."""
    import io

    r = client.post("/api/projects/", json={"name": "DelArchTest", "description": "", "meta_group_id": "g1"})
    assert r.status_code == 201
    pid = r.json()["id"]

    fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    img_resp = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("test.png", fake_image, "image/png")},
    )
    assert img_resp.status_code == 201
    image_id = img_resp.json()["id"]

    # Archive the project
    client.patch(f"/api/projects/{pid}/archive")

    # Attempt to delete the image
    import json
    r2 = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        content=json.dumps({"reason": "Testing archive block"}),
        headers={"Content-Type": "application/json"},
    )
    assert r2.status_code == 403
    assert "archived" in r2.json()["detail"].lower()
