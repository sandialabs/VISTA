"""Validation of VISTA segment geometry stored on inspection annotations."""

# ruff: noqa: D101,D102,D202,E501

import math
from typing import Any

from schemas.inspection_annotation_limits import (
    INSPECTION_SEGMENT_MAX_AREAS,
    INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
    INSPECTION_SEGMENT_MAX_MASK_PATH_CHARS,
    INSPECTION_SEGMENT_MAX_MASK_RUNS_PER_AREA,
    INSPECTION_SEGMENT_MAX_MASK_RUNS_TOTAL,
    INSPECTION_SEGMENT_MAX_POINTS_PER_AREA,
    INSPECTION_SEGMENT_MAX_POINTS_TOTAL,
    INSPECTION_SEGMENT_MAX_SLICE_INDEX,
    INSPECTION_SEGMENT_MAX_VOLUME_RUNS_PER_AREA,
    INSPECTION_SEGMENT_MAX_VOLUME_RUNS_TOTAL,
    _validate_segment_json_complexity,
)


def _require_segment_integer(
    value: Any,
    field_name: str,
    *,
    minimum: int,
    maximum: int | None = None,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"geometry.segment.{field_name} must be an integer")
    if value < minimum:
        qualifier = "positive" if minimum == 1 else "nonnegative"
        raise ValueError(f"geometry.segment.{field_name} must be {qualifier}")
    if maximum is not None and value > maximum:
        raise ValueError(f"geometry.segment.{field_name} must be at most {maximum}")
    return value


def _require_finite_segment_coordinate(value: Any, field_name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} must be a finite number")
    try:
        numeric_value = float(value)
    except (OverflowError, ValueError):
        raise ValueError(f"{field_name} must be a finite number") from None
    if not math.isfinite(numeric_value):
        raise ValueError(f"{field_name} must be a finite number")


def _validate_segment_point(value: Any, field_name: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(
            f"{field_name} must be an object with finite x and y coordinates"
        )
    if "x" not in value or "y" not in value:
        raise ValueError(f"{field_name} must include x and y coordinates")
    _require_finite_segment_coordinate(value["x"], f"{field_name}.x")
    _require_finite_segment_coordinate(value["y"], f"{field_name}.y")


def _segment_mask_run_value(run: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in run:
            return run[key]
    return None


def _validate_segment_mask_run(
    value: Any,
    field_name: str,
    *,
    image_width: int,
    image_height: int,
) -> None:
    if isinstance(value, list):
        if len(value) != 3:
            raise ValueError(f"{field_name} must contain exactly [y, start, end]")
        y, start, end = value
    elif isinstance(value, dict):
        y = _segment_mask_run_value(value, ("y", "row"))
        start = _segment_mask_run_value(value, ("start", "x1", "x"))
        end = _segment_mask_run_value(value, ("end", "x2"))
        if y is None or start is None or end is None:
            raise ValueError(
                f"{field_name} must include y/row, start/x1/x, and end/x2 coordinates"
            )
    else:
        raise ValueError(
            f"{field_name} must be a three-value array or coordinate object"
        )

    for coordinate, coordinate_name in ((y, "y"), (start, "start"), (end, "end")):
        _require_finite_segment_coordinate(
            coordinate, f"{field_name}.{coordinate_name}"
        )
    y_value = float(y)
    start_value = float(start)
    end_value = float(end)
    if y_value < 0 or y_value >= image_height:
        raise ValueError(f"{field_name}.y must be within [0, image_height)")
    if start_value < 0 or end_value > image_width:
        raise ValueError(
            f"{field_name} horizontal coordinates must be within [0, image_width]"
        )
    if end_value <= start_value:
        raise ValueError(f"{field_name}.end must be greater than start")


def _validate_segment_volume_run(
    value: Any,
    field_name: str,
    *,
    dimensions: tuple[int, int, int],
) -> None:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{field_name} must contain exactly [z, y, x_start, x_end]")
    if any(isinstance(entry, bool) or not isinstance(entry, int) for entry in value):
        raise ValueError(f"{field_name} coordinates must be integers")
    z, y, x_start, x_end = value
    width, height, depth = dimensions
    if z < 0 or z >= depth:
        raise ValueError(f"{field_name}.z must be within [0, volume depth)")
    if y < 0 or y >= height:
        raise ValueError(f"{field_name}.y must be within [0, volume height)")
    if x_start < 0 or x_end > width:
        raise ValueError(
            f"{field_name} horizontal coordinates must be within [0, volume width]"
        )
    if x_end <= x_start:
        raise ValueError(f"{field_name}.x_end must be greater than x_start")


def _validate_segment_volume_dimensions(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(
            "geometry.segment.volume_dimensions must contain exactly [width, height, depth]"
        )
    limits = (
        INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
        INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
        INSPECTION_SEGMENT_MAX_SLICE_INDEX + 1,
    )
    names = ("width", "height", "depth")
    dimensions: list[int] = []
    for entry, name, maximum in zip(value, names, limits, strict=False):
        if isinstance(entry, bool) or not isinstance(entry, int):
            raise ValueError(
                f"geometry.segment.volume_dimensions.{name} must be an integer"
            )
        if entry < 1 or entry > maximum:
            raise ValueError(
                f"geometry.segment.volume_dimensions.{name} must be within [1, {maximum}]"
            )
        dimensions.append(entry)
    return dimensions[0], dimensions[1], dimensions[2]


def _validate_inspection_segment_geometry(segment: Any) -> None:
    if not isinstance(segment, dict):
        raise ValueError("geometry.segment must be an object")
    _validate_segment_json_complexity(segment, "geometry.segment")
    version = segment.get("version")
    if (
        isinstance(version, bool)
        or not isinstance(version, int)
        or version not in {1, 2}
    ):
        raise ValueError("geometry.segment.version must be the integer 1 or 2")
    if segment.get("axis") not in {"axial", "coronal", "sagittal"}:
        raise ValueError("geometry.segment.axis must be axial, coronal, or sagittal")

    min_slice = _require_segment_integer(
        segment.get("min_slice"),
        "min_slice",
        minimum=0,
        maximum=INSPECTION_SEGMENT_MAX_SLICE_INDEX,
    )
    max_slice = _require_segment_integer(
        segment.get("max_slice"),
        "max_slice",
        minimum=0,
        maximum=INSPECTION_SEGMENT_MAX_SLICE_INDEX,
    )
    if min_slice > max_slice:
        raise ValueError(
            "geometry.segment.min_slice must be less than or equal to max_slice"
        )
    image_width = _require_segment_integer(
        segment.get("image_width"),
        "image_width",
        minimum=1,
        maximum=INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
    )
    image_height = _require_segment_integer(
        segment.get("image_height"),
        "image_height",
        minimum=1,
        maximum=INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION,
    )
    volume_dimensions = None
    if version == 2:
        volume_dimensions = _validate_segment_volume_dimensions(
            segment.get("volume_dimensions")
        )
    elif "volume_dimensions" in segment:
        raise ValueError(
            "geometry.segment.volume_dimensions requires geometry.segment.version 2"
        )

    areas = segment.get("areas")
    if not isinstance(areas, list):
        raise ValueError("geometry.segment.areas must be an array")
    if len(areas) > INSPECTION_SEGMENT_MAX_AREAS:
        raise ValueError(
            f"geometry.segment.areas must contain at most {INSPECTION_SEGMENT_MAX_AREAS} areas"
        )

    total_points = 0
    total_mask_runs = 0
    total_volume_runs = 0
    for area_index, area in enumerate(areas):
        area_name = f"geometry.segment.areas[{area_index}]"
        if not isinstance(area, dict):
            raise ValueError(f"{area_name} must be an object")
        mode = area.get("mode")
        if mode is not None and mode not in {"2d", "3d"}:
            raise ValueError(f"{area_name}.mode must be 2d or 3d")
        points = area.get("points", [])
        if not isinstance(points, list):
            raise ValueError(f"{area_name}.points must be an array")
        if len(points) > INSPECTION_SEGMENT_MAX_POINTS_PER_AREA:
            raise ValueError(
                f"{area_name}.points must contain at most "
                f"{INSPECTION_SEGMENT_MAX_POINTS_PER_AREA} points"
            )
        total_points += len(points)
        if total_points > INSPECTION_SEGMENT_MAX_POINTS_TOTAL:
            raise ValueError(
                "geometry.segment areas must contain at most "
                f"{INSPECTION_SEGMENT_MAX_POINTS_TOTAL} points in total"
            )
        for point_index, point in enumerate(points):
            _validate_segment_point(point, f"{area_name}.points[{point_index}]")
        for point_field in ("start", "end", "center", "edge", "seed"):
            if point_field in area:
                _validate_segment_point(area[point_field], f"{area_name}.{point_field}")
        if "bbox" in area:
            bbox = area["bbox"]
            if not isinstance(bbox, list) or len(bbox) != 4:
                raise ValueError(
                    f"{area_name}.bbox must contain four finite coordinates"
                )
            for coordinate_index, coordinate in enumerate(bbox):
                _require_finite_segment_coordinate(
                    coordinate,
                    f"{area_name}.bbox[{coordinate_index}]",
                )
        for mask_path_field in ("maskPath", "mask_path"):
            if mask_path_field not in area:
                continue
            mask_path = area[mask_path_field]
            if not isinstance(mask_path, str):
                raise ValueError(f"{area_name}.{mask_path_field} must be text")
            if len(mask_path) > INSPECTION_SEGMENT_MAX_MASK_PATH_CHARS:
                raise ValueError(
                    f"{area_name}.{mask_path_field} must contain at most "
                    f"{INSPECTION_SEGMENT_MAX_MASK_PATH_CHARS} characters"
                )
        for mask_runs_field in ("maskRuns", "mask_runs"):
            if mask_runs_field not in area:
                continue
            mask_runs = area[mask_runs_field]
            if not isinstance(mask_runs, list):
                raise ValueError(f"{area_name}.{mask_runs_field} must be an array")
            if len(mask_runs) > INSPECTION_SEGMENT_MAX_MASK_RUNS_PER_AREA:
                raise ValueError(
                    f"{area_name}.{mask_runs_field} must contain at most "
                    f"{INSPECTION_SEGMENT_MAX_MASK_RUNS_PER_AREA} runs"
                )
            total_mask_runs += len(mask_runs)
            if total_mask_runs > INSPECTION_SEGMENT_MAX_MASK_RUNS_TOTAL:
                raise ValueError(
                    "geometry.segment areas must contain at most "
                    f"{INSPECTION_SEGMENT_MAX_MASK_RUNS_TOTAL} mask runs in total"
                )
            for run_index, mask_run in enumerate(mask_runs):
                _validate_segment_mask_run(
                    mask_run,
                    f"{area_name}.{mask_runs_field}[{run_index}]",
                    image_width=image_width,
                    image_height=image_height,
                )
        volume_runs_fields = [
            field_name
            for field_name in ("volumeRuns", "volume_runs")
            if field_name in area
        ]
        if len(volume_runs_fields) > 1:
            raise ValueError(
                f"{area_name} must not contain both volumeRuns and volume_runs"
            )
        for volume_runs_field in volume_runs_fields:
            if volume_runs_field not in area:
                continue
            if version != 2 or volume_dimensions is None:
                raise ValueError(
                    f"{area_name}.{volume_runs_field} requires geometry.segment.version 2"
                )
            volume_runs = area[volume_runs_field]
            if not isinstance(volume_runs, list):
                raise ValueError(f"{area_name}.{volume_runs_field} must be an array")
            if len(volume_runs) > INSPECTION_SEGMENT_MAX_VOLUME_RUNS_PER_AREA:
                raise ValueError(
                    f"{area_name}.{volume_runs_field} must contain at most "
                    f"{INSPECTION_SEGMENT_MAX_VOLUME_RUNS_PER_AREA} runs"
                )
            total_volume_runs += len(volume_runs)
            if total_volume_runs > INSPECTION_SEGMENT_MAX_VOLUME_RUNS_TOTAL:
                raise ValueError(
                    "geometry.segment areas must contain at most "
                    f"{INSPECTION_SEGMENT_MAX_VOLUME_RUNS_TOTAL} volume runs in total"
                )
            for run_index, volume_run in enumerate(volume_runs):
                _validate_segment_volume_run(
                    volume_run,
                    f"{area_name}.{volume_runs_field}[{run_index}]",
                    dimensions=volume_dimensions,
                )
        if "seedVoxel" in area or "seed_voxel" in area:
            if version != 2 or volume_dimensions is None:
                raise ValueError(
                    f"{area_name}.seedVoxel requires geometry.segment.version 2"
                )
            seed_voxel = area.get("seedVoxel", area.get("seed_voxel"))
            if not isinstance(seed_voxel, list) or len(seed_voxel) != 3:
                raise ValueError(
                    f"{area_name}.seedVoxel must contain exactly [x, y, z]"
                )
            if any(
                isinstance(entry, bool) or not isinstance(entry, int)
                for entry in seed_voxel
            ):
                raise ValueError(f"{area_name}.seedVoxel coordinates must be integers")
            if any(
                entry < 0 or entry >= volume_dimensions[index]
                for index, entry in enumerate(seed_voxel)
            ):
                raise ValueError(f"{area_name}.seedVoxel must be within volume bounds")
