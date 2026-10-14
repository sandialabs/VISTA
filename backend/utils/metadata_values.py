"""Helpers for normalizing loosely typed metadata values."""

from __future__ import annotations

import math
from typing import Any

_TRUE_METADATA_VALUES = frozenset({"1", "true", "yes", "y", "on"})
_FALSE_METADATA_VALUES = frozenset({"", "0", "false", "no", "n", "off"})


def parse_metadata_boolean(value: Any, *, fallback: bool = False) -> bool:
    """Parse boolean-shaped metadata without treating every string as true."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return bool(fallback)
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in _TRUE_METADATA_VALUES:
            return True
        if normalized in _FALSE_METADATA_VALUES:
            return False
    return bool(fallback)
