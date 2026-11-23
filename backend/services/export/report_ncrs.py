"""NCR (nonconformance report) data for project reports and export bundles."""

from __future__ import annotations

import textwrap
from datetime import datetime

from sqlalchemy import select

from core import models
from services.inspection.ncr_serialization import serialize_history_entry, serialize_ncr

NCR_PDF_LINE_WIDTH = 80
NCR_PDF_LINES_PER_PAGE = 40


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


def ncr_report_row(ncr) -> dict:
    """Return the report/export representation of one NCR."""
    serialized = serialize_ncr(ncr)
    return {
        "ncr_id": str(serialized["id"]),
        "ncr_number": serialized["ncr_number"],
        "ncr_label": serialized["ncr_label"],
        "part_id": str(serialized["part_id"]) if serialized["part_id"] else None,
        "part_identifier": serialized["part_serial_number"],
        "status": serialized["status"],
        "failure_code": serialized["failure_code"],
        "failure_code_description": serialized["failure_code_description"],
        "disposition_code": serialized["disposition_code"],
        "disposition_code_description": serialized["disposition_code_description"],
        "comment": serialized["comment"],
        "disposition_instructions": serialized["disposition_instructions"],
        "created_by": serialized["created_by"],
        "created_at": _iso(serialized["created_at"]),
        "updated_by": serialized["updated_by"],
        "updated_at": _iso(serialized["updated_at"]),
        "approved_by": serialized["approved_by"],
        "approved_at": _iso(serialized["approved_at"]),
    }


async def load_project_ncr_report_rows(*, db, project_id) -> list[dict]:
    """Return live (not deleted) NCRs for a project, ordered by NCR number."""
    result = await db.execute(
        select(models.InspectionNcr)
        .where(
            models.InspectionNcr.project_id == project_id,
            models.InspectionNcr.deleted_at.is_(None),
        )
        .order_by(models.InspectionNcr.ncr_number)
    )
    return [ncr_report_row(ncr) for ncr in result.scalars().all()]


async def load_project_ncr_export_records(*, db, project_id) -> list[dict]:
    """Return every NCR, including soft-deleted ones, with full change history.

    Exports are the traceability record, so deleted NCRs are kept and marked.
    """
    ncr_result = await db.execute(
        select(models.InspectionNcr)
        .where(models.InspectionNcr.project_id == project_id)
        .order_by(models.InspectionNcr.ncr_number)
    )
    ncrs = list(ncr_result.scalars().all())
    history_result = await db.execute(
        select(models.InspectionNcrHistory)
        .where(models.InspectionNcrHistory.project_id == project_id)
        .order_by(
            models.InspectionNcrHistory.ncr_id,
            models.InspectionNcrHistory.version,
        )
    )
    history_by_ncr: dict = {}
    for entry in history_result.scalars().all():
        serialized = serialize_history_entry(entry)
        serialized["id"] = str(serialized["id"])
        serialized["at"] = _iso(serialized["at"])
        history_by_ncr.setdefault(entry.ncr_id, []).append(serialized)
    records = []
    for ncr in ncrs:
        record = ncr_report_row(ncr)
        record["deleted"] = ncr.deleted_at is not None
        record["deleted_by"] = ncr.deleted_by
        record["deleted_at"] = _iso(ncr.deleted_at)
        record["history"] = history_by_ncr.get(ncr.id, [])
        records.append(record)
    return records


def summarize_ncr_rows(rows: list[dict]) -> dict:
    """Return NCR counts by status."""
    return {
        "total": len(rows),
        "open": sum(1 for row in rows if row.get("status") == "open"),
        "approved": sum(1 for row in rows if row.get("status") == "approved"),
    }


def _wrap(prefix: str, value: object, sanitize) -> list[str]:
    text = sanitize(value)
    width = max(10, NCR_PDF_LINE_WIDTH - len(prefix))
    wrapped = textwrap.wrap(
        text,
        width=width,
        replace_whitespace=True,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [""]
    indent = " " * len(prefix)
    return [f"{prefix}{wrapped[0]}", *(f"{indent}{line}" for line in wrapped[1:])]


def _code_text(code, description) -> str:
    return f"{code} - {description}" if description else str(code or "")


def build_ncr_pdf_pages(rows: list[dict], sanitize) -> list[list[str]]:
    """Return NCR section lines split into pages; empty when there are no NCRs.

    ``sanitize`` is the report's PDF-safe text function, so NCR text gets the
    same control-character and non-Latin escaping as the rest of the report.
    """
    if not rows:
        return []
    blocks: list[list[str]] = []
    for row in rows:
        status = "Approved" if row.get("status") == "approved" else "Open"
        block = _wrap(
            "",
            f"{row.get('ncr_label', '')} | Serial: {row.get('part_identifier', '')}"
            f" | Status: {status}",
            sanitize,
        )
        block += _wrap(
            "  Failure code: ",
            _code_text(row.get("failure_code"), row.get("failure_code_description")),
            sanitize,
        )
        block += _wrap(
            "  Disposition code: ",
            _code_text(
                row.get("disposition_code"), row.get("disposition_code_description")
            ),
            sanitize,
        )
        block += _wrap("  Comment: ", row.get("comment", ""), sanitize)
        block += _wrap(
            "  Instructions: ", row.get("disposition_instructions", ""), sanitize
        )
        block += _wrap(
            "  Created: ",
            f"{row.get('created_by', '')} {row.get('created_at') or ''}",
            sanitize,
        )
        if row.get("status") == "approved":
            block += _wrap(
                "  Approved: ",
                f"{row.get('approved_by', '')} {row.get('approved_at') or ''}",
                sanitize,
            )
        block.append("")
        blocks.append(block)

    pages: list[list[str]] = []
    current: list[str] = []
    for block in blocks:
        if current and len(current) + len(block) > NCR_PDF_LINES_PER_PAGE:
            pages.append(current)
            current = []
        for start in range(0, len(block), NCR_PDF_LINES_PER_PAGE):
            chunk = block[start : start + NCR_PDF_LINES_PER_PAGE]
            if current and len(current) + len(chunk) > NCR_PDF_LINES_PER_PAGE:
                pages.append(current)
                current = []
            current.extend(chunk)
    if current:
        pages.append(current)
    return pages
