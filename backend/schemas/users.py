"""Pydantic schemas for users."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    """Fields shared by every user representation."""

    email: EmailStr
    username: str | None = None
    is_active: bool = True
    groups: list[str] | None = None


class UserCreate(UserBase):
    """Request body for creating a user."""


class User(UserBase):
    """A stored user."""

    id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }
