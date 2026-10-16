"""Pydantic schemas for PT3 splat conversion and real splat optimization."""

# ruff: noqa: D101,D102,D202,E501

import math
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class PT3SplatTransferFunction(BaseModel):
    threshold: float = Field(default=1.0)
    intensity_min: float = Field(default=0.0)
    intensity_max: float = Field(default=255.0)
    opacity_min: float = Field(default=0.05, ge=0.0, le=1.0)
    opacity_max: float = Field(default=1.0, ge=0.0, le=1.0)
    color_map: str = Field(default="grayscale", pattern=r"^(grayscale|hot)$")


class PT3SplatConversionRequest(BaseModel):
    source_path: str | None = Field(
        default=None,
        min_length=1,
        max_length=2048,
        deprecated=True,
        description=(
            "Deprecated and rejected by project-part conversion routes; "
            "sources are materialized from images attached to the part"
        ),
    )
    volume_stack_id: str | None = Field(default=None, max_length=255)
    source_image_ids: list[str] = Field(default_factory=list, max_length=1000)
    transfer_function: PT3SplatTransferFunction = Field(
        default_factory=PT3SplatTransferFunction
    )
    downsample: int = Field(default=1, ge=1)
    max_splats: int = Field(default=100_000, ge=1, le=100_000, strict=True)
    output_format: str = Field(default="ply", pattern=r"^(ply|splat|json)$")


class PT3SplatConversionResponse(BaseModel):
    asset_path: str
    asset_url: str
    cache_key: str
    output_format: str
    splat_count: int
    metadata: dict[str, Any]


class PT3SplatGenerationStatus(BaseModel):
    status: str = Field(..., pattern=r"^(missing|pending|ready|failed)$")
    part_id: uuid.UUID | None = None
    volume_stack_id: str | None = None
    asset_url: str | None = None
    cache_key: str | None = None
    output_format: str | None = None
    splat_count: int | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PT3RealSplatCamera(BaseModel):
    """Undistorted pinhole camera in the fixed PT3 patient-space convention.

    ``rotation_quaternion`` is a normalized ``[w, x, y, z]`` quaternion for
    the patient-physical-to-camera rotation and ``translation`` is the matching
    physical-unit vector in ``x_camera = R * x_patient + translation``. Camera
    axes are right-handed with +X image-right, +Y image-down, and +Z forward.
    """

    image_id: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Unique calibrated/generated view ID; it never selects a voxel source file.",
    )
    width: int = Field(
        ..., ge=1, strict=True, description="Undistorted image width in pixels."
    )
    height: int = Field(
        ..., ge=1, strict=True, description="Undistorted image height in pixels."
    )
    intrinsics: list[float] = Field(
        ...,
        min_length=9,
        max_length=9,
        description="Row-major 3x3 pinhole K matrix in pixel units; input views must already be undistorted.",
    )
    rotation_quaternion: list[float] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="Normalized [w,x,y,z] quaternion mapping patient-physical axes into camera axes.",
    )
    translation: list[float] = Field(
        ...,
        min_length=3,
        max_length=3,
        description="World-to-camera translation in the volume's physical units: x_camera=R*x_patient+t.",
    )

    @field_validator("image_id")
    @classmethod
    def normalize_image_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("image_id must not be blank")
        return normalized

    @field_validator("intrinsics", "rotation_quaternion", "translation", mode="before")
    @classmethod
    def require_finite_vector(cls, value):
        if isinstance(value, (str, bytes)) or not isinstance(value, (list, tuple)):
            raise ValueError("camera vectors must be arrays of numbers")
        if any(isinstance(item, bool) for item in value):
            raise ValueError("camera vectors must contain only numbers")
        try:
            values = [float(item) for item in value]
        except (TypeError, ValueError) as exc:
            raise ValueError("camera vectors must contain only numbers") from exc
        if not all(math.isfinite(item) for item in values):
            raise ValueError("camera vectors must contain only finite numbers")
        return values

    @model_validator(mode="after")
    def validate_calibration(self):
        fx, fy = self.intrinsics[0], self.intrinsics[4]
        cx, cy = self.intrinsics[2], self.intrinsics[5]
        if fx <= 0 or fy <= 0:
            raise ValueError("camera focal lengths must be positive")
        if not (0 <= cx <= self.width and 0 <= cy <= self.height):
            raise ValueError("camera principal point must lie inside the image")
        if (
            abs(self.intrinsics[6]) > 1e-8
            or abs(self.intrinsics[7]) > 1e-8
            or abs(self.intrinsics[8] - 1.0) > 1e-8
        ):
            raise ValueError(
                "camera intrinsics must be a calibrated 3x3 homogeneous matrix"
            )
        norm = math.sqrt(
            sum(component * component for component in self.rotation_quaternion)
        )
        if norm <= 1e-12:
            raise ValueError("camera rotation quaternion must be nonzero")
        self.rotation_quaternion = [
            component / norm for component in self.rotation_quaternion
        ]
        return self


class PT3RealSplatOptimizationParameters(BaseModel):
    # Canonical v1 is JSON and the bundled reference fitter/Canvas renderer are
    # deliberately dependency-light. Keep this bounded until a binary/GPU path
    # replaces the current interchange and rasterization pipeline.
    max_splats: int = Field(default=50_000, ge=1, le=100_000, strict=True)
    iterations: int = Field(default=30_000, ge=1, le=100_000, strict=True)
    sh_degree: int = Field(default=0, ge=0, le=4, strict=True)
    optimize_camera_poses: bool = Field(default=False, strict=True)
    optimize_means: Literal[True] = True
    optimize_covariance: Literal[True] = True
    optimize_rotation: Literal[True] = True
    optimize_opacity: Literal[True] = True
    optimize_spherical_harmonics: Literal[True] = True
    densification_interval: int = Field(default=100, ge=1, le=10_000, strict=True)
    convergence_tolerance: float = Field(
        default=1e-5, gt=0.0, le=1.0, strict=True, allow_inf_nan=False
    )
    density_threshold: float | None = Field(
        default=None, strict=True, allow_inf_nan=False
    )
    scalar_similarity: float = Field(
        default=0.05, ge=0.0, le=1.0, strict=True, allow_inf_nan=False
    )
    opacity_min: float = Field(
        default=0.02, ge=0.0, le=1.0, strict=True, allow_inf_nan=False
    )
    opacity_max: float = Field(
        default=0.98, ge=0.0, le=1.0, strict=True, allow_inf_nan=False
    )

    @field_validator(
        "optimize_means",
        "optimize_covariance",
        "optimize_rotation",
        "optimize_opacity",
        "optimize_spherical_harmonics",
        mode="before",
    )
    @classmethod
    def require_literal_true_optimization_flags(cls, value):
        if value is not True:
            raise ValueError("Real 3DGS optimize_* flags must be the JSON boolean true")
        return value

    @model_validator(mode="after")
    def validate_density_mapping(self):
        if self.opacity_max < self.opacity_min:
            raise ValueError("opacity_max must be greater than or equal to opacity_min")
        return self


class PT3RealSplatOptimizationRequest(BaseModel):
    """Request a voxel fit or a provider fit under the canonical PT3 v1 frame.

    Provider modes use ``coordinate_space=physical``, ``camera_model=pinhole``,
    and ``camera_convention=pt3_patient_physical_w2c_wxyz/v1``. Those fixed
    values are supplied to the trusted provider and required in its asset.
    """

    fit_mode: Literal["voxel_direct", "synthetic_views", "hybrid"] = "voxel_direct"
    volume_stack_id: str | None = Field(default=None, max_length=255)
    source_image_ids: list[str] = Field(default_factory=list, max_length=1000)
    cameras: list[PT3RealSplatCamera] = Field(default_factory=list, max_length=1000)
    parameters: PT3RealSplatOptimizationParameters = Field(
        default_factory=PT3RealSplatOptimizationParameters
    )

    @model_validator(mode="before")
    @classmethod
    def infer_legacy_camera_mode(cls, value):
        if isinstance(value, dict):
            normalized = dict(value)
            if "fit_mode" not in normalized and normalized.get("cameras"):
                normalized["fit_mode"] = "synthetic_views"
            if normalized.get("fit_mode") in {"synthetic_views", "hybrid"}:
                parameters = dict(normalized.get("parameters") or {})
                parameters.setdefault("sh_degree", 3)
                parameters.setdefault("optimize_camera_poses", True)
                normalized["parameters"] = parameters
            return normalized
        return value

    @field_validator("source_image_ids", mode="before")
    @classmethod
    def normalize_source_image_ids(cls, value):
        if value is None:
            return []
        if not isinstance(value, (list, tuple)):
            raise ValueError("source_image_ids must be an array")
        normalized = [str(item).strip() for item in value]
        if any(not item for item in normalized):
            raise ValueError("source_image_ids must not contain blank IDs")
        return normalized

    @model_validator(mode="after")
    def require_unique_image_ids(self):
        camera_ids = [camera.image_id for camera in self.cameras]
        if len(camera_ids) != len(set(camera_ids)):
            raise ValueError("camera image_id values must be unique")
        if len(self.source_image_ids) != len(set(self.source_image_ids)):
            raise ValueError("source_image_ids must be unique")
        if self.fit_mode == "voxel_direct":
            if self.cameras:
                raise ValueError("voxel_direct fitting does not accept camera views")
            if self.parameters.optimize_camera_poses:
                raise ValueError(
                    "voxel_direct fitting does not use or optimize camera poses"
                )
            if self.parameters.sh_degree != 0:
                raise ValueError(
                    "voxel_direct fitting requires degree-0 spherical harmonics"
                )
        else:
            if len(self.cameras) < 2:
                raise ValueError(
                    f"{self.fit_mode} requires at least two calibrated or generated camera views"
                )
            if not self.parameters.optimize_camera_poses:
                raise ValueError(f"{self.fit_mode} requires camera-pose optimization")
        return self


class PT3RealSplatGenerationStatus(BaseModel):
    status: str = Field(..., pattern=r"^(missing|pending|ready|failed|unavailable)$")
    job_id: str | None = None
    part_id: uuid.UUID | None = None
    volume_stack_id: str | None = None
    asset_url: str | None = None
    cache_key: str | None = None
    splat_count: int | None = None
    progress_percent: float = Field(default=0.0, ge=0.0, le=100.0)
    stage: str = ""
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
