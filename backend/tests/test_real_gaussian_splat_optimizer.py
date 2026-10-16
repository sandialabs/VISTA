import json
from pathlib import Path

import numpy as np
import pytest

from schemas.inspection_pt3 import PT3RealSplatOptimizationRequest
from utils.real_gaussian_splat_optimizer import (
    RealGaussianSplatOptimizationError,
    optimize_real_gaussian_splat_asset,
)


def test_voxel_direct_request_is_camera_free_and_degree_zero():
    request = PT3RealSplatOptimizationRequest(parameters={"max_splats": 32})

    assert request.fit_mode == "voxel_direct"
    assert request.cameras == []
    assert request.parameters.sh_degree == 0
    assert request.parameters.optimize_camera_poses is False

    with pytest.raises(ValueError, match="degree-0"):
        PT3RealSplatOptimizationRequest(
            fit_mode="voxel_direct", parameters={"sh_degree": 1}
        )

    with pytest.raises(ValueError, match="requires at least two"):
        PT3RealSplatOptimizationRequest(fit_mode="synthetic_views", cameras=[])


@pytest.mark.parametrize(
    ("parameters", "message"),
    [
        ({"max_splats": True}, "integer"),
        ({"density_threshold": True}, "number"),
        ({"optimize_covariance": 1}, "boolean true"),
        ({"max_splats": 100_001}, "less than or equal"),
    ],
)
def test_real_request_rejects_coerced_or_unsafe_parameters(parameters, message):
    with pytest.raises(ValueError, match=message):
        PT3RealSplatOptimizationRequest(parameters=parameters)


def test_camera_dimensions_reject_json_booleans():
    camera = _camera("a")
    camera["width"] = True
    with pytest.raises(ValueError, match="integer"):
        PT3RealSplatOptimizationRequest(
            fit_mode="synthetic_views",
            cameras=[camera, _camera("b")],
        )


def _provider_request(request):
    _PROVIDER_SEGMENTATIONS.append(request["segmentation"])
    _PROVIDER_SEGMENTATION_CONTRACTS.append(request["segmentation_output_contract"])
    if callable(request.get("progress_callback")):
        request["progress_callback"](42, "densifying")
    asset_path = Path(request["output_dir"]) / "optimized.json"
    sh_degree = int(request["parameters"].get("sh_degree", 3))
    labels = request["segmentation"].get("label_volume")
    source_segment_ids = (
        [int(value) for value in np.unique(labels) if int(value) != 0]
        if labels is not None
        else []
    )
    segment_ids = source_segment_ids or [None]
    splat_count = len(segment_ids)
    asset_path.write_text(
        json.dumps(
            {
                "contract_version": "pt3_real_3dgs/v1",
                "representation": "real_3dgs",
                "coordinate_space": request["coordinate_space"],
                "camera_model": request["camera_model"],
                "camera_convention": request["camera_convention"],
                "sh_degree": sh_degree,
                "means": [[float(index), 0.0, 0.0] for index in range(splat_count)],
                "scales": [[0.1, 0.2, 0.3] for _ in range(splat_count)],
                "rotations": [[1.0, 0.0, 0.0, 0.0] for _ in range(splat_count)],
                "opacities": [0.8] * splat_count,
                "sh_coefficients": [
                    [0.0] * (3 * (sh_degree + 1) ** 2) for _ in range(splat_count)
                ],
                "segment_ids": segment_ids,
                "optimized_cameras": request["cameras"],
            }
        ),
        encoding="utf-8",
    )
    metadata = {
        "optimized_parameters": [
            "means",
            "covariance",
            "rotation",
            "opacity",
            "spherical_harmonics",
            "camera_poses",
        ],
    }
    if source_segment_ids:
        metadata["segment_assignment_policy"] = "hard_source_label"
    return {
        "asset_path": str(asset_path),
        "splat_count": splat_count,
        "metadata": metadata,
    }


def _incomplete_provider(request):
    result = _provider_request(request)
    result["metadata"]["optimized_parameters"] = ["means", "opacity"]
    return result


def _invalid_asset_provider(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload["rotations"] = [[0.0, 0.0, 0.0, 0.0]]
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_with_invalid_optimized_camera(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload["optimized_cameras"][0]["intrinsics"][0] = -1
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_without_coordinate_space(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload.pop("coordinate_space")
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_with_unsupported_camera_model(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload["camera_model"] = "fisheye"
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_without_camera_convention(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload.pop("camera_convention")
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_without_segment_representation(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload["segment_ids"] = [1, None]
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_with_short_segment_ids(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload["segment_ids"] = [1]
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_with_unknown_segment_id(request):
    result = _provider_request(request)
    payload = json.loads(Path(result["asset_path"]).read_text(encoding="utf-8"))
    payload["segment_ids"] = [1, 3]
    Path(result["asset_path"]).write_text(json.dumps(payload), encoding="utf-8")
    return result


def _provider_without_segment_policy(request):
    result = _provider_request(request)
    result["metadata"].pop("segment_assignment_policy", None)
    return result


def _camera(image_id):
    return {
        "image_id": image_id,
        "width": 16,
        "height": 16,
        "intrinsics": [1, 0, 8, 0, 1, 8, 0, 0, 1],
        "rotation_quaternion": [1, 0, 0, 0],
        "translation": [0, 0, 0],
    }


def _volume_geometry():
    return {
        "format": "slice_stack",
        "shape_zyx": [2, 1, 1],
        "spacing_xyz": [1.0, 1.0, 1.0],
        "origin_xyz": [0.0, 0.0, 0.0],
        "direction": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
    }


@pytest.mark.parametrize(("channel_count", "color_mode"), [(3, "rgb"), (4, "rgba")])
def test_voxel_direct_optimizer_preserves_color_layout_and_rejects_non_scalar_volume(
    tmp_path, channel_count, color_mode
):
    geometry = {
        **_volume_geometry(),
        "channel_count": channel_count,
        "color_mode": color_mode,
    }

    with pytest.raises(
        ValueError, match=rf"supports scalar volumes only.*{color_mode.upper()}"
    ):
        optimize_real_gaussian_splat_asset(
            provider_path="",
            volume_stack_id=f"{color_mode}-stack",
            source_image_ids=["slice-0", "slice-1"],
            source_files=["slice-0.png", "slice-1.png"],
            cameras=[],
            parameters={"max_splats": 2},
            output_dir=tmp_path,
            fit_mode="voxel_direct",
            volume_geometry=geometry,
        )


_PROVIDER_SEGMENTATIONS = []
_PROVIDER_SEGMENTATION_CONTRACTS = []


def test_real_optimizer_invokes_trusted_provider_and_validates_canonical_parameters(
    tmp_path,
):
    progress = []
    _PROVIDER_SEGMENTATIONS.clear()
    _PROVIDER_SEGMENTATION_CONTRACTS.clear()
    asset = optimize_real_gaussian_splat_asset(
        provider_path=f"{__name__}._provider_request",
        volume_stack_id="stack-a",
        source_image_ids=["a", "b"],
        source_files=["a.png", "b.png"],
        cameras=[_camera("a"), _camera("b")],
        parameters={"optimize_camera_poses": True, "sh_degree": 3},
        output_dir=tmp_path,
        volume_geometry=_volume_geometry(),
        segmentation={
            "label_slices": [
                {"slice_index": 1, "labels": [2]},
                {"slice_index": 0, "labels": [[1]]},
            ],
            "segments": [{"id": 1, "name": "matrix"}, {"id": 2, "name": "void"}],
        },
        progress_callback=lambda percent, stage: progress.append((percent, stage)),
    )

    assert asset.splat_count == 2
    assert asset.cache_key.startswith("pt3-real-3dgs-")
    assert asset.metadata["representation"] == "real_3dgs"
    assert asset.metadata["coordinate_space"] == "physical"
    assert asset.metadata["camera_model"] == "pinhole"
    assert asset.metadata["camera_convention"] == "pt3_patient_physical_w2c_wxyz/v1"
    assert asset.metadata["segment_assignment_policy"] == "hard_source_label"
    assert progress == [(42, "densifying")]
    assert _PROVIDER_SEGMENTATIONS[0]["segments"][0]["name"] == "matrix"
    assert np.array_equal(
        _PROVIDER_SEGMENTATIONS[0]["label_volume"],
        np.array([[[1]], [[2]]], dtype=np.uint8),
    )
    assert _PROVIDER_SEGMENTATION_CONTRACTS[0] == {
        "required_segment_ids": [1, 2],
        "background_segment_id": None,
        "supported_assignment_policies": [
            "hard_source_label",
            "max_weight_source_label",
        ],
    }


def test_provider_mode_rejects_url_only_segmentation_before_invocation(tmp_path):
    _PROVIDER_SEGMENTATIONS.clear()
    with pytest.raises(RealGaussianSplatOptimizationError, match="URL-only labels"):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}._provider_request",
            volume_stack_id="stack-a",
            source_image_ids=["a", "b"],
            source_files=["a.png", "b.png"],
            cameras=[_camera("a"), _camera("b")],
            parameters={"optimize_camera_poses": True, "sh_degree": 3},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
            segmentation={"labels_url": "https://untrusted.example/labels.json"},
        )
    assert _PROVIDER_SEGMENTATIONS == []


def test_real_optimizer_rejects_missing_camera_views(tmp_path):
    with pytest.raises(
        RealGaussianSplatOptimizationError, match="at least two calibrated"
    ):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}._provider_request",
            volume_stack_id="stack-a",
            source_image_ids=["a"],
            source_files=["a.png"],
            cameras=[_camera("a")],
            parameters={"optimize_camera_poses": True},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
        )


def test_real_optimizer_rejects_provider_that_does_not_optimize_real_3dgs_fields(
    tmp_path,
):
    with pytest.raises(RealGaussianSplatOptimizationError, match="covariance"):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}._incomplete_provider",
            volume_stack_id="stack-a",
            source_image_ids=["a", "b"],
            source_files=["a.png", "b.png"],
            cameras=[_camera("a"), _camera("b")],
            parameters={"optimize_camera_poses": True},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
        )


def test_real_optimizer_rejects_structurally_invalid_canonical_json(tmp_path):
    with pytest.raises(
        RealGaussianSplatOptimizationError, match="normalized nonzero quaternion"
    ):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}._invalid_asset_provider",
            volume_stack_id="stack-a",
            source_image_ids=["a", "b"],
            source_files=["a.png", "b.png"],
            cameras=[_camera("a"), _camera("b")],
            parameters={"optimize_camera_poses": True, "sh_degree": 3},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
        )


def test_real_optimizer_rejects_invalid_optimized_camera_under_fixed_pinhole_contract(
    tmp_path,
):
    with pytest.raises(
        RealGaussianSplatOptimizationError, match="focal lengths must be positive"
    ):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}._provider_with_invalid_optimized_camera",
            volume_stack_id="stack-a",
            source_image_ids=["a", "b"],
            source_files=["a.png", "b.png"],
            cameras=[_camera("a"), _camera("b")],
            parameters={"optimize_camera_poses": True, "sh_degree": 3},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
        )


@pytest.mark.parametrize(
    ("provider_name", "message"),
    [
        ("_provider_without_coordinate_space", "coordinate_space must be physical"),
        ("_provider_with_unsupported_camera_model", "camera_model must be pinhole"),
        ("_provider_without_camera_convention", "camera_convention must be"),
    ],
)
def test_real_optimizer_rejects_provider_without_patient_physical_camera_contract(
    tmp_path, provider_name, message
):
    with pytest.raises(RealGaussianSplatOptimizationError, match=message):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}.{provider_name}",
            volume_stack_id="stack-a",
            source_image_ids=["a", "b"],
            source_files=["a.png", "b.png"],
            cameras=[_camera("a"), _camera("b")],
            parameters={"optimize_camera_poses": True, "sh_degree": 3},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
        )


@pytest.mark.parametrize(
    ("provider_name", "message"),
    [
        (
            "_provider_without_segment_representation",
            "does not represent source segment labels: 2",
        ),
        ("_provider_with_short_segment_ids", "segment_ids must match the splat count"),
        (
            "_provider_with_unknown_segment_id",
            "labels absent from the source segmentation: 3",
        ),
        ("_provider_without_segment_policy", "segment_assignment_policy"),
    ],
)
def test_segmented_provider_must_keep_every_source_label_addressable(
    tmp_path, provider_name, message
):
    with pytest.raises(RealGaussianSplatOptimizationError, match=message):
        optimize_real_gaussian_splat_asset(
            provider_path=f"{__name__}.{provider_name}",
            volume_stack_id="stack-a",
            source_image_ids=["a", "b"],
            source_files=["a.png", "b.png"],
            cameras=[_camera("a"), _camera("b")],
            parameters={"optimize_camera_poses": True, "sh_degree": 3},
            output_dir=tmp_path,
            volume_geometry=_volume_geometry(),
            segmentation={"labels": [[[1]], [[2]]]},
        )
