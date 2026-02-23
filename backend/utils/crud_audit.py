import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from core import models


async def create_audit_event(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    actor_id: uuid.UUID,
    project_id: uuid.UUID,
    details: Optional[dict] = None,
) -> models.AuditEvent:
    event = models.AuditEvent(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        project_id=project_id,
        details=details,
    )
    db.add(event)
    await db.flush()
    return event


async def get_audit_events_for_project(
    db: AsyncSession,
    project_id: uuid.UUID,
    entity_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[models.AuditEvent]:
    stmt = (
        select(models.AuditEvent)
        .where(models.AuditEvent.project_id == project_id)
    )
    if entity_type:
        stmt = stmt.where(models.AuditEvent.entity_type == entity_type)
    stmt = stmt.order_by(models.AuditEvent.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


async def count_audit_events_for_project(
    db: AsyncSession,
    project_id: uuid.UUID,
    entity_type: Optional[str] = None,
) -> int:
    stmt = (
        select(func.count())
        .select_from(models.AuditEvent)
        .where(models.AuditEvent.project_id == project_id)
    )
    if entity_type:
        stmt = stmt.where(models.AuditEvent.entity_type == entity_type)
    result = await db.execute(stmt)
    return result.scalar_one()
