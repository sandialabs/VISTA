"""Tests for the Excel export endpoint."""
import io
import uuid
import json as _json
import pytest
from unittest.mock import patch

from routers.export import _build_workbook


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def _seed_project_with_images(client):
    """Create a project with images, classifications, and comments for export testing."""
    resp = client.post("/api/projects/", json={
        "name": "Export Test Project",
        "description": "Project for testing Excel export",
        "meta_group_id": "test-group",
    })
    assert resp.status_code == 201, resp.text
    project = resp.json()

    class_resp = client.post(f"/api/projects/{project['id']}/classes", json={
        "name": "Defect",
        "description": "Visual defect detected",
        "project_id": project["id"],
    })
    assert class_resp.status_code == 201, class_resp.text
    defect_class = class_resp.json()

    class_resp2 = client.post(f"/api/projects/{project['id']}/classes", json={
        "name": "Scratch",
        "description": "Surface scratch",
        "project_id": project["id"],
    })
    assert class_resp2.status_code == 201, class_resp2.text
    scratch_class = class_resp2.json()

    image_ids = []
    for i in range(3):
        metadata = {
            "lot_number": f"LOT-{100 + i}",
            "part_serial_number": f"SN-{2000 + i}",
            "inspection_status": ["Not Reviewed", "Pass", "Reject"][i],
            "inspector_name": f"Inspector {i + 1}",
            "secondary_inspector_name": f"Secondary {i + 1}" if i > 0 else "",
        }
        files = {"file": (f"test_image_{i}.png", b"fake-png-data", "image/png")}
        data = {"metadata": _json.dumps(metadata)}
        img_resp = client.post(
            f"/api/projects/{project['id']}/images",
            files=files,
            data=data,
        )
        assert img_resp.status_code == 201, img_resp.text
        image_ids.append(img_resp.json()["id"])

    for img_id in image_ids[:2]:
        cl_resp = client.post(f"/api/images/{img_id}/classifications", json={
            "image_id": img_id,
            "class_id": defect_class["id"],
        })
        assert cl_resp.status_code == 201, cl_resp.text

    cl_resp2 = client.post(f"/api/images/{image_ids[1]}/classifications", json={
        "image_id": image_ids[1],
        "class_id": scratch_class["id"],
    })
    assert cl_resp2.status_code == 201, cl_resp2.text

    for idx, img_id in enumerate(image_ids):
        cmt_resp = client.post(f"/api/images/{img_id}/comments", json={
            "image_id": img_id,
            "text": f"Test comment for image {idx}",
        })
        assert cmt_resp.status_code == 201, cmt_resp.text

    return {
        "project": project,
        "image_ids": image_ids,
        "classes": [defect_class, scratch_class],
    }


# ---------------------------------------------------------------------------
# Endpoint integration tests
# ---------------------------------------------------------------------------

def test_export_excel_returns_xlsx(client, _seed_project_with_images):
    """Verify the export endpoint returns a valid Excel file."""
    project = _seed_project_with_images["project"]
    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    assert ".xlsx" in resp.headers["content-disposition"]

    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(resp.content))
    ws = wb.active
    assert ws.title == "Image Data"

    # Verify the total and check all expected headers are present
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    assert headers[0] == "Filename"
    assert "lot_number" in headers
    assert "part_serial_number" in headers
    assert "inspection_status" in headers
    assert "inspector_name" in headers
    assert "secondary_inspector_name" in headers
    assert "Review Status" in headers
    assert "Reviewer" in headers
    assert "Review Date" in headers
    assert "Image Classes" in headers
    assert "Comment" in headers

    assert ws.max_row == 4  # 1 header + 3 data rows


def test_export_excel_data_content(client, _seed_project_with_images):
    """Verify the actual data content in the exported Excel file."""
    project = _seed_project_with_images["project"]
    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(resp.content))
    ws = wb.active

    # Build a header -> column index map for robust lookups
    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}

    # Row 2 = first image
    assert ws.cell(row=2, column=headers["Filename"]).value == "test_image_0.png"
    assert ws.cell(row=2, column=headers["lot_number"]).value == "LOT-100"
    assert ws.cell(row=2, column=headers["part_serial_number"]).value == "SN-2000"
    assert ws.cell(row=2, column=headers["inspection_status"]).value == "Not Reviewed"
    assert ws.cell(row=2, column=headers["inspector_name"]).value == "Inspector 1"

    # Row 3 = second image (has two classifications)
    assert ws.cell(row=3, column=headers["lot_number"]).value == "LOT-101"
    classes_val = ws.cell(row=3, column=headers["Image Classes"]).value
    assert "Defect" in classes_val
    assert "Scratch" in classes_val

    # Row 4 = third image (Reject status)
    assert ws.cell(row=4, column=headers["inspection_status"]).value == "Reject"


def test_export_excel_project_not_found(client):
    """Verify 404 for non-existent project."""
    fake_id = str(uuid.uuid4())
    resp = client.get(f"/api/projects/{fake_id}/export-excel")
    assert resp.status_code == 404


def test_export_excel_empty_project(client):
    """Verify export works for a project with no images."""
    resp = client.post("/api/projects/", json={
        "name": "Empty Project",
        "description": "No images",
        "meta_group_id": "test-group",
    })
    assert resp.status_code == 201
    project = resp.json()

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(resp.content))
    ws = wb.active
    assert ws.max_row == 1


def test_export_excel_comments_concatenated(client, _seed_project_with_images):
    """Verify multiple comments on a single image are pipe-separated."""
    project = _seed_project_with_images["project"]
    img_id = _seed_project_with_images["image_ids"][0]

    # Add a second comment to the first image
    cmt_resp = client.post(f"/api/images/{img_id}/comments", json={
        "image_id": img_id,
        "text": "Second comment on image 0",
    })
    assert cmt_resp.status_code == 201

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active

    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}
    comment_cell = ws.cell(row=2, column=headers["Comment"]).value
    assert "|" in comment_cell
    assert "Test comment for image 0" in comment_cell
    assert "Second comment on image 0" in comment_cell


def test_export_excel_deleted_images_excluded(client):
    """Verify that soft-deleted images are not included in the export."""
    resp = client.post("/api/projects/", json={
        "name": "Deletion Test",
        "description": "Test deleted images",
        "meta_group_id": "test-group",
    })
    project = resp.json()
    pid = project["id"]

    # Upload two images
    for i in range(2):
        files = {"file": (f"del_test_{i}.png", b"data", "image/png")}
        img_resp = client.post(f"/api/projects/{pid}/images", files=files)
        assert img_resp.status_code == 201

    # Soft-delete the first image via the correct endpoint
    images_resp = client.get(f"/api/projects/{pid}/images")
    images = images_resp.json()
    first_id = images[0]["id"]
    del_resp = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{first_id}",
        json={"reason": "test deletion"},
    )
    assert del_resp.status_code == 200, del_resp.text

    # Export should only contain the non-deleted image
    resp = client.get(f"/api/projects/{pid}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active
    assert ws.max_row == 2  # 1 header + 1 data row


def test_export_excel_no_metadata_defaults(client):
    """Verify images with no metadata export only fixed columns."""
    resp = client.post("/api/projects/", json={
        "name": "No Metadata",
        "description": "Images without metadata",
        "meta_group_id": "test-group",
    })
    project = resp.json()

    files = {"file": ("bare_image.png", b"data", "image/png")}
    client.post(f"/api/projects/{project['id']}/images", files=files)

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active

    # With no metadata, 8 columns: Filename, Review Status, Reviewer, Review Date,
    # Image Classes, Comment, Annotation Count, Annotations
    assert ws.max_column == 8
    headers = [ws.cell(row=1, column=c).value for c in range(1, 9)]
    assert headers[0] == "Filename"
    assert "Review Status" in headers
    assert "Reviewer" in headers
    assert "Review Date" in headers
    assert "Image Classes" in headers
    assert "Comment" in headers

    # Filename should be present
    assert ws.cell(row=2, column=1).value == "bare_image.png"


def test_export_excel_filename_sanitization(client):
    """Verify special characters in project name are sanitized in the filename."""
    resp = client.post("/api/projects/", json={
        "name": "Test/Project <with> special&chars!",
        "description": "Special chars test",
        "meta_group_id": "test-group",
    })
    project = resp.json()

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    disposition = resp.headers["content-disposition"]
    # Should not contain path separators or angle brackets
    assert "/" not in disposition.split("filename=")[1]
    assert "<" not in disposition.split("filename=")[1]
    assert ">" not in disposition.split("filename=")[1]
    assert ".xlsx" in disposition


def test_export_excel_image_no_classifications(client):
    """Verify images with no classifications have empty Image Classes column."""
    resp = client.post("/api/projects/", json={
        "name": "No Classes Assigned",
        "description": "Test",
        "meta_group_id": "test-group",
    })
    project = resp.json()

    files = {"file": ("unclassified.png", b"data", "image/png")}
    client.post(f"/api/projects/{project['id']}/images", files=files)

    resp = client.get(f"/api/projects/{project['id']}/export-excel")

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active
    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}
    classes_val = ws.cell(row=2, column=headers["Image Classes"]).value
    assert classes_val in (None, "")


def test_export_excel_image_no_comments(client):
    """Verify images with no comments have empty Comment column."""
    resp = client.post("/api/projects/", json={
        "name": "No Comments",
        "description": "Test",
        "meta_group_id": "test-group",
    })
    project = resp.json()

    files = {"file": ("silent.png", b"data", "image/png")}
    client.post(f"/api/projects/{project['id']}/images", files=files)

    resp = client.get(f"/api/projects/{project['id']}/export-excel")

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active
    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}
    comment_val = ws.cell(row=2, column=headers["Comment"]).value
    assert comment_val in (None, "")


def test_export_excel_forbidden_for_non_group_member(client):
    """Verify 403 when user is not a member of the project's group."""
    resp = client.post("/api/projects/", json={
        "name": "Restricted Project",
        "description": "Not for everyone",
        "meta_group_id": "restricted-group",
    })
    assert resp.status_code == 201
    project = resp.json()

    with patch("routers.export.is_user_in_group", return_value=False):
        resp = client.get(f"/api/projects/{project['id']}/export-excel")

    assert resp.status_code == 403
    assert "access" in resp.json()["detail"].lower()


def test_export_excel_alternate_metadata_keys(client):
    """Verify that all metadata keys become their own columns in the export."""
    resp = client.post("/api/projects/", json={
        "name": "Alternate Keys",
        "description": "Test alternate metadata key names",
        "meta_group_id": "test-group",
    })
    project = resp.json()

    # Use arbitrary key names - each should become its own column
    metadata = {
        "lotNumber": "ALT-LOT-1",
        "serial": "ALT-SN-1",
        "inspectionStatus": "Pass",
        "inspectorName": "Alt Inspector",
        "secondaryInspectorName": "Alt Secondary",
    }
    files = {"file": ("alt_keys.png", b"data", "image/png")}
    data = {"metadata": _json.dumps(metadata)}
    client.post(f"/api/projects/{project['id']}/images", files=files, data=data)

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active

    # Build a header -> column map
    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}

    # Each metadata key should appear as its own column header
    assert "lotNumber" in headers
    assert "serial" in headers
    assert "inspectionStatus" in headers
    assert "inspectorName" in headers
    assert "secondaryInspectorName" in headers

    # Values should be present in the correct columns
    assert ws.cell(row=2, column=headers["lotNumber"]).value == "ALT-LOT-1"
    assert ws.cell(row=2, column=headers["serial"]).value == "ALT-SN-1"
    assert ws.cell(row=2, column=headers["inspectionStatus"]).value == "Pass"
    assert ws.cell(row=2, column=headers["inspectorName"]).value == "Alt Inspector"
    assert ws.cell(row=2, column=headers["secondaryInspectorName"]).value == "Alt Secondary"


def test_export_excel_includes_review_data(client):
    """Verify review status, reviewer, and review date appear in the export."""
    # Create a project and image
    proj_resp = client.post("/api/projects/", json={
        "name": "Review Data Test",
        "description": "Test review columns in export",
        "meta_group_id": "test-group",
    })
    assert proj_resp.status_code == 201
    project = proj_resp.json()

    img_resp = client.post(
        f"/api/projects/{project['id']}/images",
        files={"file": ("reviewed.png", b"data", "image/png")},
    )
    assert img_resp.status_code == 201
    image_id = img_resp.json()["id"]

    # Create a review for the image
    rev_resp = client.post(f"/api/images/{image_id}/reviews", json={"status": "pass"})
    assert rev_resp.status_code == 201

    # Export and check
    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active
    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}

    assert "Review Status" in headers
    assert "Reviewer" in headers
    assert "Review Date" in headers

    assert ws.cell(row=2, column=headers["Review Status"]).value == "pass"
    reviewer_val = ws.cell(row=2, column=headers["Reviewer"]).value
    assert reviewer_val is not None and reviewer_val != ""
    review_date_val = ws.cell(row=2, column=headers["Review Date"]).value
    assert review_date_val is not None and review_date_val != ""


def test_export_excel_no_review_shows_empty(client):
    """Verify images with no review have empty review columns."""
    proj_resp = client.post("/api/projects/", json={
        "name": "No Review Test",
        "description": "Test empty review columns",
        "meta_group_id": "test-group",
    })
    assert proj_resp.status_code == 201
    project = proj_resp.json()

    client.post(
        f"/api/projects/{project['id']}/images",
        files={"file": ("unreviewed.png", b"data", "image/png")},
    )

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active
    headers = {ws.cell(row=1, column=c).value: c for c in range(1, ws.max_column + 1)}

    assert ws.cell(row=2, column=headers["Review Status"]).value in (None, "")
    assert ws.cell(row=2, column=headers["Reviewer"]).value in (None, "")
    assert ws.cell(row=2, column=headers["Review Date"]).value in (None, "")


def test_export_excel_excludes_measurements_metadata(client):
    """Verify the 'measurements' metadata key is not exported as a column."""
    import json as _json

    proj_resp = client.post("/api/projects/", json={
        "name": "Measurements Excluded",
        "description": "Test that measurements key is excluded",
        "meta_group_id": "test-group",
    })
    assert proj_resp.status_code == 201
    project = proj_resp.json()

    metadata = {
        "lot_number": "LOT-1",
        "measurements": [{"id": "m1", "distance_pixels": 42.5}],
    }
    files = {"file": ("img.png", b"data", "image/png")}
    data = {"metadata": _json.dumps(metadata)}
    img_resp = client.post(
        f"/api/projects/{project['id']}/images",
        files=files,
        data=data,
    )
    assert img_resp.status_code == 201

    resp = client.get(f"/api/projects/{project['id']}/export-excel")
    assert resp.status_code == 200

    from openpyxl import load_workbook
    ws = load_workbook(io.BytesIO(resp.content)).active
    headers = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]

    assert "measurements" not in headers
    assert "lot_number" in headers


# ---------------------------------------------------------------------------
# Unit tests for _build_workbook helper
# ---------------------------------------------------------------------------

class TestBuildWorkbook:
    """Tests for the _build_workbook helper function."""

    def _load(self, wb):
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        from openpyxl import load_workbook
        return load_workbook(buf)

    def test_empty_rows_no_meta_keys_produces_six_columns(self):
        wb = _build_workbook("Test", [], [])
        ws = self._load(wb).active
        assert ws.max_row == 1
        # Columns: Filename, Review Status, Reviewer, Review Date, Image Classes, Comment
        assert ws.cell(row=1, column=1).value == "Filename"
        assert ws.cell(row=1, column=2).value == "Review Status"
        assert ws.cell(row=1, column=3).value == "Reviewer"
        assert ws.cell(row=1, column=4).value == "Review Date"
        assert ws.cell(row=1, column=5).value == "Image Classes"
        assert ws.cell(row=1, column=6).value == "Comment"
        assert ws.cell(row=1, column=7).value == "Annotation Count"
        assert ws.cell(row=1, column=8).value == "Annotations"
        assert ws.max_column == 8

    def test_meta_keys_become_columns(self):
        meta_keys = ["lot_number", "serial"]
        wb = _build_workbook("Test", [], meta_keys)
        ws = self._load(wb).active
        # Columns: Filename, lot_number, serial, Review Status, Reviewer, Review Date,
        #          Image Classes, Comment, Annotation Count, Annotations
        assert ws.cell(row=1, column=1).value == "Filename"
        assert ws.cell(row=1, column=2).value == "lot_number"
        assert ws.cell(row=1, column=3).value == "serial"
        assert ws.cell(row=1, column=4).value == "Review Status"
        assert ws.cell(row=1, column=5).value == "Reviewer"
        assert ws.cell(row=1, column=6).value == "Review Date"
        assert ws.cell(row=1, column=7).value == "Image Classes"
        assert ws.cell(row=1, column=8).value == "Comment"
        assert ws.cell(row=1, column=9).value == "Annotation Count"
        assert ws.cell(row=1, column=10).value == "Annotations"
        assert ws.max_column == 10

    def test_freeze_panes_set(self):
        wb = _build_workbook("Test", [{"filename": "a.png"}], [])
        ws = self._load(wb).active
        assert ws.freeze_panes == "A2"

    def test_autofilter_set_with_data(self):
        rows = [{"filename": f"img{i}.png"} for i in range(3)]
        wb = _build_workbook("Test", rows, [])
        ws = self._load(wb).active
        assert ws.auto_filter.ref is not None
        assert "A1" in ws.auto_filter.ref
        # 8 columns (Filename, Review Status, Reviewer, Review Date, Image Classes,
        # Comment, Annotation Count, Annotations), 3 data rows + 1 header
        assert "H4" in ws.auto_filter.ref

    def test_autofilter_not_set_for_empty(self):
        wb = _build_workbook("Test", [], [])
        ws = self._load(wb).active
        assert ws.auto_filter.ref is None

    def test_header_styling(self):
        wb = _build_workbook("Test", [], [])
        ws = self._load(wb).active
        header_cell = ws.cell(row=1, column=1)
        assert header_cell.font.bold is True
        assert header_cell.fill.start_color.rgb is not None

    def test_column_count_no_meta_keys(self):
        wb = _build_workbook("Test", [], [])
        ws = self._load(wb).active
        assert ws.max_column == 8  # Filename + Review Status + Reviewer + Review Date + Image Classes + Comment + Annotation Count + Annotations

    def test_column_count_with_meta_keys(self):
        meta_keys = ["a", "b", "c"]
        wb = _build_workbook("Test", [], meta_keys)
        ws = self._load(wb).active
        assert ws.max_column == 11  # Filename + 3 keys + Review Status + Reviewer + Review Date + Image Classes + Comment + Annotation Count + Annotations

    def test_sheet_title(self):
        wb = _build_workbook("My Project", [], [])
        ws = self._load(wb).active
        assert ws.title == "Image Data"

    def test_multiple_rows_written(self):
        meta_keys = ["lot_number"]
        rows = [
            {"filename": "img1.png", "lot_number": "L1"},
            {"filename": "img2.png", "lot_number": "L2"},
            {"filename": "img3.png", "lot_number": "L3"},
        ]
        wb = _build_workbook("Test", rows, meta_keys)
        ws = self._load(wb).active
        assert ws.max_row == 4
        assert ws.cell(row=2, column=1).value == "img1.png"
        assert ws.cell(row=3, column=1).value == "img2.png"
        assert ws.cell(row=4, column=1).value == "img3.png"

    def test_missing_keys_default_to_empty(self):
        """Row dicts missing some keys should produce empty cells."""
        meta_keys = ["lot_number", "serial"]
        rows = [{"filename": "img.png", "lot_number": "L1"}]  # missing "serial"
        wb = _build_workbook("Test", rows, meta_keys)
        ws = self._load(wb).active
        # serial (col 3) should be empty
        assert ws.cell(row=2, column=3).value in (None, "")

    def test_metadata_values_written_correctly(self):
        meta_keys = ["status", "part"]
        rows = [{"filename": "x.png", "status": "Pass", "part": "P-001"}]
        wb = _build_workbook("Test", rows, meta_keys)
        ws = self._load(wb).active
        assert ws.cell(row=2, column=1).value == "x.png"
        assert ws.cell(row=2, column=2).value == "Pass"
        assert ws.cell(row=2, column=3).value == "P-001"

    def test_formula_injection_cells_have_quote_prefix(self):
        """Cells whose values start with formula characters must have quotePrefix set."""
        meta_keys = ["formula_field"]
        rows = [
            {"filename": "=CMD", "formula_field": "=SUM(A1)"},
            {"filename": "+safe", "formula_field": "-value"},
            {"filename": "@user", "formula_field": "normal"},
        ]
        wb = _build_workbook("Test", rows, meta_keys)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        from openpyxl import load_workbook
        ws = load_workbook(buf).active
        # Values starting with formula chars are stored as text via quotePrefix
        assert ws.cell(row=2, column=1).quotePrefix is True   # "=CMD"
        assert ws.cell(row=2, column=2).quotePrefix is True   # "=SUM(A1)"
        assert ws.cell(row=3, column=1).quotePrefix is True   # "+safe"
        assert ws.cell(row=3, column=2).quotePrefix is True   # "-value"
        assert ws.cell(row=4, column=1).quotePrefix is True   # "@user"
        # Normal values must not have quotePrefix set
        assert ws.cell(row=4, column=2).quotePrefix is False  # "normal"
        # Values are preserved verbatim
        assert ws.cell(row=2, column=1).value == "=CMD"
        assert ws.cell(row=2, column=2).value == "=SUM(A1)"

    def test_formula_injection_header_cells_have_quote_prefix(self):
        """Header cells from metadata keys starting with formula chars must have quotePrefix."""
        meta_keys = ["=evil_key", "+tricky", "@mention", "normal_key"]
        wb = _build_workbook("Test", [], meta_keys)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        from openpyxl import load_workbook
        ws = load_workbook(buf).active
        # Metadata key headers are columns 2-5 (column 1 is Filename)
        assert ws.cell(row=1, column=2).value == "=evil_key"
        assert ws.cell(row=1, column=2).quotePrefix is True
        assert ws.cell(row=1, column=3).value == "+tricky"
        assert ws.cell(row=1, column=3).quotePrefix is True
        assert ws.cell(row=1, column=4).value == "@mention"
        assert ws.cell(row=1, column=4).quotePrefix is True
        # Normal header should not have quotePrefix
        assert ws.cell(row=1, column=5).value == "normal_key"
        assert ws.cell(row=1, column=5).quotePrefix is False
        # Fixed headers (Filename, etc.) should not have quotePrefix
        assert ws.cell(row=1, column=1).quotePrefix is False

