"""Shared helpers for local segmentation placeholder adapter examples."""

from __future__ import annotations

import base64
import io
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from PIL import Image


def payload_from_request(request: Any) -> dict[str, Any]:
    """Return a plain dictionary for a Pydantic or dictionary request."""

    if hasattr(request, "model_dump"):
        return request.model_dump(mode="python", exclude={"image"})
    return dict(request or {})


def decode_request_image(payload: dict[str, Any]) -> Image.Image:
    """Decode VISTA's base64 PNG payload into an RGB Pillow image."""

    encoded = str(payload.get("image_data_base64") or "")
    if encoded.startswith("data:") and "," in encoded:
        encoded = encoded.split(",", 1)[1]
    image_bytes = base64.b64decode(encoded)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def is_file_like(value: Any) -> bool:
    return (
        hasattr(value, "read")
        or hasattr(value, "getvalue")
        or isinstance(value, (bytes, bytearray))
    )


def bytes_from_file_like(value: Any) -> bytes:
    if hasattr(value, "getvalue"):
        return value.getvalue()
    if hasattr(value, "read"):
        position = value.tell() if hasattr(value, "tell") else None
        payload = value.read()
        if position is not None and hasattr(value, "seek"):
            value.seek(position)
        return payload
    return bytes(value)


def rgb_image_from_payload(payload: dict[str, Any]) -> Image.Image:
    """Decode an in-memory ``file`` value when present, else the base64 image."""

    file_value = payload.get("file")
    if file_value is not None and is_file_like(file_value):
        return Image.open(io.BytesIO(bytes_from_file_like(file_value))).convert("RGB")
    return decode_request_image(payload)


def _float_option(options: dict[str, Any], name: str, default: float) -> float:
    value = options.get(name, default)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return default
    return default


def centered_bbox_xywh(image: Image.Image, fraction: float = 0.4) -> list[float]:
    """Return a centered fallback bbox in [x, y, width, height] form."""

    width, height = image.size
    box_width = max(1.0, width * fraction)
    box_height = max(1.0, height * fraction)
    return [
        max(0.0, (width - box_width) / 2),
        max(0.0, (height - box_height) / 2),
        min(float(width), box_width),
        min(float(height), box_height),
    ]


def foreground_bbox_xywh(
    image: Image.Image, *, threshold_delta: float = 20.0
) -> list[float]:
    """Estimate a simple foreground bbox by comparing luminance to corners.

    This is intentionally lightweight and dependency-free. Production adapters
    should replace this heuristic with their deployed model call while keeping
    the returned dictionary shape stable.
    """

    grayscale = image.convert("L")
    width, height = grayscale.size
    if width <= 0 or height <= 0:
        return [0.0, 0.0, 1.0, 1.0]

    pixels = grayscale.load()
    corners = [
        pixels[0, 0],
        pixels[width - 1, 0],
        pixels[0, height - 1],
        pixels[width - 1, height - 1],
    ]
    background = sum(corners) / len(corners)
    min_x = width
    min_y = height
    max_x = -1
    max_y = -1

    for y in range(height):
        for x in range(width):
            if abs(float(pixels[x, y]) - background) < threshold_delta:
                continue
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

    if max_x < min_x or max_y < min_y:
        return centered_bbox_xywh(image)
    return [
        float(min_x),
        float(min_y),
        float(max_x - min_x + 1),
        float(max_y - min_y + 1),
    ]


def prompted_bbox_xywh(image: Image.Image, prompts: dict[str, Any]) -> list[float]:
    """Build a bbox from SAM-like box prompts when present, else fallback."""

    box = prompts.get("box") or prompts.get("bbox")
    if isinstance(box, Iterable) and not isinstance(box, (str, bytes, dict)):
        try:
            values = [float(value) for value in list(box)[:4]]
        except (TypeError, ValueError):
            values = []
        if len(values) == 4:
            x1, y1, x2, y2 = values
            width = max(1.0, x2 - x1)
            height = max(1.0, y2 - y1)
            return [max(0.0, x1), max(0.0, y1), width, height]
    return centered_bbox_xywh(image, fraction=0.5)


def output_for_box(
    *,
    payload: dict[str, Any],
    box: list[float],
    label: str,
    runtime: str,
    score: float,
    extra_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return VISTA's shared segmentation output shape for one bbox mask."""

    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    metrics = {
        "runtime": runtime,
        "model": options.get("model", f"example-{runtime}"),
    }
    if extra_metrics:
        metrics.update(extra_metrics)
    return {
        "backend": payload.get("backend", runtime.split("_", 1)[0]),
        "mode": payload.get("mode", "default"),
        "masks": [
            {
                "segmentation": None,
                "bbox": box,
                "area": box[2] * box[3],
                "score": score,
                "label": label,
            }
        ],
        "metrics": metrics,
        "raw_output": None,
    }


def options_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    options = payload.get("options")
    return options if isinstance(options, dict) else {}


def threshold_delta_from_options(
    options: dict[str, Any], default: float = 20.0
) -> float:
    return _float_option(options, "threshold_delta", default)


def score_from_options(options: dict[str, Any], default: float = 0.9) -> float:
    return max(0.0, min(1.0, _float_option(options, "score", default)))


def run_segmenter(segmenter: Any, data: Any):
    runner = getattr(segmenter, "run", None)
    if callable(runner):
        return runner(data)
    return segmenter._run(data)


def masks_from_entries(entries: Any, *, label_prefix: str) -> list[dict[str, Any]]:
    """Normalize toolkit mask dictionaries that carry an [x, y, w, h] bbox."""

    masks = []
    for index, entry in enumerate(entries or [], start=1):
        if hasattr(entry, "model_dump"):
            entry = entry.model_dump(mode="python")
        if not isinstance(entry, dict):
            continue
        bbox = entry.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
            continue
        try:
            bbox_values = [float(value) for value in bbox[:4]]
        except (TypeError, ValueError):
            continue
        area = entry.get("area") or (bbox_values[2] * bbox_values[3])
        score = entry.get("score")
        masks.append(
            {
                "segmentation": None,
                "bbox": bbox_values,
                "area": float(area),
                "score": None if score is None else float(score),
                "label": str(entry.get("label") or f"{label_prefix}{index}"),
            }
        )
    return masks


def foreground_fallback_output(
    payload: dict[str, Any],
    reason: str,
    *,
    backend: str,
    display_name: str,
    label: str,
) -> dict[str, Any]:
    """Return a foreground-bbox output that records why the runtime failed."""

    options = options_from_payload(payload)
    image = rgb_image_from_payload(payload)
    concise_reason = str(reason).strip() or f"{display_name} runtime failed"
    return output_for_box(
        payload={**payload, "backend": backend},
        box=foreground_bbox_xywh(
            image, threshold_delta=threshold_delta_from_options(options)
        ),
        label=label,
        runtime=f"analysis_toolkit.{backend}_fallback",
        score=score_from_options(options, 0.75),
        extra_metrics={
            "fallback_reason": concise_reason,
            "runtime_warning": f"{display_name} runtime failed; used foreground fallback ({concise_reason}).",
        },
    )


def native_runtime_disabled() -> bool:
    # Imported lazily so the backend modules stay importable with only the
    # repository root on sys.path, which is how the runtime smoke tests load
    # them.
    from core.config import settings  # noqa: PLC0415

    return settings.VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME


def runtime_loader_is_patched(loader: Any, module_name: str) -> bool:
    """Return true when a test replaced the backend's loader with a fake."""

    return getattr(loader, "__module__", module_name) != module_name


class NativeRuntime:
    """Gate in front of one backend's native runtime loader.

    ``VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME=true`` blocks the real loader.
    A loader patched by a test is the only opt-in; a configured checkpoint is
    not, because routers inject default checkpoints.
    """

    def __init__(
        self, *, display_name: str, loader: Callable[[], Any], patched: bool
    ) -> None:
        self.display_name = display_name
        self.patched = patched
        self._loader = loader

    @property
    def available(self) -> bool:
        return self.patched or not native_runtime_disabled()

    def require(self) -> None:
        if not self.available:
            raise RuntimeError(
                f"{self.display_name} runtime is disabled by "
                "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME=true"
            )

    def load(self) -> Any:
        self.require()
        return self._loader()


@dataclass(frozen=True)
class SegmentationBackend:
    """Shared ``run(request)`` entry point for a local segmentation adapter.

    The loader is looked up as a module global on every call so tests can
    monkeypatch it. ``run_native`` only reaches the runtime through the
    ``NativeRuntime`` gate, and any exception it raises becomes ``fallback``.
    """

    display_name: str
    module_name: str
    loader_name: str
    run_native: Callable[[dict[str, Any], NativeRuntime], Any]
    fallback: Callable[[dict[str, Any], str], dict[str, Any]]

    def native_runtime(self) -> NativeRuntime:
        loader = getattr(sys.modules[self.module_name], self.loader_name)
        return NativeRuntime(
            display_name=self.display_name,
            loader=loader,
            patched=runtime_loader_is_patched(loader, self.module_name),
        )

    def run(self, request: Any) -> Any:
        payload = payload_from_request(request)
        try:
            return self.run_native(payload, self.native_runtime())
        except Exception as exc:
            return self.fallback(payload, str(exc))
