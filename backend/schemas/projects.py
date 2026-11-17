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

    @field_validator("meta_group_id", mode="before")
    @classmethod
    def strip_meta_group_id(cls, v):
        """Membership checks compare trimmed IDs; store them trimmed too."""
        return v.strip() if isinstance(v, str) else v

    @field_validator("project_type", mode="before")
    @classmethod
    def normalize_project_type(cls, v: str) -> str:
        """Normalize project type identifiers."""
        if isinstance(v, str):
            return v.strip().upper()
        return v


class ProjectCreate(ProjectBase):
    """Input schema for creating a project."""

    # Dashboard folder to create the project in (None = access-group root).
    folder_id: uuid.UUID | None = None


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

    @field_validator("name", "project_type")
    @classmethod
    def reject_explicit_null(cls, v):
        """``name``/``project_type`` may be omitted but not set to null."""
        if v is None:
            raise ValueError("must not be null")
        return v

    @field_validator("meta_group_id", mode="before")
    @classmethod
    def strip_meta_group_id(cls, v):
        return v.strip() if isinstance(v, str) else v


class ProjectDeleteRequest(BaseModel):
    """Confirmation payload for destructive project deletion."""

    confirmation_phrase: str = Field(..., min_length=1, max_length=512)


class ProjectDeleteResponse(BaseModel):
    """Response schema for destructive project deletion."""

    project_id: uuid.UUID
    deleted: bool = True
    deleted_by: EmailStr


class FolderPathEntry(BaseModel):
    """One folder on the path from the access-group root to a project."""

    id: uuid.UUID
    name: str


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
    folder_id: uuid.UUID | None = None
    last_activity_at: datetime | None = None
    # Root-first folder path; filled by dashboard/project-detail responses.
    folder_path: list[FolderPathEntry] = Field(default_factory=list)
    # Archived itself, or inside an archived folder.
    effective_archived: bool = False
    locked_by_folder_id: uuid.UUID | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ProjectMoveRequest(BaseModel):
    """Move a project to another folder (None = access-group root)."""

    folder_id: uuid.UUID | None = None


class ProjectPage(BaseModel):
    """A page of projects plus the exact total for the filter."""

    items: list[Project]
    total: int
    offset: int
    limit: int


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
