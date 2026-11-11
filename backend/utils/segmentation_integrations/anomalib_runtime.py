"""Real Anomalib inference for trained checkpoints, on the GPU when one is present.

A trained Anomalib Lightning checkpoint (PatchCore, PaDiM, EfficientAD, ...) is
loaded with ``weights_only=True``, which restricts unpickling to tensors and the
types Anomalib allowlists, and is placed on the device chosen by
``utils.accelerator.resolve_torch_device`` (``VISTA_MODEL_SERVICE_DEVICE``).
Untrained requests (no checkpoint, or the registered default PatchCore) keep
using the dependency-free scorer in ``anomalib_backend``.
"""

from __future__ import annotations

import inspect
import threading
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..accelerator import resolve_torch_device

_MODEL_CACHE: dict[tuple[str, str, float, str], Any] = {}
_MODEL_CACHE_LOCK = threading.Lock()


def bbox_from_mask(mask: np.ndarray) -> list[float] | None:
    """Return ``[x, y, width, height]`` around the true pixels of ``mask``."""
    y_indices, x_indices = np.where(mask)
    if len(x_indices) == 0 or len(y_indices) == 0:
        return None
    x_min, y_min = int(x_indices.min()), int(y_indices.min())
    x_max, y_max = int(x_indices.max()) + 1, int(y_indices.max()) + 1
    return [float(x_min), float(y_min), float(x_max - x_min), float(y_max - y_min)]


def resolve_device(accelerator: Any = None) -> str:
    """Map the ``accelerator`` option (auto, cpu, gpu, cuda:N, mps) to a device."""
    value = str(accelerator or "auto").strip().lower()
    if value in ("", "auto"):
        return resolve_torch_device()
    if value in ("gpu", "cuda"):
        selected = resolve_torch_device()
        return selected if selected.startswith("cuda") else "cuda:0"
    return value


def model_class(model_name: str) -> type:
    """Return the Anomalib model class for a name such as ``patchcore``."""
    from anomalib import models  # noqa: PLC0415
    from anomalib.models.components import AnomalibModule  # noqa: PLC0415

    wanted = model_name.replace("_", "").replace("-", "").lower()
    for name in getattr(models, "__all__", dir(models)):
        candidate = getattr(models, name, None)
        if (
            inspect.isclass(candidate)
            and issubclass(candidate, AnomalibModule)
            and name.lower() == wanted
        ):
            return candidate
    raise ValueError(f"Unknown Anomalib model: {model_name}")


def load_model(model_name: str, checkpoint_path: str, device: str) -> Any:
    """Load (once per process) a trained checkpoint onto ``device`` for inference."""
    path = Path(checkpoint_path)
    if not path.is_file():
        raise FileNotFoundError(f"Anomalib checkpoint not found: {checkpoint_path}")
    cache_key = (model_name.lower(), str(path.resolve()), path.stat().st_mtime, device)
    with _MODEL_CACHE_LOCK:
        cached = _MODEL_CACHE.get(cache_key)
        if cached is not None:
            return cached
        cls = model_class(model_name)
        overrides = {}
        # The checkpoint already holds the backbone weights; do not let the
        # constructor download pretrained ones first.
        if "pre_trained" in inspect.signature(cls.__init__).parameters:
            overrides["pre_trained"] = False
        model = cls.load_from_checkpoint(
            str(path), map_location=device, weights_only=True, **overrides
        )
        model.eval().to(device)
        _MODEL_CACHE[cache_key] = model
        return model


def load_runtime() -> tuple[type, type]:
    """Return the ``(runtime, input)`` classes for trained Anomalib checkpoints."""
    import torch  # noqa: PLC0415

    class RuntimeAnomalibInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class RuntimeAnomalibModel:
        def __init__(self, **config):
            checkpoint_path = str(config.get("checkpoint_path") or "").strip()
            if not checkpoint_path:
                raise ValueError("Anomalib inference needs a trained checkpoint")
            self.config = config
            self.model_name = str(config.get("model_name") or "patchcore")
            self.device = resolve_device(config.get("accelerator"))
            self.model = load_model(self.model_name, checkpoint_path, self.device)

        def run(self, data):
            image = (
                data.image
                if getattr(data, "image", None) is not None
                else Image.open(data.source)
            ).convert("RGB")
            width, height = image.size
            tensor = (
                torch.from_numpy(np.asarray(image, dtype=np.uint8).copy())
                .permute(2, 0, 1)
                .float()
                .div(255.0)
                .unsqueeze(0)
                .to(self.device)
            )
            with torch.inference_mode():
                output = self.model(tensor)
            heatmap = _resized_map(output.anomaly_map, height, width)
            mask = _resized_mask(output.pred_mask, height, width)
            if mask is None:
                mask = heatmap >= float(self.config.get("threshold", 0.5))
            score = output.pred_score
            anomaly_score = float(score.flatten()[0]) if score is not None else None
            bbox = bbox_from_mask(mask)
            masks = []
            if bbox is not None:
                masks.append(
                    {
                        "bbox": bbox,
                        "area": bbox[2] * bbox[3],
                        "score": 1.0,
                        "label": self.model_name,
                    }
                )
            return type(
                "AnomalibModelResult",
                (),
                {
                    "mode": getattr(data, "mode", "default"),
                    "metadata": {
                        "backend": "anomalib",
                        "runtime": f"anomalib.{type(self.model).__name__}",
                        "model_name": self.model_name,
                        "device": self.device,
                        "heatmap": heatmap.tolist(),
                        "anomaly_score": anomaly_score,
                        "masks": masks,
                    },
                },
            )()

    return RuntimeAnomalibModel, RuntimeAnomalibInput


def _resized_map(anomaly_map: Any, height: int, width: int) -> np.ndarray:
    """Resize the model's anomaly map to the image and scale it to 0..1."""
    import torch.nn.functional as functional  # noqa: PLC0415

    if anomaly_map is None:
        return np.zeros((height, width), dtype=np.float32)
    values = anomaly_map.detach().float().reshape(1, 1, *anomaly_map.shape[-2:])
    values = functional.interpolate(
        values, size=(height, width), mode="bilinear", align_corners=False
    )[0, 0]
    low, high = float(values.min()), float(values.max())
    if high <= low:
        return np.zeros((height, width), dtype=np.float32)
    return ((values - low) / (high - low)).clamp(0, 1).cpu().numpy()


def _resized_mask(pred_mask: Any, height: int, width: int) -> np.ndarray | None:
    import torch.nn.functional as functional  # noqa: PLC0415

    if pred_mask is None:
        return None
    values = pred_mask.detach().float().reshape(1, 1, *pred_mask.shape[-2:])
    values = functional.interpolate(values, size=(height, width), mode="nearest")
    return values[0, 0].cpu().numpy() >= 0.5
