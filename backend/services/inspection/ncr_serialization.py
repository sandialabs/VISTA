"""Serialization helpers for inspection nonconformance reports (NCRs)."""

from __future__ import annotations


def format_ncr_label(ncr_number: int) -> str:
    """Return the display label for an NCR number, for example ``NCR-0001``."""
    return f"NCR-{int(ncr_number):04d}"


def serialize_ncr(ncr) -> dict:
    """Serialize an NCR ORM row for API responses."""
    return {
        "id": ncr.id,
        "project_id": ncr.project_id,
        "part_id": ncr.part_id,
        "part_serial_number": ncr.part_serial_number,
        "ncr_number": ncr.ncr_number,
        "ncr_label": format_ncr_label(ncr.ncr_number),
        "status": ncr.status,
        "comment": ncr.comment,
        "failure_code": ncr.failure_code,
        "failure_code_description": ncr.failure_code_description,
        "disposition_code": ncr.disposition_code,
        "disposition_code_description": ncr.disposition_code_description,
        "disposition_instructions": ncr.disposition_instructions,
        "version": ncr.version,
        "created_at": ncr.created_at,
        "created_by": ncr.created_by,
        "updated_at": ncr.updated_at,
        "updated_by": ncr.updated_by,
        "approved_at": ncr.approved_at,
        "approved_by": ncr.approved_by,
        "deleted_at": ncr.deleted_at,
        "deleted_by": ncr.deleted_by,
    }


def serialize_history_entry(entry) -> dict:
    """Serialize one history row for API responses."""
    return {
        "id": entry.id,
        "version": entry.version,
        "action": entry.action,
        "actor": entry.actor,
        "at": entry.at,
        "changes": entry.changes or {},
    }
