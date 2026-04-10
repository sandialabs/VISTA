"""Tests for the image grouping feature."""
import pytest
import uuid
import io


@pytest.fixture
def _setup_project(client):
    """Create a project, return project_id."""
    resp = client.post("/api/projects", json={
        "name": "Group Test Project",
        "description": "Project for group tests",
        "meta_group_id": "test-group",
    })
    assert resp.status_code in (200, 201)
    return resp.json()["id"]


@pytest.fixture
def _setup_project_and_images(client, _setup_project):
    """Create a project and two images, return (project_id, image_id_1, image_id_2)."""
    project_id = _setup_project

    def _upload(filename):
        fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
        resp = client.post(
            f"/api/projects/{project_id}/images",
            files={"file": (filename, fake_image, "image/png")},
        )
        assert resp.status_code in (200, 201)
        return resp.json()["id"]

    img1 = _upload("img1.png")
    img2 = _upload("img2.png")
    return project_id, img1, img2


class TestGroupCRUD:
    """Test group CRUD API endpoints."""

    def test_list_groups_empty(self, client, _setup_project):
        project_id = _setup_project
        resp = client.get(f"/api/projects/{project_id}/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["groups"] == []

    def test_create_group(self, client, _setup_project):
        project_id = _setup_project
        resp = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "SN001", "display_name": "Serial 001"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["identifier"] == "SN001"
        assert data["display_name"] == "Serial 001"
        assert data["project_id"] == project_id
        assert data["id"] is not None

    def test_create_duplicate_group_returns_409(self, client, _setup_project):
        project_id = _setup_project
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "DUP"})
        resp = client.post(f"/api/projects/{project_id}/groups", json={"identifier": "DUP"})
        assert resp.status_code == 409

    def test_create_group_strips_whitespace(self, client, _setup_project):
        project_id = _setup_project
        resp = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "  SN001  "},
        )
        assert resp.status_code == 201
        assert resp.json()["identifier"] == "SN001"
        # Creating with the stripped version should conflict
        resp2 = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "SN001"},
        )
        assert resp2.status_code == 409

    def test_list_groups_with_data(self, client, _setup_project):
        project_id = _setup_project
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "A"})
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "B"})
        resp = client.get(f"/api/projects/{project_id}/groups")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["groups"]) == 2

    def test_list_groups_search(self, client, _setup_project):
        project_id = _setup_project
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "ABC"})
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "XYZ"})
        resp = client.get(f"/api/projects/{project_id}/groups?search=AB")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["groups"][0]["identifier"] == "ABC"

    def test_search_escapes_like_wildcards(self, client, _setup_project):
        project_id = _setup_project
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "100%_done"})
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "100X done"})
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "1005 done"})
        # Searching for literal "100%" should only match the first group
        resp = client.get(f"/api/projects/{project_id}/groups", params={"search": "100%"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["groups"][0]["identifier"] == "100%_done"
        # Searching for literal "_done" should only match the first group
        resp = client.get(f"/api/projects/{project_id}/groups?search=_done")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["groups"][0]["identifier"] == "100%_done"

    def test_get_group(self, client, _setup_project):
        project_id = _setup_project
        create_resp = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "SN010"},
        )
        group_id = create_resp.json()["id"]
        resp = client.get(f"/api/groups/{group_id}")
        assert resp.status_code == 200
        assert resp.json()["identifier"] == "SN010"

    def test_get_group_not_found(self, client):
        resp = client.get(f"/api/groups/{uuid.uuid4()}")
        assert resp.status_code == 404

    def test_update_group(self, client, _setup_project):
        project_id = _setup_project
        create_resp = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "OLD"},
        )
        group_id = create_resp.json()["id"]
        resp = client.patch(
            f"/api/groups/{group_id}",
            json={"identifier": "NEW", "display_name": "Updated"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["identifier"] == "NEW"
        assert data["display_name"] == "Updated"

    def test_clear_display_name_to_null(self, client, _setup_project):
        project_id = _setup_project
        create_resp = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "DN-TEST", "display_name": "Has Name"},
        )
        group_id = create_resp.json()["id"]
        assert create_resp.json()["display_name"] == "Has Name"
        resp = client.patch(
            f"/api/groups/{group_id}",
            json={"display_name": None},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] is None

    def test_update_with_null_identifier_preserves_original(self, client, _setup_project):
        """Sending identifier=null should not bypass the duplicate check or clear the identifier."""
        project_id = _setup_project
        # Create two groups
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "KEEP"})
        g2 = client.post(f"/api/projects/{project_id}/groups", json={"identifier": "OTHER"}).json()
        # PATCH with identifier=null should leave identifier unchanged
        resp = client.patch(
            f"/api/groups/{g2['id']}",
            json={"identifier": None, "display_name": "Updated"},
        )
        assert resp.status_code == 200
        assert resp.json()["identifier"] == "OTHER"
        assert resp.json()["display_name"] == "Updated"

    def test_update_duplicate_identifier_returns_409(self, client, _setup_project):
        """Changing identifier to one that already exists should return 409."""
        project_id = _setup_project
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "TAKEN"})
        g2 = client.post(f"/api/projects/{project_id}/groups", json={"identifier": "FREE"}).json()
        resp = client.patch(
            f"/api/groups/{g2['id']}",
            json={"identifier": "TAKEN"},
        )
        assert resp.status_code == 409

    def test_empty_patch_is_noop(self, client, _setup_project):
        """An empty PATCH body should succeed without modifying the group."""
        project_id = _setup_project
        created = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "STABLE", "display_name": "Original"},
        ).json()
        resp = client.patch(f"/api/groups/{created['id']}", json={})
        assert resp.status_code == 200
        assert resp.json()["identifier"] == "STABLE"
        assert resp.json()["display_name"] == "Original"

    def test_delete_group_unlinks_images(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        # Create group and assign images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "G1"},
        ).json()
        group_id = group["id"]
        client.post(f"/api/groups/{group_id}/images", json=[img1, img2])
        # Delete group without deleting images
        resp = client.delete(f"/api/groups/{group_id}")
        assert resp.status_code == 204
        # Images should still exist and be ungrouped
        img_resp = client.get(f"/api/images/{img1}")
        assert img_resp.status_code == 200
        assert img_resp.json()["group_id"] is None

    def test_delete_group_with_images(self, client, _setup_project_and_images):
        project_id, img1, _ = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "G2"},
        ).json()
        group_id = group["id"]
        client.post(f"/api/groups/{group_id}/images", json=[img1])
        resp = client.delete(f"/api/groups/{group_id}?delete_images=true")
        assert resp.status_code == 204
        # Image should be soft-deleted with full retention fields
        img_resp = client.get(f"/api/images/{img1}", params={"include_deleted": "true"})
        img_data = img_resp.json()
        assert img_data["deleted_at"] is not None
        assert img_data["pending_hard_delete_at"] is not None
        assert img_data["deletion_reason"] == "Group deleted"
        # Audit event should exist
        events_resp = client.get(
            f"/api/projects/{project_id}/images/deletion-events",
            params={"image_id": img1},
        )
        assert events_resp.status_code == 200
        events = events_resp.json()["events"]
        assert len(events) >= 1
        assert events[0]["action"] == "soft_delete"


class TestGroupImageAssignment:
    """Test assigning/removing images from groups."""

    def test_assign_images(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "G3"},
        ).json()
        group_id = group["id"]
        resp = client.post(f"/api/groups/{group_id}/images", json=[img1, img2])
        assert resp.status_code == 200
        assert resp.json()["assigned"] == 2
        # Image should now reference the group
        img_resp = client.get(f"/api/images/{img1}")
        assert img_resp.json()["group_id"] == group_id

    def test_remove_images(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "G4"},
        ).json()
        group_id = group["id"]
        client.post(f"/api/groups/{group_id}/images", json=[img1, img2])
        resp = client.request("DELETE", f"/api/groups/{group_id}/images", json=[img1])
        assert resp.status_code == 200
        assert resp.json()["removed"] == 1
        img_resp = client.get(f"/api/images/{img1}")
        assert img_resp.json()["group_id"] is None

    def test_group_image_count(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "G5"},
        ).json()
        group_id = group["id"]
        client.post(f"/api/groups/{group_id}/images", json=[img1, img2])
        detail = client.get(f"/api/groups/{group_id}").json()
        assert detail["image_count"] == 2

    def test_assign_skips_soft_deleted_images(self, client, _setup_project_and_images):
        """Soft-deleted images should not be assignable to a group."""
        project_id, img1, img2 = _setup_project_and_images
        # Soft-delete img1
        client.request(
            "DELETE",
            f"/api/projects/{project_id}/images/{img1}",
            json={"reason": "test soft-delete for group assignment"},
        )
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "G-DEL"},
        ).json()
        group_id = group["id"]
        resp = client.post(f"/api/groups/{group_id}/images", json=[img1, img2])
        assert resp.status_code == 200
        # Only the live image should have been assigned
        assert resp.json()["assigned"] == 1
        detail = client.get(f"/api/groups/{group_id}").json()
        assert detail["image_count"] == 1


class TestGroupImageFilter:
    """Test filtering images by group in the images list endpoint."""

    def test_filter_by_group_id(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "F1"},
        ).json()
        group_id = group["id"]
        client.post(f"/api/groups/{group_id}/images", json=[img1])
        resp = client.get(f"/api/projects/{project_id}/images?group_id={group_id}")
        assert resp.status_code == 200
        ids = [img["id"] for img in resp.json()]
        assert img1 in ids
        assert img2 not in ids

    def test_filter_ungrouped(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "F2"},
        ).json()
        group_id = group["id"]
        client.post(f"/api/groups/{group_id}/images", json=[img1])
        resp = client.get(f"/api/projects/{project_id}/images?ungrouped=true")
        assert resp.status_code == 200
        ids = [img["id"] for img in resp.json()]
        assert img1 not in ids
        assert img2 in ids

    def test_deleted_only_with_group_id_returns_400(self, client, _setup_project):
        project_id = _setup_project
        resp = client.get(
            f"/api/projects/{project_id}/images",
            params={"deleted_only": "true", "group_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 400

    def test_deleted_only_with_ungrouped_returns_400(self, client, _setup_project):
        project_id = _setup_project
        resp = client.get(
            f"/api/projects/{project_id}/images",
            params={"deleted_only": "true", "ungrouped": "true"},
        )
        assert resp.status_code == 400


class TestHasGroups:
    """Test the has-groups endpoint."""

    def test_no_groups(self, client, _setup_project):
        project_id = _setup_project
        resp = client.get(f"/api/projects/{project_id}/has-groups")
        assert resp.status_code == 200
        assert resp.json()["has_groups"] is False

    def test_with_groups(self, client, _setup_project):
        project_id = _setup_project
        client.post(f"/api/projects/{project_id}/groups", json={"identifier": "X"})
        resp = client.get(f"/api/projects/{project_id}/has-groups")
        assert resp.status_code == 200
        assert resp.json()["has_groups"] is True


class TestUngroupedCount:
    """Test the ungrouped-count endpoint."""

    def test_all_ungrouped(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        resp = client.get(f"/api/projects/{project_id}/ungrouped-count")
        assert resp.status_code == 200
        assert resp.json()["count"] == 2

    def test_some_grouped(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups", json={"identifier": "G1"}
        ).json()
        client.post(f"/api/groups/{group['id']}/images", json=[img1])
        resp = client.get(f"/api/projects/{project_id}/ungrouped-count")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_all_grouped(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups", json={"identifier": "G1"}
        ).json()
        client.post(f"/api/groups/{group['id']}/images", json=[img1, img2])
        resp = client.get(f"/api/projects/{project_id}/ungrouped-count")
        assert resp.status_code == 200
        assert resp.json()["count"] == 0


class TestGroupArchiveProtection:
    """Test that group mutations are blocked on archived projects."""

    def test_create_group_blocked_on_archived_project(self, client, _setup_project):
        project_id = _setup_project
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "BLOCKED"},
        )
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_update_group_blocked_on_archived_project(self, client, _setup_project):
        project_id = _setup_project
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "BEFORE"},
        ).json()
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.patch(
            f"/api/groups/{group['id']}",
            json={"display_name": "Updated"},
        )
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_delete_group_blocked_on_archived_project(self, client, _setup_project):
        project_id = _setup_project
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "DEL"},
        ).json()
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.delete(f"/api/groups/{group['id']}")
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_assign_images_blocked_on_archived_project(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "ASSIGN"},
        ).json()
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.post(f"/api/groups/{group['id']}/images", json=[img1])
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_remove_images_blocked_on_archived_project(self, client, _setup_project_and_images):
        project_id, img1, img2 = _setup_project_and_images
        group = client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "REMOVE"},
        ).json()
        client.post(f"/api/groups/{group['id']}/images", json=[img1])
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.request("DELETE", f"/api/groups/{group['id']}/images", json=[img1])
        assert resp.status_code == 403
        assert "archived" in resp.json()["detail"].lower()

    def test_read_groups_allowed_on_archived_project(self, client, _setup_project):
        """Read-only group operations should still work on archived projects."""
        project_id = _setup_project
        client.post(
            f"/api/projects/{project_id}/groups",
            json={"identifier": "READABLE"},
        )
        client.patch(f"/api/projects/{project_id}/archive")
        resp = client.get(f"/api/projects/{project_id}/groups")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


class TestUploadWithGroupIdentifier:
    """Test that upload with group_identifier creates/assigns the group."""

    def test_upload_creates_group(self, client, _setup_project):
        project_id = _setup_project
        fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
        resp = client.post(
            f"/api/projects/{project_id}/images",
            files={"file": ("test_grouped.png", fake_image, "image/png")},
            data={"group_identifier": "PART-123"},
        )
        assert resp.status_code in (200, 201)
        image_data = resp.json()
        assert image_data["group_id"] is not None

        # Verify the group was created
        groups_resp = client.get(f"/api/projects/{project_id}/groups")
        groups = groups_resp.json()["groups"]
        assert any(g["identifier"] == "PART-123" for g in groups)

    def test_upload_reuses_existing_group(self, client, _setup_project):
        project_id = _setup_project
        # Upload two images with the same group_identifier
        for i in range(2):
            fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
            client.post(
                f"/api/projects/{project_id}/images",
                files={"file": (f"img{i}.png", fake_image, "image/png")},
                data={"group_identifier": "SHARED"},
            )
        groups_resp = client.get(f"/api/projects/{project_id}/groups")
        groups = groups_resp.json()["groups"]
        shared_groups = [g for g in groups if g["identifier"] == "SHARED"]
        assert len(shared_groups) == 1
        assert shared_groups[0]["image_count"] == 2
