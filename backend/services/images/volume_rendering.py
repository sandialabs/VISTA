"""Volume rendering and connected-selection helpers."""

from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image

VOLUME_RENDER_SUMMARY_VERSION = 1
VOLUME_RENDER_SUMMARY_SCAN_MAX_PIXELS = 256 * 1024
SEGMENT_CHANNEL_PALETTE = np.asarray(
    [
        (239, 68, 68),
        (34, 197, 94),
        (59, 130, 246),
        (245, 158, 11),
    ],
    dtype=np.uint16,
)
SEGMENT_CHANNEL_ALPHA = np.uint8(224)
RGBA_SEGMENT_SLICE_MAX_CHUNK_PIXELS = 256 * 1024


def summarize_rgba_volume_for_rendering(
    array: np.ndarray,
) -> dict[str, Any]:
    """Find a bounded set of axial slices that represent active RGBA channels."""
    summary_version = VOLUME_RENDER_SUMMARY_VERSION
    max_chunk_pixels = VOLUME_RENDER_SUMMARY_SCAN_MAX_PIXELS
    volume = np.asarray(array)
    if volume.ndim != 4 or volume.shape[-1] != 4:
        return {
            "summary_version": summary_version,
            "kind": "unsupported-layout",
            "active_channels": [],
            "channel_representatives": [],
            "representative_axial_indices": [],
        }
    if not (
        np.issubdtype(volume.dtype, np.bool_)
        or np.issubdtype(volume.dtype, np.integer)
        or np.issubdtype(volume.dtype, np.floating)
    ):
        return {
            "summary_version": summary_version,
            "kind": "unsupported-layout",
            "active_channels": [],
            "channel_representatives": [],
            "representative_axial_indices": [],
        }

    depth, height, width, _channels = (int(value) for value in volume.shape)
    representative_by_channel: dict[int, int] = {}
    for axial_index in range(depth):
        plane = volume[axial_index]
        if width <= max_chunk_pixels:
            rows_per_chunk = max(1, max_chunk_pixels // max(1, width))
            chunks = (
                plane[row_start : row_start + rows_per_chunk, :, :]
                for row_start in range(0, height, rows_per_chunk)
            )
        else:
            chunks = (
                plane[
                    row_index : row_index + 1,
                    column_start : column_start + max_chunk_pixels,
                    :,
                ]
                for row_index in range(height)
                for column_start in range(0, width, max_chunk_pixels)
            )
        for chunk in chunks:
            active_channels = np.any(np.asarray(chunk) != 0, axis=(0, 1))
            for channel_index in np.flatnonzero(active_channels):
                representative_by_channel.setdefault(int(channel_index), axial_index)
            if len(representative_by_channel) == 4:
                break
        if len(representative_by_channel) == 4:
            break

    channel_representatives = [
        {
            "channel": channel_index,
            "axial_index": representative_by_channel[channel_index],
        }
        for channel_index in sorted(representative_by_channel)
    ]
    return {
        "summary_version": summary_version,
        "kind": "rgba-channel-presence",
        "active_channels": [entry["channel"] for entry in channel_representatives],
        "channel_representatives": channel_representatives,
        "representative_axial_indices": sorted(
            {entry["axial_index"] for entry in channel_representatives}
        ),
    }


def iter_rgba_pixel_chunks(
    array: np.ndarray,
    max_chunk_pixels: int | None = None,
):
    """Yield spatially-addressed RGBA views capped to a pixel budget."""
    arr = np.asarray(array)
    if arr.ndim != 3 or arr.shape[-1] != 4:
        raise ValueError("RGBA chunks require a channel-last four-channel array")

    pixel_limit = int(
        RGBA_SEGMENT_SLICE_MAX_CHUNK_PIXELS
        if max_chunk_pixels is None
        else max_chunk_pixels
    )
    if pixel_limit <= 0:
        raise ValueError("RGBA chunk pixel limit must be positive")

    height, width, _channels = (int(value) for value in arr.shape)
    if height == 0 or width == 0:
        return

    if width <= pixel_limit:
        rows_per_chunk = max(1, pixel_limit // width)
        for row_start in range(0, height, rows_per_chunk):
            row_stop = min(height, row_start + rows_per_chunk)
            yield (
                slice(row_start, row_stop),
                slice(0, width),
                arr[row_start:row_stop, :, :],
            )
        return

    for row_index in range(height):
        for column_start in range(0, width, pixel_limit):
            column_stop = min(width, column_start + pixel_limit)
            yield (
                slice(row_index, row_index + 1),
                slice(column_start, column_stop),
                arr[row_index : row_index + 1, column_start:column_stop, :],
            )


def is_binary_segment_channel_slice(array: np.ndarray) -> bool:
    """Identify four independent segment channels masquerading as literal RGBA."""
    arr = np.asarray(array)
    if arr.ndim != 3 or arr.shape[-1] != 4 or arr.size == 0:
        return False
    if np.issubdtype(arr.dtype, np.bool_):
        return True
    if not (
        np.issubdtype(arr.dtype, np.integer) or np.issubdtype(arr.dtype, np.floating)
    ):
        return False
    is_float = np.issubdtype(arr.dtype, np.floating)
    is_zero_or_one = True
    is_zero_or_255 = True
    is_one_hot_255 = True
    has_active_255 = False

    for _rows, _columns, chunk in iter_rgba_pixel_chunks(arr):
        if is_float and not np.all(np.isfinite(chunk)):
            return False

        if is_zero_or_one:
            is_zero_or_one = bool(np.all((chunk == 0) | (chunk == 1)))

        if is_zero_or_255:
            chunk_is_zero_or_255 = bool(np.all((chunk == 0) | (chunk == 255)))
            if not chunk_is_zero_or_255:
                is_zero_or_255 = False
            else:
                active = chunk != 0
                has_active_255 = has_active_255 or bool(np.any(active))
                if is_one_hot_255:
                    is_one_hot_255 = bool(
                        np.all(np.count_nonzero(active, axis=-1) <= 1)
                    )

        if not is_zero_or_one and (not is_zero_or_255 or not is_one_hot_255):
            return False

    if is_zero_or_one:
        return True
    return is_zero_or_255 and is_one_hot_255 and has_active_255


def render_binary_segment_channels(array: np.ndarray) -> np.ndarray:
    """Map four segment channels to visible RGBA, including channel index 3."""
    arr = np.asarray(array)
    if arr.ndim != 3 or arr.shape[-1] != 4:
        raise ValueError("Segment channels require a channel-last RGBA array")

    rendered = np.zeros(arr.shape, dtype=np.uint8)
    for rows, columns, chunk in iter_rgba_pixel_chunks(arr):
        active = chunk != 0
        weights = active.astype(np.uint16)
        active_counts = np.sum(weights, axis=-1, dtype=np.uint16)
        color_sums = weights @ SEGMENT_CHANNEL_PALETTE
        divisors = np.maximum(active_counts, 1)[..., np.newaxis]
        target = rendered[rows, columns, :]
        target[..., :3] = ((color_sums + (divisors // 2)) // divisors).astype(np.uint8)
        target[..., 3] = np.where(active_counts > 0, SEGMENT_CHANNEL_ALPHA, 0)
    return rendered


def scale_array_to_uint8(array: np.ndarray) -> np.ndarray:
    """Scale scalar array values to uint8 for PNG rendering."""
    arr = np.asarray(array)
    if arr.dtype == np.uint8:
        return arr
    if np.issubdtype(arr.dtype, np.floating):
        finite_mask = np.isfinite(arr)
        finite = arr[finite_mask]
    else:
        finite_mask = None
        finite = arr.reshape(-1)
    if finite.size == 0:
        return np.zeros(arr.shape, dtype=np.uint8)
    lo = float(np.min(finite))
    hi = float(np.max(finite))
    if hi <= lo:
        fill = 0 if hi <= 0 else 255
        return np.full(arr.shape, fill, dtype=np.uint8)
    scaled = ((arr.astype(np.float32, copy=False) - lo) * 255.0) / (hi - lo)
    if finite_mask is not None:
        scaled = np.where(finite_mask, scaled, 0)
    return np.clip(scaled, 0, 255).astype(np.uint8)


def scale_color_component_to_uint8(array: np.ndarray) -> np.ndarray:
    """Convert color or alpha samples without borrowing the other channels' range."""
    arr = np.asarray(array)
    if arr.dtype == np.uint8:
        return arr
    if np.issubdtype(arr.dtype, np.bool_):
        return arr.astype(np.uint8) * 255
    if np.issubdtype(arr.dtype, np.integer):
        info = np.iinfo(arr.dtype)
        denominator = float(info.max) - float(info.min)
        scaled = (arr.astype(np.float64) - float(info.min)) * (255.0 / denominator)
        return np.rint(np.clip(scaled, 0, 255)).astype(np.uint8)
    if np.issubdtype(arr.dtype, np.floating):
        finite = np.isfinite(arr)
        finite_values = arr[finite]
        if finite_values.size and np.all(
            (finite_values >= 0.0) & (finite_values <= 1.0)
        ):
            scaled = np.where(finite, np.clip(arr, 0.0, 1.0) * 255.0, 0.0)
            return np.rint(scaled).astype(np.uint8)
    return scale_array_to_uint8(arr)


def scale_color_array_to_uint8(array: np.ndarray) -> np.ndarray:
    """Scale RGB/RGBA arrays to uint8 while preserving channel independence."""
    arr = np.asarray(array)
    if arr.ndim != 3 or arr.shape[-1] not in (3, 4):
        raise ValueError("Color volume slices must use channel-last RGB or RGBA layout")
    if arr.dtype == np.uint8:
        return arr
    scaled = np.empty(arr.shape, dtype=np.uint8)
    scaled[..., :3] = scale_color_component_to_uint8(arr[..., :3])
    if arr.shape[-1] == 4:
        scaled[..., 3] = scale_color_component_to_uint8(arr[..., 3])
    return scaled


def normalize_array_slice_to_png(array: np.ndarray) -> bytes:
    """Render one scalar or RGB/RGBA volume slice as PNG bytes."""
    arr = np.asarray(array)
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        if arr.shape[-1] == 4 and is_binary_segment_channel_slice(arr):
            arr = render_binary_segment_channels(arr)
        else:
            arr = scale_color_array_to_uint8(arr)
        normalized = arr if arr.dtype == np.uint8 else arr.astype(np.uint8)
        img = Image.fromarray(normalized, "RGBA" if arr.shape[-1] == 4 else "RGB")
    else:
        arr = scale_array_to_uint8(arr)
        img = Image.fromarray(arr.astype(np.uint8), "L")
    output = io.BytesIO()
    img.save(output, format="PNG")
    return output.getvalue()


def axis_slice(array: np.ndarray, axis: str, index: int) -> np.ndarray:
    """Return the requested anatomical slice from a volume array."""
    if axis == "axial":
        return array[index, :, :, ...]
    if axis == "coronal":
        return array[:, index, :, ...]
    if axis == "sagittal":
        return array[:, :, index, ...]
    raise ValueError("Axis must be axial, coronal, or sagittal")


def connected_volume_comparison_value(
    value: Any,
    dtype: np.dtype,
    *,
    display_min: float | None,
    display_max: float | None,
) -> np.ndarray | None:
    """Normalize one voxel value for connected-volume comparisons."""
    channels = np.asarray(value).reshape(-1)
    if channels.size == 0:
        return None
    try:
        numeric = channels.astype(np.float64, copy=False)
    except (TypeError, ValueError):
        return None
    if not np.all(np.isfinite(numeric)):
        return None
    if display_min is not None and display_max is not None:
        scale = 255.0 / (display_max - display_min)
        return np.clip((numeric - display_min) * scale, 0.0, 255.0)
    resolved_dtype = np.dtype(dtype)
    if np.issubdtype(resolved_dtype, np.bool_):
        return numeric * 255.0
    if resolved_dtype == np.dtype(np.uint8):
        return numeric
    if np.issubdtype(resolved_dtype, np.integer):
        limits = np.iinfo(resolved_dtype)
        return (numeric - float(limits.min)) * (
            255.0 / (float(limits.max) - float(limits.min))
        )
    if np.issubdtype(resolved_dtype, np.floating):
        if np.all((numeric >= 0.0) & (numeric <= 1.0)):
            return numeric * 255.0
        return numeric
    return None


def connected_volume_selection(
    volume: np.ndarray,
    *,
    seed: list[int],
    sensitivity: float,
    display_min: float | None,
    display_max: float | None,
    max_voxels: int,
    max_examined: int,
    max_runs: int,
) -> dict[str, Any]:
    """Select a guarded 6-connected intensity region from a volume."""
    array = np.asarray(volume)
    if len(array.shape) == 3:
        depth, height, width = (int(value) for value in array.shape)
    elif len(array.shape) == 4 and array.shape[-1] in {3, 4}:
        depth, height, width = (int(value) for value in array.shape[:3])
    else:
        raise ValueError("Image is not a multi-image volume")
    x_seed, y_seed, z_seed = seed
    if (
        x_seed < 0
        or x_seed >= width
        or y_seed < 0
        or y_seed >= height
        or z_seed < 0
        or z_seed >= depth
    ):
        raise ValueError("Seed voxel is outside the volume")

    def comparison_value(x: int, y: int, z: int) -> np.ndarray | None:
        return connected_volume_comparison_value(
            array[z, y, x, ...],
            array.dtype,
            display_min=display_min,
            display_max=display_max,
        )

    seed_value = comparison_value(x_seed, y_seed, z_seed)
    if seed_value is None:
        raise ValueError("Seed voxel does not contain a finite comparable value")
    plane_size = width * height

    def to_index(x, y, z):
        return (z * plane_size) + (y * width) + x

    pending = [(x_seed, y_seed, z_seed)]
    pending_index = 0
    visited: set[int] = set()
    selected_rows: dict[tuple[int, int], list[int]] = {}
    selected_count = 0
    truncation_reason = ""
    while pending_index < len(pending):
        x, y, z = pending[pending_index]
        pending_index += 1
        flat_index = to_index(x, y, z)
        if flat_index in visited:
            continue
        if len(visited) >= max_examined:
            truncation_reason = "max-examined"
            break
        visited.add(flat_index)
        candidate = comparison_value(x, y, z)
        if candidate is None:
            continue
        channels = max(seed_value.size, candidate.size)
        seed_channels = np.resize(seed_value, channels)
        candidate_channels = np.resize(candidate, channels)
        if float(np.max(np.abs(candidate_channels - seed_channels))) > sensitivity:
            continue
        if selected_count >= max_voxels:
            truncation_reason = "max-voxels"
            break
        selected_rows.setdefault((z, y), []).append(x)
        selected_count += 1
        if x > 0:
            pending.append((x - 1, y, z))
        if x + 1 < width:
            pending.append((x + 1, y, z))
        if y > 0:
            pending.append((x, y - 1, z))
        if y + 1 < height:
            pending.append((x, y + 1, z))
        if z > 0:
            pending.append((x, y, z - 1))
        if z + 1 < depth:
            pending.append((x, y, z + 1))

    runs: list[list[int]] = []
    run_overflow = False
    run_detection_limit = max_runs + 1
    for (z, y), raw_x_values in sorted(selected_rows.items()):
        x_values = sorted(set(raw_x_values))
        if not x_values:
            continue
        start = x_values[0]
        previous = start
        for x in x_values[1:]:
            if x == previous + 1:
                previous = x
                continue
            runs.append([z, y, start, previous + 1])
            if len(runs) >= run_detection_limit:
                run_overflow = True
                break
            start = x
            previous = x
        if run_overflow:
            break
        runs.append([z, y, start, previous + 1])
        if len(runs) >= run_detection_limit:
            run_overflow = True
            break
    if run_overflow:
        runs = runs[:max_runs]
        truncation_reason = truncation_reason or "max-runs"

    represented_voxel_count = sum(run[3] - run[2] for run in runs)
    bounds = None
    if runs:
        bounds = {
            "min": [
                min(run[2] for run in runs),
                min(run[1] for run in runs),
                min(run[0] for run in runs),
            ],
            "max": [
                max(run[3] - 1 for run in runs),
                max(run[1] for run in runs),
                max(run[0] for run in runs),
            ],
        }
    return {
        "dimensions": [width, height, depth],
        "seed": [x_seed, y_seed, z_seed],
        "volume_runs": runs,
        "voxel_count": represented_voxel_count,
        "examined": len(visited),
        "bounds": bounds,
        "truncated": bool(truncation_reason),
        "truncation_reason": truncation_reason,
        "connectivity": 6,
    }
