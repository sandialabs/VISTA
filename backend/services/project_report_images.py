"""Bounded 2D evidence rendering for project inspection reports.

Part metadata is the authoritative source of report evidence.  This module
resolves only active image rows from the same project, decodes common Pillow
formats, and renders raster PDF pages without exposing storage details.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import io
import textwrap
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from utils import boto3_client as object_storage

MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_REPORT_SOURCE_BYTES = 256 * 1024 * 1024
MAX_DECODED_PIXELS = 12_000_000
MAX_PANELS_PER_PART = 12
MAX_PANELS_PER_REPORT = 500
MAX_PARTS_PER_IMAGE_REPORT = 25
MAX_PAGES_PER_IMAGE_REPORT = 100
MAX_S3_READ_CHUNK = 1024 * 1024
REPORT_BUILD_SEMAPHORE = asyncio.Semaphore(2)

PAGE_WIDTH = 1240
PAGE_HEIGHT = 1754
PDF_PAGE_WIDTH = 595
PDF_PAGE_HEIGHT = 842
PAGE_MARGIN = 84
PANEL_IMAGE_SIZE = (1010, 560)
SUPPORTED_IMAGE_FORMATS = {"PNG", "JPEG", "TIFF", "BMP", "GIF", "WEBP"}


class EvidenceUnavailable(Exception):
    """Expected, safely reportable evidence failure."""

    def __init__(self, public_reason: str):
        """Store the client-safe reason for the evidence failure."""
        super().__init__(public_reason)
        self.public_reason = public_reason


@dataclass(frozen=True)
class EvidenceRecord:
    """A single piece of image evidence attached to an inspection part."""

    record: dict[str, Any]
    order: int
    is_overlay: bool
    asset: models.DataInstance | None = None

    @property
    def image_id(self) -> str:
        """Return the evidence record's image ID, or an empty string."""
        return str(self.record.get("image_id") or "").strip()

    @property
    def filename(self) -> str:
        """Return the evidence record's filename, or an empty string."""
        return str(self.record.get("filename") or "").strip()

    @property
    def label(self) -> str:
        """Return the evidence record's display label, with sensible fallbacks."""
        return (
            str(self.record.get("label") or "").strip()
            or self.filename
            or ("Overlay evidence" if self.is_overlay else "Source evidence")
        )


@dataclass(frozen=True)
class PartEvidence:
    """An inspection part and the evidence records collected for its report."""

    part_id: str
    identifier: str
    inspection_result: str
    records: tuple[EvidenceRecord, ...]


@dataclass(frozen=True)
class PanelSpec:
    """A single rendered evidence panel and its placement metadata."""

    part_id: str
    part_identifier: str
    inspection_result: str
    evidence: EvidenceRecord | None
    base: EvidenceRecord | None = None
    empty_message: str | None = None


@dataclass(frozen=True)
class Omission:
    """A piece of evidence that was excluded from the report, and why."""

    part_identifier: str
    evidence_label: str
    reason: str


@dataclass
class ReportBuildResult:
    """The rendered PDF bytes plus counts and omissions from building a report."""

    pdf_bytes: bytes
    page_count: int
    panel_count: int
    omissions: list[Omission] = field(default_factory=list)


@dataclass(frozen=True)
class ProjectIdentity:
    """A project's ID and name, as surfaced in a report."""

    id: str
    name: str


@dataclass(frozen=True)
class ReportSummary:
    """Aggregate part counts shown in a report summary."""

    total_parts: int
    pass_parts: int
    reject_parts: int
    unreviewed_parts: int


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _is_visible_record(record: dict[str, Any]) -> bool:
    if _truthy(record.get("hidden")):
        return False
    if _truthy(record.get("overlay_delete_candidate")) or _truthy(
        record.get("delete_candidate")
    ):
        return False
    return not any(
        record.get(field_name)
        for field_name in (
            "deleted_at",
            "overlay_deleted_at",
            "hard_deleted_at",
            "pending_hard_delete_at",
            "overlay_delete_after",
        )
    )


def _is_overlay_record(record: dict[str, Any], *, from_analysis_outputs: bool) -> bool:
    modality = str(record.get("modality") or "").strip().lower()
    return bool(
        from_analysis_outputs
        or _truthy(record.get("overlay"))
        or _truthy(record.get("analysis_output"))
        or record.get("overlay_base_image_id")
        or record.get("analysis_source_image_id")
        or "overlay" in modality
    )


def _record_identity(record: dict[str, Any], is_overlay: bool) -> tuple[str, str]:
    image_id = str(record.get("image_id") or "").strip()
    if image_id:
        return ("id", image_id)
    filename = str(record.get("filename") or "").strip()
    return ("filename", f"{int(is_overlay)}:{filename}")


def _records_from_metadata(metadata: Any) -> list[EvidenceRecord]:
    metadata_obj = metadata if isinstance(metadata, dict) else {}
    output: list[EvidenceRecord] = []
    seen: set[tuple[str, str]] = set()
    order = 0
    for field_name in ("source_images", "analysis_outputs"):
        values = metadata_obj.get(field_name)
        if not isinstance(values, list):
            continue
        for raw_record in values:
            if not isinstance(raw_record, dict) or not _is_visible_record(raw_record):
                continue
            is_overlay = _is_overlay_record(
                raw_record,
                from_analysis_outputs=field_name == "analysis_outputs",
            )
            identity = _record_identity(raw_record, is_overlay)
            if not identity[1] or identity in seen:
                continue
            seen.add(identity)
            output.append(
                EvidenceRecord(
                    record=dict(raw_record),
                    order=order,
                    is_overlay=is_overlay,
                )
            )
            order += 1
    return output


def _safe_uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


async def _resolve_project_evidence(
    *,
    db: AsyncSession,
    project_id: uuid.UUID,
    part_limit: int | None = None,
) -> list[PartEvidence]:
    part_query = (
        select(models.InspectionPart)
        .where(models.InspectionPart.project_id == project_id)
        .order_by(
            models.InspectionPart.serial_number.asc(), models.InspectionPart.id.asc()
        )
    )
    if part_limit is not None:
        part_query = part_query.limit(part_limit)
    part_result = await db.execute(part_query)
    parts = list(part_result.scalars().all())
    records_by_part = {
        str(part.id): _records_from_metadata(part.metadata_json) for part in parts
    }

    requested_ids: set[uuid.UUID] = set()
    requested_filenames: set[str] = set()
    for records in records_by_part.values():
        for record in records:
            parsed_id = _safe_uuid(record.image_id)
            if parsed_id is not None:
                requested_ids.add(parsed_id)
            if record.filename:
                requested_filenames.add(record.filename)

    assets: list[models.DataInstance] = []
    if requested_ids or requested_filenames:
        matchers = []
        if requested_ids:
            matchers.append(models.DataInstance.id.in_(requested_ids))
        if requested_filenames:
            matchers.append(models.DataInstance.filename.in_(requested_filenames))
        asset_result = await db.execute(
            select(models.DataInstance)
            .where(
                models.DataInstance.project_id == project_id,
                models.DataInstance.deleted_at.is_(None),
                models.DataInstance.storage_deleted.is_(False),
                or_(*matchers),
            )
            .order_by(
                models.DataInstance.created_at.asc(), models.DataInstance.id.asc()
            )
        )
        assets = list(asset_result.scalars().all())

    by_id = {str(asset.id): asset for asset in assets}
    by_filename: dict[str, list[models.DataInstance]] = defaultdict(list)
    for asset in assets:
        by_filename[asset.filename].append(asset)

    resolved_parts = []
    for part in parts:
        resolved_records = []
        resolved_seen: set[tuple[str, str, str]] = set()
        for record in records_by_part[str(part.id)]:
            asset = None
            parsed_id = _safe_uuid(record.image_id)
            if parsed_id is not None:
                # An explicit UUID is authoritative.  Do not let an invalid,
                # deleted, or cross-project ID fall through to a filename.
                asset = by_id.get(str(parsed_id))
            elif not record.image_id and record.filename:
                filename_matches = by_filename.get(record.filename, [])
                if len(filename_matches) == 1:
                    asset = filename_matches[0]
            if asset is not None:
                resolved_identity = (
                    "asset",
                    str(asset.id),
                    "overlay" if record.is_overlay else "source",
                )
            else:
                record_identity = _record_identity(record.record, record.is_overlay)
                resolved_identity = ("record", record_identity[0], record_identity[1])
            if resolved_identity in resolved_seen:
                continue
            resolved_seen.add(resolved_identity)
            resolved_records.append(
                EvidenceRecord(
                    record=record.record,
                    order=record.order,
                    is_overlay=record.is_overlay,
                    asset=asset,
                )
            )
        resolved_parts.append(
            PartEvidence(
                part_id=str(part.id),
                identifier=part.serial_number,
                inspection_result=_normalize_result(part.review_state),
                records=tuple(resolved_records),
            )
        )
    return resolved_parts


def _normalize_result(review_state: Any) -> str:
    value = str(review_state or "").strip().lower()
    if value == "pass":
        return "pass"
    if value in {"reject", "reject_pending", "reject_confirmed"}:
        return "reject"
    return "unreviewed"


def _link_overlay_to_base(
    overlay: EvidenceRecord,
    bases: Iterable[EvidenceRecord],
) -> EvidenceRecord | None:
    base_records = list(bases)
    explicit_id = str(
        overlay.record.get("overlay_base_image_id")
        or overlay.record.get("analysis_source_image_id")
        or ""
    ).strip()
    if explicit_id:
        id_matches = [
            base
            for base in base_records
            if explicit_id in {base.image_id, str(getattr(base.asset, "id", ""))}
        ]
        if len(id_matches) == 1:
            return id_matches[0]

    explicit_filename = str(
        overlay.record.get("overlay_base_filename")
        or overlay.record.get("analysis_source_filename")
        or overlay.record.get("source_filename")
        or ""
    ).strip()
    if explicit_filename:
        filename_matches = [
            base
            for base in base_records
            if explicit_filename
            in {base.filename, str(getattr(base.asset, "filename", ""))}
        ]
        if len(filename_matches) == 1:
            return filename_matches[0]

    def normalized_field(record: EvidenceRecord, *keys: str) -> str:
        return next(
            (
                str(record.record.get(key) or "").strip().lower()
                for key in keys
                if str(record.record.get(key) or "").strip()
            ),
            "",
        )

    overlay_view = normalized_field(overlay, "side", "view", "view_name")
    overlay_modality = normalized_field(
        overlay,
        "source_modality",
        "base_modality",
        "modality",
    )
    if overlay_view and overlay_modality not in {"", "overlay", "analysis"}:
        view_modality_matches = [
            base
            for base in base_records
            if normalized_field(base, "side", "view", "view_name") == overlay_view
            and normalized_field(base, "modality") == overlay_modality
        ]
        if len(view_modality_matches) == 1:
            return view_modality_matches[0]

    if len(base_records) == 1:
        return base_records[0]
    return None


def _panel_specs_for_part(part: PartEvidence) -> list[PanelSpec]:
    bases = [record for record in part.records if not record.is_overlay]
    panels = []
    for record in part.records:
        panels.append(
            PanelSpec(
                part_id=part.part_id,
                part_identifier=part.identifier,
                inspection_result=part.inspection_result,
                evidence=record,
                base=_link_overlay_to_base(record, bases)
                if record.is_overlay
                else None,
            )
        )
    return panels


class BoundedImageLoader:
    """Read and cache source bytes under per-image and per-report limits."""

    def __init__(
        self,
        *,
        storage_client: Any = None,
        bucket: str | None = None,
        max_image_bytes: int = MAX_IMAGE_BYTES,
        max_report_bytes: int = MAX_REPORT_SOURCE_BYTES,
    ):
        """Configure storage access and per-image/per-report byte limits."""
        self.storage_client = storage_client
        self.bucket = bucket or settings.S3_BUCKET
        self.max_image_bytes = max_image_bytes
        self.max_report_bytes = max_report_bytes
        self.bytes_read = 0
        self._cache: dict[str, bytes | EvidenceUnavailable] = {}

    def load(self, asset: models.DataInstance | None) -> bytes:
        """Return the asset's image bytes, using the per-asset cache."""
        if asset is None:
            raise EvidenceUnavailable("Image record is unavailable")
        cache_key = str(asset.id)
        cached = self._cache.get(cache_key)
        if isinstance(cached, EvidenceUnavailable):
            raise cached
        if isinstance(cached, bytes):
            return cached

        try:
            data = self._load_uncached(asset)
        except EvidenceUnavailable as exc:
            self._cache[cache_key] = exc
            raise
        self._cache[cache_key] = data
        return data

    def _load_uncached(self, asset: models.DataInstance) -> bytes:
        size_bytes = int(asset.size_bytes or 0)
        if size_bytes > self.max_image_bytes:
            raise EvidenceUnavailable("Image exceeds the per-image size limit")

        metadata = asset.metadata_json if isinstance(asset.metadata_json, dict) else {}
        encoded = next(
            (
                metadata.get(key)
                for key in (
                    "analysis_inline_image_base64",
                    "inline_image_base64",
                    "image_base64",
                )
                if isinstance(metadata.get(key), str) and metadata.get(key)
            ),
            None,
        )
        if encoded is not None:
            if len(encoded) > ((self.max_image_bytes + 2) // 3) * 4 + 4:
                raise EvidenceUnavailable("Image exceeds the per-image size limit")
            try:
                data = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError):
                raise EvidenceUnavailable("Inline image data is invalid") from None
            return self._accept_bytes(data)

        if self.storage_client is None:
            raise EvidenceUnavailable("Image bytes are unavailable")
        body = None
        try:
            response = self.storage_client.get_object(
                Bucket=self.bucket,
                Key=asset.object_storage_key,
            )
            body = response.get("Body")
            content_length = int(response.get("ContentLength") or 0)
            if content_length > self.max_image_bytes:
                raise EvidenceUnavailable("Image exceeds the per-image size limit")
            if body is None:
                raise EvidenceUnavailable("Image bytes are unavailable")
            chunks = []
            total = 0
            while True:
                chunk = body.read(
                    min(MAX_S3_READ_CHUNK, self.max_image_bytes - total + 1)
                )
                if not chunk:
                    break
                total += len(chunk)
                if total > self.max_image_bytes:
                    raise EvidenceUnavailable("Image exceeds the per-image size limit")
                chunks.append(chunk)
            return self._accept_bytes(b"".join(chunks))
        except EvidenceUnavailable:
            raise
        except Exception:
            raise EvidenceUnavailable("Image bytes are unavailable") from None
        finally:
            close_body = getattr(body, "close", None)
            if callable(close_body):
                with contextlib.suppress(Exception):
                    close_body()

    def _accept_bytes(self, data: bytes) -> bytes:
        if len(data) > self.max_image_bytes:
            raise EvidenceUnavailable("Image exceeds the per-image size limit")
        if self.bytes_read + len(data) > self.max_report_bytes:
            raise EvidenceUnavailable("Report source-byte limit reached")
        self.bytes_read += len(data)
        return data


def decode_pillow_image(data: bytes) -> Image.Image:
    """Decode one bounded 2D frame and return an RGBA copy."""
    try:
        with Image.open(io.BytesIO(data)) as opened:
            image_format = str(opened.format or "").upper()
            if image_format not in SUPPORTED_IMAGE_FORMATS:
                raise EvidenceUnavailable("Unsupported 2D image format")
            opened.seek(0)
            width, height = opened.size
            if width <= 0 or height <= 0 or width * height > MAX_DECODED_PIXELS:
                raise EvidenceUnavailable("Decoded image exceeds the pixel limit")
            if image_format == "JPEG":
                opened.draft("RGB", PANEL_IMAGE_SIZE)
            opened.load()
            frame = ImageOps.exif_transpose(opened)
            frame.thumbnail(PANEL_IMAGE_SIZE, Image.Resampling.LANCZOS)
            output = frame.convert("RGBA")
            output.info["vista_source_size"] = (width, height)
            return output
    except EvidenceUnavailable:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise EvidenceUnavailable("Image data is corrupt or unsupported") from None
    except Image.DecompressionBombError:
        raise EvidenceUnavailable("Decoded image exceeds the pixel limit") from None


def compose_overlay(base: Image.Image, overlay: Image.Image) -> Image.Image:
    """Composite an overlay, preserving real alpha or applying review opacity."""
    base_source_size = base.info.get("vista_source_size", base.size)
    overlay_source_size = overlay.info.get("vista_source_size", overlay.size)
    if base_source_size != overlay_source_size:
        raise EvidenceUnavailable("Overlay dimensions do not match the source image")
    base_rgba = base.convert("RGBA")
    overlay_rgba = overlay.convert("RGBA")
    # EXIF orientation is applied during decoding. Two files can therefore
    # have identical encoded dimensions but different display dimensions
    # (for example, only the source carries orientation 6). Pillow requires
    # exact display-size equality for alpha_composite, so surface the same
    # safe mismatch used for ordinary dimension differences.
    if base_rgba.size != overlay_rgba.size:
        base_rgba.close()
        overlay_rgba.close()
        raise EvidenceUnavailable("Overlay dimensions do not match the source image")
    alpha = overlay_rgba.getchannel("A")
    alpha_min, alpha_max = alpha.getextrema()
    if alpha_min == alpha_max == 255:
        overlay_rgba.putalpha(110)
    return Image.alpha_composite(base_rgba, overlay_rgba)


def _safe_display_text(value: Any, fallback: str = "") -> str:
    raw = str(value if value is not None else fallback)
    return "".join(
        character if character.isprintable() else " " for character in raw
    ).strip()


def _font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_SMALL = _font(24)
FONT_BODY = _font(30)
FONT_BODY_BOLD = _font(30, bold=True)
FONT_HEADING = _font(44, bold=True)
FONT_TITLE = _font(72, bold=True)
FONT_RESULT = _font(26, bold=True)


def _new_page() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    page = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), "#f4f2eb")
    draw = ImageDraw.Draw(page)
    draw.rectangle((0, 0, PAGE_WIDTH, 22), fill="#173042")
    draw.rectangle((0, PAGE_HEIGHT - 18, PAGE_WIDTH, PAGE_HEIGHT), fill="#d7762b")
    return page, draw


def _draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    *,
    font: ImageFont.ImageFont,
    fill: str,
    width: int,
    line_spacing: int = 8,
) -> int:
    lines = textwrap.wrap(_safe_display_text(text), width=max(1, width)) or [""]
    x, y = xy
    line_height = int(font.getbbox("Ag")[3] - font.getbbox("Ag")[1]) + line_spacing
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _ellipsize_single_line(
    draw: ImageDraw.ImageDraw,
    text: Any,
    *,
    font: ImageFont.ImageFont,
    max_width: int,
) -> str:
    """Return printable text that fits a fixed-width single-line header."""
    value = _safe_display_text(text)
    if draw.textlength(value, font=font) <= max_width:
        return value
    ellipsis = "\N{HORIZONTAL ELLIPSIS}"
    if draw.textlength(ellipsis, font=font) > max_width:
        return ""
    low = 0
    high = len(value)
    while low < high:
        midpoint = (low + high + 1) // 2
        candidate = value[:midpoint].rstrip() + ellipsis
        if draw.textlength(candidate, font=font) <= max_width:
            low = midpoint
        else:
            high = midpoint - 1
    return value[:low].rstrip() + ellipsis


def _result_colors(result: str) -> tuple[str, str]:
    if result == "pass":
        return "#d8f0e4", "#12623f"
    if result == "reject":
        return "#f7d9d5", "#9c2b21"
    return "#f4e9c8", "#76540f"


def _render_cover(project: ProjectIdentity, summary: ReportSummary) -> Image.Image:
    page, draw = _new_page()
    draw.text(
        (PAGE_MARGIN, 104),
        "VISTA / INSPECTION EVIDENCE",
        font=FONT_SMALL,
        fill="#60717a",
    )
    draw.text((PAGE_MARGIN, 176), "Report with images", font=FONT_TITLE, fill="#172731")
    y = _draw_wrapped(
        draw,
        _safe_display_text(project.name, "Project"),
        (PAGE_MARGIN, 296),
        font=FONT_HEADING,
        fill="#273944",
        width=34,
        line_spacing=12,
    )
    draw.text(
        (PAGE_MARGIN, y + 20),
        f"Project ID  {project.id}",
        font=FONT_SMALL,
        fill="#60717a",
    )
    draw.line(
        (PAGE_MARGIN, y + 86, PAGE_WIDTH - PAGE_MARGIN, y + 86), fill="#aeb8bc", width=3
    )

    cards = (
        ("TOTAL PARTS", summary.total_parts, "#173042"),
        ("PASS", summary.pass_parts, "#12623f"),
        ("REJECT", summary.reject_parts, "#9c2b21"),
        ("UNREVIEWED", summary.unreviewed_parts, "#76540f"),
    )
    card_y = y + 142
    card_width = (PAGE_WIDTH - (2 * PAGE_MARGIN) - 36) // 2
    for index, (label, value, color) in enumerate(cards):
        column = index % 2
        row = index // 2
        x = PAGE_MARGIN + column * (card_width + 36)
        top = card_y + row * 190
        draw.rounded_rectangle(
            (x, top, x + card_width, top + 150),
            radius=10,
            fill="#ffffff",
            outline="#c8ced0",
            width=2,
        )
        draw.rectangle((x, top, x + 12, top + 150), fill=color)
        draw.text((x + 36, top + 28), label, font=FONT_SMALL, fill="#60717a")
        draw.text((x + 36, top + 70), str(value), font=FONT_HEADING, fill=color)

    note_y = card_y + 440
    draw.text(
        (PAGE_MARGIN, note_y), "Evidence scope", font=FONT_BODY_BOLD, fill="#273944"
    )
    _draw_wrapped(
        draw,
        "Visible 2D source images and analysis overlays assigned to each part. "
        "Unavailable evidence is identified without exposing storage details.",
        (PAGE_MARGIN, note_y + 54),
        font=FONT_BODY,
        fill="#4e6069",
        width=62,
        line_spacing=12,
    )
    return page


def _render_part_page(
    part: PartEvidence,
    panels: list[tuple[Image.Image | None, str, str | None]],
    *,
    page_index: int,
    page_total: int,
) -> Image.Image:
    page, draw = _new_page()
    draw.text(
        (PAGE_MARGIN, 68), "PART INSPECTION EVIDENCE", font=FONT_SMALL, fill="#60717a"
    )

    badge_fill, badge_text = _result_colors(part.inspection_result)
    badge_label = part.inspection_result.upper()
    badge_bbox = draw.textbbox((0, 0), badge_label, font=FONT_RESULT)
    badge_width = badge_bbox[2] - badge_bbox[0] + 48
    badge_left = PAGE_WIDTH - PAGE_MARGIN - badge_width
    identifier = _ellipsize_single_line(
        draw,
        part.identifier or "Unnamed part",
        font=FONT_HEADING,
        max_width=badge_left - PAGE_MARGIN - 24,
    )
    draw.text((PAGE_MARGIN, 112), identifier, font=FONT_HEADING, fill="#172731")
    draw.rounded_rectangle(
        (badge_left, 104, PAGE_WIDTH - PAGE_MARGIN, 158),
        radius=8,
        fill=badge_fill,
    )
    draw.text(
        (badge_left + 24, 116),
        badge_label,
        font=FONT_RESULT,
        fill=badge_text,
    )
    draw.line(
        (PAGE_MARGIN, 190, PAGE_WIDTH - PAGE_MARGIN, 190), fill="#aeb8bc", width=2
    )

    slot_top = 226
    slot_height = 675 if len(panels) == 2 else 1280
    for slot_index, (panel_image, caption, note) in enumerate(panels):
        top = slot_top + slot_index * 700
        bottom = min(top + slot_height, PAGE_HEIGHT - 100)
        draw.rounded_rectangle(
            (PAGE_MARGIN, top, PAGE_WIDTH - PAGE_MARGIN, bottom),
            radius=12,
            fill="#ffffff",
            outline="#c8ced0",
            width=2,
        )
        caption_y = top + 24
        caption_y = _draw_wrapped(
            draw,
            caption,
            (PAGE_MARGIN + 28, caption_y),
            font=FONT_BODY_BOLD,
            fill="#273944",
            width=58,
        )
        image_box = (
            PAGE_MARGIN + 28,
            caption_y + 16,
            PAGE_WIDTH - PAGE_MARGIN - 28,
            bottom - (96 if note else 34),
        )
        if panel_image is None:
            draw.rectangle(image_box, fill="#eef0ed", outline="#b4bec1", width=2)
            draw.line(
                (
                    image_box[0] + 24,
                    image_box[1] + 24,
                    image_box[2] - 24,
                    image_box[3] - 24,
                ),
                fill="#b4bec1",
                width=4,
            )
            draw.line(
                (
                    image_box[2] - 24,
                    image_box[1] + 24,
                    image_box[0] + 24,
                    image_box[3] - 24,
                ),
                fill="#b4bec1",
                width=4,
            )
            message = note or "No visible 2D evidence available"
            _draw_wrapped(
                draw,
                message,
                (image_box[0] + 48, (image_box[1] + image_box[3]) // 2 - 24),
                font=FONT_BODY,
                fill="#53666f",
                width=48,
            )
        else:
            display = panel_image.copy()
            display.thumbnail(
                (image_box[2] - image_box[0], image_box[3] - image_box[1]),
                Image.Resampling.LANCZOS,
            )
            x = image_box[0] + ((image_box[2] - image_box[0]) - display.width) // 2
            y = image_box[1] + ((image_box[3] - image_box[1]) - display.height) // 2
            if display.mode == "RGBA":
                alpha_mask = display.getchannel("A")
                page.paste(display, (x, y), alpha_mask)
                alpha_mask.close()
            else:
                page.paste(display.convert("RGB"), (x, y))
            display.close()
            if note:
                _draw_wrapped(
                    draw,
                    note,
                    (PAGE_MARGIN + 28, bottom - 72),
                    font=FONT_SMALL,
                    fill="#76540f",
                    width=72,
                )

    return page


def _render_appendix_pages(
    omissions: list[Omission],
    *,
    max_pages: int | None = None,
) -> list[Image.Image]:
    lines: list[tuple[str, bool]] = []
    for omission in omissions:
        label = _safe_display_text(omission.evidence_label, "Evidence")
        part = _safe_display_text(omission.part_identifier, "Part")
        reason = _safe_display_text(omission.reason, "Unavailable")
        wrapped = textwrap.wrap(f"{part} / {label}: {reason}", width=76) or [""]
        lines.extend((line, index == 0) for index, line in enumerate(wrapped))

    if max_pages is not None:
        line_limit = max(0, max_pages * 24)
        if len(lines) > line_limit and line_limit > 0:
            hidden_line_count = len(lines) - line_limit + 1
            lines = lines[: line_limit - 1] + [
                (
                    f"{hidden_line_count} additional omission line(s) "
                    "excluded by page limit.",
                    True,
                )
            ]
        elif line_limit == 0:
            return []

    pages = []
    for start in range(0, max(1, len(lines)), 24):
        page, draw = _new_page()
        draw.text(
            (PAGE_MARGIN, 78), "OMISSIONS APPENDIX", font=FONT_HEADING, fill="#172731"
        )
        draw.text(
            (PAGE_MARGIN, 144),
            "Evidence that could not be displayed or exceeded report limits.",
            font=FONT_BODY,
            fill="#53666f",
        )
        y = 224
        for line, starts_entry in lines[start : start + 24]:
            if starts_entry:
                draw.ellipse(
                    (PAGE_MARGIN, y + 11, PAGE_MARGIN + 10, y + 21), fill="#d7762b"
                )
            text_x = PAGE_MARGIN + (28 if starts_entry else 42)
            draw.text((text_x, y), line, font=FONT_SMALL, fill="#273944")
            y += 56
        pages.append(page)
    return pages


def _page_to_jpeg(page: Image.Image) -> bytes:
    output = io.BytesIO()
    page.save(output, format="JPEG", quality=88, optimize=True, progressive=False)
    page.close()
    return output.getvalue()


def _jpeg_pages_to_pdf(jpeg_pages: list[bytes]) -> bytes:
    """Embed full-page JPEGs in a small dependency-free PDF wrapper."""
    page_count = len(jpeg_pages)
    page_object_ids = [3 + index * 3 for index in range(page_count)]
    font_id = 3 + page_count * 3
    kids = " ".join(f"{object_id} 0 R" for object_id in page_object_ids)
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode("ascii"),
    }
    for index, jpeg in enumerate(jpeg_pages):
        page_id = page_object_ids[index]
        image_id = page_id + 1
        content_id = page_id + 2
        image_name = f"Im{index + 1}"
        content = (
            f"q\n{PDF_PAGE_WIDTH} 0 0 {PDF_PAGE_HEIGHT} 0 0 cm\n/{image_name} Do\nQ\n"
            f"BT\n/F1 9 Tf\n490 16 Td\n(Page {index + 1} of {page_count}) Tj\nET\n"
        ).encode("ascii")
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {PDF_PAGE_WIDTH} {PDF_PAGE_HEIGHT}] "
            f"/Resources << /XObject << /{image_name} {image_id} 0 R >> "
            f"/Font << /F1 {font_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        ).encode("ascii")
        objects[image_id] = (
            f"<< /Type /XObject /Subtype /Image "
            f"/Width {PAGE_WIDTH} /Height {PAGE_HEIGHT} "
            f"/ColorSpace /DeviceRGB /BitsPerComponent 8 "
            f"/Filter /DCTDecode /Length {len(jpeg)} >>\n"
            "stream\n".encode("ascii")
            + jpeg
            + b"\nendstream"
        )
        objects[content_id] = (
            f"<< /Length {len(content)} >>\nstream\n".encode("ascii")
            + content
            + b"endstream"
        )
    objects[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    output = io.BytesIO()
    output.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_id in range(1, max(objects) + 1):
        offsets.append(output.tell())
        output.write(f"{object_id} 0 obj\n".encode("ascii"))
        output.write(objects[object_id])
        output.write(b"\nendobj\n")
    xref_offset = output.tell()
    output.write(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    output.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.write(
        (
            f"trailer << /Size {len(offsets)} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF"
        ).encode("ascii")
    )
    return output.getvalue()


def _render_panel(
    spec: PanelSpec,
    *,
    loader: BoundedImageLoader,
) -> tuple[Image.Image | None, str, str | None]:
    evidence = spec.evidence
    if evidence is None:
        return (
            None,
            "Inspection evidence",
            spec.empty_message or "No visible 2D evidence available",
        )

    prefix = "Overlay" if evidence.is_overlay else "Source"
    caption = f"{prefix} - {_safe_display_text(evidence.label, prefix)}"
    if evidence.asset is None:
        return None, caption, "Evidence unavailable"

    try:
        evidence_image = decode_pillow_image(loader.load(evidence.asset))
    except EvidenceUnavailable as exc:
        return None, caption, exc.public_reason

    if not evidence.is_overlay:
        return evidence_image, caption, None
    if spec.base is None or spec.base.asset is None:
        return (
            evidence_image,
            caption,
            "Overlay shown standalone; source link is unavailable",
        )

    try:
        base_image = decode_pillow_image(loader.load(spec.base.asset))
    except EvidenceUnavailable:
        return (
            evidence_image,
            caption,
            "Overlay shown standalone; source image is unavailable",
        )

    try:
        composite = compose_overlay(base_image, evidence_image)
    except EvidenceUnavailable as exc:
        base_image.close()
        return (
            evidence_image,
            caption,
            f"Overlay shown standalone; {exc.public_reason.lower()}",
        )
    base_image.close()
    evidence_image.close()
    composite_caption = f"Composite - {_safe_display_text(evidence.label, 'Overlay')}"
    return composite, composite_caption, None


def _build_resolved_project_report_with_images_pdf(
    *,
    project: ProjectIdentity,
    summary: ReportSummary,
    parts: list[PartEvidence],
    omitted_part_count: int,
    storage_client: Any = None,
) -> ReportBuildResult:
    loader = BoundedImageLoader(
        storage_client=storage_client
        if storage_client is not None
        else object_storage.boto3_client,
    )
    omissions: list[Omission] = []
    jpeg_pages = [_page_to_jpeg(_render_cover(project, summary))]
    panel_count = 0

    for part_index, part in enumerate(parts):
        requested_panels = _panel_specs_for_part(part)
        part_panels = requested_panels[:MAX_PANELS_PER_PART]
        per_part_omitted = len(requested_panels) - len(part_panels)
        report_remaining = max(0, MAX_PANELS_PER_REPORT - panel_count)
        report_omitted = 0
        if len(part_panels) > report_remaining:
            report_omitted = len(part_panels) - report_remaining
            part_panels = part_panels[:report_remaining]

        requested_page_count = max(1, (len(part_panels) + 1) // 2)
        # Reserve one page for a bounded omissions appendix. This makes the
        # cap apply to no-evidence placeholders as well as evidence panels.
        if len(jpeg_pages) + requested_page_count > MAX_PAGES_PER_IMAGE_REPORT - 1:
            omitted_part_count += len(parts) - part_index
            break

        if per_part_omitted:
            omissions.append(
                Omission(
                    part_identifier=part.identifier,
                    evidence_label=f"{per_part_omitted} evidence panel(s)",
                    reason=f"Per-part limit of {MAX_PANELS_PER_PART} panels reached",
                )
            )
        if report_omitted:
            omissions.append(
                Omission(
                    part_identifier=part.identifier,
                    evidence_label=f"{report_omitted} evidence panel(s)",
                    reason=f"Report limit of {MAX_PANELS_PER_REPORT} panels reached",
                )
            )

        if not part_panels:
            message = (
                "Evidence omitted because the report panel limit was reached"
                if requested_panels
                else "No visible 2D evidence available"
            )
            part_panels = [
                PanelSpec(
                    part_id=part.part_id,
                    part_identifier=part.identifier,
                    inspection_result=part.inspection_result,
                    evidence=None,
                    empty_message=message,
                )
            ]

        rendered_panels = []
        counted_panels = 0
        for spec in part_panels:
            panel_image, caption, note = _render_panel(spec, loader=loader)
            if spec.evidence is not None:
                counted_panels += 1
                if note and panel_image is None:
                    omissions.append(
                        Omission(
                            part_identifier=part.identifier,
                            evidence_label=spec.evidence.label,
                            reason=note,
                        )
                    )
            rendered_panels.append((panel_image, caption, note))
        panel_count += counted_panels

        page_total = (len(rendered_panels) + 1) // 2
        for page_offset, start in enumerate(range(0, len(rendered_panels), 2), start=1):
            page_panels = rendered_panels[start : start + 2]
            page = _render_part_page(
                part,
                page_panels,
                page_index=page_offset,
                page_total=page_total,
            )
            jpeg_pages.append(_page_to_jpeg(page))
            for panel_image, _caption, _note in page_panels:
                if panel_image is not None:
                    panel_image.close()

    if omitted_part_count:
        omissions.insert(
            0,
            Omission(
                part_identifier="Additional parts",
                evidence_label=f"{omitted_part_count} part(s)",
                reason=(
                    "Omitted from the image report because the part or "
                    "page limit was reached"
                ),
            ),
        )

    if omissions:
        available_appendix_pages = MAX_PAGES_PER_IMAGE_REPORT - len(jpeg_pages)
        for appendix_page in _render_appendix_pages(
            omissions,
            max_pages=available_appendix_pages,
        ):
            jpeg_pages.append(_page_to_jpeg(appendix_page))

    pdf_bytes = _jpeg_pages_to_pdf(jpeg_pages)
    return ReportBuildResult(
        pdf_bytes=pdf_bytes,
        page_count=len(jpeg_pages),
        panel_count=panel_count,
        omissions=omissions,
    )


async def build_project_report_with_images_pdf(
    *,
    project_id: uuid.UUID,
    db: AsyncSession,
    project: models.Project,
    storage_client: Any = None,
) -> ReportBuildResult:
    """Resolve evidence asynchronously, then render the bounded PDF off-loop."""
    summary_result = await db.execute(
        select(
            models.InspectionPart.review_state,
            func.count(models.InspectionPart.id),
        )
        .where(models.InspectionPart.project_id == project_id)
        .group_by(models.InspectionPart.review_state)
    )
    summary_counts = {"pass": 0, "reject": 0, "unreviewed": 0}
    for review_state, count in summary_result.all():
        summary_counts[_normalize_result(review_state)] += int(count)
    summary = ReportSummary(
        total_parts=sum(summary_counts.values()),
        pass_parts=summary_counts["pass"],
        reject_parts=summary_counts["reject"],
        unreviewed_parts=summary_counts["unreviewed"],
    )
    parts = await _resolve_project_evidence(
        db=db,
        project_id=project_id,
        part_limit=MAX_PARTS_PER_IMAGE_REPORT,
    )
    omitted_part_count = max(0, summary.total_parts - len(parts))
    project_identity = ProjectIdentity(id=str(project.id), name=str(project.name))
    async with REPORT_BUILD_SEMAPHORE:
        return await asyncio.to_thread(
            _build_resolved_project_report_with_images_pdf,
            project=project_identity,
            summary=summary,
            parts=parts,
            omitted_part_count=omitted_part_count,
            storage_client=storage_client,
        )
