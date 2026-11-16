"""Persistence helpers for inspection nonconformance reports (NCRs)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models


async def lock_project_for_ncr_numbering(
    db: AsyncSession, project_id: uuid.UUID
) -> None:
    """Hold the project row lock so concurrent creates get distinct numbers.

    PostgreSQL serializes on the row lock; SQLite ignores ``FOR UPDATE`` but
    serializes writers itself. The unique constraint is the final backstop.
    """
    # FOR NO KEY UPDATE serializes NCR creates without conflicting with the
    # FOR KEY SHARE locks taken by ordinary inserts referencing the project.
    await db.execute(
        select(models.Project.id)
        .where(models.Project.id == project_id)
        .with_for_update(key_share=True)
    )


async def next_ncr_number(db: AsyncSession, project_id: uuid.UUID) -> int:
    """Return the next per-project NCR number, counting soft-deleted NCRs."""
    result = await db.execute(
        select(func.max(models.InspectionNcr.ncr_number)).where(
            models.InspectionNcr.project_id == project_id
        )
    )
    current = result.scalar_one_or_none()
    return int(current or 0) + 1


async def get_ncr(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID | None,
    ncr_id: uuid.UUID,
    for_update: bool = False,
) -> models.InspectionNcr | None:
    """Return an NCR scoped to its project (and part when given)."""
    stmt = select(models.InspectionNcr).where(
        models.InspectionNcr.project_id == project_id,
        models.InspectionNcr.id == ncr_id,
    )
    if part_id is not None:
        stmt = stmt.where(models.InspectionNcr.part_id == part_id)
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def list_ncrs(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID | None = None,
    include_deleted: bool = False,
) -> list[models.InspectionNcr]:
    """List NCRs for a project, optionally limited to one part."""
    stmt = select(models.InspectionNcr).where(
        models.InspectionNcr.project_id == project_id
    )
    if part_id is not None:
        stmt = stmt.where(models.InspectionNcr.part_id == part_id)
    if not include_deleted:
        stmt = stmt.where(models.InspectionNcr.deleted_at.is_(None))
    stmt = stmt.order_by(models.InspectionNcr.ncr_number)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def list_ncr_history(
    db: AsyncSession, *, ncr_id: uuid.UUID
) -> list[models.InspectionNcrHistory]:
    """Return an NCR's change history, oldest first."""
    result = await db.execute(
        select(models.InspectionNcrHistory)
        .where(models.InspectionNcrHistory.ncr_id == ncr_id)
        .order_by(models.InspectionNcrHistory.version)
    )
    return list(result.scalars().all())


def add_history_entry(
    db: AsyncSession,
    *,
    ncr: models.InspectionNcr,
    action: str,
    actor: str,
    at: datetime,
    changes: dict,
) -> models.InspectionNcrHistory:
    """Stage one append-only history row for the NCR's current version."""
    entry = models.InspectionNcrHistory(
        id=uuid.uuid4(),
        ncr_id=ncr.id,
        project_id=ncr.project_id,
        version=ncr.version,
        action=action,
        actor=actor,
        at=at,
        changes=changes,
    )
    db.add(entry)
    return entry
