"""Pydantic schemas for image comments."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from schemas.users import User


class ImageCommentBase(BaseModel):
    """Fields shared by every image comment representation."""

    text: str = Field(..., min_length=1)


class ImageCommentCreate(ImageCommentBase):
    """Request body for creating an image comment."""

    image_id: uuid.UUID
    author_id: uuid.UUID | None = None

    @field_validator("image_id", "author_id", mode="before")
    @classmethod
    def validate_uuid(cls, v):
        """Coerce a string UUID to `uuid.UUID`, leaving `None` as-is."""
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return uuid.UUID(v)
            except ValueError as exc:
                raise ValueError(f"Invalid UUID format: {v}") from exc
        return v


class ImageComment(ImageCommentBase):
    """A stored image comment, with its author expanded."""

    id: uuid.UUID
    image_id: uuid.UUID
    author_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None

    author: User | None = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }
