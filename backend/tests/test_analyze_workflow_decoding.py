import base64
import io
import uuid
import zipfile

import numpy as np
import pytest
from backend.analyze_toolbox import (
    WorkflowGraph,
    WorkflowImageInput,
    execute_image_workflow,
)
from backend.analyze_toolbox.image_decode import decode_workflow_image
from backend.tests.analyze_segmentation_fakes import (
    FakeOpenCVSegmentation,
    ToolkitSegmentationInput,
)
from backend.utils.segmentation_integrations import opencv_backend
from PIL import Image, ImageDraw


def _encoded_test_image() -> str:
    image = Image.new("RGB", (20, 16), "black")
    draw = ImageDraw.Draw(image)
    draw.rectangle([3, 4, 7, 9], fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _opencv_workflow(parameters=None) -> WorkflowGraph:
    parameters = parameters if parameters is not None else {}
    return WorkflowGraph(
        name="Placeholder overlay",
        nodes=[
            {
                "id": "input",
                "method_id": "source.project_part_images",
                "parameters": {},
            },
            {
                "id": "segment",
                "method_id": "segmentation.opencv.placeholder",
                "parameters": parameters,
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "parameters": {"mode": "overlay_artifact"},
            },
        ],
        edges=[
            {"source_node": "input", "target_node": "segment"},
            {"source_node": "segment", "target_node": "output"},
        ],
    )


def _assert_overlay_alpha(output, expected_bbox, expected_area):
    overlay = next(
        artifact for artifact in output.artifacts if artifact["kind"] == "overlay_image"
    )
    assert overlay["content_type"] == "image/png"
    assert overlay["data_base64"]
    alpha = (
        Image.open(io.BytesIO(base64.b64decode(overlay["data_base64"])))
        .convert("RGBA")
        .getchannel("A")
    )
    assert alpha.getbbox() == expected_bbox
    assert sum(value > 0 for value in alpha.getdata()) == expected_area


def test_decode_workflow_image_reports_source_filename_for_invalid_payload():
    image = WorkflowImageInput(
        image_id=uuid.uuid4(),
        filename="bad-example.png",
        content_type="image/png",
        data=b"not an image",
    )

    with pytest.raises(ValueError, match="bad-example.png"):
        decode_workflow_image(image)


def test_loaded_image_placeholder_analysis_produces_inspection_overlay_artifact(
    monkeypatch,
):
    monkeypatch.setattr(
        opencv_backend,
        "_load_opencv_runtime",
        lambda: (FakeOpenCVSegmentation, ToolkitSegmentationInput),
    )
    image_bytes = base64.b64decode(_encoded_test_image())

    result = execute_image_workflow(
        _opencv_workflow({"options": {"min_peak_distance_px": 1}}),
        [
            WorkflowImageInput(
                image_id=uuid.uuid4(),
                filename="loaded.png",
                content_type="image/png",
                data=image_bytes,
            )
        ],
    )

    segment = next(node for node in result.node_results if node.node_id == "segment")
    output = next(node for node in result.node_results if node.node_id == "output")
    assert result.status == "completed"
    assert segment.summary["detections"][0]["bbox"] == {
        "x": 3.0,
        "y": 4.0,
        "width": 5.0,
        "height": 6.0,
    }
    _assert_overlay_alpha(output, (3, 4, 8, 10), 30)


def test_loaded_numpy_volume_analysis_uses_representative_slice_with_default_opencv_options(
    monkeypatch,
):
    monkeypatch.setattr(
        opencv_backend,
        "_load_opencv_runtime",
        lambda: (FakeOpenCVSegmentation, ToolkitSegmentationInput),
    )
    volume = np.zeros((3, 16, 20), dtype=np.uint16)
    volume[1, 4:10, 3:8] = 4000
    payload = io.BytesIO()
    np.save(payload, volume)

    result = execute_image_workflow(
        _opencv_workflow(),
        [
            WorkflowImageInput(
                image_id=uuid.uuid4(),
                filename="loaded.npy",
                content_type="application/octet-stream",
                data=payload.getvalue(),
            )
        ],
    )

    segment = next(node for node in result.node_results if node.node_id == "segment")
    output = next(node for node in result.node_results if node.node_id == "output")
    assert result.status == "completed"
    assert segment.summary["metrics"]["runtime"] == "analysis_toolkit.opencv"
    assert segment.summary["detections"][0]["bbox"] == {
        "x": 3.0,
        "y": 4.0,
        "width": 5.0,
        "height": 6.0,
    }
    _assert_overlay_alpha(output, (3, 4, 8, 10), 30)


def test_loaded_inspiro_volume_analysis_uses_first_array_member(monkeypatch):
    monkeypatch.setattr(
        opencv_backend,
        "_load_opencv_runtime",
        lambda: (FakeOpenCVSegmentation, ToolkitSegmentationInput),
    )
    volume = np.zeros((3, 16, 20, 3), dtype=np.uint8)
    volume[1, 4:10, 3:8, :] = 255
    npy_payload = io.BytesIO()
    np.save(npy_payload, volume)
    archive_payload = io.BytesIO()
    with zipfile.ZipFile(
        archive_payload, mode="w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        archive.writestr("nested/volume.npy", npy_payload.getvalue())

    result = execute_image_workflow(
        _opencv_workflow({"options": {"min_peak_distance_px": 1}}),
        [
            WorkflowImageInput(
                image_id=uuid.uuid4(),
                filename="loaded.inspiro",
                content_type="application/octet-stream",
                data=archive_payload.getvalue(),
            )
        ],
    )

    segment = next(node for node in result.node_results if node.node_id == "segment")
    assert result.status == "completed"
    assert segment.summary["detections"][0]["bbox"] == {
        "x": 3.0,
        "y": 4.0,
        "width": 5.0,
        "height": 6.0,
    }
