"""Segmentation integration adapter tests: OpenCV, SAM, YOLO, Anomalib, and FastAPI."""

import base64
import importlib
import io
import os
import subprocess
import sys
import textwrap
import uuid
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import requests
from backend.analyze_toolbox.segmentation import (
    SegmentationComponent,
    SegmentationInput,
)
from backend.tests.analyze_segmentation_fakes import (
    NativeOpenCVSegmentation,
    NativeOpenCVSegmentationConfig,
    ToolkitSegmentationInput,
)
from backend.tests.runtime_flags import native_segmentation_runtime_enabled
from backend.utils.segmentation_integrations import (
    anomalib_backend,
    opencv_backend,
    sam_backend,
    yolo_backend,
)
from PIL import Image, ImageDraw
from pydantic import BaseModel


def _encoded_test_image() -> str:
    image = Image.new("RGB", (20, 16), "black")
    draw = ImageDraw.Draw(image)
    draw.rectangle([3, 4, 7, 9], fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_real_opencv_runtime_smoke_in_subprocess():
    """Exercise the operational OpenCV import without crashing this worker."""
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to import native "
            "segmentation runtimes"
        )

    script = textwrap.dedent(
        """
        import base64
        import io
        import json
        from PIL import Image, ImageDraw
        from backend.utils.segmentation_integrations import opencv_backend

        image = Image.new("RGB", (20, 16), "black")
        draw = ImageDraw.Draw(image)
        draw.rectangle([3, 4, 7, 9], fill="white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        result = opencv_backend.run({
            "image_data_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "mode": "default",
            "options": {"min_peak_distance_px": 1},
        })
        payload = (
            result.model_dump(mode="python")
            if hasattr(result, "model_dump")
            else result
        )
        assert payload["backend"] == "opencv", payload
        assert payload["mode"] == "watershed", payload
        assert payload["metrics"]["runtime"] == "analysis_toolkit.opencv", payload
        assert payload["masks"], payload
        print(json.dumps({"bbox": payload["masks"][0]["bbox"]}))
        """
    )
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repo_root,
        env=env,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )

    assert completed.returncode == 0, (
        "Operational OpenCV runtime failed in an isolated subprocess. "
        "This would break the deployed analysis path, but the failure was "
        "contained so pytest workers stay alive.\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )


def test_documented_opencv_local_import_path_uses_fake_runtime_under_pytest():
    """Load the fake OpenCV runtime for the documented import path under pytest."""
    if native_segmentation_runtime_enabled():
        pytest.skip(
            "native runtime opt-in intentionally bypasses the fake OpenCV runtime"
        )
    top_level_opencv_backend = importlib.import_module(
        "utils.segmentation_integrations.opencv_backend"
    )
    runtime = top_level_opencv_backend._load_opencv_runtime()
    assert runtime == (NativeOpenCVSegmentation, ToolkitSegmentationInput)


@pytest.mark.parametrize(
    ("backend", "function_path", "expected_label"),
    [
        (
            "yolo",
            "utils.segmentation_integrations.yolo_backend.run",
            "yolo-fallback-object",
        ),
        ("opencv", "utils.segmentation_integrations.opencv_backend.run", "region_1"),
        ("sam", "utils.segmentation_integrations.sam_backend.run", "sam-region"),
        (
            "anomalib",
            "utils.segmentation_integrations.anomalib_backend.run",
            "patchcore",
        ),
    ],
)
def test_local_import_segmentation_adapters_return_shared_output_shape(
    backend, function_path, expected_label
):
    """Return the shared output shape from every local-import adapter."""
    options = {
        "integration_mode": "local_import",
        "function_path": function_path,
        "model": f"{backend}-example-model",
    }
    if backend == "opencv":
        options["min_peak_distance_px"] = 1
    if backend == "sam":
        options["box"] = [3, 4, 8, 10]
    request = SegmentationInput(
        image_data_base64=_encoded_test_image(),
        backend=backend,
        mode="default",
        options=options,
    )

    result = SegmentationComponent().run(request)

    assert result.backend == backend
    assert result.mode == ("watershed" if backend == "opencv" else "default")
    if backend == "opencv":
        assert result.metrics["runtime"] == "analysis_toolkit.opencv"
    elif backend == "sam":
        assert result.metrics["runtime"] == "analysis_toolkit.sam_fallback"
    elif backend == "yolo":
        assert result.metrics["runtime"] in {
            "analysis_toolkit.yolo",
            "analysis_toolkit.yolo_fallback",
        }
    elif backend == "anomalib":
        assert result.metrics["runtime"] in {
            "analysis_toolkit.anomalib",
            "vista.patchcore",
        }
    else:
        assert result.metrics["runtime"] == f"{backend}_placeholder"
    assert len(result.masks) == 1
    mask = result.masks[0]
    assert mask.label == expected_label
    if backend == "opencv":
        assert mask.score is None
        assert mask.bbox == [3.0, 4.0, 5.0, 6.0]
    elif backend in {"sam", "yolo", "anomalib"}:
        assert mask.score is not None
        assert mask.bbox == [3.0, 4.0, 5.0, 6.0]
    assert mask.area == (30.0 if backend in {"sam", "yolo", "anomalib"} else 20.0)


def test_sam_local_import_adapter_segments_prompted_box_with_toolkit_fallback():
    """Segment a prompted box through the SAM adapter's toolkit fallback."""
    request = SegmentationInput(
        image_data_base64=_encoded_test_image(),
        backend="sam",
        mode="default",
        prompts={"box": [2, 3, 12, 13]},
        options={
            "integration_mode": "local_import",
            "function_path": "utils.segmentation_integrations.sam_backend.run",
            "model": "sam-example-model",
        },
    )

    result = SegmentationComponent().run(request)

    assert result.backend == "sam"
    assert result.mode == "default"
    assert result.metrics["runtime"] == "analysis_toolkit.sam_fallback"
    assert "model_checkpoint" in result.metrics["fallback_reason"]
    assert len(result.masks) == 1
    mask = result.masks[0]
    assert mask.label == "sam-region"
    assert mask.bbox == [2.0, 3.0, 10.0, 10.0]
    assert mask.area == 100.0


def test_sam_default_fallback_segments_foreground_without_prompt():
    """Segment the foreground with the default SAM fallback when no prompt is given."""
    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="sam",
            mode="default",
            options={
                "integration_mode": "local_import",
                "function_path": "utils.segmentation_integrations.sam_backend.run",
            },
        )
    )

    assert result.backend == "sam"
    assert result.metrics["runtime"] == "analysis_toolkit.sam_fallback"
    assert result.masks[0].bbox == [3.0, 4.0, 5.0, 6.0]
    assert result.masks[0].area == 30.0


def test_sam_fallback_without_checkpoint_does_not_import_runtime(monkeypatch):
    """Use the SAM fallback without importing the runtime when no checkpoint is set."""

    def fail_loader():
        raise AssertionError("SAM runtime should stay lazy without a checkpoint")

    monkeypatch.setattr(sam_backend, "_load_sam_runtime", fail_loader)

    result = sam_backend.run(
        {"image_data_base64": _encoded_test_image(), "mode": "default", "options": {}}
    )

    assert result["metrics"]["runtime"] == "analysis_toolkit.sam_fallback"
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_sam_with_checkpoint_stays_lazy_while_native_runtime_is_disabled(monkeypatch):
    """A configured checkpoint must not load native SAM when the flag disables it.

    Loading the real ViT-B runtime costs multiple GB per process, which had been
    exhausting memory and killing pytest-xdist workers in CI once a default
    checkpoint was auto-injected into the workflow.
    """
    from core.config import settings

    monkeypatch.setattr(settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", True)

    # The loader itself is deliberately left unpatched: the shared runtime gate treats a
    # patched loader as an explicit opt-in, so patching here would bypass the gate
    # being tested and pass for the wrong reason.
    result = sam_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"box": [3, 4, 8, 10], "model_checkpoint": "/tmp/sam-test.pth"},
        }
    )

    assert result["metrics"]["runtime"] == "analysis_toolkit.sam_fallback"
    reason = result["metrics"]["fallback_reason"]
    assert "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME" in reason
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_real_sam_runtime_import_smoke_in_subprocess():
    """Exercise the operational SAM import without crashing this worker."""
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to import native "
            "segmentation runtimes"
        )

    script = textwrap.dedent(
        """
        from backend.utils.segmentation_integrations import sam_backend
        sam_segmentation_cls, sam_input_cls = sam_backend._load_sam_runtime()
        assert sam_segmentation_cls.__name__ == "RuntimeSAMSegmentation"
        assert sam_input_cls.__name__ == "RuntimeSAMSegmentationInput"
        print("sam-runtime-import-ok")
        """
    )
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repo_root,
        env=env,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )

    assert completed.returncode == 0, (
        "Operational SAM runtime failed in an isolated subprocess. "
        "This would break the deployed analysis path, but the failure was "
        "contained so pytest workers stay alive.\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )


def test_real_yolo_runtime_smoke_in_subprocess():
    """Exercise the operational YOLO adapter without crashing this worker."""
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to import native "
            "segmentation runtimes"
        )

    script = textwrap.dedent(
        """
        import base64
        import json
        from pathlib import Path
        from ultralytics.utils import ASSETS
        from backend.utils.segmentation_integrations import yolo_backend

        image_data = (Path(ASSETS) / "bus.jpg").read_bytes()
        result = yolo_backend.run({
            "image_data_base64": base64.b64encode(image_data).decode("ascii"),
            "mode": "predict",
            "options": {"model": "yolo11n-seg.pt", "confidence": 0.25, "imgsz": 640},
        })
        assert result["backend"] == "yolo", result
        assert result["metrics"]["runtime"] == "analysis_toolkit.yolo", result
        assert result["masks"], result
        assert result["masks"][0]["label"] == "bus", result
        print(json.dumps({
            "runtime": result["metrics"]["runtime"],
            "bbox": result["masks"][0]["bbox"],
        }))
        """
    )
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repo_root,
        env=env,
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode == 0, (
        "Operational YOLO runtime failed in an isolated subprocess. "
        "This would break the deployed analysis path, but the failure was "
        "contained so pytest workers stay alive.\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )


def test_real_anomalib_runtime_smoke_in_subprocess():
    """Exercise the operational Anomalib adapter without crashing this worker."""
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to import native "
            "segmentation runtimes"
        )

    script = textwrap.dedent(
        """
        import base64
        import io
        import json
        from PIL import Image, ImageDraw
        from backend.utils.segmentation_integrations import anomalib_backend

        image = Image.new("RGB", (20, 16), "black")
        draw = ImageDraw.Draw(image)
        draw.rectangle([3, 4, 7, 9], fill="white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        result = anomalib_backend.run({
            "image_data_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "mode": "default",
            "options": {"model_name": "patchcore", "threshold": 0.5},
        })
        assert result["backend"] == "anomalib", result
        assert result["metrics"]["runtime"] == "vista.patchcore", result
        assert result["masks"], result
        print(json.dumps({
            "runtime": result["metrics"]["runtime"],
            "bbox": result["masks"][0]["bbox"],
        }))
        """
    )
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_root) + os.pathsep + env.get("PYTHONPATH", "")
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repo_root,
        env=env,
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode == 0, (
        "Operational Anomalib runtime failed in an isolated subprocess. "
        "This would break the deployed analysis path, but the failure was "
        "contained so pytest workers stay alive.\n"
        f"stdout:\n{completed.stdout}\n"
        f"stderr:\n{completed.stderr}"
    )


def test_default_patchcore_runtime_is_available_without_native_opt_in():
    """Run the default PatchCore runtime without the native-runtime opt-in."""
    result = anomalib_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"model_name": "patchcore", "threshold": 0.5},
        }
    )

    assert result["backend"] == "anomalib"
    assert result["metrics"] == {"runtime": "vista.patchcore", "mask_count": 1}
    assert result["masks"][0]["label"] == "patchcore"
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


@pytest.mark.parametrize("backend", ["opencv", "yolo", "anomalib", "sam"])
def test_default_placeholder_dispatches_to_replaceable_imglib(backend, monkeypatch):
    """Dispatch the default placeholder to the replaceable imglib implementation."""
    if backend == "yolo":
        from core.config import settings

        monkeypatch.setattr(settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", True)
    options = {"min_peak_distance_px": 1} if backend == "opencv" else {}
    if backend == "sam":
        options = {"box": [3, 4, 8, 10]}
    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(), backend=backend, options=options
        )
    )

    assert len(result.masks) == 1
    if backend in {"opencv", "sam", "yolo", "anomalib"}:
        assert result.masks[0].bbox == [3.0, 4.0, 5.0, 6.0]


@pytest.mark.parametrize("source", ["image", "file", "data_uri"])
def test_placeholder_accepts_every_supported_image_source(source, tmp_path):
    """Accept every supported image source in the placeholder component."""
    image = Image.open(io.BytesIO(base64.b64decode(_encoded_test_image())))
    kwargs = {"image": image}
    if source == "file":
        path = tmp_path / "source.png"
        image.save(path)
        kwargs = {"file": str(path)}
    elif source == "data_uri":
        kwargs = {"image_data_base64": f"data:image/png;base64,{_encoded_test_image()}"}

    result = SegmentationComponent().run(
        SegmentationInput(
            backend="opencv", options={"min_peak_distance_px": 1}, **kwargs
        )
    )

    assert result.masks[0].bbox == [3.0, 4.0, 5.0, 6.0]


def test_sam_option_overrides_duplicate_prompt_without_crashing():
    """Let a SAM option override a duplicate prompt without crashing."""
    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="sam",
            prompts={"box": [1, 1, 2, 2]},
            options={"box": [3, 3, 4, 4]},
        )
    )
    assert len(result.masks) == 1


def test_opencv_placeholder_matches_deployment_class_contract():
    """Match the deployment class contract in the OpenCV placeholder."""
    config = NativeOpenCVSegmentationConfig(
        min_mask_area_px=2.5,
        min_peak_distance_px=4,
        mean_shift_sp=5,
        mean_shift_sr=6,
    )
    segmenter = NativeOpenCVSegmentation.from_config(config)
    image = Image.new("RGB", (20, 16), "black")
    draw = ImageDraw.Draw(image)
    draw.rectangle([3, 4, 7, 9], fill="white")
    data = ToolkitSegmentationInput(
        file=None,
        image=np.asarray(image)[:, :, ::-1].copy(),
        run_mode="default",
    )

    result = segmenter._run(data)

    assert segmenter.config == config
    assert result.backend == "opencv"
    assert result.mode == "watershed"
    assert result.masks[0].bbox == [3.0, 4.0, 5.0, 6.0]


def test_opencv_placeholder_rejects_mode_not_supported_by_deployment():
    """Reject a mode the deployment class does not support in the placeholder."""
    data = ToolkitSegmentationInput(
        file=None, image=np.zeros((4, 4, 3)), run_mode="other"
    )
    with pytest.raises(ValueError, match="Unsupported OpenCV segmentation mode: other"):
        NativeOpenCVSegmentation()._run(data)


def test_opencv_adapter_accepts_file_like_payload_without_treating_it_as_a_path():
    """Accept a file-like payload in the OpenCV adapter instead of reading a path."""
    image_bytes = base64.b64decode(_encoded_test_image())

    result = opencv_backend.run(
        {
            "file": io.BytesIO(image_bytes),
            "mode": "default",
            "options": {"min_peak_distance_px": 1},
        }
    )

    payload = (
        result.model_dump(mode="python") if hasattr(result, "model_dump") else result
    )
    assert payload["backend"] == "opencv"
    assert payload["mode"] == "watershed"
    assert payload["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_sam_adapter_accepts_file_like_payload_without_treating_it_as_a_path():
    """Accept a file-like payload in the SAM adapter instead of reading a path."""
    image_bytes = base64.b64decode(_encoded_test_image())

    result = sam_backend.run(
        {
            "file": io.BytesIO(image_bytes),
            "mode": "default",
            "options": {"box": [3, 4, 8, 10]},
        }
    )

    assert result["backend"] == "sam"
    assert result["metrics"]["runtime"] == "analysis_toolkit.sam_fallback"
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_sam_adapter_normalizes_toolkit_mask_arrays(monkeypatch):
    """Normalize the toolkit mask arrays returned to the SAM adapter."""

    class FakeSAMSegmentation:
        def __init__(self, **config):
            assert config["model_checkpoint"] == "/tmp/sam-test.pth"

        def _run(self, data):
            assert data.image.shape == (16, 20, 3)
            mask = np.zeros((16, 20), dtype=bool)
            mask[4:10, 3:8] = True
            return SimpleNamespace(
                backend="SAM",
                mode="predict",
                masks=np.asarray([mask]),
                raw_output={"scores": np.asarray([0.75])},
            )

    class FakeSAMSegmentationInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    monkeypatch.setattr(
        sam_backend,
        "_load_sam_runtime",
        lambda: (FakeSAMSegmentation, FakeSAMSegmentationInput),
    )

    result = sam_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "predict",
            "options": {
                "model_checkpoint": "/tmp/sam-test.pth",
                "point_coords": [[5, 6]],
                "point_labels": [1],
            },
        }
    )

    assert result["backend"] == "sam"
    assert result["mode"] == "predict"
    assert result["metrics"]["runtime"] == "analysis_toolkit.sam"
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]
    assert result["masks"][0]["area"] == 30.0
    assert result["masks"][0]["score"] == 0.75


def test_yolo_adapter_calls_toolkit_runtime_and_normalizes_boxes(monkeypatch):
    """Call the toolkit runtime from the YOLO adapter and normalize its boxes."""
    calls = {}

    class FakeYOLOInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class FakeYOLO:
        def __init__(self, **config):
            calls["config"] = config

        def run(self, data):
            calls["data"] = data
            return SimpleNamespace(
                mode="predict",
                metadata={
                    "backend": "YOLO",
                    "masks": [
                        {
                            "bbox": [3, 4, 5, 6],
                            "area": 30,
                            "score": 0.82,
                            "label": "defect",
                        }
                    ],
                },
            )

    monkeypatch.setattr(
        yolo_backend, "_load_yolo_runtime", lambda: (FakeYOLO, FakeYOLOInput)
    )

    result = yolo_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"model": "custom.pt", "confidence": 0.4},
        }
    )

    assert calls["config"] == {"pretrained_model": "custom.pt"}
    assert calls["data"].mode == "default"
    assert calls["data"].image.shape == (16, 20, 3)
    assert calls["data"].conf == 0.4
    assert result["backend"] == "yolo"
    assert result["metrics"]["runtime"] == "analysis_toolkit.yolo"
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_anomalib_adapter_calls_toolkit_runtime_and_normalizes_masks(monkeypatch):
    """Call the toolkit runtime from the Anomalib adapter and normalize its masks."""
    calls = {}

    class FakeInput:
        def __init__(self, **values):
            self.__dict__.update(values)

    class FakeAnomalib:
        def __init__(self, **config):
            calls["config"] = config

        def run(self, data):
            calls["data"] = data
            return SimpleNamespace(
                mode="inference",
                metadata={
                    "backend": "anomalib",
                    "masks": [
                        {
                            "bbox": [3, 4, 5, 6],
                            "area": 30,
                            "score": 0.91,
                            "label": "anomaly",
                        }
                    ],
                },
            )

    monkeypatch.setattr(
        anomalib_backend, "_load_anomalib_runtime", lambda: (FakeAnomalib, FakeInput)
    )

    result = anomalib_backend.run(
        {
            "image_data_base64": _encoded_test_image(),
            "mode": "default",
            "options": {"model_name": "padim", "threshold": 0.6},
        }
    )

    assert calls["config"] == {
        "model_name": "padim",
        "threshold": 0.6,
        "min_mask_area_px": 1.0,
        "accelerator": "cpu",
        "devices": 1,
        "return_predictions": True,
        "batch_size": 1,
    }
    assert calls["data"].mode == "default"
    assert calls["data"].image.size == (20, 16)
    assert result["backend"] == "anomalib"
    assert result["metrics"]["runtime"] == "analysis_toolkit.anomalib"
    assert result["masks"][0]["bbox"] == [3.0, 4.0, 5.0, 6.0]


def test_fastapi_segmentation_sends_capvision_payload_and_normalizes_predictions(
    monkeypatch,
):
    """Send a CapVision payload through FastAPI and normalize the predictions."""
    calls = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "success": True,
                "data": {
                    "result": [
                        {
                            "category": "example-defect",
                            "confidence": 0.88,
                            "box": {"x1": 3, "y1": 4, "x2": 8, "y2": 10},
                        }
                    ]
                },
            }

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            calls["url"] = url
            calls["json"] = json
            calls["timeout"] = timeout
            return FakeResponse()

        def get(self, url, timeout):
            calls["jobs_url"] = url
            return FakeResponse()

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )

    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="fastapi",
            mode="default",
            metadata={"filename": "vista-slice.png"},
            options={
                "integration_mode": "fastapi",
                "fastapi_url": "https://capvision.example/api/v1/process",
                "request_format": "capvision_process",
                "timeout_seconds": 12,
                "serial_num": "SN-1",
                "lot_num": "LOT-1",
            },
        )
    )

    assert calls["url"] == "https://capvision.example/api/v1/process"
    assert calls["timeout"] == 12
    assert calls["json"]["data"]["filename"] == "vista-slice.png"
    assert calls["json"]["data"]["image_data_base64"] == _encoded_test_image()
    assert calls["json"]["data"]["imgs"] == [
        {"filename": "vista-slice.png", "image_data_base64": _encoded_test_image()}
    ]
    assert calls["json"]["data"]["serial_num"] == "SN-1"
    assert calls["json"]["data"]["lot_num"] == "LOT-1"
    assert result.backend == "fastapi"
    assert result.metrics == {"runtime": "remote_fastapi", "prediction_count": 1}
    assert result.masks[0].label == "example-defect"
    assert result.masks[0].bbox == [3.0, 4.0, 5.0, 6.0]
    assert result.masks[0].score == 0.88


def test_fastapi_remote_block_forces_fastapi_dispatch(monkeypatch):
    """Force FastAPI dispatch when the parameters include a remote block."""
    from backend.analyze_toolbox import (
        WorkflowGraph,
        WorkflowImageInput,
        execute_image_workflow,
    )

    calls = {}

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            calls["url"] = url
            calls["json"] = json
            calls["timeout"] = timeout
            return FakeResponse({"job_id": "job-1", "status": "queued"})

        def get(self, url, timeout):
            calls["jobs_url"] = url
            return FakeResponse(
                {
                    "job_id": "job-1",
                    "status": "completed",
                    "uploaded_outputs": ["prediction.npy"],
                }
            )

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )
    monkeypatch.setattr(
        "backend.utils.boto3_client.get_presigned_download_url",
        lambda bucket_name, object_name, expires_delta: (
            f"https://download/{bucket_name}/{object_name}"
        ),
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_download_url",
        lambda bucket_name, object_name, expires_delta: (
            f"https://download/{bucket_name}/{object_name}"
        ),
    )
    monkeypatch.setattr(
        "backend.utils.boto3_client.get_presigned_upload_url",
        lambda bucket_name, object_name, expires_delta, content_type: (
            f"https://upload/{bucket_name}/{object_name}"
        ),
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_upload_url",
        lambda bucket_name, object_name, expires_delta, content_type: (
            f"https://upload/{bucket_name}/{object_name}"
        ),
    )
    workflow = WorkflowGraph.model_validate(
        {
            "name": "FastAPI remote block smoke",
            "source": {"kind": "manual_selection", "image_count": 1, "part_count": 1},
            "nodes": [
                {
                    "id": "input",
                    "method_id": "source.project_part_images",
                    "parameters": {},
                },
                {
                    "id": "remote",
                    "method_id": "segmentation.fastapi.remote",
                    "parameters": {
                        "fastapi_url": "http://127.0.0.1:8001/segment",
                    },
                },
            ],
            "edges": [{"source_node": "input", "target_node": "remote"}],
        }
    )
    image = Image.new("RGB", (20, 16), "black")
    draw = ImageDraw.Draw(image)
    draw.rectangle([3, 4, 7, 9], fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    result = execute_image_workflow(
        workflow,
        [
            WorkflowImageInput(
                image_id=uuid.uuid4(),
                filename="fastapi.png",
                content_type="image/png",
                data=buffer.getvalue(),
                metadata={"object_storage_key": "test-key"},
            )
        ],
    )

    node = next(item for item in result.node_results if item.node_id == "remote")
    assert result.status == "completed"
    assert calls["url"] == "http://127.0.0.1:8001/segment"
    assert calls["json"]["input"] == {
        "download_url": "https://download/test-bucket/test-key",
        "filename": "vista-analysis-image.png",
    }
    assert calls["json"]["disable_proxy"] is True
    assert calls["timeout"] == 60
    assert node.summary["metrics"]["runtime"] == "gpu_inference_api.job"
    assert node.summary["metrics"]["job_id"] == "job-1"
    assert node.summary["metrics"]["job_status"] == "completed"
    assert calls["jobs_url"] == "http://127.0.0.1:8001/jobs/job-1"


def test_fastapi_remote_uploaded_prediction_becomes_overlay_artifact(monkeypatch):
    """Turn a prediction uploaded by the remote service into an overlay artifact."""
    from backend.analyze_toolbox import (
        WorkflowGraph,
        WorkflowImageInput,
        execute_image_workflow,
    )

    from utils import boto3_client as object_storage

    prediction_key = "vista/analyze/predictions/run-1/prediction.npy"

    class FakeResponse:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            return FakeResponse({"job_id": "job-1", "status": "queued"})

        def get(self, url, timeout):
            return FakeResponse(
                {
                    "job_id": "job-1",
                    "status": "completed",
                    "return_code": 0,
                    "logs": ["done"],
                    "uploaded_outputs": [
                        {
                            "kind": "prediction",
                            "object_key": prediction_key,
                            "filename": "prediction.npy",
                            "size_bytes": 960,
                        },
                    ],
                }
            )

    class FakeS3Client:
        def download_fileobj(self, bucket, key, fileobj):
            assert key == prediction_key
            prediction = np.zeros((3, 16, 20), dtype=np.uint8)
            prediction[1, 4:10, 3:8] = 2
            np.save(fileobj, prediction)

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_download_url",
        lambda *args, **kwargs: "https://download/input.npy",
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_upload_url",
        lambda *args, **kwargs: "https://upload/output.npy",
    )
    monkeypatch.setattr(object_storage, "boto3_client", FakeS3Client())

    workflow = WorkflowGraph.model_validate(
        {
            "name": "FastAPI uploaded prediction overlay",
            "source": {"kind": "manual_selection", "image_count": 1, "part_count": 1},
            "nodes": [
                {
                    "id": "input",
                    "method_id": "source.project_part_images",
                    "parameters": {},
                },
                {
                    "id": "remote",
                    "method_id": "segmentation.fastapi.remote",
                    "parameters": {
                        "fastapi_url": "http://127.0.0.1:8001/run-inference-presigned"
                    },
                },
                {
                    "id": "output",
                    "method_id": "output.versioned_image_artifact",
                    "parameters": {},
                },
            ],
            "edges": [
                {"source_node": "input", "target_node": "remote"},
                {"source_node": "remote", "target_node": "output"},
            ],
        }
    )
    image = Image.new("RGB", (20, 16), "black")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    result = execute_image_workflow(
        workflow,
        [
            WorkflowImageInput(
                image_id=uuid.uuid4(),
                filename="fastapi.png",
                content_type="image/png",
                data=buffer.getvalue(),
                metadata={"object_storage_key": "test-key"},
            )
        ],
    )

    remote = next(item for item in result.node_results if item.node_id == "remote")
    output = next(item for item in result.node_results if item.node_id == "output")
    overlay = next(
        artifact
        for artifact in output.artifacts
        if artifact["kind"] == "volume_overlay"
    )
    assert remote.summary["gpu_prediction_overlay"] is True
    assert remote.summary["gpu_prediction_class_counts"] == {"2": 30}
    assert overlay["object_key"] == prediction_key
    assert overlay["metadata"]["load_mode"] == "volume"
    assert overlay["metadata"]["volume_shape"] == {
        "axial": 3,
        "coronal": 16,
        "sagittal": 20,
    }


def test_fastapi_segmentation_can_submit_gpu_inference_job(monkeypatch):
    """Submit a GPU inference job through FastAPI segmentation."""
    calls = []

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            calls.append(("post", url, json, timeout, self.trust_env))
            return FakeResponse({"job_id": "job-1", "status": "queued"})

        def get(self, url, timeout):
            calls.append(("get", url, None, timeout, self.trust_env))
            return FakeResponse(
                {
                    "job_id": "job-1",
                    "status": "completed",
                    "return_code": 0,
                    "logs": ["done"],
                    "uploaded_outputs": [
                        "s3://gpu-api/predictions/job-1/SN1207/prediction.npy"
                    ],
                }
            )

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )

    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="fastapi",
            mode="default",
            options={
                "integration_mode": "fastapi",
                "fastapi_url": "http://192.0.2.10:8001/run-inference",
                "request_format": "gpu_inference_job",
                "input_s3_uri": "s3://gpu-api/SN1207.npy",
                "username": "test-user@example.com",
                "password": "your_kerberos_pwd",
                "output_bucket": "gpu-api",
                "output_prefix": "predictions",
                "namespace": "example-namespace",
                "verify_ssl": False,
                "use_kerberos_ticket": False,
                "disable_proxy": True,
                "wait_for_completion": True,
                "timeout_seconds": 10,
            },
        )
    )

    assert calls[0] == (
        "post",
        "http://192.0.2.10:8001/run-inference",
        {
            "input_s3_uri": "s3://gpu-api/SN1207.npy",
            "username": "test-user@example.com",
            "password": "your_kerberos_pwd",
            "output_bucket": "gpu-api",
            "output_prefix": "predictions",
            "namespace": "example-namespace",
            "verify_ssl": False,
            "disable_proxy": True,
            "use_kerberos_ticket": False,
        },
        10,
        False,
    )
    assert calls[1][0] == "get"
    assert calls[1][1] == "http://192.0.2.10:8001/jobs/job-1"
    assert result.backend == "gpu_inference_api"
    assert result.masks == []
    assert result.metrics["runtime"] == "gpu_inference_api.job"
    assert result.metrics["job_status"] == "completed"
    assert result.metrics["uploaded_outputs"] == [
        "s3://gpu-api/predictions/job-1/SN1207/prediction.npy"
    ]


def test_gpu_inference_job_uses_vista_s3_defaults_when_not_overridden(monkeypatch):
    """Use the VISTA S3 defaults for a GPU inference job unless overridden."""
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"job_id": "job-2", "status": "queued"}

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            calls.append((url, json, timeout, self.trust_env))
            return FakeResponse()

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )

    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="fastapi",
            mode="default",
            metadata={
                "s3_uri": "s3://vista-enterprise/project/image.png",
                "s3_bucket": "vista-enterprise",
                "s3_namespace": "vista",
            },
            options={
                "integration_mode": "fastapi",
                "fastapi_url": "http://192.0.2.10:8001/run-inference",
                "request_format": "gpu_inference_job",
                "username": "test-user@example.com",
                "password": "your_kerberos_pwd",
                "output_prefix": "predictions",
                "verify_ssl": False,
                "use_kerberos_ticket": False,
                "disable_proxy": True,
                "timeout_seconds": 10,
            },
        )
    )

    assert calls[0][1]["input_s3_uri"] == "s3://vista-enterprise/project/image.png"
    assert calls[0][1]["output_bucket"] == "vista-enterprise"
    assert calls[0][1]["namespace"] == "vista"
    assert calls[0][3] is False
    assert result.metrics["job_id"] == "job-2"
    assert result.metrics["job_status"] == "queued"


def test_gpu_inference_presigned_builds_download_and_upload_urls(monkeypatch):
    """Build presigned download and upload URLs for a GPU inference job."""
    calls = []

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            calls.append((url, json, timeout, self.trust_env))
            return FakeResponse({"job_id": "job-presigned", "status": "queued"})

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )
    monkeypatch.setattr(
        "backend.utils.boto3_client.get_presigned_download_url",
        lambda bucket_name, object_name, expires_delta: (
            f"https://download/{bucket_name}/{object_name}"
        ),
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_download_url",
        lambda bucket_name, object_name, expires_delta: (
            f"https://download/{bucket_name}/{object_name}"
        ),
    )
    monkeypatch.setattr(
        "backend.utils.boto3_client.get_presigned_upload_url",
        lambda bucket_name, object_name, expires_delta, content_type: (
            f"https://upload/{bucket_name}/{object_name}"
        ),
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_upload_url",
        lambda bucket_name, object_name, expires_delta, content_type: (
            f"https://upload/{bucket_name}/{object_name}"
        ),
    )

    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="fastapi",
            mode="default",
            metadata={
                "filename": "vista-input.npy",
                "object_storage_key": "project/image.npy",
                "s3_bucket": "vista-enterprise",
            },
            options={
                "integration_mode": "fastapi",
                "fastapi_url": "http://gpu-service:8001/run-inference-presigned",
                "request_format": "gpu_inference_presigned",
                "output_prefix": "predictions",
                "output_run_id": "run-1",
                "disable_proxy": True,
                "timeout_seconds": 10,
                "_cancel_check": lambda: False,
                "_remote_job_callback": lambda _url, _job_id: None,
            },
        )
    )

    payload = calls[0][1]
    assert calls[0][0] == "http://gpu-service:8001/run-inference-presigned"
    assert calls[0][3] is False
    assert payload["input"] == {
        "download_url": "https://download/vista-enterprise/project/image.npy",
        "filename": "vista-input.npy",
    }
    assert payload["outputs"]["prediction"] == {
        "upload_url": "https://upload/vista-enterprise/predictions/run-1/prediction.npy",
        "object_key": "predictions/run-1/prediction.npy",
        "content_type": "application/octet-stream",
    }
    assert (
        payload["outputs"]["confidence"]["object_key"]
        == "predictions/run-1/confidence.npy"
    )
    assert result.backend == "gpu_inference_api"
    assert result.metrics["runtime"] == "gpu_inference_api.job"
    assert result.metrics["job_id"] == "job-presigned"


def test_fastapi_json_payload_excludes_internal_callbacks():
    """Exclude internal callbacks from the FastAPI JSON payload."""
    data = SegmentationInput(
        image_data_base64=_encoded_test_image(),
        backend="fastapi",
        mode="default",
        options={
            "integration_mode": "fastapi",
            "fastapi_url": "http://gpu-service:8001/segment",
            "request_format": "vista_segmentation",
            "timeout_seconds": 10,
            "_cancel_check": lambda: False,
        },
    )

    payload = SegmentationComponent()._fastapi_payload(data)

    assert "_cancel_check" not in payload["options"]
    assert payload["options"] == {
        "integration_mode": "fastapi",
        "fastapi_url": "http://gpu-service:8001/segment",
        "request_format": "vista_segmentation",
        "timeout_seconds": 10,
    }


def test_fastapi_connection_failure_reports_actionable_diagnostics(monkeypatch):
    """Report actionable diagnostics when the FastAPI connection fails."""

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            raise requests.ConnectionError("connection refused")

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )

    with pytest.raises(RuntimeError) as exc_info:
        SegmentationComponent().run(
            SegmentationInput(
                image_data_base64=_encoded_test_image(),
                backend="fastapi",
                mode="default",
                options={
                    "integration_mode": "fastapi",
                    "fastapi_url": "http://gpu-service:8001/run-inference-presigned",
                    "request_format": "vista_segmentation",
                    "disable_proxy": True,
                    "timeout_seconds": 10,
                },
            )
        )

    message = str(exc_info.value)
    assert "Connected to endpoint: no" in message
    assert "Endpoint attempted execution: unknown" in message
    assert "Result returned: no" in message
    assert exc_info.value.diagnostics["failure_stage"] == "connect"


def test_gpu_inference_failed_job_reports_execution_and_result_diagnostics(monkeypatch):
    """Report execution and result diagnostics for a failed GPU inference job."""

    class FakeResponse:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeSession:
        trust_env = True

        def post(self, url, json, timeout):
            return FakeResponse({"job_id": "job-failed", "status": "queued"})

        def get(self, url, timeout):
            return FakeResponse(
                {
                    "job_id": "job-failed",
                    "status": "failed",
                    "return_code": 7,
                    "logs": ["downloaded input", "model crashed"],
                    "uploaded_outputs": [],
                }
            )

    monkeypatch.setattr(
        "backend.analyze_toolbox.segmentation.requests.Session", FakeSession
    )
    monkeypatch.setattr(
        "backend.utils.boto3_client.get_presigned_download_url",
        lambda bucket_name, object_name, expires_delta: "https://download/input.npy",
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_download_url",
        lambda bucket_name, object_name, expires_delta: "https://download/input.npy",
    )
    monkeypatch.setattr(
        "backend.utils.boto3_client.get_presigned_upload_url",
        lambda bucket_name, object_name, expires_delta, content_type: (
            "https://upload/prediction.npy"
        ),
    )
    monkeypatch.setattr(
        "utils.boto3_client.get_presigned_upload_url",
        lambda bucket_name, object_name, expires_delta, content_type: (
            "https://upload/prediction.npy"
        ),
    )

    result = SegmentationComponent().run(
        SegmentationInput(
            image_data_base64=_encoded_test_image(),
            backend="fastapi",
            mode="default",
            options={
                "integration_mode": "fastapi",
                "fastapi_url": "http://gpu-service:8001/run-inference-presigned",
                "request_format": "gpu_inference_presigned",
                "input_object_key": "project/image.npy",
                "wait_for_completion": True,
                "disable_proxy": True,
                "timeout_seconds": 10,
            },
        )
    )

    warning = result.metrics["runtime_warning"]
    diagnostics = result.metrics["fastapi_diagnostics"]
    assert "Connected to endpoint: yes" in warning
    assert "Endpoint attempted execution: yes" in warning
    assert "Result returned: yes" in warning
    assert diagnostics["remote_job_status"] == "failed"
    assert diagnostics["remote_return_code"] == 7
    assert diagnostics["remote_log_tail"] == ["downloaded input", "model crashed"]
    assert diagnostics["result_usable_for_overlay"] is False


def test_normalization_preserves_external_backend_and_mode():
    """Preserve the backend and mode reported by an external implementation."""

    class ExternalOutput(BaseModel):
        backend: str = "opencv-deployment"
        mode: str = "watershed"
        masks: list = []
        metrics: dict = {"implementation": "external"}
        raw_output: str = "painted-image"

    result = SegmentationComponent()._normalize_result(
        ExternalOutput(), "opencv", "default"
    )

    assert result.backend == "opencv-deployment"
    assert result.mode == "watershed"
    assert result.metrics == {"implementation": "external"}
    assert result.raw_output == "painted-image"
