from typing import Dict

from .contracts import MethodParameter, MethodSpec, ToolboxExecutionResult, ToolboxManifest, WorkflowGraph, WorkflowNodeResult
from .methods import TOOLBOX_METHODS
from .segmentation import SEGMENTATION_METHOD_BACKENDS


def get_manifest() -> ToolboxManifest:
    return ToolboxManifest(methods=TOOLBOX_METHODS)


HIDDEN_LEGACY_METHODS = [
    # Hidden compatibility specs: not returned by get_manifest(), so Pipeline Studio no longer offers them.
    MethodSpec(id="threshold.otsu", name="Otsu Threshold", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask"]),
    MethodSpec(id="threshold.manual", name="Manual Threshold", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask"], parameters=[MethodParameter(name="threshold", label="Threshold", type="float", default=0.5), MethodParameter(name="invert", label="Invert Mask", type="boolean", default=False)]),
    MethodSpec(id="segmentation.connected_components", name="Connected Components", category="Hidden Legacy", description="Hidden legacy compatibility method.", input_types=["mask"], output_types=["labels", "measurements"], parameters=[MethodParameter(name="min_area_px", label="Min Area (px)", type="integer", default=12, min_value=0)]),
    MethodSpec(id="segmentation.watershed_seeds", name="Watershed From Seeds", category="Hidden Legacy", description="Hidden legacy compatibility method.", input_types=["image", "mask"], output_types=["labels"], parameters=[MethodParameter(name="seed_spacing_px", label="Seed Spacing (px)", type="integer", default=18, min_value=1), MethodParameter(name="compactness", label="Compactness", type="float", default=0.01, min_value=0.0)]),
    MethodSpec(id="edge.canny", name="Canny Edges", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask"], parameters=[MethodParameter(name="low_threshold", label="Low Threshold", type="float", default=0.1), MethodParameter(name="high_threshold", label="High Threshold", type="float", default=0.3)]),
    MethodSpec(id="anomaly.edge_density_heatmap", name="Edge Density Heatmap", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "metadata"], parameters=[MethodParameter(name="sensitivity", label="Sensitivity", type="float", default=0.5, min_value=0.0, max_value=1.0), MethodParameter(name="blur_radius", label="Blur Radius", type="integer", default=2, min_value=0)]),
    MethodSpec(id="anomaly.frangi_ridge", name="Frangi Ridge Response", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "metadata"], parameters=[MethodParameter(name="sensitivity", label="Sensitivity", type="float", default=0.55, min_value=0.0, max_value=1.0), MethodParameter(name="blur_radius", label="Pre-Blur Radius", type="integer", default=1, min_value=0)]),
    MethodSpec(id="anomaly.blackhat_morphology", name="Black-Hat Morphology", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "metadata"], parameters=[MethodParameter(name="kernel_radius", label="Kernel Radius", type="integer", default=2, min_value=1), MethodParameter(name="sensitivity", label="Sensitivity", type="float", default=0.5, min_value=0.0, max_value=1.0)]),
    MethodSpec(id="ml.yolov8.detect", name="YOLOv8 Object Detection", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["detections", "measurements"], parameters=[MethodParameter(name="model", label="Model", type="string", default="yolov8n.pt", required=True), MethodParameter(name="confidence", label="Confidence", type="float", default=0.25, min_value=0.0, max_value=1.0), MethodParameter(name="iou", label="IoU", type="float", default=0.45, min_value=0.0, max_value=1.0)]),
    MethodSpec(id="ml.yolov8.segment", name="YOLOv8 Instance Segmentation", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "detections", "measurements"], parameters=[MethodParameter(name="model", label="Model", type="string", default="yolov8n-seg.pt", required=True), MethodParameter(name="confidence", label="Confidence", type="float", default=0.25, min_value=0.0, max_value=1.0)]),
    MethodSpec(id="ml.yolo.ultralytics", name="Configurable YOLO Detection / Segmentation", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["detections", "mask", "measurements"], parameters=[MethodParameter(name="family", label="YOLO Family", type="select", default="yolo11", options=["yolov8", "yolo11", "custom"], required=True), MethodParameter(name="task", label="Task", type="select", default="detect", options=["detect", "segment"], required=True), MethodParameter(name="size", label="Model Size", type="select", default="n", options=["n", "s", "m", "l", "x"]), MethodParameter(name="model", label="Custom Model Path or ID", type="string", default=""), MethodParameter(name="confidence", label="Confidence", type="float", default=0.25, min_value=0.0, max_value=1.0), MethodParameter(name="iou", label="IoU", type="float", default=0.45, min_value=0.0, max_value=1.0)]),
    MethodSpec(id="ml.sam.segment_anything", name="Segment Anything (SAM)", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "measurements"], parameters=[MethodParameter(name="variant", label="Model Variant", type="string", default="sam2.1_hiera_large"), MethodParameter(name="prompt_mode", label="Prompt Mode", type="string", default="automatic"), MethodParameter(name="prompt_json", label="Prompt JSON", type="json", default={}), MethodParameter(name="min_mask_region_area", label="Minimum Mask Region Area", type="integer", default=8), MethodParameter(name="max_foreground_fraction", label="Maximum Foreground Fraction", type="float", default=0.85)]),
    MethodSpec(id="ml.mask2former.universal_segment", name="Mask2Former Universal Segmentation", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "measurements"], parameters=[MethodParameter(name="checkpoint", label="Checkpoint", type="string", default="facebook/mask2former-swin-large-ade-semantic"), MethodParameter(name="task", label="Segmentation Task", type="string", default="semantic")]),
    MethodSpec(id="ml.oneformer.universal_segment", name="OneFormer Universal Segmentation", category="Hidden Legacy", description="Hidden legacy compatibility method.", output_types=["mask", "measurements"], parameters=[MethodParameter(name="checkpoint", label="Checkpoint", type="string", default="shi-labs/oneformer_ade20k_swin_large"), MethodParameter(name="task", label="Segmentation Task", type="string", default="semantic")]),
]


def _method_map() -> Dict[str, object]:
    methods = {method.id: method for method in TOOLBOX_METHODS}
    methods.update({method.id: method for method in HIDDEN_LEGACY_METHODS})
    return methods


def validate_workflow(workflow: WorkflowGraph) -> ToolboxExecutionResult:
    methods = _method_map()
    warnings = []
    node_results = []
    nodes_by_id = {node.id: node for node in workflow.nodes}
    source_nodes = [node for node in workflow.nodes if node.method_id == "source.project_part_images"]

    if workflow.source.kind == "project_parts" and len(source_nodes) < 1:
        raise ValueError("Project part workflows must contain at least one project image source node")

    outgoing = {node.id: [] for node in workflow.nodes}
    incoming = {node.id: [] for node in workflow.nodes}
    for edge in workflow.edges:
        outgoing[edge.source_node].append(edge.target_node)
        incoming[edge.target_node].append(edge.source_node)

    if source_nodes:
        reachable = set()
        visiting = set()

        def walk(node_id: str):
            if node_id in visiting:
                raise ValueError("Workflow graph cannot contain cycles")
            if node_id in reachable:
                return
            visiting.add(node_id)
            for target_id in outgoing.get(node_id, []):
                walk(target_id)
            visiting.remove(node_id)
            reachable.add(node_id)

        for source_node in source_nodes:
            walk(source_node.id)
        disconnected = sorted(set(nodes_by_id) - reachable)
        if disconnected:
            raise ValueError(f"Workflow contains nodes disconnected from an input source: {', '.join(disconnected)}")

    for node in workflow.nodes:
        method = methods.get(node.method_id)
        if method is None:
            raise ValueError(f"Unknown toolbox method '{node.method_id}'")
        allowed_parameters = {parameter.name: parameter for parameter in method.parameters}
        unknown_parameters = sorted(set(node.parameters) - set(allowed_parameters))
        if unknown_parameters:
            raise ValueError(f"Node '{node.id}' has unknown parameters: {', '.join(unknown_parameters)}")
        missing_required = [
            parameter.name
            for parameter in method.parameters
            if parameter.required and node.parameters.get(parameter.name, parameter.default) in (None, "")
        ]
        if missing_required:
            raise ValueError(f"Node '{node.id}' is missing required parameters: {', '.join(missing_required)}")
        for parameter_name, parameter_value in node.parameters.items():
            parameter = allowed_parameters[parameter_name]
            if parameter.min_value is not None and parameter_value not in (None, "") and float(parameter_value) < parameter.min_value:
                raise ValueError(f"Node '{node.id}' parameter '{parameter_name}' is below the minimum")
            if parameter.max_value is not None and parameter_value not in (None, "") and float(parameter_value) > parameter.max_value:
                raise ValueError(f"Node '{node.id}' parameter '{parameter_name}' is above the maximum")
            if parameter.type == "select" and parameter.options and parameter_value not in parameter.options:
                raise ValueError(f"Node '{node.id}' parameter '{parameter_name}' is not an allowed option")
        if node.method_id in SEGMENTATION_METHOD_BACKENDS:
            warnings.append("Segmentation placeholders must be connected to a local Python callable or FastAPI service before deployed use.")
        node_results.append(
            WorkflowNodeResult(
                node_id=node.id,
                method_id=node.method_id,
                status="completed",
                output_types=method.output_types,
                message="Contract validation passed.",
            )
        )

    if not workflow.nodes:
        warnings.append("Workflow has no processing nodes.")

    return ToolboxExecutionResult(
        workflow_name=workflow.name,
        status="validated",
        execution_mode="validation",
        image_count=workflow.source.image_count,
        node_results=node_results,
        warnings=warnings,
    )


def execute_workflow(workflow: WorkflowGraph) -> ToolboxExecutionResult:
    validated = validate_workflow(workflow)
    return ToolboxExecutionResult(
        workflow_name=workflow.name,
        status="simulated",
        execution_mode="simulation",
        image_count=workflow.source.image_count,
        node_results=[
            result.model_copy(update={"message": "Simulation completed; no image artifacts were generated."})
            for result in validated.node_results
        ],
        warnings=validated.warnings,
    )
