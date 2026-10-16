"""Database access helpers for projects."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories.audit import log_db_operation
from schemas import projects as project_schemas


async def get_project(db: AsyncSession, project_id: uuid.UUID) -> models.Project | None:
    """Return a project by ID."""
    result = await db.execute(
        select(models.Project).where(models.Project.id == project_id)
    )
    return result.scalars().first()


async def get_projects_by_group_ids(
    db: AsyncSession, group_ids: list[str], skip: int = 0, limit: int = 100
) -> list[models.Project]:
    """Return projects accessible through any of the supplied group IDs."""
    if not group_ids:
        return []
    result = await db.execute(
        select(models.Project)
        .where(models.Project.meta_group_id.in_(group_ids))
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_all_projects(
    db: AsyncSession, skip: int = 0, limit: int = 100, include_archived: bool = True
) -> list[models.Project]:
    """Get all projects in the database."""
    query = select(models.Project)
    if not include_archived:
        query = query.where(models.Project.is_archived.is_(False))
    result = await db.execute(query.offset(skip).limit(limit))
    return list(result.scalars().all())


async def create_project(
    db: AsyncSession,
    project: project_schemas.ProjectCreate,
    created_by: str | None = None,
) -> models.Project:
    """Create a project and record an audit event."""
    db_project = models.Project(**project.model_dump(), created_by=created_by)
    db.add(db_project)
    await db.commit()
    await db.refresh(db_project)

    log_db_operation(
        "CREATE",
        "projects",
        db_project.id,
        created_by or "system",
        {"name": project.name, "meta_group_id": project.meta_group_id},
    )
    return db_project


async def get_project_dashboard_counts(
    db: AsyncSession,
    project_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, int]]:
    """Return active image and inspection part counts for dashboard project cards."""
    counts = {
        project_id: {"image_count": 0, "part_count": 0} for project_id in project_ids
    }
    if not project_ids:
        return counts

    image_rows = await db.execute(
        select(models.DataInstance.project_id, func.count(models.DataInstance.id))
        .where(
            models.DataInstance.project_id.in_(project_ids),
            models.DataInstance.deleted_at.is_(None),
        )
        .group_by(models.DataInstance.project_id)
    )
    for project_id, count in image_rows:
        counts[project_id]["image_count"] = count

    part_rows = await db.execute(
        select(models.InspectionPart.project_id, func.count(models.InspectionPart.id))
        .where(models.InspectionPart.project_id.in_(project_ids))
        .group_by(models.InspectionPart.project_id)
    )
    for project_id, count in part_rows:
        counts[project_id]["part_count"] = count

    return counts


async def archive_project(
    db: AsyncSession, project_id: uuid.UUID, archived_by: str | None = None
) -> models.Project | None:
    """Archive a project, making it read-only and hidden by default."""
    project = await get_project(db, project_id)
    if project is None:
        return None
    project.is_archived = True
    project.archived_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(project)
    log_db_operation("ARCHIVE", "projects", project_id, archived_by or "system", {})
    return project


async def unarchive_project(
    db: AsyncSession, project_id: uuid.UUID, unarchived_by: str | None = None
) -> models.Project | None:
    """Unarchive a project, restoring full access."""
    project = await get_project(db, project_id)
    if project is None:
        return None
    project.is_archived = False
    project.archived_at = None
    await db.commit()
    await db.refresh(project)
    log_db_operation("UNARCHIVE", "projects", project_id, unarchived_by or "system", {})
    return project


async def update_project(
    db: AsyncSession,
    project_id: uuid.UUID,
    project: project_schemas.ProjectUpdate,
    updated_by: str | None = None,
) -> models.Project | None:
    """Update a project and record an audit event when fields changed."""
    db_project = await get_project(db, project_id)
    if db_project is None:
        return None

    updates = project.model_dump(exclude_unset=True)
    if not updates:
        return db_project

    for key, value in updates.items():
        setattr(db_project, key, value)

    await db.commit()
    await db.refresh(db_project)
    log_db_operation(
        "UPDATE",
        "projects",
        db_project.id,
        updated_by or "system",
        {"changes": updates},
    )
    return db_project


async def delete_project(
    db: AsyncSession,
    project_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    """Delete a project and record an audit event."""
    db_project = await get_project(db, project_id)
    if db_project is None:
        return False

    await db.delete(db_project)
    await db.commit()
    log_db_operation("DELETE", "projects", project_id, deleted_by or "system", {})
    return True
