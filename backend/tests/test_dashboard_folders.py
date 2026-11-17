"""Dashboard organization: access groups, folders, locks, moves, search, activity.

Covers the dashboard-folders spec end to end through the HTTP API:

* P1  the project list filters by group *before* paging (no silent loss > 100).
* P2  access groups come from the auth backend (empty groups are listed).
* P3  ``last_activity_at`` moves on data changes only.
* Folder create/rename/edit/move/archive/unarchive/delete rules.
* Projects never move between access groups.
* Archive locks are inherited and restore the earlier state on unarchive.
* Search, filters, sort and pagination of ``/api/dashboard/items``.
"""

from __future__ import annotations

import io
import time
import uuid
from contextlib import contextmanager
from unittest.mock import patch

import pytest

from core.config import settings

GROUP = "data-scientists"
OTHER = "project-alpha-group"


# --- helpers ---------------------------------------------------------------


def _project(client, name, group=GROUP, folder_id=None, **extra):
    body = {"name": name, "meta_group_id": group, **extra}
    if folder_id:
        body["folder_id"] = folder_id
    r = client.post("/api/projects/", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _folder(client, name, group=GROUP, parent_id=None, description=None):
    body = {"name": name, "meta_group_id": group}
    if parent_id:
        body["parent_id"] = parent_id
    if description is not None:
        body["description"] = description
    r = client.post("/api/folders", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _items(client, **params):
    params.setdefault("meta_group_id", GROUP)
    r = client.get("/api/dashboard/items", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _tree(client, group=GROUP, include_archived=False):
    r = client.get(
        "/api/folders/tree",
        params={"meta_group_id": group, "include_archived": include_archived},
    )
    assert r.status_code == 200, r.text
    return {f["id"]: f for f in r.json()["folders"]}


def _png():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), color=(1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


@contextmanager
def _members_of(*groups):
    """Run as a user who belongs to exactly ``groups`` (no debug bypass)."""
    allowed = set(groups)

    def check(_email, group_id, _user=None):
        return group_id in allowed

    with (
        patch("utils.dependencies.is_user_in_group", side_effect=check),
        patch("core.group_auth_helper.is_user_in_group", side_effect=check),
        patch("routers.projects.is_user_in_group", side_effect=check),
        patch(
            "core.group_auth_helper._core_enumerate_user_groups",
            return_value=sorted(allowed),
        ),
    ):
        yield


# --- P1: no silent loss past 100 --------------------------------------------


def test_project_list_filters_by_group_before_paging(client):
    """150 other-group projects created first must not push the user's own
    projects off the first page."""
    for i in range(150):
        _project(client, f"other-{i}", group="someone-elses-group")
    mine = [_project(client, f"mine-{i}")["id"] for i in range(5)]

    with _members_of(GROUP):
        r = client.get("/api/projects/")
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert sorted(ids) == sorted(mine)
        assert r.headers["X-Total-Count"] == "5"


def test_project_list_returns_more_than_100_with_paging(client):
    for i in range(130):
        _project(client, f"p-{i:03d}")
    first = client.get("/api/projects/", params={"limit": 100})
    second = client.get("/api/projects/", params={"limit": 100, "skip": 100})
    assert first.headers["X-Total-Count"] == "130"
    got = {p["id"] for p in first.json()} | {p["id"] for p in second.json()}
    assert len(got) == 130


# --- P2: access groups come from the auth backend ---------------------------


def test_access_groups_include_groups_without_projects(client):
    r = client.get("/api/users/me/access-groups")
    assert r.status_code == 200
    assert set(settings.MOCK_USER_GROUPS) <= set(r.json())


def test_access_groups_list_only_member_groups(client):
    _project(client, "x", group="hidden-group")
    with _members_of(GROUP):
        r = client.get("/api/users/me/access-groups")
    assert r.json() == [GROUP]


def test_custom_backend_lists_groups_from_proxy_snapshot(monkeypatch):
    from core import group_auth, group_snapshot

    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SKIP_HEADER_CHECK", False)
    monkeypatch.setattr(settings, "VISTA_AUTH_BACKEND", "custom")
    monkeypatch.setitem(
        group_snapshot._entries,
        "alice@example.com",
        group_snapshot._Entry(frozenset({"g-new", "g-old"}), time.time(), 0.0),
    )
    assert group_auth.enumerate_user_groups("Alice@Example.com") == ["g-new", "g-old"]
    assert group_auth.enumerate_user_groups("nobody@example.com") == []


def test_api_key_groups_bound_the_access_group_list(monkeypatch):
    from core.group_auth_helper import list_accessible_groups
    from schemas.users import User

    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SKIP_HEADER_CHECK", False)
    user = User(email="k@example.com", key_groups=frozenset({"only-this"}))
    assert list_accessible_groups("k@example.com", user, ["a", "b"]) == ["only-this"]


# --- Folder CRUD ------------------------------------------------------------


def test_folder_create_requires_name_and_assigns_id(client):
    for bad in ["", "   ", "\n\t"]:
        r = client.post("/api/folders", json={"name": bad, "meta_group_id": GROUP})
        assert r.status_code == 422
    r = client.post("/api/folders", json={"meta_group_id": GROUP})
    assert r.status_code == 422
    f = _folder(client, "  Line 2  ", description="desc")
    uuid.UUID(f["id"])
    assert f["name"] == "Line 2"
    assert f["description"] == "desc"
    assert f["parent_id"] is None


def test_folder_names_unique_among_siblings_case_insensitive(client):
    parent = _folder(client, "Parent")
    _folder(client, "Alpha", parent_id=parent["id"])
    r = client.post(
        "/api/folders",
        json={"name": "ALPHA", "meta_group_id": GROUP, "parent_id": parent["id"]},
    )
    assert r.status_code == 409
    # Same name at a different level is fine.
    _folder(client, "Alpha")
    r = client.post("/api/folders", json={"name": "alpha", "meta_group_id": GROUP})
    assert r.status_code == 409
    # Same name in another access group is fine.
    _folder(client, "Alpha", group=OTHER)


def test_folder_rename_and_edit_description(client):
    f = _folder(client, "Old")
    r = client.patch(
        f"/api/folders/{f['id']}", json={"name": "New", "description": "d2"}
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New"
    assert r.json()["description"] == "d2"
    r = client.patch(f"/api/folders/{f['id']}", json={"name": "  "})
    assert r.status_code == 422


def test_folder_in_inaccessible_group_is_not_found(client):
    with _members_of(GROUP, "hidden-group"):
        f = _folder(client, "Secret", group="hidden-group")
    with _members_of(GROUP):
        assert client.get(f"/api/folders/{f['id']}").status_code == 404
        assert (
            client.patch(f"/api/folders/{f['id']}", json={"name": "x"}).status_code
            == 404
        )
        r = client.post(
            "/api/folders", json={"name": "x", "meta_group_id": "hidden-group"}
        )
        assert r.status_code == 403
        r = client.get("/api/folders/tree", params={"meta_group_id": "hidden-group"})
        assert r.status_code == 403
        r = client.get("/api/dashboard/items", params={"meta_group_id": "hidden-group"})
        assert r.status_code == 403


def test_subfolders_unlimited_until_depth_cap(client):
    from core.locks import MAX_FOLDER_DEPTH

    parent = None
    for i in range(MAX_FOLDER_DEPTH):
        parent = _folder(client, f"L{i}", parent_id=parent["id"] if parent else None)
    r = client.post(
        "/api/folders",
        json={"name": "too-deep", "meta_group_id": GROUP, "parent_id": parent["id"]},
    )
    assert r.status_code == 400
    assert len(parent["path"]) == MAX_FOLDER_DEPTH


# --- Moves ------------------------------------------------------------------


def test_move_folder_moves_contents(client):
    a = _folder(client, "A")
    b = _folder(client, "B")
    sub = _folder(client, "Sub", parent_id=a["id"])
    p = _project(client, "Inside", folder_id=sub["id"])

    r = client.post(f"/api/folders/{a['id']}/move", json={"parent_id": b["id"]})
    assert r.status_code == 200
    proj = client.get(f"/api/projects/{p['id']}").json()
    assert [x["name"] for x in proj["folder_path"]] == ["B", "A", "Sub"]


def test_move_folder_into_itself_or_descendant_rejected(client):
    a = _folder(client, "A")
    child = _folder(client, "C", parent_id=a["id"])
    assert (
        client.post(
            f"/api/folders/{a['id']}/move", json={"parent_id": a["id"]}
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/folders/{a['id']}/move", json={"parent_id": child["id"]}
        ).status_code
        == 400
    )


def test_move_folder_name_clash_at_destination(client):
    a = _folder(client, "A")
    _folder(client, "X", parent_id=a["id"])
    x2 = _folder(client, "x")
    r = client.post(f"/api/folders/{x2['id']}/move", json={"parent_id": a["id"]})
    assert r.status_code == 409


def test_move_project_between_folders_and_root(client):
    a = _folder(client, "A")
    p = _project(client, "P")
    r = client.post(f"/api/projects/{p['id']}/move", json={"folder_id": a["id"]})
    assert r.status_code == 200
    assert r.json()["folder_id"] == a["id"]
    r = client.post(f"/api/projects/{p['id']}/move", json={"folder_id": None})
    assert r.json()["folder_id"] is None


def test_no_moves_between_access_groups(client):
    mine = _folder(client, "Mine")
    theirs = _folder(client, "Theirs", group=OTHER)
    p = _project(client, "P")
    r = client.post(f"/api/projects/{p['id']}/move", json={"folder_id": theirs["id"]})
    assert r.status_code == 403
    assert "between access groups" in r.json()["detail"]
    r = client.post(f"/api/folders/{mine['id']}/move", json={"parent_id": theirs["id"]})
    assert r.status_code == 403
    r = client.post(
        "/api/projects/",
        json={"name": "Q", "meta_group_id": GROUP, "folder_id": theirs["id"]},
    )
    assert r.status_code == 400
    r = client.put(f"/api/projects/{p['id']}", json={"meta_group_id": OTHER})
    assert r.status_code == 403


def test_create_project_in_folder(client):
    f = _folder(client, "F")
    p = _project(client, "In F", folder_id=f["id"])
    assert p["folder_id"] == f["id"]
    assert p["folder_path"] == [{"id": f["id"], "name": "F"}]


# --- Archive / lock -----------------------------------------------------------


def test_archived_folder_locks_contents_and_is_hidden(client):
    top = _folder(client, "Top")
    sub = _folder(client, "Sub", parent_id=top["id"])
    p = _project(client, "Locked", folder_id=sub["id"])
    r = client.post(f"/api/folders/{top['id']}/archive")
    assert r.status_code == 200
    assert r.json()["is_archived"] is True

    # Projects inside are read-only.
    r = client.put(f"/api/projects/{p['id']}", json={"name": "nope"})
    assert r.status_code == 403
    assert "archived folder 'Top'" in r.json()["detail"]
    r = client.post(
        f"/api/projects/{p['id']}/images",
        files={"file": ("a.png", io.BytesIO(_png()), "image/png")},
    )
    assert r.status_code == 403
    r = client.post(f"/api/projects/{p['id']}/parts", json={"serial_number": "S"})
    assert r.status_code == 403

    # Subfolders are locked: no rename, no move.
    assert (
        client.patch(f"/api/folders/{sub['id']}", json={"name": "x"}).status_code == 403
    )
    assert (
        client.patch(f"/api/folders/{top['id']}", json={"name": "x"}).status_code == 403
    )
    assert (
        client.post(
            f"/api/folders/{sub['id']}/move", json={"parent_id": None}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/projects/{p['id']}/move", json={"folder_id": None}
        ).status_code
        == 403
    )
    # Nothing moves in, and the archived folder itself cannot move.
    other = _project(client, "Outside")
    assert (
        client.post(
            f"/api/projects/{other['id']}/move", json={"folder_id": sub["id"]}
        ).status_code
        == 403
    )
    dest = _folder(client, "Dest")
    assert (
        client.post(
            f"/api/folders/{top['id']}/move", json={"parent_id": dest["id"]}
        ).status_code
        == 403
    )
    r = client.post(
        "/api/folders",
        json={"name": "n", "meta_group_id": GROUP, "parent_id": sub["id"]},
    )
    assert r.status_code == 403
    r = client.post(
        "/api/projects/",
        json={"name": "n", "meta_group_id": GROUP, "folder_id": sub["id"]},
    )
    assert r.status_code == 403

    # Hidden by default, visible with Show archived.
    assert top["id"] not in _tree(client)
    tree = _tree(client, include_archived=True)
    assert tree[sub["id"]]["effective_archived"] is True
    assert tree[sub["id"]]["locked_by_folder_id"] == top["id"]
    ids = [x["id"] for x in client.get("/api/projects/").json()]
    assert p["id"] not in ids
    ids = [x["id"] for x in client.get("/api/projects/?include_archived=true").json()]
    assert p["id"] in ids
    proj = client.get(f"/api/projects/{p['id']}").json()
    assert proj["effective_archived"] is True
    assert proj["locked_by_folder_id"] == top["id"]


def test_unarchive_restores_prior_state(client):
    top = _folder(client, "Top")
    own = _folder(client, "AlreadyArchived", parent_id=top["id"])
    free = _folder(client, "Free", parent_id=top["id"])
    p_own = _project(client, "OwnArchived", folder_id=free["id"])
    client.patch(f"/api/projects/{p_own['id']}/archive")
    client.post(f"/api/folders/{own['id']}/archive")

    client.post(f"/api/folders/{top['id']}/archive")
    # Children cannot be unarchived while the parent is archived.
    r = client.post(f"/api/folders/{own['id']}/unarchive")
    assert r.status_code == 403
    r = client.patch(f"/api/projects/{p_own['id']}/unarchive")
    assert r.status_code == 403

    client.post(f"/api/folders/{top['id']}/unarchive")
    tree = _tree(client, include_archived=True)
    assert tree[own["id"]]["is_archived"] is True
    assert tree[own["id"]]["effective_archived"] is True
    assert tree[free["id"]]["effective_archived"] is False
    assert client.get(f"/api/projects/{p_own['id']}").json()["is_archived"] is True
    # The free subfolder is writable again.
    assert (
        client.patch(f"/api/folders/{free['id']}", json={"name": "Free2"}).status_code
        == 200
    )


def test_archived_project_cannot_be_moved(client):
    f = _folder(client, "F")
    p = _project(client, "P")
    client.patch(f"/api/projects/{p['id']}/archive")
    r = client.post(f"/api/projects/{p['id']}/move", json={"folder_id": f["id"]})
    assert r.status_code == 403


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/projects/{pid}/batches", {"name": "B"}),
        ("POST", "/api/projects/{pid}/parts", {"serial_number": "S"}),
        ("DELETE", "/api/projects/{pid}/parts", None),
        ("POST", "/api/projects/{pid}/ingest", {"parts": []}),
        ("POST", "/api/projects/{pid}/load-test-data", None),
        (
            "POST",
            "/api/projects/{pid}/configuration/interface-layout/default",
            {"layout_model": {}},
        ),
        (
            "POST",
            "/api/projects/{pid}/analyze/workflows/execute",
            {"name": "w", "nodes": [], "edges": []},
        ),
        (
            "POST",
            "/api/projects/{pid}/analyze/workflows/start",
            {"name": "w", "nodes": [], "edges": []},
        ),
    ],
)
def test_previous_archive_bypasses_are_closed(client, method, path, body):
    p = _project(client, "Arch")
    client.patch(f"/api/projects/{p['id']}/archive")
    r = client.request(method, path.format(pid=p["id"]), json=body)
    assert r.status_code == 403, (path, r.status_code, r.text)


def test_workspace_state_still_saves_for_archived_projects(client):
    """Per-user UI state is not project data; archived projects stay usable."""
    p = _project(client, "Arch")
    client.patch(f"/api/projects/{p['id']}/archive")
    r = client.put(f"/api/projects/{p['id']}/workspace-state", json={"state": {"x": 1}})
    assert r.status_code == 200, r.text


def test_ml_analysis_creation_refused_on_archived_project(client):
    p = _project(client, "Arch")
    img = client.post(
        f"/api/projects/{p['id']}/images",
        files={"file": ("a.png", io.BytesIO(_png()), "image/png")},
    ).json()
    client.patch(f"/api/projects/{p['id']}/archive")
    r = client.post(
        f"/api/images/{img['id']}/analyses",
        json={"model_name": "mm", "model_version": "1", "image_id": img["id"]},
    )
    assert r.status_code == 403


def test_mcp_write_tools_refuse_locked_projects(client, monkeypatch):
    import asyncio
    import importlib
    import sys

    sys.modules.pop("mcp_server", None)
    monkeypatch.setattr(settings, "VISTA_MCP_API_KEY", "dashboard-test-key")
    mcp_server = importlib.import_module("mcp_server")

    f = _folder(client, "F")
    p = _project(client, "P", folder_id=f["id"])
    client.post(f"/api/folders/{f['id']}/archive")

    from tests.conftest import TestingSessionLocal

    @asynccontext
    async def session():
        async with TestingSessionLocal() as s:
            yield s

    with patch.object(mcp_server, "get_session", session):
        tool = getattr(
            mcp_server.add_project_metadata, "fn", mcp_server.add_project_metadata
        )
        result = asyncio.run(tool("test@example.com", p["id"], "k", "v"))
        summary_tool = getattr(mcp_server.get_project, "fn", mcp_server.get_project)
        summary = asyncio.run(summary_tool("test@example.com", p["id"]))
    sys.modules.pop("mcp_server", None)
    assert "archived folder" in result.get("error", "")
    assert summary["folder_id"] == f["id"]
    assert summary["folder_path"] == [{"id": f["id"], "name": "F"}]
    assert summary["effective_archived"] is True


def asynccontext(fn):
    from contextlib import asynccontextmanager

    return asynccontextmanager(fn)


# --- Delete -------------------------------------------------------------------


def test_folder_delete_preview_and_confirmation(client):
    top = _folder(client, "Top")
    sub = _folder(client, "Sub", parent_id=top["id"])
    p1 = _project(client, "P1", folder_id=top["id"])
    p2 = _project(client, "P2", folder_id=sub["id"])
    client.post(
        f"/api/projects/{p2['id']}/images",
        files={"file": ("a.png", io.BytesIO(_png()), "image/png")},
    )
    keep = _project(client, "Keep")

    prev = client.get(f"/api/folders/{top['id']}/delete-preview").json()
    assert prev == {
        "folder_id": top["id"],
        "name": "Top",
        "folders": 2,
        "projects": 2,
        "images": 1,
        "confirmation_phrase": "DELETE Top",
    }
    r = client.request(
        "DELETE",
        f"/api/folders/{top['id']}",
        json={"confirmation_phrase": "delete top"},
    )
    assert r.status_code == 400
    r = client.request(
        "DELETE",
        f"/api/folders/{top['id']}",
        json={"confirmation_phrase": "DELETE Top"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["projects_deleted"] == 2
    assert client.get(f"/api/projects/{p1['id']}").status_code == 404
    assert client.get(f"/api/projects/{p2['id']}").status_code == 404
    assert client.get(f"/api/folders/{sub['id']}").status_code == 404
    assert client.get(f"/api/projects/{keep['id']}").status_code == 200


def test_empty_and_archived_folders_can_be_deleted(client):
    f = _folder(client, "Empty")
    client.post(f"/api/folders/{f['id']}/archive")
    r = client.request(
        "DELETE",
        f"/api/folders/{f['id']}",
        json={"confirmation_phrase": "DELETE Empty"},
    )
    assert r.status_code == 200


# --- Bulk ---------------------------------------------------------------------


def test_bulk_move_is_all_or_nothing(client):
    dest = _folder(client, "Dest")
    a = _project(client, "A")
    b = _project(client, "B")
    arch = _project(client, "Arch")
    client.patch(f"/api/projects/{arch['id']}/archive")
    r = client.post(
        "/api/dashboard/bulk/move",
        json={
            "target_folder_id": dest["id"],
            "items": [
                {"type": "project", "id": a["id"]},
                {"type": "project", "id": arch["id"]},
            ],
        },
    )
    body = r.json()
    assert body["ok"] is False
    assert client.get(f"/api/projects/{a['id']}").json()["folder_id"] is None

    r = client.post(
        "/api/dashboard/bulk/move",
        json={
            "target_folder_id": dest["id"],
            "items": [
                {"type": "project", "id": a["id"]},
                {"type": "project", "id": b["id"]},
            ],
        },
    )
    body = r.json()
    assert body["ok"] is True
    assert all(x["previous_folder_id"] is None for x in body["results"])
    assert client.get(f"/api/projects/{b['id']}").json()["folder_id"] == dest["id"]


def test_bulk_move_rejects_cycle_via_earlier_item(client):
    a = _folder(client, "A")
    b = _folder(client, "B")
    # Move B under A, then A under B in the same request: second must fail.
    r = client.post(f"/api/folders/{b['id']}/move", json={"parent_id": a["id"]})
    assert r.status_code == 200
    r = client.post(
        "/api/dashboard/bulk/move",
        json={
            "target_folder_id": b["id"],
            "items": [{"type": "folder", "id": a["id"]}],
        },
    )
    assert r.json()["ok"] is False


def test_bulk_archive(client):
    f = _folder(client, "F")
    p = _project(client, "P")
    r = client.post(
        "/api/dashboard/bulk/archive",
        json={
            "archived": True,
            "items": [
                {"type": "folder", "id": f["id"]},
                {"type": "project", "id": p["id"]},
            ],
        },
    )
    assert r.json()["ok"] is True
    assert client.get(f"/api/projects/{p['id']}").json()["is_archived"] is True


# --- Listing / search / sort ----------------------------------------------------


def test_items_lists_children_of_location(client):
    a = _folder(client, "A")
    sub = _folder(client, "Sub", parent_id=a["id"])
    root_p = _project(client, "RootP")
    in_a = _project(client, "InA", folder_id=a["id"])
    _project(client, "InSub", folder_id=sub["id"])

    root = _items(client)
    assert [f["id"] for f in root["folders"]] == [a["id"]]
    assert [p["id"] for p in root["projects"]] == [root_p["id"]]
    assert root["folders"][0]["total_project_count"] == 2
    assert root["folders"][0]["project_count"] == 1

    inside = _items(client, folder_id=a["id"])
    assert [f["id"] for f in inside["folders"]] == [sub["id"]]
    assert [p["id"] for p in inside["projects"]] == [in_a["id"]]


def test_search_spans_subtree_and_returns_paths(client):
    a = _folder(client, "Turbine Blades")
    sub = _folder(client, "Batch 7", parent_id=a["id"])
    _project(client, "blade scan", folder_id=sub["id"])
    _project(client, "Unrelated", description="mentions BLADE in text")
    _project(client, "nothing")

    res = _items(client, q="blade")
    names = sorted(p["name"] for p in res["projects"])
    assert names == ["Unrelated", "blade scan"]
    assert [f["name"] for f in res["folders"]] == ["Turbine Blades"]
    scan = next(p for p in res["projects"] if p["name"] == "blade scan")
    assert [x["name"] for x in scan["folder_path"]] == ["Turbine Blades", "Batch 7"]

    scoped = _items(client, q="blade", folder_id=a["id"])
    assert [p["name"] for p in scoped["projects"]] == ["blade scan"]


def test_search_wildcards_are_literal(client):
    _project(client, "100% done")
    _project(client, "1000 done")
    _project(client, "a_b")
    _project(client, "axb")
    assert [p["name"] for p in _items(client, q="100%")["projects"]] == ["100% done"]
    assert [p["name"] for p in _items(client, q="a_b")["projects"]] == ["a_b"]
    assert _items(client, q="' OR 1=1 --")["projects"] == []


def test_search_includes_archived_only_when_requested(client):
    f = _folder(client, "Arch Folder")
    _project(client, "match one", folder_id=f["id"])
    p2 = _project(client, "match two")
    client.patch(f"/api/projects/{p2['id']}/archive")
    client.post(f"/api/folders/{f['id']}/archive")

    assert _items(client, q="match")["projects"] == []
    assert _items(client, q="arch folder")["folders"] == []
    res = _items(client, q="match", include_archived=True)
    assert sorted(p["name"] for p in res["projects"]) == ["match one", "match two"]
    assert [
        f["name"] for f in _items(client, q="arch", include_archived=True)["folders"]
    ] == ["Arch Folder"]


@pytest.mark.parametrize("sort", ["created", "last_activity", "archived", "name"])
@pytest.mark.parametrize("order", ["asc", "desc"])
def test_sort_orders(client, sort, order):
    made = []
    for name in ["b", "a", "c"]:
        made.append(_project(client, name))
        time.sleep(0.01)
    for p in made:
        client.patch(f"/api/projects/{p['id']}/archive")
        time.sleep(0.01)
    res = _items(client, sort=sort, order=order, include_archived=True)["projects"]
    key = {
        "created": "created_at",
        "last_activity": "last_activity_at",
        "archived": "archived_at",
        "name": "name",
    }[sort]
    values = [p[key] for p in res]
    assert values == sorted(values, reverse=order == "desc")


def test_filters_and_pagination(client):
    for i in range(7):
        _project(client, f"t1-{i}", project_type="PT1")
    for i in range(3):
        _project(client, f"t2-{i}", project_type="PT2")
    res = _items(client, project_type="pt2")
    assert res["total_projects"] == 3
    page = _items(client, limit=4, offset=4)
    assert page["total_projects"] == 10
    assert len(page["projects"]) == 4
    res = _items(client, created_by="TEST@example.com")
    assert res["total_projects"] == 10
    res = _items(client, created_by="nobody@example.com")
    assert res["total_projects"] == 0


def test_items_by_ids_for_pins_and_recents(client):
    a = _project(client, "A")
    _project(client, "B")
    f = _folder(client, "F")
    c = _project(client, "C", folder_id=f["id"])
    res = _items(client, ids=[a["id"], c["id"], str(uuid.uuid4())])
    assert sorted(p["id"] for p in res["projects"]) == sorted([a["id"], c["id"]])
    assert res["folders"] == []


def test_folders_sort_by_last_edited_including_descendants(client):
    old = _folder(client, "Old")
    time.sleep(0.02)
    new = _folder(client, "New")
    time.sleep(0.02)
    sub = _folder(client, "Sub", parent_id=old["id"])
    # Creating Sub bumps Old (something moved into it).
    order = [f["name"] for f in _items(client)["folders"]]
    assert order == ["Old", "New"]
    time.sleep(0.02)
    client.patch(f"/api/folders/{new['id']}", json={"description": "touch"})
    assert [f["name"] for f in _items(client)["folders"]] == ["New", "Old"]
    time.sleep(0.02)
    # A data change in a project deep below Old moves Old back to the top.
    p = _project(client, "deep", folder_id=sub["id"])
    time.sleep(0.02)
    r = client.post(
        f"/api/projects/{p['id']}/classes", json={"name": "c", "project_id": p["id"]}
    )
    assert r.status_code in (200, 201), r.text
    assert [f["name"] for f in _items(client)["folders"]] == ["Old", "New"]


# --- P3: last_activity_at -----------------------------------------------------


def _activity(client, pid):
    return client.get(f"/api/projects/{pid}").json()["last_activity_at"]


def test_last_activity_moves_on_data_changes(client):
    p = _project(client, "Act")
    t0 = _activity(client, p["id"])
    assert t0 is not None
    time.sleep(0.02)
    r = client.post(
        f"/api/projects/{p['id']}/images",
        files={"file": ("a.png", io.BytesIO(_png()), "image/png")},
    )
    assert r.status_code == 201
    t1 = _activity(client, p["id"])
    assert t1 > t0
    time.sleep(0.02)
    image_id = r.json()["id"]
    client.post(f"/api/images/{image_id}/comments", json={"text": "hi"})
    t2 = _activity(client, p["id"])
    assert t2 > t1
    time.sleep(0.02)
    client.post(f"/api/projects/{p['id']}/parts", json={"serial_number": "S1"})
    assert _activity(client, p["id"]) > t2


def test_last_activity_ignores_reads_and_ui_state_and_failures(client):
    p = _project(client, "Quiet")
    t0 = _activity(client, p["id"])
    time.sleep(0.02)
    client.get(f"/api/projects/{p['id']}/images")
    client.get(f"/api/projects/{p['id']}/parts")
    client.put(f"/api/projects/{p['id']}/workspace-state", json={"state": {"a": 1}})
    # A rejected write does not count.
    client.post(f"/api/projects/{p['id']}/classes", json={})
    assert _activity(client, p["id"]) == t0


def test_last_activity_untouched_by_moves_and_project_updated_at_preserved(client):
    f = _folder(client, "F")
    p = _project(client, "P")
    before = client.get(f"/api/projects/{p['id']}").json()
    client.post(f"/api/projects/{p['id']}/move", json={"folder_id": f["id"]})
    after = client.get(f"/api/projects/{p['id']}").json()
    assert after["last_activity_at"] == before["last_activity_at"]


# --- Backup / import round trip -------------------------------------------------


def _dashboard_export(client, **extra):
    import io as _io
    import json as _json
    import zipfile

    r = client.post(
        "/api/dashboard/export",
        json={"include_images": False, "include_overlays": False, **extra},
    )
    assert r.status_code == 200, r.text
    with zipfile.ZipFile(_io.BytesIO(r.content)) as archive:
        folders = _json.loads(archive.read("folders.json"))["folders"]
        manifest = _json.loads(archive.read("manifest.json"))
    return r.content, folders, manifest


def test_dashboard_backup_round_trip_keeps_folder_tree(client):
    top = _folder(client, "Line A", description="top")
    sub = _folder(client, "Week 3", parent_id=top["id"])
    _project(client, "Scan 1", folder_id=sub["id"])
    _project(client, "Loose")

    content, folders, manifest = _dashboard_export(client)
    assert manifest["folder_count"] == 2
    assert [f["name"] for f in folders] == ["Line A", "Week 3"]  # parents first

    preview = client.post(
        "/api/dashboard/import/preview",
        files={"file": ("d.vistabundle", content, "application/zip")},
    )
    assert preview.json()["folder_count"] == 2

    r = client.post(
        "/api/dashboard/import",
        files={"file": ("d.vistabundle", content, "application/zip")},
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["folders_created"] == 2

    roots = {f["name"]: f for f in _items(client)["folders"]}
    # The existing "Line A" clashes, so the restored copy is renamed.
    assert set(roots) == {"Line A", "Line A (Imported)"}
    restored_top = roots["Line A (Imported)"]
    inside = _items(client, folder_id=restored_top["id"])
    assert [f["name"] for f in inside["folders"]] == ["Week 3"]
    restored_sub = inside["folders"][0]
    projects = _items(client, folder_id=restored_sub["id"])["projects"]
    assert [p["name"] for p in projects] == ["Scan 1 (Imported)"]
    loose = [p["name"] for p in _items(client)["projects"]]
    assert sorted(loose) == ["Loose", "Loose (Imported)"]


def test_old_backup_without_folders_imports_at_root(client):
    import io as _io
    import zipfile

    f = _folder(client, "F")
    _project(client, "Old style", folder_id=f["id"])
    content, _folders, _manifest = _dashboard_export(client)
    # Strip folders.json to mimic a backup made before folders existed.
    src = zipfile.ZipFile(_io.BytesIO(content))
    out = _io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for name in src.namelist():
            if name != "folders.json":
                dst.writestr(name, src.read(name))
    r = client.post(
        "/api/dashboard/import",
        files={"file": ("d.vistabundle", out.getvalue(), "application/zip")},
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["folders_created"] == 0
    assert [p["name"] for p in _items(client)["projects"]] == ["Old style (Imported)"]


def test_archived_folder_tree_exported_only_with_include_archived(client):
    f = _folder(client, "Hidden")
    _project(client, "In hidden", folder_id=f["id"])
    client.post(f"/api/folders/{f['id']}/archive")
    _content, folders, manifest = _dashboard_export(client)
    assert folders == [] and manifest["project_count"] == 0
    _content, folders, manifest = _dashboard_export(client, include_archived=True)
    assert [x["name"] for x in folders] == ["Hidden"] and folders[0]["is_archived"]
    assert manifest["project_count"] == 1


def test_root_projects_listed_while_an_archived_folder_exists(client):
    """Regression: NULL folder_id with an archived folder elsewhere must not
    drop root projects (SQL three-valued logic)."""
    f = _folder(client, "Archived elsewhere")
    client.post(f"/api/folders/{f['id']}/archive")
    root = _project(client, "Root survives")
    res = _items(client)
    assert [p["id"] for p in res["projects"]] == [root["id"]]
    assert res["total_projects"] == 1
    res = _items(client, include_archived=True, archived="active")
    assert [p["id"] for p in res["projects"]] == [root["id"]]
    res = _items(client, include_archived=True, archived="archived")
    assert res["projects"] == []


def test_workflow_validate_is_read_only_and_allowed_on_archived(client):
    """Validate writes nothing, so read-only (archived) projects keep it."""
    p = _project(client, "Arch")
    client.patch(f"/api/projects/{p['id']}/archive")
    r = client.post(
        f"/api/projects/{p['id']}/analyze/workflows/validate",
        json={"name": "w", "nodes": [], "edges": []},
    )
    assert r.status_code != 403, r.text


def test_activity_marks_cleared_after_commit(client):
    """A later commit in the same session must not bump an earlier project."""
    import asyncio

    from core import activity
    from tests.conftest import TestingSessionLocal

    p = _project(client, "Once")
    before = client.get(f"/api/projects/{p['id']}").json()["last_activity_at"]

    async def run():
        async with TestingSessionLocal() as s:
            await s.execute(__import__("sqlalchemy").text("SELECT 1"))
            activity.mark_project_activity(s, uuid.UUID(p["id"]))
            await s.rollback()
            assert activity.pending_project_activity(s) == set()
            await s.commit()

    asyncio.run(run())
    assert client.get(f"/api/projects/{p['id']}").json()["last_activity_at"] == before


def test_items_return_current_folder_lock_state_even_when_hidden(client):
    top = _folder(client, "Top")
    sub = _folder(client, "Sub", parent_id=top["id"])
    client.post(f"/api/folders/{top['id']}/archive")
    res = _items(client, folder_id=sub["id"])
    assert res["current_folder"]["id"] == sub["id"]
    assert res["current_folder"]["effective_archived"] is True
    assert [p["name"] for p in res["current_folder"]["path"]] == ["Top", "Sub"]


def test_type_and_creator_filters_keep_folders_visible_and_filter_inside(client):
    """Filters narrow projects only; folders stay so they can be opened, and
    the projects inside them are filtered too."""
    f = _folder(client, "Line")
    _project(client, "pt1 inside", folder_id=f["id"], project_type="PT1")
    _project(client, "pt2 inside", folder_id=f["id"], project_type="PT2")
    _project(client, "pt1 root", project_type="PT1")
    root = _items(client, project_type="PT2")
    assert [x["name"] for x in root["folders"]] == ["Line"]
    assert root["projects"] == []
    inside = _items(client, folder_id=f["id"], project_type="PT2")
    assert [p["name"] for p in inside["projects"]] == ["pt2 inside"]
    root = _items(client, created_by="nobody@example.com")
    assert [x["name"] for x in root["folders"]] == ["Line"]
    assert root["projects"] == []
