"""Pydantic schemas for inspection volume segmentation, selection, and measurement runs."""

# ruff: noqa: D101,D102,D202,E501

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class InspectionSegmentationInvokeRequest(BaseModel):
    axis: str = Field(default="axial", pattern=r"^(axial|coronal|sagittal)$")
    slice_index: int = Field(default=0, ge=0)


class InspectionSegmentationInvokeResponse(BaseModel):
    run_id: uuid.UUID
    part_id: uuid.UUID
    axis: str
    slice_index: int
    status: str
    overlay_id: str
    created_at: datetime


class InspectionSliceSegmentationRequest(BaseModel):
    axis: str = Field(default="axial", pattern=r"^(axial|coronal|sagittal)$")
    slice_index: int = Field(default=0, ge=0)
    method_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[a-z0-9_.-]+$")
    parameters: dict[str, Any] = Field(default_factory=dict)
    image_data_base64: str = Field(..., min_length=1)
    filename: str = Field(default="slice.png", min_length=1, max_length=255)
    click_x: float = Field(..., ge=0)
    click_y: float = Field(..., ge=0)


class InspectionSliceSegmentRegion(BaseModel):
    label: int
    area_px: float
    bbox: list[float]
    centroid: list[float] | None = None
    confidence: float | None = None
    class_name: str | None = None


class InspectionSliceSegmentationResponse(BaseModel):
    run_id: uuid.UUID
    part_id: uuid.UUID
    axis: str
    slice_index: int
    method_id: str
    status: str
    cached: bool = False
    regions: list[InspectionSliceSegmentRegion] = Field(default_factory=list)
    selected_region: InspectionSliceSegmentRegion | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


DEFAULT_VOLUME_CONNECTED_SELECTION_MAX_VOXELS = 50_000
MAX_VOLUME_CONNECTED_SELECTION_MAX_VOXELS = 100_000
DEFAULT_VOLUME_CONNECTED_SELECTION_MAX_EXAMINED = 150_000
MAX_VOLUME_CONNECTED_SELECTION_MAX_EXAMINED = 300_000
DEFAULT_VOLUME_CONNECTED_SELECTION_MAX_RUNS = 10_000
MAX_VOLUME_CONNECTED_SELECTION_MAX_RUNS = 20_000


class VolumeConnectedSelectionRequest(BaseModel):
    seed: list[int] = Field(..., min_length=3, max_length=3)
    sensitivity: float = Field(
        default=28.0,
        ge=0.0,
        le=255.0,
        allow_inf_nan=False,
    )
    display_min: float | None = Field(default=None, allow_inf_nan=False)
    display_max: float | None = Field(default=None, allow_inf_nan=False)
    max_voxels: int = Field(
        default=DEFAULT_VOLUME_CONNECTED_SELECTION_MAX_VOXELS,
        ge=1,
        le=MAX_VOLUME_CONNECTED_SELECTION_MAX_VOXELS,
    )
    max_examined: int = Field(
        default=DEFAULT_VOLUME_CONNECTED_SELECTION_MAX_EXAMINED,
        ge=1,
        le=MAX_VOLUME_CONNECTED_SELECTION_MAX_EXAMINED,
    )
    max_runs: int = Field(
        default=DEFAULT_VOLUME_CONNECTED_SELECTION_MAX_RUNS,
        ge=1,
        le=MAX_VOLUME_CONNECTED_SELECTION_MAX_RUNS,
    )

    @field_validator("seed")
    @classmethod
    def validate_seed(cls, value: list[int]) -> list[int]:
        if any(
            isinstance(entry, bool) or not isinstance(entry, int) for entry in value
        ):
            raise ValueError("seed coordinates must be integers")
        return value

    @model_validator(mode="after")
    def validate_display_range(self):
        if (self.display_min is None) != (self.display_max is None):
            raise ValueError("display_min and display_max must be supplied together")
        if (
            self.display_min is not None
            and self.display_max is not None
            and self.display_max <= self.display_min
        ):
            raise ValueError("display_max must be greater than display_min")
        return self


class VolumeConnectedSelectionResponse(BaseModel):
    dimensions: list[int]
    seed: list[int]
    volume_runs: list[list[int]] = Field(default_factory=list)
    voxel_count: int = 0
    examined: int = 0
    bounds: dict[str, list[int]] | None = None
    truncated: bool = False
    truncation_reason: str = ""
    connectivity: int = 6


class InspectionMeasurementInvokeRequest(BaseModel):
    measurement_profile: str = Field(default="default", min_length=1, max_length=64)
    include_overlays: list[str] = Field(default_factory=list)


class InspectionMeasurementInvokeResponse(BaseModel):
    run_id: uuid.UUID
    part_id: uuid.UUID
    status: str
    measurement_profile: str
    units: str
    values: dict[str, float]
    created_at: datetime
