import io
import sys
import types
import uuid
import base64

from PIL import Image, ImageDraw

from backend.analyze_toolbox import WorkflowGraph, WorkflowImageInput, execute_image_workflow, get_manifest, validate_workflow


def _png_bytes() -> bytes:
    image = Image.new("L", (4, 4), 0)
    pixels = image.load()
    for y in range(4):
        for x in range(2, 4):
            pixels[x, y] = 220
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _rgb_png_bytes() -> bytes:
    image = Image.new("RGB", (2, 1))
    pixels = image.load()
    pixels[0, 0] = (0, 20, 100)
    pixels[1, 0] = (100, 220, 200)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _sn0002_back_segmentation_png_bytes(*, inverted: bool = False) -> bytes:
    image = Image.new("L", (96, 64), 255 if inverted else 0)
    draw = ImageDraw.Draw(image)
    fills = [30, 40, 50] if inverted else [220, 200, 180]
    for bbox, fill in zip(
        ([8, 8, 25, 30], [38, 10, 56, 34], [70, 12, 86, 38]),
        fills,
    ):
        draw.rectangle(bbox, fill=fill)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _workflow_for_segmentation_model(method_id: str, parameters: dict) -> WorkflowGraph:
    return WorkflowGraph(
        name=f"Published segmentation regression {method_id}",
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "model", "method_id": method_id, "parameters": parameters},
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "model"},
            {"source_node": "model", "target_node": "output"},
        ],
    )


def test_output_toolbox_exposes_only_operator_level_parameters():
    manifest = get_manifest()
    output_method = next(method for method in manifest.methods if method.id == "output.versioned_image_artifact")

    assert [parameter.name for parameter in output_method.parameters] == [
        "mode",
        "export_policy",
        "materialize_processed_images",
    ]


def test_workflow_contract_accepts_multiple_input_rooted_processing_chains():
    workflow = WorkflowGraph(
        name="Parallel chains",
        nodes=[
            {
                "id": "input-1",
                "method_id": "source.project_part_images",
                "label": "Input",
                "chain_id": "chain-1",
                "parameters": {},
            },
            {
                "id": "yolo",
                "method_id": "ml.yolov8.detect",
                "label": "YOLOv8",
                "chain_id": "chain-1",
                "parameters": {"model": "yolov8n.pt", "confidence": 0.25},
            },
            {
                "id": "input-2",
                "method_id": "source.project_part_images",
                "label": "Input 2",
                "chain_id": "chain-2",
                "parameters": {},
            },
            {
                "id": "segment",
                "method_id": "segmentation.watershed_seeds",
                "label": "Segmentation",
                "chain_id": "chain-2",
                "parameters": {"seed_spacing_px": 18, "compactness": 0.01},
            },
        ],
        edges=[
            {"source_node": "input-1", "target_node": "yolo"},
            {"source_node": "input-2", "target_node": "segment"},
        ],
    )

    result = validate_workflow(workflow)

    assert result.status == "validated"
    assert [node.node_id for node in result.node_results] == ["input-1", "yolo", "input-2", "segment"]


def test_execute_image_workflow_runs_actual_image_algorithms_on_image_bytes():
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="Actual execution",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {
                "id": "window",
                "method_id": "preprocess.window_level_normalization",
                "parameters": {"window": 255, "level": 128, "clip": True},
            },
            {"id": "threshold", "method_id": "threshold.otsu", "parameters": {}},
            {
                "id": "components",
                "method_id": "segmentation.connected_components",
                "parameters": {"min_area_px": 1},
            },
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "window"},
            {"source_node": "window", "target_node": "threshold"},
            {"source_node": "threshold", "target_node": "components"},
            {"source_node": "components", "target_node": "output"},
        ],
    )

    result = execute_image_workflow(
        workflow,
        [
            WorkflowImageInput(
                image_id=image_id,
                filename="two-tone.png",
                content_type="image/png",
                data=_png_bytes(),
            )
        ],
    )

    assert result.status == "completed"
    assert result.execution_mode == "execution"
    assert result.image_count == 1
    component_result = next(node for node in result.node_results if node.node_id == "components")
    assert component_result.summary["region_count"] == 1
    output_result = next(node for node in result.node_results if node.node_id == "output")
    assert {artifact["kind"] for artifact in output_result.artifacts} >= {"overlay_image", "recipe"}
    overlay_artifact = next(artifact for artifact in output_result.artifacts if artifact["kind"] == "overlay_image")
    assert overlay_artifact["label"] == "Segmentation Overlay :: Connected Components"
    assert overlay_artifact["method_id"] == "segmentation.connected_components"


def test_yolov8_object_detection_skips_without_runtime_and_does_not_fabricate_detections():
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="YOLO contract execution",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "yolo", "method_id": "ml.yolov8.detect", "parameters": {"model": "yolov8n.pt", "confidence": 0.25}},
        ],
        edges=[{"source_node": "input", "target_node": "yolo"}],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="tiny.png", content_type="image/png", data=_png_bytes())],
    )

    assert result.status == "completed"
    assert any("YOLO model 'yolov8n.pt' was not used" in warning for warning in result.warnings)
    yolo_node = next(node for node in result.node_results if node.node_id == "yolo")
    assert yolo_node.status == "skipped"
    assert yolo_node.summary["runtime"] == "unavailable"
    assert "runtime_warning" in yolo_node.summary
    assert yolo_node.summary["detection_count"] == 0
    assert yolo_node.summary["measurement_count"] == 0
    assert yolo_node.artifacts == []


def test_yolov8_object_detection_output_suppresses_artifacts_when_runtime_is_unavailable():
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="YOLO detection overlay output",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "yolo", "method_id": "ml.yolov8.detect", "parameters": {"model": "yolov8n.pt", "confidence": 0.25}},
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "yolo"},
            {"source_node": "yolo", "target_node": "output"},
        ],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="tiny.png", content_type="image/png", data=_png_bytes())],
    )

    assert result.status == "completed"
    yolo_node = next(node for node in result.node_results if node.node_id == "yolo")
    assert yolo_node.status == "skipped"
    output_node = next(node for node in result.node_results if node.node_id == "output")
    assert output_node.status == "skipped"
    assert output_node.summary["artifact_count"] == 0
    assert "artifact_block_reason" in output_node.summary
    assert output_node.artifacts == []


def test_hidden_legacy_model_blocks_execute_fallback_overlays():
    method_ids = {method.id for method in get_manifest().methods}
    assert {
        "segmentation.yolo.placeholder",
        "segmentation.anomalib.placeholder",
        "segmentation.sam.placeholder",
        "segmentation.opencv.placeholder",
    }.issubset(method_ids)
    assert "ml.sam.segment_anything" not in method_ids

    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="Modern model fallback overlay",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "sam", "method_id": "ml.sam.segment_anything", "parameters": {"variant": "sam2.1_hiera_large"}},
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "sam"},
            {"source_node": "sam", "target_node": "output"},
        ],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="tiny.png", content_type="image/png", data=_png_bytes())],
    )

    assert result.status == "completed"
    sam_node = next(node for node in result.node_results if node.node_id == "sam")
    assert sam_node.summary["runtime"] == "fallback"
    output_node = next(node for node in result.node_results if node.node_id == "output")
    assert any(artifact["kind"] == "overlay_image" for artifact in output_node.artifacts)


def test_sam_vit_b_fallback_segments_sn0002_back_like_objects_instead_of_whole_image():
    image_id = uuid.uuid4()
    workflow = _workflow_for_segmentation_model(
        "ml.sam.segment_anything",
        {"variant": "sam_vit_b", "prompt_mode": "automatic", "prompt_json": {}},
    )

    result = execute_image_workflow(
        workflow,
        [
            WorkflowImageInput(
                image_id=image_id,
                filename="SN0002_back_fixture.png",
                content_type="image/png",
                data=_sn0002_back_segmentation_png_bytes(),
            )
        ],
    )

    assert result.status == "completed"
    sam_node = next(node for node in result.node_results if node.node_id == "model")
    assert sam_node.summary["runtime"] == "fallback"
    assert sam_node.summary["model"] == "sam_vit_b"
    assert sam_node.summary["segment_count"] == 3
    assert sam_node.summary["measurement_count"] == 3
    assert sam_node.summary["foreground_polarity"] == "bright"
    assert sam_node.summary["largest_region_fraction"] < 0.10
    output_node = next(node for node in result.node_results if node.node_id == "output")
    overlay_artifact = next(artifact for artifact in output_node.artifacts if artifact["kind"] == "overlay_image")
    overlay_image = Image.open(io.BytesIO(base64.b64decode(overlay_artifact["data_base64"]))).convert("RGBA")
    alpha_pixels = sum(1 for _r, _g, _b, alpha in overlay_image.getdata() if alpha > 0)
    assert 0 < alpha_pixels < overlay_image.width * overlay_image.height


def test_sam_vit_b_fallback_detects_dark_objects_without_publishing_background_mask():
    image_id = uuid.uuid4()
    workflow = _workflow_for_segmentation_model(
        "ml.sam.segment_anything",
        {"variant": "sam_vit_b", "prompt_mode": "automatic", "prompt_json": {}},
    )

    result = execute_image_workflow(
        workflow,
        [
            WorkflowImageInput(
                image_id=image_id,
                filename="SN0002_back_dark_parts_fixture.png",
                content_type="image/png",
                data=_sn0002_back_segmentation_png_bytes(inverted=True),
            )
        ],
    )

    assert result.status == "completed"
    sam_node = next(node for node in result.node_results if node.node_id == "model")
    assert sam_node.summary["segment_count"] == 3
    assert sam_node.summary["foreground_polarity"] == "dark"
    assert sam_node.summary["foreground_fraction"] < 0.25


def test_foundation_segmentation_models_publish_stable_overlay_results_for_example_images():
    expected_results = [
        (
            "ml.sam.segment_anything",
            {"variant": "sam_vit_b", "prompt_mode": "automatic", "prompt_json": {}},
            "segment_count",
            3,
        ),
        ("ml.mask2former.universal_segment", {}, "segment_count", 3),
        ("ml.oneformer.universal_segment", {}, "segment_count", 1),
    ]

    for method_id, parameters, count_key, expected_count in expected_results:
        image_id = uuid.uuid4()
        result = execute_image_workflow(
            _workflow_for_segmentation_model(method_id, parameters),
            [
                WorkflowImageInput(
                    image_id=image_id,
                    filename="SN0002_back_fixture.png",
                    content_type="image/png",
                    data=_sn0002_back_segmentation_png_bytes(),
                )
            ],
        )

        assert result.status == "completed"
        model_node = next(node for node in result.node_results if node.node_id == "model")
        assert model_node.summary[count_key] == expected_count
        assert model_node.summary.get("measurement_count", expected_count) == expected_count
        output_node = next(node for node in result.node_results if node.node_id == "output")
        overlay_artifact = next(artifact for artifact in output_node.artifacts if artifact["kind"] == "overlay_image")
        assert overlay_artifact["method_id"] == method_id
        assert overlay_artifact["data_base64"]
        overlay_image = Image.open(io.BytesIO(base64.b64decode(overlay_artifact["data_base64"]))).convert("RGBA")
        alpha_pixels = sum(1 for _r, _g, _b, alpha in overlay_image.getdata() if alpha > 0)
        assert 0 < alpha_pixels < overlay_image.width * overlay_image.height


def test_yolo_models_do_not_publish_artifacts_when_offered_runtime_is_unavailable():
    model_workflows = [
        ("ml.yolov8.detect", {"model": "yolov8n.pt", "confidence": 0.25}),
        ("ml.yolov8.segment", {"model": "yolov8n-seg.pt", "confidence": 0.25}),
        ("ml.yolo.ultralytics", {"family": "yolo11", "task": "detect", "size": "n", "confidence": 0.25}),
        ("ml.yolo.ultralytics", {"family": "yolo11", "task": "segment", "size": "n", "confidence": 0.25}),
    ]

    offered_method_ids = {method.id for method in get_manifest().methods}
    assert {"ml.yolov8.detect", "ml.yolov8.segment", "ml.yolo.ultralytics"}.isdisjoint(offered_method_ids)

    for method_id, parameters in model_workflows:
        image_id = uuid.uuid4()
        result = execute_image_workflow(
            _workflow_for_segmentation_model(method_id, parameters),
            [
                WorkflowImageInput(
                    image_id=image_id,
                    filename="SN0002_back_fixture.png",
                    content_type="image/png",
                    data=_sn0002_back_segmentation_png_bytes(),
                )
            ],
        )

        assert result.status == "completed"
        assert any("Ultralytics runtime is unavailable" in warning for warning in result.warnings)
        model_node = next(node for node in result.node_results if node.node_id == "model")
        assert model_node.status == "skipped"
        assert model_node.summary["runtime"] == "unavailable"
        assert model_node.summary["detection_count"] == 0
        assert model_node.summary["measurement_count"] == 0
        assert model_node.artifacts == []
        output_node = next(node for node in result.node_results if node.node_id == "output")
        assert output_node.status == "skipped"
        assert output_node.summary["artifact_count"] == 0
        assert output_node.artifacts == []


def test_yolov8_object_detection_uses_ultralytics_runtime_when_available(monkeypatch):
    class FakeBoxes:
        xyxy = [[1, 1, 3, 3]]
        conf = [0.92]
        cls = [0]

    class FakeResult:
        boxes = FakeBoxes()
        masks = None
        names = {0: "fixture-object"}

    class FakeYOLO:
        def __init__(self, model_name):
            self.model_name = model_name

        def __call__(self, source, conf, verbose=False):
            assert self.model_name == "custom-yolo.pt"
            assert source.mode == "RGB"
            assert conf == 0.4
            assert verbose is False
            return [FakeResult()]

    assert "ml.yolov8.detect" not in {method.id for method in get_manifest().methods}
    monkeypatch.setitem(sys.modules, "ultralytics", types.SimpleNamespace(YOLO=FakeYOLO))
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="YOLO runtime execution",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "yolo", "method_id": "ml.yolov8.detect", "parameters": {"model": "custom-yolo.pt", "confidence": 0.4}},
        ],
        edges=[{"source_node": "input", "target_node": "yolo"}],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="tiny.png", content_type="image/png", data=_png_bytes())],
    )

    assert result.status == "completed"
    assert not any("was not used" in warning for warning in result.warnings)
    yolo_node = next(node for node in result.node_results if node.node_id == "yolo")
    assert yolo_node.summary["runtime"] == "ultralytics"
    assert yolo_node.summary["detection_count"] == 1
    assert yolo_node.summary["measurement_count"] == 1
    assert yolo_node.summary["detections"][0]["class_name"] == "fixture-object"
    assert yolo_node.summary["detection_classes"] == {"fixture-object": 1}


def test_yolov8_detection_resolves_sequence_names_and_publishes_detection_metadata(monkeypatch):
    class FakeBoxes:
        xyxy = [[1, 1, 3, 3]]
        conf = [0.88]
        cls = [1]

    class FakeResult:
        boxes = FakeBoxes()
        masks = None
        names = ["person", "bicycle"]

    class FakeYOLO:
        def __init__(self, model_name):
            self.model_name = model_name

        def __call__(self, source, conf, verbose=False):
            assert self.model_name == "custom-yolo-list-names.pt"
            return [FakeResult()]

    monkeypatch.setitem(sys.modules, "ultralytics", types.SimpleNamespace(YOLO=FakeYOLO))
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="YOLO runtime detection label propagation",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "yolo", "method_id": "ml.yolov8.detect", "parameters": {"model": "custom-yolo-list-names.pt", "confidence": 0.4}},
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "yolo"},
            {"source_node": "yolo", "target_node": "output"},
        ],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="tiny.png", content_type="image/png", data=_png_bytes())],
    )

    yolo_node = next(node for node in result.node_results if node.node_id == "yolo")
    assert yolo_node.summary["detections"][0]["class_name"] == "bicycle"
    assert yolo_node.summary["detection_classes"] == {"bicycle": 1}
    output_node = next(node for node in result.node_results if node.node_id == "output")
    overlay_artifact = next(artifact for artifact in output_node.artifacts if artifact["kind"] == "overlay_image")
    assert overlay_artifact["detections"][0]["class_name"] == "bicycle"
    recipe_artifact = next(artifact for artifact in output_node.artifacts if artifact["kind"] == "recipe")
    assert recipe_artifact["detection_annotations"][0]["class_name"] == "bicycle"


def test_offered_yolo_segmentation_uses_ultralytics_runtime_when_available(monkeypatch):
    class FakeBoxes:
        xyxy = [[1, 1, 3, 3]]
        conf = [0.91]
        cls = [0]

    class FakeMasks:
        data = [
            [
                [0, 0, 0, 0],
                [0, 1, 1, 0],
                [0, 1, 1, 0],
                [0, 0, 0, 0],
            ]
        ]

    class FakeResult:
        boxes = FakeBoxes()
        masks = FakeMasks()
        names = {0: "fixture-segment"}

    class FakeYOLO:
        def __init__(self, model_name):
            self.model_name = model_name

        def __call__(self, source, conf, verbose=False):
            assert self.model_name == "custom-yolo-seg.pt"
            assert source.mode == "RGB"
            assert conf == 0.45
            assert verbose is False
            return [FakeResult()]

    assert "ml.yolov8.segment" not in {method.id for method in get_manifest().methods}
    monkeypatch.setitem(sys.modules, "ultralytics", types.SimpleNamespace(YOLO=FakeYOLO))
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="YOLOv8 runtime instance segmentation",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {
                "id": "segment",
                "method_id": "ml.yolov8.segment",
                "parameters": {"model": "custom-yolo-seg.pt", "confidence": 0.45},
            },
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "segment"},
            {"source_node": "segment", "target_node": "output"},
        ],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="tiny.png", content_type="image/png", data=_png_bytes())],
    )

    assert result.status == "completed"
    assert not any("Ultralytics runtime is unavailable" in warning for warning in result.warnings)
    segment_node = next(node for node in result.node_results if node.node_id == "segment")
    assert segment_node.status == "completed"
    assert segment_node.summary["runtime"] == "ultralytics"
    assert segment_node.summary["instance_count"] == 1
    assert segment_node.summary["detection_count"] == segment_node.summary["instance_count"]
    output_result = next(node for node in result.node_results if node.node_id == "output")
    overlay_artifact = next(artifact for artifact in output_result.artifacts if artifact["kind"] == "overlay_image")
    assert overlay_artifact["label"] == "Instance Segmentation Overlay :: YOLOv8 Instance Segmentation"
    assert overlay_artifact["method_id"] == "ml.yolov8.segment"


def test_minmax_normalization_operates_per_rgb_channel():
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="Minmax RGB per-channel",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {"id": "minmax", "method_id": "preprocess.minmax_normalization", "parameters": {"output_min": 0.0, "output_max": 1.0}},
        ],
        edges=[{"source_node": "input", "target_node": "minmax"}],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="rgb.png", content_type="image/png", data=_rgb_png_bytes())],
    )

    assert result.status == "completed"
    minmax_result = next(node for node in result.node_results if node.node_id == "minmax")
    assert minmax_result.summary["mode"] == "RGB"
    assert minmax_result.summary["intensity_range"] == [0, 255]


def test_edge_density_anomaly_detector_emits_red_overlay_artifact():
    image_id = uuid.uuid4()
    workflow = WorkflowGraph(
        name="Edge density anomaly heatmap",
        source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
            {
                "id": "anomaly",
                "method_id": "anomaly.edge_density_heatmap",
                "parameters": {"sensitivity": 0.6, "blur_radius": 1},
            },
            {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
        ],
        edges=[
            {"source_node": "input", "target_node": "anomaly"},
            {"source_node": "anomaly", "target_node": "output"},
        ],
    )

    result = execute_image_workflow(
        workflow,
        [WorkflowImageInput(image_id=image_id, filename="asphalt.png", content_type="image/png", data=_png_bytes())],
    )

    assert result.status == "completed"
    output_result = next(node for node in result.node_results if node.node_id == "output")
    overlay_artifact = next(artifact for artifact in output_result.artifacts if artifact["kind"] == "overlay_image")
    assert overlay_artifact["method_id"] == "anomaly.edge_density_heatmap"
    overlay_image = Image.open(io.BytesIO(base64.b64decode(overlay_artifact["data_base64"]))).convert("RGBA")
    red_pixel_count = sum(1 for r, g, b, a in overlay_image.getdata() if a > 0 and r > g and r > b)
    assert red_pixel_count > 0


def test_frangi_and_blackhat_anomaly_methods_emit_overlay_artifacts():
    image_id = uuid.uuid4()
    methods = [
        ("anomaly.frangi_ridge", {"sensitivity": 0.5, "blur_radius": 1}),
        ("anomaly.blackhat_morphology", {"kernel_radius": 2, "sensitivity": 0.5}),
    ]

    for method_id, params in methods:
        workflow = WorkflowGraph(
            name=f"Anomaly method {method_id}",
            source={"kind": "manual_selection", "selected_image_ids": [image_id], "image_count": 1},
            nodes=[
                {"id": "input", "method_id": "source.project_part_images", "parameters": {}},
                {"id": "anomaly", "method_id": method_id, "parameters": params},
                {"id": "output", "method_id": "output.versioned_image_artifact", "parameters": {"mode": "overlay_artifact"}},
            ],
            edges=[
                {"source_node": "input", "target_node": "anomaly"},
                {"source_node": "anomaly", "target_node": "output"},
            ],
        )

        result = execute_image_workflow(
            workflow,
            [WorkflowImageInput(image_id=image_id, filename="asphalt.png", content_type="image/png", data=_png_bytes())],
        )

        assert result.status == "completed"
        output_result = next(node for node in result.node_results if node.node_id == "output")
        overlay_artifact = next(artifact for artifact in output_result.artifacts if artifact["kind"] == "overlay_image")
        assert overlay_artifact["method_id"] == method_id
