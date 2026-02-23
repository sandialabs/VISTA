import uuid
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.schemas import User, AuditEventList, AuditEvent
from utils.dependencies import get_current_user, get_project_or_403
from utils.crud_audit import get_audit_events_for_project, count_audit_events_for_project
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(tags=["audit"])


@router.get("/projects/{project_id}/audit-events", response_model=AuditEventList)
async def list_audit_events_endpoint(
    project_id: uuid.UUID,
    entity_type: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    events = await get_audit_events_for_project(db, project_id, entity_type, skip, limit)
    total = await count_audit_events_for_project(db, project_id, entity_type)
    return AuditEventList(
        events=[AuditEvent.model_validate(e) for e in events],
        total=total,
    )
