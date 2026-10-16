import base64
import io
import subprocess

from backend.tests.analyze_segmentation_fakes import ToolkitSegmentationInput
from backend.tests.test_segmentation_integrations import _encoded_test_image
from backend.utils.segmentation_integrations import opencv_backend
from PIL import Image
from pydantic import BaseModel

from core.config import settings


def test_opencv_adapter_is_drop_in_for_strict_deployment_class(monkeypatch):
    calls = {}

    class ExternalOutput(BaseModel):
        backend: str = "external-opencv"
        mode: str = "watershed"
        masks: list = []

    class StrictExternalOpenCV:
        def __init__(
            self,
            *,
            min_mask_area_px=1.0,
            min_peak_distance_px=20,
            mean_shift_sp=21,
            mean_shift_sr=51,
        ):
            calls["config"] = {
                "min_mask_area_px": min_mask_area_px,
                "min_peak_distance_px": min_peak_distance_px,
                "mean_shift_sp": mean_shift_sp,
                "mean_shift_sr": mean_shift_sr,
            }

        def run(self, data):
            calls["data"] = data
            return ExternalOutput()

    monkeypatch.setattr(
        opencv_backend,
        "_load_opencv_runtime",
        lambda: (StrictExternalOpenCV, ToolkitSegmentationInput),
    )
    output = opencv_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"min_mask_area_px": 8, "model": "must-not-be-forwarded"},
        }
    )

    assert output.backend == "external-opencv"
    assert calls["config"] == {
        "min_mask_area_px": 8,
        "min_peak_distance_px": 20,
        "mean_shift_sp": 21,
        "mean_shift_sr": 51,
    }
    assert calls["data"].file is None
    assert calls["data"].run_mode == "default"
    assert calls["data"].image.shape == (16, 20, 3)

    red = Image.new("RGB", (1, 1), "red")
    buffer = io.BytesIO()
    red.save(buffer, format="PNG")
    opencv_backend.run(
        {
            "image_data_base64": base64.b64encode(buffer.getvalue()).decode(),
            "options": {},
        }
    )
    assert calls["data"].image[0, 0].tolist() == [0, 0, 255]


def test_opencv_adapter_returns_fallback_output_when_runtime_fails(monkeypatch):
    def fail_loader():
        raise RuntimeError("cv2 import failed")

    monkeypatch.setattr(opencv_backend, "_load_opencv_runtime", fail_loader)

    output = opencv_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"min_peak_distance_px": 1},
        }
    )

    assert output["backend"] == "opencv"
    assert output["mode"] == "default"
    assert output["metrics"]["runtime"] == "analysis_toolkit.opencv_fallback"
    assert "cv2 import failed" in output["metrics"]["fallback_reason"]
    assert "OpenCV runtime failed" in output["metrics"]["runtime_warning"]
    assert output["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_opencv_adapter_returns_fallback_when_subprocess_crashes(monkeypatch):
    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(
            args=args, returncode=134, stdout="", stderr="Aborted"
        )

    def unpatched_loader():
        raise AssertionError("the subprocess path must not load OpenCV in-process")

    # A loader owned by the backend module counts as unpatched, which selects the
    # subprocess path; the runtime flag must be off for that path to run at all.
    unpatched_loader.__module__ = opencv_backend.__name__
    monkeypatch.setattr(opencv_backend, "_load_opencv_runtime", unpatched_loader)
    monkeypatch.setattr(settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", False)
    monkeypatch.setattr(opencv_backend.subprocess, "run", fake_run)

    output = opencv_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"min_peak_distance_px": 1},
        }
    )

    assert output["backend"] == "opencv"
    assert output["metrics"]["runtime"] == "analysis_toolkit.opencv_fallback"
    assert "OpenCV subprocess failed: Aborted" in output["metrics"]["fallback_reason"]
    assert output["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]
