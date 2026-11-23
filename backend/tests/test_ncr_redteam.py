"""Red-team / adversarial tests for inspection NCRs.

Each test asserts the CORRECT or SAFE behavior. A failing test is a finding.
"""

import io
import json
import re
import tomllib
import uuid
import zipfile
from unittest.mock import patch

import pytest

from services.export.report_pdf import build_simple_report_pdf
from tests.test_export_ncrs import _pdf_lines, _payload, _ncr_row
from tests.test_inspection_ncrs import (  # noqa: F401
    NCR_CONFIG,
    VALID_NCR,
    _create,
    _headers,
    _ncrs_url,
    ncr_project,
)

CONFIG_KEY = "inspection_workbench.project_configuration"


def _url(ctx, ncr_id, part_id=None):
    return f"{_ncrs_url(ctx, part_id)}/{ncr_id}"


def _get_config(client, ctx):
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/configuration", headers=ctx["inspector"]
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["config"]


def _put_config(client, ctx, config):
    return client.put(
        f"/api/projects/{ctx['project_id']}/configuration",
        json={"config": config},
        headers=ctx["inspector"],
    )


def _put_raw_config(client, ctx, value):
    """Write the stored project configuration directly (generic metadata API)."""
    resp = client.put(
        f"/api/projects/{ctx['project_id']}/metadata/{CONFIG_KEY}",
        json={"key": CONFIG_KEY, "value": value},
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    return resp


def _set_ncr_config(client, ctx, ncr_configuration):
    config = _get_config(client, ctx)
    config["ncr_configuration"] = ncr_configuration
    return _put_config(client, ctx, config)


# ---------------------------------------------------------------------------
# PATCH: mass assignment, nulls, empty body, expected_version abuse
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"status": "approved"},
        {"approved_by": "forged@example.com"},
        {"approved_at": "2020-01-01T00:00:00Z"},
        {"version": 99},
        {"part_id": str(uuid.uuid4())},
        {"project_id": str(uuid.uuid4())},
        {"ncr_number": 42},
        {"created_by": "forged@example.com"},
        {"updated_by": "forged@example.com"},
        {"deleted_at": "2020-01-01T00:00:00Z"},
        {"failure_code_description": "forged description"},
        {"disposition_code_description": "forged description"},
        {"part_serial_number": "FORGED"},
        {"history": []},
    ],
)
def test_patch_rejects_mass_assignment(client, ncr_project, extra):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        json={"comment": "new", **extra},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422, (extra, resp.status_code, resp.text)
    detail = client.get(
        _url(ncr_project, ncr["id"]), headers=ncr_project["inspector"]
    ).json()
    assert detail["comment"] == VALID_NCR["comment"]
    assert detail["status"] == "open"
    assert detail["version"] == 1


@pytest.mark.parametrize(
    "field", ["comment", "failure_code", "disposition_code", "disposition_instructions"]
)
def test_patch_null_field_never_blanks_value(client, ncr_project, field):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        json={field: None},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code in (200, 422), resp.text
    detail = client.get(
        _url(ncr_project, ncr["id"]), headers=ncr_project["inspector"]
    ).json()
    assert detail[field] == ncr[field]
    assert detail["version"] == 1


def test_patch_empty_body_is_noop(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]), json={}, headers=ncr_project["inspector"]
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] == 1
    assert len(resp.json()["history"]) == 1


@pytest.mark.parametrize("body", [[], "comment", 5, None])
def test_patch_non_object_body_is_422(client, ncr_project, body):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        content=json.dumps(body),
        headers={**ncr_project["inspector"], "Content-Type": "application/json"},
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("version", [0, -1, "abc", 1.5, [1], {"v": 1}])
def test_patch_invalid_expected_version_is_422(client, ncr_project, version):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        json={"comment": "x", "expected_version": version},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422, (version, resp.status_code)


@pytest.mark.parametrize("version", [True, "1"])
def test_patch_expected_version_rejects_non_integer_json(client, ncr_project, version):
    """A boolean or string is not a version number; lax coercion hides client bugs."""
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        json={"comment": "x", "expected_version": version},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422, (version, resp.status_code)


def test_patch_huge_expected_version_conflicts_not_500(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        json={"comment": "x", "expected_version": 10**30},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 409, resp.text


# ---------------------------------------------------------------------------
# Approve / delete body and query abuse
# ---------------------------------------------------------------------------


def test_approve_rejects_extra_body_keys(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    resp = client.post(
        f"{_url(ncr_project, ncr['id'])}/approve",
        json={"expected_version": 1, "approved_by": "forged@example.com"},
        headers=ncr_project["approver"],
    )
    # Either rejected, or the forged value must be ignored.
    if resp.status_code == 200:
        assert resp.json()["approved_by"] == ncr_project["approver"]["X-User-Email"]
    else:
        assert resp.status_code == 422


@pytest.mark.parametrize("version", ["abc", 0, -5, 1.5, [1]])
def test_approve_invalid_expected_version_is_422(client, ncr_project, version):
    ncr = _create(client, ncr_project).json()
    resp = client.post(
        f"{_url(ncr_project, ncr['id'])}/approve",
        json={"expected_version": version},
        headers=ncr_project["approver"],
    )
    assert resp.status_code == 422, (version, resp.status_code)
    assert (
        client.get(
            _url(ncr_project, ncr["id"]), headers=ncr_project["inspector"]
        ).json()["status"]
        == "open"
    )


@pytest.mark.parametrize("body", ["[]", '"x"', "5", "{bad json"])
def test_approve_malformed_body_is_not_500(client, ncr_project, body):
    ncr = _create(client, ncr_project).json()
    resp = client.post(
        f"{_url(ncr_project, ncr['id'])}/approve",
        content=body,
        headers={**ncr_project["approver"], "Content-Type": "application/json"},
    )
    assert resp.status_code < 500, resp.text
    assert resp.status_code != 200 or body == "{}", (body, resp.status_code)


@pytest.mark.parametrize("version", ["abc", "1.5", ""])
def test_delete_invalid_expected_version_is_422(client, ncr_project, version):
    ncr = _create(client, ncr_project).json()
    resp = client.delete(
        f"{_url(ncr_project, ncr['id'])}?expected_version={version}",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422, (version, resp.status_code)
    assert (
        client.get(
            _url(ncr_project, ncr["id"]), headers=ncr_project["inspector"]
        ).status_code
        == 200
    )


@pytest.mark.parametrize("version", ["0", "-1"])
def test_delete_non_positive_expected_version_is_422_like_patch(
    client, ncr_project, version
):
    """PATCH/approve enforce ge=1; DELETE should validate the same way."""
    ncr = _create(client, ncr_project).json()
    resp = client.delete(
        f"{_url(ncr_project, ncr['id'])}?expected_version={version}",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422, resp.status_code


def test_delete_stale_expected_version_is_409(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    client.patch(
        _url(ncr_project, ncr["id"]),
        json={"comment": "c2"},
        headers=ncr_project["inspector"],
    )
    resp = client.delete(
        f"{_url(ncr_project, ncr['id'])}?expected_version=1",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 409
    assert (
        client.get(
            _url(ncr_project, ncr["id"]), headers=ncr_project["inspector"]
        ).status_code
        == 200
    )


def test_approve_delete_approve_sequence(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = _url(ncr_project, ncr["id"])
    assert (
        client.post(
            f"{url}/approve", json={}, headers=ncr_project["approver"]
        ).status_code
        == 200
    )
    assert client.delete(url, headers=ncr_project["approver"]).status_code == 204
    assert (
        client.post(
            f"{url}/approve", json={}, headers=ncr_project["approver"]
        ).status_code
        == 404
    )
    records = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs?include_deleted=true",
        headers=ncr_project["inspector"],
    ).json()["ncrs"]
    assert len(records) == 1 and records[0]["deleted_at"]


# ---------------------------------------------------------------------------
# Text and code content
# ---------------------------------------------------------------------------


def test_text_boundary_exactly_10000_ok_10001_rejected(client, ncr_project):
    assert (
        _create(client, ncr_project, {**VALID_NCR, "comment": "x" * 10_000}).status_code
        == 201
    )
    assert (
        _create(client, ncr_project, {**VALID_NCR, "comment": "x" * 10_001}).status_code
        == 422
    )
    # Surrounding whitespace is stripped before the length check.
    padded = _create(
        client,
        ncr_project,
        {**VALID_NCR, "disposition_instructions": "  " + "y" * 10_000 + "  "},
    )
    assert padded.status_code == 201
    assert len(padded.json()["disposition_instructions"]) == 10_000
    assert (
        _create(
            client, ncr_project, {**VALID_NCR, "disposition_instructions": "y" * 10_001}
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "field", ["comment", "failure_code", "disposition_code", "disposition_instructions"]
)
@pytest.mark.parametrize(
    "bad", ["\x00", "\x01", "\x07", "\x1b", "\x1f", "\x0b", "\x0c"]
)
def test_control_characters_rejected_in_every_field(client, ncr_project, field, bad):
    base = VALID_NCR[field]
    resp = _create(client, ncr_project, {**VALID_NCR, field: f"{base}{bad}x"})
    assert resp.status_code == 422, (field, repr(bad), resp.status_code)
    ncr = _create(client, ncr_project).json()
    resp = client.patch(
        _url(ncr_project, ncr["id"]),
        json={field: f"{base}{bad}x"},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422, (field, repr(bad), resp.status_code)


def test_unicode_text_round_trips(client, ncr_project):
    text = "Riss \u05e9\u05dc\u05d5\u05dd \u202eRTL\u202c zero\u200bwidth \U0001f525 caf\u00e9 \u4e2d"
    resp = _create(client, ncr_project, {**VALID_NCR, "comment": text})
    assert resp.status_code == 201, resp.text
    assert resp.json()["comment"] == text


@pytest.mark.xfail(
    reason="FastAPI's default validation handler echoes the undecodable input "
    "and fails to encode it; app-wide, not NCR-specific (known limitation).",
    strict=True,
)
def test_lone_surrogate_is_rejected_not_500(client, ncr_project):
    body = json.dumps({**VALID_NCR, "comment": "x"}).replace('"x"', '"\\ud800"')
    resp = client.post(
        _ncrs_url(ncr_project),
        content=body,
        headers={**ncr_project["inspector"], "Content-Type": "application/json"},
    )
    assert resp.status_code == 422, resp.status_code


def test_unicode_codes_case_insensitive_and_whitespace(client, ncr_project):
    resp = _set_ncr_config(
        client,
        ncr_project,
        {
            "failure_codes": [
                {"code": "\u00c9CART-\U0001f525", "description": "Unicode"}
            ],
            "disposition_codes": [{"code": "STRASSE", "description": "German"}],
        },
    )
    assert resp.status_code == 200, resp.text
    created = _create(
        client,
        ncr_project,
        {
            **VALID_NCR,
            "failure_code": "  \u00e9cart-\U0001f525 ",
            "disposition_code": "stra\u00dfe",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["failure_code"] == "\u00c9CART-\U0001f525"
    assert created.json()["disposition_code"] == "STRASSE"


def test_code_from_other_list_is_rejected(client, ncr_project):
    # "UAI" is a disposition code, not a failure code.
    resp = _create(client, ncr_project, {**VALID_NCR, "failure_code": "UAI"})
    assert resp.status_code == 422
    resp = _create(client, ncr_project, {**VALID_NCR, "disposition_code": "FC-01"})
    assert resp.status_code == 422


def test_code_over_64_chars_rejected(client, ncr_project):
    resp = _create(client, ncr_project, {**VALID_NCR, "failure_code": "F" * 65})
    assert resp.status_code == 422


def test_whitespace_only_edit_is_noop_and_keeps_approval(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = _url(ncr_project, ncr["id"])
    client.post(f"{url}/approve", json={}, headers=ncr_project["approver"])
    resp = client.patch(
        url,
        json={
            "comment": f"  {VALID_NCR['comment']}  ",
            "failure_code": " fc-01 ",
            "disposition_code": "rwk",
            "disposition_instructions": f"\n{VALID_NCR['disposition_instructions']}\t",
            "expected_version": 2,
        },
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["version"] == 2
    assert [h["action"] for h in body["history"]] == ["created", "approved"]


# ---------------------------------------------------------------------------
# Configuration abuse
# ---------------------------------------------------------------------------


def test_config_ncr_codes_reject_control_characters(client, ncr_project):
    """NUL in a code/description is stored and later copied into NCR rows;
    PostgreSQL text/varchar columns cannot store NUL (500 at NCR create)."""
    for bad in (
        {"failure_codes": [{"code": "FC\x00X"}], "disposition_codes": []},
        {
            "failure_codes": [{"code": "FC-X", "description": "Bad\x00desc"}],
            "disposition_codes": [],
        },
        {"failure_codes": [{"code": "FC\x1bX"}], "disposition_codes": []},
    ):
        resp = _set_ncr_config(client, ncr_project, bad)
        assert resp.status_code == 422, (bad, resp.status_code)


def test_config_list_limits(client, ncr_project):
    many = [{"code": f"C{i}"} for i in range(501)]
    assert (
        _set_ncr_config(
            client, ncr_project, {"failure_codes": many, "disposition_codes": []}
        ).status_code
        == 422
    )
    assert (
        _set_ncr_config(
            client,
            ncr_project,
            {"failure_codes": many[:500], "disposition_codes": many[:500]},
        ).status_code
        == 200
    )


def test_config_codes_differing_by_case_or_whitespace_rejected(client, ncr_project):
    for bad in (
        [{"code": "ABC"}, {"code": "abc"}],
        [{"code": "ABC"}, {"code": " ABC "}],
        [{"code": "STRASSE"}, {"code": "stra\u00dfe"}],
    ):
        resp = _set_ncr_config(
            client, ncr_project, {"failure_codes": bad, "disposition_codes": []}
        )
        assert resp.status_code == 422, bad


def test_same_code_in_both_lists_is_allowed_and_resolves_per_list(client, ncr_project):
    resp = _set_ncr_config(
        client,
        ncr_project,
        {
            "failure_codes": [{"code": "X1", "description": "failure"}],
            "disposition_codes": [{"code": "X1", "description": "disposition"}],
        },
    )
    assert resp.status_code == 200
    body = _create(
        client,
        ncr_project,
        {**VALID_NCR, "failure_code": "X1", "disposition_code": "X1"},
    ).json()
    assert body["failure_code_description"] == "failure"
    assert body["disposition_code_description"] == "disposition"


def test_ui_sections_limits(client, ncr_project):
    config = _get_config(client, ncr_project)
    config["ui_sections"] = {f"s.{i}": True for i in range(501)}
    assert _put_config(client, ncr_project, config).status_code == 422
    config["ui_sections"] = {f"s.{i}": False for i in range(500)}
    assert _put_config(client, ncr_project, config).status_code == 200
    for bad in ({"x": "true"}, {"x": 1}, {"x": None}, {"": True}, {"k" * 129: True}):
        config["ui_sections"] = bad
        assert _put_config(client, ncr_project, config).status_code == 422, bad


def test_ui_sections_persist(client, ncr_project):
    config = _get_config(client, ncr_project)
    config["ui_sections"] = {"inspection.ncrs": False}
    assert _put_config(client, ncr_project, config).status_code == 200
    assert _get_config(client, ncr_project)["ui_sections"] == {"inspection.ncrs": False}


def test_legacy_config_without_ncr_configuration_create_is_422(client, ncr_project):
    config = _get_config(client, ncr_project)
    config.pop("ncr_configuration")
    config.pop("ui_sections", None)
    _put_raw_config(client, ncr_project, config)
    resp = _create(client, ncr_project)
    assert resp.status_code == 422, resp.text


def test_legacy_config_get_backfills_ncr_configuration(client, ncr_project):
    """GET /configuration has no response_model, so a legacy stored config is
    returned without ncr_configuration / ui_sections defaults."""
    config = _get_config(client, ncr_project)
    config.pop("ncr_configuration")
    _put_raw_config(client, ncr_project, config)
    assert _get_config(client, ncr_project).get("ncr_configuration") == {
        "failure_codes": [],
        "disposition_codes": [],
    }


@pytest.mark.parametrize(
    "junk",
    [
        "junk",
        ["a", "b"],
        {"failure_codes": "FC-01", "disposition_codes": None},
        {
            "failure_codes": [None, 5, {"code": 7}, {"nocode": 1}],
            "disposition_codes": [[]],
        },
    ],
)
def test_malformed_stored_ncr_configuration_create_is_422(client, ncr_project, junk):
    config = _get_config(client, ncr_project)
    config["ncr_configuration"] = junk
    _put_raw_config(client, ncr_project, config)
    resp = _create(client, ncr_project)
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize(
    "junk",
    [
        "junk",
        {"failure_codes": "FC-01", "disposition_codes": None},
        {"failure_codes": [{"code": 7}], "disposition_codes": []},
    ],
)
def test_malformed_stored_ncr_configuration_get_config_is_not_500(
    client, ncr_project, junk
):
    """ncr_configuration is now a typed field on the response model, so
    malformed stored data makes GET /configuration fail response validation."""
    config = _get_config(client, ncr_project)
    config["ncr_configuration"] = junk
    _put_raw_config(client, ncr_project, config)
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/configuration",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200, resp.status_code


def test_malformed_stored_ui_sections_get_config_is_not_500(client, ncr_project):
    config = _get_config(client, ncr_project)
    config["ui_sections"] = {"inspection.ncrs": "false"}
    _put_raw_config(client, ncr_project, config)
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/configuration",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200, resp.status_code


def test_clone_from_project_with_malformed_ncr_config_is_not_500(client, ncr_project):
    config = _get_config(client, ncr_project)
    config["ncr_configuration"] = {"failure_codes": "junk"}
    _put_raw_config(client, ncr_project, config)
    target = client.post(
        "/api/projects/",
        json={
            "name": "Clone target",
            "description": "x",
            "meta_group_id": ncr_project["group"],
            "project_type": "PT2",
        },
        headers=ncr_project["inspector"],
    ).json()["id"]
    resp = client.post(
        f"/api/projects/{target}/configuration/clone",
        json={"source_project_id": ncr_project["project_id"]},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code < 500, resp.status_code


def test_stored_oversized_code_description_is_not_copied_beyond_column(
    client, ncr_project
):
    """failure_code_description is String(255); a raw-stored longer description
    is copied verbatim (DataError/500 on PostgreSQL)."""
    config = _get_config(client, ncr_project)
    config["ncr_configuration"] = {
        "failure_codes": [{"code": "FC-01", "description": "d" * 400}],
        "disposition_codes": [{"code": "RWK", "description": {"nested": "obj"}}],
    }
    _put_raw_config(client, ncr_project, config)
    resp = _create(client, ncr_project)
    assert resp.status_code in (201, 422), resp.status_code
    if resp.status_code == 201:
        assert len(resp.json()["failure_code_description"]) <= 255


def test_stored_code_with_nul_cannot_reach_ncr_row(client, ncr_project):
    config = _get_config(client, ncr_project)
    config["ncr_configuration"] = {
        "failure_codes": [{"code": "FC-01", "description": "Poro\x00sity"}],
        "disposition_codes": [{"code": "RWK"}],
    }
    _put_raw_config(client, ncr_project, config)
    resp = _create(client, ncr_project)
    if resp.status_code == 201:
        assert "\x00" not in resp.json()["failure_code_description"]


# ---------------------------------------------------------------------------
# Scoping / auth
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/projects/not-a-uuid/ncrs",
        "/api/projects/{pid}/parts/not-a-uuid/ncrs",
        "/api/projects/{pid}/parts/{part}/ncrs/not-a-uuid",
        "/api/projects/{pid}/parts/{part}/ncrs/1%27%20OR%201%3D1",
    ],
)
def test_invalid_uuid_paths_are_422(client, ncr_project, path):
    url = path.format(pid=ncr_project["project_id"], part=ncr_project["part_id"])
    resp = client.get(url, headers=ncr_project["inspector"])
    assert resp.status_code == 422, (url, resp.status_code)


def test_part_from_other_project_cannot_be_used(client, ncr_project):
    other = client.post(
        "/api/projects/",
        json={
            "name": "O",
            "description": "x",
            "meta_group_id": ncr_project["group"],
            "project_type": "PT2",
        },
        headers=ncr_project["inspector"],
    ).json()["id"]
    other_part = client.post(
        f"/api/projects/{other}/parts",
        json={"serial_number": "OTHER"},
        headers=ncr_project["inspector"],
    ).json()["id"]
    resp = client.post(
        _ncrs_url(ncr_project, part_id=other_part),
        json=VALID_NCR,
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 404
    resp = client.get(
        _ncrs_url(ncr_project, part_id=other_part), headers=ncr_project["inspector"]
    )
    assert resp.status_code == 404


def test_project_list_excludes_deleted_by_default(client, ncr_project):
    first = _create(client, ncr_project).json()
    _create(client, ncr_project)
    client.delete(_url(ncr_project, first["id"]), headers=ncr_project["inspector"])
    rows = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs",
        headers=ncr_project["inspector"],
    ).json()["ncrs"]
    assert [r["ncr_label"] for r in rows] == ["NCR-0002"]
    assert all(r["deleted_at"] is None for r in rows)
    for value in ("false", "0", "no"):
        rows = client.get(
            f"/api/projects/{ncr_project['project_id']}/ncrs?include_deleted={value}",
            headers=ncr_project["inspector"],
        ).json()["ncrs"]
        assert len(rows) == 1


def test_include_deleted_requires_project_access(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    client.delete(_url(ncr_project, ncr["id"]), headers=ncr_project["inspector"])
    outsider = _headers("outsider@example.com", "other")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        resp = client.get(
            f"/api/projects/{ncr_project['project_id']}/ncrs?include_deleted=true",
            headers=outsider,
        )
    assert resp.status_code == 403
    assert "comment" not in resp.text.lower() or VALID_NCR["comment"] not in resp.text


def test_include_deleted_invalid_bool_is_422(client, ncr_project):
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs?include_deleted=maybe",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 422


def test_outsider_cannot_read_reports_with_ncrs(client, ncr_project):
    _create(client, ncr_project)
    outsider = _headers("outsider@example.com", "other")
    with patch("utils.dependencies.is_user_in_group", return_value=False):
        for path in (
            "report-json",
            "report-pdf",
            "export-bundle-json",
            "export-bundle",
        ):
            resp = client.get(
                f"/api/projects/{ncr_project['project_id']}/{path}", headers=outsider
            )
            assert resp.status_code in (403, 404), (path, resp.status_code)
            assert VALID_NCR["comment"] not in resp.text


def test_archived_project_lists_and_project_list_still_work(client, ncr_project):
    _create(client, ncr_project)
    client.patch(
        f"/api/projects/{ncr_project['project_id']}/archive",
        headers=ncr_project["inspector"],
    )
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs?include_deleted=true",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200
    assert len(resp.json()["ncrs"]) == 1


def test_history_has_no_mutation_endpoints(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = _url(ncr_project, ncr["id"])
    hist_id = ncr["history"][0]["id"]
    for method in ("put", "patch", "delete", "post"):
        for target in (f"{url}/history", f"{url}/history/{hist_id}"):
            kwargs = {"json": {"actor": "forged"}} if method != "delete" else {}
            resp = getattr(client, method)(
                target, headers=ncr_project["inspector"], **kwargs
            )
            assert resp.status_code in (404, 405), (method, target, resp.status_code)
    # PUT on the NCR itself is not an edit path.
    resp = client.put(url, json=VALID_NCR, headers=ncr_project["inspector"])
    assert resp.status_code == 405
    detail = client.get(url, headers=ncr_project["inspector"]).json()
    assert detail["history"][0]["actor"] == ncr_project["inspector"]["X-User-Email"]


def test_history_versions_are_contiguous_after_many_ops(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = _url(ncr_project, ncr["id"])
    h = ncr_project["inspector"]
    for i in range(5):
        client.patch(url, json={"comment": f"c{i}"}, headers=h)
        client.patch(url, json={"comment": f"c{i}"}, headers=h)  # no-op
    client.post(f"{url}/approve", json={}, headers=h)
    client.patch(url, json={"comment": "after"}, headers=h)
    detail = client.get(url, headers=h).json()
    versions = [e["version"] for e in detail["history"]]
    assert versions == list(range(1, detail["version"] + 1))


def test_stale_concurrent_writers(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    url = _url(ncr_project, ncr["id"])
    a = client.patch(
        url,
        json={"comment": "A", "expected_version": 1},
        headers=ncr_project["inspector"],
    )
    b = client.post(
        f"{url}/approve", json={"expected_version": 1}, headers=ncr_project["approver"]
    )
    c = client.delete(f"{url}?expected_version=1", headers=ncr_project["approver"])
    assert a.status_code == 200
    assert b.status_code == 409
    assert c.status_code == 409
    detail = client.get(url, headers=ncr_project["inspector"]).json()
    assert detail["comment"] == "A" and detail["status"] == "open"


# ---------------------------------------------------------------------------
# Part deletion
# ---------------------------------------------------------------------------


def test_deleted_part_keeps_ncr_in_reports(client, ncr_project):
    _create(client, ncr_project)
    resp = client.delete(
        f"/api/projects/{ncr_project['project_id']}/parts/{ncr_project['part_id']}",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 204, resp.text
    rows = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs",
        headers=ncr_project["inspector"],
    ).json()["ncrs"]
    assert len(rows) == 1
    assert rows[0]["part_serial_number"] == "SN-0001"
    report = client.get(
        f"/api/projects/{ncr_project['project_id']}/report-json",
        headers=ncr_project["inspector"],
    )
    assert report.status_code == 200
    assert report.json()["ncrs"][0]["part_identifier"] == "SN-0001"
    pdf = client.get(
        f"/api/projects/{ncr_project['project_id']}/report-pdf",
        headers=ncr_project["inspector"],
    )
    assert pdf.status_code == 200
    bundle = client.get(
        f"/api/projects/{ncr_project['project_id']}/export-bundle",
        headers=ncr_project["inspector"],
    )
    assert bundle.status_code == 200


def test_deleted_part_nulls_ncr_part_id(client, ncr_project):
    """The model promises part_id is nulled when the part is deleted. The part
    delete path explicitly notes some supported DBs do not enforce FKs, and it
    does not null NCR.part_id itself, so part_id dangles on those DBs."""
    _create(client, ncr_project)
    client.delete(
        f"/api/projects/{ncr_project['project_id']}/parts/{ncr_project['part_id']}",
        headers=ncr_project["inspector"],
    )
    rows = client.get(
        f"/api/projects/{ncr_project['project_id']}/ncrs",
        headers=ncr_project["inspector"],
    ).json()["ncrs"]
    assert rows[0]["part_id"] is None, rows[0]["part_id"]


def test_new_part_cannot_inherit_deleted_parts_ncrs(client, ncr_project):
    _create(client, ncr_project)
    client.delete(
        f"/api/projects/{ncr_project['project_id']}/parts/{ncr_project['part_id']}",
        headers=ncr_project["inspector"],
    )
    new_part = client.post(
        f"/api/projects/{ncr_project['project_id']}/parts",
        json={"serial_number": "SN-0001"},
        headers=ncr_project["inspector"],
    ).json()["id"]
    resp = client.get(
        _ncrs_url(ncr_project, part_id=new_part), headers=ncr_project["inspector"]
    )
    assert resp.status_code == 200
    assert resp.json()["ncrs"] == []


# ---------------------------------------------------------------------------
# Exports: PDF / TOML / JSON
# ---------------------------------------------------------------------------

NASTY = "Paren ( ) \\ backslash ) ( \"quoted\" 'single' ]] [[ncrs]]\nline2\r\nline3\ttab = x # hash \U0001f525 \u202eRTL"


def _nasty_ncr(client, ctx):
    resp = _create(
        client,
        ctx,
        {
            **VALID_NCR,
            "comment": NASTY,
            "disposition_instructions": 'a"""b\'\'\'c\n[ncrs]\nk = "v"',
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_pdf_with_special_characters_is_well_formed(client, ncr_project):
    _nasty_ncr(client, ncr_project)
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/report-pdf",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200
    pdf = resp.content
    # Every "(...) Tj" line must have balanced, escaped parentheses.
    for stream in re.findall(rb"stream\n(.*?)\nendstream", pdf, flags=re.DOTALL):
        for line in stream.split(b"\n"):
            if line.endswith(b") Tj"):
                body = line[1:-4]
                unescaped = re.sub(rb"\\.", b"", body)
                assert b"(" not in unescaped and b")" not in unescaped, line
    text = "\n".join(_pdf_lines(pdf))
    assert "Paren ( ) \\ backslash" in text
    assert "\r" not in text


def test_pdf_total_ncrs_counts_only_rendered_rows():
    pdf = build_simple_report_pdf(_payload(["bad", None, 7, _ncr_row(1)]))
    text = "\n".join(_pdf_lines(pdf))
    assert "Total NCRs: 1" in text, [l for l in text.splitlines() if "Total NCRs" in l]


def test_pdf_lines_fit_width_with_long_unbroken_fields():
    row = _ncr_row(
        1,
        part_identifier="S" * 255,
        failure_code="F" * 64,
        failure_code_description="D" * 255,
        comment="\U0001f525" * 300,
        created_by="u" * 255 + "@example.com",
    )
    pdf = build_simple_report_pdf(_payload([row]))
    lines = _pdf_lines(pdf)
    assert all(len(line) <= 84 for line in lines), max(len(l) for l in lines)


def _bundle_toml(client, ctx):
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle?include_images=false",
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    return archive.read("ncrs.toml").decode("utf-8"), archive


def test_ncrs_toml_round_trips_special_characters(client, ncr_project):
    ncr = _nasty_ncr(client, ncr_project)
    raw, _ = _bundle_toml(client, ncr_project)
    parsed = tomllib.loads(raw)
    assert len(parsed["ncrs"]) == 1
    row = parsed["ncrs"][0]
    assert row["comment"] == NASTY
    assert row["disposition_instructions"] == ncr["disposition_instructions"]
    assert row["ncr_label"] == "NCR-0001"


def test_ncrs_toml_parses_without_emoji(client, ncr_project):
    _create(
        client,
        ncr_project,
        {**VALID_NCR, "comment": 'quote " ]] [[ncrs]]\nnew line \\ back caf\u00e9'},
    )
    raw, _ = _bundle_toml(client, ncr_project)
    parsed = tomllib.loads(raw)
    assert (
        parsed["ncrs"][0]["comment"]
        == 'quote " ]] [[ncrs]]\nnew line \\ back caf\u00e9'
    )


@pytest.mark.xfail(
    reason="Shared TOML export renders None as an empty string for every "
    "sidecar; project-backup.json keeps real nulls (known limitation).",
    strict=True,
)
def test_ncrs_toml_preserves_nulls_and_history(client, ncr_project):
    ncr = _create(client, ncr_project).json()
    raw, _ = _bundle_toml(client, ncr_project)
    row = tomllib.loads(raw)["ncrs"][0]
    # approved_by is null for an open NCR; TOML has no null, but an empty
    # string is indistinguishable from a real empty value.
    assert "approved_by" not in row or row["approved_by"] != ""
    history = row["history"]
    if isinstance(history, str):
        history = json.loads(history)
    assert [h["action"] for h in history] == ["created"]
    assert history[0]["changes"]["comment"]["to"] == ncr["comment"]


def test_backup_json_round_trips_special_characters(client, ncr_project):
    _nasty_ncr(client, ncr_project)
    _, archive = _bundle_toml(client, ncr_project)
    path = next(n for n in archive.namelist() if n.endswith("project-backup.json"))
    backup = json.loads(archive.read(path))
    assert backup["ncrs"][0]["comment"] == NASTY


def test_export_bundle_json_with_special_characters(client, ncr_project):
    _nasty_ncr(client, ncr_project)
    resp = client.get(
        f"/api/projects/{ncr_project['project_id']}/export-bundle-json",
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200
    records = resp.json()["bundle_summary"]["ncrs"]["records"]
    assert records[0]["comment"] == NASTY


def test_backup_restore_as_new_restores_ncrs(client, ncr_project):
    """Backups include every NCR with history; restoring should not drop them."""
    ncr = _create(client, ncr_project).json()
    client.post(
        f"{_url(ncr_project, ncr['id'])}/approve",
        json={},
        headers=ncr_project["approver"],
    )
    export = client.get(
        f"/api/projects/{ncr_project['project_id']}/export-bundle?include_images=false",
        headers=ncr_project["inspector"],
    )
    assert export.status_code == 200
    resp = client.post(
        "/api/projects/import",
        files={"file": ("p.vistabundle", export.content, "application/zip")},
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
        headers=ncr_project["inspector"],
    )
    assert resp.status_code == 200, resp.text
    new_id = resp.json()["projects_created"][0]["new_project_id"]
    rows = client.get(
        f"/api/projects/{new_id}/ncrs?include_deleted=true",
        headers=ncr_project["inspector"],
    )
    assert rows.status_code == 200
    assert len(rows.json()["ncrs"]) == 1, rows.json()


def test_ncr_numbering_continues_after_many_and_label_beyond_9999(client, ncr_project):
    from core import models  # noqa: F401

    labels = [_create(client, ncr_project).json()["ncr_label"] for _ in range(3)]
    assert labels == ["NCR-0001", "NCR-0002", "NCR-0003"]
    from services.inspection.ncrs import format_ncr_label

    assert format_ncr_label(12345) == "NCR-12345"
