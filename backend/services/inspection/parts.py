"""Inspection part service operations."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

from repositories import inspection as inspection_repository
from services.errors import ConflictError, NotFoundError, ValidationFailedError


class PartBatchMismatchError(ValidationFailedError, ValueError):
    """Raised when a part references a batch outside the target project."""


class PartNotFoundError(NotFoundError, ValueError):
    """Raised when an inspection part cannot be found."""

    default_detail = "Inspection part not found"


class PartSerialConflictError(ConflictError, ValueError):
    """Raised when a part serial number conflicts within a project."""


def serialize_inspection_part(part) -> dict:
    """Serialize an inspection part ORM object for API responses."""
    return {
        "id": part.id,
        "project_id": part.project_id,
        "batch_id": part.batch_id,
        "serial_number": part.serial_number,
        "display_name": part.display_name,
        "metadata": part.metadata_json,
        "review_state": part.review_state,
        "created_at": part.created_at,
        "updated_at": part.updated_at,
    }


async def create_inspection_part(*, db, project_id, part, created_by: str) -> dict:
    """Create an inspection part and serialize it for API responses."""
    if part.batch_id:
        batch = await inspection_repository.get_inspection_batch(
            db=db,
            batch_id=part.batch_id,
        )
        if not batch or batch.project_id != project_id:
            raise PartBatchMismatchError("batch_id does not belong to this project")

    try:
        created = await inspection_repository.create_inspection_part(
            db=db,
            project_id=project_id,
            part=part,
            created_by=created_by,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise PartSerialConflictError(
            "Serial number already exists in this project"
        ) from exc
    return serialize_inspection_part(created)


async def list_inspection_parts(
    *, db, project_id, batch_id=None, review_state: str | None = None
) -> list[dict]:
    """List inspection parts and serialize them for API responses."""
    parts = await inspection_repository.list_inspection_parts(
        db=db,
        project_id=project_id,
        batch_id=batch_id,
        review_state=review_state,
    )
    return [serialize_inspection_part(part) for part in parts]


async def delete_all_inspection_parts(*, db, project_id, deleted_by: str) -> None:
    """Delete all inspection parts for a project."""
    await inspection_repository.delete_all_inspection_parts(
        db=db,
        project_id=project_id,
        deleted_by=deleted_by,
    )


async def delete_inspection_part(*, db, project_id, part_id, deleted_by: str) -> None:
    """Delete a single inspection part."""
    deleted = await inspection_repository.delete_inspection_part(
        db=db,
        project_id=project_id,
        part_id=part_id,
        deleted_by=deleted_by,
    )
    if not deleted:
        raise PartNotFoundError("Inspection part not found")


async def assign_part_to_batch(
    *, db, project_id, part_id, to_batch_id, updated_by: str
) -> dict:
    """Move a part into a batch of the same project, or clear its batch."""
    if to_batch_id:
        batch = await inspection_repository.get_inspection_batch(
            db=db, batch_id=to_batch_id
        )
        if not batch or batch.project_id != project_id:
            raise PartBatchMismatchError("to_batch_id does not belong to this project")
    updated = await inspection_repository.update_inspection_part_batch_assignment(
        db=db,
        project_id=project_id,
        part_id=part_id,
        to_batch_id=to_batch_id,
        updated_by=updated_by,
    )
    if not updated:
        raise PartNotFoundError("Inspection part not found")
    return {"project_id": project_id, "part_id": part_id, "to_batch_id": to_batch_id}
