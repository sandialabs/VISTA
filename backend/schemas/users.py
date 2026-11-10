"""Pydantic schemas for users."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


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
    # Set only on a request made with an API key that carries its own groups; never
    # serialized. core.group_auth_helper.is_user_in_group answers from it.
    key_groups: frozenset[str] | None = Field(default=None, exclude=True)

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }
