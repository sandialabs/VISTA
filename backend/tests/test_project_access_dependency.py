"""Characterization tests for the single project/image access seam.

Every project-scoped and image-scoped route resolves access through
``utils.dependencies.get_project_or_403`` / ``get_image_or_403``. Revoking group
membership at that one seam must deny every route family, and archived projects
must be rejected with one status and detail across routers.
"""

import io
from pathlib import Path
from unittest.mock import patch

import pytest

from utils.dependencies import ARCHIVED_PROJECT_DETAIL

ROUTERS_DIR = Path(__file__).resolve().parents[1] / "routers"
SHARED_ACCESS_SEAM = "utils.dependencies.is_user_in_group"


def _create_project(client, name="Access Seam Project"):
    resp = client.post(
        "/api/projects/",
        json={"name": name, "meta_group_id": "data-scientists"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _upload_image(client, project_id):
    resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("seam.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _png_bytes():
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color=(10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.parametrize(
    "path_template",
    [
        "/api/projects/{project_id}",
        "/api/projects/{project_id}/data-summary",
        "/api/projects/{project_id}/parts",
        "/api/projects/{project_id}/configuration",
        "/api/projects/{project_id}/export-bundle-json",
        "/api/projects/{project_id}/images-page",
    ],
)
def test_revoking_shared_seam_denies_project_routes(client, path_template):
    project_id = _create_project(client)
    url = path_template.format(project_id=project_id)
    assert client.get(url).status_code == 200

    with patch(SHARED_ACCESS_SEAM, return_value=False):
        resp = client.get(url)

    assert resp.status_code == 403
    assert f"does not have access to project '{project_id}'" in resp.json()["detail"]


@pytest.mark.parametrize(
    "path_template",
    [
        "/api/images/{image_id}",
        "/api/images/{image_id}/download",
        "/api/images/{image_id}/content",
        "/api/images/{image_id}/thumbnail",
        "/api/images/{image_id}/comments",
    ],
)
def test_revoking_shared_seam_denies_image_routes(client, path_template):
    project_id = _create_project(client)
    image_id = _upload_image(client, project_id)
    url = path_template.format(image_id=image_id)

    with patch(SHARED_ACCESS_SEAM, return_value=False):
        resp = client.get(url)

    assert resp.status_code == 403


def test_missing_project_is_404_before_access_check(client):
    resp = client.get("/api/projects/00000000-0000-0000-0000-000000000000/parts")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Project not found"


def test_soft_deleted_image_is_404_unless_include_deleted(client):
    project_id = _create_project(client)
    image_id = _upload_image(client, project_id)
    delete_resp = client.request(
        "DELETE",
        f"/api/projects/{project_id}/images/{image_id}",
        json={"reason": "seam test"},
    )
    assert delete_resp.status_code == 200, delete_resp.text

    assert client.get(f"/api/images/{image_id}").status_code == 404
    assert (
        client.get(
            f"/api/images/{image_id}", params={"include_deleted": "true"}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    ("method", "path_template", "body"),
    [
        ("PUT", "/api/projects/{project_id}", {"name": "Renamed"}),
        ("PUT", "/api/projects/{project_id}/configuration", {"config": {}}),
        ("POST", "/api/projects/{project_id}/groups", {"identifier": "G1"}),
    ],
)
def test_archived_project_writes_share_one_rejection(
    client, method, path_template, body
):
    project_id = _create_project(client)
    assert client.patch(f"/api/projects/{project_id}/archive").status_code == 200

    resp = client.request(method, path_template.format(project_id=project_id), json=body)

    assert resp.status_code == 403
    assert resp.json()["detail"] == ARCHIVED_PROJECT_DETAIL


def test_routers_only_call_group_membership_for_target_groups():
    """Project access goes through the shared seam, not per-router checks.

    ``projects.py`` still checks the *target* group on create and group moves,
    ``users.py`` checks admin membership and lists groups, and ``export.py``
    passes the checker to restore-as-new imports that pick a target group.
    """
    allowed = {"projects.py", "users.py", "export.py"}
    offenders = sorted(
        path.name
        for path in ROUTERS_DIR.glob("*.py")
        if path.name not in allowed
        and "is_user_in_group" in path.read_text(encoding="utf-8")
    )
    assert offenders == []
