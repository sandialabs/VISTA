"""Size limits and JSON complexity checks for inspection annotation payloads."""

# ruff: noqa: D101,D102,D202,E501

import math
from typing import Any

INSPECTION_SEGMENT_MAX_AREAS = 64
INSPECTION_SEGMENT_MAX_POINTS_PER_AREA = 10_000
INSPECTION_SEGMENT_MAX_POINTS_TOTAL = 50_000

# Persisted VISTA segments are API-facing, untrusted JSON.  These ceilings are
# deliberately much larger than normal industrial CT data while keeping one
# annotation from becoming an unbounded metadata/document payload.  A 65,536
# pixel plane and one million slices both exceed practical volumes that fit
# under VISTA's 2.5 GiB volume-load limit, including low-bit-depth scans.
INSPECTION_SEGMENT_MAX_IMAGE_DIMENSION = 65_536
INSPECTION_SEGMENT_MAX_SLICE_INDEX = 1_000_000
INSPECTION_SEGMENT_MAX_MASK_RUNS_PER_AREA = 50_000
INSPECTION_SEGMENT_MAX_MASK_RUNS_TOTAL = 50_000
INSPECTION_SEGMENT_MAX_VOLUME_RUNS_PER_AREA = 50_000
INSPECTION_SEGMENT_MAX_VOLUME_RUNS_TOTAL = 50_000
INSPECTION_SEGMENT_MAX_MASK_PATH_CHARS = 4 * 1024 * 1024
INSPECTION_SEGMENT_MAX_OTHER_TEXT_CHARS = 4_096
INSPECTION_SEGMENT_MAX_TEXT_CHARS_TOTAL = 5 * 1024 * 1024
INSPECTION_SEGMENT_MAX_JSON_DEPTH = 12
INSPECTION_SEGMENT_MAX_JSON_NODES = 550_000
INSPECTION_SEGMENT_MAX_JSON_KEY_CHARS = 256

# The annotation envelope is validated separately from geometry.segment.  Its
# limits intentionally include the two envelope levels (geometry -> segment)
# and a modest allowance for metadata, measurements, and bbox values.  Reusing
# the segment ceilings here would make a segment at its documented depth or
# node boundary fail only after it was wrapped in an otherwise-valid
# annotation.
INSPECTION_ANNOTATION_MAX_JSON_DEPTH = 16
INSPECTION_ANNOTATION_MAX_JSON_NODES = 600_000
INSPECTION_ANNOTATION_MAX_JSON_KEY_CHARS = 256
INSPECTION_ANNOTATION_MAX_OTHER_TEXT_CHARS = 4_096
INSPECTION_ANNOTATION_MAX_TEXT_CHARS_TOTAL = 6 * 1024 * 1024


def _validate_segment_json_complexity(value: Any, field_name: str) -> None:
    """Bound arbitrary extension data without recursive Python traversal."""
    is_segment_payload = field_name.startswith("geometry.segment")
    scope_label = "geometry.segment" if is_segment_payload else "annotation payload"
    max_json_nodes = (
        INSPECTION_SEGMENT_MAX_JSON_NODES
        if is_segment_payload
        else INSPECTION_ANNOTATION_MAX_JSON_NODES
    )
    max_json_depth = (
        INSPECTION_SEGMENT_MAX_JSON_DEPTH
        if is_segment_payload
        else INSPECTION_ANNOTATION_MAX_JSON_DEPTH
    )
    max_json_key_chars = (
        INSPECTION_SEGMENT_MAX_JSON_KEY_CHARS
        if is_segment_payload
        else INSPECTION_ANNOTATION_MAX_JSON_KEY_CHARS
    )
    max_other_text_chars = (
        INSPECTION_SEGMENT_MAX_OTHER_TEXT_CHARS
        if is_segment_payload
        else INSPECTION_ANNOTATION_MAX_OTHER_TEXT_CHARS
    )
    max_text_chars_total = (
        INSPECTION_SEGMENT_MAX_TEXT_CHARS_TOTAL
        if is_segment_payload
        else INSPECTION_ANNOTATION_MAX_TEXT_CHARS_TOTAL
    )
    stack = [(value, field_name, 0)]
    node_count = 0
    text_char_count = 0

    while stack:
        current, current_name, depth = stack.pop()
        node_count += 1
        if node_count > max_json_nodes:
            raise ValueError(
                f"{scope_label} must contain at most {max_json_nodes} JSON values"
            )
        if depth > max_json_depth:
            raise ValueError(
                f"{scope_label} JSON nesting depth must be at most {max_json_depth}"
            )

        if isinstance(current, dict):
            if len(current) > max_json_nodes:
                raise ValueError(
                    f"{scope_label} must contain at most {max_json_nodes} JSON values"
                )
            for key, nested_value in current.items():
                if not isinstance(key, str):
                    raise ValueError(f"{current_name} keys must be strings")
                if len(key) > max_json_key_chars:
                    raise ValueError(
                        f"{current_name} keys must contain at most {max_json_key_chars} characters"
                    )
                text_char_count += len(key)
                stack.append((nested_value, f"{current_name}.{key}", depth + 1))
        elif isinstance(current, list):
            if len(current) > max_json_nodes:
                raise ValueError(
                    f"{scope_label} must contain at most {max_json_nodes} JSON values"
                )
            for index in range(len(current) - 1, -1, -1):
                stack.append((current[index], f"{current_name}[{index}]", depth + 1))
        elif isinstance(current, str):
            is_segment_mask_path = current_name.endswith(
                (".maskPath", ".mask_path")
            ) and (
                is_segment_payload
                or current_name.startswith("annotation.geometry.segment.")
            )
            individual_limit = (
                INSPECTION_SEGMENT_MAX_MASK_PATH_CHARS
                if is_segment_mask_path
                else max_other_text_chars
            )
            if len(current) > individual_limit:
                raise ValueError(
                    f"{current_name} must contain at most {individual_limit} characters"
                )
            text_char_count += len(current)
        elif isinstance(current, float) and not math.isfinite(current):
            raise ValueError(f"{current_name} must contain only finite numbers")
        elif current is not None and not isinstance(current, (bool, int, float)):
            raise ValueError(f"{current_name} must contain JSON-compatible values")

        if text_char_count > max_text_chars_total:
            raise ValueError(
                f"{scope_label} text must contain at most "
                f"{max_text_chars_total} characters in total"
            )
