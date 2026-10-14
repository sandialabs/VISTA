"""Pydantic schemas for API keys."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ApiKeyBase(BaseModel):
    """Shared API key fields."""

    name: str = Field(..., min_length=1, max_length=255)


class ApiKeyCreate(ApiKeyBase):
    """Input schema for creating an API key."""


class ApiKey(ApiKeyBase):
    """Response schema for an API key."""

    id: uuid.UUID
    user_id: uuid.UUID
    is_active: bool
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ApiKeyCreateResponse(BaseModel):
    """Create response containing the API key value shown only once."""

    api_key: ApiKey
    key: str
