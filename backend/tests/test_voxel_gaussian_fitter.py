import json
import math

import numpy as np
import pytest
from PIL import Image

import utils.voxel_gaussian_fitter as voxel_gaussian_fitter
from utils.real_gaussian_splat_optimizer import validate_canonical_real_splat_json
from utils.volume_loader import VolumeInfo, load_slice_stack
from utils.voxel_gaussian_fitter import (
    _CANDIDATE_EDGE_DTYPE,
    VoxelGaussianFitError,
    VoxelGaussianFitParameters,
    _bounded_candidate_edges,
    _bounded_file_sample_shape,
    fit_voxel_gaussian_splat_asset,
)


def _volume_info(shape):
    return VolumeInfo(
        format="numpy", shape=shape, source_files=("fixture.npy",), dtype="float32"
    )


def _payload(result):
    return json.loads(open(result["asset_path"], encoding="utf-8").read())


def test_real_fitter_rejects_explicit_color_volume(tmp_path):
    volume = VolumeInfo(
        format="numpy",
        shape=(2, 3, 4),
        source_files=("unused.npy",),
        dtype="uint8",
        channel_count=4,
        color_mode="rgba",
    )

    with pytest.raises(
        VoxelGaussianFitError, match="supports scalar volumes only.*RGBA"
    ):
        fit_voxel_gaussian_splat_asset(
            volume,
            volume_stack_id="color-volume",
            output_dir=tmp_path,
        )


def _covariance_from_scale_rotation(scales, quaternion):
    w, x, y, z = quaternion
    rotation = np.asarray(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )
    return rotation @ np.diag(np.square(scales)) @ rotation.T


def test_fits_physical_moments_anisotropic_scales_and_degree_zero_sh(tmp_path):
    volume = np.array([[[10.0, 10.0]]])
    progress = []
    result = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="physical",
        output_dir=tmp_path,
        voxel_data=volume,
        spacing=(2.0, 3.0, 6.0),
        origin=(10.0, 20.0, 30.0),
        parameters=VoxelGaussianFitParameters(max_splats=1, scalar_similarity=0.0),
        progress_callback=lambda percent, stage: progress.append((percent, stage)),
    )
    payload = _payload(result)

    assert result["splat_count"] == 1
    assert payload["means"][0] == pytest.approx([11.0, 20.0, 30.0])
    covariance = _covariance_from_scale_rotation(
        payload["scales"][0], payload["rotations"][0]
    )
    assert covariance == pytest.approx(np.diag([4.0 / 3.0, 3.0 / 4.0, 3.0]))
    quaternion = np.asarray(payload["rotations"][0])
    assert np.linalg.norm(quaternion) == pytest.approx(1.0)
    assert all(scale > 0 for scale in payload["scales"][0])
    assert len(payload["sh_coefficients"][0]) == 3
    assert payload["sh_degree"] == 0
    assert payload["scalar_values"] == pytest.approx([10.0])
    assert progress[0] == (0.0, "loading_voxels")
    assert progress[-1] == (100.0, "complete")
    assert [item[0] for item in progress] == sorted(item[0] for item in progress)
    assert len({round(item[0]) for item in progress}) >= 7
    assert (
        validate_canonical_real_splat_json(
            __import__("pathlib").Path(result["asset_path"]), requested_sh_degree=0
        )
        == 1
    )


def test_direction_rotates_physical_mean_and_covariance(tmp_path):
    volume = np.array([[[7.0, 7.0]]])
    direction = (0.0, -1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    result = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="direction",
        output_dir=tmp_path,
        voxel_data=volume,
        spacing=(2.0, 1.0, 1.0),
        origin=(3.0, 4.0, 5.0),
        direction=direction,
        parameters={"max_splats": 1, "scalar_similarity": 0.0},
    )
    payload = _payload(result)

    assert payload["means"][0] == pytest.approx([3.0, 5.0, 5.0])
    covariance = _covariance_from_scale_rotation(
        payload["scales"][0], payload["rotations"][0]
    )
    assert covariance == pytest.approx(np.diag([1.0 / 12.0, 4.0 / 3.0, 1.0 / 12.0]))


def test_output_is_byte_for_byte_deterministic(tmp_path):
    volume = np.array([[[1.0, 2.0], [3.0, 4.0]]])
    first = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="repeatable",
        output_dir=tmp_path / "one",
        voxel_data=volume,
        parameters={"max_splats": 2, "scalar_similarity": 0.0},
    )
    second = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="repeatable",
        output_dir=tmp_path / "two",
        voxel_data=volume.copy(),
        parameters={"max_splats": 2, "scalar_similarity": 0.0},
    )

    assert first["cache_key"] == second["cache_key"]
    assert (
        open(first["asset_path"], "rb").read()
        == open(second["asset_path"], "rb").read()
    )


def test_reference_fitter_rejects_unsafe_active_voxel_count_before_grouping(tmp_path):
    volume = np.ones((1, 1, 1_000_001), dtype=np.uint8)
    with pytest.raises(VoxelGaussianFitError, match="limited to 1000000 active voxels"):
        fit_voxel_gaussian_splat_asset(
            _volume_info(volume.shape),
            volume_stack_id="too-large-for-reference",
            output_dir=tmp_path,
            voxel_data=volume,
        )


def test_reported_large_npy_shape_has_a_bounded_sampling_plan():
    sampled_shape = _bounded_file_sample_shape((749, 1010, 984))

    assert sampled_shape == (75, 101, 99)
    assert math.prod(sampled_shape) == 749_925
    assert math.prod(sampled_shape) <= 1_000_000


def test_file_backed_numpy_fit_samples_before_float64_and_preserves_extent(
    tmp_path,
    monkeypatch,
):
    source_path = tmp_path / "large-for-test.npy"
    source = np.ones((4, 4, 4), dtype=np.uint16)
    np.save(source_path, source)
    info = VolumeInfo(
        format="numpy",
        shape=source.shape,
        source_files=(str(source_path),),
        dtype=str(source.dtype),
    )
    monkeypatch.setattr(voxel_gaussian_fitter, "MAX_REFERENCE_ACTIVE_VOXELS", 8)

    result = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="sample-before-float64",
        output_dir=tmp_path / "assets",
        spacing=(2.0, 3.0, 4.0),
        parameters={"max_splats": 1, "scalar_similarity": 1.0},
    )
    payload = _payload(result)

    assert payload["metadata"]["source_dimensions"] == [4, 4, 4]
    assert payload["metadata"]["fitted_dimensions"] == [2, 2, 2]
    sampling = dict(payload["metadata"]["sampling"])
    selected_index_digest = sampling.pop("selected_source_index_digest")
    assert len(selected_index_digest) == 64
    assert sampling == {
        "strategy": "conservative_block_reduction",
        "reducer": "nonzero_extrema",
        "applied": True,
        "source_dimensions": [4, 4, 4],
        "fitted_dimensions": [2, 2, 2],
        "source_voxel_count": 64,
        "fitted_voxel_count": 8,
        "maximum_fitted_voxels": 8,
        "source_index_scale_zyx": [3.0, 3.0, 3.0],
        "coordinate_mapping": "selected_source_voxel",
    }
    assert payload["metadata"]["source_physical_space"]["spacing"] == [2.0, 3.0, 4.0]
    assert payload["metadata"]["physical_space"]["spacing"] == [6.0, 9.0, 12.0]
    # Uniform block ties retain the endpoint grid, preserving the full source
    # extent while still deriving the mean from real source voxels.
    assert payload["means"][0] == pytest.approx([3.0, 4.5, 6.0])
    assert payload["group_sizes"] == [8]


def test_file_backed_sampling_preserves_selected_source_geometry_and_segment(
    tmp_path,
    monkeypatch,
):
    source_path = tmp_path / "sparse.npy"
    source = np.zeros((4, 4, 4), dtype=np.uint16)
    source[1, 1, 1] = 42
    source[0, 0, 0] = 1
    source[3, 3, 3] = 50
    labels = np.zeros_like(source, dtype=np.uint8)
    labels[1, 1, 1] = 3
    # A larger label in the same coarse block must not be detached from its
    # lower-density voxel and assigned to the selected value at [1, 1, 1].
    labels[0, 0, 0] = 9
    labels[3, 3, 3] = 9
    np.save(source_path, source)
    info = VolumeInfo(
        format="numpy",
        shape=source.shape,
        source_files=(str(source_path),),
        dtype=str(source.dtype),
    )
    monkeypatch.setattr(voxel_gaussian_fitter, "MAX_REFERENCE_ACTIVE_VOXELS", 8)

    result = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="off-grid-signal",
        output_dir=tmp_path / "assets",
        segmentation_labels=labels,
        spacing=(2.0, 3.0, 4.0),
        origin=(10.0, 20.0, 30.0),
        parameters={"max_splats": 2},
    )
    payload = _payload(result)

    assert result["splat_count"] == 2
    assert payload["scalar_values"] == [42.0, 50.0]
    assert payload["segment_ids"] == [3, 9]
    assert np.asarray(payload["means"]) == pytest.approx(
        np.asarray([[12.0, 23.0, 34.0], [16.0, 29.0, 42.0]])
    )
    # A singleton Gaussian retains source-voxel covariance.  Eigenvalues are
    # sorted descending, so scales correspond to z, y, x spacing here.
    assert np.asarray(payload["scales"]) == pytest.approx(
        np.asarray(
            [
                [4.0 / math.sqrt(12.0), 3.0 / math.sqrt(12.0), 2.0 / math.sqrt(12.0)],
                [4.0 / math.sqrt(12.0), 3.0 / math.sqrt(12.0), 2.0 / math.sqrt(12.0)],
            ]
        )
    )


def test_large_npz_is_rejected_before_unbounded_decode(tmp_path, monkeypatch):
    source_path = tmp_path / "large.npz"
    source = np.ones((4, 4, 4), dtype=np.uint8)
    np.savez_compressed(source_path, voxels=source)
    info = VolumeInfo(
        format="numpy",
        shape=source.shape,
        source_files=(str(source_path),),
        dtype=str(source.dtype),
    )
    monkeypatch.setattr(voxel_gaussian_fitter, "MAX_REFERENCE_ACTIVE_VOXELS", 8)

    with pytest.raises(VoxelGaussianFitError, match=r"compressed \.npz"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="bounded-npz",
            output_dir=tmp_path / "assets",
        )


def test_segmentation_is_a_hard_group_boundary(tmp_path):
    volume = np.array([[[8.0, 8.0]]])
    result = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="segments",
        output_dir=tmp_path,
        voxel_data=volume,
        segmentation_labels=np.array([[[1, 2]]]),
        parameters={"max_splats": 2, "scalar_similarity": 1.0},
    )
    payload = _payload(result)

    assert result["splat_count"] == 2
    assert payload["segment_ids"] == [1, 2]
    assert payload["group_sizes"] == [1, 1]
    with pytest.raises(VoxelGaussianFitError, match="segment-separated"):
        fit_voxel_gaussian_splat_asset(
            _volume_info(volume.shape),
            volume_stack_id="segments-impossible",
            output_dir=tmp_path,
            voxel_data=volume,
            segmentation_labels=np.array([[[1, 2]]]),
            parameters={"max_splats": 1, "scalar_similarity": 1.0},
        )


def test_adjacent_regions_merge_deterministically_to_respect_budget(tmp_path):
    volume = np.array([[[10.0, 30.0, 60.0, 100.0]]])
    result = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="budget",
        output_dir=tmp_path,
        voxel_data=volume,
        parameters={"max_splats": 2, "scalar_similarity": 0.0},
    )
    payload = _payload(result)

    assert result["splat_count"] == 2
    assert payload["group_sizes"] == [3, 1]
    assert sum(payload["group_sizes"]) == 4
    assert payload["approximation_metrics"]["splat_count"] <= 2


def test_candidate_merge_edges_use_a_bounded_numeric_buffer_in_legacy_order():
    active_mask = np.ones((1, 1, 4), dtype=bool)
    active_coordinates = np.argwhere(active_mask)
    active_lookup = np.arange(4, dtype=np.int32)
    normalized = np.array([0.0, 0.7, 0.8, 1.0], dtype=np.float64)
    labels = np.zeros(4, dtype=np.uint8)

    edges = _bounded_candidate_edges(
        active_coordinates=active_coordinates,
        active_mask=active_mask,
        active_lookup=active_lookup,
        normalized_flat=normalized,
        labels_flat=labels,
        shape=active_mask.shape,
        scalar_similarity=0.0,
    )

    assert _CANDIDATE_EDGE_DTYPE.itemsize == 16
    assert 1_000_000 * 3 * _CANDIDATE_EDGE_DTYPE.itemsize == 48_000_000
    assert [float(edge["delta"]) for edge in edges] == pytest.approx([0.1, 0.2, 0.7])
    assert [(int(edge["left"]), int(edge["right"])) for edge in edges] == [
        (1, 2),
        (2, 3),
        (0, 1),
    ]


def test_homogeneous_nonellipsoidal_region_refines_to_budget_and_reduces_spatial_error(
    tmp_path,
):
    volume = np.array([[[9.0, 9.0, 9.0], [9.0, 0.0, 0.0], [9.0, 0.0, 0.0]]])
    info = _volume_info(volume.shape)
    coarse = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="l-shape-coarse",
        output_dir=tmp_path / "coarse",
        voxel_data=volume,
        parameters={"max_splats": 1, "scalar_similarity": 0.0},
    )
    refined = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="l-shape-refined",
        output_dir=tmp_path / "refined",
        voxel_data=volume,
        parameters={"max_splats": 3, "scalar_similarity": 0.0},
    )
    capped = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="l-shape-capped",
        output_dir=tmp_path / "capped",
        voxel_data=volume,
        parameters={"max_splats": 100, "scalar_similarity": 0.0},
    )
    coarse_payload = _payload(coarse)
    refined_payload = _payload(refined)
    capped_payload = _payload(capped)

    assert coarse["splat_count"] == 1
    assert refined["splat_count"] == 3
    assert capped["splat_count"] == 5
    assert sum(refined_payload["group_sizes"]) == 5
    assert capped_payload["group_sizes"] == [1, 1, 1, 1, 1]
    assert (
        refined_payload["approximation_metrics"]["spatial_rmse_physical"]
        <= coarse_payload["approximation_metrics"]["spatial_rmse_physical"]
    )
    assert (
        capped_payload["approximation_metrics"]["spatial_rmse_physical"]
        <= refined_payload["approximation_metrics"]["spatial_rmse_physical"]
    )


@pytest.mark.parametrize(
    "labels, message",
    [
        (np.zeros((2, 1, 1)), "shape"),
        (np.array([[[1.5]]]), "integer IDs"),
        (np.array([[[256]]]), "integer IDs"),
        (np.array([[[True]]]), "integer IDs"),
    ],
)
def test_rejects_malformed_inline_segmentation(labels, message, tmp_path):
    with pytest.raises(VoxelGaussianFitError, match=message):
        fit_voxel_gaussian_splat_asset(
            _volume_info((1, 1, 1)),
            volume_stack_id="bad-labels",
            output_dir=tmp_path,
            voxel_data=np.ones((1, 1, 1)),
            segmentation_labels=labels,
        )


def test_loads_supported_image_stack_without_decoded_voxel_data(tmp_path):
    stack = tmp_path / "stack"
    stack.mkdir()
    Image.fromarray(np.array([[0, 9]], dtype=np.uint8)).save(stack / "001.png")
    Image.fromarray(np.array([[0, 9]], dtype=np.uint8)).save(stack / "002.png")
    info = load_slice_stack(stack)

    result = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="images",
        output_dir=tmp_path / "assets",
        parameters={"max_splats": 1, "scalar_similarity": 0.0},
    )
    payload = _payload(result)

    assert result["splat_count"] == 1
    assert payload["group_sizes"] == [2]
    assert payload["means"][0] == pytest.approx([1.0, 0.0, 0.5])


def test_rejects_empty_or_nonfinite_sources_and_invalid_physical_geometry(tmp_path):
    info = _volume_info((1, 1, 1))
    with pytest.raises(VoxelGaussianFitError, match="No voxels"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="empty",
            output_dir=tmp_path,
            voxel_data=np.zeros((1, 1, 1)),
        )
    with pytest.raises(VoxelGaussianFitError, match="finite"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="nan",
            output_dir=tmp_path,
            voxel_data=np.array([[[math.nan]]]),
        )
    with pytest.raises(VoxelGaussianFitError, match="positive"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="spacing",
            output_dir=tmp_path,
            voxel_data=np.ones((1, 1, 1)),
            spacing=(1.0, 0.0, 1.0),
        )
    with pytest.raises(VoxelGaussianFitError, match="orthonormal"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="direction",
            output_dir=tmp_path,
            voxel_data=np.ones((1, 1, 1)),
            direction=(2.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        )


@pytest.mark.parametrize(
    "spacing, origin",
    [
        ((1e308, 1.0, 1.0), (0.0, 0.0, 0.0)),
        ((1.0, 1.0, 1.0), (1e308, 0.0, 0.0)),
    ],
)
def test_rejects_finite_but_numerically_unsafe_physical_geometry(
    tmp_path, spacing, origin
):
    with pytest.raises(VoxelGaussianFitError, match="stable float64 limits"):
        fit_voxel_gaussian_splat_asset(
            _volume_info((1, 1, 2)),
            volume_stack_id="unsafe-physical-geometry",
            output_dir=tmp_path,
            voxel_data=np.ones((1, 1, 2)),
            spacing=spacing,
            origin=origin,
            parameters={"max_splats": 1},
        )


def test_preserves_small_physical_scales_without_machine_epsilon_inflation(tmp_path):
    result = fit_voxel_gaussian_splat_asset(
        _volume_info((1, 1, 2)),
        volume_stack_id="small-physical-scale",
        output_dir=tmp_path,
        voxel_data=np.ones((1, 1, 2)),
        spacing=(1e-9, 1.0, 1.0),
        parameters={"max_splats": 1},
    )
    payload = _payload(result)
    covariance = _covariance_from_scale_rotation(
        payload["scales"][0], payload["rotations"][0]
    )

    assert covariance[0, 0] == pytest.approx(1e-18 / 3.0)
    assert min(payload["scales"][0]) < 1e-9


def test_rejects_origin_that_cannot_represent_a_voxel_step(tmp_path):
    with pytest.raises(VoxelGaussianFitError, match="loses voxel-step precision"):
        fit_voxel_gaussian_splat_asset(
            _volume_info((1, 1, 2)),
            volume_stack_id="unrepresentable-step",
            output_dir=tmp_path,
            voxel_data=np.ones((1, 1, 2)),
            spacing=(1.0, 1.0, 1.0),
            origin=(1e16, 0.0, 0.0),
            parameters={"max_splats": 1},
        )


def test_large_representable_origin_retains_local_covariance(tmp_path):
    result = fit_voxel_gaussian_splat_asset(
        _volume_info((1, 1, 2)),
        volume_stack_id="representable-step",
        output_dir=tmp_path,
        voxel_data=np.ones((1, 1, 2)),
        spacing=(1.0, 1.0, 1.0),
        origin=(1e15, 0.0, 0.0),
        parameters={"max_splats": 1},
    )
    payload = _payload(result)
    covariance = _covariance_from_scale_rotation(
        payload["scales"][0], payload["rotations"][0]
    )

    assert covariance[0, 0] == pytest.approx(1.0 / 3.0)


@pytest.mark.parametrize(
    "volume",
    [
        np.array([[[-1e308, 1e308]]], dtype=np.float64),
        np.array([[[1e308, 1e308]]], dtype=np.float64),
        np.array([[[-np.finfo(np.float64).max, np.finfo(np.float64).max]]]),
    ],
)
def test_finite_extreme_scalars_use_overflow_safe_normalization_and_metrics(
    tmp_path, volume
):
    result = fit_voxel_gaussian_splat_asset(
        _volume_info(volume.shape),
        volume_stack_id="finite-extremes",
        output_dir=tmp_path,
        voxel_data=volume,
        parameters={"max_splats": 1, "scalar_similarity": 1.0},
    )
    payload = _payload(result)

    assert result["splat_count"] == 1
    assert all(math.isfinite(value) for value in payload["scalar_values"])
    assert math.isfinite(payload["approximation_metrics"]["scalar_rmse"])
    assert isinstance(payload["approximation_metrics"]["scalar_rmse_saturated"], bool)
