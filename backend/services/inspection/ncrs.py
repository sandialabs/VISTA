"""Service layer for inspection nonconformance reports (NCRs).

An NCR documents why a part is nonconforming. Each mutation bumps the NCR's
``version`` and appends one row to ``inspection_ncr_history`` in the same
transaction, so the history is a complete, ordered record of who changed
what and when.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError

from core import models
from repositories import audit as audit_repository
from repositories import inspection as inspection_repository
from repositories import inspection_ncrs as ncr_repository
from schemas import inspection_ncrs as ncr_schemas
from services.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from services.inspection import ncr_codes as ncr_code_service
from services.inspection.ncr_serialization import (
    format_ncr_label,
    serialize_history_entry,
    serialize_ncr,
)

__all__ = [
    "approve_ncr",
    "create_ncr",
    "delete_ncr",
    "format_ncr_label",
    "get_ncr_detail",
    "list_part_ncrs",
    "list_project_ncrs",
    "serialize_history_entry",
    "serialize_ncr",
    "update_ncr",
]

NCR_NUMBER_RETRIES = 3
NCR_NUMBER_CONSTRAINT = "uix_inspection_ncrs_project_number"


class NcrNotFoundError(NotFoundError, ValueError):
    """Raised when an NCR does not exist in the requested scope."""

    default_detail = "NCR not found"


class NcrConflictError(ConflictError, ValueError):
    """Raised when an NCR action conflicts with its current state."""


def _is_number_collision(exc: IntegrityError) -> bool:
    # PostgreSQL names the constraint; SQLite reports the columns.
    message = str(getattr(exc, "orig", exc))
    return NCR_NUMBER_CONSTRAINT in message or "ncr_number" in message


def ensure_can_approve_ncr(*, project, user) -> None:
    """Authorize an NCR approval.

    Any user with write access to the project may approve today. Role-based
    restrictions are planned; add them here so every approval path is covered.
    """
    if user is None or not getattr(user, "email", None):
        raise ForbiddenError("Approval requires an authenticated user")


def _check_version(ncr, expected_version: int | None) -> None:
    if expected_version is not None and expected_version != ncr.version:
        raise NcrConflictError(
            "This NCR was changed by someone else. Reload it and try again."
        )


async def _load_ncr_detail(*, db, ncr) -> dict:
    history = await ncr_repository.list_ncr_history(db=db, ncr_id=ncr.id)
    return {
        **serialize_ncr(ncr),
        "history": [serialize_history_entry(entry) for entry in history],
    }


async def _get_live_ncr_for_update(*, db, project_id, part_id, ncr_id):
    ncr = await ncr_repository.get_ncr(
        db,
        project_id=project_id,
        part_id=part_id,
        ncr_id=ncr_id,
        for_update=True,
    )
    if ncr is None or ncr.deleted_at is not None:
        raise NcrNotFoundError()
    return ncr


async def _require_part(*, db, project_id, part_id):
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if part is None:
        raise NotFoundError("Inspection part not found")
    return part


async def list_part_ncrs(
    *, db, project_id, part_id, include_deleted: bool = False
) -> dict:
    """List NCRs for one part; soft-deleted ones only when requested."""
    await _require_part(db=db, project_id=project_id, part_id=part_id)
    ncrs = await ncr_repository.list_ncrs(
        db, project_id=project_id, part_id=part_id, include_deleted=include_deleted
    )
    return {"part_id": part_id, "ncrs": [serialize_ncr(ncr) for ncr in ncrs]}


async def list_project_ncrs(*, db, project_id, include_deleted: bool = False) -> dict:
    """List NCRs for a whole project (reports and exports)."""
    ncrs = await ncr_repository.list_ncrs(
        db, project_id=project_id, include_deleted=include_deleted
    )
    return {"part_id": None, "ncrs": [serialize_ncr(ncr) for ncr in ncrs]}


async def get_ncr_detail(
    *, db, project_id, part_id, ncr_id, include_deleted: bool = False
) -> dict:
    """Return one NCR with its change history.

    ``part_id=None`` looks the NCR up by project only, which also reaches NCRs
    whose part has since been deleted. Soft-deleted NCRs are returned
    (read-only) only with ``include_deleted``; mutations always reject them.
    """
    ncr = await ncr_repository.get_ncr(
        db, project_id=project_id, part_id=part_id, ncr_id=ncr_id
    )
    if ncr is None or (ncr.deleted_at is not None and not include_deleted):
        raise NcrNotFoundError()
    return await _load_ncr_detail(db=db, ncr=ncr)


async def create_ncr(
    *, db, project, part_id, payload: ncr_schemas.InspectionNcrCreate, user_email
) -> dict:
    """Create an NCR on a part and record the ``created`` history entry."""
    # Capture scalars up front: a rollback on retry expires ORM instances.
    project_id = project.id
    part = await _require_part(db=db, project_id=project_id, part_id=part_id)
    codes = await ncr_code_service.configured_codes(db=db, project=project)
    failure = ncr_code_service.resolve_code(
        codes, "failure_codes", payload.failure_code, "Failure code"
    )
    disposition = ncr_code_service.resolve_code(
        codes, "disposition_codes", payload.disposition_code, "Disposition code"
    )
    serial_number = part.serial_number

    for attempt in range(NCR_NUMBER_RETRIES):
        now = datetime.now(UTC)
        await ncr_repository.lock_project_for_ncr_numbering(db, project_id)
        number = await ncr_repository.next_ncr_number(db, project_id)
        ncr = models.InspectionNcr(
            project_id=project_id,
            part_id=part_id,
            part_serial_number=serial_number,
            ncr_number=number,
            status="open",
            comment=payload.comment,
            failure_code=failure["code"],
            failure_code_description=failure["description"],
            disposition_code=disposition["code"],
            disposition_code_description=disposition["description"],
            disposition_instructions=payload.disposition_instructions,
            version=1,
            created_at=now,
            created_by=user_email,
            updated_at=now,
            updated_by=user_email,
        )
        db.add(ncr)
        try:
            await db.flush()
            ncr_repository.add_history_entry(
                db,
                ncr=ncr,
                action="created",
                actor=user_email,
                at=now,
                changes={
                    field: {"from": None, "to": getattr(ncr, field)}
                    for field in ncr_schemas.NCR_TRACKED_FIELDS
                },
            )
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            if not _is_number_collision(exc):
                # Not a numbering race (for example the part was deleted
                # concurrently, violating the part foreign key).
                raise NotFoundError("Inspection part not found") from None
            # A concurrent create took this number; retry with the next one.
            if attempt == NCR_NUMBER_RETRIES - 1:
                raise NcrConflictError(
                    "Could not allocate an NCR number. Try again."
                ) from None
            continue
        break

    await db.refresh(ncr)
    audit_repository.log_db_operation(
        "CREATE",
        "inspection_ncrs",
        ncr.id,
        user_email,
        {"project_id": str(project_id), "ncr_number": ncr.ncr_number},
    )
    return await _load_ncr_detail(db=db, ncr=ncr)


async def update_ncr(
    *,
    db,
    project,
    part_id,
    ncr_id,
    payload: ncr_schemas.InspectionNcrUpdate,
    user_email,
) -> dict:
    """Apply an edit. Editing an approved NCR revokes its approval."""
    ncr = await _get_live_ncr_for_update(
        db=db, project_id=project.id, part_id=part_id, ncr_id=ncr_id
    )
    _check_version(ncr, payload.expected_version)

    updates: dict[str, str] = {}
    if payload.comment is not None:
        updates["comment"] = payload.comment
    if payload.disposition_instructions is not None:
        updates["disposition_instructions"] = payload.disposition_instructions

    needs_codes = (
        payload.failure_code is not None
        and payload.failure_code.casefold() != ncr.failure_code.casefold()
    ) or (
        payload.disposition_code is not None
        and payload.disposition_code.casefold() != ncr.disposition_code.casefold()
    )
    codes = (
        await ncr_code_service.configured_codes(db=db, project=project)
        if needs_codes
        else {}
    )
    # An unchanged code keeps its snapshot even if it was since removed from
    # the project configuration; only a newly chosen code must be configured.
    if (
        payload.failure_code is not None
        and payload.failure_code.casefold() != ncr.failure_code.casefold()
    ):
        failure = ncr_code_service.resolve_code(
            codes, "failure_codes", payload.failure_code, "Failure code"
        )
        updates["failure_code"] = failure["code"]
        updates["failure_code_description"] = failure["description"]
    if (
        payload.disposition_code is not None
        and payload.disposition_code.casefold() != ncr.disposition_code.casefold()
    ):
        disposition = ncr_code_service.resolve_code(
            codes, "disposition_codes", payload.disposition_code, "Disposition code"
        )
        updates["disposition_code"] = disposition["code"]
        updates["disposition_code_description"] = disposition["description"]

    changes = {
        field: {"from": getattr(ncr, field), "to": value}
        for field, value in updates.items()
        if getattr(ncr, field) != value
    }
    if not changes:
        # Nothing changed: commit (a no-op) to release the row lock without
        # expiring loaded attributes, and do not record a history entry.
        await db.commit()
        return await _load_ncr_detail(db=db, ncr=ncr)

    now = datetime.now(UTC)
    if ncr.status == "approved":
        changes["status"] = {"from": "approved", "to": "open"}
        changes["approval_revoked"] = {
            "from": {"approved_by": ncr.approved_by, "approved_at": _iso(ncr)},
            "to": None,
        }
        ncr.status = "open"
        ncr.approved_by = None
        ncr.approved_at = None
    for field, change in changes.items():
        if field in updates:
            setattr(ncr, field, change["to"])
    ncr.version += 1
    ncr.updated_at = now
    ncr.updated_by = user_email
    ncr_repository.add_history_entry(
        db, ncr=ncr, action="updated", actor=user_email, at=now, changes=changes
    )
    await db.commit()
    await db.refresh(ncr)
    audit_repository.log_db_operation(
        "UPDATE",
        "inspection_ncrs",
        ncr.id,
        user_email,
        {"project_id": str(project.id), "fields": sorted(changes)},
    )
    return await _load_ncr_detail(db=db, ncr=ncr)


def _iso(ncr) -> str | None:
    return ncr.approved_at.isoformat() if ncr.approved_at else None


async def approve_ncr(
    *, db, project, part_id, ncr_id, user, expected_version: int | None
) -> dict:
    """Approve an open NCR and record the approver in the history."""
    ensure_can_approve_ncr(project=project, user=user)
    ncr = await _get_live_ncr_for_update(
        db=db, project_id=project.id, part_id=part_id, ncr_id=ncr_id
    )
    _check_version(ncr, expected_version)
    if ncr.status == "approved":
        raise NcrConflictError("NCR is already approved")

    now = datetime.now(UTC)
    ncr.status = "approved"
    ncr.approved_by = user.email
    ncr.approved_at = now
    ncr.version += 1
    ncr.updated_at = now
    ncr.updated_by = user.email
    ncr_repository.add_history_entry(
        db,
        ncr=ncr,
        action="approved",
        actor=user.email,
        at=now,
        changes={
            "status": {"from": "open", "to": "approved"},
            "approved_by": {"from": None, "to": user.email},
        },
    )
    await db.commit()
    await db.refresh(ncr)
    audit_repository.log_db_operation(
        "APPROVE",
        "inspection_ncrs",
        ncr.id,
        user.email,
        {"project_id": str(project.id)},
    )
    return await _load_ncr_detail(db=db, ncr=ncr)


async def delete_ncr(
    *, db, project, part_id, ncr_id, user_email, expected_version: int | None
) -> None:
    """Soft-delete an NCR; it stays in the database with its history."""
    ncr = await _get_live_ncr_for_update(
        db=db, project_id=project.id, part_id=part_id, ncr_id=ncr_id
    )
    _check_version(ncr, expected_version)
    now = datetime.now(UTC)
    ncr.deleted_at = now
    ncr.deleted_by = user_email
    ncr.version += 1
    ncr.updated_at = now
    ncr.updated_by = user_email
    ncr_repository.add_history_entry(
        db,
        ncr=ncr,
        action="deleted",
        actor=user_email,
        at=now,
        changes={"deleted": {"from": False, "to": True}},
    )
    await db.commit()
    audit_repository.log_db_operation(
        "SOFT_DELETE",
        "inspection_ncrs",
        ncr.id,
        user_email,
        {"project_id": str(project.id)},
    )
