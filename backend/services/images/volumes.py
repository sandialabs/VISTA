"""Image volume helper services."""

from __future__ import annotations

import asyncio
import io
import math
import threading
import zipfile
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories import inspection as inspection_repository
from schemas import inspection_parts as inspection_part_schemas
from schemas import users as user_schemas
from services.errors import CapacityError
from services.images import metadata as image_metadata_service
from services.images.storage_limits import ProcessWideStorageLimiter
from services.images.volume_rendering import (
    normalize_array_slice_to_png,
    summarize_rgba_volume_for_rendering,
)
from utils.metadata_values import parse_metadata_boolean
from utils.volume_loader import (
    REFERENCE_VOLUME_READ_LIMITS,
    VolumeReadLimits,
    _image_color_layout,
    _inspect_npy_header,
    _inspect_npz_archive,
    preflight_zip_archive,
)

VOLUME_SLICE_CACHE_MAX_ITEMS = 256
volume_slice_png_cache: "OrderedDict[tuple[str, str, int, str], bytes]" = OrderedDict()
volume_slice_png_cache_lock = threading.RLock()
volume_slice_render_futures: dict[tuple[str, str, int, str], Future[bytes]] = {}

VOLUME_RENDER_SUMMARY_CACHE_MAX_ITEMS = 128
VOLUME_RENDER_SUMMARY_SCAN_CONCURRENCY = 2
process_volume_render_summary_scan_limiter = ProcessWideStorageLimiter(
    VOLUME_RENDER_SUMMARY_SCAN_CONCURRENCY
)
volume_render_summary_cache: "OrderedDict[tuple[str, str, int], dict[str, Any]]" = (
    OrderedDict()
)
volume_render_summary_cache_lock = threading.RLock()
volume_render_summary_futures: dict[tuple[str, str, int], Future[dict[str, Any]]] = {}

VOLUME_CONNECTED_SELECTION_CONCURRENCY = 2
VOLUME_CONNECTED_SELECTION_DECODE_CONCURRENCY = 1
VOLUME_CONNECTED_SELECTION_MAX_SOURCE_BYTES = 128 * 1024 * 1024
VOLUME_CONNECTED_SELECTION_MAX_VOXELS = 32 * 1024 * 1024
VOLUME_CONNECTED_SELECTION_MAX_DECODED_BYTES = 256 * 1024 * 1024
process_volume_connected_selection_semaphore = threading.BoundedSemaphore(
    VOLUME_CONNECTED_SELECTION_CONCURRENCY
)
process_volume_connected_selection_decode_semaphore = threading.BoundedSemaphore(
    VOLUME_CONNECTED_SELECTION_DECODE_CONCURRENCY
)
volume_connected_selection_executor = ThreadPoolExecutor(
    max_workers=VOLUME_CONNECTED_SELECTION_CONCURRENCY,
    thread_name_prefix="vista-volume-connected",
)


class VolumeConnectedSelectionCapacityError(CapacityError, RuntimeError):
    """Raised when process-local connected-selection capacity is unavailable."""


class VolumeConnectedSelectionLease:
    """Keep one admission permit until its submitted worker truly finishes."""

    def __init__(self, semaphore: threading.BoundedSemaphore) -> None:
        """Hold the admission permit for `semaphore` until released."""
        self._semaphore = semaphore
        self._release_on_exit = True

    def release_when_done(self, worker_future: Future[Any]) -> None:
        """Transfer release ownership to `worker_future`'s completion."""
        if not self._release_on_exit:
            raise RuntimeError(
                "volume connected-selection lease was already transferred"
            )
        self._release_on_exit = False
        worker_future.add_done_callback(lambda _future: self._semaphore.release())

    def release_if_owned(self) -> None:
        """Release the permit now if ownership was never transferred."""
        if self._release_on_exit:
            self._release_on_exit = False
            self._semaphore.release()


def get_cached_volume_slice_png(
    cache_key: tuple[str, str, int, str],
) -> bytes | None:
    """Return a cached rendered PNG slice and refresh LRU order."""
    with volume_slice_png_cache_lock:
        cached = volume_slice_png_cache.get(cache_key)
        if cached is not None:
            volume_slice_png_cache.move_to_end(cache_key)
        return cached


def set_cached_volume_slice_png(
    cache_key: tuple[str, str, int, str], png: bytes
) -> None:
    """Cache a rendered PNG slice, pruning older entries by LRU order."""
    with volume_slice_png_cache_lock:
        volume_slice_png_cache[cache_key] = png
        volume_slice_png_cache.move_to_end(cache_key)
        while len(volume_slice_png_cache) > VOLUME_SLICE_CACHE_MAX_ITEMS:
            volume_slice_png_cache.popitem(last=False)


async def get_or_render_volume_slice_png(
    cache_key: tuple[str, str, int, str],
    array: np.ndarray,
) -> bytes:
    """Coalesce one in-flight render per slice without serializing other keys."""
    with volume_slice_png_cache_lock:
        cached = volume_slice_png_cache.get(cache_key)
        if cached is not None:
            volume_slice_png_cache.move_to_end(cache_key)
            return cached
        render_future = volume_slice_render_futures.get(cache_key)
        owns_render = render_future is None
        if owns_render:
            render_future = Future()
            volume_slice_render_futures[cache_key] = render_future

    if not owns_render:
        return await asyncio.shield(asyncio.wrap_future(render_future))

    try:
        png = await asyncio.to_thread(normalize_array_slice_to_png, array)
        set_cached_volume_slice_png(cache_key, png)
        render_future.set_result(png)
        return png
    except BaseException as exc:
        render_future.set_exception(exc)
        raise
    finally:
        with volume_slice_png_cache_lock:
            if volume_slice_render_futures.get(cache_key) is render_future:
                volume_slice_render_futures.pop(cache_key, None)


async def get_or_compute_volume_render_summary(
    cache_key: tuple[str, str, int],
    array: np.ndarray,
) -> dict[str, Any]:
    """Coalesce and cache the optional sparse-volume renderer summary."""
    with volume_render_summary_cache_lock:
        cached = volume_render_summary_cache.get(cache_key)
        if cached is not None:
            volume_render_summary_cache.move_to_end(cache_key)
            return cached
        summary_future = volume_render_summary_futures.get(cache_key)
        owns_summary = summary_future is None
        if owns_summary:
            summary_future = Future()
            volume_render_summary_futures[cache_key] = summary_future

    if not owns_summary:
        return await asyncio.shield(asyncio.wrap_future(summary_future))

    try:
        async with process_volume_render_summary_scan_limiter.slot():
            summary = await asyncio.to_thread(
                summarize_rgba_volume_for_rendering, array
            )
        with volume_render_summary_cache_lock:
            volume_render_summary_cache[cache_key] = summary
            volume_render_summary_cache.move_to_end(cache_key)
            while (
                len(volume_render_summary_cache) > VOLUME_RENDER_SUMMARY_CACHE_MAX_ITEMS
            ):
                volume_render_summary_cache.popitem(last=False)
        summary_future.set_result(summary)
        return summary
    except BaseException as exc:
        summary_future.set_exception(exc)
        raise
    finally:
        with volume_render_summary_cache_lock:
            if volume_render_summary_futures.get(cache_key) is summary_future:
                volume_render_summary_futures.pop(cache_key, None)


@asynccontextmanager
async def volume_connected_selection_slot():
    """Reject excess flood-fill work instead of building an unbounded queue."""
    active_semaphore = process_volume_connected_selection_semaphore
    acquired = active_semaphore.acquire(blocking=False)
    if not acquired:
        raise VolumeConnectedSelectionCapacityError(
            "Volume connected-selection capacity is busy; retry shortly"
        )
    lease = VolumeConnectedSelectionLease(active_semaphore)
    try:
        yield lease
    finally:
        lease.release_if_owned()


@asynccontextmanager
async def volume_connected_selection_decode_slot():
    """Allow only one materialized TIFF/NPZ decode per process."""
    active_semaphore = process_volume_connected_selection_decode_semaphore
    acquired = active_semaphore.acquire(blocking=False)
    if not acquired:
        raise VolumeConnectedSelectionCapacityError(
            "Volume connected-selection decode capacity is busy; retry shortly"
        )
    lease = VolumeConnectedSelectionLease(active_semaphore)
    try:
        yield lease
    finally:
        lease.release_if_owned()


@asynccontextmanager
async def volume_connected_selection_materialization_slot(kind: str):
    """Gate non-NPY connected-selection source materialization."""
    if kind == "npy":
        yield None
        return
    async with volume_connected_selection_decode_slot() as lease:
        yield lease


def volume_connected_selection_read_limits() -> VolumeReadLimits:
    """Return endpoint-local limits without changing shared volume readers."""
    return VolumeReadLimits(
        max_voxels=VOLUME_CONNECTED_SELECTION_MAX_VOXELS,
        max_decoded_bytes=VOLUME_CONNECTED_SELECTION_MAX_DECODED_BYTES,
        max_source_bytes=VOLUME_CONNECTED_SELECTION_MAX_SOURCE_BYTES,
        max_container_members=REFERENCE_VOLUME_READ_LIMITS.max_container_members,
    )


def volume_source_kind(filename: str) -> str | None:
    """Return the supported volume source kind for a filename."""
    lower = filename.lower()
    if lower.endswith(".npy"):
        return "npy"
    if lower.endswith(".npz"):
        return "npz"
    if lower.endswith(".inspiro"):
        return "inspiro"
    if lower.endswith((".tif", ".tiff")):
        return "tiff"
    return None


def volume_meta_from_shape(
    shape: tuple[int, ...], dtype: np.dtype, *, source_kind: str
) -> dict[str, Any]:
    """Build shared API metadata for supported volume array layouts."""
    if len(shape) == 3:
        spatial_shape = shape
        channel_count = 1
        color_mode = "scalar"
    elif len(shape) == 4 and shape[-1] in {3, 4}:
        spatial_shape = shape[:3]
        channel_count = int(shape[-1])
        color_mode = "rgb" if channel_count == 3 else "rgba"
    else:
        raise ValueError("Image is not a multi-image volume")
    depth, height, width = (int(value) for value in spatial_shape)
    return {
        "source_kind": source_kind,
        "interpretation": "stack_of_2d_images"
        if source_kind == "tiff" and depth > 1
        else "voxel_array",
        "image_count": depth,
        "height": height,
        "width": width,
        "dimensions": {"axial": depth, "coronal": height, "sagittal": width},
        "pixel_dtype": np.dtype(dtype).name,
        "voxel_dtype": np.dtype(dtype).name,
        "bit_depth": int(np.dtype(dtype).itemsize * 8),
        "channel_count": channel_count,
        "color_mode": color_mode,
    }


def load_numpy_volume(
    payload: bytes,
    filename: str,
    *,
    limits: VolumeReadLimits | None = None,
) -> np.ndarray:
    """Decode a bounded NPY or NPZ volume after validating its header."""
    active_limits = limits or REFERENCE_VOLUME_READ_LIMITS
    if len(payload) > active_limits.max_source_bytes:
        raise ValueError(
            "NumPy volume source exceeds the configured/built-in "
            f"{active_limits.max_source_bytes}-byte materialized-file limit"
        )
    lower = filename.lower()
    if lower.endswith(".npy"):
        source = io.BytesIO(payload)
        expected = _inspect_npy_header(
            source,
            limits=active_limits,
            available_bytes=len(payload),
        )
        source.seek(0)
        loaded = np.lib.format.read_array(source, allow_pickle=False)
        array = np.asarray(loaded)
        if array.shape != expected.array_shape or array.dtype != expected.dtype:
            raise ValueError("NumPy volume changed between preflight and decode")
        return array
    source = io.BytesIO(payload)
    preflight_zip_archive(
        source,
        limits=active_limits,
        available_bytes=len(payload),
    )
    with zipfile.ZipFile(source) as archive:
        selected, expected = _inspect_npz_archive(archive, limits=active_limits)
        with archive.open(selected) as member:
            loaded = np.lib.format.read_array(member, allow_pickle=False)
    array = np.asarray(loaded)
    if array.shape != expected.array_shape or array.dtype != expected.dtype:
        raise ValueError("NumPy volume changed between preflight and decode")
    return array


def load_tiff_volume(
    payload: bytes,
    *,
    limits: VolumeReadLimits | None = None,
) -> np.ndarray:
    """Decode a bounded multi-frame TIFF volume."""
    active_limits = limits or REFERENCE_VOLUME_READ_LIMITS
    if len(payload) > active_limits.max_source_bytes:
        raise ValueError(
            "TIFF source exceeds the configured/built-in "
            f"{active_limits.max_source_bytes}-byte materialized-file limit"
        )
    with Image.open(io.BytesIO(payload)) as image:
        frame_count = int(getattr(image, "n_frames", 1) or 0)
        if frame_count < 1:
            raise ValueError("TIFF has no frames")
        if frame_count > active_limits.max_container_members:
            raise ValueError(
                f"TIFF contains {frame_count} frames, exceeding the "
                "configured/built-in "
                f"{active_limits.max_container_members}-member limit"
            )
        image.seek(0)
        width, height = image.size
        expected_mode = image.mode
        expected_bands = image.getbands()
        band_count, _color_mode = _image_color_layout(image)
        voxel_count = frame_count * int(height) * int(width)
        if voxel_count > active_limits.max_voxels:
            raise ValueError(
                f"TIFF declares {voxel_count} voxels, exceeding the "
                f"configured/built-in {active_limits.max_voxels}-voxel limit"
            )
        decoded_bytes = voxel_count * band_count * np.dtype(np.float64).itemsize
        if decoded_bytes > active_limits.max_decoded_bytes:
            raise ValueError(
                f"TIFF declares {decoded_bytes} decoded bytes, exceeding the "
                f"configured/built-in {active_limits.max_decoded_bytes}-byte limit"
            )

        for frame_index in range(1, frame_count):
            image.seek(frame_index)
            if image.size != (width, height):
                raise ValueError("All TIFF frames must share the same dimensions")
            if image.mode != expected_mode or image.getbands() != expected_bands:
                raise ValueError("All TIFF frames must share the same pixel mode")

        image.seek(0)
        first_frame = np.asarray(image.copy())
        volume = np.empty((frame_count, *first_frame.shape), dtype=first_frame.dtype)
        volume[0] = first_frame
        for frame_index in range(1, frame_count):
            image.seek(frame_index)
            frame = np.asarray(image.copy())
            if frame.shape != first_frame.shape or frame.dtype != first_frame.dtype:
                raise ValueError("All TIFF frames must share the same shape and dtype")
            volume[frame_index] = frame
    return volume


def validated_npy_shape_dtype(
    shape: tuple[int, ...],
    dtype: np.dtype,
    *,
    limits: VolumeReadLimits | None = None,
) -> tuple[tuple[int, int, int], np.dtype, int, str]:
    """Validate persisted or probed NPY shape/dtype metadata."""
    if len(shape) == 3:
        spatial_shape = shape
        channel_count = 1
        color_mode = "scalar"
    elif len(shape) == 4 and shape[-1] in {3, 4}:
        spatial_shape = shape[:3]
        channel_count = int(shape[-1])
        color_mode = "rgb" if channel_count == 3 else "rgba"
    else:
        raise ValueError(
            "NumPy volume must be scalar [z, y, x], "
            "RGB [z, y, x, 3], or RGBA [z, y, x, 4]"
        )
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0
        for value in spatial_shape
    ):
        raise ValueError("NumPy volume dimensions must be positive integers")
    safe_dtype = np.dtype(dtype)
    if (
        safe_dtype.hasobject
        or safe_dtype.fields is not None
        or safe_dtype.subdtype is not None
        or safe_dtype.kind not in {"b", "u", "i", "f"}
    ):
        raise ValueError("NumPy volume must use a scalar real numeric or boolean dtype")
    safe_shape = tuple(int(value) for value in spatial_shape)
    voxel_count = math.prod(safe_shape)
    decoded_bytes = voxel_count * channel_count * int(safe_dtype.itemsize)
    active_limits = limits or REFERENCE_VOLUME_READ_LIMITS
    if voxel_count > active_limits.max_voxels:
        raise ValueError(
            f"NumPy volume exceeds the {active_limits.max_voxels}-voxel limit"
        )
    if decoded_bytes > active_limits.max_decoded_bytes:
        raise ValueError(
            f"NumPy volume exceeds the "
            f"{active_limits.max_decoded_bytes}-byte decoded limit"
        )
    return safe_shape, safe_dtype, channel_count, color_mode


def persisted_npy_volume_meta(
    metadata: dict[str, Any],
    *,
    limits: VolumeReadLimits | None = None,
) -> dict[str, Any] | None:
    """Return trusted persisted NPY volume metadata, or None when stale/partial."""
    shape = metadata.get("volume_shape")
    if not isinstance(shape, dict):
        return None
    dimensions = []
    for axis in ("axial", "coronal", "sagittal"):
        value = shape.get(axis)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            return None
        dimensions.append(value)
    dtype_text = metadata.get("voxel_dtype") or metadata.get("pixel_dtype")
    if not dtype_text:
        return None
    persisted_channel_count = metadata.get("channel_count")
    persisted_color_mode = metadata.get("color_mode")
    if persisted_channel_count is None and persisted_color_mode is None:
        return None
    valid_layouts = {(1, "scalar"), (3, "rgb"), (4, "rgba")}
    if (persisted_channel_count, persisted_color_mode) not in valid_layouts:
        return None
    try:
        dtype = np.dtype(dtype_text)
        array_shape = tuple(dimensions) + (
            (int(persisted_channel_count),) if persisted_channel_count != 1 else ()
        )
        safe_shape, dtype, channel_count, color_mode = validated_npy_shape_dtype(
            array_shape,
            dtype,
            limits=limits,
        )
    except (TypeError, ValueError):
        return None
    meta = volume_meta_from_shape(
        safe_shape + ((channel_count,) if channel_count != 1 else ()),
        dtype,
        source_kind="npy",
    )
    if meta["color_mode"] != color_mode:
        return None
    return meta


def dtype_from_persisted_volume_metadata(metadata: dict[str, Any]) -> np.dtype:
    """Infer a NumPy dtype from persisted volume metadata."""
    dtype_text = (
        metadata.get("voxel_dtype")
        or metadata.get("pixel_dtype")
        or metadata.get("dtype")
    )
    if dtype_text:
        try:
            return np.dtype(dtype_text)
        except (TypeError, ValueError):
            pass
    try:
        bit_depth = int(
            metadata.get("bit_depth") or metadata.get("bits_per_sample") or 8
        )
    except (TypeError, ValueError, OverflowError):
        bit_depth = 8
    bit_depth = max(1, min(bit_depth, 64))
    if bit_depth <= 8:
        width = 8
    elif bit_depth <= 16:
        width = 16
    elif bit_depth <= 32:
        width = 32
    else:
        width = 64
    prefix = "int" if metadata.get("signed") is True else "uint"
    return np.dtype(f"{prefix}{width}")


def persisted_tiff_volume_meta(
    metadata: dict[str, Any],
    *,
    limits: VolumeReadLimits | None = None,
) -> dict[str, Any] | None:
    """Return trusted persisted TIFF volume metadata, or None when stale/partial."""
    try:
        frame_count = int(metadata.get("frame_count") or 0)
    except (TypeError, ValueError, OverflowError):
        frame_count = 0
    if not (
        metadata.get("load_mode") == "volume"
        or metadata.get("tiff_dimensionality") == "3d"
        or frame_count > 1
    ):
        return None
    shape = metadata.get("volume_shape")
    if not isinstance(shape, dict):
        return None
    dimensions = []
    for axis in ("axial", "coronal", "sagittal"):
        value = shape.get(axis)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            return None
        dimensions.append(value)
    valid_layouts = {(1, "scalar"), (3, "rgb"), (4, "rgba")}
    raw_channel_count = metadata.get("channel_count")
    raw_color_mode = metadata.get("color_mode")
    if raw_channel_count is None and raw_color_mode is None:
        channel_count, color_mode = 1, "scalar"
    elif raw_channel_count is None:
        color_mode = str(raw_color_mode or "").strip().lower()
        channel_count = {"scalar": 1, "rgb": 3, "rgba": 4}.get(color_mode)
    elif raw_color_mode is None:
        try:
            channel_count = int(raw_channel_count)
        except (TypeError, ValueError, OverflowError):
            return None
        color_mode = {1: "scalar", 3: "rgb", 4: "rgba"}.get(channel_count)
    else:
        try:
            channel_count = int(raw_channel_count)
        except (TypeError, ValueError, OverflowError):
            return None
        color_mode = str(raw_color_mode or "").strip().lower()
    if (channel_count, color_mode) not in valid_layouts:
        return None
    dtype = dtype_from_persisted_volume_metadata(metadata)
    spatial_shape = tuple(int(value) for value in dimensions)
    voxel_count = math.prod(spatial_shape)
    active_limits = limits or REFERENCE_VOLUME_READ_LIMITS
    decoded_bytes = voxel_count * int(channel_count) * np.dtype(np.float64).itemsize
    if (
        voxel_count > active_limits.max_voxels
        or decoded_bytes > active_limits.max_decoded_bytes
    ):
        return None
    array_shape = spatial_shape + ((channel_count,) if channel_count != 1 else ())
    return volume_meta_from_shape(array_shape, dtype, source_kind="tiff")


def part_name_for_volume_filename(filename: str) -> str:
    """Return the default inspection-part name for a volume upload filename."""
    trimmed_filename = filename.strip()
    lower_filename = trimmed_filename.lower()
    if lower_filename.endswith(".nii.gz"):
        return trimmed_filename[: -len(".nii.gz")]
    return Path(trimmed_filename).stem


def source_image_entry_from_data_instance(
    image: models.DataInstance,
) -> dict[str, Any]:
    """Build an inspection source-image metadata entry from an image row."""
    image_metadata = (
        image.metadata_json if isinstance(image.metadata_json, dict) else {}
    )
    entry: dict[str, Any] = {
        "filename": image.filename,
        "image_id": str(image.id),
        "side": str(image_metadata.get("side") or "").strip().lower(),
        "modality": str(image_metadata.get("modality") or "").strip().lower(),
        "overlay": parse_metadata_boolean(image_metadata.get("overlay")),
        "slice_axis": image_metadata.get("slice_axis"),
        "slice_index": image_metadata.get("slice_index"),
    }
    volume_keys = (
        "load_mode",
        "tiff_dimensionality",
        "frame_count",
        "volume_shape",
        "pixel_dtype",
        "voxel_dtype",
        "bit_depth",
        "bits_per_sample",
        "pixel_value_range",
        "data_value_range",
        "voxel_value_range",
        "scalar_range",
        "value_range",
        "intensity_range",
        "display_range",
        "signed",
        "channel_count",
        "color_mode",
    )
    for key in volume_keys:
        if key in image_metadata:
            entry[key] = image_metadata[key]
    entry["metadata"] = {
        key: image_metadata[key] for key in volume_keys if key in image_metadata
    }
    return entry


async def autoassign_pt3_volume_upload_to_part(
    *,
    db: AsyncSession,
    project: models.Project,
    image: models.DataInstance,
    current_user: user_schemas.User,
    commit: bool = True,
) -> None:
    """Attach a PT3 volume upload to a default inspection part."""
    image_metadata = (
        image.metadata_json if isinstance(image.metadata_json, dict) else {}
    )
    if (
        project.project_type != "PT3"
        or not image_metadata_service.is_volume_upload_metadata(image_metadata)
    ):
        return

    filename = (image.filename or "").strip()
    if not filename:
        return

    part_name = part_name_for_volume_filename(filename)
    if not part_name:
        return

    existing_parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project.id
    )
    existing_part = next(
        (part for part in existing_parts if part.serial_number == part_name), None
    )
    source_entry = source_image_entry_from_data_instance(image)

    if existing_part is None:
        await inspection_repository.create_inspection_part(
            db=db,
            project_id=project.id,
            part=inspection_part_schemas.InspectionPartCreate(
                serial_number=part_name,
                display_name=part_name,
                metadata={"source_images": [source_entry]},
            ),
            created_by=current_user.email,
            commit=commit,
        )
        return

    metadata = (
        existing_part.metadata_json
        if isinstance(existing_part.metadata_json, dict)
        else {}
    )
    source_images = (
        metadata.get("source_images")
        if isinstance(metadata.get("source_images"), list)
        else []
    )
    source_images = [
        record
        for record in source_images
        if not (
            isinstance(record, dict)
            and str(record.get("image_id") or "").strip() == str(image.id)
        )
    ]
    source_images.append(source_entry)
    await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project.id,
        part_id=existing_part.id,
        metadata_patch={**metadata, "source_images": source_images},
        updated_by=current_user.email,
        commit=commit,
    )
