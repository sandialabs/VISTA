"""Pydantic schemas for Analyze API routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from analyze_toolbox import ToolboxExecutionResult, WorkflowInputSource


class AnalyzeImageSourceRecord(BaseModel):
    """Image source record returned by Analyze source discovery."""

    image_id: uuid.UUID | None = None
    filename: str
    part_id: uuid.UUID
    part_serial_number: str
    part_display_name: str | None = None
    modality: str | None = None
    side: str | None = None
    overlay: bool = False
    slice_axis: str | None = None
    slice_index: int | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AnalyzePartSourceRecord(BaseModel):
    """Part source summary returned by Analyze source discovery."""

    part_id: uuid.UUID
    serial_number: str
    display_name: str | None = None
    image_count: int = 0


class AnalyzeInputSourceResponse(BaseModel):
    """Available Analyze input sources for a project."""

    project_id: uuid.UUID
    source: WorkflowInputSource
    parts: list[AnalyzePartSourceRecord] = Field(default_factory=list)
    images: list[AnalyzeImageSourceRecord] = Field(default_factory=list)


class AnalyzeDeletedOverlayRecord(BaseModel):
    """Soft-deleted Analyze overlay metadata record."""

    project_id: uuid.UUID
    part_id: uuid.UUID
    part_serial_number: str
    part_display_name: str | None = None
    image_id: uuid.UUID | None = None
    filename: str
    label: str
    deleted_at: str
    pending_hard_delete_at: str
    deleted_by: str | None = None
    source_image_id: str | None = None
    source_filename: str | None = None


class AnalyzeRunStartResponse(BaseModel):
    """Response returned when an Analyze workflow run starts."""

    run_id: str


class AnalyzeRunStatusResponse(BaseModel):
    """Current status for an asynchronous Analyze workflow run."""

    run_id: str
    status: str
    result: ToolboxExecutionResult | None = None
    error: str | None = None
    remote_jobs: list[dict[str, Any]] = Field(default_factory=list)


class CheckpointDiagnosticsResponse(BaseModel):
    """Checkpoint upload diagnostics response."""

    filename: str
    filesize_bytes: int
    sha256: str
    extension: str
    model_family: str
    model_type: str
    model_version: str | None = None
    parameter_count: int | None = None
    parameter_count_kind: str | None = None
    confidence: str
    deep_inspection_limit_bytes: int | None = None
    deep_inspection_truncated: bool = False
    signals: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    top_level_keys: list[str] = Field(default_factory=list)
    state_key_sample: list[str] = Field(default_factory=list)


class CheckpointRecordResponse(BaseModel):
    """Stored Analyze checkpoint response."""

    id: uuid.UUID
    project_id: uuid.UUID
    meta_group_id: str
    filename: str
    object_storage_key: str
    content_type: str | None = None
    size_bytes: int
    sha256: str
    model_family: str
    model_type: str
    model_version: str | None = None
    parameter_count: int | None = None
    diagnostics: dict[str, Any]
    uploaded_by_user_id: str
    created_at: datetime
    updated_at: datetime | None = None


class CheckpointListResponse(BaseModel):
    """List response for Analyze checkpoints."""

    checkpoints: list[CheckpointRecordResponse] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class CheckpointGraphResponse(BaseModel):
    """Checkpoint graph introspection response."""

    checkpoint_id: uuid.UUID
    filename: str
    parameter_count: int | None = None
    parameter_count_kind: str | None = None
    graph: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)
