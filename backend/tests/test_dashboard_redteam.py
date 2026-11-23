"""Red-team tests for dashboard folders.

Every test asserts the intended secure/correct behavior. A failure means a bug
(or a debatable behavior noted in the test docstring).
"""

from __future__ import annotations

import io
import json
import time
import uuid
import zipfile

import pytest

from core.locks import MAX_FOLDER_DEPTH
from tests.test_dashboard_folders import (
    GROUP,
    OTHER,
    _folder,
    _items,
    _members_of,
    _png,
    _project,
    _tree,
)

# --- helpers -----------------------------------------------------------------


def _move_folder(client, fid, parent_id):
    return client.post(f"/api/folders/{fid}/move", json={"parent_id": parent_id})


def _move_project(client, pid, folder_id):
    return client.post(f"/api/projects/{pid}/move", json={"folder_id": folder_id})


def _bulk_move(client, items, target):
    return client.post(
        "/api/dashboard/bulk/move",
        json={"target_folder_id": target, "items": items},
    )


def _bulk_archive(client, items, archived=True):
    return client.post(
        "/api/dashboard/bulk/archive", json={"archived": archived, "items": items}
    )


def _f(x):
    return {"type": "folder", "id": x["id"]}


def _p(x):
    return {"type": "project", "id": x["id"]}


def _upload(client, pid):
    return client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("a.png", io.BytesIO(_png()), "image/png")},
    )


def _chain(client, n, prefix="L", parent=None):
    out = []
    for i in range(n):
        parent = _folder(client, f"{prefix}{i}", parent_id=parent["id"] if parent else None)
        out.append(parent)
    return out


def _activity(client, pid):
    return client.get(f"/api/projects/{pid}").json()["last_activity_at"]


def _delete(client, fid, phrase, headers=None):
    return client.request(
        "DELETE",
        f"/api/folders/{fid}",
        json={"confirmation_phrase": phrase},
        headers=headers or {},
    )


# --- 1. Cycles / self moves / bad parents ------------------------------------


def test_move_folder_to_itself_rejected(client):
    a = _folder(client, "A")
    r = _move_folder(client, a["id"], a["id"])
    assert r.status_code == 400
    assert client.get(f"/api/folders/{a['id']}").json()["parent_id"] is None


def test_two_step_cycle_rejected(client):
    a = _folder(client, "A")
    b = _folder(client, "B")
    assert _move_folder(client, a["id"], b["id"]).status_code == 200
    r = _move_folder(client, b["id"], a["id"])
    assert r.status_code == 400
    assert client.get(f"/api/folders/{b['id']}").json()["parent_id"] is None


def test_bulk_move_item_into_itself_rejected(client):
    a = _folder(client, "A")
    r = _bulk_move(client, [_f(a)], a["id"])
    assert r.json()["ok"] is False
    assert client.get(f"/api/folders/{a['id']}").json()["parent_id"] is None


def test_bulk_move_target_and_its_ancestor_in_same_request(client):
    """Moving [Top, Child] into Child: Top -> Child would be a cycle."""
    top = _folder(client, "Top")
    child = _folder(client, "Child", parent_id=top["id"])
    r = _bulk_move(client, [_f(child), _f(top)], child["id"])
    assert r.json()["ok"] is False
    tree = _tree(client)
    assert tree[top["id"]]["parent_id"] is None
    assert tree[child["id"]]["parent_id"] == top["id"]


def test_move_folder_parent_random_uuid_404(client):
    a = _folder(client, "A")
    r = _move_folder(client, a["id"], str(uuid.uuid4()))
    assert r.status_code == 404
    assert client.get(f"/api/folders/{a['id']}").json()["parent_id"] is None


def test_create_folder_with_random_parent_404(client):
    r = client.post(
        "/api/folders",
        json={"name": "x", "meta_group_id": GROUP, "parent_id": str(uuid.uuid4())},
    )
    assert r.status_code == 404


def test_create_folder_parent_in_other_group_rejected(client):
    theirs = _folder(client, "Theirs", group=OTHER)
    r = client.post(
        "/api/folders",
        json={"name": "x", "meta_group_id": GROUP, "parent_id": theirs["id"]},
    )
    assert r.status_code in (403, 404)
    assert _tree(client) == {}


def test_create_folder_parent_in_invisible_group_is_404_not_403(client):
    """Folder IDs of groups the caller is not in must look missing."""
    with _members_of(GROUP, "secret"):
        theirs = _folder(client, "Theirs", group="secret")
    with _members_of(GROUP):
        r = client.post(
            "/api/folders",
            json={"name": "x", "meta_group_id": GROUP, "parent_id": theirs["id"]},
        )
        assert r.status_code == 404


# --- 2. Depth ------------------------------------------------------------------


def test_move_deep_subtree_under_deep_chain_exceeds_depth(client):
    left = _chain(client, 20, "A")
    right = _chain(client, 20, "B")
    r = _move_folder(client, right[0]["id"], left[-1]["id"])
    assert r.status_code == 400
    assert client.get(f"/api/folders/{right[0]['id']}").json()["parent_id"] is None


def test_move_to_exact_depth_limit_allowed(client):
    left = _chain(client, 16, "A")
    right = _chain(client, 16, "B")
    r = _move_folder(client, right[0]["id"], left[-1]["id"])
    assert r.status_code == 200, r.text
    deepest = client.get(f"/api/folders/{right[-1]['id']}").json()
    assert len(deepest["path"]) == MAX_FOLDER_DEPTH


def test_bulk_move_two_subtrees_combined_depth(client):
    """Each moved subtree individually fits, but bulk moving both under one
    target is fine as siblings; must stay <= 32."""
    target = _chain(client, 30, "T")[-1]
    s1 = _chain(client, 2, "S")
    s2 = _chain(client, 3, "U")
    r = _bulk_move(client, [_f(s1[0]), _f(s2[0])], target["id"])
    assert r.json()["ok"] is False
    assert client.get(f"/api/folders/{s1[0]['id']}").json()["parent_id"] is None


# --- 3. Names --------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["Résumé", "🚀 Launch", "مرحبا", "日本語フォルダ", "a" * 255],
)
def test_folder_name_accepts_unicode_and_255(client, name):
    f = _folder(client, name)
    assert f["name"] == name


def test_folder_name_256_rejected(client):
    r = client.post("/api/folders", json={"name": "a" * 256, "meta_group_id": GROUP})
    assert r.status_code == 422


def test_folder_name_255_after_trim_accepted(client):
    r = client.post(
        "/api/folders", json={"name": "  " + "b" * 255 + "  ", "meta_group_id": GROUP}
    )
    assert r.status_code == 201, r.text


@pytest.mark.parametrize(
    "name",
    ["\u200b", "\u200b\u200c\u200d", "\ufeff", "\u202e", "\x00\x01", "\u00a0", "\u3000", "\u2028"],
)
def test_folder_name_invisible_only_rejected(client, name):
    r = client.post("/api/folders", json={"name": name, "meta_group_id": GROUP})
    assert r.status_code == 422, (repr(name), r.status_code, r.text)


def test_folder_name_control_chars_stripped(client):
    f = _folder(client, "Line\nTwo\tTab\x07")
    assert "\n" not in f["name"] and "\t" not in f["name"] and "\x07" not in f["name"]


def test_folder_name_zero_width_does_not_evade_uniqueness(client):
    """'Alpha' and 'Al\u200bpha' render identically; should clash."""
    _folder(client, "Alpha")
    r = client.post("/api/folders", json={"name": "Al\u200bpha", "meta_group_id": GROUP})
    assert r.status_code == 409, r.text


def test_folder_name_internal_whitespace_variants(client):
    """Debatable: 'My  Folder' vs 'My Folder' are allowed as distinct names."""
    _folder(client, "My Folder")
    r = client.post("/api/folders", json={"name": "My  Folder", "meta_group_id": GROUP})
    assert r.status_code == 409


def test_folder_name_casefold_sharp_s(client):
    _folder(client, "Straße")
    r = client.post("/api/folders", json={"name": "STRASSE", "meta_group_id": GROUP})
    assert r.status_code == 409


def test_folder_name_nfc_vs_nfd_clash(client):
    """'é' precomposed vs 'e' + combining acute look identical."""
    _folder(client, "Caf\u00e9")
    r = client.post("/api/folders", json={"name": "Cafe\u0301", "meta_group_id": GROUP})
    assert r.status_code == 409


def test_rename_to_sibling_name_409(client):
    _folder(client, "One")
    two = _folder(client, "Two")
    r = client.patch(f"/api/folders/{two['id']}", json={"name": " one "})
    assert r.status_code == 409
    assert client.get(f"/api/folders/{two['id']}").json()["name"] == "Two"


def test_rename_case_only_of_self_allowed(client):
    f = _folder(client, "Case")
    r = client.patch(f"/api/folders/{f['id']}", json={"name": "CASE"})
    assert r.status_code == 200
    assert r.json()["name"] == "CASE"


def test_update_only_description_keeps_name(client):
    f = _folder(client, "Keep", description="old")
    r = client.patch(f"/api/folders/{f['id']}", json={"description": "new"})
    assert r.status_code == 200
    assert r.json()["name"] == "Keep" and r.json()["description"] == "new"


def test_patch_name_null_rejected(client):
    f = _folder(client, "Keep")
    r = client.patch(f"/api/folders/{f['id']}", json={"name": None})
    assert r.status_code in (400, 422)
    assert client.get(f"/api/folders/{f['id']}").json()["name"] == "Keep"


def test_description_too_long_rejected(client):
    r = client.post(
        "/api/folders",
        json={"name": "d", "meta_group_id": GROUP, "description": "x" * 4001},
    )
    assert r.status_code == 422


def test_name_as_non_string_rejected(client):
    for bad in [123, ["a"], {"a": 1}, True]:
        r = client.post("/api/folders", json={"name": bad, "meta_group_id": GROUP})
        assert r.status_code == 422, (bad, r.status_code)


# --- 4. Delete ------------------------------------------------------------------


@pytest.mark.parametrize(
    "phrase",
    [
        "DELETE Top ",
        " DELETE Top",
        "delete Top",
        "DELETE top",
        "DELETE  Top",
        "DELETE\u00a0Top",
        "DЕLETE Top",  # Cyrillic Е
        "DELETE Тop",  # Cyrillic Т
        "DELETE Top\n",
        "DELETE",
    ],
)
def test_delete_phrase_must_be_exact(client, phrase):
    top = _folder(client, "Top")
    p = _project(client, "P", folder_id=top["id"])
    r = _delete(client, top["id"], phrase)
    assert r.status_code == 400, (repr(phrase), r.status_code)
    assert client.get(f"/api/folders/{top['id']}").status_code == 200
    assert client.get(f"/api/projects/{p['id']}").status_code == 200


def test_delete_with_api_key_refused(client):
    top = _folder(client, "Top")
    r = client.post("/api/api-keys", json={"name": "k"})
    assert r.status_code == 201
    key = r.json()["key"]
    r = _delete(client, top["id"], "DELETE Top", headers={"Authorization": f"Bearer {key}"})
    assert r.status_code in (401, 403)
    assert client.get(f"/api/folders/{top['id']}").status_code == 200


def test_delete_with_bogus_bearer_refused(client):
    top = _folder(client, "Top")
    r = _delete(client, top["id"], "DELETE Top", headers={"Authorization": "Bearer xyz"})
    assert r.status_code in (401, 403)
    assert client.get(f"/api/folders/{top['id']}").status_code == 200


def test_delete_other_group_folder_404(client):
    with _members_of(GROUP, "secret"):
        theirs = _folder(client, "Theirs", group="secret")
    with _members_of(GROUP):
        assert _delete(client, theirs["id"], "DELETE Theirs").status_code == 404
        assert client.get(f"/api/folders/{theirs['id']}/delete-preview").status_code == 404
    assert client.get(f"/api/folders/{theirs['id']}").status_code == 200


def test_delete_deep_tree_removes_everything(client):
    chain = _chain(client, 10, "D")
    projects = [_project(client, f"p{i}", folder_id=f["id"]) for i, f in enumerate(chain)]
    sibling = _folder(client, "Sibling", parent_id=chain[0]["id"])
    _project(client, "sp", folder_id=sibling["id"])
    r = _delete(client, chain[0]["id"], "DELETE D0")
    assert r.status_code == 200, r.text
    assert r.json()["folders_deleted"] == 11
    assert r.json()["projects_deleted"] == 11
    for p in projects:
        assert client.get(f"/api/projects/{p['id']}").status_code == 404
    assert _tree(client, include_archived=True) == {}


def test_delete_preview_counts_soft_deleted_images(client):
    """Report-only: preview images count vs. soft-deleted images."""
    f = _folder(client, "F")
    p = _project(client, "P", folder_id=f["id"])
    img = _upload(client, p["id"]).json()
    _upload(client, p["id"])
    r = client.request(
        "DELETE",
        f"/api/projects/{p['id']}/images/{img['id']}",
        json={"reason": "cleanup reason"},
    )
    assert r.status_code == 200, r.text
    prev = client.get(f"/api/folders/{f['id']}/delete-preview").json()
    # Soft-deleted image rows are still deleted with the project, so counting
    # them (2) is accurate for "what will be destroyed".
    assert prev["images"] == 2


def test_delete_folder_with_archived_child_and_locked_projects(client):
    top = _folder(client, "Top")
    sub = _folder(client, "Sub", parent_id=top["id"])
    p = _project(client, "P", folder_id=sub["id"])
    client.patch(f"/api/projects/{p['id']}/archive")
    client.post(f"/api/folders/{sub['id']}/archive")
    client.post(f"/api/folders/{top['id']}/archive")
    r = _delete(client, top["id"], "DELETE Top")
    assert r.status_code == 200
    assert client.get(f"/api/projects/{p['id']}").status_code == 404


def test_delete_subfolder_inside_archived_parent_refused(client):
    """Archived parent => contents are locked, so a child (and its projects)
    must not be deletable on their own."""
    top = _folder(client, "Top")
    sub = _folder(client, "Sub", parent_id=top["id"])
    p = _project(client, "P", folder_id=sub["id"])
    client.post(f"/api/folders/{top['id']}/archive")
    r = _delete(client, sub["id"], "DELETE Sub")
    assert r.status_code == 403, r.text
    assert client.get(f"/api/projects/{p['id']}").status_code == 200


def test_delete_project_inside_archived_folder_refused(client):
    f = _folder(client, "F")
    p = _project(client, "P", folder_id=f["id"])
    client.post(f"/api/folders/{f['id']}/archive")
    r = client.request(
        "DELETE", f"/api/projects/{p['id']}", json={"confirmation_phrase": "DELETE P"}
    )
    assert r.status_code == 403, r.text
    assert client.get(f"/api/projects/{p['id']}").status_code == 200


# --- 5. Cross-group --------------------------------------------------------------


@pytest.fixture
def foreign(client):
    """A folder tree and projects in 'secret', which the caller cannot see."""
    with _members_of(GROUP, "secret"):
        top = _folder(client, "SecretTop", group="secret")
        sub = _folder(client, "SecretSub", group="secret", parent_id=top["id"])
        proj = _project(client, "SecretProj", group="secret", folder_id=sub["id"])
        root_proj = _project(client, "SecretRoot", group="secret")
    return {"top": top, "sub": sub, "proj": proj, "root_proj": root_proj}


def test_cross_group_folder_endpoints_all_404(client, foreign):
    mine = _folder(client, "Mine")
    fid = foreign["top"]["id"]
    with _members_of(GROUP):
        calls = [
            client.get(f"/api/folders/{fid}"),
            client.patch(f"/api/folders/{fid}", json={"name": "pwn"}),
            client.patch(f"/api/folders/{fid}", json={"description": "pwn"}),
            client.post(f"/api/folders/{fid}/move", json={"parent_id": None}),
            client.post(f"/api/folders/{fid}/move", json={"parent_id": mine["id"]}),
            client.post(f"/api/folders/{fid}/archive"),
            client.post(f"/api/folders/{fid}/unarchive"),
            client.get(f"/api/folders/{fid}/delete-preview"),
            _delete(client, fid, "DELETE SecretTop"),
        ]
        assert [r.status_code for r in calls] == [404] * len(calls), [
            (r.request.method, r.request.url.path, r.status_code) for r in calls
        ]
        # Moving my folder into theirs: 404 (do not leak existence).
        r = client.post(
            f"/api/folders/{mine['id']}/move", json={"parent_id": foreign["sub"]["id"]}
        )
        assert r.status_code == 404
    tree = _tree(client, group="secret")
    assert tree[fid]["name"] == "SecretTop" and not tree[fid]["is_archived"]


def test_cross_group_project_move_into_my_folder_refused(client, foreign):
    mine = _folder(client, "Mine")
    with _members_of(GROUP):
        r = _move_project(client, foreign["proj"]["id"], mine["id"])
        assert r.status_code in (403, 404)
        r = _move_project(client, foreign["proj"]["id"], None)
        assert r.status_code in (403, 404)
    p = client.get(f"/api/projects/{foreign['proj']['id']}").json()
    assert p["folder_id"] == foreign["sub"]["id"]


def test_cross_group_my_project_into_their_folder_404(client, foreign):
    p = _project(client, "Mine")
    with _members_of(GROUP):
        r = _move_project(client, p["id"], foreign["sub"]["id"])
        assert r.status_code == 404


def test_cross_group_create_project_in_their_folder(client, foreign):
    with _members_of(GROUP):
        r = client.post(
            "/api/projects/",
            json={"name": "x", "meta_group_id": GROUP, "folder_id": foreign["sub"]["id"]},
        )
        assert r.status_code in (400, 404)
        # Pretending to be in their group is refused.
        r = client.post(
            "/api/projects/",
            json={"name": "x", "meta_group_id": "secret", "folder_id": foreign["sub"]["id"]},
        )
        assert r.status_code == 403


def test_cross_group_bulk_move_mixed_is_all_or_nothing(client, foreign):
    mine = _project(client, "Mine")
    dest = _folder(client, "Dest")
    with _members_of(GROUP):
        r = _bulk_move(client, [_p(mine), _p(foreign["root_proj"]), _f(foreign["top"])], dest["id"])
        body = r.json()
        assert body["ok"] is False
        # Detail must not reveal the foreign names.
        assert "Secret" not in json.dumps(body)
    assert client.get(f"/api/projects/{mine['id']}").json()["folder_id"] is None
    assert client.get(f"/api/projects/{foreign['root_proj']['id']}").json()["folder_id"] is None


def test_cross_group_bulk_move_target_in_other_group(client, foreign):
    mine = _project(client, "Mine")
    with _members_of(GROUP):
        r = _bulk_move(client, [_p(mine)], foreign["sub"]["id"])
        assert r.json()["ok"] is False
    assert client.get(f"/api/projects/{mine['id']}").json()["folder_id"] is None


def test_cross_group_bulk_archive_refused(client, foreign):
    mine = _project(client, "Mine")
    with _members_of(GROUP):
        r = _bulk_archive(client, [_p(mine), _p(foreign["root_proj"]), _f(foreign["top"])])
        assert r.json()["ok"] is False
    assert client.get(f"/api/projects/{mine['id']}").json()["is_archived"] is False
    assert client.get(f"/api/projects/{foreign['root_proj']['id']}").json()["is_archived"] is False
    assert _tree(client, group="secret")[foreign["top"]["id"]]["is_archived"] is False


def test_cross_group_items_ids_do_not_leak(client, foreign):
    mine = _project(client, "Mine")
    with _members_of(GROUP):
        res = _items(client, ids=[mine["id"], foreign["proj"]["id"], foreign["root_proj"]["id"]])
        assert [p["id"] for p in res["projects"]] == [mine["id"]]
        # Their group via my group's listing with their folder id: 404
        r = client.get(
            "/api/dashboard/items",
            params={"meta_group_id": GROUP, "folder_id": foreign["top"]["id"]},
        )
        assert r.status_code == 404
        r = client.get(
            "/api/dashboard/items",
            params={"meta_group_id": "secret", "q": "Secret"},
        )
        assert r.status_code == 403
        r = client.get("/api/folders/tree", params={"meta_group_id": "secret"})
        assert r.status_code == 403
        r = client.get("/api/folders/tree", params={"meta_group_id": " secret "})
        assert r.status_code == 403


def test_cross_group_search_from_my_group_does_not_find_theirs(client, foreign):
    with _members_of(GROUP):
        res = _items(client, q="Secret", include_archived=True)
        assert res["projects"] == [] and res["folders"] == []


def test_cross_group_project_list_hides_theirs(client, foreign):
    _project(client, "Mine")
    with _members_of(GROUP):
        r = client.get("/api/projects/", params={"include_archived": True})
        assert [p["name"] for p in r.json()] == ["Mine"]
        assert r.headers["X-Total-Count"] == "1"


def test_cross_group_put_meta_group_id_refused(client):
    p = _project(client, "P")
    r = client.put(f"/api/projects/{p['id']}", json={"meta_group_id": OTHER})
    assert r.status_code == 403
    # Trailing whitespace is normalized away: it is the same group (no-op).
    r = client.put(f"/api/projects/{p['id']}", json={"meta_group_id": GROUP + " "})
    assert r.status_code in (200, 403, 422)
    r = client.put(f"/api/projects/{p['id']}", json={"meta_group_id": GROUP.upper()})
    assert r.status_code in (403, 422)
    assert client.get(f"/api/projects/{p['id']}").json()["meta_group_id"] == GROUP


def test_cross_group_put_meta_group_id_null_does_not_wipe_group(client):
    p = _project(client, "P")
    r = client.put(f"/api/projects/{p['id']}", json={"meta_group_id": None})
    assert r.status_code in (200, 403, 422)
    got = client.get(f"/api/projects/{p['id']}")
    assert got.status_code == 200 and got.json()["meta_group_id"] == GROUP


def test_put_name_null_does_not_500(client):
    p = _project(client, "P")
    r = client.put(f"/api/projects/{p['id']}", json={"name": None})
    assert r.status_code in (200, 422)
    assert client.get(f"/api/projects/{p['id']}").json()["name"] == "P"


def test_put_folder_id_cannot_bypass_move_rules(client):
    """ProjectUpdate has no folder_id; sending it must not move the project."""
    locked = _folder(client, "Locked")
    client.post(f"/api/folders/{locked['id']}/archive")
    p = _project(client, "P")
    client.put(f"/api/projects/{p['id']}", json={"folder_id": locked["id"], "name": "P2"})
    assert client.get(f"/api/projects/{p['id']}").json()["folder_id"] is None


def test_cross_group_backup_import_cannot_plant_folder_in_other_group(client):
    """A crafted dashboard backup whose project references a folder in a
    group the importer cannot access must not place it there."""
    with _members_of(GROUP, "secret"):
        _folder(client, "SecretTop", group="secret")
    pid = str(uuid.uuid4())
    fid = str(uuid.uuid4())
    manifest = {"format": "vista-dashboard-backup", "version": 1, "projects": [{"id": pid}]}
    folders = {"folders": [{"id": fid, "parent_id": None, "meta_group_id": "secret", "name": "Planted"}]}
    payload = {"project": {"id": pid, "name": "Imp", "meta_group_id": GROUP, "folder_id": fid}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("folders.json", json.dumps(folders))
        z.writestr(f"projects/{pid}/project-backup.json", json.dumps(payload))
    from unittest.mock import patch

    with _members_of(GROUP), patch(
        "routers.export.is_user_in_group", side_effect=lambda _e, g, _u=None: g == GROUP
    ):
        r = client.post(
            "/api/dashboard/import",
            files={"file": ("d.vistabundle", buf.getvalue(), "application/zip")},
            data={"mode": "restore_as_new", "confirmation": "IMPORT"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["folders_created"] == 0
    assert "Planted" not in {f["name"] for f in _tree(client, group="secret").values()}


def test_backup_import_project_folder_in_other_group_is_not_mixed(client):
    """Backup with a folder in group OTHER and a project in GROUP pointing at
    it: the project must not end up in a folder of a different group."""
    pid = str(uuid.uuid4())
    fid = str(uuid.uuid4())
    manifest = {"format": "vista-dashboard-backup", "version": 1, "projects": [{"id": pid}]}
    folders = {"folders": [{"id": fid, "parent_id": None, "meta_group_id": OTHER, "name": "OtherF"}]}
    payload = {"project": {"id": pid, "name": "Imp", "meta_group_id": GROUP, "folder_id": fid}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("folders.json", json.dumps(folders))
        z.writestr(f"projects/{pid}/project-backup.json", json.dumps(payload))
    r = client.post(
        "/api/dashboard/import",
        files={"file": ("d.vistabundle", buf.getvalue(), "application/zip")},
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
    )
    assert r.status_code == 200, r.text
    new_id = r.json()["projects_created"][0]["new_project_id"]
    proj = client.get(f"/api/projects/{new_id}").json()
    if proj["folder_id"] is not None:
        folder = client.get(f"/api/folders/{proj['folder_id']}").json()
        assert folder["meta_group_id"] == proj["meta_group_id"]


# --- 6. Lock bypasses ----------------------------------------------------------------


@pytest.fixture
def locked_world(client):
    """Project with an image, class, group and part inside Top/Mid/Leaf; Top archived."""
    top = _folder(client, "Top")
    mid = _folder(client, "Mid", parent_id=top["id"])
    leaf = _folder(client, "Leaf", parent_id=mid["id"])
    p = _project(client, "Locked", folder_id=leaf["id"])
    pid = p["id"]
    img = _upload(client, pid).json()
    cls = client.post(f"/api/projects/{pid}/classes", json={"name": "c", "project_id": pid}).json()
    grp = client.post(f"/api/projects/{pid}/groups", json={"identifier": "G1"}).json()
    client.post(f"/api/projects/{pid}/metadata", json={"key": "k", "value": "v"})
    r = client.post(f"/api/images/{img['id']}/comments", json={"text": "c"})
    comment = r.json()
    assert client.post(f"/api/folders/{top['id']}/archive").status_code == 200
    return {
        "top": top, "mid": mid, "leaf": leaf, "pid": pid, "img": img["id"],
        "cls": cls["id"], "grp": grp["id"], "comment": comment["id"], "project": p,
    }


WRITE_ROUTES = [
    ("PUT", "/api/projects/{pid}", {"name": "x"}),
    ("PUT", "/api/projects/{pid}", {"description": "x"}),
    ("POST", "/api/projects/{pid}/classes", {"name": "c2", "project_id": "{pid}"}),
    ("PATCH", "/api/classes/{cls}", {"name": "c3"}),
    ("DELETE", "/api/classes/{cls}", None),
    ("POST", "/api/projects/{pid}/metadata", {"key": "k2", "value": 1}),
    ("PUT", "/api/projects/{pid}/metadata/k", {"key": "k", "value": 2}),
    ("DELETE", "/api/projects/{pid}/metadata/k", None),
    ("PUT", "/api/projects/{pid}/metadata-dict", {"a": 1}),
    ("POST", "/api/projects/{pid}/groups", {"identifier": "G2"}),
    ("PATCH", "/api/groups/{grp}", {"display_name": "x"}),
    ("DELETE", "/api/groups/{grp}", None),
    ("POST", "/api/projects/{pid}/batches", {"name": "B"}),
    ("POST", "/api/projects/{pid}/parts", {"serial_number": "S"}),
    ("DELETE", "/api/projects/{pid}/parts", None),
    ("PUT", "/api/projects/{pid}/configuration", {"config": {}}),
    ("POST", "/api/projects/{pid}/configuration/interface-layout/default", {"layout_model": {}}),
    ("POST", "/api/images/{img}/comments", {"text": "x"}),
    ("PUT", "/api/images/{img}/metadata", {"key": "a", "value": 1}),
    ("DELETE", "/api/images/{img}/metadata/a", None),
    ("POST", "/api/images/{img}/reviews", {"status": "pass"}),
    ("DELETE", "/api/projects/{pid}/images/{img}", {"reason": "cleanup reason"}),
    ("POST", "/api/projects/{pid}/images/{img}/restore", None),
    ("POST", "/api/images/{img}/analyses", {"model_name": "mm", "model_version": "1", "image_id": "{img}"}),
]


@pytest.mark.parametrize(("method", "path", "body"), WRITE_ROUTES)
def test_locked_project_write_routes_refused(client, locked_world, method, path, body):
    w = locked_world
    fmt = {k: w[k] for k in ("pid", "img", "cls", "grp")}
    url = path.format(**fmt)
    if body is not None:
        body = json.loads(json.dumps(body).replace("{pid}", w["pid"]).replace("{img}", w["img"]))
    before = _activity(client, w["pid"])
    r = client.request(method, url, json=body)
    assert r.status_code == 403, (method, url, r.status_code, r.text[:200])
    assert _activity(client, w["pid"]) == before


def test_locked_project_image_upload_refused(client, locked_world):
    r = _upload(client, locked_world["pid"])
    assert r.status_code == 403


def test_locked_project_batch_upload_refused(client, locked_world):
    r = client.post(
        f"/api/projects/{locked_world['pid']}/images/batch",
        files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
    )
    assert r.status_code == 403, r.text


def test_locked_project_archive_toggle(client, locked_world):
    """Archiving/unarchiving a project inside an archived folder: unarchive is
    refused; archive changes the project's own state (debatable)."""
    pid = locked_world["pid"]
    r = client.patch(f"/api/projects/{pid}/unarchive")
    assert r.status_code in (200, 403)
    assert client.get(f"/api/projects/{pid}").json()["is_archived"] is False
    r = client.patch(f"/api/projects/{pid}/archive")
    assert r.status_code == 403, "project inside archived folder is locked"


def test_create_subfolder_under_locked_child(client, locked_world):
    r = client.post(
        "/api/folders",
        json={"name": "n", "meta_group_id": GROUP, "parent_id": locked_world["leaf"]["id"]},
    )
    assert r.status_code == 403


def test_create_project_in_locked_child(client, locked_world):
    r = client.post(
        "/api/projects/",
        json={"name": "n", "meta_group_id": GROUP, "folder_id": locked_world["leaf"]["id"]},
    )
    assert r.status_code == 403


def test_bulk_move_out_of_locked_folder_refused(client, locked_world):
    dest = _folder(client, "Dest")
    free = _project(client, "Free")
    r = _bulk_move(client, [_p(free), {"type": "project", "id": locked_world["pid"]}], dest["id"])
    assert r.json()["ok"] is False
    assert client.get(f"/api/projects/{free['id']}").json()["folder_id"] is None
    r = _bulk_move(client, [_f(locked_world["mid"])], None)
    assert r.json()["ok"] is False
    assert client.get(f"/api/folders/{locked_world['mid']['id']}").json()["parent_id"] == locked_world["top"]["id"]


def test_bulk_move_into_locked_folder_refused(client, locked_world):
    free = _project(client, "Free")
    ff = _folder(client, "FreeF")
    r = _bulk_move(client, [_p(free), _f(ff)], locked_world["leaf"]["id"])
    assert r.json()["ok"] is False
    assert client.get(f"/api/projects/{free['id']}").json()["folder_id"] is None


def test_bulk_archive_cannot_unarchive_child_under_archived_parent(client, locked_world):
    w = locked_world
    client.post(f"/api/folders/{w['top']['id']}/unarchive")
    client.post(f"/api/folders/{w['leaf']['id']}/archive")
    client.post(f"/api/folders/{w['top']['id']}/archive")
    # Unarchive [leaf, top] in that order: leaf first -> parent still archived.
    r = _bulk_archive(client, [_f(w["leaf"]), _f(w["top"])], archived=False)
    assert r.json()["ok"] is False
    tree = _tree(client, include_archived=True)
    assert tree[w["top"]["id"]]["is_archived"] is True
    assert tree[w["leaf"]["id"]]["is_archived"] is True


def test_bulk_archive_parent_then_child_in_one_request(client):
    """[top, child]: once top is archived the child is locked and its own flag
    is frozen, so the request is refused as a whole and nothing changes."""
    top = _folder(client, "Top")
    child = _folder(client, "Child", parent_id=top["id"])
    r = _bulk_archive(client, [_f(top), _f(child)])
    assert r.json()["ok"] is False
    tree = _tree(client, include_archived=True)
    assert tree[top["id"]]["is_archived"] is False
    assert tree[child["id"]]["is_archived"] is False


def test_archive_subfolder_of_archived_folder_refused(client):
    """Archiving a locked (inherited) subfolder changes its 'own prior state'
    which unarchive is supposed to restore. It should be refused."""
    top = _folder(client, "Top")
    child = _folder(client, "Child", parent_id=top["id"])
    client.post(f"/api/folders/{top['id']}/archive")
    r = client.post(f"/api/folders/{child['id']}/archive")
    assert r.status_code == 403
    client.post(f"/api/folders/{top['id']}/unarchive")
    assert _tree(client)[child["id"]]["is_archived"] is False


def test_bulk_archive_project_in_archived_folder_refused(client, locked_world):
    r = _bulk_archive(client, [{"type": "project", "id": locked_world["pid"]}])
    assert r.json()["ok"] is False
    client.post(f"/api/folders/{locked_world['top']['id']}/unarchive")
    assert client.get(f"/api/projects/{locked_world['pid']}").json()["is_archived"] is False


def test_unarchive_middle_while_top_archived_refused(client, locked_world):
    w = locked_world
    client.post(f"/api/folders/{w['top']['id']}/unarchive")
    client.post(f"/api/folders/{w['mid']['id']}/archive")
    client.post(f"/api/folders/{w['top']['id']}/archive")
    assert client.post(f"/api/folders/{w['mid']['id']}/unarchive").status_code == 403
    assert client.post(f"/api/folders/{w['top']['id']}/unarchive").status_code == 200
    tree = _tree(client, include_archived=True)
    assert tree[w["mid"]["id"]]["is_archived"] is True
    assert tree[w["leaf"]["id"]]["effective_archived"] is True
    assert tree[w["leaf"]["id"]]["locked_by_folder_id"] == w["mid"]["id"]


def test_archived_project_cannot_be_bulk_moved(client):
    dest = _folder(client, "Dest")
    p = _project(client, "P")
    client.patch(f"/api/projects/{p['id']}/archive")
    r = _bulk_move(client, [_p(p)], dest["id"])
    assert r.json()["ok"] is False
    assert client.get(f"/api/projects/{p['id']}").json()["folder_id"] is None


def test_archived_project_moving_to_same_folder_is_noop(client):
    p = _project(client, "P")
    client.patch(f"/api/projects/{p['id']}/archive")
    r = _move_project(client, p["id"], None)
    assert r.status_code in (200, 403)


def test_move_archived_folder_itself_into_free_folder_refused(client):
    a = _folder(client, "A")
    b = _folder(client, "B")
    client.post(f"/api/folders/{a['id']}/archive")
    assert _move_folder(client, a["id"], b["id"]).status_code == 403
    assert _bulk_move(client, [_f(a)], b["id"]).json()["ok"] is False


def test_rename_archived_folder_noop_payload(client):
    """Empty PATCH body on a locked folder returns 200 without changes; that is
    fine, but description edits must be refused."""
    a = _folder(client, "A")
    client.post(f"/api/folders/{a['id']}/archive")
    assert client.patch(f"/api/folders/{a['id']}", json={"description": "x"}).status_code == 403


# --- 7. Search ----------------------------------------------------------------------


def _names(res):
    return sorted(p["name"] for p in res["projects"])


def test_search_percent_underscore_backslash_literal(client):
    for n in ["50% off", "500 off", "snake_case", "snakeXcase", r"C:\temp", "C:temp", "C:\\\\x"]:
        _project(client, n)
    assert _names(_items(client, q="%")) == ["50% off"]
    assert _names(_items(client, q="_")) == ["snake_case"]
    assert _names(_items(client, q="\\")) == sorted([r"C:\temp", "C:\\\\x"])
    assert _names(_items(client, q="\\\\")) == ["C:\\\\x"]
    assert _names(_items(client, q="\\t")) == [r"C:\temp"]
    assert _names(_items(client, q="%%")) == []


def test_search_folder_names_wildcards_literal(client):
    _folder(client, "100% done")
    _folder(client, "a_b")
    _folder(client, "axb")
    assert [f["name"] for f in _items(client, q="a_b")["folders"]] == ["a_b"]
    assert [f["name"] for f in _items(client, q="%")["folders"]] == ["100% done"]


def test_search_quotes_and_sql(client):
    _project(client, "O'Brien \"quoted\"")
    assert _names(_items(client, q="O'Brien")) == ["O'Brien \"quoted\""]
    assert _names(_items(client, q='"quoted"')) == ["O'Brien \"quoted\""]
    assert _items(client, q="'; DROP TABLE projects; --")["projects"] == []
    assert len(_items(client)["projects"]) == 1


def test_search_q_length_bounds(client):
    _project(client, "x" * 255)
    assert len(_items(client, q="x" * 255)["projects"]) == 1
    r = client.get("/api/dashboard/items", params={"meta_group_id": GROUP, "q": "x" * 256})
    assert r.status_code == 422


def test_search_whitespace_only_q_is_plain_listing(client):
    f = _folder(client, "F")
    _project(client, "Deep", folder_id=f["id"])
    _project(client, "Root")
    res = _items(client, q="   ")
    assert res["query"] is None and res["recursive"] is False
    assert _names(res) == ["Root"]


def test_search_unicode_case_folding_projects(client):
    _project(client, "Straße Werk")
    _project(client, "ÉCOLE")
    assert _names(_items(client, q="strasse")) == ["Straße Werk"]
    assert _names(_items(client, q="STRASSE")) == ["Straße Werk"]
    assert _names(_items(client, q="école")) == ["ÉCOLE"]


def test_search_unicode_case_folding_folders(client):
    _folder(client, "Straße")
    assert [f["name"] for f in _items(client, q="STRASSE")["folders"]] == ["Straße"]


def test_search_non_ascii_lowercase_project(client):
    """SQLite lower() is ASCII-only: 'ÉCOLE' vs 'école'."""
    _project(client, "ÉCOLE")
    assert _names(_items(client, q="éc")) == ["ÉCOLE"]


def test_search_descriptions_projects_and_folders(client):
    _project(client, "plain", description="mentions turbine")
    _folder(client, "F", description="Turbine notes")
    res = _items(client, q="TURBINE")
    assert _names(res) == ["plain"]
    assert [f["name"] for f in res["folders"]] == ["F"]


def test_search_excludes_projects_in_archived_folders_unless_requested(client):
    a = _folder(client, "A")
    sub = _folder(client, "Sub", parent_id=a["id"])
    _project(client, "needle", folder_id=sub["id"])
    client.post(f"/api/folders/{a['id']}/archive")
    assert _items(client, q="needle")["projects"] == []
    assert _items(client, q="sub")["folders"] == []
    assert _names(_items(client, q="needle", include_archived=True)) == ["needle"]
    res = _items(client, q="needle", include_archived=True, archived="active")
    assert res["projects"] == []


def test_search_scoped_into_archived_folder_hidden_by_default(client):
    a = _folder(client, "A")
    _project(client, "needle", folder_id=a["id"])
    client.post(f"/api/folders/{a['id']}/archive")
    assert _items(client, q="needle", folder_id=a["id"])["projects"] == []
    assert _items(client, folder_id=a["id"])["projects"] == []


def test_archived_filter_requires_include_archived(client):
    """archived=archived without include_archived must not reveal archived items."""
    p = _project(client, "Arch")
    client.patch(f"/api/projects/{p['id']}/archive")
    res = _items(client, archived="archived")
    assert res["projects"] == []


def test_search_scope_includes_the_folder_itself(client):
    """Searching inside folder X should not list X itself as a hit."""
    x = _folder(client, "needle-top")
    _folder(client, "needle-child", parent_id=x["id"])
    names = [f["name"] for f in _items(client, q="needle", folder_id=x["id"])["folders"]]
    assert names == ["needle-child"]


def test_items_unknown_folder_404(client):
    r = client.get(
        "/api/dashboard/items", params={"meta_group_id": GROUP, "folder_id": str(uuid.uuid4())}
    )
    assert r.status_code == 404


def test_items_folder_id_from_other_accessible_group_404(client):
    """folder_id of group OTHER while listing GROUP: 404, not a mixed listing."""
    theirs = _folder(client, "Theirs", group=OTHER)
    _project(client, "T", group=OTHER, folder_id=theirs["id"])
    r = client.get(
        "/api/dashboard/items", params={"meta_group_id": GROUP, "folder_id": theirs["id"]}
    )
    assert r.status_code == 404


def test_items_project_type_filter_with_query(client):
    _project(client, "needle a", project_type="PT1")
    _project(client, "needle b", project_type="PT2")
    _folder(client, "needle folder")
    res = _items(client, q="needle", project_type="pt2")
    # The type filter narrows projects only; matching folders stay listed.
    assert _names(res) == ["needle b"]
    assert [f["name"] for f in res["folders"]] == ["needle folder"]


# --- 8. Pagination -----------------------------------------------------------------


def test_offset_beyond_total(client):
    for i in range(3):
        _project(client, f"p{i}")
    res = _items(client, offset=100)
    assert res["projects"] == [] and res["total_projects"] == 3


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 501}, {"offset": -1}, {"limit": -5}, {"limit": "abc"}],
)
def test_bad_pagination_params_422(client, params):
    r = client.get("/api/dashboard/items", params={"meta_group_id": GROUP, **params})
    assert r.status_code == 422


def test_limit_500_allowed(client):
    assert client.get("/api/dashboard/items", params={"meta_group_id": GROUP, "limit": 500}).status_code == 200


def test_ids_201_entries_rejected(client):
    ids = [str(uuid.uuid4()) for _ in range(201)]
    r = client.get("/api/dashboard/items", params={"meta_group_id": GROUP, "ids": ids})
    assert r.status_code == 422
    ids = ids[:200]
    r = client.get("/api/dashboard/items", params={"meta_group_id": GROUP, "ids": ids})
    assert r.status_code == 200


def test_ids_excludes_archived_unless_requested(client):
    p = _project(client, "Arch")
    f = _folder(client, "F")
    q = _project(client, "InArch", folder_id=f["id"])
    client.patch(f"/api/projects/{p['id']}/archive")
    client.post(f"/api/folders/{f['id']}/archive")
    assert _items(client, ids=[p["id"], q["id"]])["projects"] == []
    assert len(_items(client, ids=[p["id"], q["id"]], include_archived=True)["projects"]) == 2


def test_pagination_is_stable_and_complete(client):
    made = {_project(client, "same")["id"] for _ in range(7)}
    seen = []
    for off in range(0, 7, 2):
        seen += [p["id"] for p in _items(client, limit=2, offset=off, sort="name")["projects"]]
    assert len(seen) == 7 and set(seen) == made


@pytest.mark.parametrize("order", ["asc", "desc"])
def test_sort_archived_nulls_last(client, order):
    a = _project(client, "active")
    for n in ["arch1", "arch2"]:
        p = _project(client, n)
        client.patch(f"/api/projects/{p['id']}/archive")
        time.sleep(0.01)
    res = _items(client, sort="archived", order=order, include_archived=True)["projects"]
    assert res[-1]["id"] == a["id"]
    vals = [p["archived_at"] for p in res[:-1]]
    assert vals == sorted(vals, reverse=order == "desc")


def test_project_list_total_with_archived_folders(client):
    f = _folder(client, "F")
    sub = _folder(client, "Sub", parent_id=f["id"])
    _project(client, "in-sub", folder_id=sub["id"])
    _project(client, "in-f", folder_id=f["id"])
    _project(client, "root")
    arch = _project(client, "arch")
    client.patch(f"/api/projects/{arch['id']}/archive")
    client.post(f"/api/folders/{f['id']}/archive")
    r = client.get("/api/projects/")
    assert r.headers["X-Total-Count"] == "1"
    assert [p["name"] for p in r.json()] == ["root"]
    r = client.get("/api/projects/", params={"include_archived": True})
    assert r.headers["X-Total-Count"] == "4"
    assert len(r.json()) == 4
    r = client.get("/api/projects/", params={"limit": 1, "skip": 1})
    assert r.headers["X-Total-Count"] == "1" and r.json() == []


def test_tree_counts_with_archived(client):
    f = _folder(client, "F")
    sub = _folder(client, "Sub", parent_id=f["id"])
    _project(client, "a", folder_id=sub["id"])
    arch = _project(client, "b", folder_id=sub["id"])
    client.patch(f"/api/projects/{arch['id']}/archive")
    t = _tree(client)
    assert t[f["id"]]["total_project_count"] == 1
    assert t[sub["id"]]["project_count"] == 1
    r = client.get("/api/folders/tree", params={"meta_group_id": GROUP}).json()
    assert r["total_project_count"] == 1


# --- 9. Bulk payloads --------------------------------------------------------------


def test_bulk_empty_items_422(client):
    assert _bulk_move(client, [], None).status_code == 422
    assert _bulk_archive(client, []).status_code == 422


def test_bulk_1001_items_422(client):
    items = [{"type": "project", "id": str(uuid.uuid4())} for _ in range(1001)]
    assert _bulk_move(client, items, None).status_code == 422
    assert _bulk_archive(client, items).status_code == 422


def test_bulk_bad_type_422(client):
    r = _bulk_move(client, [{"type": "image", "id": str(uuid.uuid4())}], None)
    assert r.status_code == 422


def test_bulk_move_duplicates_ok(client):
    dest = _folder(client, "Dest")
    p = _project(client, "P")
    r = _bulk_move(client, [_p(p), _p(p), _p(p)], dest["id"])
    body = r.json()
    assert body["ok"] is True
    assert client.get(f"/api/projects/{p['id']}").json()["folder_id"] == dest["id"]


def test_bulk_archive_duplicates_ok(client):
    p = _project(client, "P")
    r = _bulk_archive(client, [_p(p), _p(p)])
    assert r.json()["ok"] is True
    assert client.get(f"/api/projects/{p['id']}").json()["is_archived"] is True


def test_bulk_move_type_confusion(client):
    """A folder ID passed with type=project must fail cleanly (not 500)."""
    f = _folder(client, "F")
    dest = _folder(client, "Dest")
    r = _bulk_move(client, [{"type": "project", "id": f["id"]}], dest["id"])
    assert r.status_code == 200 and r.json()["ok"] is False


def test_bulk_move_name_clash_between_items(client):
    """Two folders with the same name from different parents moved into one
    target: second must fail and nothing must move."""
    a = _folder(client, "A")
    b = _folder(client, "B")
    x1 = _folder(client, "X", parent_id=a["id"])
    x2 = _folder(client, "x", parent_id=b["id"])
    dest = _folder(client, "Dest")
    r = _bulk_move(client, [_f(x1), _f(x2)], dest["id"])
    assert r.status_code == 200
    assert r.json()["ok"] is False
    t = _tree(client)
    assert t[x1["id"]]["parent_id"] == a["id"] and t[x2["id"]]["parent_id"] == b["id"]


def test_bulk_move_name_clash_to_root(client):
    """Root uniqueness relies on a partial index; bulk-moving two same-named
    folders to the root must fail cleanly (no 500, no partial move)."""
    a = _folder(client, "A")
    b = _folder(client, "B")
    x1 = _folder(client, "X", parent_id=a["id"])
    x2 = _folder(client, "X", parent_id=b["id"])
    r = _bulk_move(client, [_f(x1), _f(x2)], None)
    assert r.status_code == 200 and r.json()["ok"] is False
    t = _tree(client)
    assert t[x1["id"]]["parent_id"] == a["id"]


def test_bulk_all_or_nothing_previous_folder_ids(client):
    a = _folder(client, "A")
    dest = _folder(client, "Dest")
    p = _project(client, "P", folder_id=a["id"])
    r = _bulk_move(client, [_p(p)], dest["id"])
    assert r.json()["results"][0]["previous_folder_id"] == a["id"]


def test_bulk_archive_rollback_restores_session_state(client):
    """First item archived then second fails -> first must be rolled back."""
    f = _folder(client, "F")
    p = _project(client, "P")
    r = _bulk_archive(client, [_f(f), _p(p), {"type": "project", "id": str(uuid.uuid4())}])
    assert r.json()["ok"] is False
    assert _tree(client)[f["id"]]["is_archived"] is False
    assert client.get(f"/api/projects/{p['id']}").json()["is_archived"] is False


def test_bulk_archive_other_creator_project_fails_all(client):
    f = _folder(client, "F")
    r = client.post(
        "/api/projects/",
        json={"name": "Theirs", "meta_group_id": GROUP},
        headers={"X-User-Email": "someone@example.com"},
    )
    theirs = r.json()
    r = _bulk_archive(client, [_f(f), _p(theirs)])
    assert r.json()["ok"] is False
    assert _tree(client)[f["id"]]["is_archived"] is False


# --- 10. Activity ------------------------------------------------------------------


def test_activity_not_bumped_by_403_on_locked(client, locked_world):
    before = _activity(client, locked_world["pid"])
    time.sleep(0.02)
    _upload(client, locked_world["pid"])
    client.put(f"/api/projects/{locked_world['pid']}", json={"name": "x"})
    assert _activity(client, locked_world["pid"]) == before


def test_activity_not_bumped_by_failed_validation(client):
    p = _project(client, "P")
    before = _activity(client, p["id"])
    time.sleep(0.02)
    # passes the writable check, then fails (path/body mismatch -> 400)
    r = client.post(
        f"/api/projects/{p['id']}/classes",
        json={"name": "c", "project_id": str(uuid.uuid4())},
    )
    assert r.status_code == 400
    # metadata-dict / groups conflict after the writable check
    client.post(f"/api/projects/{p['id']}/groups", json={"identifier": "G"})
    after_ok = _activity(client, p["id"])
    assert after_ok > before
    time.sleep(0.02)
    r = client.post(f"/api/projects/{p['id']}/groups", json={"identifier": "G"})
    assert r.status_code in (400, 409)
    assert _activity(client, p["id"]) == after_ok


def test_activity_not_bumped_by_put_cross_group_403(client):
    p = _project(client, "P")
    before = _activity(client, p["id"])
    time.sleep(0.02)
    r = client.put(f"/api/projects/{p['id']}", json={"meta_group_id": OTHER})
    assert r.status_code == 403
    assert _activity(client, p["id"]) == before


def test_activity_not_bumped_by_failed_image_delete(client):
    p = _project(client, "P")
    img = _upload(client, p["id"]).json()
    before = _activity(client, p["id"])
    time.sleep(0.02)
    # wrong project id -> 404 after the writable check
    other = _project(client, "Other")
    r = client.request(
        "DELETE",
        f"/api/projects/{other['id']}/images/{img['id']}",
        json={"reason": "cleanup reason"},
    )
    assert r.status_code == 404
    assert _activity(client, p["id"]) == before


def test_activity_bumped_by_upload(client):
    p = _project(client, "P")
    before = _activity(client, p["id"])
    time.sleep(0.02)
    assert _upload(client, p["id"]).status_code == 201
    assert _activity(client, p["id"]) > before


def test_activity_not_bumped_by_move_or_bulk_move_or_archive(client):
    f = _folder(client, "F")
    p = _project(client, "P")
    before = _activity(client, p["id"])
    time.sleep(0.02)
    _move_project(client, p["id"], f["id"])
    _bulk_move(client, [_p(p)], None)
    _move_folder(client, f["id"], None)
    assert _activity(client, p["id"]) == before


def test_activity_not_bumped_by_read_of_configuration(client):
    p = _project(client, "P")
    before = _activity(client, p["id"])
    time.sleep(0.02)
    client.get(f"/api/projects/{p['id']}/configuration")
    client.get(f"/api/projects/{p['id']}/analyze/checkpoints")
    client.get(f"/api/projects/{p['id']}/data-summary")
    assert _activity(client, p["id"]) == before


def test_folder_last_edited_bumps_on_descendant_project_change(client):
    top = _folder(client, "Top")
    sub = _folder(client, "Sub", parent_id=top["id"])
    p = _project(client, "P", folder_id=sub["id"])
    t0 = _tree(client)[top["id"]]["last_edited_at"]
    time.sleep(0.05)
    assert _upload(client, p["id"]).status_code == 201
    t1 = _tree(client)[top["id"]]["last_edited_at"]
    assert t1 > t0


def test_folder_last_edited_not_bumped_by_failed_rename(client):
    _folder(client, "A")
    b = _folder(client, "B")
    t0 = _tree(client)[b["id"]]["last_edited_at"]
    time.sleep(0.05)
    assert client.patch(f"/api/folders/{b['id']}", json={"name": "a"}).status_code == 409
    assert _tree(client)[b["id"]]["last_edited_at"] == t0


def test_folder_last_edited_not_bumped_by_failed_bulk_move(client):
    dest = _folder(client, "Dest")
    p = _project(client, "P")
    arch = _project(client, "Arch")
    client.patch(f"/api/projects/{arch['id']}/archive")
    t0 = _tree(client)[dest["id"]]["last_edited_at"]
    time.sleep(0.05)
    _bulk_move(client, [_p(p), _p(arch)], dest["id"])
    assert _tree(client)[dest["id"]]["last_edited_at"] == t0


def test_create_project_in_folder_touches_folder(client):
    f = _folder(client, "F")
    t0 = _tree(client)[f["id"]]["last_edited_at"]
    time.sleep(1.1)  # func.now() on SQLite has 1s resolution
    _project(client, "P", folder_id=f["id"])
    assert _tree(client)[f["id"]]["last_edited_at"] > t0


def test_folder_create_response_shape_and_timestamps_utc(client):
    f = _folder(client, "F")
    assert f["effective_archived"] is False
    assert f["path"] == [{"id": f["id"], "name": "F"}]


# --- 11. Backup import (folder tree restore) -----------------------------------------


def _bundle(folders, projects):
    manifest = {
        "format": "vista-dashboard-backup",
        "version": 1,
        "projects": [{"id": p["id"]} for p in projects],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("folders.json", json.dumps({"folders": folders}))
        for p in projects:
            z.writestr(f"projects/{p['id']}/project-backup.json", json.dumps({"project": p}))
    return buf.getvalue()


def _import(client, content):
    return client.post(
        "/api/dashboard/import",
        files={"file": ("d.vistabundle", content, "application/zip")},
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
    )


def test_import_cross_group_project_enables_cross_group_delete(client):
    """Consequence of a GROUP project placed in an OTHER folder: a user who
    is only in OTHER can delete the GROUP project via the folder delete."""
    pid, fid = str(uuid.uuid4()), str(uuid.uuid4())
    content = _bundle(
        [{"id": fid, "parent_id": None, "meta_group_id": OTHER, "name": "OtherF"}],
        [{"id": pid, "name": "Victim", "meta_group_id": GROUP, "folder_id": fid}],
    )
    r = _import(client, content)
    assert r.status_code == 200, r.text
    new_pid = r.json()["projects_created"][0]["new_project_id"]
    other_folder = next(iter(_tree(client, group=OTHER).values()))
    with _members_of(OTHER):
        # The OTHER-only user cannot reach the GROUP project directly...
        assert client.get(f"/api/projects/{new_pid}").status_code == 403
        prev = client.get(f"/api/folders/{other_folder['id']}/delete-preview").json()
        r = _delete(client, other_folder["id"], f"DELETE {other_folder['name']}")
        assert r.status_code == 200
    # ...but the folder delete must not destroy it.
    assert client.get(f"/api/projects/{new_pid}").status_code == 200, (
        "OTHER-only user deleted a GROUP project via folder delete"
    )
    assert prev["projects"] == 0, "preview counts a project of another group"


def test_import_folder_parent_in_other_group_rejected(client):
    """A child folder in GROUP whose parent is in OTHER mixes access groups."""
    parent, child = str(uuid.uuid4()), str(uuid.uuid4())
    content = _bundle(
        [
            {"id": parent, "parent_id": None, "meta_group_id": OTHER, "name": "P"},
            {"id": child, "parent_id": parent, "meta_group_id": GROUP, "name": "C"},
        ],
        [{"id": str(uuid.uuid4()), "name": "x", "meta_group_id": GROUP}],
    )
    assert _import(client, content).status_code == 200
    for f in _tree(client, include_archived=True).values():
        if f["parent_id"] is not None:
            parent_row = client.get(f"/api/folders/{f['parent_id']}").json()
            assert parent_row["meta_group_id"] == f["meta_group_id"]


@pytest.mark.parametrize("bad", ["\u200b", "a\nb\x00", "\u202eevil"])
def test_import_folder_names_are_validated_like_api(client, bad):
    content = _bundle(
        [{"id": str(uuid.uuid4()), "parent_id": None, "meta_group_id": GROUP, "name": bad}],
        [{"id": str(uuid.uuid4()), "name": "x", "meta_group_id": GROUP}],
    )
    assert _import(client, content).status_code == 200
    names = [f["name"] for f in _tree(client).values()]
    for n in names:
        assert n == "".join(ch for ch in n if ch.isprintable()).strip() and n, repr(n)


def test_import_project_into_archived_folder_is_locked(client):
    """Report-only sanity: restoring an archived folder keeps its projects locked."""
    pid, fid = str(uuid.uuid4()), str(uuid.uuid4())
    content = _bundle(
        [{"id": fid, "parent_id": None, "meta_group_id": GROUP, "name": "Arch", "is_archived": True}],
        [{"id": pid, "name": "In", "meta_group_id": GROUP, "folder_id": fid}],
    )
    r = _import(client, content)
    new_pid = r.json()["projects_created"][0]["new_project_id"]
    assert client.put(f"/api/projects/{new_pid}", json={"name": "x"}).status_code == 403


def test_read_archived_folder_reports_its_project_counts(client):
    """Debatable: GET /folders/{id} on an archived folder reports 0 projects
    and 0 subfolders (counts use include_archived=False)."""
    f = _folder(client, "F")
    _folder(client, "Sub", parent_id=f["id"])
    _project(client, "P", folder_id=f["id"])
    client.post(f"/api/folders/{f['id']}/archive")
    got = client.get(f"/api/folders/{f['id']}").json()
    assert got["project_count"] == 1 and got["folder_count"] == 1


def test_search_exact_name_with_sharp_s(client):
    """q is casefolded ('straße' -> 'strasse') but the column is only
    lower()ed, so typing the exact name finds nothing (also on PostgreSQL)."""
    _project(client, "Straße Werk")
    assert _names(_items(client, q="Straße")) == ["Straße Werk"]


def test_search_exact_name_greek_final_sigma(client):
    _project(client, "ΟΔΟΣ test")
    _project(client, "οδος lower")
    assert "ΟΔΟΣ test" in _names(_items(client, q="ΟΔΟΣ"))


def test_project_meta_group_id_whitespace_is_normalized(client):
    """Membership checks strip the group id, storage does not: a project in
    'data-scientists ' becomes a phantom group invisible on the dashboard."""
    r = client.post("/api/projects/", json={"name": "WS", "meta_group_id": GROUP + " "})
    if r.status_code == 422:
        return
    assert r.status_code == 201
    assert r.json()["meta_group_id"] == GROUP
    assert [p["name"] for p in _items(client)["projects"]] == ["WS"]


def test_project_whitespace_group_cannot_join_folder_of_trimmed_group(client):
    f = _folder(client, "F")
    # " group" is normalized to "group", so this is the folder's own group.
    r = client.post(
        "/api/projects/",
        json={"name": "WS", "meta_group_id": " " + GROUP, "folder_id": f["id"]},
    )
    assert r.status_code == 201, r.text
    assert r.json()["meta_group_id"] == GROUP
