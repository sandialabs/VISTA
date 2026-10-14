"""Pydantic schemas for projects."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from core.project_types import DEFAULT_PROJECT_TYPE, PROJECT_TYPE_PATTERN


class ProjectBase(BaseModel):
    """Shared project fields."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    meta_group_id: str = Field(..., min_length=1, max_length=255)
    project_type: str = Field(
        default=DEFAULT_PROJECT_TYPE, pattern=PROJECT_TYPE_PATTERN
    )

    @field_validator("project_type", mode="before")
    @classmethod
    def normalize_project_type(cls, v: str) -> str:
        """Normalize project type identifiers."""
        if isinstance(v, str):
            return v.strip().upper()
        return v


class ProjectCreate(ProjectBase):
    """Input schema for creating a project."""


class ProjectUpdate(BaseModel):
    """Input schema for updating project fields."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    meta_group_id: str | None = Field(default=None, min_length=1, max_length=255)
    project_type: str | None = Field(default=None, pattern=PROJECT_TYPE_PATTERN)

    @field_validator("project_type", mode="before")
    @classmethod
    def normalize_project_type(cls, v: str | None) -> str | None:
        """Normalize project type identifiers when provided."""
        if isinstance(v, str):
            return v.strip().upper()
        return v


class ProjectDeleteRequest(BaseModel):
    """Confirmation payload for destructive project deletion."""

    confirmation_phrase: str = Field(..., min_length=1, max_length=512)


class ProjectDeleteResponse(BaseModel):
    """Response schema for destructive project deletion."""

    project_id: uuid.UUID
    deleted: bool = True
    deleted_by: EmailStr


class Project(ProjectBase):
    """Response schema for a project."""

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
    created_by: str | None = None
    is_archived: bool = False
    archived_at: datetime | None = None
    image_count: int = 0
    part_count: int = 0

    model_config = {"from_attributes": True, "populate_by_name": True}


class ProjectDataSummary(BaseModel):
    """Small aggregate used when opening a project with a large data set."""

    project_id: uuid.UUID
    active_image_count: int = Field(ge=0)
    deleted_image_count: int = Field(ge=0)
    total_image_bytes: int = Field(ge=0)
    part_count: int = Field(ge=0)
    image_metadata_fields: int = Field(
        ge=0,
        description="Total number of top-level metadata fields across active images",
    )
    annotation_count: int = Field(ge=0)
    overlay_layer_count: int = Field(ge=0)
