"""Pydantic schemas for image deletion audit events."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ImageDeletionEvent(BaseModel):
    """Response schema for one image deletion audit event."""

    id: uuid.UUID
    image_id: uuid.UUID
    project_id: uuid.UUID
    actor_user_id: uuid.UUID | None = None
    action: str
    reason: str | None = None
    storage_deleted: bool
    previous_state: dict[str, Any] | None = None
    at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class ImageDeletionEventList(BaseModel):
    """Paginated image deletion audit event response."""

    events: list[ImageDeletionEvent]
    total: int
