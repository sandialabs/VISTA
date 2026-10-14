"""Strict normalization for inline PT3 voxel segmentation labels.

Both Gaussian representations consume this module so a segmentation volume has
one interpretation across voxel-direct fitting and the simplified converter.
Remote label URLs are deliberately not fetched by background fitting jobs: the
part metadata must contain a complete inline label volume for the source shape.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np


class PT3SegmentationError(ValueError):
    """Raised when declared PT3 segmentation cannot be mapped to the volume."""


def normalize_inline_pt3_segmentation_labels(
    segmentation: Mapping[str, Any] | None,
    shape: Sequence[int],
) -> np.ndarray | None:
    """Return an unsigned ``[z, y, x]`` label volume or ``None``.

    Supported forms are a top-level three-dimensional ``labels`` (also
    ``label_volume`` or ``voxel_labels``) array, or ``label_slices`` entries.
    Slice entries may contain a flattened ``width * height`` list or a nested
    ``[height, width]`` array. Explicit ``slice_index`` values determine depth;
    list order is only the fallback when no index is declared.
    """

    shape_zyx = _normalize_shape(shape)
    if segmentation is None:
        return None
    if not isinstance(segmentation, Mapping):
        raise PT3SegmentationError("PT3 segmentation must be an object")
    if not segmentation:
        return None

    volume_keys = [
        key
        for key in ("label_volume", "voxel_labels", "labels")
        if segmentation.get(key) is not None
    ]
    slices_keys = [
        key
        for key in ("label_slices", "labelSlices")
        if segmentation.get(key) is not None
    ]
    if len(volume_keys) > 1 or len(slices_keys) > 1 or (volume_keys and slices_keys):
        raise PT3SegmentationError(
            "PT3 segmentation declares ambiguous inline label sources"
        )
    if volume_keys:
        return _validated_label_array(
            segmentation[volume_keys[0]], shape_zyx, field=volume_keys[0]
        )
    if slices_keys:
        return _normalize_label_slices(segmentation[slices_keys[0]], shape_zyx)

    remote_keys = ("url", "asset_url", "href", "path", "label_url", "labels_url")
    if any(
        isinstance(segmentation.get(key), str) and segmentation.get(key).strip()
        for key in remote_keys
    ):
        raise PT3SegmentationError(
            "PT3 segmentation contains URL-only labels; inline labels are required"
        )
    raise PT3SegmentationError("PT3 segmentation is missing inline voxel labels")


def _normalize_shape(shape: Sequence[int]) -> tuple[int, int, int]:
    if isinstance(shape, (str, bytes)) or len(shape) != 3:
        raise PT3SegmentationError(
            "PT3 segmentation requires a three-dimensional volume shape"
        )
    normalized: list[int] = []
    for value in shape:
        if isinstance(value, (bool, np.bool_)):
            raise PT3SegmentationError(
                "PT3 volume shape must contain positive integers"
            )
        try:
            numeric = int(value)
        except (TypeError, ValueError) as exc:
            raise PT3SegmentationError(
                "PT3 volume shape must contain positive integers"
            ) from exc
        if numeric < 1 or numeric != value:
            raise PT3SegmentationError(
                "PT3 volume shape must contain positive integers"
            )
        normalized.append(numeric)
    return tuple(normalized)  # type: ignore[return-value]


def _normalize_label_slices(raw_slices: Any, shape: tuple[int, int, int]) -> np.ndarray:
    if (
        isinstance(raw_slices, (str, bytes))
        or not isinstance(raw_slices, Sequence)
        or not raw_slices
    ):
        raise PT3SegmentationError("PT3 label_slices must be a non-empty array")

    depth, height, width = shape
    by_index: dict[int, np.ndarray] = {}
    for list_index, item in enumerate(raw_slices):
        if isinstance(item, Mapping):
            raw_index = item.get(
                "slice_index", item.get("sliceIndex", item.get("index", list_index))
            )
            labels = item.get("labels", item.get("data"))
            if labels is None:
                remote_keys = ("url", "asset_url", "href", "path")
                if any(
                    isinstance(item.get(key), str) and item.get(key).strip()
                    for key in remote_keys
                ):
                    raise PT3SegmentationError(
                        f"PT3 label slice {list_index} contains URL-only labels; inline labels are required"
                    )
                raise PT3SegmentationError(
                    f"PT3 label slice {list_index} is missing inline labels"
                )
        elif isinstance(item, Sequence) and not isinstance(item, (str, bytes)):
            raw_index = list_index
            labels = item
        else:
            raise PT3SegmentationError(f"PT3 label slice {list_index} is malformed")

        slice_index = _validated_slice_index(
            raw_index, list_index=list_index, depth=depth
        )
        if slice_index in by_index:
            raise PT3SegmentationError(
                f"PT3 label_slices contains duplicate slice_index {slice_index}"
            )
        label_array = _validated_numeric_labels(
            labels, field=f"label_slices[{list_index}].labels"
        )
        if label_array.shape == (height * width,):
            label_array = label_array.reshape(height, width)
        if label_array.shape != (height, width):
            raise PT3SegmentationError(
                f"PT3 label slice {slice_index} shape {label_array.shape} does not match {(height, width)}"
            )
        by_index[slice_index] = np.ascontiguousarray(label_array, dtype=np.uint8)

    missing = sorted(set(range(depth)) - set(by_index))
    if missing:
        raise PT3SegmentationError(
            "PT3 label_slices is missing slice_index values: "
            + ", ".join(str(value) for value in missing)
        )
    return np.stack([by_index[index] for index in range(depth)], axis=0)


def _validated_slice_index(value: Any, *, list_index: int, depth: int) -> int:
    if isinstance(value, (bool, np.bool_)):
        raise PT3SegmentationError(
            f"PT3 label slice {list_index} has an invalid slice_index"
        )
    try:
        numeric = int(value)
    except (TypeError, ValueError) as exc:
        raise PT3SegmentationError(
            f"PT3 label slice {list_index} has an invalid slice_index"
        ) from exc
    if numeric != value or not 0 <= numeric < depth:
        raise PT3SegmentationError(
            f"PT3 label slice {list_index} slice_index must be between 0 and {depth - 1}"
        )
    return numeric


def _validated_label_array(
    value: Any, shape: tuple[int, int, int], *, field: str
) -> np.ndarray:
    labels = _validated_numeric_labels(value, field=field)
    if labels.shape != shape:
        raise PT3SegmentationError(
            f"PT3 segmentation {field} shape {labels.shape} does not match volume shape {shape}"
        )
    return np.ascontiguousarray(labels, dtype=np.uint8)


def _validated_numeric_labels(value: Any, *, field: str) -> np.ndarray:
    try:
        raw = np.asarray(value)
    except (TypeError, ValueError) as exc:
        raise PT3SegmentationError(
            f"PT3 segmentation {field} must be a rectangular numeric array"
        ) from exc
    if raw.dtype == np.dtype("O") or np.issubdtype(raw.dtype, np.bool_):
        raise PT3SegmentationError(
            f"PT3 segmentation {field} must contain integer IDs from 0 through 255"
        )
    try:
        numeric = raw.astype(np.float64)
    except (TypeError, ValueError) as exc:
        raise PT3SegmentationError(
            f"PT3 segmentation {field} must contain integer IDs from 0 through 255"
        ) from exc
    if (
        not np.all(np.isfinite(numeric))
        or not np.all(numeric == np.floor(numeric))
        or np.any(numeric < 0)
        or np.any(numeric > 255)
    ):
        raise PT3SegmentationError(
            f"PT3 segmentation {field} must contain integer IDs from 0 through 255"
        )
    return np.ascontiguousarray(numeric, dtype=np.uint8)
