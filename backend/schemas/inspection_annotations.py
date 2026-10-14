"""Pydantic schemas for inspection annotations."""

# ruff: noqa: D101,D102,D202,E501

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from schemas.inspection_annotation_limits import _validate_segment_json_complexity
from schemas.inspection_segment_geometry import _validate_inspection_segment_geometry


def _annotation_segment_from_geometry(geometry: dict[str, Any] | None) -> Any:
    if not isinstance(geometry, dict) or "segment" not in geometry:
        return None
    return geometry["segment"]


def _normalize_legacy_annotation_segment(segment: Any) -> Any:
    if not isinstance(segment, dict):
        return segment
    normalized = dict(segment)
    aliases = {
        "version": ("version",),
        "axis": ("axis",),
        "min_slice": ("min_slice", "minSlice", "slice_index", "sliceIndex"),
        "max_slice": ("max_slice", "maxSlice", "slice_index", "sliceIndex"),
        "image_width": ("image_width", "imageWidth"),
        "image_height": ("image_height", "imageHeight"),
        "areas": ("areas",),
    }
    for canonical, candidates in aliases.items():
        if canonical in normalized:
            continue
        for candidate in candidates:
            if candidate in segment:
                normalized[canonical] = segment[candidate]
                break
    normalized.setdefault("version", 1)
    normalized.setdefault("areas", [])
    return normalized


def _normalize_annotation_discriminator(values: Any, *, partial: bool = False) -> Any:
    if not isinstance(values, dict):
        return values
    normalized = dict(values)
    geometry = normalized.get("geometry")
    has_segment = isinstance(geometry, dict) and "segment" in geometry
    has_explicit_kind = "annotation_kind" in normalized and normalized.get(
        "annotation_kind"
    ) not in (None, "")
    explicit_kind = str(normalized.get("annotation_kind") or "").strip().lower()
    if has_segment:
        assert isinstance(geometry, dict)
        if has_explicit_kind and explicit_kind != "vista_segment":
            raise ValueError("geometry.segment requires annotation_kind vista_segment")
        normalized["annotation_kind"] = "vista_segment"
        normalized["geometry"] = {
            **geometry,
            "segment": _normalize_legacy_annotation_segment(geometry.get("segment")),
        }
    elif not has_explicit_kind and not partial:
        has_line = isinstance(geometry, dict) and isinstance(geometry.get("line"), dict)
        defect_class = str(normalized.get("defect_class") or "").strip().lower()
        normalized["annotation_kind"] = (
            "measurement" if has_line or defect_class == "measurement" else "annotation"
        )
    elif (
        not has_explicit_kind
        and partial
        and isinstance(geometry, dict)
        and isinstance(geometry.get("line"), dict)
    ):
        normalized["annotation_kind"] = "measurement"
    return normalized


class InspectionAnnotationBase(BaseModel):
    annotation_kind: Literal["annotation", "measurement", "vista_segment"] = (
        "annotation"
    )
    image_id: str | None = Field(default=None, max_length=128)
    defect_class: str = Field(..., min_length=1, max_length=128)
    modality: str = Field(..., min_length=1, max_length=64)
    comment: str | None = Field(default=None, max_length=2000)
    disposition: str = Field(
        default="open", pattern=r"^(open|accepted|rejected|reject_part|needs_info)$"
    )
    measurements: dict[str, float] = Field(default_factory=dict)
    geometry: dict[str, Any] | None = None
    bbox: dict[str, float] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    hidden: bool = False

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_kind_and_segment_aliases(cls, values):
        return _normalize_annotation_discriminator(values)

    @model_validator(mode="after")
    def validate_vista_segment_geometry(self):
        _validate_segment_json_complexity(
            {
                "geometry": self.geometry,
                "metadata": self.metadata,
                "measurements": self.measurements,
                "bbox": self.bbox,
            },
            "annotation",
        )
        has_segment = isinstance(self.geometry, dict) and "segment" in self.geometry
        segment = _annotation_segment_from_geometry(self.geometry)
        if self.annotation_kind == "vista_segment" and not has_segment:
            raise ValueError("vista_segment annotations require geometry.segment")
        if has_segment:
            _validate_inspection_segment_geometry(segment)
        return self


class InspectionAnnotationCreate(InspectionAnnotationBase):
    pass


class InspectionAnnotationUpdate(BaseModel):
    annotation_kind: Literal["annotation", "measurement", "vista_segment"] | None = None
    image_id: str | None = Field(default=None, max_length=128)
    defect_class: str | None = Field(default=None, min_length=1, max_length=128)
    modality: str | None = Field(default=None, min_length=1, max_length=64)
    comment: str | None = Field(default=None, max_length=2000)
    disposition: str | None = Field(
        default=None, pattern=r"^(open|accepted|rejected|reject_part|needs_info)$"
    )
    measurements: dict[str, float] | None = None
    geometry: dict[str, Any] | None = None
    bbox: dict[str, float] | None = None
    metadata: dict[str, Any] | None = None
    hidden: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_supplied_kind_and_segment_aliases(cls, values):
        return _normalize_annotation_discriminator(values, partial=True)

    @model_validator(mode="after")
    def validate_supplied_vista_segment_geometry(self):
        _validate_segment_json_complexity(
            {
                "geometry": self.geometry,
                "metadata": self.metadata,
                "measurements": self.measurements,
                "bbox": self.bbox,
            },
            "annotation",
        )
        segment = _annotation_segment_from_geometry(self.geometry)
        if isinstance(self.geometry, dict) and "segment" in self.geometry:
            _validate_inspection_segment_geometry(segment)
        if (
            self.annotation_kind == "vista_segment"
            and self.geometry is not None
            and segment is None
        ):
            raise ValueError("vista_segment annotations require geometry.segment")
        return self


class InspectionAnnotation(InspectionAnnotationBase):
    id: uuid.UUID
    created_at: datetime
    created_by: str
    updated_at: datetime
    updated_by: str


class InspectionAnnotationListResponse(BaseModel):
    part_id: uuid.UUID
    annotations: list[InspectionAnnotation]
