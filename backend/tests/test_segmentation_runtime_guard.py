"""Every local segmentation backend must honor the native runtime disable flag."""

import base64
import importlib
import io
import pkgutil

import pytest
from backend.utils import segmentation_integrations
from backend.utils.segmentation_integrations._shared import SegmentationBackend
from PIL import Image, ImageDraw

from core.config import settings

_PACKAGE = "backend.utils.segmentation_integrations"

# Options that would load the native runtime if the flag were ignored. A
# configured checkpoint or non-default model is deliberately not an opt-in.
_BACKEND_CASES = {
    "anomalib_backend": [
        {"model_name": "padim", "checkpoint_path": "/tmp/padim.ckpt"},
        {"model_name": "patchcore"},
    ],
    "opencv_backend": [{"min_peak_distance_px": 1}],
    "sam_backend": [
        {"model_checkpoint": "/tmp/sam-test.pth", "box": [3, 4, 8, 10]},
    ],
    "yolo_backend": [{"model": "yolo11n-seg.pt"}],
}


def _backend_module_names() -> set[str]:
    return {
        info.name
        for info in pkgutil.iter_modules(segmentation_integrations.__path__)
        if info.name.endswith("_backend")
    }


def _encoded_test_image() -> str:
    image = Image.new("RGB", (20, 16), "black")
    ImageDraw.Draw(image).rectangle([3, 4, 7, 9], fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_every_backend_module_is_covered_by_the_guard_test():
    assert _backend_module_names() == set(_BACKEND_CASES)


@pytest.mark.parametrize("module_name", sorted(_backend_module_names()))
def test_backend_run_is_the_shared_guarded_runner(module_name):
    module = importlib.import_module(f"{_PACKAGE}.{module_name}")

    backend = module.BACKEND
    assert isinstance(backend, SegmentationBackend)
    assert module.run == backend.run
    assert backend.module_name == module.__name__
    assert callable(getattr(module, backend.loader_name))


@pytest.mark.parametrize(
    ("module_name", "options"),
    [
        (module_name, options)
        for module_name, cases in sorted(_BACKEND_CASES.items())
        for options in cases
    ],
)
def test_disabled_flag_never_calls_unpatched_runtime_loader(
    module_name, options, monkeypatch
):
    module = importlib.import_module(f"{_PACKAGE}.{module_name}")
    calls = []

    def sentinel_loader():
        calls.append(module_name)
        raise AssertionError(f"{module_name} loaded its native runtime")

    # Owned by the backend module, so the guard treats it as the real loader.
    sentinel_loader.__module__ = module.__name__
    monkeypatch.setattr(module, module.BACKEND.loader_name, sentinel_loader)
    monkeypatch.setattr(settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", True)

    result = module.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": dict(options),
        }
    )

    assert calls == []
    assert result["masks"]
