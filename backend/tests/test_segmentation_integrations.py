import base64
import io

import pytest
from PIL import Image, ImageDraw

from backend.analyze_toolbox.segmentation import SegmentationComponent, SegmentationInput


def _encoded_test_image() -> str:
    image = Image.new("RGB", (20, 16), "black")
    draw = ImageDraw.Draw(image)
    draw.rectangle([3, 4, 7, 9], fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


@pytest.mark.parametrize(
    ("backend", "function_path", "expected_label"),
    [
        ("yolo", "utils.segmentation_integrations.yolo_backend.run", "object"),
        ("opencv", "utils.segmentation_integrations.opencv_backend.run", "foreground"),
        ("anomalib", "utils.segmentation_integrations.anomalib_backend.run", "anomaly"),
    ],
)
def test_local_import_segmentation_adapters_return_shared_output_shape(backend, function_path, expected_label):
    request = SegmentationInput(
        image_data_base64=_encoded_test_image(),
        backend=backend,
        mode="default",
        options={
            "integration_mode": "local_import",
            "function_path": function_path,
            "model": f"{backend}-example-model",
        },
    )

    result = SegmentationComponent().run(request)

    assert result.backend == backend
    assert result.mode == "default"
    assert result.metrics["runtime"] == f"{backend}_local_import"
    assert result.metrics["model"] == f"{backend}-example-model"
    assert len(result.masks) == 1
    mask = result.masks[0]
    assert mask.label == expected_label
    assert mask.score is not None
    assert mask.bbox == [3.0, 4.0, 5.0, 6.0]
    assert mask.area == 30.0


def test_sam_local_import_adapter_uses_box_prompt():
    request = SegmentationInput(
        image_data_base64=_encoded_test_image(),
        backend="sam",
        mode="prompted",
        prompts={"box": [2, 3, 12, 13]},
        options={
            "integration_mode": "local_import",
            "function_path": "utils.segmentation_integrations.sam_backend.run",
            "model": "sam-example-model",
        },
    )

    result = SegmentationComponent().run(request)

    assert result.backend == "sam"
    assert result.mode == "prompted"
    assert result.metrics["runtime"] == "sam_local_import"
    assert result.metrics["model"] == "sam-example-model"
    assert result.metrics["prompt_keys"] == ["box"]
    assert len(result.masks) == 1
    mask = result.masks[0]
    assert mask.label == "sam-region"
    assert mask.bbox == [2.0, 3.0, 10.0, 10.0]
    assert mask.area == 100.0
