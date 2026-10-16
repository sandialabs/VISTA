"""Image decoding helpers for Analyze workflow execution."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

from utils.volume_loader import (
    REFERENCE_VOLUME_READ_LIMITS,
    _inspect_npy_header,
    _inspect_npz_archive,
    preflight_zip_archive,
)

from .contracts import WorkflowImageInput

_NUMPY_VOLUME_EXTENSIONS = (".npy", ".npz", ".inspiro")
_TIFF_EXTENSIONS = (".tif", ".tiff")
_ORDINARY_IMAGE_EXTENSIONS = (".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp")
SUPPORTED_ANALYZE_SOURCE_EXTENSIONS = frozenset(
    (*_NUMPY_VOLUME_EXTENSIONS, *_TIFF_EXTENSIONS, *_ORDINARY_IMAGE_EXTENSIONS)
)


def is_supported_analyze_source_filename(filename: str | None) -> bool:
    return (
        Path(str(filename or "")).suffix.lower() in SUPPORTED_ANALYZE_SOURCE_EXTENSIONS
    )


def decode_workflow_image(image_input: WorkflowImageInput) -> Image.Image:
    """Decode ordinary image bytes or a representative slice from a volume."""

    filename = str(image_input.filename or "").lower()
    try:
        if filename.endswith(_NUMPY_VOLUME_EXTENSIONS):
            return _decode_numpy_volume(image_input.data, filename)
        if filename.endswith(_TIFF_EXTENSIONS):
            return _decode_pillow_image(image_input.data, select_middle_frame=True)
        return _decode_pillow_image(image_input.data, select_middle_frame=False)
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError(
            f"Analyze source image '{image_input.filename}' could not be decoded"
        ) from exc


def _decode_pillow_image(payload: bytes, *, select_middle_frame: bool) -> Image.Image:
    with Image.open(io.BytesIO(payload)) as image:
        frame_count = int(getattr(image, "n_frames", 1) or 1)
        if select_middle_frame and frame_count > 1:
            image.seek(frame_count // 2)
        decoded = image.copy()
        decoded.load()
    return _pillow_image_to_rgb(decoded)


def _pillow_image_to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"I", "F", "I;16", "I;16L", "I;16B", "I;16N"}:
        return _array_to_rgb_image(np.asarray(image))
    return image.convert("RGB")


def _decode_numpy_volume(payload: bytes, filename: str) -> Image.Image:
    array = _load_numpy_array(payload, filename)
    return _array_to_rgb_image(_central_slice(array))


def _load_numpy_array(payload: bytes, filename: str) -> np.ndarray:
    limits = REFERENCE_VOLUME_READ_LIMITS
    if len(payload) > limits.max_source_bytes:
        raise ValueError(
            "Analyze volume source exceeds the configured/built-in "
            f"{limits.max_source_bytes}-byte materialized-file limit"
        )
    if filename.endswith(".npy"):
        source = io.BytesIO(payload)
        expected = _inspect_npy_header(
            source,
            limits=limits,
            available_bytes=len(payload),
        )
        source.seek(0)
        loaded = np.lib.format.read_array(source, allow_pickle=False)
    else:
        source = io.BytesIO(payload)
        preflight_zip_archive(
            source,
            limits=limits,
            available_bytes=len(payload),
        )
        with zipfile.ZipFile(source) as archive:
            selected, expected = _inspect_npz_archive(archive, limits=limits)
            with archive.open(selected) as member:
                loaded = np.lib.format.read_array(member, allow_pickle=False)
    array = np.asarray(loaded)
    if array.shape != expected.array_shape or array.dtype != expected.dtype:
        raise ValueError("Analyze volume changed between preflight and decode")
    return array


def _central_slice(array: np.ndarray) -> np.ndarray:
    if array.ndim == 2:
        return array
    if array.ndim == 3:
        return array[array.shape[0] // 2]
    if array.ndim == 4 and array.shape[-1] in {3, 4}:
        return array[array.shape[0] // 2]
    raise ValueError(
        "Analyze volume must have shape [z, y, x], [z, y, x, 3], "
        "[z, y, x, 4], or a two-dimensional slice"
    )


def _array_to_rgb_image(array: np.ndarray) -> Image.Image:
    normalized = _normalize_to_uint8(np.asarray(array))
    if normalized.ndim == 2:
        return Image.fromarray(normalized, mode="L").convert("RGB")
    if normalized.ndim == 3 and normalized.shape[-1] in {3, 4}:
        mode = "RGBA" if normalized.shape[-1] == 4 else "RGB"
        return Image.fromarray(normalized, mode=mode).convert("RGB")
    if normalized.ndim == 3 and normalized.shape[-1] == 1:
        return Image.fromarray(normalized[:, :, 0], mode="L").convert("RGB")
    raise ValueError("Analyze slice must be scalar, RGB, or RGBA")


def _normalize_to_uint8(array: np.ndarray) -> np.ndarray:
    if array.dtype == np.uint8:
        return np.ascontiguousarray(array)
    if np.issubdtype(array.dtype, np.bool_):
        return np.ascontiguousarray(array.astype(np.uint8) * 255)
    numeric = np.asarray(array, dtype=np.float64)
    finite = np.isfinite(numeric)
    if not finite.any():
        return np.zeros(array.shape, dtype=np.uint8)
    minimum = float(numeric[finite].min())
    maximum = float(numeric[finite].max())
    if maximum <= minimum:
        fill = 255 if maximum > 0 else 0
        return np.full(array.shape, fill, dtype=np.uint8)
    scaled = ((numeric - minimum) * 255.0) / (maximum - minimum)
    scaled = np.where(finite, scaled, 0.0)
    return np.ascontiguousarray(np.clip(scaled, 0, 255).astype(np.uint8))
