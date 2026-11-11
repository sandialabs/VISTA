"""Pick the torch device for SAM, YOLO and Anomalib inference.

``VISTA_MODEL_SERVICE_DEVICE`` (default ``auto``) applies to every native ML
runtime, in the API process and in the analyze toolbox model service:

* ``auto`` (or empty): the first CUDA GPU when one is visible, else Apple MPS,
  else the CPU.
* ``cpu``: always the CPU.
* any other value (``cuda:1``, ``mps``): used as given.

In a container, a GPU is visible only when the runtime passes one in, for
example ``podman run --device nvidia.com/gpu=all`` with the NVIDIA Container
Toolkit; otherwise the same image runs on the CPU.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import threading
from typing import Any

_lock = threading.Lock()
_cached_status: dict[str, Any] | None = None


def accelerator_status(requested: str | None = None) -> dict[str, Any]:
    """Describe the visible accelerators and the device the runtimes will use."""
    requested_device = _configured_device() if requested is None else requested
    requested_device = str(requested_device or "").strip()
    status: dict[str, Any] = {
        "requested_device": requested_device,
        "selected_device": "cpu",
        "cuda_available": False,
        "cuda_device_count": 0,
        "cuda_devices": [],
        "mps_available": False,
    }
    if importlib.util.find_spec("torch") is None:
        status["torch_error"] = "torch is not installed"
        return status
    torch = importlib.import_module("torch")

    try:
        cuda_available = bool(torch.cuda.is_available())
        cuda_device_count = int(torch.cuda.device_count()) if cuda_available else 0
        cuda_devices = [
            torch.cuda.get_device_name(index) for index in range(cuda_device_count)
        ]
    except Exception as exc:
        status["cuda_error"] = str(exc)
        cuda_available, cuda_device_count, cuda_devices = False, 0, []

    try:
        mps_available = bool(
            getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
        )
    except Exception:
        mps_available = False

    selected_device = "cpu"
    if requested_device not in {"", "auto", "cpu"}:
        selected_device = requested_device
    elif requested_device != "cpu" and cuda_available and cuda_device_count > 0:
        selected_device = "cuda:0"
    elif requested_device != "cpu" and mps_available:
        selected_device = "mps"

    status.update(
        {
            "selected_device": selected_device,
            "cuda_available": cuda_available,
            "cuda_device_count": cuda_device_count,
            "cuda_devices": cuda_devices,
            "mps_available": mps_available,
        }
    )
    return status


def _configured_device() -> str:
    # Imported lazily: the segmentation adapters are also loaded with only the
    # repository root on sys.path (runtime smoke tests), where ``core`` is not
    # importable, so fall back to the environment variable the settings read.
    try:
        from core.config import settings  # noqa: PLC0415
    except ModuleNotFoundError as exc:
        if exc.name not in {"core", "core.config"}:
            raise
        return os.environ.get("VISTA_MODEL_SERVICE_DEVICE", "auto")
    return settings.VISTA_MODEL_SERVICE_DEVICE


def resolve_torch_device(requested: str | None = None) -> str:
    """Return the torch device string to place models on (``cuda:0``, ``cpu``...).

    The default request (from settings) is probed once per process; an explicit
    ``requested`` value is resolved fresh.
    """
    global _cached_status
    if requested is not None:
        return accelerator_status(requested)["selected_device"]
    with _lock:
        if _cached_status is None:
            _cached_status = accelerator_status()
        return _cached_status["selected_device"]


def lightning_accelerator(device: str) -> tuple[str, int | list[int]]:
    """Map a torch device string to Lightning ``(accelerator, devices)``."""
    if device.startswith("cuda"):
        _, _, index = device.partition(":")
        return "gpu", [int(index)] if index.isdigit() else 1
    if device == "mps":
        return "mps", 1
    return "cpu", 1


def reset_cache() -> None:
    """Forget the probed device (tests change settings between cases)."""
    global _cached_status
    with _lock:
        _cached_status = None
