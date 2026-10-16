"""Pydantic schemas for project metadata."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProjectMetadataBase(BaseModel):
    """Shared project metadata fields."""

    key: str = Field(..., min_length=1, max_length=255)
    value: Any = None


class ProjectMetadataCreate(ProjectMetadataBase):
    """Input schema for creating project metadata."""

    project_id: uuid.UUID


class ProjectMetadata(ProjectMetadataBase):
    """Response schema for project metadata."""

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class PresignedUrlResponse(BaseModel):
    """Response schema for generated object-storage URLs."""

    url: str
    object_key: str
    method: str = "GET"
