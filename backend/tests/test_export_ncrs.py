"""NCRs in the project report (JSON and PDF) and the export bundle."""

import io
import json
import re
import zipfile

import pytest

from services.export.report_pdf import build_simple_report_pdf
from tests.test_inspection_ncrs import VALID_NCR, _create, _ncrs_url, ncr_project  # noqa: F401


def _pdf_lines(pdf_bytes: bytes) -> list[str]:
    lines = []
    for stream in re.findall(rb"stream\n(.*?)\nendstream", pdf_bytes, flags=re.DOTALL):
        for encoded in re.findall(rb"^\((.*)\) Tj$", stream, flags=re.MULTILINE):
            lines.append(
                encoded.replace(rb"\(", b"(")
                .replace(rb"\)", b")")
                .replace(b"\\\\", b"\\")
                .decode("latin-1")
            )
    return lines


def _pdf_page_count(pdf_bytes: bytes) -> int:
    return int(re.search(rb"/Count (\d+)", pdf_bytes).group(1))


@pytest.fixture
def project_with_ncrs(client, ncr_project):  # noqa: F811
    """Two live NCRs (one approved) and one deleted NCR."""
    first = _create(client, ncr_project).json()
    client.post(
        f"{_ncrs_url(ncr_project)}/{first['id']}/approve",
        json={},
        headers=ncr_project["approver"],
    )
    _create(
        client,
        ncr_project,
        {**VALID_NCR, "failure_code": "FC-02", "comment": "Crack near bore"},
    )
    deleted = _create(client, ncr_project).json()
    client.delete(
        f"{_ncrs_url(ncr_project)}/{deleted['id']}", headers=ncr_project["inspector"]
    )
    return ncr_project


def test_report_json_lists_live_ncrs_in_number_order(client, project_with_ncrs):
    ctx = project_with_ncrs
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/report-json", headers=ctx["inspector"]
    )
    assert resp.status_code == 200, resp.text
    ncrs = resp.json()["ncrs"]
    assert [row["ncr_label"] for row in ncrs] == ["NCR-0001", "NCR-0002"]
    first = ncrs[0]
    assert first["part_identifier"] == "SN-0001"
    assert first["status"] == "approved"
    assert first["approved_by"] == ctx["approver"]["X-User-Email"]
    assert first["failure_code"] == "FC-01"
    assert first["failure_code_description"] == "Porosity"
    assert first["disposition_code"] == "RWK"
    assert first["comment"] == VALID_NCR["comment"]
    assert first["disposition_instructions"] == VALID_NCR["disposition_instructions"]
    assert first["created_by"] == ctx["inspector"]["X-User-Email"]
    assert ncrs[1]["status"] == "open"
    assert ncrs[1]["approved_by"] is None
    assert "history" not in first


def test_report_pdf_includes_ncr_section(client, project_with_ncrs):
    ctx = project_with_ncrs
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/report-pdf", headers=ctx["inspector"]
    )
    assert resp.status_code == 200, resp.text
    lines = _pdf_lines(resp.content)
    text = "\n".join(lines)
    assert "VISTA Inspection Report - Nonconformance Reports" in text
    assert "Total NCRs: 2" in text
    assert "NCR-0001 | Serial: SN-0001 | Status: Approved" in text
    assert "NCR-0002 | Serial: SN-0001 | Status: Open" in text
    assert "  Failure code: FC-01 - Porosity" in text
    assert "  Comment: Crack near bore" in text
    assert "NCR-0003" not in text
    assert _pdf_page_count(resp.content) == 2
    assert "Page 2 of 2" in text
    assert all(len(line) <= 84 for line in lines)
    assert sum(line.startswith("Part ") for line in lines) == 1


def _payload(ncrs):
    return {
        "schema_version": 3,
        "project": {"id": "p", "name": "PDF NCR", "project_type": "PT1"},
        "summary": {"total_parts": 0, "reviewed_parts": 0, "unreviewed_parts": 0},
        "parts": [],
        "ncrs": ncrs,
    }


def _ncr_row(index, **overrides):
    return {
        "ncr_label": f"NCR-{index:04d}",
        "part_identifier": "SN",
        "status": "open",
        "failure_code": "FC",
        "failure_code_description": "",
        "disposition_code": "DC",
        "disposition_code_description": "",
        "comment": "c",
        "disposition_instructions": "i",
        "created_by": "u@example.com",
        "created_at": "2026-11-13T00:00:00",
        **overrides,
    }


def test_report_pdf_without_ncrs_has_no_ncr_page():
    pdf = build_simple_report_pdf(_payload([]))
    assert _pdf_page_count(pdf) == 1
    assert "Nonconformance" not in "\n".join(_pdf_lines(pdf))
    legacy = build_simple_report_pdf({**_payload([]), "ncrs": None})
    assert _pdf_page_count(legacy) == 1


def test_report_pdf_wraps_escapes_and_paginates_long_ncrs():
    long_comment = "Paren (test) and backslash \\ and caf\u00e9 \u4e2d " + "word " * 300
    rows = [_ncr_row(1, comment=long_comment)] + [_ncr_row(i) for i in range(2, 30)]
    pdf = build_simple_report_pdf(_payload(rows))
    lines = _pdf_lines(pdf)
    assert all(len(line) <= 84 for line in lines)
    assert _pdf_page_count(pdf) > 2
    text = "\n".join(lines)
    assert "Paren (test) and backslash \\ and caf\u00e9 \\u4e2d" in text
    assert "NCR-0029" in text
    page_count = _pdf_page_count(pdf)
    assert f"Page {page_count} of {page_count}" in text


def test_report_pdf_ignores_malformed_ncr_rows():
    pdf = build_simple_report_pdf(_payload(["bad", None, _ncr_row(1)]))
    text = "\n".join(_pdf_lines(pdf))
    assert "NCR-0001" in text


def test_export_bundle_json_summarizes_live_ncrs(client, project_with_ncrs):
    ctx = project_with_ncrs
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle-json",
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    summary = resp.json()["bundle_summary"]["ncrs"]
    assert summary["total"] == 2
    assert summary["open"] == 1
    assert summary["approved"] == 1
    assert [row["ncr_label"] for row in summary["records"]] == ["NCR-0001", "NCR-0002"]


def test_export_bundle_archive_includes_ncrs_with_history(client, project_with_ncrs):
    ctx = project_with_ncrs
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle", headers=ctx["inspector"]
    )
    assert resp.status_code == 200, resp.text
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    names = archive.namelist()
    assert "ncrs.toml" in names
    ncrs_toml = archive.read("ncrs.toml").decode("utf-8")
    assert ncrs_toml.count("[[ncrs]]") == 3
    assert 'ncr_label = "NCR-0003"' in ncrs_toml
    assert "deleted = true" in ncrs_toml

    backup_path = next(name for name in names if name.endswith("project-backup.json"))
    backup = json.loads(archive.read(backup_path))
    records = backup["ncrs"]
    assert [record["ncr_label"] for record in records] == [
        "NCR-0001",
        "NCR-0002",
        "NCR-0003",
    ]
    assert [record["deleted"] for record in records] == [False, False, True]
    assert records[2]["deleted_by"] == ctx["inspector"]["X-User-Email"]
    assert [entry["action"] for entry in records[0]["history"]] == [
        "created",
        "approved",
    ]
    assert [entry["action"] for entry in records[2]["history"]] == [
        "created",
        "deleted",
    ]
    manifest = json.loads(archive.read("export-manifest.json"))
    assert manifest["bundle_summary"]["ncrs"]["total"] == 2


def test_export_bundle_omits_ncr_toml_without_metadata(client, project_with_ncrs):
    ctx = project_with_ncrs
    resp = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle?include_metadata=false",
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    assert "ncrs.toml" not in archive.namelist()


def test_project_without_ncrs_reports_empty_sections(client):
    headers = {"X-User-Email": "empty-ncr@example.com", "X-User-Groups": '["e"]'}
    project_id = client.post(
        "/api/projects/",
        json={
            "name": "No NCRs",
            "description": "x",
            "meta_group_id": "e",
            "project_type": "PT1",
        },
        headers=headers,
    ).json()["id"]
    report = client.get(f"/api/projects/{project_id}/report-json", headers=headers)
    assert report.json()["ncrs"] == []
    bundle = client.get(
        f"/api/projects/{project_id}/export-bundle-json", headers=headers
    )
    assert bundle.json()["bundle_summary"]["ncrs"] == {
        "total": 0,
        "open": 0,
        "approved": 0,
        "records": [],
    }


def test_backup_restore_preserves_ncr_numbers_status_history_and_part_links(
    client, project_with_ncrs
):
    ctx = project_with_ncrs
    export = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle?include_images=false",
        headers=ctx["inspector"],
    )
    assert export.status_code == 200
    preview = client.post(
        "/api/projects/import/preview",
        files={"file": ("p.vistabundle", export.content, "application/zip")},
        headers=ctx["inspector"],
    )
    if preview.status_code == 200:
        assert preview.json()["projects"][0]["ncrs"] == 3
    resp = client.post(
        "/api/projects/import",
        files={"file": ("p.vistabundle", export.content, "application/zip")},
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    created = resp.json()["projects_created"][0]
    assert created["ncrs_created"] == 3
    new_id = created["new_project_id"]
    rows = client.get(
        f"/api/projects/{new_id}/ncrs?include_deleted=true", headers=ctx["inspector"]
    ).json()["ncrs"]
    assert [row["ncr_label"] for row in rows] == ["NCR-0001", "NCR-0002", "NCR-0003"]
    assert [row["status"] for row in rows] == ["approved", "open", "open"]
    assert rows[0]["approved_by"] == ctx["approver"]["X-User-Email"]
    assert rows[2]["deleted_at"] is not None
    new_parts = client.get(
        f"/api/projects/{new_id}/parts", headers=ctx["inspector"]
    ).json()
    new_part_id = next(p["id"] for p in new_parts if p["serial_number"] == "SN-0001")
    assert rows[0]["part_id"] == new_part_id
    detail = client.get(
        f"/api/projects/{new_id}/parts/{new_part_id}/ncrs/{rows[0]['id']}",
        headers=ctx["inspector"],
    ).json()
    assert [h["action"] for h in detail["history"]] == ["created", "approved"]
    # Numbering continues after the restored NCRs.
    config = client.get(
        f"/api/projects/{new_id}/configuration", headers=ctx["inspector"]
    ).json()["config"]
    assert config["ncr_configuration"]["failure_codes"]
    next_ncr = client.post(
        f"/api/projects/{new_id}/parts/{new_part_id}/ncrs",
        json=VALID_NCR,
        headers=ctx["inspector"],
    )
    assert next_ncr.status_code == 201, next_ncr.text
    assert next_ncr.json()["ncr_label"] == "NCR-0004"


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, existing_max=None):
        self.added = []
        self._existing_max = existing_max

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, _statement):
        return _FakeResult(self._existing_max)


_GOOD_RECORD = {
    "ncr_number": 1,
    "comment": "c",
    "failure_code": "FC",
    "disposition_code": "DC",
    "disposition_instructions": "i",
    "status": "approved",
    "approved_by": "a@example.com",
}
_AT = "2026-01-01T00:00:00+00:00"


@pytest.mark.asyncio
async def test_restore_skips_malformed_ncr_records():
    import uuid

    from services.export.ncr_import import restore_project_ncrs

    good = {
        **_GOOD_RECORD,
        "history": [
            {"version": 1, "action": "created", "actor": "x", "at": _AT, "changes": {}},
            {"version": 1, "action": "created", "actor": "d", "at": _AT, "changes": {}},
            {"version": 2, "action": "hacked", "actor": "x", "at": _AT, "changes": {}},
            "junk",
        ],
    }
    records = [
        good,
        {**good, "ncr_number": 1},  # duplicate number
        {**good, "ncr_number": 2, "comment": "bad\x00"},
        {**good, "ncr_number": 3, "failure_code": "x" * 65},
        {**good, "ncr_number": True},
        {**good, "ncr_number": 4, "comment": "   "},
        "junk",
        None,
    ]
    session = _FakeSession()
    count = await restore_project_ncrs(
        session, project_id=uuid.uuid4(), records=records, part_map={}
    )
    assert count == 1
    ncrs = [o for o in session.added if o.__class__.__name__ == "InspectionNcr"]
    history = [
        o for o in session.added if o.__class__.__name__ == "InspectionNcrHistory"
    ]
    assert len(ncrs) == 1 and ncrs[0].approved_by == "a@example.com"
    assert ncrs[0].ncr_number == 1
    assert [h.action for h in history] == ["created"]
    assert (
        await restore_project_ncrs(
            _FakeSession(), project_id=uuid.uuid4(), records="x", part_map={}
        )
        == 0
    )


@pytest.mark.asyncio
async def test_restore_into_project_with_ncrs_renumbers_after_existing():
    import uuid

    from services.export.ncr_import import restore_project_ncrs

    history = [
        {"version": 1, "action": "created", "actor": "x", "at": _AT, "changes": {}}
    ]
    session = _FakeSession(existing_max=5)
    count = await restore_project_ncrs(
        session,
        project_id=uuid.uuid4(),
        records=[
            {**_GOOD_RECORD, "ncr_number": 3, "history": history},
            {**_GOOD_RECORD, "ncr_number": 1, "history": history},
        ],
        part_map={},
    )
    assert count == 2
    ncrs = [o for o in session.added if o.__class__.__name__ == "InspectionNcr"]
    assert [n.ncr_number for n in ncrs] == [6, 7]
    created = [
        o for o in session.added if o.__class__.__name__ == "InspectionNcrHistory"
    ]
    assert created[0].changes["imported_from_ncr_number"] == {"from": 1, "to": 6}
    assert created[1].changes["imported_from_ncr_number"] == {"from": 3, "to": 7}


def test_append_import_into_project_with_ncrs_does_not_collide(
    client, project_with_ncrs
):
    ctx = project_with_ncrs
    export = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle?include_images=false",
        headers=ctx["inspector"],
    )
    assert export.status_code == 200
    resp = client.post(
        f"/api/projects/{ctx['project_id']}/import",
        files={"file": ("p.vistabundle", export.content, "application/zip")},
        data={"mode": "append_active", "confirmation": "IMPORT"},
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    rows = client.get(
        f"/api/projects/{ctx['project_id']}/ncrs?include_deleted=true",
        headers=ctx["inspector"],
    ).json()["ncrs"]
    assert [row["ncr_number"] for row in rows] == [1, 2, 3, 4, 5, 6]


def test_overwrite_import_replaces_ncrs_and_keeps_numbers(client, project_with_ncrs):
    ctx = project_with_ncrs
    export = client.get(
        f"/api/projects/{ctx['project_id']}/export-bundle?include_images=false",
        headers=ctx["inspector"],
    )
    _create(client, ctx)  # NCR-0004 exists only in the live project
    resp = client.post(
        f"/api/projects/{ctx['project_id']}/import",
        files={"file": ("p.vistabundle", export.content, "application/zip")},
        data={"mode": "overwrite_active", "confirmation": "IMPORT"},
        headers=ctx["inspector"],
    )
    assert resp.status_code == 200, resp.text
    rows = client.get(
        f"/api/projects/{ctx['project_id']}/ncrs?include_deleted=true",
        headers=ctx["inspector"],
    ).json()["ncrs"]
    assert [row["ncr_label"] for row in rows] == ["NCR-0001", "NCR-0002", "NCR-0003"]
