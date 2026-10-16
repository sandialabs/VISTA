"""Canonical adapter contract for voxel-native and provider 3D Gaussians.

The default Real 3DGS path fits the authoritative voxel field directly. Trusted
providers can additionally implement synthetic-view or hybrid refinement while
returning the same validated asset contract.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from utils.pt3_segmentation import (
    PT3SegmentationError,
    normalize_inline_pt3_segmentation_labels,
)
from utils.volume_loader import VolumeInfo
from utils.voxel_gaussian_fitter import fit_voxel_gaussian_splat_asset

REQUIRED_OPTIMIZED_PARAMETERS = frozenset(
    {
        "means",
        "covariance",
        "rotation",
        "opacity",
        "spherical_harmonics",
    }
)

REQUIRED_DIRECT_FIT_PARAMETERS = frozenset(
    {
        "means",
        "covariance",
        "rotation",
        "opacity",
        "spherical_harmonics",
    }
)

DIRECT_VOXEL_FIT_PARAMETER_NAMES = frozenset(
    {
        "max_splats",
        "scalar_similarity",
        "density_threshold",
        "opacity_min",
        "opacity_max",
    }
)
MAX_CANONICAL_SPLATS = 100_000
MAX_CANONICAL_JSON_BYTES = 256 * 1024 * 1024
CANONICAL_COORDINATE_SPACE = "physical"
CANONICAL_PROVIDER_CAMERA_MODEL = "pinhole"
CANONICAL_PROVIDER_CAMERA_CONVENTION = "pt3_patient_physical_w2c_wxyz/v1"
SUPPORTED_SEGMENT_ASSIGNMENT_POLICIES = frozenset(
    {
        "hard_source_label",
        "max_weight_source_label",
    }
)


class RealGaussianSplatOptimizationError(RuntimeError):
    """Raised when a configured provider violates the real-3DGS contract."""


@dataclass(frozen=True)
class RealGaussianSplatAsset:
    path: str
    cache_key: str
    splat_count: int
    metadata: dict[str, Any]


def _require_finite_vector(
    value: Any, *, length: int, field: str, index: int
) -> list[float]:
    if not isinstance(value, list) or len(value) != length:
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS splat {index} {field} must contain exactly {length} values"
        )
    if any(isinstance(item, bool) for item in value):
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS splat {index} {field} must contain only numbers"
        )
    try:
        vector = [float(item) for item in value]
    except (TypeError, ValueError) as exc:
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS splat {index} {field} must contain only numbers"
        ) from exc
    if not all(math.isfinite(item) for item in vector):
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS splat {index} {field} must be finite"
        )
    return vector


def validate_canonical_real_splat_json(
    asset_path: Path,
    *,
    requested_sh_degree: int,
    expected_camera_ids: Sequence[str] = (),
    require_optimized_cameras: bool = False,
    expected_optimization_domain: str | None = None,
    expected_coordinate_space: str | None = None,
    expected_camera_model: str | None = None,
    expected_camera_convention: str | None = None,
    expected_segment_ids: Sequence[int] = (),
) -> int:
    """Validate the only asset interchange format accepted by the real-3DGS API.

    The canonical v1 JSON uses parallel arrays so the browser cannot mistake a
    point cloud that merely claims optimization for an actual Gaussian model.
    SH coefficients are coefficient-major RGB triples, flattened per splat.
    """
    try:
        if asset_path.stat().st_size > MAX_CANONICAL_JSON_BYTES:
            raise RealGaussianSplatOptimizationError(
                "Real 3DGS canonical JSON exceeds the 256 MiB safety limit"
            )
        payload = json.loads(asset_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS provider returned invalid JSON"
        ) from exc
    if not isinstance(payload, dict):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS canonical asset must be a JSON object"
        )
    if (
        payload.get("contract_version") != "pt3_real_3dgs/v1"
        or payload.get("representation") != "real_3dgs"
    ):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS asset does not declare the canonical v1 contract"
        )
    if (
        expected_optimization_domain
        and payload.get("optimization_domain") != expected_optimization_domain
    ):
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS asset optimization_domain must be {expected_optimization_domain}"
        )
    if (
        expected_coordinate_space
        and payload.get("coordinate_space") != expected_coordinate_space
    ):
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS asset coordinate_space must be {expected_coordinate_space}"
        )
    if expected_camera_model and payload.get("camera_model") != expected_camera_model:
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS asset camera_model must be {expected_camera_model}"
        )
    if (
        expected_camera_convention
        and payload.get("camera_convention") != expected_camera_convention
    ):
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS asset camera_convention must be {expected_camera_convention}"
        )
    sh_degree = payload.get("sh_degree")
    if type(sh_degree) is not int or sh_degree != requested_sh_degree:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS asset sh_degree does not match the optimization request"
        )

    array_fields = ("means", "scales", "rotations", "opacities", "sh_coefficients")
    arrays = {field: payload.get(field) for field in array_fields}
    if any(not isinstance(value, list) for value in arrays.values()):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS asset must contain means, scales, rotations, opacities, and sh_coefficients arrays"
        )
    splat_count = len(arrays["means"])
    if splat_count < 1 or any(len(value) != splat_count for value in arrays.values()):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS canonical arrays must have the same nonzero length"
        )
    if splat_count > MAX_CANONICAL_SPLATS:
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS canonical assets are limited to {MAX_CANONICAL_SPLATS} splats"
        )

    expected_sh_values = 3 * (sh_degree + 1) ** 2
    for index in range(splat_count):
        _require_finite_vector(
            arrays["means"][index], length=3, field="means", index=index
        )
        scales = _require_finite_vector(
            arrays["scales"][index], length=3, field="scales", index=index
        )
        if any(value <= 0 for value in scales):
            raise RealGaussianSplatOptimizationError(
                f"Real 3DGS splat {index} scales must be positive"
            )
        rotation = _require_finite_vector(
            arrays["rotations"][index], length=4, field="rotation", index=index
        )
        quaternion_norm = math.sqrt(
            sum(component * component for component in rotation)
        )
        if quaternion_norm <= 1e-12 or abs(quaternion_norm - 1.0) > 1e-3:
            raise RealGaussianSplatOptimizationError(
                f"Real 3DGS splat {index} rotation must be a normalized nonzero quaternion"
            )
        opacity = arrays["opacities"][index]
        if isinstance(opacity, bool):
            raise RealGaussianSplatOptimizationError(
                f"Real 3DGS splat {index} opacity must be numeric"
            )
        try:
            opacity = float(opacity)
        except (TypeError, ValueError) as exc:
            raise RealGaussianSplatOptimizationError(
                f"Real 3DGS splat {index} opacity must be numeric"
            ) from exc
        if not math.isfinite(opacity) or not 0 <= opacity <= 1:
            raise RealGaussianSplatOptimizationError(
                f"Real 3DGS splat {index} opacity must be between 0 and 1"
            )
        _require_finite_vector(
            arrays["sh_coefficients"][index],
            length=expected_sh_values,
            field="sh_coefficients",
            index=index,
        )

    required_segment_ids = {int(segment_id) for segment_id in expected_segment_ids}
    segment_ids = payload.get("segment_ids")
    if required_segment_ids and segment_ids is None:
        raise RealGaussianSplatOptimizationError(
            "Segmented Real 3DGS assets must include one segment_id per splat"
        )
    if segment_ids is not None:
        if not isinstance(segment_ids, list) or len(segment_ids) != splat_count:
            raise RealGaussianSplatOptimizationError(
                "Real 3DGS segment_ids must match the splat count"
            )
        represented_segment_ids: set[int] = set()
        for index, segment_id in enumerate(segment_ids):
            if segment_id is not None and (
                type(segment_id) is not int or not 1 <= segment_id <= 255
            ):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS splat {index} segment_id must be null or an integer from 1 to 255"
                )
            if segment_id is not None:
                represented_segment_ids.add(segment_id)
        if required_segment_ids:
            unknown_segment_ids = represented_segment_ids - required_segment_ids
            if unknown_segment_ids:
                raise RealGaussianSplatOptimizationError(
                    "Real 3DGS segment_ids contain labels absent from the source segmentation: "
                    + ", ".join(str(value) for value in sorted(unknown_segment_ids))
                )
            missing_segment_ids = required_segment_ids - represented_segment_ids
            if missing_segment_ids:
                raise RealGaussianSplatOptimizationError(
                    "Real 3DGS output does not represent source segment labels: "
                    + ", ".join(str(value) for value in sorted(missing_segment_ids))
                )

    if payload.get("optimization_domain") == "voxel_field":
        if payload.get("camera_model") != "none" or sh_degree != 0:
            raise RealGaussianSplatOptimizationError(
                "Voxel-field Gaussian assets require camera_model none and degree-0 spherical harmonics"
            )
        scalar_values = payload.get("scalar_values")
        if not isinstance(scalar_values, list) or len(scalar_values) != splat_count:
            raise RealGaussianSplatOptimizationError(
                "Voxel-field scalar_values must match the splat count"
            )
        for index, scalar_value in enumerate(scalar_values):
            if isinstance(scalar_value, bool):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS splat {index} scalar_value must be numeric and finite"
                )
            try:
                finite_scalar = math.isfinite(float(scalar_value))
            except (TypeError, ValueError):
                finite_scalar = False
            if not finite_scalar:
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS splat {index} scalar_value must be finite"
                )

    optimized_cameras = payload.get("optimized_cameras")
    if require_optimized_cameras:
        if not isinstance(optimized_cameras, list):
            raise RealGaussianSplatOptimizationError(
                "Real 3DGS asset must include optimized_cameras when camera-pose optimization is enabled"
            )
        actual_camera_ids: list[str] = []
        for index, camera in enumerate(optimized_cameras):
            if not isinstance(camera, dict):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} must be an object"
                )
            image_id = str(camera.get("image_id") or "").strip()
            if not image_id:
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} requires image_id"
                )
            actual_camera_ids.append(image_id)
            width = camera.get("width")
            height = camera.get("height")
            if (
                type(width) is not int
                or width < 1
                or type(height) is not int
                or height < 1
            ):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} requires positive integer width and height"
                )
            intrinsics = _require_finite_vector(
                camera.get("intrinsics"),
                length=9,
                field="camera intrinsics",
                index=index,
            )
            if intrinsics[0] <= 0 or intrinsics[4] <= 0:
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} focal lengths must be positive"
                )
            if not (0 <= intrinsics[2] <= width and 0 <= intrinsics[5] <= height):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} principal point must lie inside the image"
                )
            if (
                abs(intrinsics[6]) > 1e-8
                or abs(intrinsics[7]) > 1e-8
                or abs(intrinsics[8] - 1.0) > 1e-8
            ):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} intrinsics must be a homogeneous 3x3 pinhole matrix"
                )
            rotation = _require_finite_vector(
                camera.get("rotation_quaternion"),
                length=4,
                field="camera rotation",
                index=index,
            )
            if (
                abs(
                    math.sqrt(sum(component * component for component in rotation))
                    - 1.0
                )
                > 1e-3
            ):
                raise RealGaussianSplatOptimizationError(
                    f"Real 3DGS optimized camera {index} rotation must be a normalized quaternion"
                )
            _require_finite_vector(
                camera.get("translation"),
                length=3,
                field="camera translation",
                index=index,
            )
        if len(actual_camera_ids) != len(set(actual_camera_ids)) or set(
            actual_camera_ids
        ) != set(expected_camera_ids):
            raise RealGaussianSplatOptimizationError(
                "Real 3DGS optimized camera IDs must exactly match the calibrated source views"
            )
    return splat_count


def build_real_splat_cache_key(
    *,
    volume_stack_id: str,
    source_image_ids: Sequence[str],
    source_files: Sequence[str],
    cameras: Sequence[Mapping[str, Any]],
    parameters: Mapping[str, Any],
    fit_mode: str = "synthetic_views",
    volume_geometry: Mapping[str, Any] | None = None,
    segmentation_digest: str | None = None,
) -> str:
    payload = {
        "version": 1,
        "representation": "real_3dgs",
        "fit_mode": fit_mode,
        "volume_stack_id": volume_stack_id,
        "source_image_ids": list(source_image_ids),
        "source_files": list(source_files),
        "cameras": list(cameras),
        "parameters": dict(parameters),
        "volume_geometry": dict(volume_geometry or {}),
        "segmentation_digest": segmentation_digest,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"pt3-real-3dgs-{digest}"


def optimize_real_gaussian_splat_asset(
    *,
    provider_path: str,
    volume_stack_id: str,
    source_image_ids: Sequence[str],
    source_files: Sequence[str],
    cameras: Sequence[Mapping[str, Any]],
    parameters: Mapping[str, Any],
    output_dir: str | Path,
    fit_mode: str = "synthetic_views",
    volume_geometry: Mapping[str, Any] | None = None,
    segmentation: Mapping[str, Any] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> RealGaussianSplatAsset:
    """Fit voxels directly or invoke and validate a trusted view provider.

    The trusted provider receives the canonical request plus an optional local
    ``progress_callback(percent, stage)`` callable, and may return either a
    mapping or an object exposing ``model_dump``. Client requests never choose
    the import path.
    """
    safe_fit_mode = str(fit_mode or "").strip()
    if safe_fit_mode not in {"voxel_direct", "synthetic_views", "hybrid"}:
        raise RealGaussianSplatOptimizationError(
            f"Unsupported Real 3DGS fit mode: {safe_fit_mode}"
        )
    safe_provider_path = str(provider_path or "").strip()
    if safe_fit_mode != "voxel_direct":
        if "." not in safe_provider_path:
            raise RealGaussianSplatOptimizationError(
                f"{safe_fit_mode} requires a configured Real 3DGS provider"
            )
        if len(cameras) < 2:
            raise RealGaussianSplatOptimizationError(
                f"{safe_fit_mode} requires at least two calibrated camera views"
            )

    geometry = _validated_voxel_geometry(volume_geometry, source_files)
    try:
        segmentation_labels = normalize_inline_pt3_segmentation_labels(
            segmentation,
            geometry["shape_zyx"],
        )
    except PT3SegmentationError as exc:
        raise RealGaussianSplatOptimizationError(str(exc)) from exc
    segmentation_digest = (
        hashlib.sha256(segmentation_labels.tobytes(order="C")).hexdigest()
        if segmentation_labels is not None
        else None
    )
    source_segment_ids = (
        tuple(int(value) for value in np.unique(segmentation_labels) if int(value) != 0)
        if segmentation_labels is not None
        else ()
    )
    if source_segment_ids:
        requested_max_splats = parameters.get("max_splats")
        if type(requested_max_splats) is int and requested_max_splats < len(
            source_segment_ids
        ):
            raise RealGaussianSplatOptimizationError(
                "max_splats must allow at least one Gaussian for every nonzero source segment"
            )

    cache_key = build_real_splat_cache_key(
        volume_stack_id=volume_stack_id,
        source_image_ids=source_image_ids,
        source_files=source_files,
        cameras=cameras,
        parameters=parameters,
        fit_mode=safe_fit_mode,
        volume_geometry=geometry,
        segmentation_digest=segmentation_digest,
    )
    safe_output_dir = Path(output_dir).resolve()
    safe_output_dir.mkdir(parents=True, exist_ok=True)
    if safe_fit_mode == "voxel_direct":
        direct_parameters = {
            key: value
            for key, value in parameters.items()
            if key in DIRECT_VOXEL_FIT_PARAMETER_NAMES
        }
        result = fit_voxel_gaussian_splat_asset(
            VolumeInfo(
                format=geometry["format"],
                shape=geometry["shape_zyx"],
                source_files=tuple(str(item) for item in source_files),
                dtype=geometry.get("dtype"),
                channel_count=geometry["channel_count"],
                color_mode=geometry["color_mode"],
            ),
            volume_stack_id=volume_stack_id,
            source_image_ids=source_image_ids,
            output_dir=safe_output_dir,
            parameters=direct_parameters,
            segmentation_labels=segmentation_labels,
            spacing=geometry["spacing_xyz"],
            origin=geometry["origin_xyz"],
            direction=geometry["direction"],
            progress_callback=progress_callback,
        )
    else:
        module_name, function_name = safe_provider_path.rsplit(".", 1)
        try:
            provider = getattr(importlib.import_module(module_name), function_name)
        except (AttributeError, ImportError) as exc:
            raise RealGaussianSplatOptimizationError(
                f"Could not load real 3DGS provider {safe_provider_path}"
            ) from exc

        request = {
            "contract_version": "pt3_real_3dgs/v1",
            "representation": "real_3dgs",
            "fit_mode": safe_fit_mode,
            "coordinate_space": CANONICAL_COORDINATE_SPACE,
            "camera_model": CANONICAL_PROVIDER_CAMERA_MODEL,
            "camera_convention": CANONICAL_PROVIDER_CAMERA_CONVENTION,
            "cache_key": cache_key,
            "volume_stack_id": volume_stack_id,
            "source_image_ids": list(source_image_ids),
            "source_files": list(source_files),
            "volume_geometry": geometry,
            "cameras": list(cameras),
            "parameters": dict(parameters),
            "segmentation": _canonical_provider_segmentation(
                segmentation,
                segmentation_labels,
            ),
            "segmentation_output_contract": {
                "required_segment_ids": list(source_segment_ids),
                "background_segment_id": None,
                "supported_assignment_policies": sorted(
                    SUPPORTED_SEGMENT_ASSIGNMENT_POLICIES
                ),
            },
            "output_dir": str(safe_output_dir),
            "progress_callback": progress_callback,
        }
        result = provider(request)
    if hasattr(result, "model_dump"):
        result = result.model_dump(mode="python")
    if not isinstance(result, Mapping):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS provider must return a mapping"
        )
    if safe_fit_mode == "voxel_direct":
        declared_cache_key = str(result.get("cache_key") or "").strip()
        if not declared_cache_key.startswith("pt3-voxel-direct-"):
            raise RealGaussianSplatOptimizationError(
                "Voxel-direct fitter did not return its content-derived cache key"
            )
        cache_key = declared_cache_key

    asset_path = Path(str(result.get("asset_path") or "")).resolve()
    if safe_output_dir not in asset_path.parents:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS provider returned an asset outside its output directory"
        )
    if not asset_path.is_file() or asset_path.suffix.lower() != ".json":
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS provider must produce a canonical JSON asset"
        )

    raw_metadata = result.get("metadata") or {}
    if not isinstance(raw_metadata, Mapping):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS provider metadata must be an object"
        )
    metadata = dict(raw_metadata)
    if safe_fit_mode == "voxel_direct":
        metadata["request_parameter_scope"] = {
            "consumed": sorted(DIRECT_VOXEL_FIT_PARAMETER_NAMES),
            "not_applicable": [
                "iterations",
                "densification_interval",
                "convergence_tolerance",
                "optimize_camera_poses",
                "higher_order_spherical_harmonics",
            ],
        }
        fitted = {str(item) for item in metadata.get("fitted_parameters") or []}
        missing = REQUIRED_DIRECT_FIT_PARAMETERS - fitted
        provenance = metadata.get("parameter_provenance")
        if not isinstance(provenance, Mapping) or any(
            not str(provenance.get(parameter) or "").strip()
            for parameter in REQUIRED_DIRECT_FIT_PARAMETERS | {"camera_poses"}
        ):
            raise RealGaussianSplatOptimizationError(
                "Voxel-direct fitter must declare how every fitted parameter was obtained"
            )
        if metadata.get("global_reconstruction_optimized") is not False:
            raise RealGaussianSplatOptimizationError(
                "The built-in analytic voxel fitter must not claim global reconstruction optimization"
            )
    else:
        optimized = {str(item) for item in metadata.get("optimized_parameters") or []}
        missing = REQUIRED_OPTIMIZED_PARAMETERS - optimized
        if source_segment_ids:
            segment_assignment_policy = str(
                metadata.get("segment_assignment_policy") or ""
            ).strip()
            if segment_assignment_policy not in SUPPORTED_SEGMENT_ASSIGNMENT_POLICIES:
                raise RealGaussianSplatOptimizationError(
                    "Segmented Real 3DGS providers must declare segment_assignment_policy "
                    "as hard_source_label or max_weight_source_label"
                )
            metadata["segment_assignment_policy"] = segment_assignment_policy
    require_optimized_cameras = safe_fit_mode != "voxel_direct" and bool(
        parameters.get("optimize_camera_poses", True)
    )
    if require_optimized_cameras and "camera_poses" not in optimized:
        missing = set(missing) | {"camera_poses"}
    if missing:
        action = "fit" if safe_fit_mode == "voxel_direct" else "optimize"
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS provider did not confirm {action} of: "
            + ", ".join(sorted(missing))
        )

    requested_sh_degree = int(
        parameters.get("sh_degree", 0 if safe_fit_mode == "voxel_direct" else 3)
    )
    splat_count = validate_canonical_real_splat_json(
        asset_path,
        requested_sh_degree=requested_sh_degree,
        expected_camera_ids=[str(camera.get("image_id") or "") for camera in cameras],
        require_optimized_cameras=require_optimized_cameras,
        expected_optimization_domain="voxel_field"
        if safe_fit_mode == "voxel_direct"
        else None,
        expected_coordinate_space=(
            CANONICAL_COORDINATE_SPACE if safe_fit_mode != "voxel_direct" else None
        ),
        expected_camera_model=(
            CANONICAL_PROVIDER_CAMERA_MODEL if safe_fit_mode != "voxel_direct" else None
        ),
        expected_camera_convention=(
            CANONICAL_PROVIDER_CAMERA_CONVENTION
            if safe_fit_mode != "voxel_direct"
            else None
        ),
        expected_segment_ids=(
            source_segment_ids if safe_fit_mode != "voxel_direct" else ()
        ),
    )
    declared_splat_count = result.get("splat_count", metadata.get("splat_count"))
    if declared_splat_count is not None and int(declared_splat_count) != splat_count:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS provider splat_count does not match its canonical arrays"
        )
    requested_max_splats = parameters.get("max_splats")
    if isinstance(requested_max_splats, bool):
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS max_splats must be a positive integer"
        )
    if requested_max_splats is not None:
        try:
            safe_max_splats = int(requested_max_splats)
        except (TypeError, ValueError) as exc:
            raise RealGaussianSplatOptimizationError(
                "Real 3DGS max_splats must be a positive integer"
            ) from exc
        if safe_max_splats < 1 or safe_max_splats != requested_max_splats:
            raise RealGaussianSplatOptimizationError(
                "Real 3DGS max_splats must be a positive integer"
            )
        if splat_count > safe_max_splats:
            raise RealGaussianSplatOptimizationError(
                f"Real 3DGS provider returned {splat_count} splats, exceeding requested max_splats {safe_max_splats}"
            )
    return RealGaussianSplatAsset(
        path=str(asset_path),
        cache_key=cache_key,
        splat_count=splat_count,
        metadata={
            **metadata,
            "contract_version": "pt3_real_3dgs/v1",
            "representation": "real_3dgs",
            "fit_mode": safe_fit_mode,
            "coordinate_space": (
                CANONICAL_COORDINATE_SPACE
                if safe_fit_mode != "voxel_direct"
                else metadata.get("coordinate_space", CANONICAL_COORDINATE_SPACE)
            ),
            "camera_model": (
                CANONICAL_PROVIDER_CAMERA_MODEL
                if safe_fit_mode != "voxel_direct"
                else metadata.get("camera_model", "none")
            ),
            **(
                {"camera_convention": CANONICAL_PROVIDER_CAMERA_CONVENTION}
                if safe_fit_mode != "voxel_direct"
                else {}
            ),
            "cache_key": cache_key,
            "splat_count": splat_count,
        },
    )


def _validated_voxel_geometry(
    volume_geometry: Mapping[str, Any] | None,
    source_files: Sequence[str],
) -> dict[str, Any]:
    geometry = dict(volume_geometry or {})
    shape = geometry.get("shape_zyx")
    if not isinstance(shape, (list, tuple)) or len(shape) != 3:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS fitting requires server-inferred shape_zyx geometry"
        )
    try:
        shape_zyx = tuple(int(value) for value in shape)
    except (TypeError, ValueError) as exc:
        raise RealGaussianSplatOptimizationError(
            "shape_zyx must contain three integers"
        ) from exc
    if any(value < 1 for value in shape_zyx):
        raise RealGaussianSplatOptimizationError(
            "shape_zyx dimensions must be positive"
        )

    source_format = str(geometry.get("format") or "").strip()
    if source_format not in {"slice_stack", "multipage_tiff", "numpy"}:
        raise RealGaussianSplatOptimizationError(
            f"Real 3DGS fitting does not support source format {source_format!r}"
        )
    if not source_files:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS fitting requires source voxel files"
        )
    channel_count = geometry.get("channel_count", 1)
    color_mode = geometry.get("color_mode", "scalar")
    if type(channel_count) is not int or (channel_count, color_mode) not in {
        (1, "scalar"),
        (3, "rgb"),
        (4, "rgba"),
    }:
        raise RealGaussianSplatOptimizationError(
            "Real 3DGS volume geometry must declare scalar, RGB, or RGBA channel layout"
        )
    return {
        **geometry,
        "format": source_format,
        "shape_zyx": shape_zyx,
        "channel_count": channel_count,
        "color_mode": color_mode,
        "spacing_xyz": geometry.get("spacing_xyz") or (1.0, 1.0, 1.0),
        "origin_xyz": geometry.get("origin_xyz") or (0.0, 0.0, 0.0),
        "direction": geometry.get("direction")
        or (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0),
    }


def _canonical_provider_segmentation(
    segmentation: Mapping[str, Any] | None,
    labels: Any,
) -> dict[str, Any]:
    """Pass providers only validated inline labels plus non-source metadata."""

    if labels is None:
        return {}
    label_source_keys = {
        "label_volume",
        "voxel_labels",
        "labels",
        "label_slices",
        "labelSlices",
        "url",
        "asset_url",
        "href",
        "path",
        "label_url",
        "labels_url",
    }
    metadata = {
        str(key): value
        for key, value in (segmentation or {}).items()
        if key not in label_source_keys
    }
    return {
        **metadata,
        # Providers are trusted local Python callables (the request also
        # carries a callback and local paths), so keep the normalized uint8
        # array compact instead of expanding it into millions of Python ints.
        "label_volume": labels,
    }
