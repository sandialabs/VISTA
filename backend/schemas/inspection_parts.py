"""Pydantic schemas for inspection batches, parts, ingest, and image assignment."""

# ruff: noqa: D101,D102,D202,E501

import re
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class InspectionBatchBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    owner: str | None = Field(None, max_length=255)
    status: str = Field(
        default="not_started", pattern=r"^(not_started|in_progress|complete)$"
    )


class InspectionBatchCreate(InspectionBatchBase):
    pass


class InspectionBatchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    owner: str | None = Field(None, max_length=255)
    status: str | None = Field(
        default=None, pattern=r"^(not_started|in_progress|complete)$"
    )


class InspectionBatch(InspectionBatchBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class InspectionPartBase(BaseModel):
    serial_number: str = Field(..., min_length=1, max_length=255)
    display_name: str | None = Field(None, max_length=255)
    metadata_json: dict[str, Any] | None = Field(
        None,
        validation_alias="metadata",
        serialization_alias="metadata",
    )
    review_state: str = Field(
        default="unreviewed",
        pattern=r"^(unreviewed|in_review|pass|reject_pending|reject_confirmed)$",
    )

    @field_validator("serial_number")
    @classmethod
    def strip_serial_number(cls, v: str) -> str:
        return v.strip()


class InspectionPartCreate(InspectionPartBase):
    batch_id: uuid.UUID | None = None


class InspectionPartUpdate(BaseModel):
    review_state: str = Field(
        pattern=r"^(unreviewed|in_review|pass|reject_pending|reject_confirmed)$"
    )


class InspectionPartBatchAssignmentRequest(BaseModel):
    part_id: uuid.UUID
    to_batch_id: uuid.UUID | None = None


class InspectionPartBatchAssignmentResponse(BaseModel):
    project_id: uuid.UUID
    part_id: uuid.UUID
    to_batch_id: uuid.UUID | None = None


class InspectionPartManualFlagUpdateRequest(BaseModel):
    manual_flagged: bool = False


class InspectionPartImageDisplayOrderUpdateRequest(BaseModel):
    image_refs: list[str] = Field(..., min_length=1, max_length=1000)

    @field_validator("image_refs", mode="before")
    @classmethod
    def normalize_image_refs(cls, value):
        if not isinstance(value, (list, tuple)):
            raise ValueError("image_refs must be an array")
        normalized: list[str] = []
        seen: set[str] = set()
        for image_ref in value:
            if not isinstance(image_ref, str):
                raise ValueError("image_refs must contain only strings")
            safe_ref = image_ref.strip()
            if not safe_ref:
                raise ValueError("image_refs must not contain blank references")
            if len(safe_ref) > 2048:
                raise ValueError("image references must be 2048 characters or fewer")
            if safe_ref in seen:
                raise ValueError("image_refs must not contain duplicate references")
            seen.add(safe_ref)
            normalized.append(safe_ref)
        return normalized


class InspectionPartMetadataSourcesUpdateRequest(BaseModel):
    metadata_source_keys: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("metadata_source_keys")
    @classmethod
    def normalize_metadata_source_keys(cls, v: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for key in v or []:
            safe_key = str(key or "").strip()
            if not safe_key or safe_key in seen:
                continue
            if len(safe_key) > 255:
                raise ValueError("metadata source keys must be 255 characters or fewer")
            seen.add(safe_key)
            normalized.append(safe_key)
        return normalized


class InspectionPartSourceImageUpdateRequest(BaseModel):
    crop_subtitle: str | None = Field(default=None, max_length=255)
    hidden: bool | None = None
    overlay_color: str | None = Field(default=None, max_length=32)
    overlay_opacity: float | None = Field(default=None, ge=0.0, le=1.0)

    @field_validator("overlay_color")
    @classmethod
    def validate_overlay_color(cls, value: str | None) -> str | None:
        if value is None:
            return value
        color = value.strip()
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("overlay_color must be a #RRGGBB hex color")
        return color


class InspectionPart(InspectionPartBase):
    id: uuid.UUID
    project_id: uuid.UUID
    batch_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class InspectionIngestPartRecord(BaseModel):
    serial_number: str = Field(..., min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    metadata_json: dict[str, Any] | None = Field(
        default=None,
        validation_alias="metadata",
        serialization_alias="metadata",
    )
    review_state: str = Field(
        default="unreviewed",
        pattern=r"^(unreviewed|in_review|pass|reject_pending|reject_confirmed)$",
    )

    @field_validator("serial_number")
    @classmethod
    def strip_serial_number(cls, v: str) -> str:
        return v.strip()


class InspectionIngestBatchRecord(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    parts: list[InspectionIngestPartRecord] = Field(default_factory=list)


class InspectionBulkIngestPayload(BaseModel):
    batches: list[InspectionIngestBatchRecord] = Field(default_factory=list)
    unassigned_parts: list[InspectionIngestPartRecord] = Field(default_factory=list)


class InspectionIngestDiscrepancy(BaseModel):
    code: str
    batch_name: str
    serial_number: str | None = None
    message: str


class InspectionBulkIngestResponse(BaseModel):
    project_id: uuid.UUID
    counters: dict[str, int]
    discrepancies: list[InspectionIngestDiscrepancy] = Field(default_factory=list)


class InspectionPartImageAssignmentRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=1024)
    image_id: uuid.UUID | None = None
    to_part_id: uuid.UUID | None = None


class InspectionPartImageAssignmentResponse(BaseModel):
    project_id: uuid.UUID
    filename: str
    from_part_id: uuid.UUID | None = None
    to_part_id: uuid.UUID | None = None


class InspectionOverlayAssignmentRequest(BaseModel):
    overlay_filename: str = Field(..., min_length=1, max_length=1024)
    overlay_image_id: uuid.UUID | None = None
    base_filename: str | None = Field(default=None, max_length=1024)
    base_image_id: uuid.UUID | None = None


class InspectionOverlayAssignmentResponse(BaseModel):
    project_id: uuid.UUID
    overlay_filename: str
    base_filename: str | None = None
    from_part_id: uuid.UUID | None = None
    to_part_id: uuid.UUID | None = None
