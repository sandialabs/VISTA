"""Adversarial coverage for voxel-native Real 3DGS and shared segmentation.

These tests intentionally describe boundary behavior required by the public
contracts.  A failing test is a confirmed integration gap for the blue team,
not a test that should be weakened to match the current implementation.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from core.config import settings
from services.errors import ServiceError
from services.inspection import pt3_volume_stack
from utils.real_gaussian_splat_optimizer import (
    RealGaussianSplatOptimizationError,
    optimize_real_gaussian_splat_asset,
    validate_canonical_real_splat_json,
)
from utils.volume_loader import VolumeInfo
from utils.voxel_gaussian_fitter import (
    VoxelGaussianFitError,
    fit_voxel_gaussian_splat_asset,
)


def _write_stack(root: Path, values: list[np.ndarray]) -> tuple[str, ...]:
    root.mkdir(parents=True)
    paths = []
    for index, values_2d in enumerate(values):
        path = root / f"z{index:03d}.png"
        Image.fromarray(np.asarray(values_2d, dtype=np.uint8)).save(path)
        paths.append(str(path))
    return tuple(paths)


def _direct_geometry(shape: tuple[int, int, int]) -> dict:
    return {
        "format": "slice_stack",
        "shape_zyx": list(shape),
        "dtype": "uint8",
        "spacing_xyz": [1.0, 1.0, 1.0],
        "origin_xyz": [0.0, 0.0, 0.0],
        "direction": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
    }


def _load_asset(asset) -> dict:
    path = Path(asset.path if hasattr(asset, "path") else asset["asset_path"])
    return json.loads(path.read_text(encoding="utf-8"))


def test_object_store_materialization_streams_and_removes_partial_file_at_cap(
    monkeypatch, tmp_path
):
    yielded_chunks = []

    class Response:
        headers = {}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size):
            assert chunk_size == pt3_volume_stack.PT3_DOWNLOAD_CHUNK_BYTES
            for chunk in (b"abc", b"def", b"unreached"):
                yielded_chunks.append(chunk)
                yield chunk

        async def aread(self):
            raise AssertionError("bounded materialization must not call aread()")

    class StreamContext:
        async def __aenter__(self):
            return Response()

        async def __aexit__(self, exc_type, exc, traceback):
            return False

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        def stream(self, method, url):
            assert (method, url) == ("GET", "https://object.test/volume.npy")
            return StreamContext()

    monkeypatch.setattr(pt3_volume_stack.httpx, "AsyncClient", Client)
    monkeypatch.setattr(
        pt3_volume_stack,
        "get_presigned_download_url",
        lambda **_kwargs: "https://object.test/volume.npy",
    )
    image = SimpleNamespace(
        filename="volume.npy",
        metadata_json={},
        object_storage_key="project/volume.npy",
        project_id="project",
    )
    destination = tmp_path / "volume.npy"

    with pytest.raises(ServiceError) as raised:
        asyncio.run(
            pt3_volume_stack.write_image_record_to_stack_dir(
                image,
                destination,
                max_bytes=5,
            )
        )

    assert raised.value.status_code == 413
    assert yielded_chunks == [b"abc", b"def"]
    assert not destination.exists()
    assert not (tmp_path / ".volume.npy.part").exists()


def test_direct_fit_accepts_flat_label_slices_used_by_ray_marcher(tmp_path):
    """One segmentation contract must work in Real 3DGS and ray marching."""
    source_files = _write_stack(tmp_path / "stack", [np.array([[90, 90], [0, 0]])])

    asset = optimize_real_gaussian_splat_asset(
        provider_path="",
        fit_mode="voxel_direct",
        volume_stack_id="flat-labels",
        source_image_ids=["slice-0"],
        source_files=source_files,
        cameras=[],
        parameters={"max_splats": 2, "sh_degree": 0, "optimize_camera_poses": False},
        volume_geometry=_direct_geometry((1, 2, 2)),
        segmentation={
            "segments": [{"id": 1}, {"id": 2}],
            # The WebGL segmentation loader's documented/implemented shape is
            # one flattened width*height label array per slice.
            "label_slices": [{"slice_index": 0, "labels": [1, 2, 0, 0]}],
        },
        output_dir=tmp_path / "assets",
    )

    assert _load_asset(asset)["segment_ids"] == [1, 2]


def test_direct_fit_honors_label_slice_indices_instead_of_list_order(tmp_path):
    source_files = _write_stack(
        tmp_path / "stack",
        [np.array([[100]]), np.array([[100]])],
    )

    asset = optimize_real_gaussian_splat_asset(
        provider_path="",
        fit_mode="voxel_direct",
        volume_stack_id="ordered-labels",
        source_image_ids=["slice-0", "slice-1"],
        source_files=source_files,
        cameras=[],
        parameters={"max_splats": 2, "sh_degree": 0, "optimize_camera_poses": False},
        volume_geometry=_direct_geometry((2, 1, 1)),
        segmentation={
            "segments": [{"id": 1}, {"id": 2}],
            "label_slices": [
                {"slice_index": 1, "labels": [[2]]},
                {"slice_index": 0, "labels": [[1]]},
            ],
        },
        output_dir=tmp_path / "assets",
    )

    payload = _load_asset(asset)
    assert payload["segment_ids"] == [1, 2]
    assert np.asarray(payload["means"]) == pytest.approx(
        np.asarray([[0.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    )


def test_content_cache_key_survives_job_specific_materialization_paths(tmp_path):
    """Recomputing identical voxels must not miss cache due to a new job UUID."""
    first_files = _write_stack(tmp_path / "job-a", [np.array([[0, 77]])])
    second_files = _write_stack(tmp_path / "job-b", [np.array([[0, 77]])])
    parameters = {"max_splats": 1, "scalar_similarity": 0.0}

    first = fit_voxel_gaussian_splat_asset(
        VolumeInfo(
            format="slice_stack",
            shape=(1, 1, 2),
            source_files=first_files,
            dtype="uint8",
        ),
        volume_stack_id="same-stack",
        source_image_ids=["same-image"],
        output_dir=tmp_path / "assets-a",
        parameters=parameters,
    )
    second = fit_voxel_gaussian_splat_asset(
        VolumeInfo(
            format="slice_stack",
            shape=(1, 1, 2),
            source_files=second_files,
            dtype="uint8",
        ),
        volume_stack_id="same-stack",
        source_image_ids=["same-image"],
        output_dir=tmp_path / "assets-b",
        parameters=parameters,
    )

    assert first["cache_key"] == second["cache_key"]


@pytest.mark.parametrize("field", ["means", "sh_coefficients", "scalar_values"])
def test_canonical_validator_rejects_json_booleans_as_numeric_fields(tmp_path, field):
    payload = {
        "contract_version": "pt3_real_3dgs/v1",
        "representation": "real_3dgs",
        "optimization_domain": "voxel_field",
        "optimization_method": "voxel_direct",
        "camera_model": "none",
        "sh_degree": 0,
        "means": [[0.0, 0.0, 0.0]],
        "scales": [[1.0, 1.0, 1.0]],
        "rotations": [[1.0, 0.0, 0.0, 0.0]],
        "opacities": [0.5],
        "sh_coefficients": [[0.0, 0.0, 0.0]],
        "segment_ids": [None],
        "scalar_values": [1.0],
    }
    if field in {"means", "sh_coefficients"}:
        payload[field][0][0] = True
    else:
        payload[field][0] = True
    asset_path = tmp_path / f"boolean-{field}.json"
    asset_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(RealGaussianSplatOptimizationError, match="number|numeric"):
        validate_canonical_real_splat_json(
            asset_path,
            requested_sh_degree=0,
            expected_optimization_domain="voxel_field",
        )


def test_negative_signal_is_fitted_but_an_all_zero_volume_fails_honestly(tmp_path):
    info = VolumeInfo(
        format="numpy", shape=(1, 1, 2), source_files=("unused.npy",), dtype="float32"
    )
    fitted = fit_voxel_gaussian_splat_asset(
        info,
        volume_stack_id="negative",
        output_dir=tmp_path / "negative",
        voxel_data=np.array([[[-4.0, 0.0]]]),
        parameters={"max_splats": 1},
    )
    assert _load_asset(fitted)["scalar_values"] == [-4.0]

    with pytest.raises(VoxelGaussianFitError, match="No voxels"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="zero",
            output_dir=tmp_path / "zero",
            voxel_data=np.zeros((1, 1, 2)),
        )


def test_budget_never_bridges_disconnected_signal_through_empty_space(tmp_path):
    info = VolumeInfo(
        format="numpy", shape=(1, 1, 3), source_files=("unused.npy",), dtype="float32"
    )
    with pytest.raises(VoxelGaussianFitError, match="disconnected"):
        fit_voxel_gaussian_splat_asset(
            info,
            volume_stack_id="disconnected",
            output_dir=tmp_path,
            voxel_data=np.array([[[8.0, 0.0, 8.0]]]),
            parameters={"max_splats": 1, "scalar_similarity": 1.0},
        )


def test_simplified_splat_generation_preserves_part_segmentation(
    client, monkeypatch, tmp_path
):
    """The shared segmentation promise includes the simplified 3DGS path."""
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "cache"))
    headers = {
        "X-User-Id": "pt3-red-segments@example.com",
        "X-User-Groups": '["pt3-red-segments-group"]',
    }
    project = client.post(
        "/api/projects",
        headers=headers,
        json={
            "name": "PT3 segmented simplified splat",
            "description": "",
            "meta_group_id": "pt3-red-segments-group",
            "project_type": "PT3",
        },
    ).json()
    image = Image.fromarray(np.array([[180, 180]], dtype=np.uint8))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()
    upload = client.post(
        f"/api/projects/{project['id']}/images",
        headers=headers,
        files={"file": ("seg-z000.png", io.BytesIO(image_bytes), "image/png")},
        data={
            "metadata": json.dumps(
                {
                    "volume_stack_id": "seg-stack",
                    "slice_index": 0,
                    "analysis_inline_image_base64": base64.b64encode(
                        image_bytes
                    ).decode("ascii"),
                }
            )
        },
    )
    assert upload.status_code == 201, upload.text
    image_record = upload.json()
    part = client.post(
        f"/api/projects/{project['id']}/parts",
        headers=headers,
        json={
            "serial_number": "SEG-SIMPLIFIED-001",
            "metadata": {
                "volume_stack_id": "seg-stack",
                "source_images": [
                    {
                        "filename": "seg-z000.png",
                        "image_id": image_record["id"],
                        "slice_index": 0,
                    }
                ],
                "pt3_segmentation": {
                    "segments": [
                        {"id": 1, "label": "Left"},
                        {"id": 2, "label": "Right"},
                    ],
                    "labels": [[[1, 2]]],
                },
            },
        },
    ).json()

    queued = client.post(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets",
        headers=headers,
        json={"transfer_function": {"threshold": 1}, "output_format": "splat"},
    )
    assert queued.status_code == 200, queued.text
    status = client.get(
        f"/api/projects/{project['id']}/parts/{part['id']}/volume-splat-assets/status",
        headers=headers,
    ).json()
    assert status["status"] == "ready", status
    payload = client.get(status["asset_url"], headers=headers).json()

    assert [splat["segment_id"] for splat in payload["splats"]] == [1, 2]
