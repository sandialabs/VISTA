"""Pydantic schemas for inspection workspace state and project configuration."""

# ruff: noqa: D101,D102,D202,E501

import math
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class InspectionWorkspaceStatePayload(BaseModel):
    state: dict[str, Any] = Field(default_factory=dict)


class InspectionWorkspaceStateResponse(BaseModel):
    project_id: uuid.UUID
    user_email: str
    state: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime | None = None


class InspectionProjectModalityConfig(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=128)
    calibration_required: bool = False
    example_image_uploaded: bool = False


class InspectionProjectPartViewConfig(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=128)
    required_modalities: list[str] = Field(default_factory=list)
    source: str = Field(default="manual", pattern=r"^(manual|auto)$")


class InspectionProjectDefectTypeConfig(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    color: str = Field(default="#ef4444", min_length=4, max_length=16)
    definition: str | None = Field(default=None, max_length=2000)


class InspectionProjectProcessSettingsConfig(BaseModel):
    require_disposition_on_submit: bool = True
    require_measurement_for_critical: bool = False
    require_second_reviewer_for_reject: bool = False
    configurable_hotkeys: dict[str, str] = Field(
        default_factory=lambda: {
            "accept_classification": "a",
            "reject_classification": "r",
            "toggle_shortcut_help": "h",
        }
    )

    @field_validator("configurable_hotkeys")
    @classmethod
    def validate_configurable_hotkeys(cls, value: dict[str, str]) -> dict[str, str]:
        required_keys = {
            "accept_classification",
            "reject_classification",
            "toggle_shortcut_help",
        }
        if not required_keys.issubset(value.keys()):
            missing = ", ".join(sorted(required_keys - set(value.keys())))
            raise ValueError(f"configurable_hotkeys missing required keys: {missing}")
        normalized: dict[str, str] = {}
        for binding, hotkey in value.items():
            if not isinstance(hotkey, str):
                raise ValueError(f"Hotkey for '{binding}' must be a string")
            trimmed = hotkey.strip().lower()
            if len(trimmed) != 1 or not trimmed.isalnum():
                raise ValueError(
                    f"Hotkey for '{binding}' must be a single alphanumeric character"
                )
            normalized[binding] = trimmed
        if len(set(normalized.values())) != len(normalized):
            raise ValueError("configurable_hotkeys must use unique key bindings")
        return normalized


class InspectionProjectPt33DGuidesConfig(BaseModel):
    crosshair_transparency_percent: int = Field(default=50, ge=0, le=100, strict=True)
    crosshair_line_width_px: float = Field(
        default=1.25,
        ge=0.5,
        le=6.0,
        strict=True,
        allow_inf_nan=False,
    )
    plane_outline_transparency_percent: int = Field(
        default=0, ge=0, le=100, strict=True
    )
    plane_outline_line_width_px: float = Field(
        default=1.25,
        ge=0.5,
        le=6.0,
        strict=True,
        allow_inf_nan=False,
    )

    @field_validator(
        "crosshair_transparency_percent",
        "plane_outline_transparency_percent",
        mode="before",
    )
    @classmethod
    def reject_non_finite_transparency(cls, value):
        if isinstance(value, float) and not math.isfinite(value):
            # FastAPI includes rejected values in its validation response.
            # Replace non-JSON-safe sentinels so malformed requests still
            # produce a serializable 422 rather than a response-time 500.
            return "non-finite"
        return value

    @field_validator(
        "crosshair_line_width_px", "plane_outline_line_width_px", mode="before"
    )
    @classmethod
    def accept_integer_line_widths(cls, value):
        # JSON has a single number type from a caller's perspective. Preserve
        # strict rejection of strings and booleans while accepting ordinary
        # integer-valued widths such as 1 or 2.
        if isinstance(value, int) and not isinstance(value, bool):
            return float(value)
        if isinstance(value, float) and not math.isfinite(value):
            # FastAPI includes the rejected input in its validation response.
            # Replace non-JSON-safe float sentinels before strict validation so
            # NaN/Infinity requests produce a serializable 422 response.
            return "non-finite"
        return value


class InspectionProjectDisplaySettingsConfig(BaseModel):
    default_colormap: str = Field(default="grayscale", min_length=1, max_length=64)
    anomaly_colormap: str = Field(default="viridis", min_length=1, max_length=64)
    grayscale_base_image: bool = True
    inspection_tile_max_columns: int = Field(default=8, ge=1, le=64, strict=True)
    pt3_3d_guides: InspectionProjectPt33DGuidesConfig = Field(
        default_factory=InspectionProjectPt33DGuidesConfig
    )


class InspectionProjectPhaseSettingsConfig(BaseModel):
    manual_phase_selection_enabled: bool = False
    manual_phase: str = Field(
        default="data_ingestion",
        pattern=r"^(data_ingestion|part_inspection|reporting)$",
    )


class InspectionProjectInterfaceLayoutConfig(BaseModel):
    default_model: dict[str, Any] | None = None


class InspectionProjectFileNamingEntryConfig(BaseModel):
    id: str = Field(default="other", max_length=128)
    label: str = Field(default="", max_length=255)
    abbreviation: str = Field(default="", max_length=64)


class InspectionProjectFileNamingSchemeConfig(BaseModel):
    use_filename_convention: bool = True
    hierarchy_levels: list[InspectionProjectFileNamingEntryConfig] = Field(
        default_factory=list
    )
    image_descriptors: list[InspectionProjectFileNamingEntryConfig] = Field(
        default_factory=list
    )


class InspectionProjectOwnerConfig(BaseModel):
    name: str = Field(default="", max_length=255)
    email: str = Field(default="", max_length=255)


class InspectionProjectCurrentUserConfig(BaseModel):
    username: str = Field(default="", max_length=255)
    sso_authenticated: bool = False


class InspectionProjectNsiproParserConfig(BaseModel):
    parser_id: str = Field(default="default", max_length=128)
    parser_version: str | None = Field(default=None, max_length=128)
    parser_hash: str | None = Field(default=None, max_length=255)
    strict_version_match: bool = False


class InspectionProjectMetadataParsersConfig(BaseModel):
    nsipro: InspectionProjectNsiproParserConfig = Field(
        default_factory=InspectionProjectNsiproParserConfig
    )


class InspectionProjectCalibrationConfig(BaseModel):
    pixels_per_mm: float = Field(gt=0, strict=True, allow_inf_nan=False)
    pixels_per_inch: float = Field(gt=0, strict=True, allow_inf_nan=False)
    unit: Literal["mm", "inches"]
    updated_at: datetime | None = None

    @field_validator("pixels_per_mm", "pixels_per_inch", mode="before")
    @classmethod
    def validate_calibration_scale(cls, value):
        # JSON callers have a single number type in practice. Accept ordinary
        # integers while retaining strict rejection of booleans and strings.
        if isinstance(value, int) and not isinstance(value, bool):
            return float(value)
        if isinstance(value, float) and not math.isfinite(value):
            # Keep validation responses JSON serializable for NaN/Infinity.
            return "non-finite"
        return value

    @model_validator(mode="after")
    def validate_equivalent_scales(self):
        expected_pixels_per_inch = self.pixels_per_mm * 25.4
        if not math.isfinite(expected_pixels_per_inch) or not math.isclose(
            self.pixels_per_inch,
            expected_pixels_per_inch,
            rel_tol=1e-9,
            abs_tol=0.0,
        ):
            raise ValueError(
                "pixels_per_inch must equal pixels_per_mm multiplied by 25.4"
            )
        return self


class InspectionProjectConfiguration(BaseModel):
    image_modalities: list[InspectionProjectModalityConfig] = Field(
        default_factory=list
    )
    part_views: list[InspectionProjectPartViewConfig] = Field(default_factory=list)
    defect_types: list[InspectionProjectDefectTypeConfig] = Field(default_factory=list)
    process_settings: InspectionProjectProcessSettingsConfig = Field(
        default_factory=InspectionProjectProcessSettingsConfig
    )
    display_settings: InspectionProjectDisplaySettingsConfig = Field(
        default_factory=InspectionProjectDisplaySettingsConfig
    )
    phase_settings: InspectionProjectPhaseSettingsConfig = Field(
        default_factory=InspectionProjectPhaseSettingsConfig
    )
    interface_layout: InspectionProjectInterfaceLayoutConfig = Field(
        default_factory=InspectionProjectInterfaceLayoutConfig
    )
    metadata_parsers: InspectionProjectMetadataParsersConfig = Field(
        default_factory=InspectionProjectMetadataParsersConfig
    )
    file_naming_scheme: InspectionProjectFileNamingSchemeConfig = Field(
        default_factory=InspectionProjectFileNamingSchemeConfig
    )
    project_owner: InspectionProjectOwnerConfig = Field(
        default_factory=InspectionProjectOwnerConfig
    )
    current_user: InspectionProjectCurrentUserConfig = Field(
        default_factory=InspectionProjectCurrentUserConfig
    )
    calibration: InspectionProjectCalibrationConfig | None = None


class InspectionProjectConfigurationPayload(BaseModel):
    config: InspectionProjectConfiguration


class InspectionProjectConfigurationResponse(BaseModel):
    project_id: uuid.UUID
    config: InspectionProjectConfiguration
    updated_at: datetime | None = None


class InspectionProjectConfigurationCloneRequest(BaseModel):
    source_project_id: uuid.UUID


class InspectionProjectConfigurationCloneResponse(BaseModel):
    project_id: uuid.UUID
    source_project_id: uuid.UUID
    config: InspectionProjectConfiguration
    updated_at: datetime | None = None


class InspectionInterfaceLayoutDefaultPayload(BaseModel):
    layout_model: dict[str, Any]
