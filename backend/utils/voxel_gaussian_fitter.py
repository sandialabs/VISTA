"""Deterministic reference fitting of anisotropic Gaussians to voxel fields.

This module deliberately operates in the source volume instead of rendering
synthetic camera views.  It is a dependency-light analytic reference fitter,
not a differentiable global optimizer: spatially connected voxels with similar
scalar values and identical segment labels are grouped, and each group is
replaced by the Gaussian with matching first and second physical moments.

The public function returns the same mapping shape as a trusted real-3DGS
provider (``asset_path``, ``splat_count``, and ``metadata``), so the router can
use it directly while retaining the canonical ``pt3_real_3dgs/v1`` asset.
"""

from __future__ import annotations

import hashlib
import heapq
import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from utils.volume_loader import (
    REFERENCE_VOLUME_READ_LIMITS,
    VolumeInfo,
    load_multipage_tiff,
    read_numpy_volume_array,
)

ProgressCallback = Callable[[float, str], None]
MAX_REFERENCE_SPLATS = 100_000
MAX_REFERENCE_ACTIVE_VOXELS = 1_000_000
MAX_REFERENCE_TOTAL_VOXELS = REFERENCE_VOLUME_READ_LIMITS.max_voxels
_SH_DC_NORMALIZATION = 0.28209479177387814
_IDENTITY_DIRECTION = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
_NEIGHBOR_OFFSETS = ((0, 0, 1), (0, 1, 0), (1, 0, 0))
# A structured NumPy buffer replaces millions of Python edge tuples.  At the
# one-million-active-voxel reference limit, the worst-case forward-edge buffer
# is 48 MiB (three 16-byte records per voxel) and is sorted in place.
_CANDIDATE_EDGE_DTYPE = np.dtype(
    [("delta", "<f8"), ("left", "<i4"), ("right", "<i4")],
    align=False,
)


@dataclass(frozen=True)
class VoxelGaussianFitParameters:
    """Parameters for the deterministic voxel-domain reference fitter.

    ``scalar_similarity`` is measured in normalized full-volume scalar units.
    With zero, only exactly equal adjacent voxels join initially.  If those
    initial regions exceed ``max_splats``, the closest adjacent regions are
    merged deterministically without crossing a segment or empty-space gap.

    A missing ``density_threshold`` treats exactly zero as empty.  A provided
    threshold includes voxels whose scalar is greater than or equal to it.
    """

    max_splats: int = 50_000
    scalar_similarity: float = 0.05
    density_threshold: float | None = None
    opacity_min: float = 0.02
    opacity_max: float = 0.98


class VoxelGaussianFitError(ValueError):
    """Raised when a voxel field cannot satisfy the fitting contract."""


def _bounded_file_sample_shape(
    source_shape: Sequence[int],
    *,
    max_voxels: int | None = None,
) -> tuple[int, int, int]:
    """Return an endpoint-preserving uniform-grid shape within the fit budget."""

    shape = _validate_volume_shape(source_shape)
    if max_voxels is None:
        budget = MAX_REFERENCE_ACTIVE_VOXELS
    elif isinstance(max_voxels, bool) or not isinstance(max_voxels, int):
        raise VoxelGaussianFitError("sample voxel budget must be a positive integer")
    else:
        budget = max_voxels
    if budget < 1:
        raise VoxelGaussianFitError("sample voxel budget must be positive")
    if math.prod(shape) <= budget:
        return shape
    minimum_shape = tuple(2 if dimension > 1 else 1 for dimension in shape)
    if math.prod(minimum_shape) > budget:
        raise VoxelGaussianFitError(
            "sample voxel budget is too small to preserve every non-singleton axis"
        )

    def shape_for_stride(stride: int) -> tuple[int, int, int]:
        return tuple(
            max(minimum, (dimension + stride - 1) // stride)
            for dimension, minimum in zip(shape, minimum_shape, strict=False)
        )

    low, high = 1, max(shape)
    while low < high:
        stride = (low + high) // 2
        if math.prod(shape_for_stride(stride)) <= budget:
            high = stride
        else:
            low = stride + 1
    sampled_shape = shape_for_stride(low)
    if math.prod(sampled_shape) > budget:  # defensive guard for future changes
        raise VoxelGaussianFitError("could not construct a bounded voxel sampling grid")
    return sampled_shape


def _sampled_spacing_xyz(
    spacing_xyz: np.ndarray,
    *,
    source_shape_zyx: tuple[int, int, int],
    sampled_shape_zyx: tuple[int, int, int],
) -> np.ndarray:
    index_scale_zyx = np.asarray(
        [
            (source - 1) / (sampled - 1) if sampled > 1 else 1.0
            for source, sampled in zip(
                source_shape_zyx, sampled_shape_zyx, strict=False
            )
        ],
        dtype=np.float64,
    )
    return spacing_xyz * index_scale_zyx[::-1]


def _sampling_metadata(
    *,
    source_shape: tuple[int, int, int],
    sampled_shape: tuple[int, int, int],
    reducer: str | None = None,
) -> dict[str, Any]:
    index_scale_zyx = [
        (source - 1) / (sampled - 1) if sampled > 1 else 1.0
        for source, sampled in zip(source_shape, sampled_shape, strict=False)
    ]
    return {
        "strategy": (
            "conservative_block_reduction" if sampled_shape != source_shape else "exact"
        ),
        "reducer": reducer if sampled_shape != source_shape else None,
        "applied": sampled_shape != source_shape,
        "source_dimensions": list(source_shape),
        "fitted_dimensions": list(sampled_shape),
        "source_voxel_count": math.prod(source_shape),
        "fitted_voxel_count": math.prod(sampled_shape),
        "maximum_fitted_voxels": MAX_REFERENCE_ACTIVE_VOXELS,
        "source_index_scale_zyx": index_scale_zyx,
        "coordinate_mapping": (
            "selected_source_voxel"
            if sampled_shape != source_shape
            else "identity_grid"
        ),
    }


class _DisjointSet:
    def __init__(self, size: int) -> None:
        self.parent = np.arange(size, dtype=np.int64)
        self.rank = np.zeros(size, dtype=np.uint8)

    def find(self, item: int) -> int:
        parent = self.parent
        root = item
        while int(parent[root]) != root:
            root = int(parent[root])
        while int(parent[item]) != item:
            next_item = int(parent[item])
            parent[item] = root
            item = next_item
        return root

    def union(self, left: int, right: int) -> bool:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return False
        left_rank = int(self.rank[left_root])
        right_rank = int(self.rank[right_root])
        if left_rank < right_rank or (
            left_rank == right_rank and left_root > right_root
        ):
            left_root, right_root = right_root, left_root
            left_rank, right_rank = right_rank, left_rank
        self.parent[right_root] = left_root
        if left_rank == right_rank:
            self.rank[left_root] += 1
        return True


def fit_voxel_gaussian_splat_asset(
    volume_info: VolumeInfo,
    *,
    volume_stack_id: str,
    output_dir: str | Path,
    source_image_ids: Sequence[str] | None = None,
    parameters: VoxelGaussianFitParameters | Mapping[str, Any] | None = None,
    voxel_data: Any | None = None,
    segmentation_labels: Any | None = None,
    spacing: Sequence[float] = (1.0, 1.0, 1.0),
    origin: Sequence[float] = (0.0, 0.0, 0.0),
    direction: Sequence[float] = _IDENTITY_DIRECTION,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Fit a canonical degree-0 Gaussian asset directly to a scalar volume.

    Coordinates use the conventional physical-image transform
    ``origin + direction @ ([x, y, z] * spacing)``.  ``volume_info.shape`` and
    all inline arrays use ``[z, y, x]`` order.  Segment label zero means
    unsegmented; nonzero labels must be integers from 1 through 255.

    The returned provider-like mapping has these keys:

    ``asset_path``
        Absolute path to the canonical JSON asset.
    ``cache_key``
        Content-derived deterministic key for the voxel fit.
    ``splat_count``
        Number of fitted Gaussian primitives.
    ``metadata``
        Includes ``optimized_parameters`` plus density and approximation data.
    """

    if volume_info.channel_count != 1:
        raise VoxelGaussianFitError(
            "Real 3DGS fitting supports scalar volumes only; "
            f"received {volume_info.color_mode.upper()} volume data"
        )

    fit_parameters = _coerce_parameters(parameters)
    spacing_vector = _finite_vector(spacing, length=3, field="spacing")
    if np.any(spacing_vector <= 0):
        raise VoxelGaussianFitError("spacing values must be positive")
    origin_vector = _finite_vector(origin, length=3, field="origin")
    direction_matrix = _direction_matrix(direction)
    source_shape = _validate_volume_shape(volume_info.shape)
    if math.prod(source_shape) > MAX_REFERENCE_TOTAL_VOXELS:
        raise VoxelGaussianFitError(
            "The built-in analytic fitter is limited to "
            f"{MAX_REFERENCE_TOTAL_VOXELS} total voxels; downsample the volume "
            "or configure a scalable provider"
        )
    _validate_physical_geometry(
        shape=source_shape,
        spacing=spacing_vector,
        origin=origin_vector,
        direction=direction_matrix,
    )

    # Large, plain .npy fields can be conservatively block-reduced from a
    # memory map before a float64 working volume is allocated. Archives cannot
    # provide bounded random access and are rejected above the direct-fit
    # budget instead of being inflated into multi-gigabyte arrays.
    numpy_source_path = (
        Path(volume_info.source_files[0])
        if voxel_data is None
        and volume_info.format == "numpy"
        and len(volume_info.source_files) == 1
        else None
    )
    scalable_npy = (
        numpy_source_path is not None and numpy_source_path.suffix.lower() == ".npy"
    )
    if (
        numpy_source_path is not None
        and numpy_source_path.suffix.lower() == ".npz"
        and math.prod(source_shape) > MAX_REFERENCE_ACTIVE_VOXELS
    ):
        raise VoxelGaussianFitError(
            "The built-in analytic fitter cannot safely sample a compressed .npz "
            f"volume above {MAX_REFERENCE_ACTIVE_VOXELS} voxels; extract it to a "
            "plain .npy file or configure a scalable provider"
        )
    shape = _bounded_file_sample_shape(source_shape) if scalable_npy else source_shape
    sample_reducer = (
        "maximum" if fit_parameters.density_threshold is not None else "nonzero_extrema"
    )
    fitted_spacing_vector = _sampled_spacing_xyz(
        spacing_vector,
        source_shape_zyx=source_shape,
        sampled_shape_zyx=shape,
    )
    _validate_physical_geometry(
        shape=shape,
        spacing=fitted_spacing_vector,
        origin=origin_vector,
        direction=direction_matrix,
    )
    sampling = _sampling_metadata(
        source_shape=source_shape,
        sampled_shape=shape,
        reducer=sample_reducer,
    )

    _progress(progress_callback, 0.0, "loading_voxels")
    volume, sampled_source_flat_indices = _load_voxel_array(
        volume_info,
        voxel_data,
        sample_shape=shape if shape != source_shape else None,
        sample_reduction=sample_reducer,
    )
    if volume.shape != shape:
        raise VoxelGaussianFitError(
            f"voxel_data shape {volume.shape} does not match VolumeInfo shape {shape}"
        )
    if sampled_source_flat_indices is not None:
        selected_source_index_digest = hashlib.sha256(
            np.asarray(sampled_source_flat_indices, dtype="<i8").tobytes(order="C")
        ).hexdigest()
        sampling = {
            **sampling,
            "selected_source_index_digest": selected_source_index_digest,
        }
        sample_local_points = _selected_source_local_points(
            sampled_source_flat_indices,
            source_shape=source_shape,
            source_spacing=spacing_vector,
            direction=direction_matrix,
        )
    else:
        sample_local_points = None
    labels, source_segmentation_digest = _validated_segmentation_labels(
        segmentation_labels,
        source_shape=source_shape,
        sampled_shape=shape,
        sampled_source_flat_indices=sampled_source_flat_indices,
    )
    _progress(progress_callback, 10.0, "validating_volume")

    scalar_min = float(np.min(volume))
    scalar_max = float(np.max(volume))
    if fit_parameters.density_threshold is None:
        active_mask = volume != 0.0
        effective_threshold: float | None = None
    else:
        active_mask = volume >= fit_parameters.density_threshold
        effective_threshold = float(fit_parameters.density_threshold)
    active_voxel_count = int(np.count_nonzero(active_mask))
    if not active_voxel_count:
        raise VoxelGaussianFitError("No voxels satisfy the density threshold")
    if active_voxel_count > MAX_REFERENCE_ACTIVE_VOXELS:
        raise VoxelGaussianFitError(
            "The built-in analytic fitter is limited to "
            f"{MAX_REFERENCE_ACTIVE_VOXELS} active voxels; increase density_threshold, "
            "downsample the volume, or configure a scalable provider"
        )
    active_zyx = np.argwhere(active_mask)

    if scalar_max == scalar_min:
        normalized_volume = np.ones_like(volume, dtype=np.float64)
    else:
        # Scale before subtracting so valid finite extremes such as
        # [-1e308, 1e308] do not overflow their range to infinity.
        scalar_scale = max(abs(scalar_min), abs(scalar_max))
        scaled_volume = volume / scalar_scale
        scaled_min = scalar_min / scalar_scale
        scaled_span = (scalar_max / scalar_scale) - scaled_min
        normalized_volume = (scaled_volume - scaled_min) / scaled_span

    _progress(progress_callback, 25.0, "grouping_voxels")
    groups = _group_active_voxels(
        active_mask,
        normalized_volume,
        labels,
        scalar_similarity=fit_parameters.scalar_similarity,
        max_splats=fit_parameters.max_splats,
        progress_callback=progress_callback,
    )
    groups = _refine_groups_to_budget(
        groups,
        shape=shape,
        normalized_volume=normalized_volume,
        spacing=fitted_spacing_vector,
        direction=direction_matrix,
        sample_local_points=sample_local_points,
        target_splats=min(fit_parameters.max_splats, len(active_zyx)),
        progress_callback=progress_callback,
    )

    _progress(progress_callback, 55.0, "fitting_gaussians")
    payload_arrays, approximation_metrics = _fit_groups(
        groups,
        volume=volume,
        normalized_volume=normalized_volume,
        labels=labels,
        spacing=fitted_spacing_vector,
        voxel_spacing=spacing_vector,
        origin=origin_vector,
        direction=direction_matrix,
        sample_local_points=sample_local_points,
        parameters=fit_parameters,
        progress_callback=progress_callback,
    )
    splat_count = len(payload_arrays["means"])

    geometry = {
        "spacing": fitted_spacing_vector.tolist(),
        "origin": origin_vector.tolist(),
        "direction": direction_matrix.reshape(-1).tolist(),
    }
    source_geometry = {
        "spacing": spacing_vector.tolist(),
        "origin": origin_vector.tolist(),
        "direction": direction_matrix.reshape(-1).tolist(),
    }
    cache_key = _build_cache_key(
        volume_info=volume_info,
        volume_stack_id=volume_stack_id,
        source_image_ids=source_image_ids,
        parameters=fit_parameters,
        volume=volume,
        labels=labels,
        geometry=geometry,
        sampling=sampling,
        source_segmentation_digest=source_segmentation_digest,
        sampled_source_flat_indices=sampled_source_flat_indices,
    )
    metadata = {
        "asset_type": "gaussian_splat",
        "contract_version": "pt3_real_3dgs/v1",
        "representation": "real_3dgs",
        "optimization_method": "voxel_direct_moment_fit",
        "fit_class": "analytic_reference",
        "optimization_domain": "voxel_field",
        "camera_model": "none",
        "coordinate_space": "physical",
        "volume_stack_id": str(volume_stack_id),
        "source_image_ids": [str(item) for item in (source_image_ids or ())],
        "source_files": [Path(str(item)).name for item in volume_info.source_files],
        "dimensions": list(shape),
        "source_dimensions": list(source_shape),
        "fitted_dimensions": list(shape),
        "physical_space": geometry,
        "source_physical_space": source_geometry,
        "sampling": sampling,
        "scalar_range": [scalar_min, scalar_max],
        "density_mapping": {
            "threshold": effective_threshold,
            "implicit_empty_value": 0.0 if effective_threshold is None else None,
            "opacity_min": fit_parameters.opacity_min,
            "opacity_max": fit_parameters.opacity_max,
        },
        "fit_parameters": asdict(fit_parameters),
        "fitted_parameters": [
            "means",
            "covariance",
            "rotation",
            "opacity",
            "spherical_harmonics",
        ],
        "parameter_provenance": {
            "means": "closed_form_weighted_first_moment",
            "covariance": "closed_form_weighted_second_moment",
            "rotation": "eigendecomposition_of_fitted_covariance",
            "opacity": "configured_scalar_density_mapping",
            "spherical_harmonics": "degree0_scalar_mapping",
            "camera_poses": "not_applicable",
        },
        "global_reconstruction_optimized": False,
        "request_parameter_scope": {
            "consumed": [
                "density_threshold",
                "max_splats",
                "opacity_max",
                "opacity_min",
                "scalar_similarity",
            ],
            "not_applicable": [
                "iterations",
                "densification_interval",
                "convergence_tolerance",
                "optimize_camera_poses",
                "higher_order_spherical_harmonics",
            ],
        },
        "approximation_metrics": approximation_metrics,
        "cache_key": cache_key,
        "splat_count": splat_count,
    }
    payload = {
        "contract_version": "pt3_real_3dgs/v1",
        "representation": "real_3dgs",
        "optimization_method": "voxel_direct_moment_fit",
        "fit_class": "analytic_reference",
        "optimization_domain": "voxel_field",
        "camera_model": "none",
        "coordinate_space": "physical",
        "sh_degree": 0,
        **payload_arrays,
        "approximation_metrics": approximation_metrics,
        "metadata": metadata,
    }

    _progress(progress_callback, 90.0, "writing_asset")
    safe_output_dir = Path(output_dir).resolve()
    safe_output_dir.mkdir(parents=True, exist_ok=True)
    asset_path = safe_output_dir / f"{cache_key}.json"
    asset_path.write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    _progress(progress_callback, 100.0, "complete")
    return {
        "asset_path": str(asset_path),
        "cache_key": cache_key,
        "splat_count": splat_count,
        "metadata": metadata,
    }


def _coerce_parameters(
    parameters: VoxelGaussianFitParameters | Mapping[str, Any] | None,
) -> VoxelGaussianFitParameters:
    if parameters is None:
        result = VoxelGaussianFitParameters()
    elif isinstance(parameters, VoxelGaussianFitParameters):
        result = parameters
    elif isinstance(parameters, Mapping):
        accepted = {
            field.name
            for field in VoxelGaussianFitParameters.__dataclass_fields__.values()
        }
        result = VoxelGaussianFitParameters(
            **{key: value for key, value in parameters.items() if key in accepted}
        )
    else:
        raise VoxelGaussianFitError(
            "parameters must be a mapping or VoxelGaussianFitParameters"
        )

    if (
        isinstance(result.max_splats, bool)
        or not isinstance(result.max_splats, int)
        or not 1 <= result.max_splats <= MAX_REFERENCE_SPLATS
    ):
        raise VoxelGaussianFitError(
            f"max_splats must be an integer from 1 through {MAX_REFERENCE_SPLATS}"
        )
    _finite_scalar(result.scalar_similarity, field="scalar_similarity")
    if not 0.0 <= result.scalar_similarity <= 1.0:
        raise VoxelGaussianFitError("scalar_similarity must be between 0 and 1")
    if result.density_threshold is not None:
        _finite_scalar(result.density_threshold, field="density_threshold")
    _finite_scalar(result.opacity_min, field="opacity_min")
    _finite_scalar(result.opacity_max, field="opacity_max")
    if not 0.0 <= result.opacity_min <= result.opacity_max <= 1.0:
        raise VoxelGaussianFitError(
            "opacity bounds must satisfy 0 <= opacity_min <= opacity_max <= 1"
        )
    return result


def _finite_scalar(value: Any, *, field: str) -> float:
    if isinstance(value, (bool, np.bool_)):
        raise VoxelGaussianFitError(f"{field} must be a finite number")
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise VoxelGaussianFitError(f"{field} must be a finite number") from exc
    if not math.isfinite(numeric):
        raise VoxelGaussianFitError(f"{field} must be a finite number")
    return numeric


def _finite_vector(value: Sequence[float], *, length: int, field: str) -> np.ndarray:
    if isinstance(value, (str, bytes)) or len(value) != length:
        raise VoxelGaussianFitError(f"{field} must contain exactly {length} values")
    try:
        vector = np.asarray(value, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise VoxelGaussianFitError(f"{field} must contain only numbers") from exc
    if vector.shape != (length,) or not np.all(np.isfinite(vector)):
        raise VoxelGaussianFitError(
            f"{field} must contain exactly {length} finite numbers"
        )
    return vector


def _direction_matrix(direction: Sequence[float]) -> np.ndarray:
    vector = _finite_vector(direction, length=9, field="direction")
    matrix = vector.reshape(3, 3)
    if not np.allclose(matrix.T @ matrix, np.eye(3), rtol=0.0, atol=1e-6):
        raise VoxelGaussianFitError("direction must be an orthonormal 3x3 matrix")
    if not math.isclose(float(np.linalg.det(matrix)), 1.0, rel_tol=0.0, abs_tol=1e-6):
        raise VoxelGaussianFitError(
            "direction must be a proper rotation with determinant +1"
        )
    return matrix


def _validate_volume_shape(shape: Sequence[int]) -> tuple[int, int, int]:
    if len(shape) != 3:
        raise VoxelGaussianFitError(
            "VolumeInfo shape must have exactly three dimensions"
        )
    normalized = tuple(int(value) for value in shape)
    if any(value < 1 for value in normalized):
        raise VoxelGaussianFitError("VolumeInfo dimensions must be positive")
    return normalized


def _validate_physical_geometry(
    *,
    shape: tuple[int, int, int],
    spacing: np.ndarray,
    origin: np.ndarray,
    direction: np.ndarray,
) -> None:
    """Reject finite geometry that cannot be fitted safely in float64.

    Merely checking ``isfinite`` is insufficient: squaring a very large
    spacing or summing many very large physical coordinates can overflow even
    though every input value is finite.  These conservative bounds cover the
    reference fitter's worst-case coordinate sums and covariance sums for the
    full volume.  Real-world image geometry is many orders of magnitude below
    them.
    """

    voxel_count = math.prod(shape)
    maximum_float = float(np.finfo(np.float64).max)
    minimum_variance = float(np.nextafter(0.0, 1.0))
    minimum_spacing = math.sqrt(12.0 * minimum_variance)
    coordinate_limit = maximum_float / (8.0 * voxel_count)
    span_limit = math.sqrt(maximum_float / (12.0 * voxel_count))
    max_index_xyz = np.asarray(shape[::-1], dtype=np.float64) - 1.0

    with np.errstate(over="ignore", invalid="ignore"):
        local_extent = max_index_xyz * spacing
        world_span = np.abs(direction) @ local_extent
        corner_offsets = np.asarray(
            [
                direction @ np.asarray((x, y, z), dtype=np.float64)
                for x in (0.0, local_extent[0])
                for y in (0.0, local_extent[1])
                for z in (0.0, local_extent[2])
            ]
        )
        corners = origin + corner_offsets

    if (
        not np.all(np.isfinite(local_extent))
        or not np.all(np.isfinite(world_span))
        or not np.all(np.isfinite(corners))
        or float(np.min(spacing)) < minimum_spacing
        or float(np.max(spacing)) > span_limit
        or float(np.max(world_span)) > span_limit
        or float(np.max(np.abs(corners))) > coordinate_limit
    ):
        raise VoxelGaussianFitError(
            "physical geometry exceeds the stable float64 limits of the built-in fitter"
        )

    shape_xyz = shape[::-1]
    for axis, axis_size in enumerate(shape_xyz):
        if axis_size < 2:
            continue
        step = direction[:, axis] * spacing[axis]
        tolerance = max(float(spacing[axis]) * 0.01, minimum_spacing)
        for corner in corners:
            realized_step = (corner + step) - corner
            if not np.allclose(realized_step, step, rtol=0.01, atol=tolerance * 1e-10):
                raise VoxelGaussianFitError(
                    "physical geometry loses voxel-step precision at the supplied origin"
                )


def _load_voxel_array(
    volume_info: VolumeInfo,
    voxel_data: Any | None,
    *,
    sample_shape: tuple[int, int, int] | None = None,
    sample_reduction: str = "point",
) -> tuple[np.ndarray, np.ndarray | None]:
    sampled_source_flat_indices: np.ndarray | None = None
    if voxel_data is not None:
        raw = voxel_data
    elif volume_info.format == "slice_stack":
        raw = np.stack(
            [_image_scalar_array(Path(path)) for path in volume_info.source_files],
            axis=0,
        )
    elif volume_info.format == "multipage_tiff":
        if len(volume_info.source_files) != 1:
            raise VoxelGaussianFitError(
                "multipage_tiff VolumeInfo must name exactly one source file"
            )
        source_path = Path(volume_info.source_files[0])
        try:
            inspected = load_multipage_tiff(
                source_path, limits=REFERENCE_VOLUME_READ_LIMITS
            )
        except (OSError, ValueError) as exc:
            raise VoxelGaussianFitError(
                f"Could not safely inspect TIFF voxel source {source_path.name}: {exc}"
            ) from exc
        if inspected.shape != tuple(volume_info.shape):
            raise VoxelGaussianFitError(
                "TIFF voxel source dimensions do not match the preflighted volume"
            )
        raw = np.empty(inspected.shape, dtype=np.float64)
        try:
            with Image.open(source_path) as image:
                for frame_index in range(inspected.shape[0]):
                    image.seek(frame_index)
                    frame = np.asarray(image.convert("F"), dtype=np.float64)
                    if frame.shape != inspected.shape[1:]:
                        raise VoxelGaussianFitError(
                            "TIFF frame dimensions changed during decode"
                        )
                    raw[frame_index] = frame
        except (OSError, ValueError, EOFError) as exc:
            raise VoxelGaussianFitError(
                f"Could not read TIFF voxel source {source_path.name}"
            ) from exc
    elif volume_info.format == "numpy":
        if len(volume_info.source_files) != 1:
            raise VoxelGaussianFitError(
                "numpy VolumeInfo must name exactly one source file"
            )
        source_path = Path(volume_info.source_files[0])
        try:
            loaded = read_numpy_volume_array(
                source_path,
                limits=REFERENCE_VOLUME_READ_LIMITS,
                sample_shape=sample_shape,
                sample_reduction=sample_reduction,
                return_source_flat_indices=sample_shape is not None,
            )
            if isinstance(loaded, tuple):
                raw, sampled_source_flat_indices = loaded
            else:
                raw = loaded
        except (OSError, ValueError) as exc:
            raise VoxelGaussianFitError(
                f"Could not read NumPy voxel source {source_path.name}: {exc}"
            ) from exc
    else:
        raise VoxelGaussianFitError(
            f"Decoded voxel_data is required for unsupported source format {volume_info.format!r}"
        )

    try:
        source_array = np.asarray(raw)
    except (TypeError, ValueError) as exc:
        raise VoxelGaussianFitError(
            "voxel_data must be a numeric three-dimensional array"
        ) from exc
    if source_array.ndim != 3:
        raise VoxelGaussianFitError(
            "voxel_data must be a numeric three-dimensional array"
        )
    if source_array.size > MAX_REFERENCE_TOTAL_VOXELS:
        raise VoxelGaussianFitError(
            f"The built-in analytic fitter is limited to {MAX_REFERENCE_TOTAL_VOXELS} total voxels"
        )
    if source_array.nbytes > REFERENCE_VOLUME_READ_LIMITS.max_decoded_bytes:
        raise VoxelGaussianFitError(
            "voxel_data exceeds the built-in fitter's decoded-byte limit"
        )
    try:
        volume = np.asarray(source_array, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise VoxelGaussianFitError(
            "voxel_data must be a numeric three-dimensional array"
        ) from exc
    if not np.all(np.isfinite(volume)):
        raise VoxelGaussianFitError("voxel_data must contain only finite values")
    if sampled_source_flat_indices is not None:
        sampled_source_flat_indices = np.ascontiguousarray(
            sampled_source_flat_indices,
            dtype=np.int64,
        )
        if sampled_source_flat_indices.shape != volume.shape:
            raise VoxelGaussianFitError(
                "bounded NumPy sample coordinates do not match the sampled volume"
            )
    return np.ascontiguousarray(volume), sampled_source_flat_indices


def _image_scalar_array(path: Path) -> np.ndarray:
    try:
        with Image.open(path) as image:
            return np.asarray(image.convert("F"), dtype=np.float64)
    except (OSError, ValueError) as exc:
        raise VoxelGaussianFitError(f"Could not read voxel slice {path}") from exc


def _validated_segmentation_labels(
    labels: Any | None,
    *,
    source_shape: tuple[int, int, int],
    sampled_shape: tuple[int, int, int],
    sampled_source_flat_indices: np.ndarray | None = None,
) -> tuple[np.ndarray, str | None]:
    if labels is None:
        return np.zeros(sampled_shape, dtype=np.uint8), None
    raw = np.asarray(labels)
    if raw.shape != source_shape:
        raise VoxelGaussianFitError(
            f"segmentation_labels shape {raw.shape} does not match VolumeInfo shape {source_shape}"
        )
    if np.issubdtype(raw.dtype, np.bool_):
        raise VoxelGaussianFitError(
            "segmentation_labels must contain integer IDs from 0 through 255"
        )
    if np.issubdtype(raw.dtype, np.integer):
        dtype_bounds = np.iinfo(raw.dtype)
        if dtype_bounds.min < 0 and int(np.min(raw)) < 0:
            raise VoxelGaussianFitError(
                "segmentation_labels must contain integer IDs from 0 through 255"
            )
        if dtype_bounds.max > 255 and int(np.max(raw)) > 255:
            raise VoxelGaussianFitError(
                "segmentation_labels must contain integer IDs from 0 through 255"
            )
    else:
        try:
            numeric = raw.astype(np.float64)
        except (TypeError, ValueError) as exc:
            raise VoxelGaussianFitError(
                "segmentation_labels must contain integer IDs from 0 through 255"
            ) from exc
        if (
            not np.all(np.isfinite(numeric))
            or not np.all(numeric == np.floor(numeric))
            or np.any(numeric < 0)
            or np.any(numeric > 255)
        ):
            raise VoxelGaussianFitError(
                "segmentation_labels must contain integer IDs from 0 through 255"
            )

    canonical_source = np.ascontiguousarray(raw, dtype=np.uint8)
    source_digest = hashlib.sha256(canonical_source.tobytes(order="C")).hexdigest()
    source_segment_ids = set(
        int(value) for value in np.unique(canonical_source) if value
    )
    if sampled_shape != source_shape:
        if sampled_source_flat_indices is None:
            raise VoxelGaussianFitError(
                "bounded NumPy segmentation requires source-voxel coordinates"
            )
        raw = canonical_source.reshape(-1)[sampled_source_flat_indices.reshape(-1)]
        raw = raw.reshape(sampled_shape)
        sampled_segment_ids = set(int(value) for value in np.unique(raw) if value)
        missing_segment_ids = sorted(source_segment_ids - sampled_segment_ids)
        if missing_segment_ids:
            missing_text = ", ".join(str(value) for value in missing_segment_ids[:8])
            suffix = "..." if len(missing_segment_ids) > 8 else ""
            raise VoxelGaussianFitError(
                "Bounded sampling cannot preserve every segmentation ID "
                f"({missing_text}{suffix}); reduce the source volume or configure "
                "a scalable provider"
            )
    else:
        raw = canonical_source
    if raw.shape != sampled_shape:
        raise VoxelGaussianFitError(
            "segmentation_labels must contain integer IDs from 0 through 255"
        )
    return np.ascontiguousarray(raw, dtype=np.uint8), source_digest


def _group_active_voxels(
    active_mask: np.ndarray,
    normalized_volume: np.ndarray,
    labels: np.ndarray,
    *,
    scalar_similarity: float,
    max_splats: int,
    progress_callback: ProgressCallback | None = None,
) -> list[np.ndarray]:
    shape = active_mask.shape
    active_flat = np.flatnonzero(active_mask.reshape(-1))
    active_lookup = np.full(active_mask.size, -1, dtype=np.int32)
    active_lookup[active_flat] = np.arange(len(active_flat), dtype=np.int32)
    normalized_flat = normalized_volume.reshape(-1)
    labels_flat = labels.reshape(-1)
    disjoint = _DisjointSet(len(active_flat))
    active_coordinates = np.argwhere(active_mask)
    progress_interval = max(1, len(active_coordinates) // 10)
    for coordinate_index, (z, y, x) in enumerate(active_coordinates):
        left_flat = int(np.ravel_multi_index((z, y, x), shape))
        left_active = int(active_lookup[left_flat])
        for dz, dy, dx in _NEIGHBOR_OFFSETS:
            nz, ny, nx = int(z + dz), int(y + dy), int(x + dx)
            if (
                nz >= shape[0]
                or ny >= shape[1]
                or nx >= shape[2]
                or not active_mask[nz, ny, nx]
            ):
                continue
            right_flat = int(np.ravel_multi_index((nz, ny, nx), shape))
            if int(labels_flat[left_flat]) != int(labels_flat[right_flat]):
                continue
            right_active = int(active_lookup[right_flat])
            delta = abs(
                float(normalized_flat[left_flat]) - float(normalized_flat[right_flat])
            )
            if delta <= scalar_similarity + 1e-15:
                disjoint.union(left_active, right_active)
        if coordinate_index % progress_interval == 0:
            _progress(
                progress_callback,
                25.0 + 10.0 * coordinate_index / max(1, len(active_coordinates)),
                "grouping_voxels",
            )

    # Count roots without allocating a Python set containing up to one million
    # boxed integers.
    group_count = sum(
        1 for index in range(len(active_flat)) if disjoint.find(index) == index
    )
    if group_count > max_splats:
        candidate_edges = _bounded_candidate_edges(
            active_coordinates=active_coordinates,
            active_mask=active_mask,
            active_lookup=active_lookup,
            normalized_flat=normalized_flat,
            labels_flat=labels_flat,
            shape=shape,
            scalar_similarity=scalar_similarity,
        )
        for edge in candidate_edges:
            if disjoint.union(int(edge["left"]), int(edge["right"])):
                group_count -= 1
                if group_count <= max_splats:
                    break
        del candidate_edges
    if group_count > max_splats:
        raise VoxelGaussianFitError(
            "max_splats is smaller than the number of disconnected or segment-separated voxel regions"
        )

    grouped: dict[int, list[int]] = {}
    for active_index, flat_index in enumerate(active_flat):
        grouped.setdefault(disjoint.find(active_index), []).append(int(flat_index))
    return [
        np.asarray(indices, dtype=np.int64)
        for indices in sorted(grouped.values(), key=lambda group: group[0])
    ]


def _bounded_candidate_edges(
    *,
    active_coordinates: np.ndarray,
    active_mask: np.ndarray,
    active_lookup: np.ndarray,
    normalized_flat: np.ndarray,
    labels_flat: np.ndarray,
    shape: tuple[int, int, int],
    scalar_similarity: float,
) -> np.ndarray:
    """Return merge candidates in legacy `(delta, left, right)` order.

    Each active voxel has at most three forward six-neighborhood edges, so a
    fixed structured array has an exact upper bound.  Sorting this array in
    place preserves the previous deterministic merge order without retaining
    Python tuples whose per-object overhead dwarfed their numeric payload.
    """

    capacity = len(active_coordinates) * len(_NEIGHBOR_OFFSETS)
    edges = np.empty(capacity, dtype=_CANDIDATE_EDGE_DTYPE)
    edge_count = 0
    for z, y, x in active_coordinates:
        left_flat = int(np.ravel_multi_index((z, y, x), shape))
        left_active = int(active_lookup[left_flat])
        for dz, dy, dx in _NEIGHBOR_OFFSETS:
            nz, ny, nx = int(z + dz), int(y + dy), int(x + dx)
            if (
                nz >= shape[0]
                or ny >= shape[1]
                or nx >= shape[2]
                or not active_mask[nz, ny, nx]
            ):
                continue
            right_flat = int(np.ravel_multi_index((nz, ny, nx), shape))
            if int(labels_flat[left_flat]) != int(labels_flat[right_flat]):
                continue
            delta = abs(
                float(normalized_flat[left_flat]) - float(normalized_flat[right_flat])
            )
            if delta <= scalar_similarity + 1e-15:
                continue
            right_active = int(active_lookup[right_flat])
            edges[edge_count] = (
                delta,
                min(left_active, right_active),
                max(left_active, right_active),
            )
            edge_count += 1

    bounded = edges[:edge_count]
    bounded.sort(order=("delta", "left", "right"), kind="quicksort")
    return bounded


def _refine_groups_to_budget(
    groups: Sequence[np.ndarray],
    *,
    shape: tuple[int, int, int],
    normalized_volume: np.ndarray,
    spacing: np.ndarray,
    direction: np.ndarray,
    sample_local_points: np.ndarray | None,
    target_splats: int,
    progress_callback: ProgressCallback | None = None,
) -> list[np.ndarray]:
    """Split the highest spatial-error groups until the requested budget.

    Initial grouping establishes hard connected-component and segment
    boundaries.  Refinement only partitions an existing group, so it cannot
    bridge either boundary.  Extreme points on the largest physical principal
    axis seed a two-source graph Voronoi partition; every resulting child is
    therefore six-connected to its seed.
    """

    if len(groups) >= target_splats:
        return list(groups)

    active_groups: dict[int, np.ndarray] = {}
    candidates: list[tuple[float, int, int]] = []
    next_group_id = 0
    normalized_flat = normalized_volume.reshape(-1)

    def add_group(group: np.ndarray) -> None:
        nonlocal next_group_id
        group_id = next_group_id
        next_group_id += 1
        active_groups[group_id] = group
        if len(group) > 1:
            error = _group_spatial_sse(
                group,
                shape=shape,
                normalized_flat=normalized_flat,
                spacing=spacing,
                direction=direction,
                sample_local_points=sample_local_points,
            )
            heapq.heappush(candidates, (-error, int(group[0]), group_id))

    for group in groups:
        add_group(group)

    initial_group_count = len(active_groups)
    planned_splits = max(1, target_splats - initial_group_count)
    reported_bucket = -1
    while len(active_groups) < target_splats and candidates:
        _negative_error, _first_index, group_id = heapq.heappop(candidates)
        group = active_groups.pop(group_id, None)
        if group is None or len(group) < 2:
            continue
        left, right = _split_connected_group(
            group,
            shape=shape,
            normalized_flat=normalized_flat,
            spacing=spacing,
            direction=direction,
            sample_local_points=sample_local_points,
        )
        add_group(left)
        add_group(right)
        completed_splits = len(active_groups) - initial_group_count
        bucket = min(10, int(10 * completed_splits / planned_splits))
        if bucket != reported_bucket:
            reported_bucket = bucket
            _progress(
                progress_callback,
                35.0 + 20.0 * completed_splits / planned_splits,
                "refining_gaussian_groups",
            )

    return sorted(active_groups.values(), key=lambda group: int(group[0]))


def _selected_source_local_points(
    sampled_source_flat_indices: np.ndarray,
    *,
    source_shape: tuple[int, int, int],
    source_spacing: np.ndarray,
    direction: np.ndarray,
) -> np.ndarray:
    source_zyx = np.column_stack(
        np.unravel_index(sampled_source_flat_indices.reshape(-1), source_shape)
    ).astype(np.float64)
    source_xyz = source_zyx[:, [2, 1, 0]] * source_spacing
    return np.ascontiguousarray((direction @ source_xyz.T).T)


def _physical_points_for_flat_indices(
    flat_indices: np.ndarray,
    *,
    shape: tuple[int, int, int],
    spacing: np.ndarray,
    direction: np.ndarray,
    sample_local_points: np.ndarray | None = None,
) -> np.ndarray:
    if sample_local_points is not None:
        return sample_local_points[flat_indices]
    zyx = np.column_stack(np.unravel_index(flat_indices, shape)).astype(np.float64)
    xyz = zyx[:, [2, 1, 0]] * spacing
    return (direction @ xyz.T).T


def _group_spatial_sse(
    flat_indices: np.ndarray,
    *,
    shape: tuple[int, int, int],
    normalized_flat: np.ndarray,
    spacing: np.ndarray,
    direction: np.ndarray,
    sample_local_points: np.ndarray | None,
) -> float:
    points = _physical_points_for_flat_indices(
        flat_indices,
        shape=shape,
        spacing=spacing,
        direction=direction,
        sample_local_points=sample_local_points,
    )
    weights = np.maximum(normalized_flat[flat_indices], np.finfo(np.float64).eps)
    mean = np.sum(points * weights[:, None], axis=0) / float(np.sum(weights))
    return float(np.sum(weights * np.sum(np.square(points - mean), axis=1)))


def _split_connected_group(
    flat_indices: np.ndarray,
    *,
    shape: tuple[int, int, int],
    normalized_flat: np.ndarray,
    spacing: np.ndarray,
    direction: np.ndarray,
    sample_local_points: np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return two connected children oriented by largest physical extent."""

    points = _physical_points_for_flat_indices(
        flat_indices,
        shape=shape,
        spacing=spacing,
        direction=direction,
        sample_local_points=sample_local_points,
    )
    weights = np.maximum(normalized_flat[flat_indices], np.finfo(np.float64).eps)
    weight_sum = float(np.sum(weights))
    mean = np.sum(points * weights[:, None], axis=0) / weight_sum
    centered = points - mean
    covariance = (centered.T * weights) @ centered / weight_sum
    eigenvalues, eigenvectors = np.linalg.eigh((covariance + covariance.T) * 0.5)
    principal_axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    pivot = int(np.argmax(np.abs(principal_axis)))
    if principal_axis[pivot] < 0:
        principal_axis *= -1.0
    projections = points @ principal_axis
    ordered = np.lexsort((flat_indices, projections))
    left_seed = int(ordered[0])
    right_seed = int(ordered[-1])
    if left_seed == right_seed:
        raise AssertionError(
            "internal error: a multi-voxel group did not have two split seeds"
        )

    local_by_flat = {
        int(flat_index): index for index, flat_index in enumerate(flat_indices)
    }
    distances = np.full(len(flat_indices), np.inf, dtype=np.float64)
    owners = np.full(len(flat_indices), -1, dtype=np.int8)
    queue: list[tuple[float, int, int, int]] = []
    for owner, seed in enumerate((left_seed, right_seed)):
        distances[seed] = 0.0
        owners[seed] = owner
        heapq.heappush(queue, (0.0, owner, int(flat_indices[seed]), seed))

    neighbor_steps = (
        (-1, 0, 0, float(spacing[2])),
        (1, 0, 0, float(spacing[2])),
        (0, -1, 0, float(spacing[1])),
        (0, 1, 0, float(spacing[1])),
        (0, 0, -1, float(spacing[0])),
        (0, 0, 1, float(spacing[0])),
    )
    while queue:
        distance, owner, _flat_tiebreaker, local_index = heapq.heappop(queue)
        if distance > distances[local_index] + 1e-12 or owner != int(
            owners[local_index]
        ):
            continue
        z, y, x = np.unravel_index(int(flat_indices[local_index]), shape)
        for dz, dy, dx, uniform_step_cost in neighbor_steps:
            nz, ny, nx = z + dz, y + dy, x + dx
            if (
                nz < 0
                or ny < 0
                or nx < 0
                or nz >= shape[0]
                or ny >= shape[1]
                or nx >= shape[2]
            ):
                continue
            neighbor_flat = int(np.ravel_multi_index((nz, ny, nx), shape))
            neighbor_index = local_by_flat.get(neighbor_flat)
            if neighbor_index is None:
                continue
            step_cost = (
                float(np.linalg.norm(points[neighbor_index] - points[local_index]))
                if sample_local_points is not None
                else uniform_step_cost
            )
            candidate_distance = distance + step_cost
            old_distance = float(distances[neighbor_index])
            old_owner = int(owners[neighbor_index])
            if candidate_distance < old_distance - 1e-12 or (
                abs(candidate_distance - old_distance) <= 1e-12 and owner < old_owner
            ):
                distances[neighbor_index] = candidate_distance
                owners[neighbor_index] = owner
                heapq.heappush(
                    queue,
                    (candidate_distance, owner, neighbor_flat, neighbor_index),
                )

    if np.any(owners < 0):
        raise AssertionError("internal error: an input Gaussian group was disconnected")
    left = np.sort(flat_indices[owners == 0])
    right = np.sort(flat_indices[owners == 1])
    if not len(left) or not len(right):
        raise AssertionError(
            "internal error: Gaussian refinement produced an empty group"
        )
    return left, right


def _fit_groups(
    groups: Sequence[np.ndarray],
    *,
    volume: np.ndarray,
    normalized_volume: np.ndarray,
    labels: np.ndarray,
    spacing: np.ndarray,
    voxel_spacing: np.ndarray,
    origin: np.ndarray,
    direction: np.ndarray,
    sample_local_points: np.ndarray | None,
    parameters: VoxelGaussianFitParameters,
    progress_callback: ProgressCallback | None = None,
) -> tuple[dict[str, list[Any]], dict[str, Any]]:
    shape = volume.shape
    volume_flat = volume.reshape(-1)
    normalized_flat = normalized_volume.reshape(-1)
    labels_flat = labels.reshape(-1)
    # A conservative sample represents the selected source voxel, not the
    # entire coarse block.  Its intrinsic covariance therefore stays at source
    # voxel scale even though neighboring selected samples may be far apart.
    voxel_covariance = (
        direction @ np.diag(np.square(voxel_spacing) / 12.0) @ direction.T
    )

    means: list[list[float]] = []
    scales: list[list[float]] = []
    rotations: list[list[float]] = []
    opacities: list[float] = []
    sh_coefficients: list[list[float]] = []
    segment_ids: list[int | None] = []
    scalar_values: list[float] = []
    group_sizes: list[int] = []
    scalar_scale = max(
        abs(float(np.min(volume))),
        abs(float(np.max(volume))),
    )
    squared_scaled_scalar_error = 0.0
    squared_normalized_error = 0.0
    weighted_spatial_error = 0.0
    total_spatial_weight = 0.0

    progress_interval = max(1, len(groups) // 10)
    for group_index, flat_indices in enumerate(groups):
        local_points = _physical_points_for_flat_indices(
            flat_indices,
            shape=shape,
            spacing=spacing,
            direction=direction,
            sample_local_points=sample_local_points,
        )
        normalized_values = normalized_flat[flat_indices]
        raw_values = volume_flat[flat_indices]

        weights = np.maximum(normalized_values, np.finfo(np.float64).eps)
        weight_sum = float(np.sum(weights))
        local_mean = np.sum(local_points * weights[:, None], axis=0) / weight_sum
        mean = origin + local_mean
        centered = local_points - local_mean
        covariance = (centered.T * weights) @ centered / weight_sum + voxel_covariance
        covariance = (covariance + covariance.T) * 0.5
        eigenvalues, eigenvectors = _canonical_eigendecomposition(covariance)
        quaternion = _rotation_matrix_to_quaternion(eigenvectors)

        if scalar_scale > 0.0:
            scaled_raw_values = raw_values / scalar_scale
            scaled_scalar_value = float(
                np.sum(scaled_raw_values * weights) / weight_sum
            )
            scaled_scalar_value = max(
                float(np.min(scaled_raw_values)),
                min(float(np.max(scaled_raw_values)), scaled_scalar_value),
            )
            scalar_value = float(scaled_scalar_value * scalar_scale)
        else:
            scaled_raw_values = raw_values
            scaled_scalar_value = 0.0
            scalar_value = 0.0
        normalized_value = float(np.sum(normalized_values * weights) / weight_sum)
        opacity = parameters.opacity_min + normalized_value * (
            parameters.opacity_max - parameters.opacity_min
        )
        grayscale = max(0.0, min(1.0, normalized_value))
        sh_dc = (grayscale - 0.5) / _SH_DC_NORMALIZATION
        unique_labels = np.unique(labels_flat[flat_indices])
        if len(unique_labels) != 1:
            raise AssertionError(
                "internal error: Gaussian group crossed a segment boundary"
            )

        means.append(mean.tolist())
        scales.append(np.sqrt(eigenvalues).tolist())
        rotations.append(quaternion.tolist())
        opacities.append(float(max(0.0, min(1.0, opacity))))
        sh_coefficients.append([float(sh_dc), float(sh_dc), float(sh_dc)])
        segment_label = int(unique_labels[0])
        segment_ids.append(segment_label or None)
        scalar_values.append(scalar_value)
        group_sizes.append(len(flat_indices))
        squared_scaled_scalar_error += float(
            np.sum(np.square(scaled_raw_values - scaled_scalar_value))
        )
        squared_normalized_error += float(
            np.sum(np.square(normalized_values - normalized_value))
        )
        weighted_spatial_error += float(
            np.sum(weights * np.sum(np.square(centered), axis=1))
        )
        total_spatial_weight += weight_sum
        if group_index % progress_interval == 0:
            _progress(
                progress_callback,
                55.0 + 35.0 * group_index / max(1, len(groups)),
                "fitting_gaussians",
            )

    active_voxel_count = int(sum(group_sizes))
    scaled_scalar_rmse = math.sqrt(squared_scaled_scalar_error / active_voxel_count)
    maximum_float = float(np.finfo(np.float64).max)
    scalar_rmse_saturated = bool(
        scaled_scalar_rmse > 0.0 and scalar_scale > maximum_float / scaled_scalar_rmse
    )
    scalar_rmse = (
        maximum_float
        if scalar_rmse_saturated
        else float(scalar_scale * scaled_scalar_rmse)
    )
    approximation_metrics = {
        "metric_scope": "within_group_representative",
        "global_gaussian_reconstruction_evaluated": False,
        "active_voxel_count": active_voxel_count,
        "splat_count": len(groups),
        "compression_ratio": float(active_voxel_count / len(groups)),
        "scalar_rmse": scalar_rmse,
        "scalar_rmse_saturated": scalar_rmse_saturated,
        "normalized_scalar_rmse": float(
            math.sqrt(squared_normalized_error / active_voxel_count)
        ),
        "spatial_rmse_physical": float(
            math.sqrt(weighted_spatial_error / total_spatial_weight)
        ),
        "spatial_sse_physical": weighted_spatial_error,
        "largest_group_voxels": int(max(group_sizes)),
    }
    return {
        "means": means,
        "scales": scales,
        "rotations": rotations,
        "opacities": opacities,
        "sh_coefficients": sh_coefficients,
        "segment_ids": segment_ids,
        "scalar_values": scalar_values,
        "group_sizes": group_sizes,
    }, approximation_metrics


def _canonical_eigendecomposition(
    covariance: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(-eigenvalues, kind="stable")
    # An absolute machine-epsilon floor is dimensionally wrong for covariance:
    # it inflates every authored scale below sqrt(eps) to about 1.49e-8.
    # Analytic voxel covariance is positive definite, so only non-positive
    # round-off results need replacing with the smallest positive float64.
    eigenvalues = np.maximum(eigenvalues[order], np.nextafter(0.0, 1.0))
    eigenvectors = eigenvectors[:, order]

    for column in range(3):
        axis = eigenvectors[:, column]
        pivot = int(np.argmax(np.abs(axis)))
        if axis[pivot] < 0:
            eigenvectors[:, column] *= -1.0
    if np.linalg.det(eigenvectors) < 0:
        eigenvectors[:, -1] *= -1.0
    return eigenvalues, eigenvectors


def _rotation_matrix_to_quaternion(matrix: np.ndarray) -> np.ndarray:
    trace = float(np.trace(matrix))
    if trace > 0.0:
        scale = math.sqrt(trace + 1.0) * 2.0
        quaternion = np.array(
            [
                0.25 * scale,
                (matrix[2, 1] - matrix[1, 2]) / scale,
                (matrix[0, 2] - matrix[2, 0]) / scale,
                (matrix[1, 0] - matrix[0, 1]) / scale,
            ]
        )
    else:
        diagonal = np.diag(matrix)
        index = int(np.argmax(diagonal))
        if index == 0:
            scale = (
                math.sqrt(max(0.0, 1.0 + matrix[0, 0] - matrix[1, 1] - matrix[2, 2]))
                * 2.0
            )
            quaternion = np.array(
                [
                    (matrix[2, 1] - matrix[1, 2]) / scale,
                    0.25 * scale,
                    (matrix[0, 1] + matrix[1, 0]) / scale,
                    (matrix[0, 2] + matrix[2, 0]) / scale,
                ]
            )
        elif index == 1:
            scale = (
                math.sqrt(max(0.0, 1.0 + matrix[1, 1] - matrix[0, 0] - matrix[2, 2]))
                * 2.0
            )
            quaternion = np.array(
                [
                    (matrix[0, 2] - matrix[2, 0]) / scale,
                    (matrix[0, 1] + matrix[1, 0]) / scale,
                    0.25 * scale,
                    (matrix[1, 2] + matrix[2, 1]) / scale,
                ]
            )
        else:
            scale = (
                math.sqrt(max(0.0, 1.0 + matrix[2, 2] - matrix[0, 0] - matrix[1, 1]))
                * 2.0
            )
            quaternion = np.array(
                [
                    (matrix[1, 0] - matrix[0, 1]) / scale,
                    (matrix[0, 2] + matrix[2, 0]) / scale,
                    (matrix[1, 2] + matrix[2, 1]) / scale,
                    0.25 * scale,
                ]
            )
    norm = float(np.linalg.norm(quaternion))
    if norm <= np.finfo(np.float64).eps:
        return np.array([1.0, 0.0, 0.0, 0.0])
    quaternion /= norm
    for component in quaternion:
        if abs(float(component)) > 1e-15:
            if component < 0:
                quaternion *= -1.0
            break
    return quaternion


def _build_cache_key(
    *,
    volume_info: VolumeInfo,
    volume_stack_id: str,
    source_image_ids: Sequence[str] | None,
    parameters: VoxelGaussianFitParameters,
    volume: np.ndarray,
    labels: np.ndarray,
    geometry: Mapping[str, Any],
    sampling: Mapping[str, Any],
    source_segmentation_digest: str | None,
    sampled_source_flat_indices: np.ndarray | None,
) -> str:
    contract = {
        "version": 1,
        "method": "voxel_direct",
        "volume_stack_id": str(volume_stack_id),
        "source_image_ids": [str(item) for item in (source_image_ids or ())],
        "format": volume_info.format,
        "shape": list(volume.shape),
        "parameters": asdict(parameters),
        "geometry": dict(geometry),
        "sampling": dict(sampling),
        "source_segmentation_digest": source_segmentation_digest,
    }
    digest = hashlib.sha256(
        json.dumps(contract, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    digest.update(np.asarray(volume, dtype="<f8").tobytes(order="C"))
    digest.update(np.asarray(labels, dtype=np.uint8).tobytes(order="C"))
    if sampled_source_flat_indices is not None:
        digest.update(
            np.asarray(sampled_source_flat_indices, dtype="<i8").tobytes(order="C")
        )
    return f"pt3-voxel-direct-{digest.hexdigest()}"


def _progress(callback: ProgressCallback | None, percent: float, stage: str) -> None:
    if callback is not None:
        callback(float(percent), stage)
