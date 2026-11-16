"""HTTP contracts for inspection nonconformance reports (NCRs)."""

import uuid
from unittest.mock import patch

import pytest

NCR_CONFIG = {
    "failure_codes": [
        {"code": "FC-01", "description": "Porosity"},
        {"code": "FC-02", "description": "Crack"},
    ],
    "disposition_codes": [
        {"code": "UAI", "description": "Use as is"},
        {"code": "RWK", "description": "Rework"},
    ],
}

VALID_NCR = {
    "comment": "Porosity cluster on flange face",
    "failure_code": "FC-01",
    "disposition_code": "RWK",
    "disposition_instructions": "Blend and re-inspect per WI-12",
}


def _headers(email: str, group: str) -> dict:
    # Debug auth reads the acting user from X-User-Email.
    return {
        "X-User-Email": email,
        "X-User-Id": email,
        "X-User-Groups": f'["{group}"]',
    }


@pytest.fixture
def ncr_project(client):
    """Create a project with configured NCR codes and one part."""
    group = f"ncr-{uuid.uuid4().hex[:8]}"
    inspector = _headers(f"inspector-{group}@example.com", group)
    approver = _headers(f"approver-{group}@example.com", group)
    resp = client.post(
        "/api/projects/",
        json={
            "name": f"NCR project {group}",
            "description": "NCR tests",
            "meta_group_id": group,
            "project_type": "PT2",
        },
        headers=inspector,
    )
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["id"]
    config = client.get(
        f"/api/projects/{project_id}/configuration", headers=inspector
    ).json()["config"]
    config["ncr_configuration"] = NCR_CONFIG
    resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=inspector,
    )
    assert resp.status_code == 200, resp.text
    resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "SN-0001"},
        headers=inspector,
    )
    assert resp.status_code == 201, resp.text
    return {
        "project_id": project_id,
        "part_id": resp.json()["id"],
        "group": group,
        "inspector": inspector,
        "approver": approver,
    }


def _ncrs_url(ctx, part_id=None):
    return f"/api/projects/{ctx['project_id']}/parts/{part_id or ctx['part_id']}/ncrs"


def _create(client, ctx, payload=None, headers=None):
    return client.post(
        _ncrs_url(ctx), json=payload or VALID_NCR, headers=headers or ctx["inspector"]
    )


def test_create_ncr_snapshots_codes_and_records_creator(client, ncr_project):
    resp = _create(client, ncr_project)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["ncr_number"] == 1
    assert body["ncr_label"] == "NCR-0001"
    assert body["status"] == "open"
    assert body["part_serial_number"] == "SN-0001"
    assert body["failure_code"] == "FC-01"
    assert body["failure_code_description"] == "Porosity"
    assert body["disposition_code"] == "RWK"
    assert body["disposition_code_description"] == "Rework"
    inspector_email = ncr_project["inspector"]["X-User-Id"]
    assert body["created_by"] == inspector_email
    assert body["updated_by"] == inspector_email
    assert body["version"] == 1
    assert len(body["history"]) == 1
    created = body["history"][0]
    assert created["action"] == "created"
    assert created["actor"] == inspector_email
    assert created["changes"]["comment"] == {"from": None, "to": VALID_NCR["comment"]}
    assert created["changes"]["failure_code"]["to"] == "FC-01"


def test_create_matches_codes_case_insensitively(client, ncr_project):
    resp = _create(
        client,
        ncr_project,
        {**VALID_NCR, "failure_code": "fc-02", "disposition_code": " uai "},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["failure_code"] == "FC-02"
    assert resp.json()["disposition_code"] == "UAI"


def test_ncr_numbers_are_sequential_per_project(client, ncr_project):
    labels = [_create(client, ncr_project).json()["ncr_label"] for _ in range(3)]
    assert labels == ["NCR-0001", "NCR-0002", "NCR-0003"]


def test_ncr_numbers_are_not_reused_after_delete(client, ncr_project):
    first = _create(client, ncr_project).json()
    assert (
        client.delete(
            f"{_ncrs_url(ncr_project)}/{first['id']}", headers=ncr_project["inspector"]
        ).status_code
        == 204
    )
    second = _create(client, ncr_project).json()
    assert second["ncr_label"] == "NCR-0002"


@pytest.mark.parametrize(
    "field", ["comment", "failure_code", "disposition_code", "disposition_instructions"]
)
@pytest.mark.parametrize("value", [None, "", "   "])
def test_create_requires_every_field(client, ncr_project, field, value):
    payload = dict(VALID_NCR)
    if value is None:
        payload.pop(field)
    else:
        payload[field] = value
    resp = _create(client, ncr_project, payload)
    assert resp.status_code == 422, resp.text


def test_create_rejects_unconfigured_codes(client, ncr_project):
    resp = _create(client, ncr_project, {**VALID_NCR, "failure_code": "NOPE"})
    assert resp.status_code == 422
    assert "NCR Configuration" in resp.json()["detail"]
    resp = _create(client, ncr_project, {**VALID_NCR, "disposition_code": "NOPE"})
    assert resp.status_code == 422


def test_create_rejects_unknown_fields_and_client_supplied_identity(
    client, ncr_project
):
    for extra in (
        {"created_by": "forged@example.com"},
        {"approved_by": "forged@example.com"},
        {"status": "approved"},
        {"ncr_number": 99},
    ):
        resp = _create(client, ncr_project, {**VALID_NCR, **extra})
        assert resp.status_code == 422, extra


def test_create_rejects_oversized_and_control_character_text(client, ncr_project):
    resp = _create(client, ncr_project, {**VALID_NCR, "comment": "x" * 10_001})
    assert resp.status_code == 422
    resp = _create(client, ncr_project, {**VALID_NCR, "comment": "bad\x00text"})
    assert resp.status_code == 422
    resp = _create(
        client, ncr_project, {**VALID_NCR, "comment": "line one\nline two\tok"}
    )
    assert resp.status_code == 201


def test_create_on_unknown_part_returns_404(client, ncr_project):
    resp = client.post(
        _ncrs_url(ncr_project, part_id=uuid.uuid4()),
        json=VALID_NCR,
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 404


def test_list_part_ncrs_excludes_deleted(client, ncr_project):
    first = _create(client, ncr_project).json()
    _create(client, ncr_project)
    client.delete(
        f"{_ncrs_url(ncr_project)}/{first['id']}", headers=ncr_project["inspector"]
    )
    resp = client.get(_ncrs_url(ncr_project), headers=ncr_project["inspector"])
    assert resp.status_code == 200
    assert [ncr["ncr_label"] for ncr in resp.json()["ncrs"]] == ["NCR-0002"]


def test_edit_records_field_changes_and_editor(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}",
        json={
            "comment": "Updated comment",
            "failure_code": "FC-02",
            "disposition_instructions": "Scrap and replace",
            "expected_version": 1,
        },
        headers=ncr_project["approver"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    approver_email = ncr_project["approver"]["X-User-Id"]
    assert body["comment"] == "Updated comment"
    assert body["failure_code"] == "FC-02"
    assert body["failure_code_description"] == "Crack"
    assert body["updated_by"] == approver_email
    assert body["created_by"] == ncr_project["inspector"]["X-User-Id"]
    assert body["version"] == 2
    edit = body["history"][-1]
    assert edit["action"] == "updated"
    assert edit["actor"] == approver_email
    assert edit["changes"] == {
        "comment": {"from": VALID_NCR["comment"], "to": "Updated comment"},
        "failure_code": {"from": "FC-01", "to": "FC-02"},
        "failure_code_description": {"from": "Porosity", "to": "Crack"},
        "disposition_instructions": {
            "from": VALID_NCR["disposition_instructions"],
            "to": "Scrap and replace",
        },
    }


def test_edit_without_changes_records_no_history(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}",
        json={"comment": VALID_NCR["comment"]},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 1
    assert len(resp.json()["history"]) == 1


@pytest.mark.parametrize("field", ["comment", "disposition_instructions"])
def test_edit_cannot_blank_required_fields(client, ncr_project, field):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}",
        json={field: "  "},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422


def test_stale_version_is_rejected(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    ok = client.patch(
        url,
        json={"comment": "first", "expected_version": 1},
        headers=ncr_project["inspector"],
    )
    assert ok.status_code == 200
    stale = client.patch(
        url,
        json={"comment": "second", "expected_version": 1},
        headers=ncr_project["approver"],
    )
    assert stale.status_code == 409
    stale_approve = client.post(
        f"{url}/approve", json={"expected_version": 1}, headers=ncr_project["approver"]
    )
    assert stale_approve.status_code == 409


def test_approve_records_approver_in_history(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.post(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}/approve",
        json={"expected_version": 1},
        headers=ncr_project["approver"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    approver_email = ncr_project["approver"]["X-User-Id"]
    assert body["status"] == "approved"
    assert body["approved_by"] == approver_email
    assert body["approved_at"]
    approved = body["history"][-1]
    assert approved["action"] == "approved"
    assert approved["actor"] == approver_email
    assert approved["changes"]["approved_by"] == {"from": None, "to": approver_email}


def test_approve_without_body_is_allowed(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.post(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}/approve",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200, resp.text


def test_creator_may_approve_own_ncr(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.post(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}/approve",
        json={},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200


def test_double_approve_is_rejected(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}/approve"
    assert client.post(url, json={}, headers=ncr_project["approver"]).status_code == 200
    assert client.post(url, json={}, headers=ncr_project["approver"]).status_code == 409


def test_editing_approved_ncr_revokes_approval(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    client.post(f"{url}/approve", json={}, headers=ncr_project["approver"])
    resp = client.patch(
        url, json={"disposition_code": "UAI"}, headers=ncr_project["inspector"]
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "open"
    assert body["approved_by"] is None
    assert body["approved_at"] is None
    edit = body["history"][-1]
    assert edit["changes"]["status"] == {"from": "approved", "to": "open"}
    assert (
        edit["changes"]["approval_revoked"]["from"]["approved_by"]
        == ncr_project["approver"]["X-User-Id"]
    )
    assert edit["changes"]["disposition_code"] == {"from": "RWK", "to": "UAI"}
    assert [entry["action"] for entry in body["history"]] == [
        "created",
        "approved",
        "updated",
    ]
    reapprove = client.post(f"{url}/approve", json={}, headers=ncr_project["approver"])
    assert reapprove.status_code == 200


def test_removed_code_keeps_snapshot_and_unchanged_edit_still_works(
    client, ncr_project
):
    ncr = _create(client, ncr_project).json()
    headers = ncr_project["inspector"]
    project_id = ncr_project["project_id"]
    config = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    ).json()["config"]
    config["ncr_configuration"] = {
        "failure_codes": [{"code": "FC-02", "description": "Crack"}],
        "disposition_codes": [{"code": "UAI", "description": "Use as is"}],
    }
    client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    detail = client.get(url, headers=headers).json()
    assert detail["failure_code"] == "FC-01"
    assert detail["failure_code_description"] == "Porosity"
    # Re-sending the existing (now removed) code with another change is fine.
    resp = client.patch(
        url,
        json={"failure_code": "FC-01", "comment": "Still porosity"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    # Switching to a code that no longer exists is not.
    resp = client.patch(url, json={"disposition_code": "RWK2"}, headers=headers)
    assert resp.status_code == 422


def test_delete_is_soft_and_recorded(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    resp = client.delete(url, headers=ncr_project["approver"])
    assert resp.status_code == 204
    assert client.get(url, headers=ncr_project["inspector"]).status_code == 404
    assert (
        client.patch(
            url, json={"comment": "x"}, headers=ncr_project["inspector"]
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{url}/approve", json={}, headers=ncr_project["inspector"]
        ).status_code
        == 404
    )
    assert client.delete(url, headers=ncr_project["inspector"]).status_code == 404

    all_ncrs = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs?include_deleted=true",
        headers=ncr_project["inspector"],
    ).json()["ncrs"]
    assert len(all_ncrs) == 1
    assert all_ncrs[0]["deleted_by"] == ncr_project["approver"]["X-User-Id"]
    assert all_ncrs[0]["deleted_at"]


def test_project_ncr_list_spans_parts(client, ncr_project):
    other_part = client.post(
        f"/api/projects/{ncr_project['project_id']}/parts",
        json={"serial_number": "SN-0002"},
        headers=ncr_project["inspector"],
    ).json()["id"]
    _create(client, ncr_project)
    client.post(
        _ncrs_url(ncr_project, part_id=other_part),
        json=VALID_NCR,
        headers=ncr_project["inspector"],
    )
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200
    assert [(n["ncr_label"], n["part_serial_number"]) for n in resp.json()["ncrs"]] == [
        ("NCR-0001", "SN-0001"),
        ("NCR-0002", "SN-0002"),
    ]


def test_ncr_is_scoped_to_its_part(client, ncr_project):
    other_part = client.post(
        f"/api/projects/{ncr_project['project_id']}/parts",
        json={"serial_number": "SN-0002"},
        headers=ncr_project["inspector"],
    ).json()["id"]
    ncr = _create(client, ncr_project).json()
    wrong = f"{_ncrs_url(ncr_project, part_id=other_part)}/{ncr['id']}"
    headers = ncr_project["inspector"]
    assert client.get(wrong, headers=headers).status_code == 404
    assert (
        client.patch(wrong, json={"comment": "x"}, headers=headers).status_code == 404
    )
    assert client.post(f"{wrong}/approve", json={}, headers=headers).status_code == 404
    assert client.delete(wrong, headers=headers).status_code == 404


def test_users_outside_project_group_cannot_access_ncrs(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    outsider = _headers("outsider@example.com", "some-other-group")
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        for method, kwargs in (
            ("get", {}),
            ("patch", {"json": {"comment": "hijack"}}),
            ("delete", {}),
        ):
            resp = getattr(client, method)(url, headers=outsider, **kwargs)
            assert resp.status_code == 403, (method, resp.status_code)
        assert (
            client.post(f"{url}/approve", json={}, headers=outsider).status_code == 403
        )
        assert (
            client.post(
                _ncrs_url(ncr_project), json=VALID_NCR, headers=outsider
            ).status_code
            == 403
        )
        assert (
            client.get(
                f"/api/projects/{ncr_project['project_id']}/ncrs", headers=outsider
            ).status_code
            == 403
        )
    detail = client.get(url, headers=ncr_project["inspector"]).json()
    assert detail["comment"] == VALID_NCR["comment"]
    assert detail["status"] == "open"


def test_ncr_from_other_project_is_not_reachable(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    headers = ncr_project["inspector"]
    other = client.post(
        "/api/projects/",
        json={
            "name": "Other",
            "description": "x",
            "meta_group_id": ncr_project["group"],
            "project_type": "PT2",
        },
        headers=headers,
    ).json()["id"]
    url = f"/api/projects/{other}/parts/{ncr_project['part_id']}/ncrs/{ncr['id']}"
    assert client.get(url, headers=headers).status_code == 404
    assert client.delete(url, headers=headers).status_code == 404


def test_archived_project_ncrs_are_read_only(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    headers = ncr_project["inspector"]
    archive = client.patch(
        f"/api/projects/{ncr_project['project_id']}/archive", headers=headers
    )
    assert archive.status_code == 200, archive.text
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    assert client.get(url, headers=headers).status_code == 200
    assert client.get(_ncrs_url(ncr_project), headers=headers).status_code == 200
    assert _create(client, ncr_project).status_code == 403
    assert client.patch(url, json={"comment": "x"}, headers=headers).status_code == 403
    assert client.post(f"{url}/approve", json={}, headers=headers).status_code == 403
    assert client.delete(url, headers=headers).status_code == 403


def test_full_lifecycle_history_order(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    client.patch(url, json={"comment": "c2"}, headers=ncr_project["approver"])
    client.post(f"{url}/approve", json={}, headers=ncr_project["approver"])
    client.patch(url, json={"comment": "c3"}, headers=ncr_project["inspector"])
    detail = client.get(url, headers=ncr_project["inspector"]).json()
    assert [(h["version"], h["action"]) for h in detail["history"]] == [
        (1, "created"),
        (2, "updated"),
        (3, "approved"),
        (4, "updated"),
    ]
    assert detail["version"] == 4
    assert all(h["at"] for h in detail["history"])


def test_project_scoped_detail_reaches_ncr_after_part_deleted(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    headers = ncr_project["inspector"]
    project_url = f"/api/projects/{ncr_project['project_id']}/ncrs/{ncr['id']}"
    assert client.get(project_url, headers=headers).json()["history"][0]["action"] == (
        "created"
    )
    client.delete(
        f"/api/projects/{ncr_project['project_id']}/parts/{ncr_project['part_id']}",
        headers=headers,
    )
    detail = client.get(project_url, headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["part_id"] is None
    assert detail.json()["part_serial_number"] == "SN-0001"
    assert [h["action"] for h in detail.json()["history"]] == ["created"]


def test_project_scoped_detail_is_project_isolated(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    headers = ncr_project["inspector"]
    other = client.post(
        "/api/projects/",
        json={
            "name": "Other scoped",
            "description": "x",
            "meta_group_id": ncr_project["group"],
            "project_type": "PT2",
        },
        headers=headers,
    ).json()["id"]
    assert (
        client.get(
            f"/api/projects/{other}/ncrs/{ncr['id']}", headers=headers
        ).status_code
        == 404
    )
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        resp = client.get(
            f"/api/projects/{ncr_project['project_id']}/ncrs/{ncr['id']}",
            headers=_headers("outsider@example.com", "x"),
        )
    assert resp.status_code == 403


def test_non_numbering_integrity_error_is_not_retried(client, ncr_project, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    from repositories import inspection_ncrs as repo

    calls = {"count": 0}
    original = repo.add_history_entry

    def boom(*args, **kwargs):
        calls["count"] += 1
        raise IntegrityError("INSERT", {}, Exception("FOREIGN KEY constraint failed"))

    monkeypatch.setattr(repo, "add_history_entry", boom)
    resp = _create(client, ncr_project)
    monkeypatch.setattr(repo, "add_history_entry", original)
    assert resp.status_code == 404
    assert calls["count"] == 1
    assert _create(client, ncr_project).json()["ncr_label"] == "NCR-0001"


def test_part_list_and_detail_include_deleted_on_request(client, ncr_project):
    headers = ncr_project["inspector"]
    kept = _create(client, ncr_project).json()
    gone = _create(client, ncr_project).json()
    client.patch(
        f"{_ncrs_url(ncr_project)}/{gone['id']}",
        json={"comment": "edited before delete"},
        headers=headers,
    )
    assert (
        client.delete(
            f"{_ncrs_url(ncr_project)}/{gone['id']}", headers=ncr_project["approver"]
        ).status_code
        == 204
    )

    default = client.get(_ncrs_url(ncr_project), headers=headers).json()["ncrs"]
    assert [n["id"] for n in default] == [kept["id"]]
    listed = client.get(
        f"{_ncrs_url(ncr_project)}?include_deleted=true", headers=headers
    ).json()["ncrs"]
    assert [n["id"] for n in listed] == [kept["id"], gone["id"]]
    assert listed[1]["deleted_by"] == ncr_project["approver"]["X-User-Email"]
    assert listed[1]["deleted_at"]
    assert listed[0]["deleted_at"] is None

    part_url = f"{_ncrs_url(ncr_project)}/{gone['id']}"
    assert client.get(part_url, headers=headers).status_code == 404
    detail = client.get(f"{part_url}?include_deleted=true", headers=headers)
    assert detail.status_code == 200, detail.text
    assert [h["action"] for h in detail.json()["history"]] == [
        "created",
        "updated",
        "deleted",
    ]
    project_url = f"/api/projects/{ncr_project['project_id']}/ncrs/{gone['id']}"
    assert client.get(project_url, headers=headers).status_code == 404
    assert (
        client.get(f"{project_url}?include_deleted=true", headers=headers).status_code
        == 200
    )


def test_deleted_ncrs_stay_read_only(client, ncr_project):
    headers = ncr_project["inspector"]
    ncr = _create(client, ncr_project).json()
    url = f"{_ncrs_url(ncr_project)}/{ncr['id']}"
    client.delete(url, headers=headers)
    for suffix in ("", "?include_deleted=true"):
        assert (
            client.patch(
                f"{url}{suffix}", json={"comment": "x"}, headers=headers
            ).status_code
            == 404
        )
        assert (
            client.post(f"{url}/approve{suffix}", json={}, headers=headers).status_code
            == 404
        )
        assert client.delete(f"{url}{suffix}", headers=headers).status_code == 404


def test_include_deleted_still_requires_project_access(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    client.delete(
        f"{_ncrs_url(ncr_project)}/{ncr['id']}", headers=ncr_project["inspector"]
    )
    outsider = _headers("outsider@example.com", "x")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        for url in (
            f"{_ncrs_url(ncr_project)}?include_deleted=true",
            f"{_ncrs_url(ncr_project)}/{ncr['id']}?include_deleted=true",
        ):
            assert client.get(url, headers=outsider).status_code == 403
