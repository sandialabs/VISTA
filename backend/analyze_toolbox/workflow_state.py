"""Per-image state threaded through an Analyze workflow chain."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from PIL import Image


@dataclass
class ImageState:
    source_image: Image.Image
    image: Image.Image
    source_metadata: dict[str, Any] = field(default_factory=dict)
    mask: Image.Image | None = None
    heatmap: Image.Image | None = None
    labels: Image.Image | None = None
    overlay_label: str = "Analyze Overlay"
    overlay_method_id: str | None = None
    overlay_method_name: str | None = None
    anomaly_score: float | None = None
    artifact_block_reason: str | None = None
    detections: list[dict[str, Any]] = field(default_factory=list)
    measurements: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class RunCallbacks:
    """Run-level hooks that remote method handlers forward to integrations."""

    cancel_check: Callable[[], bool] | None = None
    remote_job_callback: Callable[[str, str], None] | None = None


# (state, message, summary, artifacts) produced by every method handler.
NodeOutput = tuple[ImageState, str, dict[str, Any], list[dict[str, Any]]]


def mark_overlay(state: ImageState, prefix: str, method) -> None:
    """Attribute the current overlay to ``method`` with a ``prefix`` label."""
    state.overlay_label = f"{prefix} Overlay :: {method.name}"
    state.overlay_method_id = method.id
    state.overlay_method_name = method.name


def block_model_outputs(state: ImageState, reason: str) -> None:
    """Clear model outputs and block downstream artifacts for ``reason``."""
    state.labels = None
    state.detections = []
    state.measurements = []
    state.overlay_label = "Analyze Overlay"
    state.overlay_method_id = None
    state.overlay_method_name = None
    state.artifact_block_reason = reason
