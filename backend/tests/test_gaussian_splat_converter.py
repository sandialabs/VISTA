import json
from pathlib import Path

import pytest
from PIL import Image

from utils.gaussian_splat_converter import (
    SplatConversionParams,
    TransferFunction,
    _collect_splats_to_budget,
    build_splat_cache_key,
    convert_volume_to_splat_asset,
)
from utils.volume_loader import VolumeInfo, load_volume


def test_simplified_converter_rejects_explicit_color_volume(tmp_path):
    volume = VolumeInfo(
        format="numpy",
        shape=(2, 3, 4),
        source_files=("unused.npy",),
        dtype="uint8",
        channel_count=3,
        color_mode="rgb",
    )

    with pytest.raises(ValueError, match="supports scalar volumes only.*RGB"):
        convert_volume_to_splat_asset(
            volume,
            volume_stack_id="color-volume",
            output_dir=tmp_path / "assets",
        )


def test_converts_slice_stack_pixels_to_ply_splats(tmp_path):
    stack_dir = tmp_path / "stack"
    stack_dir.mkdir()
    Image.new("L", (3, 2), color=0).save(stack_dir / "z000.png")
    image = Image.new("L", (3, 2), color=0)
    image.putpixel((1, 0), 200)
    image.putpixel((2, 1), 255)
    image.save(stack_dir / "z001.png")
    volume = load_volume(stack_dir)
    params = SplatConversionParams(
        transfer_function=TransferFunction(threshold=180), output_format="ply"
    )

    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id="stack-a",
        source_image_ids=["img-2", "img-1"],
        params=params,
        output_dir=tmp_path / "assets",
    )

    assert asset.splat_count == 2
    assert (
        Path(asset.path).read_text(encoding="utf-8").splitlines()[2]
        == "element vertex 2"
    )
    assert asset.cache_key == build_splat_cache_key(
        volume,
        volume_stack_id="stack-a",
        source_image_ids=["img-1", "img-2"],
        params=params,
    )


def test_converts_decoded_voxel_data_to_splat_json(tmp_path):
    volume = load_volume(_stack(tmp_path))
    params = SplatConversionParams(
        transfer_function=TransferFunction(threshold=10, intensity_max=20),
        output_format="splat",
        max_splats=1,
    )

    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id="decoded-stack",
        voxel_data=[[[0, 12], [15, 20]]],
        params=params,
        output_dir=tmp_path / "assets",
    )

    payload = json.loads(Path(asset.path).read_text(encoding="utf-8"))
    assert asset.splat_count == 1
    assert len(payload["splats"]) == 1
    assert payload["metadata"]["conversion_parameters"]["max_splats"] == 1


def test_cache_key_is_stable_across_job_roots_and_tracks_source_content(tmp_path):
    first_stack = tmp_path / "job-a"
    second_stack = tmp_path / "job-b"
    first_stack.mkdir()
    second_stack.mkdir()
    Image.new("L", (2, 2), color=40).save(first_stack / "0000-slice.png")
    Image.new("L", (2, 2), color=40).save(second_stack / "0000-slice.png")
    params = SplatConversionParams(output_format="splat")

    first_key = build_splat_cache_key(
        load_volume(first_stack),
        volume_stack_id="stable-stack",
        source_image_ids=["source-image"],
        params=params,
    )
    second_key = build_splat_cache_key(
        load_volume(second_stack),
        volume_stack_id="stable-stack",
        source_image_ids=["source-image"],
        params=params,
    )
    assert first_key == second_key

    Image.new("L", (2, 2), color=41).save(second_stack / "0000-slice.png")
    changed_key = build_splat_cache_key(
        load_volume(second_stack),
        volume_stack_id="stable-stack",
        source_image_ids=["source-image"],
        params=params,
    )
    assert changed_key != first_key


def test_cache_key_tracks_caller_supplied_voxel_data(tmp_path):
    volume = load_volume(_stack(tmp_path))
    params = SplatConversionParams(output_format="splat")

    first_key = build_splat_cache_key(
        volume,
        volume_stack_id="decoded-content",
        params=params,
        voxel_data=[[[1, 2], [3, 4]]],
    )
    second_key = build_splat_cache_key(
        volume,
        volume_stack_id="decoded-content",
        params=params,
        voxel_data=[[[1, 2], [3, 5]]],
    )

    assert first_key != second_key


def test_converter_atomically_replaces_malformed_cached_asset(tmp_path):
    volume = load_volume(_stack(tmp_path))
    params = SplatConversionParams(
        transfer_function=TransferFunction(threshold=1),
        output_format="splat",
    )
    output_dir = tmp_path / "assets"
    output_dir.mkdir()
    cache_key = build_splat_cache_key(
        volume,
        volume_stack_id="interrupted-cache",
        params=params,
    )
    asset_path = output_dir / f"{cache_key}.json"
    asset_path.write_text("{interrupted", encoding="utf-8")

    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id="interrupted-cache",
        params=params,
        output_dir=output_dir,
    )

    assert Path(asset.path) == asset_path
    assert (
        json.loads(asset_path.read_text(encoding="utf-8"))["metadata"]["cache_key"]
        == cache_key
    )
    assert list(output_dir.glob(f".{asset_path.name}.*.tmp")) == []


def test_segmentation_is_preserved_in_json_and_ply_and_changes_cache_identity(tmp_path):
    volume = load_volume(_stack(tmp_path))
    params = SplatConversionParams(
        transfer_function=TransferFunction(threshold=1),
        output_format="splat",
    )
    voxel_data = [[[10, 10], [0, 0]]]
    first = convert_volume_to_splat_asset(
        volume,
        volume_stack_id="segmented",
        voxel_data=voxel_data,
        segmentation={"labels": [[[1, 2], [0, 0]]]},
        params=params,
        output_dir=tmp_path / "json",
    )
    second = convert_volume_to_splat_asset(
        volume,
        volume_stack_id="segmented",
        voxel_data=voxel_data,
        segmentation={"labels": [[[2, 1], [0, 0]]]},
        params=params,
        output_dir=tmp_path / "json",
    )
    ply = convert_volume_to_splat_asset(
        volume,
        volume_stack_id="segmented-ply",
        voxel_data=voxel_data,
        segmentation={"labels": [[[1, 2], [0, 0]]]},
        params=SplatConversionParams(
            transfer_function=TransferFunction(threshold=1),
            output_format="ply",
        ),
        output_dir=tmp_path / "ply",
    )

    payload = json.loads(Path(first.path).read_text(encoding="utf-8"))
    ply_lines = Path(ply.path).read_text(encoding="utf-8").splitlines()
    header_end = ply_lines.index("end_header")
    assert [item["segment_id"] for item in payload["splats"]] == [1, 2]
    assert first.cache_key != second.cache_key
    assert "property uchar segment_id" in ply_lines[:header_end]
    assert [int(line.rsplit(" ", 1)[-1]) for line in ply_lines[header_end + 1 :]] == [
        1,
        2,
    ]


@pytest.mark.parametrize("output_format", ["splat", "ply"])
def test_segment_sampling_preserves_alternating_segments_at_exact_cap(
    tmp_path, output_format
):
    volume = load_volume(_line_stack(tmp_path, 4))
    params = SplatConversionParams(
        transfer_function=TransferFunction(threshold=1),
        output_format=output_format,
        max_splats=2,
    )

    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id=f"alternating-{output_format}",
        voxel_data=[[[10, 10, 10, 10]]],
        segmentation={"labels": [[[1, 2, 1, 2]]]},
        params=params,
        output_dir=tmp_path / "assets",
    )

    assert asset.splat_count == 2
    assert _asset_segment_ids(asset.path) == [1, 2]
    assert (
        asset.metadata["sampling_policy"]["name"]
        == "segment_stratified_proportional_v1"
    )


@pytest.mark.parametrize("output_format", ["splat", "ply"])
def test_segment_sampling_retains_a_single_voxel_tail_segment(tmp_path, output_format):
    volume = load_volume(_line_stack(tmp_path, 10))
    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id=f"tail-{output_format}",
        voxel_data=[[[10] * 10]],
        segmentation={"labels": [[[1] * 9 + [2]]]},
        params=SplatConversionParams(
            transfer_function=TransferFunction(threshold=1),
            output_format=output_format,
            max_splats=2,
        ),
        output_dir=tmp_path / "assets",
    )

    assert asset.splat_count == 2
    assert _asset_segment_ids(asset.path) == [1, 2]


@pytest.mark.parametrize("output_format", ["splat", "ply"])
def test_segment_sampling_is_deterministic_proportional_and_never_exceeds_cap(
    tmp_path, output_format
):
    labels = [1] * 8 + [2] * 4 + [3] * 2
    volume = load_volume(_line_stack(tmp_path, len(labels)))
    params = SplatConversionParams(
        transfer_function=TransferFunction(threshold=1),
        output_format=output_format,
        max_splats=7,
    )
    kwargs = {
        "volume_info": volume,
        "volume_stack_id": f"proportional-{output_format}",
        "voxel_data": [[[10] * len(labels)]],
        "segmentation": {"labels": [[labels]]},
        "params": params,
    }

    first = convert_volume_to_splat_asset(output_dir=tmp_path / "first", **kwargs)
    second = convert_volume_to_splat_asset(output_dir=tmp_path / "second", **kwargs)

    segment_ids = _asset_segment_ids(first.path)
    assert first.splat_count == second.splat_count == 7
    assert {
        segment_id: segment_ids.count(segment_id) for segment_id in set(segment_ids)
    } == {
        1: 4,
        2: 2,
        3: 1,
    }
    assert Path(first.path).read_bytes() == Path(second.path).read_bytes()


@pytest.mark.parametrize("output_format", ["splat", "ply"])
def test_segment_sampling_treats_zero_as_a_represented_unsegmented_bucket(
    tmp_path, output_format
):
    volume = load_volume(_line_stack(tmp_path, 4))
    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id=f"unsegmented-bucket-{output_format}",
        voxel_data=[[[10, 10, 10, 10]]],
        segmentation={"labels": [[[1, 1, 0, 2]]]},
        params=SplatConversionParams(
            transfer_function=TransferFunction(threshold=1),
            output_format=output_format,
            max_splats=3,
        ),
        output_dir=tmp_path / "assets",
    )

    assert asset.splat_count == 3
    assert _asset_segment_ids(asset.path) == [1, 0, 2]
    assert (
        asset.metadata["sampling_policy"]["unsegmented_bucket"]
        == "segment_id null in JSON and 0 in PLY"
    )


@pytest.mark.parametrize("output_format", ["splat", "ply"])
def test_undersized_segment_budget_keeps_largest_buckets_with_stable_ties(
    tmp_path, output_format
):
    labels = [1, 2, 2, 3, 3]
    volume = load_volume(_line_stack(tmp_path, len(labels)))
    asset = convert_volume_to_splat_asset(
        volume,
        volume_stack_id=f"undersized-{output_format}",
        voxel_data=[[[10] * len(labels)]],
        segmentation={"labels": [[labels]]},
        params=SplatConversionParams(
            transfer_function=TransferFunction(threshold=1),
            output_format=output_format,
            max_splats=2,
        ),
        output_dir=tmp_path / "assets",
    )

    assert asset.splat_count == 2
    assert _asset_segment_ids(asset.path) == [2, 3]
    assert asset.metadata["sampling_policy"]["undersized_budget"].startswith(
        "largest buckets first"
    )


def test_two_pass_collector_never_retains_the_uncapped_population():
    class TrackedSplat:
        live = 0
        peak = 0

        def __init__(self, index):
            self.segment_id = 1 if index % 2 else 2
            self.index = index
            type(self).live += 1
            type(self).peak = max(type(self).peak, type(self).live)

        def __del__(self):
            type(self).live -= 1

    calls = 0

    def factory():
        nonlocal calls
        calls += 1
        for index in range(10_000):
            yield TrackedSplat(index)

    selected = _collect_splats_to_budget(
        factory,
        7,
        preserve_segment_buckets=True,
    )

    assert calls == 2
    assert len(selected) == 7
    assert {item.segment_id for item in selected} == {1, 2}
    # The selected budget plus the generator/current-loop references are the
    # only live objects; the 10,000-item source is never materialized.
    assert TrackedSplat.peak <= 10


@pytest.mark.parametrize("max_splats", [None, True, 0, 100_001])
def test_reference_converter_requires_a_finite_hard_splat_budget(tmp_path, max_splats):
    volume = load_volume(_stack(tmp_path))
    with pytest.raises(ValueError, match="max_splats must be an integer"):
        convert_volume_to_splat_asset(
            volume,
            volume_stack_id="bounded",
            voxel_data=[[[10, 10], [10, 10]]],
            params=SplatConversionParams(
                transfer_function=TransferFunction(threshold=1),
                max_splats=max_splats,
                output_format="splat",
            ),
            output_dir=tmp_path / "assets",
        )


def _stack(tmp_path):
    stack_dir = tmp_path / "placeholder"
    stack_dir.mkdir()
    Image.new("L", (2, 2), color=0).save(stack_dir / "z000.png")
    return stack_dir


def _line_stack(tmp_path, width):
    stack_dir = tmp_path / "line-stack"
    stack_dir.mkdir()
    Image.new("L", (width, 1), color=0).save(stack_dir / "z000.png")
    return stack_dir


def _asset_segment_ids(path):
    asset_path = Path(path)
    if asset_path.suffix == ".json":
        payload = json.loads(asset_path.read_text(encoding="utf-8"))
        return [int(item["segment_id"] or 0) for item in payload["splats"]]
    lines = asset_path.read_text(encoding="utf-8").splitlines()
    header_end = lines.index("end_header")
    return [int(line.rsplit(" ", 1)[-1]) for line in lines[header_end + 1 :]]
