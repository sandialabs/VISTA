import struct
import zipfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import utils.volume_loader as volume_loader
from utils.volume_loader import (
    COMMON_VOLUME_FORMATS,
    MAX_ZIP_CENTRAL_DIRECTORY_BYTES,
    VolumeReadLimits,
    load_slice_stack,
    load_volume,
    read_numpy_volume_array,
    supported_volume_extensions,
)


def _write_minimal_npy(path: Path, shape=(3, 4, 5), dtype="|u1"):
    header = {"descr": dtype, "fortran_order": False, "shape": tuple(shape)}
    header_text = repr(header)
    padding = 16 - ((10 + len(header_text) + 1) % 16)
    header_bytes = (header_text + (" " * padding) + "\n").encode("latin1")
    payload_size = 1
    for value in shape:
        payload_size *= value
    path.write_bytes(
        b"\x93NUMPY"
        + bytes([1, 0])
        + struct.pack("<H", len(header_bytes))
        + header_bytes
        + bytes(payload_size)
    )


def _npy_header_bytes(shape=(3, 4, 5), dtype="|u1"):
    header = {"descr": dtype, "fortran_order": False, "shape": tuple(shape)}
    header_text = repr(header)
    padding = 16 - ((10 + len(header_text) + 1) % 16)
    header_bytes = (header_text + (" " * padding) + "\n").encode("latin1")
    return (
        b"\x93NUMPY"
        + bytes([1, 0])
        + struct.pack("<H", len(header_bytes))
        + header_bytes
    )


def _limits(**overrides):
    values = {
        "max_voxels": 100,
        "max_decoded_bytes": 1024,
        "max_source_bytes": 4096,
        "max_container_members": 4,
    }
    values.update(overrides)
    return VolumeReadLimits(**values)


def _declared_zip_eocd(*, entries: int, central_size: int = 0) -> bytes:
    return struct.pack(
        "<4s4H2LH",
        b"PK\x05\x06",
        0,
        0,
        entries,
        entries,
        central_size,
        0,
        0,
    )


def _declared_zip64_eocd(*, entries: int) -> bytes:
    zip64_eocd = struct.pack(
        "<4sQ2H2L4Q",
        b"PK\x06\x06",
        44,
        45,
        45,
        0,
        0,
        entries,
        entries,
        0,
        0,
    )
    locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, 0, 1)
    legacy_eocd = struct.pack(
        "<4s4H2LH",
        b"PK\x05\x06",
        0,
        0,
        0xFFFF,
        0xFFFF,
        0xFFFFFFFF,
        0xFFFFFFFF,
        0,
    )
    return zip64_eocd + locator + legacy_eocd


def test_loads_one_image_file_per_slice_stack(tmp_path):
    stack_dir = tmp_path / "stack"
    stack_dir.mkdir()
    for index in range(4):
        Image.new("L", (7, 5), color=index * 20).save(
            stack_dir / f"slice_{index:03d}.png"
        )

    volume = load_slice_stack(stack_dir)

    assert volume.format == "slice_stack"
    assert volume.shape == (4, 5, 7)
    assert len(volume.source_files) == 4


def test_loads_repository_pt3_synthetic_slice_stack():
    volume = load_volume(
        Path(__file__).resolve().parents[2] / "test" / "data" / "3D" / "anatomical"
    )

    assert volume.format == "slice_stack"
    assert volume.shape == (24, 96, 128)


def test_loads_repository_pt3_geometric_dual_label_stack():
    geometric_dir = (
        Path(__file__).resolve().parents[2] / "test" / "data" / "3D" / "geometric"
    )
    volume = load_volume(geometric_dir)
    files = sorted(geometric_dir.glob("PT3_GEOMETRIC_DUAL_LABEL_Z*.png"))

    xy_slice = Image.open(files[16]).convert("L")
    xy_bright = sum(1 for value in xy_slice.getdata() if value >= 180)

    xz_bright = 0
    yz_bright = 0
    for file_path in files:
        image = Image.open(file_path).convert("L")
        width, height = image.size
        xz_bright += sum(1 for x in range(width) if image.getpixel((x, 48)) >= 180)
        yz_bright += sum(1 for y in range(height) if image.getpixel((64, y)) >= 180)

    assert volume.format == "slice_stack"
    assert volume.shape == (64, 96, 128)
    assert xy_bright > 700
    assert xz_bright > 500
    assert yz_bright > 350


def test_loads_implicit_python_voxel_array_npy(tmp_path):
    npy_path = tmp_path / "volume.npy"
    _write_minimal_npy(npy_path, shape=(6, 8, 10))

    volume = load_volume(npy_path)

    assert volume.format == "numpy"
    assert volume.shape == (6, 8, 10)
    assert volume.dtype == "|u1"


@pytest.mark.parametrize(
    "channel_count,color_mode",
    [(3, "rgb"), (4, "rgba")],
)
def test_loads_color_numpy_volume_with_spatial_shape(
    tmp_path, channel_count, color_mode
):
    npy_path = tmp_path / f"volume-{color_mode}.npy"
    array = np.zeros((2, 3, 4, channel_count), dtype=np.uint8)
    np.save(npy_path, array)

    volume = load_volume(npy_path)

    assert volume.shape == (2, 3, 4)
    assert volume.array_shape == array.shape
    assert volume.channel_count == channel_count
    assert volume.color_mode == color_mode


@pytest.mark.parametrize("shape", [(0, 3, 4), (2, 0, 4), (2, 3, 0), (2, 0, 4, 3)])
def test_rejects_zero_spatial_dimensions_in_numpy_header_preflight(tmp_path, shape):
    path = tmp_path / "zero-dimension.npy"
    np.save(path, np.zeros(shape, dtype=np.uint8))

    with pytest.raises(ValueError, match="dimensions must be positive integers"):
        load_volume(path)


def test_rejects_channel_first_and_unsupported_color_numpy_shapes(tmp_path):
    for name, shape in (
        ("channel-first.npy", (3, 2, 5, 7)),
        ("two-channel.npy", (2, 3, 4, 2)),
    ):
        path = tmp_path / name
        np.save(path, np.zeros(shape, dtype=np.uint8))
        with pytest.raises(ValueError, match=r"\[z, y, x, 3\].*RGBA"):
            load_volume(path)


def test_color_numpy_limits_count_spatial_voxels_and_all_channel_bytes(tmp_path):
    npy_path = tmp_path / "rgba.npy"
    np.save(npy_path, np.zeros((2, 2, 2, 4), dtype=np.uint8))

    volume = load_volume(
        npy_path,
        limits=_limits(max_voxels=8, max_decoded_bytes=32),
    )
    assert volume.shape == (2, 2, 2)

    with pytest.raises(ValueError, match="32 decoded bytes.*31-byte limit"):
        load_volume(
            npy_path,
            limits=_limits(max_voxels=8, max_decoded_bytes=31),
        )


def test_scalar_numpy_reader_rejects_color_volume(tmp_path):
    npy_path = tmp_path / "rgb.npy"
    np.save(npy_path, np.zeros((2, 3, 4, 3), dtype=np.uint8))

    with pytest.raises(ValueError, match="do not support RGB or RGBA"):
        read_numpy_volume_array(npy_path, limits=_limits(max_voxels=24))


def test_common_3d_cube_formats_are_documented():
    assert ".npy" in supported_volume_extensions()
    assert ".tiff" in supported_volume_extensions()
    assert COMMON_VOLUME_FORMATS["dicom"]["extensions"] == [".dcm", ".dicom"]
    assert COMMON_VOLUME_FORMATS["matlab"]["extensions"] == [".mat"]
    assert COMMON_VOLUME_FORMATS["nifti"]["extensions"] == [".nii", ".nii.gz"]


def test_loads_implicit_python_voxel_array_npz(tmp_path):
    npy_path = tmp_path / "volume.npy"
    _write_minimal_npy(npy_path, shape=(5, 6, 7))

    import zipfile

    archive_path = tmp_path / "volume.npz"
    with zipfile.ZipFile(
        archive_path, mode="w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        archive.write(npy_path, arcname="voxels.npy")

    volume = load_volume(archive_path)

    assert volume.format == "numpy"
    assert volume.shape == (5, 6, 7)


def test_loads_multipage_tiff_volume(tmp_path):
    tiff_path = tmp_path / "stack.tiff"
    frames = [Image.new("L", (9, 11), color=i * 20) for i in range(3)]
    frames[0].save(tiff_path, save_all=True, append_images=frames[1:])

    volume = load_volume(tiff_path)

    assert volume.format == "multipage_tiff"
    assert volume.shape == (3, 11, 9)


@pytest.mark.parametrize(
    "mode,color,channel_count,color_mode",
    [
        ("RGB", (10, 20, 30), 3, "rgb"),
        ("RGBA", (10, 20, 30, 40), 4, "rgba"),
    ],
)
def test_color_slice_stacks_and_tiffs_report_spatial_shape_and_channels(
    tmp_path, mode, color, channel_count, color_mode
):
    stack_dir = tmp_path / f"{color_mode}-stack"
    stack_dir.mkdir()
    for index in range(2):
        Image.new(mode, (4, 3), color=color).save(stack_dir / f"z{index}.png")
    stack = load_volume(stack_dir)

    tiff_path = tmp_path / f"{color_mode}.tiff"
    frames = [Image.new(mode, (4, 3), color=color) for _ in range(2)]
    frames[0].save(tiff_path, save_all=True, append_images=frames[1:])
    tiff = load_volume(tiff_path)

    for volume in (stack, tiff):
        assert volume.shape == (2, 3, 4)
        assert volume.array_shape == (2, 3, 4, channel_count)
        assert volume.channel_count == channel_count
        assert volume.color_mode == color_mode


@pytest.mark.parametrize(
    "mode,color", [("1", 1), ("L", 7), ("P", 2), ("I", 1024), ("F", 0.5)]
)
def test_single_band_scalar_tiff_modes_remain_valid(tmp_path, mode, color):
    path = tmp_path / f"scalar-{mode.replace(';', '-')}.tiff"
    Image.new(mode, (4, 3), color=color).save(path)

    volume = load_volume(path)

    assert volume.shape == (1, 3, 4)
    assert volume.channel_count == 1
    assert volume.color_mode == "scalar"


@pytest.mark.parametrize("mode,color", [("LA", (10, 20)), ("CMYK", (1, 2, 3, 4))])
def test_rejects_unsupported_multiband_tiff_modes(tmp_path, mode, color):
    path = tmp_path / f"unsupported-{mode}.tiff"
    Image.new(mode, (4, 3), color=color).save(path)

    with pytest.raises(ValueError, match=rf"pixel mode '{mode}'.*scalar, RGB, or RGBA"):
        load_volume(path)


def test_loads_300_slice_300px_multipage_tiff_volume(tmp_path):
    tiff_path = tmp_path / "stack_300x300x300.tif"
    frames = [Image.new("L", (300, 300), color=index % 256) for index in range(300)]
    frames[0].save(tiff_path, save_all=True, append_images=frames[1:])

    volume = load_volume(tiff_path)

    assert volume.format == "multipage_tiff"
    assert volume.shape == (300, 300, 300)
    assert len(volume.source_files) == 1


def test_tif_2d_vs_3d_classification_by_frame_count(tmp_path):
    single_slice_tif = tmp_path / "single_slice.tif"
    Image.new("L", (10, 12), color=90).save(single_slice_tif)

    multi_slice_tif = tmp_path / "multi_slice.tif"
    frames = [Image.new("L", (10, 12), color=v) for v in (10, 40, 70, 100)]
    frames[0].save(multi_slice_tif, save_all=True, append_images=frames[1:])

    single_volume = load_volume(single_slice_tif)
    multi_volume = load_volume(multi_slice_tif)

    assert single_volume.format == "multipage_tiff"
    assert single_volume.shape == (1, 12, 10)
    assert multi_volume.format == "multipage_tiff"
    assert multi_volume.shape == (4, 12, 10)


def test_reference_volume_limits_allow_2_5_gib_sources_and_decoded_numpy_payloads(
    tmp_path,
):
    from utils.volume_loader import MAX_VOLUME_LOAD_BYTES, REFERENCE_VOLUME_READ_LIMITS

    assert int(2.5 * 1024 * 1024 * 1024) == MAX_VOLUME_LOAD_BYTES
    assert REFERENCE_VOLUME_READ_LIMITS.max_source_bytes == MAX_VOLUME_LOAD_BYTES
    assert REFERENCE_VOLUME_READ_LIMITS.max_decoded_bytes == MAX_VOLUME_LOAD_BYTES
    assert REFERENCE_VOLUME_READ_LIMITS.max_voxels == MAX_VOLUME_LOAD_BYTES

    npy_path = tmp_path / "declared-large-but-allowed.npy"
    header = _npy_header_bytes(shape=(1, 1, 400 * 1024 * 1024), dtype="|u1")
    npy_path.write_bytes(header)
    with npy_path.open("ab") as file_obj:
        file_obj.truncate(len(header) + (400 * 1024 * 1024))

    volume = load_volume(npy_path, limits=REFERENCE_VOLUME_READ_LIMITS)

    assert volume.shape == (1, 1, 400 * 1024 * 1024)
    assert volume.format == "numpy"


def test_rejects_oversized_declared_npy_shape_before_payload_read(tmp_path):
    npy_path = tmp_path / "declared-too-large.npy"
    npy_path.write_bytes(_npy_header_bytes(shape=(1, 1, 101)))

    with pytest.raises(ValueError, match="101 voxels.*100-voxel limit"):
        load_volume(npy_path, limits=_limits())


def test_rejects_npy_decoded_byte_limit_before_array_allocation(tmp_path):
    npy_path = tmp_path / "wide-dtype.npy"
    npy_path.write_bytes(_npy_header_bytes(shape=(1, 1, 2), dtype="<f8"))

    with pytest.raises(ValueError, match="16 decoded bytes.*8-byte limit"):
        load_volume(npy_path, limits=_limits(max_decoded_bytes=8))


def test_npz_preflight_bounds_total_uncompressed_members_without_inflating_them(
    tmp_path,
):
    archive_path = tmp_path / "archive-bomb-like.npz"
    with zipfile.ZipFile(
        archive_path, "w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        archive.writestr("voxels.npy", _npy_header_bytes(shape=(1, 1, 1)) + b"\x01")
        archive.writestr("ignored-padding.bin", b"0" * 256)

    with pytest.raises(ValueError, match="uncompressed bytes.*128-byte archive limit"):
        load_volume(
            archive_path,
            limits=_limits(max_decoded_bytes=128),
        )


def test_npz_preflight_rejects_compressed_member_with_oversized_declared_array(
    tmp_path,
):
    archive_path = tmp_path / "declared-array-bomb.npz"
    with zipfile.ZipFile(
        archive_path, "w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        archive.writestr("voxels.npy", _npy_header_bytes(shape=(1, 1, 10_000_000)))

    assert archive_path.stat().st_size < 1024
    with pytest.raises(ValueError, match="10000000 voxels.*100-voxel limit"):
        load_volume(archive_path, limits=_limits())


def test_npz_member_count_is_bounded_before_selected_array_decode(tmp_path):
    archive_path = tmp_path / "too-many-members.npz"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("voxels.npy", _npy_header_bytes(shape=(1, 1, 1)) + b"\x01")
        archive.writestr("one.txt", b"1")
        archive.writestr("two.txt", b"2")

    with pytest.raises(ValueError, match="3 members.*2-member limit"):
        load_volume(archive_path, limits=_limits(max_container_members=2))


@pytest.mark.parametrize(
    "payload",
    [
        _declared_zip_eocd(entries=5_000),
        _declared_zip64_eocd(entries=1_000_000),
    ],
)
def test_npz_member_limit_is_enforced_before_zipfile_constructs_entries(
    tmp_path,
    monkeypatch,
    payload,
):
    archive_path = tmp_path / "too-many-declared-members.npz"
    archive_path.write_bytes(payload)
    zipfile_constructor_calls = 0

    def forbidden_zipfile_constructor(*_args, **_kwargs):
        nonlocal zipfile_constructor_calls
        zipfile_constructor_calls += 1
        raise AssertionError(
            "unsafe archive must be rejected before ZipFile construction"
        )

    monkeypatch.setattr(volume_loader.zipfile, "ZipFile", forbidden_zipfile_constructor)

    with pytest.raises(ValueError, match="configured/built-in 4-member limit"):
        load_volume(archive_path, limits=_limits())

    assert zipfile_constructor_calls == 0


def test_npz_central_directory_size_is_bounded_before_zipfile_construction(
    tmp_path,
    monkeypatch,
):
    archive_path = tmp_path / "oversized-central-directory.npz"
    archive_path.write_bytes(
        _declared_zip_eocd(
            entries=0,
            central_size=MAX_ZIP_CENTRAL_DIRECTORY_BYTES + 1,
        )
    )
    zipfile_constructor_calls = 0

    def forbidden_zipfile_constructor(*_args, **_kwargs):
        nonlocal zipfile_constructor_calls
        zipfile_constructor_calls += 1
        raise AssertionError(
            "unsafe archive must be rejected before ZipFile construction"
        )

    monkeypatch.setattr(volume_loader.zipfile, "ZipFile", forbidden_zipfile_constructor)
    limits = _limits(max_source_bytes=MAX_ZIP_CENTRAL_DIRECTORY_BYTES * 2)

    with pytest.raises(ValueError, match="built-in .*metadata limit"):
        load_volume(archive_path, limits=limits)

    assert zipfile_constructor_calls == 0


def test_npz_preflight_counts_central_entries_instead_of_trusting_eocd(
    tmp_path,
    monkeypatch,
):
    archive_path = tmp_path / "lying-entry-count.npz"
    with zipfile.ZipFile(archive_path, "w") as archive:
        for index in range(3):
            archive.writestr(f"entry-{index}.txt", b"")
    payload = bytearray(archive_path.read_bytes())
    eocd_offset = payload.rfind(b"PK\x05\x06")
    assert eocd_offset >= 0
    struct.pack_into("<HH", payload, eocd_offset + 8, 1, 1)
    archive_path.write_bytes(payload)
    zipfile_constructor_calls = 0

    def forbidden_zipfile_constructor(*_args, **_kwargs):
        nonlocal zipfile_constructor_calls
        zipfile_constructor_calls += 1
        raise AssertionError(
            "unsafe archive must be rejected before ZipFile construction"
        )

    monkeypatch.setattr(volume_loader.zipfile, "ZipFile", forbidden_zipfile_constructor)

    with pytest.raises(ValueError, match="configured/built-in 2-member limit"):
        load_volume(archive_path, limits=_limits(max_container_members=2))

    assert zipfile_constructor_calls == 0


def test_preflighted_npz_array_reader_decodes_only_selected_bounded_array(tmp_path):
    archive_path = tmp_path / "safe.npz"
    expected = np.arange(8, dtype=np.uint16).reshape((2, 2, 2))
    with zipfile.ZipFile(
        archive_path, "w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        import io

        payload = io.BytesIO()
        np.save(payload, expected)
        archive.writestr("voxels.npy", payload.getvalue())

    actual = read_numpy_volume_array(archive_path, limits=_limits())

    assert np.array_equal(actual, expected)


def test_npy_array_reader_materializes_only_endpoint_preserving_sample(tmp_path):
    volume_path = tmp_path / "sampled.npy"
    source = np.arange(4 * 5 * 6, dtype=np.uint16).reshape((4, 5, 6))
    np.save(volume_path, source)

    actual = read_numpy_volume_array(
        volume_path,
        limits=_limits(max_voxels=1_000, max_decoded_bytes=10_000),
        sample_shape=(2, 3, 2),
    )

    expected = source[np.ix_([0, 3], [0, 2, 4], [0, 5])]
    assert actual.flags.c_contiguous
    assert np.array_equal(actual, expected)


def test_npy_block_reduction_preserves_off_grid_positive_and_negative_signal(tmp_path):
    volume_path = tmp_path / "block-sampled.npy"
    source = np.zeros((4, 4, 4), dtype=np.int16)
    source[1, 1, 1] = 7
    source[2, 2, 2] = -9
    np.save(volume_path, source)

    actual, selected_source_flat_indices = read_numpy_volume_array(
        volume_path,
        limits=_limits(max_voxels=1_000, max_decoded_bytes=10_000),
        sample_shape=(2, 2, 2),
        sample_reduction="nonzero_extrema",
        return_source_flat_indices=True,
    )

    assert actual[0, 0, 0] == 7
    assert actual[1, 1, 1] == -9
    assert selected_source_flat_indices[0, 0, 0] == np.ravel_multi_index(
        (1, 1, 1), source.shape
    )
    assert selected_source_flat_indices[1, 1, 1] == np.ravel_multi_index(
        (2, 2, 2), source.shape
    )


def test_npy_block_reduction_prefers_endpoint_grid_for_tied_extrema(tmp_path):
    volume_path = tmp_path / "flat-blocks.npy"
    source = np.ones((4, 4, 4), dtype=np.uint16)
    np.save(volume_path, source)

    actual, selected_source_flat_indices = read_numpy_volume_array(
        volume_path,
        limits=_limits(max_voxels=1_000, max_decoded_bytes=10_000),
        sample_shape=(2, 2, 2),
        sample_reduction="maximum",
        return_source_flat_indices=True,
    )

    endpoint_indices = np.array([0, 3], dtype=np.intp)
    expected_source_flat_indices = np.ravel_multi_index(
        np.ix_(endpoint_indices, endpoint_indices, endpoint_indices),
        source.shape,
    )
    assert np.array_equal(actual, np.ones((2, 2, 2), dtype=np.uint16))
    assert np.array_equal(
        selected_source_flat_indices,
        expected_source_flat_indices,
    )


def test_npz_array_reader_rejects_sampling_before_member_decode(tmp_path):
    archive_path = tmp_path / "sampled.npz"
    np.savez_compressed(archive_path, voxels=np.ones((4, 4, 4), dtype=np.uint8))

    with pytest.raises(ValueError, match=r"plain \.npy"):
        read_numpy_volume_array(
            archive_path,
            limits=_limits(max_voxels=1_000, max_decoded_bytes=10_000),
            sample_shape=(2, 2, 2),
        )


@pytest.mark.parametrize("sample_shape", [(0, 1, 1), (5, 1, 1), (True, 1, 1)])
def test_npy_array_reader_rejects_invalid_sample_shapes(tmp_path, sample_shape):
    volume_path = tmp_path / "sampled.npy"
    np.save(volume_path, np.ones((4, 5, 6), dtype=np.uint8))

    with pytest.raises(ValueError, match="sample shape"):
        read_numpy_volume_array(
            volume_path,
            limits=_limits(max_voxels=1_000, max_decoded_bytes=10_000),
            sample_shape=sample_shape,
        )


def test_tiff_shape_is_rejected_before_frame_decode_allocation(tmp_path):
    tiff_path = tmp_path / "too-many-voxels.tiff"
    frames = [Image.new("L", (2, 2), color=index) for index in range(3)]
    frames[0].save(tiff_path, save_all=True, append_images=frames[1:])

    with pytest.raises(ValueError, match="12 voxels.*10-voxel limit"):
        load_volume(tiff_path, limits=_limits(max_voxels=10))


def test_tiff_frame_count_is_bounded_as_container_members(tmp_path):
    tiff_path = tmp_path / "too-many-frames.tiff"
    frames = [Image.new("L", (1, 1), color=index) for index in range(3)]
    frames[0].save(tiff_path, save_all=True, append_images=frames[1:])

    with pytest.raises(ValueError, match="3 frames.*2-member limit"):
        load_volume(tiff_path, limits=_limits(max_container_members=2))
