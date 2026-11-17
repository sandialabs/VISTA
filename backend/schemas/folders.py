"""Pydantic schemas for dashboard folders and dashboard listings."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from schemas.projects import Project

FOLDER_NAME_MAX = 255
FOLDER_DESCRIPTION_MAX = 4000


_BIDI_CONTROLS = {
    "\u200e",
    "\u200f",
    "\u202a",
    "\u202b",
    "\u202c",
    "\u202d",
    "\u202e",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
}


def clean_folder_name(value: str) -> str:
    """Validated folder name: NFC-normalized, without control, zero-width or
    bidi-override characters, inner whitespace collapsed, 1..255 chars."""
    import unicodedata

    if not isinstance(value, str):
        raise ValueError("Folder name must be text.")
    value = unicodedata.normalize("NFC", value)
    kept = "".join(ch for ch in value if ch.isprintable() and ch not in _BIDI_CONTROLS)
    cleaned = " ".join(kept.split())
    if not cleaned:
        raise ValueError("Folder name is required.")
    if len(cleaned) > FOLDER_NAME_MAX:
        raise ValueError(f"Folder name must be at most {FOLDER_NAME_MAX} characters.")
    return cleaned


class FolderCreate(BaseModel):
    meta_group_id: str = Field(..., min_length=1, max_length=255)
    parent_id: uuid.UUID | None = None
    name: str
    description: str | None = Field(default=None, max_length=FOLDER_DESCRIPTION_MAX)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return clean_folder_name(v)

    @field_validator("meta_group_id")
    @classmethod
    def _strip_group(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Access group is required.")
        return v


class FolderUpdate(BaseModel):
    name: str | None = None
    description: str | None = Field(default=None, max_length=FOLDER_DESCRIPTION_MAX)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else clean_folder_name(v)


class FolderMoveRequest(BaseModel):
    parent_id: uuid.UUID | None = None


class FolderDeleteRequest(BaseModel):
    confirmation_phrase: str = Field(..., min_length=1, max_length=1024)


class Folder(BaseModel):
    id: uuid.UUID
    meta_group_id: str
    parent_id: uuid.UUID | None = None
    name: str
    description: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_archived: bool = False
    archived_at: datetime | None = None
    archived_by: str | None = None
    # Derived fields.
    effective_archived: bool = False
    locked_by_folder_id: uuid.UUID | None = None
    # Newest of the folder's own activity and every project below it.
    last_edited_at: datetime | None = None
    project_count: int = 0
    total_project_count: int = 0
    folder_count: int = 0
    path: list[dict] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class FolderTree(BaseModel):
    meta_group_id: str
    folders: list[Folder]
    root_project_count: int = 0
    total_project_count: int = 0


class FolderDeletePreview(BaseModel):
    folder_id: uuid.UUID
    name: str
    folders: int
    projects: int
    images: int
    confirmation_phrase: str


class FolderDeleteResponse(BaseModel):
    folder_id: uuid.UUID
    deleted: bool = True
    folders_deleted: int
    projects_deleted: int


class DashboardItemRef(BaseModel):
    type: Literal["project", "folder"]
    id: uuid.UUID


class BulkMoveRequest(BaseModel):
    items: list[DashboardItemRef] = Field(..., min_length=1, max_length=1000)
    target_folder_id: uuid.UUID | None = None


class BulkArchiveRequest(BaseModel):
    items: list[DashboardItemRef] = Field(..., min_length=1, max_length=1000)
    archived: bool = True


class BulkItemResult(BaseModel):
    type: Literal["project", "folder"]
    id: uuid.UUID
    ok: bool
    detail: str | None = None
    # For undo: where the item was before the move.
    previous_folder_id: uuid.UUID | None = None


class BulkResult(BaseModel):
    ok: bool
    results: list[BulkItemResult]


class DashboardItems(BaseModel):
    meta_group_id: str
    folder_id: uuid.UUID | None = None
    # The folder being listed (path + lock state), even when it is archived
    # and therefore absent from the default tree.
    current_folder: Folder | None = None
    query: str | None = None
    recursive: bool = False
    folders: list[Folder]
    projects: list[Project]
    total_folders: int
    total_projects: int
    offset: int
    limit: int
