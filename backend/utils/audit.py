import logging
import uuid
from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import AuditEvent

logger = logging.getLogger(__name__)


async def log_audit_event(
    db: AsyncSession,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    actor_user_id: uuid.UUID,
    details: Optional[Dict[str, Any]] = None,
) -> AuditEvent:
    """Record an audit event for any tracked entity."""
    event = AuditEvent(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_user_id=actor_user_id,
        details=details,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event
