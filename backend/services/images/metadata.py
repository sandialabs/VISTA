"""Upload-time image/voxel metadata inspection and persistence helpers."""

from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import uuid
import zipfile
from pathlib import Path
from typing import Any, BinaryIO, Protocol

import numpy as np
from PIL import Image, ImageSequence
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from schemas import images as image_schemas
from services.errors import ServiceError, ValidationFailedError
from utils import cache_manager
from utils.serialization import to_data_instance_schema
from utils.transactions import commit_database_transaction
from utils.volume_loader import (
    REFERENCE_VOLUME_READ_LIMITS,
    VolumeReadLimits,
    _image_color_layout,
    _inspect_npy_header,
    _inspect_npz_archive,
    preflight_zip_archive,
)

VOXEL_DATA_EXTENSIONS = {".npy", ".npz", ".inspiro"}
TIFF_EXTENSIONS = {".tif", ".tiff"}
PNG_EXTENSIONS = {".png"}
SCALAR_INTENSITY_EXTENSIONS = TIFF_EXTENSIONS | PNG_EXTENSIONS
ORDINARY_IMAGE_EXTENSIONS = (
    PNG_EXTENSIONS
    | TIFF_EXTENSIONS
    | {
        ".bmp",
        ".gif",
        ".jpeg",
        ".jpg",
        ".webp",
    }
)

logger = logging.getLogger(__name__)


class UploadedFile(Protocol):
    """The parts of an uploaded file services read; FastAPI's UploadedFile fits."""

    filename: str | None
    content_type: str | None
    file: BinaryIO

    async def read(self, size: int = -1) -> bytes:
        """Read up to `size` bytes from the uploaded file."""
        ...


def upload_file_size(file: UploadedFile) -> int:
    """Return a seekable multipart file's exact size without retaining its bytes."""
    try:
        file.file.seek(0, io.SEEK_END)
        file_size = int(file.file.tell())
        if file_size < 0:
            raise ValueError("negative file size")
        return file_size
    except Exception as exc:
        raise ValueError("Unable to determine uploaded file size") from exc
    finally:
        with contextlib.suppress(Exception):
            file.file.seek(0)


def flatten_image_extrema(extrema: Any) -> list[tuple[float, float]]:
    """Normalize Pillow's per-band or single-band extrema into a range list."""
    if not isinstance(extrema, tuple):
        return []
    if len(extrema) == 2 and all(isinstance(value, (int, float)) for value in extrema):
        return [(float(extrema[0]), float(extrema[1]))]
    ranges: list[tuple[float, float]] = []
    for channel_range in extrema:
        if (
            isinstance(channel_range, tuple)
            and len(channel_range) == 2
            and all(isinstance(value, (int, float)) for value in channel_range)
        ):
            ranges.append((float(channel_range[0]), float(channel_range[1])))
    return ranges


def dtype_from_pillow_mode(image: Image.Image) -> tuple[str | None, int | None, bool]:
    """Infer (numpy dtype name, bit depth, signedness) from a Pillow image mode."""
    mode = str(image.mode or "")
    bits_per_sample = image.tag_v2.get(258) if hasattr(image, "tag_v2") else None
    if isinstance(bits_per_sample, tuple) and bits_per_sample:
        bits_per_sample = bits_per_sample[0]
    try:
        bit_depth = int(bits_per_sample) if bits_per_sample is not None else None
    except (TypeError, ValueError):
        bit_depth = None

    if mode in {"I;16", "I;16L", "I;16B", "I;16N"}:
        return "uint16", bit_depth or 16, False
    if mode == "I":
        return "int32", bit_depth or 32, True
    if mode == "F":
        return "float32", bit_depth or 32, True
    if mode in {"L", "P"}:
        return "uint8", bit_depth or 8, False
    if mode == "1":
        return "bool", 1, False
    if bit_depth and bit_depth > 8:
        return f"uint{bit_depth}", bit_depth, False
    if bit_depth:
        return f"uint{bit_depth}", bit_depth, False
    return None, None, False


def should_scan_image_intensity(
    image: Image.Image,
    *,
    frame_count: int,
    bit_depth: int | None,
) -> bool:
    """Return whether exact extrema justify decoding the image payload."""
    if frame_count > 1:
        return True
    if bit_depth is not None and bit_depth > 8:
        return True
    return len(image.getbands()) <= 1


def is_high_bit_scalar_image(image: Image.Image) -> bool:
    """Return whether an image stores scalar intensity data above 8 bits."""
    mode = str(image.mode or "")
    _pixel_dtype, bit_depth, _signed = dtype_from_pillow_mode(image)
    high_bit_mode = mode in {"I;16", "I;16L", "I;16B", "I;16N", "I", "F"}
    high_bit_tag = bit_depth and bit_depth > 8 and mode not in {"RGB", "RGBA", "CMYK"}
    return high_bit_mode or bool(high_bit_tag)


def normalize_scalar_image_to_uint8(image: Image.Image) -> Image.Image | None:
    """Rescale a high-bit scalar image to 8-bit, or return None if not applicable."""
    if not is_high_bit_scalar_image(image):
        return None
    extrema = flatten_image_extrema(image.getextrema())
    if not extrema:
        return None
    minimum = min(item[0] for item in extrema)
    maximum = max(item[1] for item in extrema)
    if maximum <= minimum:
        return Image.new("L", image.size, 0)
    scaled = image.convert("F").point(
        lambda value: ((value - minimum) * 255.0) / (maximum - minimum)
    )
    return scaled.convert("L")


def prepare_thumbnail_image(image: Image.Image) -> tuple[Image.Image, str]:
    """Return an 8-bit browser-safe image and output format for thumbnails."""
    original_format = image.format

    normalized_scalar = normalize_scalar_image_to_uint8(image)
    if normalized_scalar is not None:
        return normalized_scalar, "JPEG"

    if image.mode in ("LA", "PA"):
        return image.convert("RGBA"), "PNG"
    if image.mode == "RGBA":
        return image, "PNG"
    if image.mode == "P":
        if "transparency" in image.info:
            return image.convert("RGBA"), "PNG"
        return image.convert("RGB"), "JPEG"
    if image.mode not in ("RGB", "L"):
        return image.convert("RGB"), "JPEG"
    if original_format in ("JPEG", "PNG", "GIF", "WEBP"):
        return image, original_format
    return image, "JPEG"


def dtype_metadata_from_numpy_descr(dtype_descr: str) -> dict[str, Any]:
    """Return dtype/bit-depth metadata parsed from a NumPy dtype descriptor."""
    try:
        dtype = np.dtype(dtype_descr)
    except (TypeError, ValueError):
        return {}
    metadata: dict[str, Any] = {
        "pixel_dtype": dtype.name,
        "voxel_dtype": dtype.name,
        "bit_depth": int(dtype.itemsize * 8),
        "bits_per_sample": int(dtype.itemsize * 8),
    }
    if np.issubdtype(dtype, np.signedinteger) or np.issubdtype(dtype, np.floating):
        metadata["signed"] = True
    return metadata


def inspect_voxel_upload_metadata(
    file: UploadedFile,
    *,
    file_size: int | None = None,
    limits: VolumeReadLimits = REFERENCE_VOLUME_READ_LIMITS,
) -> dict[str, Any]:
    """Validate one voxel upload and return metadata from the same preflight."""
    filename = (file.filename or "").lower()
    if not any(filename.endswith(ext) for ext in VOXEL_DATA_EXTENSIONS):
        return {}

    try:
        file.file.seek(0)
        if file_size is not None and file_size > limits.max_source_bytes:
            raise ValueError(
                f"Volume source exceeds the {limits.max_source_bytes}-byte "
                "materialized-file limit"
            )
        if filename.endswith(".npy"):
            header = _inspect_npy_header(
                file.file,
                limits=limits,
                available_bytes=file_size,
            )
        else:
            preflight_zip_archive(
                file.file,
                limits=limits,
                available_bytes=file_size,
            )
            with zipfile.ZipFile(file.file) as archive:
                _selected, header = _inspect_npz_archive(
                    archive,
                    limits=limits,
                )
    except zipfile.BadZipFile as exc:
        raise ValidationFailedError(
            "Invalid 3D voxel data: invalid NumPy archive"
        ) from exc
    except ValueError as exc:
        detail = str(exc)
        if filename.endswith(".inspiro") and "does not contain a .npy array" in detail:
            detail = ".inspiro archive must contain at least one .npy voxel array"
        raise ValidationFailedError(f"Invalid 3D voxel data: {detail}") from exc
    finally:
        file.file.seek(0)

    metadata = dtype_metadata_from_numpy_descr(header.dtype_text)
    metadata["volume_shape"] = {
        "axial": int(header.shape[0]),
        "coronal": int(header.shape[1]),
        "sagittal": int(header.shape[2]),
    }
    metadata["channel_count"] = header.channel_count
    metadata["color_mode"] = header.color_mode
    metadata["frame_count"] = int(header.shape[0])
    metadata["load_mode"] = "volume"
    return metadata


def npy_voxel_metadata(file: UploadedFile) -> dict[str, Any]:
    """Compatibility wrapper for callers that only request voxel metadata."""
    try:
        file_size = upload_file_size(file)
        return inspect_voxel_upload_metadata(file, file_size=file_size)
    except ServiceError:
        return {}


def image_intensity_metadata_from_open_image(image: Image.Image) -> dict[str, Any]:
    """Return pixel value range and dtype metadata for an already-open image."""
    frame_ranges: list[tuple[float, float]] = []
    frame_count = max(1, int(getattr(image, "n_frames", 1) or 1))
    pixel_dtype, bit_depth, signed = dtype_from_pillow_mode(image)
    if not should_scan_image_intensity(
        image, frame_count=frame_count, bit_depth=bit_depth
    ):
        return {}

    for frame in ImageSequence.Iterator(image):
        if pixel_dtype is None or bit_depth is None:
            candidate_dtype, candidate_bit_depth, candidate_signed = (
                dtype_from_pillow_mode(frame)
            )
            pixel_dtype = pixel_dtype or candidate_dtype
            bit_depth = bit_depth or candidate_bit_depth
            signed = signed or candidate_signed
        frame_ranges.extend(flatten_image_extrema(frame.getextrema()))

    if not frame_ranges or (pixel_dtype is None and bit_depth is None):
        return {}

    minimum = min(item[0] for item in frame_ranges)
    maximum = max(item[1] for item in frame_ranges)

    def clean(value: float) -> int | float:
        return int(value) if float(value).is_integer() else value

    value_range = {"min": clean(minimum), "max": clean(maximum)}
    metadata: dict[str, Any] = {
        "pixel_value_range": value_range,
        "value_range": value_range,
        "intensity_range": value_range,
        "frame_count": frame_count,
    }
    if pixel_dtype:
        metadata["pixel_dtype"] = pixel_dtype
        metadata["voxel_dtype"] = pixel_dtype
    if bit_depth:
        metadata["bit_depth"] = bit_depth
        metadata["bits_per_sample"] = bit_depth
    if signed:
        metadata["signed"] = True
    return metadata


def image_intensity_metadata(file: UploadedFile) -> dict[str, Any]:
    """Open a scalar-intensity file and return its intensity metadata, if any."""
    filename = (file.filename or "").lower()
    if not any(filename.endswith(ext) for ext in SCALAR_INTENSITY_EXTENSIONS):
        return {}

    try:
        file.file.seek(0)
        with Image.open(file.file) as image:
            return image_intensity_metadata_from_open_image(image)
    except Exception:
        return {}
    finally:
        file.file.seek(0)


def tiff_dimensionality_metadata_from_open_image(image: Image.Image) -> dict[str, Any]:
    """Validate consistent TIFF frames and return dimensionality metadata."""
    frame_count = max(1, int(getattr(image, "n_frames", 1) or 1))
    image.seek(0)
    width, height = image.size
    expected_mode = image.mode
    expected_bands = image.getbands()
    if frame_count > 1:
        _image_color_layout(image)
    for frame_index in range(1, frame_count):
        image.seek(frame_index)
        if image.size != (width, height):
            raise ValueError("All TIFF frames must share the same dimensions")
        if image.mode != expected_mode or image.getbands() != expected_bands:
            raise ValueError("All TIFF frames must share the same pixel mode")
        _image_color_layout(image)
    image.seek(0)
    metadata: dict[str, Any] = {
        "tiff_dimensionality": "3d" if frame_count > 1 else "2d",
        "load_mode": "volume" if frame_count > 1 else "single_image",
        "frame_count": frame_count,
    }
    if frame_count > 1:
        metadata["volume_shape"] = {
            "axial": frame_count,
            "coronal": int(height),
            "sagittal": int(width),
        }
    return metadata


def image_color_metadata_from_open_image(image: Image.Image) -> dict[str, Any]:
    """Return channel count and color mode metadata for an already-open image."""
    try:
        channel_count, color_mode = _image_color_layout(image)
    except ValueError:
        channel_count = max(1, len(image.getbands()))
        color_mode = str(image.mode or "unknown").strip().lower()
    return {"channel_count": channel_count, "color_mode": color_mode}


def tiff_dimensionality_metadata(file: UploadedFile) -> dict[str, Any]:
    """Open a TIFF file and return its dimensionality metadata, if any."""
    filename = (file.filename or "").lower()
    if not (filename.endswith(".tif") or filename.endswith(".tiff")):
        return {}
    try:
        file.file.seek(0)
        with Image.open(file.file) as image:
            return tiff_dimensionality_metadata_from_open_image(image)
    except Exception:
        return {}
    finally:
        file.file.seek(0)


def inspect_tiff_dimensionality(file: UploadedFile) -> str | None:
    """Return "2d" or "3d" for a TIFF file, or None if not a TIFF."""
    filename = (file.filename or "").lower()
    if not any(filename.endswith(ext) for ext in TIFF_EXTENSIONS):
        return None

    try:
        with Image.open(file.file) as tiff:
            frame_count = max(1, int(getattr(tiff, "n_frames", 1)))
            return "3d" if frame_count > 1 else "2d"
    except Exception as exc:
        raise ValidationFailedError(f"Invalid TIFF image data: {exc}") from exc
    finally:
        file.file.seek(0)


def inspect_upload_image_metadata(
    file: UploadedFile,
    *,
    validate_ordinary_header: bool = False,
) -> dict[str, Any]:
    """Inspect PNG/TIFF metadata with a single Pillow open per upload."""
    filename = (file.filename or "").lower()
    suffix = Path(filename).suffix
    is_tiff = any(filename.endswith(ext) for ext in TIFF_EXTENSIONS)
    is_png = any(filename.endswith(ext) for ext in PNG_EXTENSIONS)
    is_ordinary_image = suffix in ORDINARY_IMAGE_EXTENSIONS
    if (
        not is_tiff
        and not is_png
        and not (validate_ordinary_header and is_ordinary_image)
    ):
        return {}

    try:
        file.file.seek(0)
        with Image.open(file.file) as image:
            metadata = (
                image_color_metadata_from_open_image(image)
                if (is_tiff or is_png)
                else {}
            )
            if is_tiff:
                metadata.update(tiff_dimensionality_metadata_from_open_image(image))
            if is_tiff or is_png:
                with contextlib.suppress(Exception):
                    metadata.update(image_intensity_metadata_from_open_image(image))
            return metadata
    except Exception as exc:
        if is_tiff:
            raise ValidationFailedError(f"Invalid TIFF image data: {exc}") from exc
        if validate_ordinary_header and is_ordinary_image:
            raise ValidationFailedError(
                "Invalid image data: the file header could not be read"
            ) from exc
        return {}
    finally:
        file.file.seek(0)


def validate_voxel_data(file: UploadedFile) -> None:
    """Raise if the uploaded voxel file fails metadata inspection."""
    file_size = upload_file_size(file)
    inspect_voxel_upload_metadata(file, file_size=file_size)


def inspect_upload_file(
    file: UploadedFile,
    *,
    validate_ordinary_header: bool = False,
    limits: VolumeReadLimits = REFERENCE_VOLUME_READ_LIMITS,
) -> tuple[dict[str, Any], int | None]:
    """Run blocking upload inspection before the object-storage stream starts."""
    try:
        file.file.seek(0, io.SEEK_END)
        file_size = file.file.tell()
        file.file.seek(0)
    except Exception:
        file_size = None

    if (
        validate_ordinary_header
        and file_size == 0
        and Path(file.filename or "").suffix.lower() in ORDINARY_IMAGE_EXTENSIONS
    ):
        raise ValidationFailedError(
            "Empty image file: at least one byte of image data is required"
        )

    metadata = inspect_upload_image_metadata(
        file,
        validate_ordinary_header=validate_ordinary_header,
    )
    metadata.update(
        inspect_voxel_upload_metadata(file, file_size=file_size, limits=limits)
    )
    return metadata, file_size


def is_volume_upload_metadata(metadata: dict[str, Any]) -> bool:
    """Return whether upload metadata describes a volume (not a single image)."""
    return metadata.get("load_mode") == "volume"


def repaired_single_frame_tiff_metadata(
    metadata: dict[str, Any],
) -> dict[str, Any] | None:
    """Return metadata with stale volume labels cleared for a single-frame TIFF.

    Returns None if the metadata does not need repair.
    """
    frame_count: int | None = None
    try:
        if metadata.get("frame_count") is not None:
            frame_count = int(metadata.get("frame_count"))
    except (TypeError, ValueError, OverflowError):
        frame_count = None

    shape = (
        metadata.get("volume_shape")
        if isinstance(metadata.get("volume_shape"), dict)
        else {}
    )
    try:
        axial_count = (
            int(shape.get("axial")) if shape.get("axial") is not None else None
        )
    except (TypeError, ValueError, OverflowError):
        axial_count = None

    is_single_frame = (
        metadata.get("tiff_dimensionality") == "2d"
        or metadata.get("load_mode") == "single_image"
        or frame_count == 1
        or (frame_count is None and axial_count == 1)
    )
    has_stale_volume_label = (
        metadata.get("tiff_dimensionality") == "3d"
        or metadata.get("load_mode") == "volume"
        or metadata.get("interpretation") == "stack_of_2d_images"
        or "volume_shape" in metadata
        or "dimensions" in metadata
    )
    if not (is_single_frame and has_stale_volume_label):
        return None

    repaired = dict(metadata)
    repaired["tiff_dimensionality"] = "2d"
    repaired["load_mode"] = "single_image"
    repaired["frame_count"] = 1
    for key in (
        "volume_shape",
        "dimensions",
        "interpretation",
        "image_count",
        "source_kind",
    ):
        repaired.pop(key, None)
    return repaired if repaired != metadata else None


async def repair_stale_single_frame_tiff_records(
    db: AsyncSession,
    images: list[models.DataInstance],
) -> bool:
    """Repair stale volume metadata on single-frame TIFF records and commit."""
    changed = False
    for image in images:
        filename = str(image.filename or "").lower()
        if not filename.endswith((".tif", ".tiff")):
            continue
        metadata = image.metadata_json if isinstance(image.metadata_json, dict) else {}
        repaired = repaired_single_frame_tiff_metadata(metadata)
        if repaired is None:
            continue
        image.metadata_json = repaired
        db.add(image)
        changed = True
    if not changed:
        return False
    try:
        await commit_database_transaction(db)
    except Exception:
        await db.rollback()
        raise
    return True


async def persist_image_metadata(
    *,
    db: AsyncSession,
    db_image: models.DataInstance,
    image_id: uuid.UUID,
    project_id: uuid.UUID,
    metadata: dict[str, Any],
) -> image_schemas.DataInstance:
    """Commit metadata with a fully materialized pre-commit response."""
    try:
        db_image.metadata_json = metadata
        await db.flush()
        await db.refresh(db_image)
        response_image = to_data_instance_schema(db_image)
        await commit_database_transaction(db)
    except asyncio.CancelledError as exc:
        if getattr(exc, "vista_commit_succeeded", False):
            cache_manager.invalidate_images(project_id, [image_id])
        else:
            await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    cache_manager.invalidate_images(project_id, [image_id])
    return response_image
