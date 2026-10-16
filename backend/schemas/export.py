"""Pydantic schemas for export and backup API routes."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from services.export.storage import parse_backup_s3_url


class S3BundleLocation(BaseModel):
    """Location of a project or dashboard backup object in S3-compatible storage."""

    s3_url: str = Field(..., min_length=1, max_length=2048)

    @field_validator("s3_url")
    @classmethod
    def validate_s3_url(cls, value: str) -> str:
        """Reject an `s3_url` that has no object key, only a bucket/prefix."""
        cleaned = value.strip()
        bucket, key = parse_backup_s3_url(cleaned)
        if not bucket or not key or key.endswith("/"):
            raise ValueError(
                "S3 URL must include a destination object key, "
                "not just a bucket or prefix."
            )
        return cleaned


class S3ProjectExportRequest(S3BundleLocation):
    """Request body for exporting a project backup to S3."""

    include_images: bool = True
    include_overlays: bool = True
    include_metadata: bool = True
    include_created_overlays: bool = True
    include_project_configuration: bool = True
    include_deleted: bool = False


class S3ProjectImportRequest(S3BundleLocation):
    """Request body for importing a project backup from S3."""

    mode: str = "append_active"
    confirmation: str = ""


class S3DashboardExportRequest(S3BundleLocation):
    """Request body for exporting a dashboard backup to S3."""

    include_images: bool = True
    include_overlays: bool = True
    include_metadata: bool = True
    include_created_overlays: bool = True
    include_project_configuration: bool = True
    include_deleted: bool = False
    include_archived: bool = False
    include_ui_state: bool = True
    dashboard_state: dict[str, Any] = Field(default_factory=dict)
    limit: int = 1000


class S3DashboardImportRequest(S3BundleLocation):
    """Request body for importing a dashboard backup from S3."""

    mode: str = "restore_as_new"
    confirmation: str = ""
