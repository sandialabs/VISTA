"""Execute Analyze workflows through the API for each segmentation backend."""

import base64
import io
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from backend.tests.runtime_flags import native_segmentation_runtime_enabled
from PIL import Image, ImageDraw

from analyze_toolbox import yolo_runtime


def _sample_png_bytes() -> bytes:
    image = Image.new("RGB", (80, 60), "black")
    draw = ImageDraw.Draw(image)
    draw.rectangle([20, 15, 45, 40], fill="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _sample_volume_bytes() -> bytes:
    volume = np.zeros((3, 60, 80), dtype=np.uint16)
    volume[1, 15:41, 20:46] = 4000
    buffer = io.BytesIO()
    np.save(buffer, volume)
    return buffer.getvalue()


def _sample_image_bytes() -> bytes:
    """Synthetic grayscale image with structured, non-uniform content."""
    size = 256
    gradient = np.tile(np.linspace(40, 200, size, dtype=np.uint8), (size, 1))
    image = Image.fromarray(gradient, mode="L").convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 60, 120, 180), fill=(20, 20, 20))
    draw.ellipse((150, 90, 220, 160), outline=(240, 240, 240), width=6)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def _known_yolo11n_sample_png_bytes() -> bytes:
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to import native YOLO "
            "runtime assets"
        )
    pytest.importorskip("ultralytics")
    from ultralytics.utils import ASSETS

    return (Path(ASSETS) / "bus.jpg").read_bytes()


def _create_project_with_part_image(client, *, volume=False, inline_payload=None):
    headers = {
        "X-User-Id": "toolkit-analyze@example.com",
        "X-User-Groups": '["toolkit-analyze"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Toolkit Analyze Project",
            "description": "Analyze toolkit segmentation regression",
            "meta_group_id": "toolkit-analyze",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    image_bytes = _sample_volume_bytes() if volume else _sample_png_bytes()
    filename = "toolkit-source.npy" if volume else "toolkit-source.png"
    content_type = "application/octet-stream" if volume else "image/png"
    metadata = {"modality": "visual"}
    if inline_payload is None:
        inline_payload = base64.b64encode(image_bytes).decode("ascii")
    if inline_payload is not False:
        metadata["analysis_inline_image_base64"] = inline_payload
    image_resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, io.BytesIO(image_bytes), content_type)},
        data={"metadata": json.dumps(metadata)},
        headers=headers,
    )
    assert image_resp.status_code == 201, image_resp.text
    image = image_resp.json()
    if volume:
        parts_resp = client.get(f"/api/projects/{project_id}/parts", headers=headers)
        assert parts_resp.status_code == 200, parts_resp.text
        assert len(parts_resp.json()) == 1
        return headers, project_id, image

    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "TOOLKIT-001",
            "display_name": "Toolkit Analyze Part",
            "metadata": {
                "source_images": [
                    {
                        "filename": image["filename"],
                        "image_id": image["id"],
                        "modality": "visual",
                    }
                ]
            },
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    return headers, project_id, image


def _create_project_with_custom_image(
    client,
    *,
    image_bytes: bytes,
    filename: str,
    content_type: str,
):
    headers = {
        "X-User-Id": "toolkit-analyze@example.com",
        "X-User-Groups": '["toolkit-analyze"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Toolkit Analyze Functional Project",
            "description": "Analyze toolkit functional regression",
            "meta_group_id": "toolkit-analyze",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]
    metadata = {
        "modality": "visual",
        "analysis_inline_image_base64": base64.b64encode(image_bytes).decode("ascii"),
    }
    image_resp = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": (filename, io.BytesIO(image_bytes), content_type)},
        data={"metadata": json.dumps(metadata)},
        headers=headers,
    )
    assert image_resp.status_code == 201, image_resp.text
    image = image_resp.json()
    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "TOOLKIT-001",
            "display_name": "Toolkit Analyze Part",
            "metadata": {
                "source_images": [
                    {
                        "filename": image["filename"],
                        "image_id": image["id"],
                        "modality": "visual",
                    }
                ]
            },
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    return headers, project_id, image


def _workflow(project_id, image_id, *, method_id, node_id, parameters):
    return {
        "name": f"Analyze {node_id} regression",
        "source": {
            "id": "example-image-selection",
            "label": "Chosen example image",
            "kind": "manual_selection",
            "project_id": project_id,
            "selected_image_ids": [image_id],
            "example_image_id": image_id,
            "image_count": 1,
            "part_count": 1,
        },
        "nodes": [
            {
                "id": "input",
                "method_id": "source.project_part_images",
                "label": "Input",
                "parameters": {},
            },
            {
                "id": node_id,
                "method_id": method_id,
                "label": node_id,
                "parameters": parameters,
            },
            {
                "id": "output",
                "method_id": "output.versioned_image_artifact",
                "label": "Versioned Output",
                "parameters": {"mode": "overlay_artifact"},
            },
        ],
        "edges": [
            {"source_node": "input", "target_node": node_id},
            {"source_node": node_id, "target_node": "output"},
        ],
        "output": {"mode": "overlay_artifact", "version_strategy": "recipe_metadata"},
    }


def _overlay_image_from_base64(encoded):
    return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")


def _assert_non_uniform_heatmap_overlay(overlay_image):
    assert overlay_image.mode == "RGBA"
    rgb = overlay_image.convert("RGB")
    alpha = overlay_image.getchannel("A")
    assert len(set(rgb.getdata())) > 16
    assert len(set(alpha.getdata())) > 16
    assert alpha.getbbox() is not None


def _assert_expected_overlay_pixels(overlay_image):
    assert overlay_image.size == (80, 60)
    alpha = overlay_image.getchannel("A")
    assert alpha.getbbox() == (20, 15, 46, 41)
    assert sum(value > 0 for value in alpha.getdata()) == 26 * 26


def _assert_persisted_overlay_output(
    client,
    headers,
    project_id,
    source_image,
    payload,
    method_id,
    *,
    require_inline=True,
    overlay_assertion=None,
):
    overlay_assertion = overlay_assertion or _assert_expected_overlay_pixels
    output_node = next(
        node for node in payload["node_results"] if node["node_id"] == "output"
    )
    assert output_node["status"] == "completed"
    overlay_artifact = next(
        artifact
        for artifact in output_node["artifacts"]
        if artifact["kind"] == "overlay_image"
    )
    overlay_assertion(_overlay_image_from_base64(overlay_artifact["data_base64"]))

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    metadata = parts_response.json()[0]["metadata"]
    records = [
        record
        for record in metadata["analysis_outputs"]
        if record["analysis_method_id"] == method_id
    ]
    assert len(records) == 1
    overlay_record = records[0]
    assert overlay_record["analysis_source_image_id"] == source_image["id"]
    assert overlay_record["overlay_base_image_id"] == source_image["id"]
    assert overlay_record["overlay"] is True
    assert overlay_record["analysis_output"] is True
    assert overlay_record["modality"] == "analyze-overlay"

    overlay_response = client.get(
        f"/api/images/{overlay_record['image_id']}", headers=headers
    )
    assert overlay_response.status_code == 200, overlay_response.text
    overlay_metadata = overlay_response.json()["metadata"]
    assert overlay_metadata["analysis_output"] is True
    assert overlay_metadata["overlay"] is True
    assert overlay_metadata["storage_status"] == "metadata_inline"
    if require_inline:
        overlay_assertion(
            _overlay_image_from_base64(overlay_metadata["analysis_inline_image_base64"])
        )

    content_response = client.get(
        f"/api/images/{overlay_record['image_id']}/content", headers=headers
    )
    assert content_response.status_code == 200, content_response.text
    assert content_response.headers["content-type"].startswith("image/png")
    overlay_assertion(Image.open(io.BytesIO(content_response.content)).convert("RGBA"))
    return overlay_record


def _assert_analysis_output_targets_inspection_overlay(
    overlay_record, *, expected_label
):
    assert overlay_record["label"] == expected_label
    assert overlay_record["overlay"] is True
    assert overlay_record["analysis_output"] is True
    assert overlay_record["modality"] == "analyze-overlay"
    assert overlay_record["image_id"]
    assert overlay_record["overlay_base_image_id"]


def test_analyze_executes_snl_opencv_segmentation(client):
    """Execute the OpenCV watershed workflow and persist its overlay output."""
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.opencv.placeholder",
        node_id="opencv",
        parameters={"mode": "default"},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    assert "cannot identify image file" not in response.text
    opencv_node = next(
        node for node in payload["node_results"] if node["node_id"] == "opencv"
    )
    assert opencv_node["summary"]["backend"] == "opencv"
    assert opencv_node["summary"]["mode"] == "watershed"
    assert opencv_node["summary"]["metrics"]["runtime"] == "analysis_toolkit.opencv"
    assert opencv_node["summary"]["detections"][0]["bbox"] == {
        "x": 20.0,
        "y": 15.0,
        "width": 26.0,
        "height": 26.0,
    }
    _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.opencv.placeholder",
    )


def test_analyze_default_opencv_output_is_visible_as_inspection_overlay(client):
    """Show the default OpenCV output as an inspection overlay."""
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.opencv.placeholder",
        node_id="opencv",
        parameters={},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    opencv_node = next(
        node for node in payload["node_results"] if node["node_id"] == "opencv"
    )
    assert opencv_node["summary"]["backend"] == "opencv"
    assert opencv_node["summary"]["mask_count"] == 1
    overlay_record = _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.opencv.placeholder",
    )
    _assert_analysis_output_targets_inspection_overlay(
        overlay_record, expected_label="Segmentation Overlay :: OpenCV"
    )


def test_analyze_executes_sam_segmentation_on_prompted_sample_image(client):
    """Execute SAM with a box prompt and persist its overlay output."""
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.sam.placeholder",
        node_id="sam",
        parameters={"mode": "default", "prompts": {"box": [20, 15, 46, 41]}},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    sam_node = next(
        node for node in payload["node_results"] if node["node_id"] == "sam"
    )
    assert sam_node["status"] == "completed"
    assert sam_node["summary"]["backend"] == "sam"
    assert sam_node["summary"]["metrics"]["runtime"] == "analysis_toolkit.sam_fallback"
    assert sam_node["summary"]["detections"][0]["bbox"] == {
        "x": 20.0,
        "y": 15.0,
        "width": 26.0,
        "height": 26.0,
    }
    _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.sam.placeholder",
    )


def test_analyze_executes_sam_segmentation_with_data_url_inline_image(client):
    """Execute SAM when the inline image arrives as a data URL."""
    image_bytes = _sample_png_bytes()
    data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")
    headers, project_id, image = _create_project_with_part_image(
        client, inline_payload=data_url
    )
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.sam.placeholder",
        node_id="sam",
        parameters={"mode": "default", "prompts": {"box": [20, 15, 46, 41]}},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert "cannot identify image file" not in response.text
    payload = response.json()
    assert payload["status"] == "completed"
    sam_node = next(
        node for node in payload["node_results"] if node["node_id"] == "sam"
    )
    assert sam_node["status"] == "completed"
    assert sam_node["summary"]["backend"] == "sam"
    _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.sam.placeholder",
    )


def test_analyze_executes_sam_segmentation_without_prompt_defaults(client):
    """Execute SAM without prompts and still persist an overlay output."""
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.sam.placeholder",
        node_id="sam",
        parameters={"mode": "default"},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    sam_node = next(
        node for node in payload["node_results"] if node["node_id"] == "sam"
    )
    assert sam_node["summary"]["backend"] == "sam"
    assert sam_node["summary"]["metrics"]["runtime"] == "analysis_toolkit.sam_fallback"
    assert sam_node["summary"]["detections"][0]["bbox"] == {
        "x": 20.0,
        "y": 15.0,
        "width": 26.0,
        "height": 26.0,
    }
    _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.sam.placeholder",
    )


def test_analyze_default_sam_output_is_visible_as_inspection_overlay(client):
    """Show the default SAM output as an inspection overlay."""
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.sam.placeholder",
        node_id="sam",
        parameters={},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    sam_node = next(
        node for node in payload["node_results"] if node["node_id"] == "sam"
    )
    assert sam_node["summary"]["backend"] == "sam"
    assert sam_node["summary"]["mask_count"] == 1
    assert sam_node["summary"]["metrics"]["runtime"] in {
        "analysis_toolkit.sam",
        "analysis_toolkit.sam_fallback",
    }
    if sam_node["summary"]["metrics"]["runtime"] == "analysis_toolkit.sam_fallback":
        assert sam_node["summary"]["metrics"].get("model")
    overlay_record = _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.sam.placeholder",
    )
    _assert_analysis_output_targets_inspection_overlay(
        overlay_record, expected_label="Segmentation Overlay :: SAM"
    )


def test_analyze_default_yolo_output_is_visible_as_inspection_overlay(
    client, monkeypatch
):
    """Show the default YOLO output as an inspection overlay."""
    monkeypatch.setattr(
        yolo_runtime.settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", True
    )
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.yolo.placeholder",
        node_id="yolo",
        parameters={},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    yolo_node = next(
        node for node in payload["node_results"] if node["node_id"] == "yolo"
    )
    assert yolo_node["summary"]["backend"] == "yolo"
    assert (
        yolo_node["summary"]["metrics"]["runtime"] == "analysis_toolkit.yolo_fallback"
    )
    assert yolo_node["summary"]["mask_count"] == 1
    overlay_record = _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.yolo.placeholder",
    )
    _assert_analysis_output_targets_inspection_overlay(
        overlay_record, expected_label="Segmentation Overlay :: YOLO"
    )


# Network output varies slightly with the CPU, torch build, and thread count (the
# same image and weights gave box x of 17.80, 17.82, and 17.84 on three machines),
# so geometry and confidence are compared with a tolerance. A wrong class or a
# resize/letterbox error shifts boxes by several pixels and still fails.
_YOLO_BBOX_TOLERANCE_PX = 1.0
_YOLO_CONFIDENCE_TOLERANCE = 0.01


def _assert_yolo_detections_close(actual, expected):
    assert len(actual) == len(expected)
    for got, want in zip(actual, expected, strict=True):
        assert got["id"] == want["id"]
        assert got["class_name"] == want["class_name"]
        assert got["confidence"] == pytest.approx(
            want["confidence"], abs=_YOLO_CONFIDENCE_TOLERANCE
        )
        assert got["bbox"] == pytest.approx(want["bbox"], abs=_YOLO_BBOX_TOLERANCE_PX)


def test_analyze_executes_yolo11n_seg_checkpoint_from_checkpoints_tab(
    client, monkeypatch
):
    """Execute YOLO with a checkpoint uploaded through the checkpoints API."""
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to run native YOLO "
            "checkpoint execution"
        )
    checkpoint_path = (
        Path(__file__).resolve().parents[2] / "checkpoints" / "yolo11n-seg.pt"
    )
    assert checkpoint_path.exists(), (
        "Expected yolo11n-seg.pt in the repository checkpoints directory"
    )
    checkpoint_bytes = checkpoint_path.read_bytes()
    uploaded_objects = {}

    class FakeBody:
        def __init__(self, data):
            self.data = data

        def read(self):
            return self.data

    class FakeS3Client:
        def put_object_tagging(self, **_kwargs):
            return None

        def get_object(self, Bucket, Key):
            return {"Body": FakeBody(uploaded_objects[Key])}

        def generate_presigned_url(self, *_args, **_kwargs):
            return "http://example/checkpoint"

    async def fake_upload(**kwargs):
        uploaded_objects[kwargs["object_name"]] = kwargs["file_data"].read()
        return True

    headers, project_id, image = _create_project_with_part_image(
        client,
        inline_payload=base64.b64encode(_known_yolo11n_sample_png_bytes()).decode(
            "ascii"
        ),
    )
    monkeypatch.setattr(
        yolo_runtime.settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", False
    )
    with (
        patch("utils.boto3_client.upload_file_to_s3", fake_upload),
        patch("utils.boto3_client.boto3_client", FakeS3Client()),
    ):
        upload_response = client.post(
            f"/api/projects/{project_id}/analyze/checkpoints",
            files={
                "file": (
                    "yolo11n-seg.pt",
                    io.BytesIO(checkpoint_bytes),
                    "application/octet-stream",
                )
            },
            headers=headers,
        )
        assert upload_response.status_code == 201, upload_response.text
        checkpoint = upload_response.json()
        assert checkpoint["filename"] == "yolo11n-seg.pt"
        assert checkpoint["model_family"] == "yolo"
        assert uploaded_objects[checkpoint["object_storage_key"]] == checkpoint_bytes

        list_response = client.get(
            f"/api/projects/{project_id}/analyze/checkpoints?model_family=yolo",
            headers=headers,
        )
        assert list_response.status_code == 200, list_response.text
        listed_checkpoints = list_response.json()["checkpoints"]
        assert checkpoint["id"] in [record["id"] for record in listed_checkpoints]
        assert any(
            record["filename"] == "yolo11n-seg.pt" for record in listed_checkpoints
        )

        workflow = _workflow(
            project_id,
            image["id"],
            method_id="segmentation.yolo.placeholder",
            node_id="yolo",
            parameters={
                "mode": "predict",
                "checkpoint_id": checkpoint["id"],
                "options": {"confidence": 0.25, "imgsz": 640},
            },
        )
        response = client.post(
            f"/api/projects/{project_id}/analyze/workflows/execute",
            json=workflow,
            headers=headers,
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    yolo_node = next(
        node for node in payload["node_results"] if node["node_id"] == "yolo"
    )
    assert yolo_node["status"] == "completed"
    assert yolo_node["summary"]["backend"] == "yolo"
    assert yolo_node["summary"]["metrics"] == {
        "runtime": "analysis_toolkit.yolo",
        "mask_count": 5,
    }
    assert yolo_node["summary"]["detection_count"] == 5
    _assert_yolo_detections_close(
        yolo_node["summary"]["detections"][:3],
        [
            {
                "id": "yolo-1",
                "class_name": "bus",
                "confidence": 0.9051998853683472,
                "bbox": {
                    "x": 17.817317962646484,
                    "y": 230.1595458984375,
                    "width": 785.6532020568848,
                    "height": 512.3945922851562,
                },
            },
            {
                "id": "yolo-2",
                "class_name": "person",
                "confidence": 0.8782566785812378,
                "bbox": {
                    "x": 670.2122192382812,
                    "y": 395.2248840332031,
                    "width": 139.3194580078125,
                    "height": 476.5345153808594,
                },
            },
            {
                "id": "yolo-3",
                "class_name": "person",
                "confidence": 0.8457951545715332,
                "bbox": {
                    "x": 51.58706283569336,
                    "y": 396.8096618652344,
                    "width": 172.52756118774414,
                    "height": 504.7131042480469,
                },
            },
        ],
    )
    assert yolo_node["summary"]["measurements"][0]["label"] == "bus"
    assert yolo_node["summary"]["measurements"][0]["bbox"] == pytest.approx(
        [
            17.817317962646484,
            230.1595458984375,
            785.6532020568848,
            512.3945922851562,
        ],
        abs=_YOLO_BBOX_TOLERANCE_PX,
    )


def test_analyze_executes_default_yolo11n_seg_checkpoint_on_example_image(
    client, monkeypatch
):
    """Execute the default yolo11n-seg checkpoint on the example image."""
    if not native_segmentation_runtime_enabled():
        pytest.skip(
            "set VISTA_RUN_NATIVE_SEGMENTATION_TESTS=true to run native YOLO "
            "checkpoint execution"
        )
    headers, project_id, image = _create_project_with_part_image(
        client,
        inline_payload=base64.b64encode(_known_yolo11n_sample_png_bytes()).decode(
            "ascii"
        ),
    )
    monkeypatch.setattr(
        yolo_runtime.settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", False
    )
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.yolo.placeholder",
        node_id="yolo",
        parameters={"mode": "predict", "options": {"confidence": 0.25, "imgsz": 640}},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    yolo_node = next(
        node for node in payload["node_results"] if node["node_id"] == "yolo"
    )
    assert yolo_node["status"] == "completed"
    assert yolo_node["summary"]["backend"] == "yolo"
    assert yolo_node["summary"]["metrics"] == {
        "runtime": "analysis_toolkit.yolo",
        "mask_count": 5,
    }
    assert yolo_node["summary"]["detection_count"] == 5
    assert yolo_node["summary"]["detections"][0]["class_name"] == "bus"
    assert yolo_node["summary"]["detections"][0]["bbox"] == pytest.approx(
        {
            "x": 17.817317962646484,
            "y": 230.1595458984375,
            "width": 785.6532020568848,
            "height": 512.3945922851562,
        },
        abs=_YOLO_BBOX_TOLERANCE_PX,
    )


def test_analyze_executes_default_anomalib_patchcore_on_example_image(client):
    """Execute the default Anomalib PatchCore runtime on the example image."""
    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.anomalib.placeholder",
        node_id="anomalib",
        parameters={
            "mode": "default",
            "options": {
                "model_name": "patchcore",
                "threshold": 0.5,
                "min_mask_area_px": 1.0,
            },
        },
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    anomalib_node = next(
        node for node in payload["node_results"] if node["node_id"] == "anomalib"
    )
    assert anomalib_node["status"] == "completed"
    assert anomalib_node["summary"]["backend"] == "anomalib"
    assert anomalib_node["summary"]["metrics"]["runtime"] == "vista.patchcore"
    assert anomalib_node["summary"]["metrics"]["mask_count"] == 1
    assert anomalib_node["summary"]["metrics"]["anomaly_score"] == 1.0
    assert anomalib_node["summary"]["detections"][0]["class_name"] == "patchcore"
    bbox = anomalib_node["summary"]["detections"][0]["bbox"]
    assert bbox["x"] == pytest.approx(20.0, abs=1.0)
    assert bbox["y"] == pytest.approx(15.0, abs=1.0)
    assert bbox["width"] == pytest.approx(26.0, abs=2.0)
    assert bbox["height"] == pytest.approx(26.0, abs=2.0)


def test_analyze_executes_default_anomalib_patchcore_sample_as_non_uniform_heatmap(
    client,
):
    """Execute PatchCore on the sample image and return a non-uniform heatmap."""
    image_bytes = _sample_image_bytes()
    headers, project_id, image = _create_project_with_custom_image(
        client,
        image_bytes=image_bytes,
        filename="sample_image.jpg",
        content_type="image/jpeg",
    )
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.anomalib.placeholder",
        node_id="anomalib",
        parameters={
            "mode": "default",
            "options": {
                "model_name": "patchcore",
                "threshold": 0.5,
                "min_mask_area_px": 1.0,
            },
        },
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    anomalib_node = next(
        node for node in payload["node_results"] if node["node_id"] == "anomalib"
    )
    assert anomalib_node["status"] == "completed"
    assert anomalib_node["summary"]["backend"] == "anomalib"
    assert anomalib_node["summary"]["metrics"]["runtime"] == "vista.patchcore"
    output_node = next(
        node for node in payload["node_results"] if node["node_id"] == "output"
    )
    overlay_artifact = next(
        artifact
        for artifact in output_node["artifacts"]
        if artifact["kind"] == "overlay_image"
    )
    assert overlay_artifact["metadata"]["analysis_overlay_type"] == "heatmap"
    overlay_image = _overlay_image_from_base64(overlay_artifact["data_base64"])
    _assert_non_uniform_heatmap_overlay(overlay_image)

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    overlay_record = parts_response.json()[0]["metadata"]["analysis_outputs"][0]
    assert overlay_record["label"] == "Anomaly Heatmap Overlay :: Anomalib"
    assert overlay_record["analysis_overlay_type"] == "heatmap"
    assert overlay_record["metadata"]["analysis_overlay_type"] == "heatmap"
    _assert_analysis_output_targets_inspection_overlay(
        overlay_record, expected_label="Anomaly Heatmap Overlay :: Anomalib"
    )
    content_response = client.get(
        f"/api/images/{overlay_record['image_id']}/content", headers=headers
    )
    assert content_response.status_code == 200, content_response.text
    _assert_non_uniform_heatmap_overlay(
        Image.open(io.BytesIO(content_response.content)).convert("RGBA")
    )


def test_analyze_executes_opencv_segmentation_from_object_storage(client):
    """Execute OpenCV on an image read back from object storage."""
    image_bytes = _sample_png_bytes()
    headers, project_id, image = _create_project_with_part_image(
        client, inline_payload=False
    )
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.opencv.placeholder",
        node_id="opencv",
        parameters={"mode": "default"},
    )

    class FakeBody:
        def read(self):
            return image_bytes

    class FakeS3Client:
        def get_object(self, Bucket, Key):
            assert Key == image["object_storage_key"]
            return {"Body": FakeBody()}

    with patch("utils.boto3_client.boto3_client", FakeS3Client()):
        response = client.post(
            f"/api/projects/{project_id}/analyze/workflows/execute",
            json=workflow,
            headers=headers,
        )

    assert response.status_code == 200, response.text
    assert "cannot identify image file" not in response.text
    payload = response.json()
    assert payload["status"] == "completed"
    opencv_node = next(
        node for node in payload["node_results"] if node["node_id"] == "opencv"
    )
    assert opencv_node["summary"]["backend"] == "opencv"
    assert opencv_node["summary"]["detections"][0]["bbox"] == {
        "x": 20.0,
        "y": 15.0,
        "width": 26.0,
        "height": 26.0,
    }
    _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.opencv.placeholder",
    )


def test_analyze_attaches_fastapi_uploaded_volume_prediction_as_overlay(
    client, monkeypatch
):
    """Attach an uploaded FastAPI volume prediction to the run as an overlay."""
    from analyze_toolbox import segmentation_step, uploaded_predictions
    from analyze_toolbox.segmentation import SegmentationOutput

    headers, project_id, image = _create_project_with_part_image(client, volume=True)
    prediction_key = f"{project_id}/analysis/{image['id']}/prediction.npy"
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.fastapi.remote",
        node_id="fastapi",
        parameters={"fastapi_url": "http://localhost:8001/run-inference-presigned"},
    )

    def fake_run(_self, _data):
        return SegmentationOutput(
            backend="gpu_inference_api",
            mode="default",
            masks=[],
            metrics={
                "runtime": "gpu_inference_api.job",
                "job_id": "job-1",
                "job_status": "completed",
                "uploaded_outputs": [
                    {
                        "kind": "prediction",
                        "object_key": prediction_key,
                        "filename": "prediction.npy",
                        "size_bytes": 960,
                    },
                ],
            },
            raw_output={"job_id": "job-1", "status": "completed"},
        )

    def fake_uploaded_prediction(_result, _target_size):
        return (
            None,
            {
                "gpu_prediction_overlay": True,
                "gpu_prediction_overlay_type": "volume",
                "gpu_prediction_object_key": prediction_key,
                "gpu_prediction_shape": [3, 60, 80],
            },
            [
                {
                    "kind": "volume_overlay",
                    "label": "Segmentation Overlay :: FastAPI Segmentation",
                    "method_id": "segmentation.fastapi.remote",
                    "method_name": "FastAPI Segmentation",
                    "object_key": prediction_key,
                    "filename": "prediction.npy",
                    "content_type": "application/octet-stream",
                    "size_bytes": 960,
                    "metadata": {
                        "load_mode": "volume",
                        "volume_shape": {"axial": 3, "coronal": 60, "sagittal": 80},
                        "frame_count": 3,
                        "channel_count": 1,
                        "color_mode": "scalar",
                        "pixel_dtype": "uint8",
                        "voxel_dtype": "uint8",
                    },
                }
            ],
        )

    monkeypatch.setattr(segmentation_step.SegmentationComponent, "run", fake_run)
    monkeypatch.setattr(
        uploaded_predictions,
        "labels_or_volume_artifact_from_uploaded_prediction",
        fake_uploaded_prediction,
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    fastapi_node = next(
        node for node in payload["node_results"] if node["node_id"] == "fastapi"
    )
    assert fastapi_node["summary"]["gpu_prediction_overlay"] is True
    output_node = next(
        node for node in payload["node_results"] if node["node_id"] == "output"
    )
    volume_artifact = next(
        artifact
        for artifact in output_node["artifacts"]
        if artifact["kind"] == "volume_overlay"
    )
    assert volume_artifact["object_key"] == prediction_key

    parts_response = client.get(f"/api/projects/{project_id}/parts", headers=headers)
    assert parts_response.status_code == 200, parts_response.text
    analysis_outputs = parts_response.json()[0]["metadata"]["analysis_outputs"]
    overlay_record = next(
        record
        for record in analysis_outputs
        if record["analysis_method_id"] == "segmentation.fastapi.remote"
    )
    assert overlay_record["overlay"] is True
    assert overlay_record["overlay_base_image_id"] == image["id"]
    assert overlay_record["load_mode"] == "volume"
    assert overlay_record["volume_shape"] == {"axial": 3, "coronal": 60, "sagittal": 80}
    assert overlay_record["channel_count"] == 1

    overlay_response = client.get(
        f"/api/images/{overlay_record['image_id']}", headers=headers
    )
    assert overlay_response.status_code == 200, overlay_response.text
    overlay_image = overlay_response.json()
    assert overlay_image["object_storage_key"] == prediction_key
    assert overlay_image["metadata"]["analysis_output_kind"] == "volume_overlay"
    assert overlay_image["metadata"]["volume_shape"] == {
        "axial": 3,
        "coronal": 60,
        "sagittal": 80,
    }


def test_analyze_opencv_runtime_failure_returns_warning_json(client, monkeypatch):
    """Return a warning, not an error, when the OpenCV runtime fails."""
    from backend.utils.segmentation_integrations import opencv_backend

    from utils.segmentation_integrations import (
        opencv_backend as top_level_opencv_backend,
    )

    headers, project_id, image = _create_project_with_part_image(client)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.opencv.placeholder",
        node_id="opencv",
        parameters={"mode": "default"},
    )

    def fail_loader():
        raise RuntimeError("runtime import exploded")

    monkeypatch.setattr(opencv_backend, "_load_opencv_runtime", fail_loader)
    monkeypatch.setattr(top_level_opencv_backend, "_load_opencv_runtime", fail_loader)

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    opencv_node = next(
        node for node in payload["node_results"] if node["node_id"] == "opencv"
    )
    assert opencv_node["status"] == "completed"
    assert opencv_node["summary"]["backend"] == "opencv"
    assert (
        opencv_node["summary"]["metrics"]["runtime"]
        == "analysis_toolkit.opencv_fallback"
    )
    assert (
        "runtime import exploded"
        in opencv_node["summary"]["metrics"]["fallback_reason"]
    )
    assert "OpenCV runtime failed" in opencv_node["summary"]["runtime_warning"]
    assert opencv_node["summary"]["runtime_warning"] in payload["warnings"]
    assert opencv_node["summary"]["detections"][0]["bbox"] == {
        "x": 20.0,
        "y": 15.0,
        "width": 26.0,
        "height": 26.0,
    }


def test_analyze_run_example_rejects_invalid_inline_image_data_url(client):
    """Reject an invalid inline image data URL with a 400 response."""
    headers, project_id, image = _create_project_with_part_image(
        client,
        inline_payload="data:image/png;base64,not-image-data",
    )
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.opencv.placeholder",
        node_id="opencv",
        parameters={"mode": "default"},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 400, response.text
    assert (
        response.json()["detail"]
        == f"Inline image data for {image['filename']} is invalid"
    )
    assert "cannot identify image file" not in response.text


def test_analyze_run_example_executes_default_opencv_on_volume_image(client):
    """Execute default OpenCV segmentation on a volume image."""
    headers, project_id, image = _create_project_with_part_image(client, volume=True)
    workflow = _workflow(
        project_id,
        image["id"],
        method_id="segmentation.opencv.placeholder",
        node_id="opencv",
        parameters={"mode": "default"},
    )

    response = client.post(
        f"/api/projects/{project_id}/analyze/workflows/execute",
        json=workflow,
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert "cannot identify image file" not in response.text
    payload = response.json()
    assert payload["status"] == "completed"
    opencv_node = next(
        node for node in payload["node_results"] if node["node_id"] == "opencv"
    )
    assert opencv_node["summary"]["backend"] == "opencv"
    assert opencv_node["summary"]["mode"] == "watershed"
    assert opencv_node["summary"]["metrics"]["runtime"] == "analysis_toolkit.opencv"
    assert opencv_node["summary"]["detections"][0]["bbox"] == {
        "x": 20.0,
        "y": 15.0,
        "width": 26.0,
        "height": 26.0,
    }
    _assert_persisted_overlay_output(
        client,
        headers,
        project_id,
        image,
        payload,
        "segmentation.opencv.placeholder",
        require_inline=False,
    )
