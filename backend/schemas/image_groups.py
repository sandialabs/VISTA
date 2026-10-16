"""Pydantic schemas for image groups."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ImageGroupBase(BaseModel):
    """Shared image group fields."""

    identifier: str = Field(..., min_length=1, max_length=255)
    display_name: str | None = Field(None, max_length=255)

    @field_validator("identifier")
    @classmethod
    def strip_identifier(cls, v: str) -> str:
        """Normalize image group identifiers."""
        return v.strip()


class ImageGroupCreate(ImageGroupBase):
    """Input schema for creating an image group."""

    project_id: uuid.UUID


class ImageGroupUpdate(BaseModel):
    """Input schema for updating image group fields."""

    identifier: str | None = Field(None, min_length=1, max_length=255)
    display_name: str | None = Field(None, max_length=255)

    @field_validator("identifier")
    @classmethod
    def strip_identifier(cls, v: str | None) -> str | None:
        """Normalize image group identifiers when provided."""
        return v.strip() if v is not None else v


class ImageGroup(ImageGroupBase):
    """Response schema for an image group."""

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
    image_count: int | None = None
    aggregate_review_status: str | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ImageGroupList(BaseModel):
    """Paginated image group response."""

    groups: list[ImageGroup]
    total: int
