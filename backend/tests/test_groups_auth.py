"""Authorization boundary tests for the image grouping feature.

Verifies that users cannot access groups belonging to projects they
are not members of.
"""

import uuid
from unittest.mock import patch

import pytest


def _restricted_group_check(user_email: str, group_id: str) -> bool:
    """A mock group_auth that maps specific users to specific groups."""
    mapping = {
        "alice@example.com": ["alpha"],
        "bob@example.com": ["beta"],
    }
    return group_id in mapping.get(user_email, [])


@pytest.fixture
def _patched_auth():
    """Disable the DEBUG-mode bypass so group_auth actually enforces membership."""
    with patch("core.group_auth.settings") as mock_settings:
        mock_settings.DEBUG = False
        mock_settings.SKIP_HEADER_CHECK = False
        mock_settings.MOCK_USER_EMAIL = "nobody@example.com"
        mock_settings.MOCK_USER_GROUPS = []
        with patch(
            "core.group_auth._check_group_membership",
            side_effect=_restricted_group_check,
        ):
            # Clear the cached results so patched auth takes effect
            from core.group_auth_helper import clear_cache

            clear_cache()
            yield
            clear_cache()


@pytest.fixture
def _alice_project(_patched_auth, client):
    """Create a project owned by alice in group 'alpha'."""
    resp = client.post(
        "/api/projects",
        json={"name": "Alpha Project", "description": "", "meta_group_id": "alpha"},
        headers={"X-User-Email": "alice@example.com"},
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


@pytest.fixture
def _alice_group(_alice_project, client):
    """Create a group inside alice's project."""
    resp = client.post(
        f"/api/projects/{_alice_project}/groups",
        json={"identifier": "PART-A1"},
        headers={"X-User-Email": "alice@example.com"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestCrossProjectGroupAccess:
    """Verify that bob cannot access alice's project groups."""

    def test_list_groups_forbidden(self, client, _alice_project):
        resp = client.get(
            f"/api/projects/{_alice_project}/groups",
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_create_group_forbidden(self, client, _alice_project):
        resp = client.post(
            f"/api/projects/{_alice_project}/groups",
            json={"identifier": "SNEAK"},
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_get_group_forbidden(self, client, _alice_group):
        resp = client.get(
            f"/api/groups/{_alice_group}",
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_update_group_forbidden(self, client, _alice_group):
        resp = client.patch(
            f"/api/groups/{_alice_group}",
            json={"display_name": "Hacked"},
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_delete_group_forbidden(self, client, _alice_group):
        resp = client.delete(
            f"/api/groups/{_alice_group}",
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_assign_images_forbidden(self, client, _alice_group):
        resp = client.post(
            f"/api/groups/{_alice_group}/images",
            json=[str(uuid.uuid4())],
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_remove_images_forbidden(self, client, _alice_group):
        resp = client.request(
            "DELETE",
            f"/api/groups/{_alice_group}/images",
            json=[str(uuid.uuid4())],
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_has_groups_forbidden(self, client, _alice_project):
        resp = client.get(
            f"/api/projects/{_alice_project}/has-groups",
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403

    def test_ungrouped_count_forbidden(self, client, _alice_project):
        resp = client.get(
            f"/api/projects/{_alice_project}/ungrouped-count",
            headers={"X-User-Email": "bob@example.com"},
        )
        assert resp.status_code == 403


class TestAuthorizedAccess:
    """Verify alice can still access her own project groups."""

    def test_alice_can_list_groups(self, client, _alice_project):
        resp = client.get(
            f"/api/projects/{_alice_project}/groups",
            headers={"X-User-Email": "alice@example.com"},
        )
        assert resp.status_code == 200

    def test_alice_can_get_group(self, client, _alice_group):
        resp = client.get(
            f"/api/groups/{_alice_group}",
            headers={"X-User-Email": "alice@example.com"},
        )
        assert resp.status_code == 200
        assert resp.json()["identifier"] == "PART-A1"
