import base64
import io
import re
import uuid
from datetime import UTC
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from core import models
from services import project_report_images as report_images


def _image_bytes(
    color,
    *,
    size=(24, 18),
    image_format="PNG",
    mode="RGBA",
):
    image = Image.new(mode, size, color)
    output = io.BytesIO()
    image.save(output, format=image_format)
    image.close()
    return output.getvalue()


def _asset(
    data,
    *,
    filename="image.png",
    image_id=None,
    size_bytes=None,
):
    return SimpleNamespace(
        id=image_id or uuid.uuid4(),
        filename=filename,
        object_storage_key=f"private/{uuid.uuid4()}",
        size_bytes=len(data) if size_bytes is None else size_bytes,
        metadata_json={
            "analysis_inline_image_base64": base64.b64encode(data).decode("ascii"),
        },
    )


def _record(asset, *, overlay=False, **extra):
    return report_images.EvidenceRecord(
        record={
            "image_id": str(asset.id),
            "filename": asset.filename,
            "overlay": overlay,
            **extra,
        },
        order=0,
        is_overlay=overlay,
        asset=asset,
    )


def _pdf_page_count(pdf_bytes):
    return len(re.findall(rb"/Type /Page\b", pdf_bytes))


def test_transparent_overlay_visibly_changes_composite_and_opaque_output_is_blended():
    base = Image.new("RGBA", (8, 8), (0, 0, 0, 255))
    transparent = Image.new("RGBA", (8, 8), (255, 0, 0, 128))
    opaque = Image.new("RGB", (8, 8), (0, 255, 0))

    transparent_composite = report_images.compose_overlay(base, transparent)
    opaque_composite = report_images.compose_overlay(base, opaque)

    assert transparent_composite.getpixel((4, 4)) == (128, 0, 0, 255)
    opaque_pixel = opaque_composite.getpixel((4, 4))
    assert 0 < opaque_pixel[1] < 255
    assert opaque_pixel != base.getpixel((4, 4))


def test_overlay_linking_prefers_id_then_unique_filename_then_single_base():
    first_asset = _asset(_image_bytes("white"), filename="same.png")
    second_asset = _asset(_image_bytes("black"), filename="other.png")
    first = _record(first_asset)
    second = _record(second_asset)

    by_id = _record(
        _asset(_image_bytes("red"), filename="overlay.png"),
        overlay=True,
        overlay_base_image_id=str(second_asset.id),
        overlay_base_filename=first_asset.filename,
    )
    assert report_images._link_overlay_to_base(by_id, [first, second]) is second

    by_filename = _record(
        _asset(_image_bytes("red"), filename="overlay-2.png"),
        overlay=True,
        overlay_base_filename=first_asset.filename,
    )
    assert report_images._link_overlay_to_base(by_filename, [first, second]) is first

    fallback = _record(_asset(_image_bytes("red")), overlay=True)
    assert report_images._link_overlay_to_base(fallback, [first]) is first
    assert report_images._link_overlay_to_base(fallback, [first, second]) is None


def test_overlay_linking_uses_unique_imported_view_and_modality_without_cross_linking():
    left = _record(_asset(_image_bytes("white"), filename="left.png"))
    left.record.update({"side": "left", "modality": "visible"})
    right = _record(_asset(_image_bytes("black"), filename="right.png"))
    right.record.update({"view": "RIGHT", "modality": "visible"})
    overlay = _record(
        _asset(_image_bytes("red"), filename="right-overlay.png"), overlay=True
    )
    overlay.record.update({"side": "right", "modality": "visible"})

    assert report_images._link_overlay_to_base(overlay, [left, right]) is right

    duplicate_right = _record(_asset(_image_bytes("blue"), filename="right-2.png"))
    duplicate_right.record.update({"side": "right", "modality": "visible"})
    assert (
        report_images._link_overlay_to_base(
            overlay,
            [left, right, duplicate_right],
        )
        is None
    )


def test_tiff_first_frame_is_used_and_dimension_mismatch_is_not_composited():
    first = Image.new("RGB", (12, 10), "red")
    second = Image.new("RGB", (12, 10), "blue")
    output = io.BytesIO()
    first.save(output, format="TIFF", save_all=True, append_images=[second])
    first.close()
    second.close()

    decoded = report_images.decode_pillow_image(output.getvalue())
    assert decoded.getpixel((4, 4))[:3] == (255, 0, 0)

    base = report_images.decode_pillow_image(_image_bytes("white", size=(20, 10)))
    overlay = report_images.decode_pillow_image(
        _image_bytes((255, 0, 0, 128), size=(10, 5))
    )
    with pytest.raises(report_images.EvidenceUnavailable, match="dimensions"):
        report_images.compose_overlay(base, overlay)


def test_exif_orientation_display_mismatch_shows_overlay_standalone():
    base = Image.new("RGB", (24, 18), "white")
    base_exif = base.getexif()
    base_exif[274] = 6
    base_output = io.BytesIO()
    base.save(base_output, format="JPEG", exif=base_exif)
    base.close()

    overlay_bytes = _image_bytes((255, 0, 0, 128), size=(24, 18))
    base_asset = _asset(base_output.getvalue(), filename="oriented-base.jpg")
    overlay_asset = _asset(overlay_bytes, filename="overlay.png")
    base_record = _record(base_asset)
    overlay_record = _record(overlay_asset, overlay=True)
    spec = report_images.PanelSpec(
        part_id="part-1",
        part_identifier="PART-1",
        inspection_result="reject",
        evidence=overlay_record,
        base=base_record,
    )

    panel, caption, note = report_images._render_panel(
        spec,
        loader=report_images.BoundedImageLoader(),
    )

    assert panel is not None
    assert panel.size == (24, 18)
    assert caption == "Overlay - overlay.png"
    assert (
        note
        == "Overlay shown standalone; overlay dimensions do not match the source image"
    )
    panel.close()


def test_long_part_identifier_is_ellipsized_above_the_evidence_card():
    long_identifier = "PART-" + ("SERIAL-" * 40)
    part = report_images.PartEvidence(
        part_id="part-long",
        identifier=long_identifier,
        inspection_result="reject",
        records=(),
    )

    page = report_images._render_part_page(
        part,
        [(None, "Inspection evidence", "No visible 2D evidence available")],
        page_index=1,
        page_total=1,
    )
    draw = ImageDraw.Draw(page)
    badge_label = part.inspection_result.upper()
    badge_bbox = draw.textbbox((0, 0), badge_label, font=report_images.FONT_RESULT)
    badge_left = (
        report_images.PAGE_WIDTH
        - report_images.PAGE_MARGIN
        - (badge_bbox[2] - badge_bbox[0] + 48)
    )
    max_width = badge_left - report_images.PAGE_MARGIN - 24
    fitted = report_images._ellipsize_single_line(
        draw,
        long_identifier,
        font=report_images.FONT_HEADING,
        max_width=max_width,
    )

    assert fitted.endswith("\N{HORIZONTAL ELLIPSIS}")
    assert draw.textlength(fitted, font=report_images.FONT_HEADING) <= max_width
    background = Image.new("RGB", (1, 1), "#f4f2eb").getpixel((0, 0))
    header_clearance = page.crop(
        (
            report_images.PAGE_MARGIN,
            170,
            badge_left - 24,
            188,
        )
    )
    assert set(header_clearance.getdata()) == {background}
    header_clearance.close()
    page.close()


def test_decode_rejects_corrupt_unsupported_and_pixel_oversize(monkeypatch):
    assert report_images.MAX_DECODED_PIXELS == 12_000_000
    with pytest.raises(report_images.EvidenceUnavailable, match="corrupt"):
        report_images.decode_pillow_image(b"not-an-image")
    with pytest.raises(report_images.EvidenceUnavailable, match="corrupt|unsupported"):
        report_images.decode_pillow_image(b"\x93NUMPY\x01\x00volume")

    monkeypatch.setattr(report_images, "MAX_DECODED_PIXELS", 99)
    with pytest.raises(report_images.EvidenceUnavailable, match="pixel limit"):
        report_images.decode_pillow_image(_image_bytes("white", size=(10, 10)))


def test_bounded_loader_uses_strict_inline_base64_and_safe_s3_limits():
    invalid = SimpleNamespace(
        id=uuid.uuid4(),
        filename="invalid.png",
        object_storage_key="secret/key",
        size_bytes=4,
        metadata_json={"analysis_inline_image_base64": "not base64!"},
    )
    loader = report_images.BoundedImageLoader(max_image_bytes=32, max_report_bytes=64)
    with pytest.raises(report_images.EvidenceUnavailable, match="invalid"):
        loader.load(invalid)

    oversize = _asset(b"x", size_bytes=33)
    with pytest.raises(report_images.EvidenceUnavailable, match="per-image"):
        loader.load(oversize)

    class FakeBody:
        def __init__(self, value):
            self.value = io.BytesIO(value)
            self.closed = False

        def read(self, amount):
            return self.value.read(amount)

        def close(self):
            self.closed = True
            self.value.close()

    class FakeS3:
        def __init__(self, value):
            self.body = FakeBody(value)

        def get_object(self, **_kwargs):
            return {"Body": self.body, "ContentLength": len(self.body.value.getvalue())}

    s3_asset = SimpleNamespace(
        id=uuid.uuid4(),
        filename="s3.png",
        object_storage_key="never-shown",
        size_bytes=None,
        metadata_json={},
    )
    fake_s3 = FakeS3(b"123456789")
    s3_loader = report_images.BoundedImageLoader(
        storage_client=fake_s3,
        max_image_bytes=8,
        max_report_bytes=16,
    )
    with pytest.raises(report_images.EvidenceUnavailable, match="per-image"):
        s3_loader.load(s3_asset)
    assert fake_s3.body.closed is True

    successful_s3 = FakeS3(b"1234")
    successful_loader = report_images.BoundedImageLoader(
        storage_client=successful_s3,
        max_image_bytes=8,
        max_report_bytes=16,
    )
    assert successful_loader.load(s3_asset) == b"1234"
    assert successful_s3.body.closed is True


def test_metadata_visibility_and_deduplication_are_deterministic():
    visible_id = str(uuid.uuid4())
    records = report_images._records_from_metadata(
        {
            "source_images": [
                {"image_id": visible_id, "filename": "base.png"},
                {"image_id": "hidden", "filename": "hidden.png", "hidden": True},
                {
                    "image_id": "deleted",
                    "filename": "deleted.png",
                    "delete_candidate": True,
                },
                {
                    "image_id": "overlay",
                    "filename": "overlay.png",
                    "overlay": True,
                    "overlay_base_image_id": visible_id,
                },
            ],
            "analysis_outputs": [
                {
                    "image_id": "overlay",
                    "filename": "overlay.png",
                    "analysis_output": True,
                },
                {
                    "image_id": "gone",
                    "filename": "gone.png",
                    "deleted_at": "2026-01-01",
                },
            ],
        }
    )

    assert [(record.image_id, record.is_overlay) for record in records] == [
        (visible_id, False),
        ("overlay", True),
    ]


@pytest.mark.asyncio
async def test_bulk_resolution_rejects_ambiguous_cross_project_deleted_and_storage_deleted(
    db_session,
):
    project = models.Project(
        name="Evidence project", meta_group_id="evidence", project_type="PT1"
    )
    other_project = models.Project(
        name="Other", meta_group_id="evidence", project_type="PT1"
    )
    db_session.add_all([project, other_project])
    await db_session.flush()

    active = models.DataInstance(
        project_id=project.id,
        filename="active.png",
        object_storage_key=f"active/{uuid.uuid4()}",
        uploaded_by_user_id="tester",
        storage_deleted=False,
    )
    duplicate_a = models.DataInstance(
        project_id=project.id,
        filename="duplicate.png",
        object_storage_key=f"duplicate-a/{uuid.uuid4()}",
        uploaded_by_user_id="tester",
        storage_deleted=False,
    )
    duplicate_b = models.DataInstance(
        project_id=project.id,
        filename="duplicate.png",
        object_storage_key=f"duplicate-b/{uuid.uuid4()}",
        uploaded_by_user_id="tester",
        storage_deleted=False,
    )
    deleted = models.DataInstance(
        project_id=project.id,
        filename="deleted.png",
        object_storage_key=f"deleted/{uuid.uuid4()}",
        uploaded_by_user_id="tester",
        storage_deleted=False,
    )
    storage_deleted = models.DataInstance(
        project_id=project.id,
        filename="storage-deleted.png",
        object_storage_key=f"storage-deleted/{uuid.uuid4()}",
        uploaded_by_user_id="tester",
        storage_deleted=True,
    )
    cross_project = models.DataInstance(
        project_id=other_project.id,
        filename="active.png",
        object_storage_key=f"cross/{uuid.uuid4()}",
        uploaded_by_user_id="tester",
        storage_deleted=False,
    )
    db_session.add_all(
        [active, duplicate_a, duplicate_b, deleted, storage_deleted, cross_project]
    )
    await db_session.flush()
    from datetime import datetime

    deleted.deleted_at = datetime.now(UTC)

    part = models.InspectionPart(
        project_id=project.id,
        serial_number="PART-RESOLUTION",
        metadata_json={
            "source_images": [
                {"image_id": str(active.id), "filename": "wrong-name.png"},
                {"filename": "active.png"},
                {"filename": "duplicate.png"},
                {"image_id": str(cross_project.id), "filename": "active.png"},
                {"image_id": str(deleted.id), "filename": "deleted.png"},
                {
                    "image_id": str(storage_deleted.id),
                    "filename": "storage-deleted.png",
                },
                {"image_id": str(uuid.uuid4()), "filename": "active.png"},
            ]
        },
        review_state="pass",
    )
    db_session.add(part)
    await db_session.commit()

    resolved = await report_images._resolve_project_evidence(
        db=db_session,
        project_id=project.id,
    )
    assets = [record.asset for record in resolved[0].records]

    # The explicit-ID and unique-filename records resolve to the same source
    # asset and collapse after resolution.
    assert assets[0].id == active.id
    assert assets[1:] == [None, None, None, None, None]


@pytest.mark.asyncio
async def test_report_build_handles_empty_parts_and_explicit_panel_omissions(
    db_session,
    monkeypatch,
):
    project = models.Project(
        name="Bounded report", meta_group_id="evidence", project_type="PT1"
    )
    db_session.add(project)
    await db_session.flush()

    records = []
    for index, color in enumerate(("red", "green", "blue")):
        data = _image_bytes(color)
        asset = models.DataInstance(
            project_id=project.id,
            filename=f"image-{index}.png",
            object_storage_key=f"inline/{uuid.uuid4()}",
            uploaded_by_user_id="tester",
            size_bytes=len(data),
            metadata_json={
                "analysis_inline_image_base64": base64.b64encode(data).decode("ascii"),
            },
            storage_deleted=False,
        )
        db_session.add(asset)
        await db_session.flush()
        records.append({"image_id": str(asset.id), "filename": asset.filename})

    db_session.add_all(
        [
            models.InspectionPart(
                project_id=project.id,
                serial_number="PART-WITH-EVIDENCE",
                review_state="reject_confirmed",
                metadata_json={"source_images": records},
            ),
            models.InspectionPart(
                project_id=project.id,
                serial_number="PART-WITHOUT-EVIDENCE",
                review_state="unreviewed",
                metadata_json={},
            ),
        ]
    )
    await db_session.commit()

    monkeypatch.setattr(report_images, "MAX_PANELS_PER_PART", 1)
    monkeypatch.setattr(report_images, "MAX_PANELS_PER_REPORT", 1)
    result = await report_images.build_project_report_with_images_pdf(
        project_id=project.id,
        db=db_session,
        project=project,
    )

    assert result.pdf_bytes.startswith(b"%PDF-")
    assert result.pdf_bytes.endswith(b"%%EOF")
    assert result.panel_count == 1
    assert any("Per-part limit" in omission.reason for omission in result.omissions)
    assert result.page_count == 4  # cover, two parts, omissions appendix
    assert _pdf_page_count(result.pdf_bytes) == result.page_count


@pytest.mark.asyncio
async def test_report_part_and_page_limits_are_aggregated_and_rendering_is_offloaded(
    db_session,
    monkeypatch,
):
    project = models.Project(
        name="Bounded parts", meta_group_id="evidence", project_type="PT1"
    )
    db_session.add(project)
    await db_session.flush()
    db_session.add_all(
        [
            models.InspectionPart(
                project_id=project.id,
                serial_number=f"PART-{index}",
                review_state=review_state,
                metadata_json={},
            )
            for index, review_state in enumerate(
                ("pass", "reject_confirmed", "unreviewed", "reject_pending", "pass")
            )
        ]
    )
    await db_session.commit()

    monkeypatch.setattr(report_images, "MAX_PARTS_PER_IMAGE_REPORT", 4)
    monkeypatch.setattr(report_images, "MAX_PAGES_PER_IMAGE_REPORT", 4)
    offloaded = []
    semaphore_entries = []

    class FakeSemaphore:
        async def __aenter__(self):
            semaphore_entries.append("enter")

        async def __aexit__(self, *_args):
            semaphore_entries.append("exit")

    async def fake_to_thread(callable_, /, *args, **kwargs):
        offloaded.append((callable_, kwargs))
        return callable_(*args, **kwargs)

    monkeypatch.setattr(report_images.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(report_images, "REPORT_BUILD_SEMAPHORE", FakeSemaphore())
    result = await report_images.build_project_report_with_images_pdf(
        project_id=project.id,
        db=db_session,
        project=project,
    )

    assert len(offloaded) == 1
    assert semaphore_entries == ["enter", "exit"]
    assert (
        offloaded[0][0] is report_images._build_resolved_project_report_with_images_pdf
    )
    assert offloaded[0][1]["summary"] == report_images.ReportSummary(
        total_parts=5,
        pass_parts=2,
        reject_parts=2,
        unreviewed_parts=1,
    )
    assert result.page_count == 4
    assert result.page_count <= report_images.MAX_PAGES_PER_IMAGE_REPORT
    aggregated = [
        omission
        for omission in result.omissions
        if omission.part_identifier == "Additional parts"
    ]
    assert len(aggregated) == 1
    assert aggregated[0].evidence_label == "3 part(s)"


def test_transparent_standalone_overlay_is_composited_onto_the_card_background():
    transparent_overlay = Image.new("RGBA", (1000, 500), (255, 0, 0, 0))
    part = report_images.PartEvidence(
        part_id="transparent",
        identifier="PART-TRANSPARENT",
        inspection_result="reject",
        records=(),
    )

    page = report_images._render_part_page(
        part,
        [
            (
                transparent_overlay,
                "Overlay - transparent.png",
                "Overlay shown standalone; source link is unavailable",
            )
        ],
        page_index=1,
        page_total=1,
    )

    caption_line_height = (
        report_images.FONT_BODY_BOLD.getbbox("Ag")[3]
        - report_images.FONT_BODY_BOLD.getbbox("Ag")[1]
        + 8
    )
    image_top = 226 + 24 + caption_line_height + 16
    image_bottom = min(226 + 1280, report_images.PAGE_HEIGHT - 100) - 96
    image_center = (report_images.PAGE_WIDTH // 2, (image_top + image_bottom) // 2)
    assert page.getpixel(image_center) == (255, 255, 255)
    transparent_overlay.close()
    page.close()


def test_pdf_has_global_page_numbers_and_appendix_wraps_without_repeat_bullets():
    first_page, _ = report_images._new_page()
    second_page, _ = report_images._new_page()
    pdf = report_images._jpeg_pages_to_pdf(
        [
            report_images._page_to_jpeg(first_page),
            report_images._page_to_jpeg(second_page),
        ]
    )
    assert b"(Page 1 of 2)" in pdf
    assert b"(Page 2 of 2)" in pdf

    appendix = report_images._render_appendix_pages(
        [
            report_images.Omission(
                part_identifier="PART-" + ("LONG-" * 30),
                evidence_label="Evidence",
                reason="Unavailable",
            )
        ]
    )[0]
    bullet_color = Image.new("RGB", (1, 1), "#d7762b").getpixel((0, 0))
    assert appendix.getpixel((report_images.PAGE_MARGIN + 5, 224 + 16)) == bullet_color
    assert (
        appendix.getpixel((report_images.PAGE_MARGIN + 5, 224 + 56 + 16))
        != bullet_color
    )
    appendix.close()
