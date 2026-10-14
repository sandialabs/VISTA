"""Error paths of the project and dashboard backup import endpoints."""

import io
import json
import zipfile

import pytest

from services.export import bundles as export_bundle_service


def _create_project(client, name, group="backup-import-errors"):
    resp = client.post("/api/projects/", json={"name": name, "meta_group_id": group})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _zip_upload(content=b"not a zip"):
    return {"file": ("backup.zip", content, "application/zip")}


@pytest.mark.parametrize(
    ("data", "detail"),
    [
        (
            {"mode": "append_active", "confirmation": "IMPORT"},
            "Only restore_as_new import mode is supported by this endpoint",
        ),
        (
            {"mode": "restore_as_new", "confirmation": "nope"},
            "Type IMPORT to confirm import",
        ),
    ],
)
@pytest.mark.parametrize("path", ["/api/projects/import", "/api/dashboard/import"])
def test_restore_as_new_rejects_mode_and_confirmation(client, path, data, detail):
    resp = client.post(path, files=_zip_upload(), data=data)
    assert resp.status_code == 400
    assert resp.json()["detail"] == detail


def test_restore_as_new_rejects_invalid_zip(client):
    resp = client.post(
        "/api/projects/import",
        files=_zip_upload(),
        data={"mode": "restore_as_new", "confirmation": "IMPORT"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Backup file is not a valid ZIP archive"
    assert "error_context" in resp.json()


@pytest.mark.parametrize(
    ("data", "detail"),
    [
        (
            {"mode": "restore_as_new", "confirmation": "IMPORT"},
            "Choose append_active or overwrite_active import mode",
        ),
        (
            {"mode": "append_active", "confirmation": ""},
            "Type IMPORT to confirm import",
        ),
        (
            {"mode": "overwrite_active", "confirmation": "IMPORT"},
            "Backup file is not a valid ZIP archive",
        ),
    ],
)
def test_active_project_import_rejects_bad_requests(client, data, detail):
    project_id = _create_project(client, "Active Import Target")
    resp = client.post(
        f"/api/projects/{project_id}/import", files=_zip_upload(), data=data
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == detail


def test_active_project_import_requires_single_project_bundle(client):
    project_id = _create_project(client, "Single Bundle Target")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {"format": "vista-dashboard-backup", "version": 1, "projects": []}
            ),
        )
        for source_id in ("source-a", "source-b"):
            archive.writestr(f"projects/{source_id}/project-backup.json", "{}")
    resp = client.post(
        f"/api/projects/{project_id}/import",
        files=_zip_upload(buffer.getvalue()),
        data={"mode": "append_active", "confirmation": "IMPORT"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == (
        "Importing into the active project requires a bundle with exactly one project"
    )


@pytest.mark.parametrize(
    "path", ["/api/projects/import/preview", "/api/dashboard/import/preview"]
)
def test_import_preview_rejects_invalid_zip(client, path):
    resp = client.post(path, files=_zip_upload())
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Backup file is not a valid ZIP archive"


def test_project_bundle_payload_is_json_native():
    payload = export_bundle_service.build_project_bundle_payload(
        project={
            "id": "4f5c1d64-0000-4000-8000-000000000001",
            "name": "Bundle",
            "project_type": "PT2",
            "meta_group_id": "group",
        },
        total_images=2,
        total_image_bytes=1024,
        part_metadata_rows=[
            (
                "4f5c1d64-0000-4000-8000-000000000002",
                "SN-1",
                "Part 1",
                {
                    "annotations": [{"id": "a1", "label": "crack"}],
                    "overlay_layers": ["layer-1"],
                    "segmentation_runs": [{"run_id": "s1"}],
                    "measurement_runs": [{"run_id": "m1"}, "dropped"],
                },
            )
        ],
    )
    assert json.loads(json.dumps(payload)) == payload
