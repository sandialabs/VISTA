"""SAM, YOLO and Anomalib run on the GPU when one is visible, else on the CPU.

Opt-in (``VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true``): each case imports torch in
a subprocess, like the runtime smoke tests in test_segmentation_integrations.py,
and asserts the device the model actually ran on. On a machine without a GPU the
expected device is the CPU, so the same tests pass there.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from backend.tests.runtime_flags import native_segmentation_runtime_enabled

REPO_ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(
    not native_segmentation_runtime_enabled(),
    reason="set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to run native runtimes",
)

_PRELUDE = """
import json, warnings, logging
warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)
import torch
EXPECTED = "cuda" if torch.cuda.is_available() else "cpu"
def report(**values):
    print("RESULT " + json.dumps(values))
"""


def _run(script: str, *, env_extra: dict[str, str] | None = None, timeout=600):
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [str(REPO_ROOT), str(REPO_ROOT / "backend"), env.get("PYTHONPATH", "")]
    )
    env.update(env_extra or {})
    completed = subprocess.run(
        [sys.executable, "-c", _PRELUDE + textwrap.dedent(script)],
        cwd=REPO_ROOT / "backend",
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    assert completed.returncode == 0, (
        f"stdout:\n{completed.stdout[-4000:]}\nstderr:\n{completed.stderr[-4000:]}"
    )
    lines = [ln for ln in completed.stdout.splitlines() if ln.startswith("RESULT ")]
    assert lines, completed.stdout[-4000:]
    return json.loads(lines[-1][len("RESULT ") :])


def test_yolo_adapter_runs_on_the_resolved_device():
    result = _run(
        """
        from pathlib import Path
        from PIL import Image
        from ultralytics.utils import ASSETS
        from utils.segmentation_integrations import yolo_backend
        runtime_cls, input_cls = yolo_backend._load_yolo_runtime()
        segmenter = runtime_cls(pretrained_model="yolo11n-seg.pt")
        image = Image.open(Path(ASSETS) / "bus.jpg").convert("RGB")
        output = segmenter.run(input_cls(image=image, source=None, conf=0.25))
        boxes = output.metadata["raw_output"][0].boxes
        # Ultralytics runs inference through its predictor's backend copy of the
        # network, so its device (and the result tensors) show where it ran.
        report(expected=EXPECTED, device=str(segmenter.model.predictor.device),
               boxes_device=str(boxes.data.device), detections=len(boxes))
        """
    )
    assert result["device"].startswith(result["expected"]), result
    assert result["boxes_device"].startswith(result["expected"]), result
    assert result["detections"] > 0, result


def test_toolbox_yolo_runtime_runs_on_the_resolved_device():
    result = _run(
        """
        from pathlib import Path
        from PIL import Image
        from ultralytics.utils import ASSETS
        from analyze_toolbox import yolo_runtime
        image = Image.open(Path(ASSETS) / "bus.jpg")
        yolo_runtime.run_ultralytics_yolo(image, "yolo11n-seg.pt", 0.25, segment=True)
        model = yolo_runtime._YOLO_MODEL_CACHE["yolo11n-seg.pt"]
        report(expected=EXPECTED, device=str(model.predictor.device))
        """
    )
    assert result["device"].startswith(result["expected"]), result


def test_cpu_setting_keeps_yolo_on_the_cpu():
    result = _run(
        """
        from pathlib import Path
        from PIL import Image
        from ultralytics.utils import ASSETS
        from analyze_toolbox import yolo_runtime
        image = Image.open(Path(ASSETS) / "bus.jpg")
        yolo_runtime.run_ultralytics_yolo(image, "yolo11n-seg.pt", 0.25)
        model = yolo_runtime._YOLO_MODEL_CACHE["yolo11n-seg.pt"]
        report(device=str(model.predictor.device))
        """,
        env_extra={"VISTA_MODEL_SERVICE_DEVICE": "cpu"},
    )
    assert result["device"] == "cpu", result


def test_sam_adapter_places_the_model_on_the_resolved_device():
    # Untrained ViT-B weights (no checkpoint download); this checks placement
    # and one prompt-mode forward pass, not mask quality.
    result = _run(
        """
        import numpy as np
        from types import SimpleNamespace
        from utils.segmentation_integrations import sam_backend
        runtime_cls, _input_cls = sam_backend._load_sam_runtime()
        segmenter = runtime_cls(model_type="vit_b", model_checkpoint=None)
        image = np.full((64, 64, 3), 128, dtype=np.uint8)
        output = segmenter.run(SimpleNamespace(
            image=image, run_mode="prompt", point_coords=np.array([[32, 32]]),
            point_labels=np.array([1]), mask_input=None, multimask_output=False))
        report(expected=EXPECTED,
               device=str(next(segmenter._model.parameters()).device),
               ran=output is not None)
        """
    )
    assert result["device"].startswith(result["expected"]), result
    assert result["ran"] is True


def test_anomalib_runs_a_trained_patchcore_on_the_resolved_device(tmp_path):
    result = _run(
        f"""
        import base64, io
        from pathlib import Path
        import numpy as np
        from PIL import Image
        from anomalib.data import Folder
        from anomalib.engine import Engine
        from anomalib.models import Patchcore
        from utils.accelerator import lightning_accelerator, resolve_torch_device
        from utils.segmentation_integrations import anomalib_backend

        root = Path({str(tmp_path)!r})
        good = root / "good"
        good.mkdir(parents=True)
        rng = np.random.default_rng(0)
        for i in range(8):
            noise = rng.normal(0, 4, (96, 96, 3))
            arr = (np.full((96, 96, 3), 110) + noise).clip(0, 255).astype("uint8")
            Image.fromarray(arr).save(good / f"{{i}}.png")
        accelerator, devices = lightning_accelerator(resolve_torch_device())
        model = Patchcore(backbone="resnet18", pre_trained=False,
                          coreset_sampling_ratio=0.5)
        engine = Engine(accelerator=accelerator, devices=devices, max_epochs=1,
                        default_root_dir=root / "run", logger=False,
                        enable_progress_bar=False)
        engine.fit(model=model, datamodule=Folder(
            name="synthetic", root=root, normal_dir="good", train_batch_size=4,
            eval_batch_size=4, num_workers=0))
        checkpoint = root / "patchcore.ckpt"
        engine.trainer.save_checkpoint(checkpoint)

        image = np.full((96, 128, 3), 110, dtype=np.uint8)
        image[30:60, 40:80] = 250
        buffer = io.BytesIO()
        Image.fromarray(image).save(buffer, format="PNG")
        result = anomalib_backend.run({{
            "image_data_base64": base64.b64encode(buffer.getvalue()).decode(),
            "mode": "default",
            "options": {{
                "model_name": "patchcore",
                "checkpoint_path": str(checkpoint),
                "checkpoint_object_key": "projects/p/checkpoints/c/patchcore.ckpt",
            }},
        }})
        heatmap = np.asarray(result["raw_output"]["heatmap"])
        report(expected=EXPECTED, metrics=result["metrics"],
               masks=len(result["masks"]), heatmap_shape=list(heatmap.shape),
               score=result["raw_output"].get("anomaly_score"))
        """
    )
    assert result["metrics"]["runtime"] == "anomalib.Patchcore", result
    assert result["metrics"]["device"].startswith(result["expected"]), result
    assert result["heatmap_shape"] == [96, 128], result
    assert result["masks"] >= 1, result
    assert result["score"] is not None, result
