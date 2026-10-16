"""Inspection batch service operations."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

from repositories import inspection as inspection_repository
from services.errors import ConflictError, NotFoundError


class BatchNameConflictError(ConflictError, ValueError):
    """Raised when a batch name conflicts within a project."""


class BatchNotFoundError(NotFoundError, ValueError):
    """Raised when an inspection batch cannot be found."""

    default_detail = "Inspection batch not found"


async def create_inspection_batch(*, db, project_id, batch, created_by: str):
    """Create an inspection batch for a project."""
    try:
        return await inspection_repository.create_inspection_batch(
            db=db,
            project_id=project_id,
            batch=batch,
            created_by=created_by,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise BatchNameConflictError(
            "Batch name already exists in this project"
        ) from exc


async def list_inspection_batches(*, db, project_id):
    """List inspection batches for a project."""
    return await inspection_repository.list_inspection_batches(
        db=db,
        project_id=project_id,
    )


async def delete_inspection_batch(*, db, project_id, batch_id, deleted_by: str) -> None:
    """Delete an inspection batch, moving any child parts to unassigned."""
    deleted = await inspection_repository.delete_inspection_batch(
        db=db,
        project_id=project_id,
        batch_id=batch_id,
        deleted_by=deleted_by,
    )
    if not deleted:
        raise BatchNotFoundError("Inspection batch not found")


async def update_inspection_batch(*, db, project_id, batch_id, patch, updated_by: str):
    """Update an inspection batch."""
    try:
        updated = await inspection_repository.update_inspection_batch(
            db=db,
            project_id=project_id,
            batch_id=batch_id,
            patch=patch,
            updated_by=updated_by,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise BatchNameConflictError(
            "Batch name already exists in this project"
        ) from exc
    if not updated:
        raise BatchNotFoundError("Inspection batch not found")
    return updated
