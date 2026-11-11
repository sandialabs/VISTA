"""Device selection shared by the SAM, YOLO and Anomalib runtimes."""

import types

import pytest

from backend.tests.runtime_flags import native_segmentation_runtime_enabled
from utils import accelerator
from utils.segmentation_integrations import anomalib_runtime


def _fake_torch(*, cuda=False, count=1, mps=False):
    cuda_module = types.SimpleNamespace(
        is_available=lambda: cuda,
        device_count=lambda: count if cuda else 0,
        get_device_name=lambda index: f"Fake GPU {index}",
    )
    mps_module = types.SimpleNamespace(is_available=lambda: mps)
    return types.SimpleNamespace(
        cuda=cuda_module, backends=types.SimpleNamespace(mps=mps_module)
    )


@pytest.fixture
def fake_torch(monkeypatch):
    def install(**kwargs):
        torch = _fake_torch(**kwargs)
        monkeypatch.setattr(accelerator.importlib.util, "find_spec", lambda _n: True)
        monkeypatch.setattr(accelerator.importlib, "import_module", lambda _n: torch)
        accelerator.reset_cache()
        return torch

    yield install
    accelerator.reset_cache()


@pytest.mark.parametrize(
    ("requested", "cuda", "mps", "expected"),
    [
        ("auto", True, False, "cuda:0"),
        ("", True, True, "cuda:0"),
        ("auto", False, True, "mps"),
        ("auto", False, False, "cpu"),
        ("cpu", True, True, "cpu"),
        ("cuda:1", True, False, "cuda:1"),
    ],
)
def test_resolution_order(fake_torch, requested, cuda, mps, expected):
    fake_torch(cuda=cuda, mps=mps)
    assert accelerator.resolve_torch_device(requested) == expected


def test_default_request_comes_from_settings_and_is_cached(fake_torch, monkeypatch):
    from core.config import settings

    fake_torch(cuda=True)
    monkeypatch.setattr(settings, "VISTA_MODEL_SERVICE_DEVICE", "auto")
    assert accelerator.resolve_torch_device() == "cuda:0"
    monkeypatch.setattr(settings, "VISTA_MODEL_SERVICE_DEVICE", "cpu")
    assert accelerator.resolve_torch_device() == "cuda:0"  # probed once per process
    accelerator.reset_cache()
    assert accelerator.resolve_torch_device() == "cpu"


def test_status_reports_devices(fake_torch):
    fake_torch(cuda=True, count=2)
    status = accelerator.accelerator_status("auto")
    assert status["cuda_available"] is True
    assert status["cuda_device_count"] == 2
    assert status["cuda_devices"] == ["Fake GPU 0", "Fake GPU 1"]
    assert status["selected_device"] == "cuda:0"


def test_cuda_probe_errors_fall_back_to_cpu(fake_torch):
    torch = fake_torch(cuda=True)

    def broken():
        raise RuntimeError("driver mismatch")

    torch.cuda.is_available = broken
    status = accelerator.accelerator_status("auto")
    assert status["selected_device"] == "cpu"
    assert "driver mismatch" in status["cuda_error"]


def test_without_torch_selects_cpu(monkeypatch):
    monkeypatch.setattr(accelerator.importlib.util, "find_spec", lambda _n: None)
    status = accelerator.accelerator_status("auto")
    assert status["selected_device"] == "cpu"
    assert status["torch_error"] == "torch is not installed"


@pytest.mark.parametrize(
    ("device", "expected"),
    [
        ("cuda:0", ("gpu", [0])),
        ("cuda:3", ("gpu", [3])),
        ("cuda", ("gpu", 1)),
        ("mps", ("mps", 1)),
        ("cpu", ("cpu", 1)),
    ],
)
def test_lightning_accelerator_mapping(device, expected):
    assert accelerator.lightning_accelerator(device) == expected


@pytest.mark.parametrize(
    ("option", "cuda", "expected"),
    [
        ("auto", True, "cuda:0"),
        (None, False, "cpu"),
        ("gpu", True, "cuda:0"),
        ("cpu", True, "cpu"),
        ("cuda:1", True, "cuda:1"),
    ],
)
def test_anomalib_accelerator_option(fake_torch, monkeypatch, option, cuda, expected):
    from core.config import settings

    monkeypatch.setattr(settings, "VISTA_MODEL_SERVICE_DEVICE", "auto")
    fake_torch(cuda=cuda)
    assert anomalib_runtime.resolve_device(option) == expected


requires_native = pytest.mark.skipif(
    not native_segmentation_runtime_enabled(),
    reason="set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to import torch and anomalib",
)


@requires_native
def test_anomalib_runtime_requires_a_trained_checkpoint():
    runtime_cls, _input_cls = anomalib_runtime.load_runtime()
    with pytest.raises(ValueError, match="trained checkpoint"):
        runtime_cls(model_name="patchcore")


@requires_native
def test_unknown_anomalib_model_name_is_rejected():
    with pytest.raises(ValueError, match="Unknown Anomalib model"):
        anomalib_runtime.model_class("not-a-model")
