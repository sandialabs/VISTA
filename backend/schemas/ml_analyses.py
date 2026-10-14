"""Pydantic schemas for ML analyses and annotations."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MLAnnotationBase(BaseModel):
    """Shared ML annotation fields."""

    annotation_type: str = Field(..., min_length=3, max_length=50)
    class_name: str | None = None
    confidence: float | None = Field(None, ge=0, le=1)
    data: dict[str, Any]
    storage_path: str | None = None
    ordering: int | None = None


class MLAnnotationCreate(MLAnnotationBase):
    """Input schema for creating an ML annotation."""


class MLAnnotation(MLAnnotationBase):
    """Response schema for an ML annotation."""

    id: uuid.UUID
    analysis_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class MLAnalysisBase(BaseModel):
    """Shared ML analysis fields."""

    model_name: str = Field(
        ...,
        min_length=2,
        max_length=255,
        pattern=r"^[a-zA-Z0-9_\-]+$",
        description="Model name (alphanumeric, dash, underscore only)",
    )
    model_version: str = Field(
        ..., min_length=1, max_length=100, description="Model version identifier"
    )
    parameters: dict[str, Any] | None = None


class MLAnalysisCreate(MLAnalysisBase):
    """Input schema for creating an ML analysis."""

    image_id: uuid.UUID


class MLAnalysis(MLAnalysisBase):
    """Response schema for an ML analysis."""

    id: uuid.UUID
    image_id: uuid.UUID
    status: str
    error_message: str | None = None
    provenance: dict[str, Any] | None = None
    requested_by_id: uuid.UUID
    external_job_id: str | None = None
    priority: int
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime | None = None
    annotations: list[MLAnnotation] | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class MLAnalysisList(BaseModel):
    """Paginated ML analysis response."""

    analyses: list[MLAnalysis]
    total: int


class MLAnnotationList(BaseModel):
    """Paginated ML annotation response."""

    annotations: list[MLAnnotation]
    total: int
