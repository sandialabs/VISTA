"""Lightweight 3D volume fixture inspection helpers.

The production app can add richer readers later, but tests should be able to
verify core stack/cube behavior without pulling in heavy scientific packages.
"""

from __future__ import annotations

import ast
import contextlib
import math
import struct
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal

import numpy as np
from PIL import Image

SLICE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
IMPLICIT_VOLUME_EXTENSIONS = {".npy", ".npz", ".tif", ".tiff"}
MAX_NPY_HEADER_BYTES = 64 * 1024
MAX_VOLUME_LOAD_BYTES = int(2.5 * 1024 * 1024 * 1024)
MAX_VOLUME_LOAD_VOXELS = MAX_VOLUME_LOAD_BYTES
MAX_ZIP_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024

_ZIP_EOCD_SIGNATURE = b"PK\x05\x06"
_ZIP64_EOCD_SIGNATURE = b"PK\x06\x06"
_ZIP64_LOCATOR_SIGNATURE = b"PK\x06\x07"
_ZIP_CENTRAL_FILE_SIGNATURE = b"PK\x01\x02"
_ZIP_CENTRAL_DIGITAL_SIGNATURE = b"PK\x05\x05"
_ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE = b"PK\x06\x08"
_ZIP_MAX_COMMENT_BYTES = 65_535


@dataclass(frozen=True)
class VolumeReadLimits:
    """Resource limits applied before compressed or decoded volume reads.

    ``max_decoded_bytes`` covers NumPy array payloads and the float64 scalar
    working volume used by the reference image/TIFF readers.  Container-member
    limits also bound archives with many tiny entries or TIFF frames.
    """

    max_voxels: int
    max_decoded_bytes: int
    max_source_bytes: int
    max_container_members: int

    def __post_init__(self) -> None:
        for field_name in (
            "max_voxels",
            "max_decoded_bytes",
            "max_source_bytes",
            "max_container_members",
        ):
            value = getattr(self, field_name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"{field_name} must be a positive integer")


REFERENCE_VOLUME_READ_LIMITS = VolumeReadLimits(
    max_voxels=MAX_VOLUME_LOAD_VOXELS,
    max_decoded_bytes=MAX_VOLUME_LOAD_BYTES,
    max_source_bytes=MAX_VOLUME_LOAD_BYTES,
    max_container_members=4_096,
)
COMMON_VOLUME_FORMATS = {
    "slice_stack": {
        "extensions": sorted(SLICE_EXTENSIONS),
        "supported": True,
        "notes": "One 2D image per slice, sorted by filename.",
    },
    "numpy": {
        "extensions": [".npy", ".npz"],
        "supported": True,
        "notes": "Python voxel arrays; shape is read directly from the NumPy header.",
    },
    "multipage_tiff": {
        "extensions": [".tif", ".tiff"],
        "supported": True,
        "notes": "Implicit stack stored as frames in one TIFF.",
    },
    "dicom": {
        "extensions": [".dcm", ".dicom"],
        "supported": False,
        "notes": "Common clinical series format; requires a DICOM reader such as pydicom/SimpleITK.",
    },
    "nifti": {
        "extensions": [".nii", ".nii.gz"],
        "supported": False,
        "notes": "Common neuroimaging volume format; requires nibabel/SimpleITK.",
    },
    "nrrd": {
        "extensions": [".nrrd", ".nhdr"],
        "supported": False,
        "notes": "General 3D/4D research volume format; requires pynrrd/SimpleITK.",
    },
    "metaimage": {
        "extensions": [".mha", ".mhd"],
        "supported": False,
        "notes": "ITK MetaImage format, often paired with raw voxel data.",
    },
    "matlab": {
        "extensions": [".mat"],
        "supported": False,
        "notes": "MATLAB voxel arrays; requires scipy or hdf5 tooling depending on MAT version.",
    },
    "hdf5": {
        "extensions": [".h5", ".hdf5"],
        "supported": False,
        "notes": "Container format used for scientific volumes; requires h5py.",
    },
}


@dataclass(frozen=True)
class VolumeInfo:
    format: str
    shape: tuple[int, int, int]
    source_files: tuple[str, ...]
    dtype: str | None = None
    channel_count: int = 1
    color_mode: Literal["scalar", "rgb", "rgba"] = "scalar"

    @property
    def array_shape(self) -> tuple[int, ...]:
        """Return the decoded array shape while keeping ``shape`` spatial-only."""

        if self.channel_count == 1:
            return self.shape
        return (*self.shape, self.channel_count)


@dataclass(frozen=True)
class _NpyHeader:
    shape: tuple[int, int, int]
    array_shape: tuple[int, ...]
    channel_count: int
    color_mode: Literal["scalar", "rgb", "rgba"]
    dtype_text: str
    dtype: np.dtype
    data_offset: int
    payload_bytes: int


def _checked_voxel_count(shape: tuple[int, int, int]) -> int:
    if any(isinstance(value, bool) or value <= 0 for value in shape):
        raise ValueError("Volume dimensions must be positive integers")
    return math.prod(shape)


def _volume_layout_from_array_shape(
    shape: tuple[int, ...],
) -> tuple[tuple[int, int, int], int, Literal["scalar", "rgb", "rgba"]]:
    if len(shape) == 3:
        return (int(shape[0]), int(shape[1]), int(shape[2])), 1, "scalar"
    if len(shape) == 4 and shape[-1] in {3, 4}:
        channel_count = int(shape[-1])
        color_mode: Literal["rgb", "rgba"] = "rgb" if channel_count == 3 else "rgba"
        return (int(shape[0]), int(shape[1]), int(shape[2])), channel_count, color_mode
    raise ValueError(
        "NumPy volume must have shape [z, y, x], [z, y, x, 3] (RGB), or [z, y, x, 4] (RGBA)"
    )


def _image_color_layout(
    image: Image.Image,
) -> tuple[int, Literal["scalar", "rgb", "rgba"]]:
    if image.mode == "RGB":
        return 3, "rgb"
    if image.mode == "RGBA":
        return 4, "rgba"
    if len(image.getbands()) == 1:
        return 1, "scalar"
    raise ValueError(
        f"Unsupported volume image pixel mode {image.mode!r}: expected a "
        "single-band scalar, RGB, or RGBA image"
    )


def _enforce_source_size(path: Path, limits: VolumeReadLimits | None) -> None:
    if limits is None:
        return
    try:
        source_bytes = path.stat().st_size
    except OSError as exc:
        raise ValueError(f"Could not inspect volume source {path.name}") from exc
    if source_bytes > limits.max_source_bytes:
        raise ValueError(
            f"Volume source exceeds the {limits.max_source_bytes}-byte materialized-file limit"
        )


def _enforce_decoded_limits(
    *,
    shape: tuple[int, int, int],
    decoded_bytes: int,
    limits: VolumeReadLimits | None,
) -> None:
    if limits is None:
        return
    voxel_count = _checked_voxel_count(shape)
    if voxel_count > limits.max_voxels:
        raise ValueError(
            f"Volume declares {voxel_count} voxels, exceeding the {limits.max_voxels}-voxel limit"
        )
    if decoded_bytes > limits.max_decoded_bytes:
        raise ValueError(
            "Volume declares "
            f"{decoded_bytes} decoded bytes, exceeding the {limits.max_decoded_bytes}-byte limit"
        )


def _candidate_slices(path: Path) -> list[Path]:
    return sorted(
        item
        for item in path.iterdir()
        if item.is_file() and item.suffix.lower() in SLICE_EXTENSIONS
    )


def load_slice_stack(
    path: str | Path, *, limits: VolumeReadLimits | None = None
) -> VolumeInfo:
    stack_path = Path(path)
    if not stack_path.is_dir():
        raise ValueError(f"Slice stack path is not a directory: {stack_path}")
    slices = _candidate_slices(stack_path)
    if not slices:
        raise ValueError(f"No supported image slices found in {stack_path}")
    if limits is not None and len(slices) > limits.max_container_members:
        raise ValueError(
            "Slice stack contains "
            f"{len(slices)} files, exceeding the {limits.max_container_members}-member limit"
        )

    width = height = None
    channel_count = 1
    color_mode: Literal["scalar", "rgb", "rgba"] = "scalar"
    expected_mode = None
    source_bytes = 0
    for slice_path in slices:
        if limits is not None:
            source_bytes += slice_path.stat().st_size
            if source_bytes > limits.max_source_bytes:
                raise ValueError(
                    "Slice stack exceeds the "
                    f"{limits.max_source_bytes}-byte materialized-source limit"
                )
        with Image.open(slice_path) as image:
            if width is None or height is None:
                width, height = image.size
                channel_count, color_mode = _image_color_layout(image)
                expected_mode = image.mode
            elif image.size != (width, height):
                raise ValueError("All image slices must share the same dimensions")
            elif image.mode != expected_mode:
                raise ValueError("All image slices must share the same pixel mode")

    shape = (len(slices), int(height), int(width))
    _enforce_decoded_limits(
        shape=shape,
        decoded_bytes=math.prod(shape) * channel_count * np.dtype(np.float64).itemsize,
        limits=limits,
    )

    return VolumeInfo(
        format="slice_stack",
        shape=shape,
        source_files=tuple(str(item) for item in slices),
        dtype="image",
        channel_count=channel_count,
        color_mode=color_mode,
    )


def _read_exact(file_obj: BinaryIO, length: int, *, field: str) -> bytes:
    payload = file_obj.read(length)
    if len(payload) != length:
        raise ValueError(f"Truncated NumPy {field}")
    return payload


def _read_zip_bytes_at(
    file_obj: BinaryIO,
    offset: int,
    length: int,
    *,
    field: str,
) -> bytes:
    try:
        file_obj.seek(offset)
    except (AttributeError, OSError) as exc:
        raise ValueError("ZIP archive source must be seekable") from exc
    payload = file_obj.read(length)
    if len(payload) != length:
        raise ValueError(f"Truncated ZIP {field}")
    return payload


def preflight_zip_archive(
    file_obj: BinaryIO,
    *,
    limits: VolumeReadLimits,
    available_bytes: int | None = None,
) -> tuple[int, int]:
    """Bound ZIP metadata before ``zipfile.ZipFile`` allocates ``ZipInfo`` objects.

    ``ZipFile`` eagerly materializes the entire central directory.  Checking
    ``infolist()`` afterwards is therefore too late for an archive containing
    millions of empty entries.  This preflight reads the small end record and
    then walks central-directory records without retaining filenames or entry
    objects in memory.
    """

    try:
        original_offset = int(file_obj.tell())
        file_obj.seek(0, 2)
        source_bytes = int(file_obj.tell())
    except (AttributeError, OSError, TypeError, ValueError) as exc:
        raise ValueError("ZIP archive source must be seekable") from exc

    try:
        if available_bytes is not None and available_bytes != source_bytes:
            raise ValueError(
                "ZIP archive size changed during preflight: "
                f"expected {available_bytes} bytes, found {source_bytes}"
            )
        if source_bytes > limits.max_source_bytes:
            raise ValueError(
                "ZIP archive source exceeds the configured/built-in "
                f"{limits.max_source_bytes}-byte materialized-file limit"
            )
        if source_bytes < 22:
            raise ValueError("Truncated ZIP end-of-central-directory record")

        tail_length = min(source_bytes, 22 + _ZIP_MAX_COMMENT_BYTES)
        tail_offset = source_bytes - tail_length
        tail = _read_zip_bytes_at(
            file_obj,
            tail_offset,
            tail_length,
            field="end-of-central-directory search window",
        )
        candidate_end = len(tail)
        eocd_index = -1
        while candidate_end > 0:
            candidate = tail.rfind(_ZIP_EOCD_SIGNATURE, 0, candidate_end)
            if candidate < 0:
                break
            if candidate + 22 <= len(tail):
                comment_length = struct.unpack_from("<H", tail, candidate + 20)[0]
                if candidate + 22 + comment_length == len(tail):
                    eocd_index = candidate
                    break
            candidate_end = candidate
        if eocd_index < 0:
            raise ValueError("ZIP end-of-central-directory record is missing")

        eocd_offset = tail_offset + eocd_index
        (
            _signature,
            disk_number,
            central_disk_number,
            entries_on_disk,
            total_entries,
            central_size,
            central_offset,
            _comment_length,
        ) = struct.unpack_from("<4s4H2LH", tail, eocd_index)
        if disk_number != 0 or central_disk_number != 0:
            raise ValueError("Multi-disk ZIP archives are not supported")

        locator_offset = eocd_offset - 20
        locator = (
            _read_zip_bytes_at(file_obj, locator_offset, 20, field="ZIP64 locator")
            if locator_offset >= 0
            else b""
        )
        has_zip64_locator = locator.startswith(_ZIP64_LOCATOR_SIGNATURE)
        has_zip64_sentinel = (
            entries_on_disk == 0xFFFF
            or total_entries == 0xFFFF
            or central_size == 0xFFFFFFFF
            or central_offset == 0xFFFFFFFF
        )
        central_end = eocd_offset
        if has_zip64_sentinel or has_zip64_locator:
            if not has_zip64_locator:
                raise ValueError("ZIP64 locator is missing")
            (
                _locator_signature,
                zip64_disk_number,
                zip64_eocd_offset,
                zip64_disk_count,
            ) = struct.unpack("<4sLQL", locator)
            if zip64_disk_number != 0 or zip64_disk_count != 1:
                raise ValueError("Multi-disk ZIP64 archives are not supported")
            zip64_fixed = _read_zip_bytes_at(
                file_obj,
                int(zip64_eocd_offset),
                56,
                field="ZIP64 end-of-central-directory record",
            )
            (
                zip64_signature,
                zip64_record_size,
                _creator_version,
                _extractor_version,
                zip64_disk,
                zip64_central_disk,
                entries_on_disk,
                total_entries,
                central_size,
                central_offset,
            ) = struct.unpack("<4sQ2H2L4Q", zip64_fixed)
            if zip64_signature != _ZIP64_EOCD_SIGNATURE or zip64_record_size < 44:
                raise ValueError("Invalid ZIP64 end-of-central-directory record")
            if zip64_disk != 0 or zip64_central_disk != 0:
                raise ValueError("Multi-disk ZIP64 archives are not supported")
            if int(zip64_eocd_offset) + 12 + int(zip64_record_size) != locator_offset:
                raise ValueError("Invalid ZIP64 end-of-central-directory bounds")
            central_end = int(zip64_eocd_offset)

        total_entries = int(total_entries)
        entries_on_disk = int(entries_on_disk)
        central_size = int(central_size)
        central_offset = int(central_offset)
        if entries_on_disk != total_entries:
            raise ValueError("Multi-disk ZIP archives are not supported")
        if total_entries > limits.max_container_members:
            raise ValueError(
                "ZIP archive declares "
                f"{total_entries} members, exceeding the configured/built-in "
                f"{limits.max_container_members}-member limit"
            )
        central_metadata_limit = min(
            MAX_ZIP_CENTRAL_DIRECTORY_BYTES,
            limits.max_source_bytes,
        )
        if central_size > central_metadata_limit:
            raise ValueError(
                "ZIP central directory declares "
                f"{central_size} bytes, exceeding the built-in "
                f"{central_metadata_limit}-byte metadata limit"
            )
        if central_offset < 0 or central_size < 0:
            raise ValueError("Invalid ZIP central-directory bounds")
        if central_offset + central_size != central_end:
            raise ValueError("Invalid ZIP central-directory bounds")

        # Verify the declared entry count without constructing any ZipInfo
        # objects.  Variable-length names, extras, and comments are skipped.
        cursor = central_offset
        actual_entries = 0
        while cursor < central_end:
            signature = _read_zip_bytes_at(
                file_obj,
                cursor,
                4,
                field="central-directory signature",
            )
            if signature == _ZIP_CENTRAL_FILE_SIGNATURE:
                fixed = _read_zip_bytes_at(
                    file_obj,
                    cursor,
                    46,
                    field="central-directory entry",
                )
                filename_length, extra_length, comment_length = struct.unpack_from(
                    "<HHH", fixed, 28
                )
                record_length = 46 + filename_length + extra_length + comment_length
                actual_entries += 1
                if actual_entries > limits.max_container_members:
                    raise ValueError(
                        "ZIP central directory contains more than the configured/built-in "
                        f"{limits.max_container_members}-member limit"
                    )
            elif signature == _ZIP_CENTRAL_DIGITAL_SIGNATURE:
                record_length = (
                    6
                    + struct.unpack(
                        "<H",
                        _read_zip_bytes_at(
                            file_obj,
                            cursor + 4,
                            2,
                            field="central-directory digital-signature length",
                        ),
                    )[0]
                )
            elif signature == _ZIP_ARCHIVE_EXTRA_DATA_SIGNATURE:
                record_length = (
                    8
                    + struct.unpack(
                        "<L",
                        _read_zip_bytes_at(
                            file_obj,
                            cursor + 4,
                            4,
                            field="central-directory extra-data length",
                        ),
                    )[0]
                )
            else:
                raise ValueError("Invalid ZIP central-directory record")
            if record_length < 1 or cursor + record_length > central_end:
                raise ValueError("Truncated ZIP central-directory record")
            cursor += record_length

        if actual_entries != total_entries:
            raise ValueError(
                "ZIP central-directory entry count does not match its end record"
            )
        return actual_entries, central_size
    finally:
        with contextlib.suppress(AttributeError, OSError):
            file_obj.seek(original_offset)


def _inspect_npy_header(
    file_obj: BinaryIO,
    *,
    limits: VolumeReadLimits | None = None,
    available_bytes: int | None = None,
) -> _NpyHeader:
    magic = file_obj.read(6)
    if magic != b"\x93NUMPY":
        raise ValueError("Not a NumPy .npy file")
    major, minor = struct.unpack("BB", _read_exact(file_obj, 2, field="version"))
    if (major, minor) == (1, 0):
        header_len = struct.unpack(
            "<H", _read_exact(file_obj, 2, field="header length")
        )[0]
    elif major in {2, 3}:
        header_len = struct.unpack(
            "<I", _read_exact(file_obj, 4, field="header length")
        )[0]
    else:
        raise ValueError(f"Unsupported NumPy format version {major}.{minor}")
    if header_len > MAX_NPY_HEADER_BYTES:
        raise ValueError(
            f"NumPy header exceeds the {MAX_NPY_HEADER_BYTES}-byte metadata limit"
        )
    encoding = "utf-8" if major == 3 else "latin1"
    try:
        header = (
            _read_exact(file_obj, header_len, field="header").decode(encoding).strip()
        )
        metadata = ast.literal_eval(header)
    except (
        SyntaxError,
        UnicodeDecodeError,
        ValueError,
        MemoryError,
        RecursionError,
    ) as exc:
        raise ValueError("Invalid NumPy array header") from exc
    if not isinstance(metadata, dict):
        raise ValueError("Invalid NumPy array header")
    shape = metadata.get("shape")
    descr = metadata.get("descr")
    if not isinstance(shape, tuple) or any(
        isinstance(value, bool) or not isinstance(value, int) for value in shape
    ):
        raise ValueError("NumPy volume has an invalid shape")
    if descr is None:
        raise ValueError("NumPy volume header is missing a dtype")
    if not isinstance(metadata.get("fortran_order"), bool):
        raise ValueError("NumPy volume header has an invalid fortran_order value")
    normalized_array_shape = tuple(int(value) for value in shape)
    normalized_shape, channel_count, color_mode = _volume_layout_from_array_shape(
        normalized_array_shape
    )
    _checked_voxel_count(normalized_shape)
    try:
        dtype = np.dtype(descr)
    except (TypeError, ValueError, MemoryError) as exc:
        raise ValueError("NumPy volume has an invalid dtype") from exc
    if dtype.hasobject or dtype.fields is not None or dtype.subdtype is not None:
        raise ValueError("NumPy volume must use a scalar, non-object dtype")
    if dtype.kind not in {"b", "u", "i", "f"}:
        raise ValueError("NumPy volume dtype must be real numeric or boolean")
    payload_bytes = (
        _checked_voxel_count(normalized_shape) * channel_count * int(dtype.itemsize)
    )
    _enforce_decoded_limits(
        shape=normalized_shape,
        decoded_bytes=payload_bytes,
        limits=limits,
    )
    try:
        data_offset = int(file_obj.tell())
    except (AttributeError, OSError):
        data_offset = 6 + 2 + (2 if major == 1 else 4) + header_len
    if available_bytes is not None and data_offset + payload_bytes > available_bytes:
        raise ValueError("NumPy array payload is truncated")
    return _NpyHeader(
        shape=normalized_shape,
        array_shape=normalized_array_shape,
        channel_count=channel_count,
        color_mode=color_mode,
        dtype_text=str(descr or "unknown"),
        dtype=dtype,
        data_offset=data_offset,
        payload_bytes=payload_bytes,
    )


def read_npy_header(file_obj: BinaryIO) -> tuple[tuple[int, ...], str]:
    header = _inspect_npy_header(file_obj)
    return header.array_shape, header.dtype_text


def _inspect_npz_archive(
    archive: zipfile.ZipFile, *, limits: VolumeReadLimits | None
) -> tuple[zipfile.ZipInfo, _NpyHeader]:
    members = [member for member in archive.infolist() if not member.is_dir()]
    if limits is not None and len(members) > limits.max_container_members:
        raise ValueError(
            "NumPy archive contains "
            f"{len(members)} members, exceeding the {limits.max_container_members}-member limit"
        )
    names = [member.filename for member in members]
    if len(names) != len(set(names)):
        raise ValueError("NumPy archive contains duplicate member names")
    if any(member.flag_bits & 0x1 for member in members):
        raise ValueError("Encrypted NumPy archive members are not supported")
    if limits is not None:
        total_uncompressed = sum(int(member.file_size) for member in members)
        if total_uncompressed > limits.max_decoded_bytes:
            raise ValueError(
                "NumPy archive declares "
                f"{total_uncompressed} uncompressed bytes, exceeding the "
                f"{limits.max_decoded_bytes}-byte archive limit"
            )
        if any(member.file_size > limits.max_decoded_bytes for member in members):
            raise ValueError("NumPy archive member exceeds the decoded-byte limit")

    npy_members = sorted(
        (member for member in members if member.filename.lower().endswith(".npy")),
        key=lambda member: member.filename,
    )
    if not npy_members:
        raise ValueError("NumPy .npz archive does not contain a .npy array")
    selected = npy_members[0]
    with archive.open(selected) as member:
        header = _inspect_npy_header(
            member,
            limits=limits,
            available_bytes=int(selected.file_size),
        )
    return selected, header


def load_numpy_volume(
    path: str | Path, *, limits: VolumeReadLimits | None = None
) -> VolumeInfo:
    volume_path = Path(path)
    _enforce_source_size(volume_path, limits)
    if volume_path.suffix.lower() == ".npz":
        try:
            with volume_path.open("rb") as file_obj:
                preflight_zip_archive(
                    file_obj,
                    limits=limits or REFERENCE_VOLUME_READ_LIMITS,
                )
                with zipfile.ZipFile(file_obj) as archive:
                    _member, header = _inspect_npz_archive(archive, limits=limits)
        except zipfile.BadZipFile as exc:
            raise ValueError("Invalid NumPy .npz archive") from exc
    else:
        with volume_path.open("rb") as file_obj:
            header = _inspect_npy_header(
                file_obj,
                limits=limits,
                available_bytes=volume_path.stat().st_size,
            )
    return VolumeInfo(
        format="numpy",
        shape=header.shape,
        source_files=(str(volume_path),),
        dtype=header.dtype_text,
        channel_count=header.channel_count,
        color_mode=header.color_mode,
    )


def read_numpy_volume_array(
    path: str | Path,
    *,
    limits: VolumeReadLimits,
    sample_shape: tuple[int, int, int] | None = None,
    sample_reduction: Literal["point", "maximum", "nonzero_extrema"] = "point",
    return_source_flat_indices: bool = False,
) -> np.ndarray | tuple[np.ndarray, np.ndarray]:
    """Load one preflighted scalar NumPy volume, optionally on a bounded grid.

    Plain ``.npy`` sampling uses a read-only memory map after header preflight.
    ``point`` selects an endpoint-preserving grid. ``maximum`` and
    ``nonzero_extrema`` conservatively reduce every source block so sparse
    signal is not skipped. Compressed ``.npz`` members cannot be sampled
    without first inflating the member and are therefore rejected when a
    sample is requested.
    """

    volume_path = Path(path)
    _enforce_source_size(volume_path, limits)
    try:
        if volume_path.suffix.lower() == ".npz":
            if sample_shape is not None:
                raise ValueError(
                    "Bounded NumPy sampling requires a plain .npy file; "
                    "extract the .npz member first"
                )
            with volume_path.open("rb") as file_obj:
                preflight_zip_archive(file_obj, limits=limits)
                with zipfile.ZipFile(file_obj) as archive:
                    selected, expected = _inspect_npz_archive(archive, limits=limits)
                    if expected.channel_count != 1:
                        raise ValueError(
                            "Scalar NumPy volume operations do not support RGB or RGBA volumes"
                        )
                    with archive.open(selected) as member:
                        loaded = np.lib.format.read_array(member, allow_pickle=False)
        else:
            with volume_path.open("rb") as file_obj:
                expected = _inspect_npy_header(
                    file_obj,
                    limits=limits,
                    available_bytes=volume_path.stat().st_size,
                )
            if expected.channel_count != 1:
                raise ValueError(
                    "Scalar NumPy volume operations do not support RGB or RGBA volumes"
                )
            if sample_shape is None:
                with volume_path.open("rb") as file_obj:
                    loaded = np.load(file_obj, allow_pickle=False)
            else:
                loaded = np.load(volume_path, allow_pickle=False, mmap_mode="r")
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise ValueError(
            f"Could not safely read NumPy voxel source {volume_path.name}: {exc}"
        ) from exc
    source_array = np.asarray(loaded)
    if (
        source_array.shape != expected.array_shape
        or source_array.dtype != expected.dtype
    ):
        raise ValueError("NumPy volume changed between preflight and decode")
    if sample_shape is None:
        if return_source_flat_indices:
            raise ValueError(
                "Source-index metadata is only available for bounded NumPy samples"
            )
        return source_array

    if (
        not isinstance(sample_shape, tuple)
        or len(sample_shape) != 3
        or any(
            isinstance(value, (bool, np.bool_))
            or not isinstance(value, (int, np.integer))
            for value in sample_shape
        )
    ):
        raise ValueError("NumPy sample shape must contain three positive integers")
    normalized_sample_shape = tuple(int(value) for value in sample_shape)
    if len(normalized_sample_shape) != 3 or any(
        value < 1 or value > dimension
        for value, dimension in zip(
            normalized_sample_shape, expected.shape, strict=False
        )
    ):
        raise ValueError(
            "NumPy sample shape must contain three positive dimensions no larger than the source"
        )
    if sample_reduction == "point":
        indices = tuple(
            np.rint(np.linspace(0, dimension - 1, count)).astype(np.intp)
            if count > 1
            else np.zeros(1, dtype=np.intp)
            for dimension, count in zip(
                expected.shape, normalized_sample_shape, strict=False
            )
        )
        sampled = np.ascontiguousarray(source_array[np.ix_(*indices)])
        if not return_source_flat_indices:
            return sampled
        source_flat_indices = np.ravel_multi_index(
            np.ix_(*indices),
            expected.shape,
        )
        return sampled, np.ascontiguousarray(source_flat_indices, dtype=np.int64)
    return block_reduce_volume_array(
        source_array,
        normalized_sample_shape,
        strategy=sample_reduction,
        return_source_flat_indices=return_source_flat_indices,
    )


def block_reduce_volume_array(
    source: np.ndarray,
    sample_shape: tuple[int, int, int],
    *,
    strategy: Literal["maximum", "nonzero_extrema"],
    return_source_flat_indices: bool = False,
) -> np.ndarray | tuple[np.ndarray, np.ndarray]:
    """Reduce every source voxel into a bounded, contiguous 3D grid.

    Blocks are non-overlapping and cover the complete source. ``maximum`` is
    appropriate for thresholded density fields. ``nonzero_extrema`` retains
    the value farthest from zero in each block, including negative-only signal.
    Axis reductions are ordered to keep intermediate arrays small.
    """

    array = np.asarray(source)
    if array.ndim != 3:
        raise ValueError(
            "Block-reduced NumPy sampling requires a three-dimensional array"
        )
    if strategy not in {"maximum", "nonzero_extrema"}:
        raise ValueError("Unsupported NumPy block-reduction strategy")
    if (
        not isinstance(sample_shape, tuple)
        or len(sample_shape) != 3
        or any(
            isinstance(value, (bool, np.bool_))
            or not isinstance(value, (int, np.integer))
            for value in sample_shape
        )
    ):
        raise ValueError("NumPy sample shape must contain three positive integers")
    normalized_shape = tuple(int(value) for value in sample_shape)
    if any(
        value < 1 or value > dimension
        for value, dimension in zip(normalized_shape, array.shape, strict=False)
    ):
        raise ValueError(
            "NumPy sample shape must contain three positive dimensions no larger than the source"
        )
    if np.issubdtype(array.dtype, np.complexfloating):
        raise ValueError("NumPy voxel sampling requires real-valued data")

    starts_by_axis = {
        axis: (np.arange(count, dtype=np.int64) * dimension // count).astype(np.intp)
        for axis, (dimension, count) in enumerate(
            zip(array.shape, normalized_shape, strict=False)
        )
    }
    axis_order = sorted(
        range(3),
        key=lambda axis: array.shape[axis] / normalized_shape[axis],
        reverse=True,
    )

    def reduce_with(ufunc: np.ufunc) -> np.ndarray:
        reduced = array
        for axis in axis_order:
            if reduced.shape[axis] != normalized_shape[axis]:
                reduced = ufunc.reduceat(reduced, starts_by_axis[axis], axis=axis)
        return np.asarray(reduced)

    maximum = reduce_with(np.maximum)
    if strategy == "maximum" or np.issubdtype(array.dtype, np.unsignedinteger):
        reduced = np.ascontiguousarray(maximum)
    else:
        minimum = reduce_with(np.minimum)
        choose_minimum = np.abs(minimum.astype(np.float64)) > np.abs(
            maximum.astype(np.float64)
        )
        reduced = np.ascontiguousarray(np.where(choose_minimum, minimum, maximum))
    if not return_source_flat_indices:
        return reduced
    return reduced, _selected_source_flat_indices_for_blocks(
        array,
        reduced,
        starts_by_axis=starts_by_axis,
    )


def _selected_source_flat_indices_for_blocks(
    source: np.ndarray,
    reduced: np.ndarray,
    *,
    starts_by_axis: dict[int, np.ndarray],
) -> np.ndarray:
    """Locate the first source voxel that supplied each reduced extremum.

    The endpoint-preserving grid coordinate is preferred whenever it contains
    the chosen extremum.  Flat blocks therefore retain the complete source
    extent without a second source scan.  Remaining (off-grid) extrema are
    located one z-plane at a time, so exact coordinates add only a small
    plane-sized allocation instead of an index array the size of a
    multi-gigabyte source. Remaining ties resolve to the lowest C-order index.
    """

    sample_shape = tuple(int(value) for value in reduced.shape)
    sentinel = np.iinfo(np.int64).max
    selected = np.full(math.prod(sample_shape), sentinel, dtype=np.int64)
    selected_grid = selected.reshape(sample_shape)

    endpoint_indices = tuple(
        np.clip(
            np.rint(np.linspace(0, dimension - 1, count)).astype(np.intp),
            starts,
            np.r_[starts[1:] - 1, dimension - 1],
        )
        for dimension, count, starts in zip(
            source.shape,
            sample_shape,
            (starts_by_axis[0], starts_by_axis[1], starts_by_axis[2]),
            strict=False,
        )
    )
    endpoint_grid = np.ix_(*endpoint_indices)
    endpoint_values = np.asarray(source[endpoint_grid])
    endpoint_flat_indices = np.ravel_multi_index(endpoint_grid, source.shape)
    endpoint_matches = np.equal(endpoint_values, reduced)
    selected_grid[endpoint_matches] = endpoint_flat_indices[endpoint_matches]

    assignments: list[np.ndarray] = []
    for dimension, starts in zip(
        source.shape,
        (starts_by_axis[0], starts_by_axis[1], starts_by_axis[2]),
        strict=False,
    ):
        assignments.append(
            np.searchsorted(starts, np.arange(dimension, dtype=np.intp), side="right")
            - 1
        )
    z_blocks, y_blocks, x_blocks = assignments
    source_height, source_width = int(source.shape[1]), int(source.shape[2])
    sampled_height, sampled_width = sample_shape[1], sample_shape[2]

    for z_index, z_block_value in enumerate(z_blocks):
        z_block = int(z_block_value)
        if not np.any(selected_grid[z_block] == sentinel):
            continue
        selected_for_source_plane = selected_grid[z_block][
            y_blocks[:, None], x_blocks[None, :]
        ]
        unresolved = selected_for_source_plane == sentinel
        if not np.any(unresolved):
            continue
        target = reduced[z_block][y_blocks[:, None], x_blocks[None, :]]
        matches = unresolved & np.equal(np.asarray(source[z_index]), target)
        matching_flat_in_plane = np.flatnonzero(matches)
        if not len(matching_flat_in_plane):
            continue
        source_y = matching_flat_in_plane // source_width
        source_x = matching_flat_in_plane % source_width
        sampled_flat = (
            z_block * sampled_height + y_blocks[source_y]
        ) * sampled_width + x_blocks[source_x]
        source_flat = z_index * source_height * source_width + matching_flat_in_plane
        np.minimum.at(selected, sampled_flat, source_flat)

    if np.any(selected == sentinel):
        raise ValueError(
            "Could not locate the source voxel selected by bounded NumPy sampling"
        )
    return np.ascontiguousarray(selected.reshape(sample_shape))


def load_multipage_tiff(
    path: str | Path, *, limits: VolumeReadLimits | None = None
) -> VolumeInfo:
    volume_path = Path(path)
    _enforce_source_size(volume_path, limits)
    with Image.open(volume_path) as image:
        frame_count = int(getattr(image, "n_frames", 1) or 0)
        if frame_count < 1:
            raise ValueError("TIFF volume does not contain frames")
        if limits is not None and frame_count > limits.max_container_members:
            raise ValueError(
                "TIFF contains "
                f"{frame_count} frames, exceeding the {limits.max_container_members}-member limit"
            )
        width, height = image.size
        expected_mode = image.mode
        channel_count, color_mode = _image_color_layout(image)
        shape = (frame_count, int(height), int(width))
        _enforce_decoded_limits(
            shape=shape,
            decoded_bytes=math.prod(shape)
            * channel_count
            * np.dtype(np.float64).itemsize,
            limits=limits,
        )
        for frame_index in range(frame_count):
            image.seek(frame_index)
            if image.size != (width, height):
                raise ValueError("All TIFF frames must share the same dimensions")
            if image.mode != expected_mode:
                raise ValueError("All TIFF frames must share the same pixel mode")
    return VolumeInfo(
        format="multipage_tiff",
        shape=shape,
        source_files=(str(volume_path),),
        dtype="image",
        channel_count=channel_count,
        color_mode=color_mode,
    )


def load_volume(
    path: str | Path, *, limits: VolumeReadLimits | None = None
) -> VolumeInfo:
    volume_path = Path(path)
    if volume_path.is_dir():
        return load_slice_stack(volume_path, limits=limits)
    suffix = volume_path.suffix.lower()
    if suffix in {".npy", ".npz"}:
        return load_numpy_volume(volume_path, limits=limits)
    if suffix in {".tif", ".tiff"}:
        return load_multipage_tiff(volume_path, limits=limits)
    raise ValueError(f"Unsupported volume format: {volume_path.name}")


def supported_volume_extensions() -> Iterable[str]:
    return sorted(
        extension
        for metadata in COMMON_VOLUME_FORMATS.values()
        if metadata["supported"]
        for extension in metadata["extensions"]
    )
