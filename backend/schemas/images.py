"""Pydantic schemas for image data instances and batch uploads."""

import json
import logging
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from core.config import settings

logger = logging.getLogger(__name__)


class DataInstanceBase(BaseModel):
    """Shared image data-instance fields."""

    filename: str
    content_type: str | None = None
    size_bytes: int | None = None
    metadata_: dict[str, Any] | None = Field(None, alias="metadata")


class DataInstanceCreate(DataInstanceBase):
    """Input schema for creating an image data instance."""

    project_id: uuid.UUID
    object_storage_key: str
    uploaded_by_user_id: str
    uploader_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None


class DataInstance(DataInstanceBase):
    """Response schema for an image data instance."""

    id: uuid.UUID
    project_id: uuid.UUID
    group_id: uuid.UUID | None = None
    object_storage_key: str
    uploaded_by_user_id: str
    uploader_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime | None = None
    deleted_at: datetime | None = None
    deleted_by_user_id: uuid.UUID | None = None
    deletion_reason: str | None = None
    pending_hard_delete_at: datetime | None = None
    hard_deleted_at: datetime | None = None
    hard_deleted_by_user_id: uuid.UUID | None = None
    storage_deleted: bool = False

    @field_validator("metadata_", mode="before")
    @classmethod
    def validate_metadata(cls, value: Any) -> dict[str, Any] | None:
        """Normalize metadata from ORM, JSON, mapping, or null inputs."""
        if value is None:
            return None

        if isinstance(value, dict):
            return value

        if hasattr(value, "__class__") and value.__class__.__name__ == "MetaData":
            return {}

        try:
            if hasattr(value, "_asdict"):
                return value._asdict()
            if hasattr(value, "items"):
                return dict(value.items())
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return {"value": value}
        except (TypeError, ValueError, AttributeError):
            logger.warning(
                "Failed to parse JSON value, using default",
                extra={"value_type": type(value).__name__},
            )

        return {}

    model_config = {"from_attributes": True, "populate_by_name": True}


class DataInstancePage(BaseModel):
    """A stable keyset page of project images."""

    items: list[DataInstance]
    total: int = Field(ge=0)
    next_cursor: str | None = None
    has_more: bool


class BatchImageUploadManifestEntry(BaseModel):
    """One positional file entry in a multipart batch image upload."""

    client_index: int = Field(..., ge=0, strict=True)
    filename: str = Field(..., min_length=1, max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)
    group_identifier: str | None = Field(default=None, max_length=255)

    @field_validator("filename")
    @classmethod
    def validate_batch_filename(cls, value: str) -> str:
        """Reject blank, path-like, or control-character filenames."""
        filename = value.strip()
        if not filename or filename in {".", ".."}:
            raise ValueError("filename must not be blank")
        if (
            "/" in filename
            or "\\" in filename
            or any(ord(character) < 32 for character in filename)
        ):
            raise ValueError(
                "filename must not contain path separators or control characters"
            )
        return filename

    @field_validator("group_identifier")
    @classmethod
    def normalize_batch_group_identifier(cls, value: str | None) -> str | None:
        """Normalize optional batch-upload group identifiers."""
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class BatchImageUploadSuccess(BaseModel):
    """One successful image entry in a batch upload response."""

    client_index: int
    image: DataInstance


class BatchImageUploadFailure(BaseModel):
    """One failed image entry in a batch upload response."""

    client_index: int
    filename: str
    code: str
    detail: str


class BatchImageUploadResponse(BaseModel):
    """Response schema for multipart batch image uploads."""

    uploaded: list[BatchImageUploadSuccess] = Field(default_factory=list)
    failed: list[BatchImageUploadFailure] = Field(default_factory=list)


class S3ListRequest(BaseModel):
    """Request body for listing importable objects under an S3 URL."""

    s3_url: str
    max_keys: int = settings.MAX_S3_LIST_KEYS or 5000


class S3ObjectSummary(BaseModel):
    """Summary of one importable S3 object."""

    key: str
    filename: str
    size: int
    content_type: str | None = None
    last_modified: str | None = None


class S3ListResponse(BaseModel):
    """Response body for listing importable S3 objects."""

    bucket: str
    prefix: str
    objects: list[S3ObjectSummary]
    truncated: bool = False


class S3ImportRequest(BaseModel):
    """Request body for importing selected S3 objects into a project."""

    s3_url: str
    keys: list[str]
    metadata: dict[str, Any] | None = None
    per_file_metadata: dict[str, dict[str, Any]] | None = None
    group_identifiers: dict[str, str] | None = None


class S3ImportResponse(BaseModel):
    """Response body for importing selected S3 objects into a project."""

    imported: list[DataInstance]
    failed: list[dict[str, str]]


class MetadataUpdate(BaseModel):
    """Request body for updating one image metadata field."""

    key: str
    value: Any


class ImageDeleteRequest(BaseModel):
    """Request body for soft-deleting an image."""

    reason: str
    force: bool | None = False
