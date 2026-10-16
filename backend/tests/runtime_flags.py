"""Shared opt-in flags for backend tests with optional native dependencies."""

from __future__ import annotations

import os

_TRUE_VALUES = {"1", "true", "yes", "on"}


def native_segmentation_runtime_enabled() -> bool:
    """Return true when tests should import native/heavy segmentation runtimes."""

    return (
        os.getenv("VISTA_RUN_NATIVE_SEGMENTATION_TESTS", "").strip().lower()
        in _TRUE_VALUES
    )
