"""Restore inspection NCRs (and their change history) from a project backup."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy import delete, func, select

from core import models
from schemas import inspection_ncrs as ncr_schemas

_TEXT_FIELDS = ("comment", "disposition_instructions")
_CODE_FIELDS = ("failure_code", "disposition_code")
_DESCRIPTION_FIELDS = ("failure_code_description", "disposition_code_description")
_HISTORY_ACTIONS = {"created", "updated", "approved", "deleted"}


def _parse_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _clean_text(value, max_length: int) -> str | None:
    """Return text safe for the column, or None when it is unusable."""
    if not isinstance(value, str):
        return None
    if any(ord(ch) < 32 and ch not in "\n\r\t" for ch in value):
        return None
    value = value.strip()
    return value if 0 < len(value) <= max_length else None


def _actor(value) -> str:
    return value[:255] if isinstance(value, str) and value.strip() else "imported"


async def clear_project_ncrs(db, project_id: uuid.UUID) -> None:
    """Delete a project's NCRs and history (used by replace-mode imports)."""
    await db.execute(
        delete(models.InspectionNcrHistory).where(
            models.InspectionNcrHistory.project_id == project_id
        )
    )
    await db.execute(
        delete(models.InspectionNcr).where(
            models.InspectionNcr.project_id == project_id
        )
    )


async def restore_project_ncrs(
    db, *, project_id: uuid.UUID, records: object, part_map: dict[str, uuid.UUID]
) -> int:
    """Stage NCR rows and history from backup ``records``; return the count.

    Records come from an uploaded archive, so each one is validated. Invalid
    records are skipped rather than failing the whole import. Part links are
    remapped to the restored parts.

    Numbers are preserved when the target has no NCRs (restore as new, or
    overwrite). When appending into a project that already has NCRs, imported
    NCRs are renumbered after the existing ones so the per-project unique
    number never collides; the original label is kept in the history.
    """
    if not isinstance(records, list):
        return 0
    existing_max = (
        await db.execute(
            select(func.max(models.InspectionNcr.ncr_number)).where(
                models.InspectionNcr.project_id == project_id
            )
        )
    ).scalar_one_or_none() or 0
    restored = 0
    used_numbers: set[int] = set()
    next_number = existing_max
    valid_records = sorted(
        (record for record in records if isinstance(record, dict)),
        key=lambda record: (
            record.get("ncr_number") if isinstance(record.get("ncr_number"), int) else 0
        ),
    )
    for record in valid_records:
        if not isinstance(record, dict):
            continue
        number = record.get("ncr_number")
        if not isinstance(number, int) or isinstance(number, bool) or number < 1:
            continue
        if number in used_numbers:
            continue
        renumbered = existing_max > 0
        values = {}
        for field in _TEXT_FIELDS:
            values[field] = _clean_text(
                record.get(field), ncr_schemas.NCR_TEXT_MAX_LENGTH
            )
        for field in _CODE_FIELDS:
            values[field] = _clean_text(
                record.get(field), ncr_schemas.NCR_CODE_MAX_LENGTH
            )
        if any(value is None for value in values.values()):
            continue
        for field in _DESCRIPTION_FIELDS:
            values[field] = _clean_text(record.get(field), 255) or ""
        status = "approved" if record.get("status") == "approved" else "open"
        deleted = record.get("deleted") is True
        history = (
            record.get("history") if isinstance(record.get("history"), list) else []
        )
        version = max(
            [1]
            + [
                entry.get("version")
                for entry in history
                if isinstance(entry, dict)
                and isinstance(entry.get("version"), int)
                and not isinstance(entry.get("version"), bool)
            ]
        )
        if renumbered:
            next_number += 1
            target_number = next_number
        else:
            target_number = number
            next_number = max(next_number, number)
        ncr = models.InspectionNcr(
            id=uuid.uuid4(),
            project_id=project_id,
            part_id=part_map.get(str(record.get("part_id"))),
            part_serial_number=_clean_text(record.get("part_identifier"), 255)
            or "unknown",
            ncr_number=target_number,
            status=status,
            version=version,
            created_at=_parse_datetime(record.get("created_at")),
            created_by=_actor(record.get("created_by")),
            updated_at=_parse_datetime(record.get("updated_at")),
            updated_by=_actor(record.get("updated_by")),
            approved_at=_parse_datetime(record.get("approved_at"))
            if status == "approved"
            else None,
            approved_by=_actor(record.get("approved_by"))
            if status == "approved"
            else None,
            deleted_at=_parse_datetime(record.get("deleted_at")) if deleted else None,
            deleted_by=_actor(record.get("deleted_by")) if deleted else None,
            **values,
        )
        if deleted and ncr.deleted_at is None:
            ncr.deleted_at = ncr.updated_at or datetime.now().astimezone()
        db.add(ncr)
        seen_versions: set[int] = set()
        for entry in history:
            restored_entry = _history_entry(entry)
            if restored_entry is None or restored_entry["version"] in seen_versions:
                continue
            seen_versions.add(restored_entry["version"])
            if renumbered and restored_entry["version"] == 1:
                restored_entry["changes"] = {
                    **restored_entry["changes"],
                    "imported_from_ncr_number": {"from": number, "to": target_number},
                }
            db.add(
                models.InspectionNcrHistory(
                    id=uuid.uuid4(),
                    ncr_id=ncr.id,
                    project_id=project_id,
                    **restored_entry,
                )
            )
        used_numbers.add(number)
        restored += 1
    return restored


def _history_entry(entry) -> dict | None:
    if not isinstance(entry, dict):
        return None
    try:
        parsed = ncr_schemas.InspectionNcrHistoryEntry.model_validate(
            {**entry, "id": entry.get("id") or str(uuid.uuid4())}
        )
    except ValidationError:
        return None
    if parsed.action not in _HISTORY_ACTIONS:
        return None
    return {
        "version": parsed.version,
        "action": parsed.action,
        "actor": _actor(parsed.actor),
        "at": parsed.at,
        "changes": parsed.changes,
    }
