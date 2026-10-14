import json
from pathlib import Path

from .contracts import MethodParameter, MethodSpec

OFF_THE_SHELF_CHECKPOINTS_PATH = Path(__file__).with_name(
    "off_the_shelf_checkpoints.json"
)


def off_the_shelf_checkpoints(model_family):
    try:
        catalog = json.loads(OFF_THE_SHELF_CHECKPOINTS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    checkpoints = catalog.get("checkpoints") if isinstance(catalog, dict) else []
    return [
        checkpoint
        for checkpoint in checkpoints
        if isinstance(checkpoint, dict)
        and checkpoint.get("model_family") == model_family
        and checkpoint.get("available") is True
    ]


def segmentation_parameters(
    options_default=None, integration_default="local", include_checkpoint=False
):
    options_default = dict(options_default or {})
    parameters = [
        MethodParameter(
            name="integration_mode",
            label="Local/Remote",
            type="select",
            default=integration_default,
            options=["local", "remote"],
            description="Run with the local VISTA runtime or send the request to a remote FastAPI service.",
        ),
        MethodParameter(
            name="fastapi_url",
            label="FastAPI URL",
            type="string",
            default="",
            description="Remote mode only: URL that accepts SegmentInput-shaped JSON and returns SegmentOutput-shaped JSON.",
        ),
        MethodParameter(
            name="mode", label="Segmentation Mode", type="string", default="default"
        ),
        MethodParameter(name="prompts", label="Prompts JSON", type="json", default={}),
    ]
    if include_checkpoint:
        parameters.append(
            MethodParameter(
                name="checkpoint_id",
                label="Checkpoint",
                type="string",
                default="",
                description="Choose a project or authorized-group checkpoint from the Analyze Checkpoints tab.",
            )
        )
    parameters.append(
        MethodParameter(
            name="options",
            label="Options JSON",
            type="json",
            default=options_default,
        )
    )
    return parameters


SEGMENTATION_PLACEHOLDER_PARAMETERS = segmentation_parameters()


FASTAPI_SEGMENTATION_PARAMETERS = [
    MethodParameter(
        name="fastapi_url",
        label="FastAPI URL",
        type="string",
        default="http://localhost:8001/run-inference-presigned",
        required=True,
        description="Remote presigned GPU inference endpoint used by the VISTA Analyze demonstration.",
    ),
]


TOOLBOX_METHODS = [
    MethodSpec(
        id="source.project_part_images",
        name="Project Part Image Source",
        category="Input",
        description="Provides all images assigned to loaded inspection parts in the current VISTA project.",
        input_types=["any"],
        output_types=["image"],
        parameters=[
            MethodParameter(
                name="example_image_id",
                label="Choose Example",
                type="string",
                default="",
            ),
        ],
        tags=["vista", "input", "parts"],
        jipipe_origin="Data source node",
    ),
    MethodSpec(
        id="output.versioned_image_artifact",
        name="Recipe / Artifact Output",
        category="Output",
        description="Stores processing versions as reproducible recipes, writes detections as metadata, persists spatial outputs as overlays, and materializes images only when needed.",
        input_types=[
            "image",
            "mask",
            "labels",
            "detections",
            "measurements",
            "metadata",
        ],
        output_types=["metadata"],
        parameters=[
            MethodParameter(
                name="mode",
                label="Output Mode",
                type="select",
                default="processing_sequence",
                options=[
                    "processing_sequence",
                    "metadata_only",
                    "overlay_artifact",
                    "materialized_image",
                    "review_only",
                ],
            ),
            MethodParameter(
                name="export_policy",
                label="Export Policy",
                type="select",
                default="materialize_on_export",
                options=[
                    "materialize_on_export",
                    "recipe_plus_artifacts",
                    "metadata_only",
                ],
            ),
            MethodParameter(
                name="materialize_processed_images",
                label="Materialize Processed Images",
                type="boolean",
                default=False,
            ),
        ],
        tags=["vista", "output", "recipe", "overlay", "metadata", "cache"],
        jipipe_origin="Data sink node",
    ),
    MethodSpec(
        id="preprocess.window_level_normalization",
        name="Window / Level Normalization",
        category="Preprocessing",
        description="Maps image intensities into a display or processing window using configurable level and width.",
        output_types=["image"],
        parameters=[
            MethodParameter(
                name="window",
                label="Window",
                type="float",
                default=400.0,
                min_value=1.0,
            ),
            MethodParameter(name="level", label="Level", type="float", default=40.0),
            MethodParameter(
                name="clip", label="Clip Outliers", type="boolean", default=True
            ),
        ],
        tags=["normalization", "intensity", "window-level"],
        jipipe_origin="ImageJ contrast/intensity adjustment",
    ),
    MethodSpec(
        id="preprocess.minmax_normalization",
        name="Min-Max Normalization",
        category="Preprocessing",
        description="Rescales image intensities to a target numeric range.",
        output_types=["image"],
        parameters=[
            MethodParameter(
                name="output_min", label="Output Min", type="float", default=0.0
            ),
            MethodParameter(
                name="output_max", label="Output Max", type="float", default=1.0
            ),
        ],
        tags=["normalization", "intensity"],
        jipipe_origin="ImageJ normalize operation",
    ),
    MethodSpec(
        id="measure.region_properties",
        name="Region Properties (placeholder)",
        category="Measurement",
        description="Placeholder measurement block for area, centroid, bounding box, and intensity summaries. Replace with your deployed measurement implementation as needed.",
        input_types=["labels", "mask"],
        output_types=["measurements", "table"],
        parameters=[
            MethodParameter(
                name="features",
                label="Features",
                type="string",
                default="area,centroid,bbox,mean_intensity",
            ),
        ],
        tags=["measurement", "table", "placeholder"],
        jipipe_origin="Measure objects placeholder",
    ),
    MethodSpec(
        id="segmentation.yolo.placeholder",
        name="YOLO",
        category="Segmentation",
        description="YOLO segmentation integration backed by the Ultralytics YOLO adapter.",
        output_types=["mask", "detections", "measurements"],
        parameters=segmentation_parameters(
            {"model": "yolo11n-seg.pt", "confidence": 0.25, "iou": 0.7},
            include_checkpoint=True,
        ),
        tags=["segmentation", "yolo", "toolkit", "custom-integration"],
        available_checkpoints=off_the_shelf_checkpoints("yolo"),
        jipipe_origin="Ultralytics YOLO segmentation implementation",
    ),
    MethodSpec(
        id="segmentation.anomalib.placeholder",
        name="Anomalib",
        category="Segmentation",
        description="Anomalib-style anomaly segmentation using a dependency-free PatchCore-like heuristic (NumPy and Pillow).",
        output_types=["mask", "measurements", "metadata"],
        parameters=segmentation_parameters(
            {"model_name": "patchcore", "threshold": 0.5, "min_mask_area_px": 1.0},
            include_checkpoint=True,
        ),
        tags=["segmentation", "anomalib", "anomaly", "toolkit", "custom-integration"],
        available_checkpoints=off_the_shelf_checkpoints("anomalib"),
        jipipe_origin="PatchCore-like anomaly segmentation implementation",
    ),
    MethodSpec(
        id="segmentation.sam.placeholder",
        name="SAM",
        category="Segmentation",
        description="Segment Anything integration backed by the segment-anything SAM adapter, with local fallback behavior when a checkpoint is not configured.",
        output_types=["mask", "measurements"],
        parameters=segmentation_parameters(include_checkpoint=True),
        tags=["segmentation", "sam", "promptable", "toolkit", "custom-integration"],
        available_checkpoints=off_the_shelf_checkpoints("sam"),
        jipipe_origin="Segment Anything (SAM) segmentation implementation",
    ),
    MethodSpec(
        id="segmentation.opencv.placeholder",
        name="OpenCV",
        category="Segmentation",
        description="Classical OpenCV watershed segmentation integration.",
        output_types=["mask", "measurements"],
        parameters=segmentation_parameters({"min_peak_distance_px": 1}),
        tags=["segmentation", "opencv", "toolkit", "custom-integration"],
        jipipe_origin="OpenCV watershed segmentation implementation",
    ),
    MethodSpec(
        id="segmentation.fastapi.remote",
        name="FastAPI Segmentation",
        category="Segmentation",
        description="Calls a remote FastAPI segmentation endpoint with the VISTA image payload and normalizes returned masks or CapVision predictions.",
        output_types=["mask", "detections", "measurements", "metadata"],
        parameters=FASTAPI_SEGMENTATION_PARAMETERS,
        tags=["segmentation", "fastapi", "remote", "capvision", "custom-integration"],
        jipipe_origin="Remote FastAPI segmentation service",
    ),
]
