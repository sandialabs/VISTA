"""Pydantic schemas for image classes and image classifications."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ImageClassBase(BaseModel):
    """Fields shared by every image class representation."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class ImageClassCreate(ImageClassBase):
    """Request body for creating an image class."""

    project_id: uuid.UUID


class ImageClass(ImageClassBase):
    """A stored image class."""

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }


class ImageClassificationBase(BaseModel):
    """Fields shared by every image classification representation."""

    image_id: uuid.UUID
    class_id: uuid.UUID

    @field_validator("image_id", "class_id", mode="before")
    @classmethod
    def validate_uuid(cls, v):
        """Coerce a string UUID to `uuid.UUID`, leaving other values as-is."""
        if isinstance(v, str):
            try:
                return uuid.UUID(v)
            except ValueError as exc:
                raise ValueError(f"Invalid UUID format: {v}") from exc
        return v


class ImageClassificationCreate(ImageClassificationBase):
    """Request body for creating an image classification."""

    created_by_id: uuid.UUID | None = None


class ImageClassification(ImageClassificationBase):
    """A stored image classification."""

    id: uuid.UUID
    created_by_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }
