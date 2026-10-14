import uuid
from contextlib import contextmanager
from unittest.mock import patch

import pytest

from utils.dependencies import ARCHIVED_PROJECT_DETAIL

@contextmanager
def _group_membership(**kwargs):
    """Patch target-group checks in the router and the shared access check."""
    with patch("routers.projects.is_user_in_group", **kwargs), patch(
        "utils.dependencies.is_user_in_group", **kwargs
    ):
        yield


SYNTHETIC_USERS = [
    {"label": "basic", "suffix": "Basic"},
    {"label": "intermediate", "suffix": "Intermediate"},
    {"label": "advanced", "suffix": "Advanced"},
]


def test_projects_list_initially_empty(client):
    r = client.get("/api/projects/")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.smoke
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


def test_update_project_access_group_persists_for_authorized_destination(client):
    source_group = "project-config-source"
    destination_group = "project-config-destination"
    with _group_membership(return_value=True):
        create_resp = client.post(
            "/api/projects/",
            json={"name": "Movable Project", "meta_group_id": source_group},
        )
        assert create_resp.status_code == 201
        project_id = create_resp.json()["id"]

        update_resp = client.put(
            f"/api/projects/{project_id}",
            json={"meta_group_id": destination_group},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["meta_group_id"] == destination_group

        persisted_resp = client.get(f"/api/projects/{project_id}")
        assert persisted_resp.status_code == 200
        assert persisted_resp.json()["meta_group_id"] == destination_group


def test_update_project_access_group_rejects_unauthorized_destination_without_mutation(
    client,
):
    source_group = "project-config-source"
    destination_group = "project-config-restricted"
    create_resp = client.post(
        "/api/projects/",
        json={"name": "Restricted Move", "meta_group_id": source_group},
    )
    assert create_resp.status_code == 201
    project_id = create_resp.json()["id"]

    with _group_membership(
        side_effect=lambda _email, group_id: group_id == source_group
    ):
        update_resp = client.put(
            f"/api/projects/{project_id}",
            json={"meta_group_id": destination_group},
        )
        assert update_resp.status_code == 403
        assert destination_group in update_resp.json()["detail"]

        persisted_resp = client.get(f"/api/projects/{project_id}")
        assert persisted_resp.status_code == 200
        assert persisted_resp.json()["meta_group_id"] == source_group


@pytest.mark.parametrize("invalid_group", ["", "g" * 256])
def test_update_project_access_group_rejects_invalid_length_without_mutation(
    client,
    invalid_group,
):
    source_group = "project-config-source"
    create_resp = client.post(
        "/api/projects/",
        json={"name": "Validated Move", "meta_group_id": source_group},
    )
    assert create_resp.status_code == 201
    project_id = create_resp.json()["id"]

    update_resp = client.put(
        f"/api/projects/{project_id}",
        json={"meta_group_id": invalid_group},
    )
    assert update_resp.status_code == 422

    persisted_resp = client.get(f"/api/projects/{project_id}")
    assert persisted_resp.status_code == 200
    assert persisted_resp.json()["meta_group_id"] == source_group


def test_archive_and_unarchive_project(client):
    payload = {"name": "ArchTest", "description": "", "meta_group_id": "g1"}
    r = client.post("/api/projects/", json=payload)
    assert r.status_code == 201
    pid = r.json()["id"]

    r2 = client.patch(f"/api/projects/{pid}/archive")
    assert r2.status_code == 200
    data = r2.json()
    assert data["is_archived"] is True
    assert data["archived_at"] is not None

    r3 = client.get("/api/projects/")
    ids = [p["id"] for p in r3.json()]
    assert pid not in ids

    r4 = client.get("/api/projects/?include_archived=true")
    ids4 = [p["id"] for p in r4.json()]
    assert pid in ids4

    r5 = client.patch(f"/api/projects/{pid}/unarchive")
    assert r5.status_code == 200
    assert r5.json()["is_archived"] is False
    assert r5.json()["archived_at"] is None

    r6 = client.get("/api/projects/")
    ids6 = [p["id"] for p in r6.json()]
    assert pid in ids6


def test_archived_project_rejects_access_group_update_without_mutation(client):
    source_group = "archived-project-source"
    destination_group = "archived-project-destination"
    with _group_membership(return_value=True):
        create_resp = client.post(
            "/api/projects/",
            json={"name": "Archived Access Group", "meta_group_id": source_group},
        )
        assert create_resp.status_code == 201
        project_id = create_resp.json()["id"]

        archive_resp = client.patch(f"/api/projects/{project_id}/archive")
        assert archive_resp.status_code == 200
        assert archive_resp.json()["is_archived"] is True

        update_resp = client.put(
            f"/api/projects/{project_id}",
            json={"meta_group_id": destination_group},
        )
        assert update_resp.status_code == 403
        assert update_resp.json()["detail"] == ARCHIVED_PROJECT_DETAIL

        persisted_resp = client.get(f"/api/projects/{project_id}")
        assert persisted_resp.status_code == 200
        assert persisted_resp.json()["meta_group_id"] == source_group
        assert persisted_resp.json()["is_archived"] is True


def test_archive_nonexistent_project_returns_404(client):
    fake_id = str(uuid.uuid4())
    r = client.patch(f"/api/projects/{fake_id}/archive")
    assert r.status_code == 404


def test_delete_project_requires_exact_confirmation_phrase_for_progressive_users(
    client,
):
    project_type = "PT2"
    for scenario in SYNTHETIC_USERS:
        project_name = f"{project_type}-{scenario['suffix']}-Project"
        create_resp = client.post(
            "/api/projects/",
            json={
                "name": project_name,
                "description": f"{scenario['label']} synthetic workflow",
                "meta_group_id": "data-scientists",
                "project_type": project_type,
            },
        )
        assert create_resp.status_code == 201
        project_id = create_resp.json()["id"]

        bad_delete = client.request(
            "DELETE",
            f"/api/projects/{project_id}",
            json={"confirmation_phrase": "DELETE SOMETHING ELSE"},
        )
        assert bad_delete.status_code == 400
        assert "Confirmation phrase mismatch" in bad_delete.json()["detail"]

        good_delete = client.request(
            "DELETE",
            f"/api/projects/{project_id}",
            json={"confirmation_phrase": f"DELETE {project_name}"},
        )
        assert good_delete.status_code == 200
        payload = good_delete.json()
        assert payload["project_id"] == project_id
        assert payload["deleted"] is True
        assert payload["deleted_by"] == "test@example.com"

        missing_after_delete = client.get(f"/api/projects/{project_id}")
        assert missing_after_delete.status_code == 404


def test_delete_project_rejects_api_key_auth_for_progressive_users(client):
    project_type = "PT2"
    for scenario in SYNTHETIC_USERS:
        project_name = f"{project_type}-{scenario['suffix']}-Governance"
        create_resp = client.post(
            "/api/projects/",
            json={
                "name": project_name,
                "description": f"{scenario['label']} auth boundary case",
                "meta_group_id": "data-scientists",
                "project_type": project_type,
            },
        )
        assert create_resp.status_code == 201
        project_id = create_resp.json()["id"]

        delete_resp = client.request(
            "DELETE",
            f"/api/projects/{project_id}",
            json={"confirmation_phrase": f"DELETE {project_name}"},
            headers={"Authorization": "Bearer synthetic-api-key"},
        )
        assert delete_resp.status_code == 403
        assert "authenticated user context" in delete_resp.json()["detail"]


def test_delete_project_rejects_group_unauthorized_user_for_progressive_users(client):
    project_type = "PT2"
    for scenario in SYNTHETIC_USERS:
        project_name = f"{project_type}-{scenario['suffix']}-Restricted"
        create_resp = client.post(
            "/api/projects/",
            json={
                "name": project_name,
                "description": f"{scenario['label']} unauthorized delete path",
                "meta_group_id": "data-scientists",
                "project_type": project_type,
            },
        )
        assert create_resp.status_code == 201
        project_id = create_resp.json()["id"]

        with _group_membership(return_value=False):
            delete_resp = client.request(
                "DELETE",
                f"/api/projects/{project_id}",
                json={"confirmation_phrase": f"DELETE {project_name}"},
            )

        assert delete_resp.status_code == 403
        assert "does not have access to project" in delete_resp.json()["detail"]
