import uuid
import json
import mimetypes
import base64
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from core import models, schemas
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from utils.dependencies import get_current_user
import utils.crud as crud
from core.config import settings
from utils.boto3_client import upload_file_to_s3
from utils.volume_loader import load_slice_stack

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

TOOLBOX_IMPORT_ERROR: Optional[Exception] = None
try:
    from test_toolbox import WorkflowGraph, WorkflowImageInput, execute_image_workflow
except ModuleNotFoundError as exc:
    TOOLBOX_IMPORT_ERROR = exc
    WorkflowGraph = None
    WorkflowImageInput = None
    execute_image_workflow = None


router = APIRouter(tags=["Inspection Workbench"])

WORKSPACE_STATE_KEY_PREFIX = "inspection_workbench.workspace_state"
PROJECT_CONFIGURATION_KEY = "inspection_workbench.project_configuration"
PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX = "inspection_workbench.project_type_interface_layout_default"
ANNOTATIONS_METADATA_KEY = "annotations"
WORKSPACE_PANEL_LAYOUT_DEFAULTS = {
    "part_list": {
        "is_open": True,
        "width_px": 320,
        "height_px": 420,
        "orientation": "vertical",
    },
    "inspector": {
        "is_open": True,
        "width_px": 360,
        "height_px": 420,
        "orientation": "vertical",
    },
    "mpr_controls": {
        "is_open": True,
        "width_px": 360,
        "height_px": 360,
        "orientation": "vertical",
    },
}
WORKSPACE_INSPECTOR_DEFAULTS = {
    "shortcut_help_visible": False,
    "normalization_triage_field": "",
    "image_enabled": True,
    "modalities": [],
    "view_name": "",
    "viewport_transform": {"zoom": 1.0, "panX": 0, "panY": 0},
    "measurements": [],
}
TEST_DATA_ROOT = Path(__file__).resolve().parents[2] / "test" / "data"
PT3_TEST_STACK_ROOT = TEST_DATA_ROOT / "3D" / "geometric"
SLICE_SEGMENTATION_METHOD_IDS = {
    "threshold.otsu",
    "threshold.manual",
    "segmentation.connected_components",
    "segmentation.watershed_seeds",
    "ml.yolov8.segment",
    "ml.yolo.ultralytics",
    "ml.sam.segment_anything",
    "ml.mask2former.universal_segment",
    "ml.oneformer.universal_segment",
}


def _require_toolbox() -> None:
    if TOOLBOX_IMPORT_ERROR is None:
        return
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "Inspection slice segmentation is unavailable because dependency 'test_toolbox' "
            f"could not be imported. Original error: {TOOLBOX_IMPORT_ERROR}"
        ),
    )


async def _get_project_with_access_check(
    project_id: uuid.UUID,
    db: AsyncSession,
    current_user: schemas.User,
):
    project = await crud.get_project(db=db, project_id=project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not is_user_in_group(current_user.email, project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to project '{project_id}'.",
        )
    return project


def _serialize_inspection_part(part) -> dict:
    return {
        "id": part.id,
        "project_id": part.project_id,
        "batch_id": part.batch_id,
        "serial_number": part.serial_number,
        "display_name": part.display_name,
        "metadata": part.metadata_json,
        "review_state": part.review_state,
        "created_at": part.created_at,
        "updated_at": part.updated_at,
    }


def _workspace_state_metadata_key(user_email: str) -> str:
    return f"{WORKSPACE_STATE_KEY_PREFIX}:{user_email.strip().lower()}"


def _part_annotations(part) -> List[dict]:
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    annotations = metadata.get(ANNOTATIONS_METADATA_KEY)
    return list(annotations) if isinstance(annotations, list) else []


def _normalize_panel_dimension(value: object, *, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def _normalize_workspace_state(raw_state: object) -> dict:
    safe_state = raw_state.copy() if isinstance(raw_state, dict) else {}
    raw_layout = safe_state.get("panel_layout")
    normalized_layout = {}
    for panel_key, defaults in WORKSPACE_PANEL_LAYOUT_DEFAULTS.items():
        candidate = raw_layout.get(panel_key) if isinstance(raw_layout, dict) else {}
        if not isinstance(candidate, dict):
            candidate = {}
        orientation = str(candidate.get("orientation", defaults["orientation"])).lower()
        if orientation not in {"vertical", "horizontal"}:
            orientation = defaults["orientation"]
        normalized_layout[panel_key] = {
            "is_open": bool(candidate.get("is_open", defaults["is_open"])),
            "width_px": _normalize_panel_dimension(
                candidate.get("width_px"),
                fallback=defaults["width_px"],
                minimum=220,
                maximum=1200,
            ),
            "height_px": _normalize_panel_dimension(
                candidate.get("height_px"),
                fallback=defaults["height_px"],
                minimum=220,
                maximum=1400,
            ),
            "orientation": orientation,
        }
    safe_state["panel_layout"] = normalized_layout

    raw_inspector = safe_state.get("inspector")
    inspector_candidate = raw_inspector if isinstance(raw_inspector, dict) else {}
    shortcut_help_visible = inspector_candidate.get("shortcut_help_visible")
    normalized_shortcut_help_visible = (
        shortcut_help_visible
        if isinstance(shortcut_help_visible, bool)
        else WORKSPACE_INSPECTOR_DEFAULTS["shortcut_help_visible"]
    )
    normalization_triage_field = inspector_candidate.get("normalization_triage_field")
    normalized_triage_field = (
        str(normalization_triage_field).strip()
        if isinstance(normalization_triage_field, str)
        else WORKSPACE_INSPECTOR_DEFAULTS["normalization_triage_field"]
    )
    image_enabled = inspector_candidate.get("image_enabled")
    normalized_image_enabled = (
        image_enabled
        if isinstance(image_enabled, bool)
        else WORKSPACE_INSPECTOR_DEFAULTS["image_enabled"]
    )
    modalities = inspector_candidate.get("modalities")
    normalized_modalities = (
        [str(value) for value in modalities]
        if isinstance(modalities, list)
        else list(WORKSPACE_INSPECTOR_DEFAULTS["modalities"])
    )
    view_name = inspector_candidate.get("view_name")
    normalized_view_name = (
        str(view_name).strip()
        if isinstance(view_name, str)
        else WORKSPACE_INSPECTOR_DEFAULTS["view_name"]
    )
    viewport_transform = inspector_candidate.get("viewport_transform")
    viewport_candidate = viewport_transform if isinstance(viewport_transform, dict) else {}
    default_viewport = WORKSPACE_INSPECTOR_DEFAULTS["viewport_transform"]
    normalized_viewport_transform = {
        "zoom": max(
            0.5,
            min(
                4.0,
                float(viewport_candidate.get("zoom", default_viewport["zoom"]))
                if isinstance(viewport_candidate.get("zoom", default_viewport["zoom"]), (int, float))
                else float(default_viewport["zoom"]),
            ),
        ),
        "panX": _normalize_panel_dimension(
            viewport_candidate.get("panX"),
            fallback=default_viewport["panX"],
            minimum=-200,
            maximum=200,
        ),
        "panY": _normalize_panel_dimension(
            viewport_candidate.get("panY"),
            fallback=default_viewport["panY"],
            minimum=-200,
            maximum=200,
        ),
    }
    measurements = inspector_candidate.get("measurements")
    normalized_measurements = []
    if isinstance(measurements, list):
        for entry in measurements:
            if not isinstance(entry, dict):
                continue
            label_raw = entry.get("label")
            value_raw = entry.get("value")
            label = str(label_raw).strip() if isinstance(label_raw, str) else ""
            if isinstance(value_raw, (int, float)):
                value = str(value_raw)
            elif isinstance(value_raw, str):
                value = value_raw.strip()
            else:
                value = ""
            if not label or not value:
                continue
            measurement_id = str(entry.get("id") or "").strip()
            normalized_measurements.append({
                "id": measurement_id,
                "label": label,
                "value": value,
            })
    safe_state["inspector"] = {
        **inspector_candidate,
        "shortcut_help_visible": normalized_shortcut_help_visible,
        "normalization_triage_field": normalized_triage_field,
        "image_enabled": normalized_image_enabled,
        "modalities": normalized_modalities,
        "view_name": normalized_view_name,
        "viewport_transform": normalized_viewport_transform,
        "measurements": normalized_measurements,
    }
    return safe_state


DEFAULT_DEFECT_TYPE_COLORS = ("#ef4444", "#f59e0b", "#3b82f6")


def _normalize_project_type(project_type: Optional[str]) -> str:
    normalized = str(project_type or "PT1").strip().upper()
    return normalized if normalized in {"PT1", "PT2", "PT3"} else "PT1"


def _default_defect_types(project_type: Optional[str]) -> List[dict]:
    project_type_suffix = _normalize_project_type(project_type)
    return [
        {
            "name": f"DefectType{index + 1}_{project_type_suffix}",
            "color": color,
            "definition": "",
        }
        for index, color in enumerate(DEFAULT_DEFECT_TYPE_COLORS)
    ]


def _default_project_configuration(project_type: Optional[str] = "PT1") -> dict:
    return {
        "image_modalities": [
            {
                "id": "visual",
                "label": "Visual",
                "calibration_required": False,
                "example_image_uploaded": False,
            }
        ],
        "part_views": [
            {"id": "front", "label": "Front", "required_modalities": ["visual"], "source": "manual"},
            {"id": "back", "label": "Back", "required_modalities": ["visual"], "source": "manual"},
        ],
        "defect_types": _default_defect_types(project_type),
        "process_settings": {
            "require_disposition_on_submit": True,
            "require_measurement_for_critical": False,
            "require_second_reviewer_for_reject": False,
            "configurable_hotkeys": {
                "accept_classification": "a",
                "reject_classification": "r",
                "toggle_shortcut_help": "h",
            },
        },
        "display_settings": {
            "default_colormap": "grayscale",
            "anomaly_colormap": "viridis",
            "grayscale_base_image": True,
            "simulation_speed_at_impact": 0.25,
        },
        "phase_settings": {
            "manual_phase_selection_enabled": False,
            "manual_phase": "data_ingestion",
        },
        "project_owner": {
            "name": "",
            "email": "",
        },
        "current_user": {
            "username": "",
            "sso_authenticated": False,
        },
        "interface_layout": {
            "default_model": None,
        },
        "file_naming_scheme": {
            "hierarchy_levels": [
                {"id": "drawing_number", "label": "Drawing Number", "abbreviation": "D"},
                {"id": "part_number", "label": "Part Number", "abbreviation": "P"},
                {"id": "lot_number", "label": "Lot Number", "abbreviation": "L"},
                {"id": "serial_number", "label": "Serial Number", "abbreviation": "S"},
                {"id": "revision", "label": "Revision", "abbreviation": "R"},
            ],
            "image_descriptors": [
                {"id": "view", "label": "View", "abbreviation": "V"},
                {"id": "modality", "label": "Modality", "abbreviation": "M"},
            ],
        },
    }


def _resolve_project_configuration(raw_config: Optional[dict], project_type: Optional[str] = "PT1") -> dict:
    """Merge persisted project configuration with current defaults, including nested settings."""
    default_config = _default_project_configuration(project_type)
    if not isinstance(raw_config, dict):
        return default_config
    resolved = dict(raw_config)
    for nested_key in ("process_settings", "display_settings", "phase_settings", "interface_layout"):
        default_nested = default_config.get(nested_key)
        raw_nested = raw_config.get(nested_key)
        if isinstance(default_nested, dict) and isinstance(raw_nested, dict):
            resolved[nested_key] = {**default_nested, **raw_nested}
    return resolved


def _decode_slice_image_payload(value: str) -> bytes:
    encoded = str(value or "").strip()
    if "," in encoded and encoded.lower().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid slice image payload") from exc


def _slice_segmentation_workflow(method_id: str, parameters: dict):
    if WorkflowGraph is None:
        _require_toolbox()
    if method_id in {"threshold.otsu", "threshold.manual"}:
        return WorkflowGraph(
            name=f"Inspection slice segmentation {method_id}",
            source={"kind": "manual_selection", "image_count": 1, "part_count": 1},
            output={"mode": "metadata_only", "artifact_policy": "metadata_only"},
            nodes=[
                {"id": "input", "method_id": "source.project_part_images"},
                {"id": "threshold", "method_id": method_id, "parameters": parameters or {}},
                {"id": "segment", "method_id": "segmentation.connected_components", "parameters": {"min_area_px": 1}},
            ],
            edges=[
                {"source_node": "input", "target_node": "threshold"},
                {"source_node": "threshold", "target_node": "segment"},
            ],
        )
    return WorkflowGraph(
        name=f"Inspection slice segmentation {method_id}",
        source={"kind": "manual_selection", "image_count": 1, "part_count": 1},
        output={"mode": "metadata_only", "artifact_policy": "metadata_only"},
        nodes=[
            {"id": "input", "method_id": "source.project_part_images"},
            {"id": "segment", "method_id": method_id, "parameters": parameters or {}},
        ],
        edges=[
            {"source_node": "input", "target_node": "segment"},
        ],
    )


def _normalize_segment_region(entry: object, index: int) -> Optional[dict]:
    if not isinstance(entry, dict):
        return None
    bbox = entry.get("bbox")
    if not isinstance(bbox, list) or len(bbox) < 4:
        detection_bbox = entry.get("bbox") if isinstance(entry.get("bbox"), dict) else None
        if detection_bbox:
            x = float(detection_bbox.get("x", 0) or 0)
            y = float(detection_bbox.get("y", 0) or 0)
            width = float(detection_bbox.get("width", 0) or 0)
            height = float(detection_bbox.get("height", 0) or 0)
            bbox = [x, y, x + width, y + height]
    if not isinstance(bbox, list) or len(bbox) < 4:
        return None
    try:
        x1, y1, x2, y2 = [float(value) for value in bbox[:4]]
    except (TypeError, ValueError):
        return None
    if x2 <= x1 or y2 <= y1:
        return None
    raw_centroid = entry.get("centroid")
    centroid = None
    if isinstance(raw_centroid, list) and len(raw_centroid) >= 2:
        try:
            centroid = [float(raw_centroid[0]), float(raw_centroid[1])]
        except (TypeError, ValueError):
            centroid = None
    raw_label = entry.get("label", index + 1)
    try:
        label = int(raw_label)
    except (TypeError, ValueError):
        label = index + 1
    area = entry.get("area_px", (x2 - x1) * (y2 - y1))
    try:
        area_px = float(area)
    except (TypeError, ValueError):
        area_px = float((x2 - x1) * (y2 - y1))
    confidence = entry.get("confidence")
    try:
        confidence_value = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence_value = None
    return {
        "label": label,
        "area_px": area_px,
        "bbox": [x1, y1, x2, y2],
        "centroid": centroid,
        "confidence": confidence_value,
        "class_name": str(entry.get("class_name")) if entry.get("class_name") is not None else None,
    }


def _regions_from_toolbox_result(result) -> List[dict]:
    regions: List[dict] = []
    for node_result in result.node_results:
        summary = node_result.summary if isinstance(node_result.summary, dict) else {}
        for key in ("measurements", "detections"):
            values = summary.get(key)
            if not isinstance(values, list):
                continue
            for entry in values:
                region = _normalize_segment_region(entry, len(regions))
                if region:
                    regions.append(region)
    deduped = {}
    for region in regions:
        key = tuple(round(value, 3) for value in region["bbox"])
        deduped[key] = region
    return list(deduped.values())


def _select_clicked_region(regions: List[dict], click_x: float, click_y: float) -> Optional[dict]:
    containing = []
    for region in regions:
        x1, y1, x2, y2 = region["bbox"]
        if x1 <= click_x <= x2 and y1 <= click_y <= y2:
            containing.append(region)
    if not containing:
        return None
    return min(containing, key=lambda region: region.get("area_px") or float("inf"))


def _prune_config_to_source_shape(*, persisted_config: dict, source_config: dict) -> dict:
    """Trim optional top-level config keys that were absent in source payloads."""
    if not isinstance(persisted_config, dict):
        return {}
    if not isinstance(source_config, dict):
        return persisted_config
    pruned = dict(persisted_config)
    for optional_key in ("phase_settings", "project_owner", "current_user", "interface_layout"):
        if optional_key not in source_config:
            pruned.pop(optional_key, None)
    return pruned


def _strip_optional_default_sections(config: dict) -> dict:
    if not isinstance(config, dict):
        return {}
    pruned = dict(config)
    if pruned.get("phase_settings") == {
        "manual_phase_selection_enabled": False,
        "manual_phase": "data_ingestion",
    }:
        pruned.pop("phase_settings", None)
    if pruned.get("project_owner") == {"name": "", "email": ""}:
        pruned.pop("project_owner", None)
    if pruned.get("current_user") == {"username": "", "sso_authenticated": False}:
        pruned.pop("current_user", None)
    if pruned.get("interface_layout") == {"default_model": None}:
        pruned.pop("interface_layout", None)
    return pruned


def _project_type_interface_layout_metadata_key(project_type: str) -> str:
    return f"{PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX}:{project_type}"


def _metadata_from_hierarchy_filename(path: Path) -> Optional[dict]:
    tokens = path.stem.split("_")
    if len(tokens) != 7:
        return None
    design_number, lot_number, part_set_or_batch, serial_number, side, modality, overlay = tokens
    metadata = {
        "design_number": design_number,
        "lot_number": lot_number,
        "serial_number": serial_number,
        "side": side.lower(),
        "modality": modality.lower(),
        "overlay": overlay.lower() in {"true", "1", "yes"},
        "source": "vista-test-data",
    }
    if part_set_or_batch.upper().startswith("BATCH"):
        metadata["batch_number"] = part_set_or_batch
    else:
        metadata["set_number"] = part_set_or_batch
    return metadata


def _build_hierarchy_ingest_records(uploaded_records: List[dict]) -> schemas.InspectionBulkIngestPayload:
    parts_by_key: dict[str, dict] = {}
    for record in uploaded_records:
        metadata = record.get("metadata") or {}
        part_set_number = metadata.get("set_number")
        batch_number = metadata.get("batch_number")
        required = ["design_number", "lot_number", "serial_number", "side", "modality"]
        if any(not metadata.get(key) for key in required):
            continue
        if not (part_set_number or batch_number):
            continue
        part_group_number = part_set_number or batch_number
        part_key = "_".join([
            metadata["design_number"],
            metadata["lot_number"],
            part_group_number,
            metadata["serial_number"],
        ])
        batch_name = "_".join([metadata["design_number"], metadata["lot_number"], batch_number]) if batch_number else None
        part = parts_by_key.setdefault(
            part_key,
            {
                "batch_name": batch_name,
                "batch_description": (
                    f"Design {metadata['design_number']}, lot {metadata['lot_number']}, "
                    f"batch {batch_number}"
                ) if batch_number else None,
                "serial_number": metadata["serial_number"],
                "display_name": " ".join([
                    metadata["design_number"],
                    metadata["lot_number"],
                    part_group_number,
                    metadata["serial_number"],
                ]),
                "metadata": {
                    "design_number": metadata["design_number"],
                    "lot_number": metadata["lot_number"],
                    "serial_number": metadata["serial_number"],
                    "configured_views": [],
                    "modalities": [],
                    "view_images": {},
                    "overlay_images": {},
                    "source_images": [],
                    "source": "vista-test-data",
                },
            },
        )
        if part_set_number:
            part["metadata"]["set_number"] = part_set_number
        if batch_number:
            part["metadata"]["batch_number"] = batch_number
        side = metadata["side"]
        modality = metadata["modality"]
        if side not in part["metadata"]["configured_views"]:
            part["metadata"]["configured_views"].append(side)
        if modality not in part["metadata"]["modalities"]:
            part["metadata"]["modalities"].append(modality)
        part["metadata"]["source_images"].append({
            "filename": record["filename"],
            "side": side,
            "modality": modality,
            "overlay": metadata["overlay"],
            "image_id": str(record["image_id"]),
        })
        if metadata["overlay"]:
            part["metadata"]["overlay_images"].setdefault(side, {})[modality] = record["filename"]
        elif side not in part["metadata"]["view_images"]:
            part["metadata"]["view_images"][side] = record["filename"]

    batches_by_name: dict[str, schemas.InspectionIngestBatchRecord] = {}
    unassigned_parts: list[schemas.InspectionIngestPartRecord] = []
    for part in parts_by_key.values():
        part["metadata"]["configured_views"].sort()
        part["metadata"]["modalities"].sort()
        ingest_part = schemas.InspectionIngestPartRecord(
            serial_number=part["serial_number"],
            display_name=part["display_name"],
            metadata=part["metadata"],
        )
        if part["batch_name"]:
            batch = batches_by_name.setdefault(
                part["batch_name"],
                schemas.InspectionIngestBatchRecord(
                    name=part["batch_name"],
                    description=part["batch_description"],
                    parts=[],
                ),
            )
            batch.parts.append(ingest_part)
        else:
            unassigned_parts.append(ingest_part)
    for batch in batches_by_name.values():
        batch.parts.sort(key=lambda item: item.serial_number)
    unassigned_parts.sort(key=lambda item: item.serial_number)
    return schemas.InspectionBulkIngestPayload(
        batches=list(batches_by_name.values()),
        unassigned_parts=unassigned_parts,
    )


def _rebuild_part_image_maps(metadata: dict) -> dict:
    source_images = metadata.get("source_images")
    if not isinstance(source_images, list):
        source_images = []
    configured_views: set[str] = set()
    modalities: set[str] = set()
    view_images: dict[str, str] = {}
    overlay_images: dict[str, dict[str, str]] = {}
    normalized_source_images: list[dict] = []

    for record in source_images:
        if not isinstance(record, dict):
            continue
        filename = str(record.get("filename") or "").strip()
        if not filename:
            continue
        side = str(record.get("side") or "").strip().lower()
        modality = str(record.get("modality") or "").strip().lower()
        overlay = bool(record.get("overlay"))
        normalized_record = {
            **record,
            "filename": filename,
            "side": side,
            "modality": modality,
            "overlay": overlay,
        }
        normalized_source_images.append(normalized_record)
        if side:
            configured_views.add(side)
        if modality:
            modalities.add(modality)
        if side and overlay and modality:
            overlay_images.setdefault(side, {})[modality] = filename
        elif side and not overlay and side not in view_images:
            view_images[side] = filename

    return {
        **metadata,
        "source_images": normalized_source_images,
        "configured_views": sorted(configured_views),
        "modalities": sorted(modalities),
        "view_images": view_images,
        "overlay_images": overlay_images,
    }


async def _create_test_image_if_missing(
    *,
    project_id: uuid.UUID,
    file_path: Path,
    metadata: dict,
    db: AsyncSession,
    current_user: schemas.User,
    allow_metadata_only: bool = False,
) -> tuple[models.DataInstance, bool]:
    existing = await db.execute(
        select(models.DataInstance).where(
            models.DataInstance.project_id == project_id,
            models.DataInstance.filename == file_path.name,
            models.DataInstance.deleted_at.is_(None),
        )
    )
    image = existing.scalars().first()
    if image:
        return image, False

    object_storage_key = f"{project_id}/test-data/{file_path.name}"
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    try:
        with file_path.open("rb") as file_obj:
            uploaded = await upload_file_to_s3(
                bucket_name=settings.S3_BUCKET,
                object_name=object_storage_key,
                file_data=file_obj,
                length=file_path.stat().st_size,
                content_type=content_type,
            )
    except Exception as exc:
        if not allow_metadata_only:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to upload test data image",
            ) from exc
        uploaded = False
    if not uploaded:
        if allow_metadata_only:
            metadata = {
                **metadata,
                "storage_status": "metadata_only",
                "storage_warning": "Test data image object could not be uploaded.",
            }
        else:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to upload test data image")

    image = await crud.create_data_instance(
        db=db,
        data_instance=schemas.DataInstanceCreate(
            project_id=project_id,
            filename=file_path.name,
            object_storage_key=object_storage_key,
            content_type=content_type,
            size_bytes=file_path.stat().st_size,
            metadata=metadata,
            uploaded_by_user_id=current_user.email,
        ),
        created_by=current_user.email,
    )
    return image, True


async def _bulk_ingest_project_parts(
    *,
    project_id: uuid.UUID,
    payload: schemas.InspectionBulkIngestPayload,
    db: AsyncSession,
    current_user: schemas.User,
):
    existing_batches = await crud.list_inspection_batches(db=db, project_id=project_id)
    batches_by_name = {batch.name: batch for batch in existing_batches}
    existing_parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    parts_by_serial = {part.serial_number: part for part in existing_parts}

    counters = {
        "batches_received": len(payload.batches),
        "parts_received": sum(len(batch.parts) for batch in payload.batches) + len(payload.unassigned_parts),
        "batches_created": 0,
        "parts_created": 0,
        "parts_skipped_existing": 0,
        "parts_skipped_discrepancy": 0,
    }
    discrepancies: List[dict] = []
    payload_seen_serials: set[str] = set()

    async def ingest_parts(
        ingest_parts_list: List[schemas.InspectionIngestPartRecord],
        *,
        ingest_batch_name: Optional[str],
        target_batch_id: Optional[uuid.UUID],
    ) -> None:
        for ingest_part in ingest_parts_list:
            serial_number = ingest_part.serial_number.strip()
            if serial_number in payload_seen_serials:
                counters["parts_skipped_discrepancy"] += 1
                discrepancies.append(
                    {
                        "code": "duplicate_serial_in_payload",
                        "batch_name": ingest_batch_name or "unassigned",
                        "serial_number": serial_number,
                        "message": "Serial number appears more than once in ingest payload",
                    }
                )
                continue
            payload_seen_serials.add(serial_number)

            existing_part = parts_by_serial.get(serial_number)
            if existing_part:
                if target_batch_id and existing_part.batch_id and existing_part.batch_id != target_batch_id:
                    counters["parts_skipped_discrepancy"] += 1
                    discrepancies.append(
                        {
                            "code": "serial_already_assigned_to_other_batch",
                            "batch_name": ingest_batch_name or "unassigned",
                            "serial_number": serial_number,
                            "message": "Serial number already belongs to a different batch in this project",
                        }
                    )
                    continue
                counters["parts_skipped_existing"] += 1
                continue

            created_part = await crud.create_inspection_part(
                db=db,
                project_id=project_id,
                part=schemas.InspectionPartCreate(
                    batch_id=target_batch_id,
                    serial_number=serial_number,
                    display_name=ingest_part.display_name,
                    metadata=ingest_part.metadata_json,
                    review_state=ingest_part.review_state,
                ),
                created_by=current_user.email,
            )
            parts_by_serial[serial_number] = created_part
            counters["parts_created"] += 1

    for ingest_batch in payload.batches:
        target_batch = batches_by_name.get(ingest_batch.name)
        if target_batch is None:
            target_batch = await crud.create_inspection_batch(
                db=db,
                project_id=project_id,
                batch=schemas.InspectionBatchCreate(
                    name=ingest_batch.name,
                    description=ingest_batch.description,
                ),
                created_by=current_user.email,
            )
            batches_by_name[ingest_batch.name] = target_batch
            counters["batches_created"] += 1
        await ingest_parts(
            ingest_batch.parts,
            ingest_batch_name=ingest_batch.name,
            target_batch_id=target_batch.id,
        )

    await ingest_parts(
        payload.unassigned_parts,
        ingest_batch_name=None,
        target_batch_id=None,
    )

    return {
        "project_id": project_id,
        "counters": counters,
        "discrepancies": discrepancies,
    }


def _normalize_layout_model(candidate: object) -> dict:
    if not isinstance(candidate, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="layout_model must be an object")
    layout_node = candidate.get("layout")
    if not isinstance(layout_node, dict) or layout_node.get("type") not in {"row", "tabset"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="layout_model must include a valid layout root")
    return candidate


async def _resolve_project_type_interface_layout_default(
    db: AsyncSession,
    *,
    project_type: str,
) -> Optional[dict]:
    metadata_key = _project_type_interface_layout_metadata_key(project_type)
    stmt = (
        select(models.ProjectMetadata.value)
        .join(models.Project, models.Project.id == models.ProjectMetadata.project_id)
        .where(
            models.Project.project_type == project_type,
            models.ProjectMetadata.key == metadata_key,
        )
        .order_by(models.ProjectMetadata.updated_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    value = result.scalar_one_or_none()
    return value if isinstance(value, dict) else None


@router.post(
    "/projects/{project_id}/batches",
    response_model=schemas.InspectionBatch,
    status_code=status.HTTP_201_CREATED,
)
async def create_inspection_batch(
    project_id: uuid.UUID,
    batch: schemas.InspectionBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)

    try:
        return await crud.create_inspection_batch(
            db=db,
            project_id=project_id,
            batch=batch,
            created_by=current_user.email,
        )
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch name already exists in this project")


@router.get("/projects/{project_id}/batches", response_model=List[schemas.InspectionBatch])
async def list_inspection_batches(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    return await crud.list_inspection_batches(db=db, project_id=project_id)


@router.patch("/projects/{project_id}/batches/{batch_id}", response_model=schemas.InspectionBatch)
async def update_inspection_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    payload: schemas.InspectionBatchUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    try:
        updated = await crud.update_inspection_batch(
            db=db,
            project_id=project_id,
            batch_id=batch_id,
            patch=payload,
            updated_by=current_user.email,
        )
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch name already exists in this project")
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection batch not found")
    return updated


@router.post(
    "/projects/{project_id}/parts",
    response_model=schemas.InspectionPart,
    status_code=status.HTTP_201_CREATED,
)
async def create_inspection_part(
    project_id: uuid.UUID,
    part: schemas.InspectionPartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)

    if part.batch_id:
        batch = await crud.get_inspection_batch(db=db, batch_id=part.batch_id)
        if not batch or batch.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="batch_id does not belong to this project")

    try:
        created = await crud.create_inspection_part(
            db=db,
            project_id=project_id,
            part=part,
            created_by=current_user.email,
        )
        return _serialize_inspection_part(created)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Serial number already exists in this project")


@router.get("/projects/{project_id}/parts", response_model=List[schemas.InspectionPart])
async def list_inspection_parts(
    project_id: uuid.UUID,
    batch_id: Optional[uuid.UUID] = None,
    review_state: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
): 
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    parts = await crud.list_inspection_parts(
        db=db,
        project_id=project_id,
        batch_id=batch_id,
        review_state=review_state,
    )
    return [_serialize_inspection_part(part) for part in parts]


@router.patch("/projects/{project_id}/parts/{part_id}", response_model=schemas.InspectionPart)
async def update_inspection_part_review_state(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.InspectionPartUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    updated = await crud.update_inspection_part_review_state(
        db=db,
        project_id=project_id,
        part_id=part_id,
        review_state=payload.review_state,
        updated_by=current_user.email,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    return _serialize_inspection_part(updated)


@router.delete("/projects/{project_id}/parts/{part_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inspection_part(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    deleted = await crud.delete_inspection_part(
        db=db,
        project_id=project_id,
        part_id=part_id,
        deleted_by=current_user.email,
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    return None


@router.post(
    "/projects/{project_id}/parts/image-assignments",
    response_model=schemas.InspectionPartImageAssignmentResponse,
)
async def assign_image_to_part(
    project_id: uuid.UUID,
    payload: schemas.InspectionPartImageAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    target_part = None
    if payload.to_part_id:
        target_part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=payload.to_part_id)
        if not target_part:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target part not found")

    all_parts = await crud.list_inspection_parts(db=db, project_id=project_id)
    filename = payload.filename.strip()
    source_entry = None
    from_part_id = None

    for part in all_parts:
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        source_images = metadata.get("source_images")
        if not isinstance(source_images, list):
            continue
        retained = []
        for record in source_images:
            if isinstance(record, dict) and str(record.get("filename") or "").strip() == filename:
                source_entry = {
                    **record,
                    "filename": filename,
                    "image_id": record.get("image_id") or None,
                }
                from_part_id = part.id
                continue
            retained.append(record)
        if len(retained) != len(source_images):
            normalized = _rebuild_part_image_maps({**metadata, "source_images": retained})
            await crud.update_inspection_part_metadata(
                db=db,
                project_id=project_id,
                part_id=part.id,
                metadata_patch=normalized,
                updated_by=current_user.email,
            )

    if source_entry is None:
        image_result = await db.execute(
            select(models.DataInstance).where(
                models.DataInstance.project_id == project_id,
                models.DataInstance.filename == filename,
                models.DataInstance.deleted_at.is_(None),
            )
        )
        image = image_result.scalars().first()
        if not image:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
        image_metadata = image.metadata_json if isinstance(image.metadata_json, dict) else {}
        source_entry = {
            "filename": filename,
            "image_id": str(image.id),
            "side": str(image_metadata.get("side") or "").strip().lower(),
            "modality": str(image_metadata.get("modality") or "").strip().lower(),
            "overlay": bool(image_metadata.get("overlay")),
            "slice_axis": image_metadata.get("slice_axis"),
            "slice_index": image_metadata.get("slice_index"),
        }

    if target_part:
        target_metadata = target_part.metadata_json if isinstance(target_part.metadata_json, dict) else {}
        target_source_images = target_metadata.get("source_images")
        target_source_images = target_source_images if isinstance(target_source_images, list) else []
        target_source_images = [
            record for record in target_source_images
            if not (isinstance(record, dict) and str(record.get("filename") or "").strip() == filename)
        ]
        target_source_images.append(source_entry)
        normalized_target = _rebuild_part_image_maps({**target_metadata, "source_images": target_source_images})
        await crud.update_inspection_part_metadata(
            db=db,
            project_id=project_id,
            part_id=target_part.id,
            metadata_patch=normalized_target,
            updated_by=current_user.email,
        )

    return schemas.InspectionPartImageAssignmentResponse(
        project_id=project_id,
        filename=filename,
        from_part_id=from_part_id,
        to_part_id=payload.to_part_id,
    )


@router.post(
    "/projects/{project_id}/parts/batch-assignments",
    response_model=schemas.InspectionPartBatchAssignmentResponse,
)
async def assign_part_to_batch(
    project_id: uuid.UUID,
    payload: schemas.InspectionPartBatchAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    if payload.to_batch_id:
        batch = await crud.get_inspection_batch(db=db, batch_id=payload.to_batch_id)
        if not batch or batch.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="to_batch_id does not belong to this project")

    updated = await crud.update_inspection_part_batch_assignment(
        db=db,
        project_id=project_id,
        part_id=payload.part_id,
        to_batch_id=payload.to_batch_id,
        updated_by=current_user.email,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    return schemas.InspectionPartBatchAssignmentResponse(
        project_id=project_id,
        part_id=payload.part_id,
        to_batch_id=payload.to_batch_id,
    )


@router.patch("/projects/{project_id}/parts/{part_id}/manual-flag", response_model=schemas.InspectionPart)
async def update_inspection_part_manual_flag(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.InspectionPartManualFlagUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    updated = await crud.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={"manual_flagged": bool(payload.manual_flagged)},
        updated_by=current_user.email,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    return _serialize_inspection_part(updated)


@router.post(
    "/projects/{project_id}/parts/{part_id}/segmentation-runs",
    response_model=schemas.InspectionSegmentationInvokeResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def invoke_part_segmentation(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.InspectionSegmentationInvokeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)

    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    created_at = datetime.now(timezone.utc)
    run_id = uuid.uuid4()
    overlay_id = f"segmentation-{payload.axis}-{payload.slice_index}"
    run_entry = {
        "run_id": str(run_id),
        "axis": payload.axis,
        "slice_index": payload.slice_index,
        "status": "completed",
        "overlay_id": overlay_id,
        "created_at": created_at.isoformat(),
        "requested_by": current_user.email,
    }

    existing_runs = []
    if isinstance(part.metadata_json, dict):
        existing_runs = list(part.metadata_json.get("segmentation_runs") or [])
    updated_part = await crud.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={"segmentation_runs": [*existing_runs, run_entry]},
        updated_by=current_user.email,
    )
    if not updated_part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    return {
        "run_id": run_id,
        "part_id": part_id,
        "axis": payload.axis,
        "slice_index": payload.slice_index,
        "status": "completed",
        "overlay_id": overlay_id,
        "created_at": created_at,
    }


@router.post(
    "/projects/{project_id}/parts/{part_id}/slice-segmentation",
    response_model=schemas.InspectionSliceSegmentationResponse,
)
async def segment_inspection_slice(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.InspectionSliceSegmentationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    _require_toolbox()
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)

    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    if payload.method_id not in SLICE_SEGMENTATION_METHOD_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported slice segmentation method")

    image_bytes = _decode_slice_image_payload(payload.image_data_base64)
    workflow = _slice_segmentation_workflow(payload.method_id, payload.parameters)
    image_input = WorkflowImageInput(
        image_id=uuid.uuid4(),
        filename=payload.filename,
        content_type="image/png",
        data=image_bytes,
        metadata={
            "part_id": str(part_id),
            "axis": payload.axis,
            "slice_index": payload.slice_index,
        },
    )

    try:
        result = execute_image_workflow(workflow, [image_input])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Slice segmentation failed: {exc}") from exc

    regions = _regions_from_toolbox_result(result)
    selected_region = _select_clicked_region(regions, payload.click_x, payload.click_y)
    summary = {
        "workflow_name": result.workflow_name,
        "image_count": result.image_count,
        "region_count": len(regions),
        "click": {"x": payload.click_x, "y": payload.click_y},
    }
    for node_result in result.node_results:
        if node_result.method_id == payload.method_id and isinstance(node_result.summary, dict):
            summary.update({key: value for key, value in node_result.summary.items() if key not in {"measurements", "detections"}})

    return {
        "run_id": result.run_id,
        "part_id": part_id,
        "axis": payload.axis,
        "slice_index": payload.slice_index,
        "method_id": payload.method_id,
        "status": result.status,
        "cached": False,
        "regions": regions,
        "selected_region": selected_region,
        "summary": summary,
        "warnings": result.warnings,
    }


@router.post(
    "/projects/{project_id}/parts/{part_id}/measurement-runs",
    response_model=schemas.InspectionMeasurementInvokeResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def invoke_ai_measurements(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.InspectionMeasurementInvokeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)

    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    synthetic_level = 0
    if isinstance(part.metadata_json, dict):
        synthetic_level = int(part.metadata_json.get("synthetic_level") or 0)

    complexity_multiplier = max(1, synthetic_level)
    values = {
        "crack_length_mm": round((12.4 + len(payload.include_overlays) * 1.7) * complexity_multiplier, 2),
        "pore_area_mm2": round((2.1 + len(payload.measurement_profile) * 0.08) * complexity_multiplier, 2),
        "edge_offset_mm": round((0.35 + (complexity_multiplier * 0.11)), 2),
    }

    created_at = datetime.now(timezone.utc)
    run_id = uuid.uuid4()
    result_entry = {
        "run_id": str(run_id),
        "measurement_profile": payload.measurement_profile,
        "include_overlays": payload.include_overlays,
        "status": "completed",
        "units": "mm",
        "values": values,
        "created_at": created_at.isoformat(),
        "requested_by": current_user.email,
    }

    existing_runs = []
    if isinstance(part.metadata_json, dict):
        existing_runs = list(part.metadata_json.get("measurement_runs") or [])

    updated_part = await crud.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={"measurement_runs": [*existing_runs, result_entry]},
        updated_by=current_user.email,
    )
    if not updated_part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    return {
        "run_id": run_id,
        "part_id": part_id,
        "status": "completed",
        "measurement_profile": payload.measurement_profile,
        "units": "mm",
        "values": values,
        "created_at": created_at,
    }


@router.get(
    "/projects/{project_id}/parts/{part_id}/annotations",
    response_model=schemas.InspectionAnnotationListResponse,
)
async def list_part_annotations(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    include_hidden: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    annotations = _part_annotations(part)
    if not include_hidden:
        annotations = [annotation for annotation in annotations if not annotation.get("hidden", False)]
    return {"part_id": part_id, "annotations": annotations}


@router.post(
    "/projects/{project_id}/parts/{part_id}/annotations",
    response_model=schemas.InspectionAnnotation,
    status_code=status.HTTP_201_CREATED,
)
async def create_part_annotation(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    payload: schemas.InspectionAnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    now = datetime.now(timezone.utc)
    attribution_owner = ""
    if part.batch_id:
        batch = await crud.get_inspection_batch(db=db, batch_id=part.batch_id)
        attribution_owner = str(batch.owner or "").strip() if batch else ""
    if not attribution_owner:
        config_metadata = await crud.get_project_metadata_by_key(db=db, project_id=project_id, key=PROJECT_CONFIGURATION_KEY)
        config_value = config_metadata.value if config_metadata and isinstance(config_metadata.value, dict) else {}
        project_owner = config_value.get("project_owner") if isinstance(config_value.get("project_owner"), dict) else {}
        attribution_owner = str(project_owner.get("email") or project_owner.get("name") or "").strip()
        if not attribution_owner:
            current_config_user = config_value.get("current_user") if isinstance(config_value.get("current_user"), dict) else {}
            username = str(current_config_user.get("username") or "").strip()
            if username:
                sso_authenticated = bool(current_config_user.get("sso_authenticated"))
                attribution_owner = username if sso_authenticated else f"{username} (manual)"

    annotation_entry = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "created_at": now.isoformat(),
        "created_by": attribution_owner or current_user.email,
        "updated_at": now.isoformat(),
        "updated_by": current_user.email,
    }
    annotations = _part_annotations(part)
    annotations.append(annotation_entry)
    updated_part = await crud.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={ANNOTATIONS_METADATA_KEY: annotations},
        updated_by=current_user.email,
    )
    if not updated_part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    return annotation_entry


@router.patch(
    "/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
    response_model=schemas.InspectionAnnotation,
)
async def update_part_annotation(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    annotation_id: uuid.UUID,
    payload: schemas.InspectionAnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    existing_annotations = _part_annotations(part)
    update_payload = payload.model_dump(exclude_none=True)
    now = datetime.now(timezone.utc).isoformat()
    updated_annotation = None
    updated_annotations = []

    for annotation in existing_annotations:
        if annotation.get("id") == str(annotation_id):
            annotation = {
                **annotation,
                **update_payload,
                "updated_at": now,
                "updated_by": current_user.email,
            }
            updated_annotation = annotation
        updated_annotations.append(annotation)

    if not updated_annotation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")

    persisted = await crud.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={ANNOTATIONS_METADATA_KEY: updated_annotations},
        updated_by=current_user.email,
    )
    if not persisted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")
    return updated_annotation


@router.delete(
    "/projects/{project_id}/parts/{part_id}/annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_part_annotation(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    part = await crud.get_inspection_part(db=db, project_id=project_id, part_id=part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")

    existing_annotations = _part_annotations(part)
    updated_annotations = [
        annotation for annotation in existing_annotations
        if annotation.get("id") != str(annotation_id)
    ]
    if len(updated_annotations) == len(existing_annotations):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")

    persisted = await crud.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={ANNOTATIONS_METADATA_KEY: updated_annotations},
        updated_by=current_user.email,
    )
    if not persisted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inspection part not found")


@router.get(
    "/projects/{project_id}/workspace-state",
    response_model=schemas.InspectionWorkspaceStateResponse,
)
async def get_inspection_workspace_state(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    metadata_key = _workspace_state_metadata_key(current_user.email)
    metadata = await crud.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=metadata_key,
    )
    raw_state = metadata.value if metadata else {}
    safe_state = _normalize_workspace_state(raw_state)
    return {
        "project_id": project_id,
        "user_email": current_user.email,
        "state": safe_state,
        "updated_at": metadata.updated_at if metadata else None,
    }


@router.put(
    "/projects/{project_id}/workspace-state",
    response_model=schemas.InspectionWorkspaceStateResponse,
)
async def update_inspection_workspace_state(
    project_id: uuid.UUID,
    payload: schemas.InspectionWorkspaceStatePayload,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    metadata_key = _workspace_state_metadata_key(current_user.email)
    updated = await crud.create_or_update_project_metadata(
        db=db,
        metadata=schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=metadata_key,
            value=_normalize_workspace_state(payload.state),
        ),
        created_by=current_user.email,
    )
    safe_state = _normalize_workspace_state(updated.value)
    return {
        "project_id": project_id,
        "user_email": current_user.email,
        "state": safe_state,
        "updated_at": updated.updated_at,
    }


@router.get(
    "/projects/{project_id}/configuration",
)
async def get_project_configuration(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    project = await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    metadata = await crud.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=PROJECT_CONFIGURATION_KEY,
    )
    raw_config = metadata.value if metadata and isinstance(metadata.value, dict) else None
    resolved_config = _resolve_project_configuration(raw_config, project.project_type)
    interface_layout = resolved_config.get("interface_layout")
    has_project_default_layout = (
        isinstance(interface_layout, dict)
        and isinstance(interface_layout.get("default_model"), dict)
    )
    if not has_project_default_layout:
        project_type_default = await _resolve_project_type_interface_layout_default(
            db,
            project_type=project.project_type or "PT1",
        )
        if project_type_default:
            resolved_config["interface_layout"] = {
                "default_model": project_type_default,
            }
    return {
        "project_id": project_id,
        "config": resolved_config,
        "updated_at": metadata.updated_at if metadata else None,
    }


@router.put(
    "/projects/{project_id}/configuration",
    response_model=schemas.InspectionProjectConfigurationResponse,
)
async def update_project_configuration(
    project_id: uuid.UUID,
    payload: schemas.InspectionProjectConfigurationPayload,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    project = await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    updated = await crud.create_or_update_project_metadata(
        db=db,
        metadata=schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=PROJECT_CONFIGURATION_KEY,
            value=payload.config.model_dump(exclude_unset=True),
        ),
        created_by=current_user.email,
    )
    persisted = _resolve_project_configuration(updated.value, project.project_type)
    return {
        "project_id": project_id,
        "config": persisted,
        "updated_at": updated.updated_at,
    }


@router.post(
    "/projects/{project_id}/configuration/interface-layout/default",
    response_model=schemas.InspectionProjectConfigurationResponse,
)
async def save_project_default_interface_layout(
    project_id: uuid.UUID,
    payload: schemas.InspectionInterfaceLayoutDefaultPayload,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    project = await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    metadata = await crud.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=PROJECT_CONFIGURATION_KEY,
    )
    raw_config = metadata.value if metadata and isinstance(metadata.value, dict) else None
    config = _resolve_project_configuration(raw_config, project.project_type)
    config["interface_layout"] = {
        "default_model": _normalize_layout_model(payload.layout_model),
    }
    updated = await crud.create_or_update_project_metadata(
        db=db,
        metadata=schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=PROJECT_CONFIGURATION_KEY,
            value=config,
        ),
        created_by=current_user.email,
    )
    persisted = _resolve_project_configuration(updated.value, project.project_type)
    return {
        "project_id": project_id,
        "config": persisted,
        "updated_at": updated.updated_at,
    }


@router.post(
    "/projects/{project_id}/configuration/interface-layout/project-type-default",
    response_model=schemas.InspectionProjectConfigurationResponse,
)
async def save_project_type_default_interface_layout(
    project_id: uuid.UUID,
    payload: schemas.InspectionInterfaceLayoutDefaultPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    project = await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    raw_groups_header = request.headers.get("X-User-Groups", "[]")
    try:
        parsed_groups = json.loads(raw_groups_header) if isinstance(raw_groups_header, str) else []
    except json.JSONDecodeError:
        parsed_groups = []
    normalized_groups = {str(group).strip().lower() for group in parsed_groups if isinstance(group, str)}
    if not ({"admin", "admins"} & normalized_groups):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required to save project type defaults")
    normalized_layout = _normalize_layout_model(payload.layout_model)
    metadata_key = _project_type_interface_layout_metadata_key(project.project_type or "PT1")
    await crud.create_or_update_project_metadata(
        db=db,
        metadata=schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=metadata_key,
            value=normalized_layout,
        ),
        created_by=current_user.email,
    )
    return await get_project_configuration(project_id=project_id, db=db, current_user=current_user)


@router.post(
    "/projects/{project_id}/configuration/clone",
)
async def clone_project_configuration(
    project_id: uuid.UUID,
    payload: schemas.InspectionProjectConfigurationCloneRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    target_project = await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    if payload.source_project_id == project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_project_id must be different from project_id",
        )
    source_project = await _get_project_with_access_check(
        project_id=payload.source_project_id,
        db=db,
        current_user=current_user,
    )
    if source_project.project_type != target_project.project_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "source_project_id must belong to a project with the same project_type "
                "as the target project"
            ),
        )

    source_metadata = await crud.get_project_metadata_by_key(
        db=db,
        project_id=payload.source_project_id,
        key=PROJECT_CONFIGURATION_KEY,
    )
    source_config = _resolve_project_configuration(
        source_metadata.value if source_metadata and isinstance(source_metadata.value, dict) else None,
        source_project.project_type,
    )
    updated = await crud.create_or_update_project_metadata(
        db=db,
        metadata=schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=PROJECT_CONFIGURATION_KEY,
            value=source_config,
        ),
        created_by=current_user.email,
    )
    return {
        "project_id": project_id,
        "source_project_id": payload.source_project_id,
        "config": _strip_optional_default_sections(source_config),
        "updated_at": updated.updated_at,
    }


@router.post(
    "/projects/{project_id}/load-test-data",
)
async def load_project_test_data(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    project = await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    project_type = (project.project_type or "PT1").upper()
    uploaded_records: List[dict] = []
    images_created = 0

    if project_type == "PT3":
        if not PT3_TEST_STACK_ROOT.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PT3 test stack not found")
        volume_info = load_slice_stack(PT3_TEST_STACK_ROOT)
        for index, file_path in enumerate(sorted(PT3_TEST_STACK_ROOT.glob("*.png"))):
            metadata = {
                "source": "vista-test-data",
                "project_type": "PT3",
                "volume_stack_id": "PT3_SYNTH_MPR_001",
                "slice_index": index,
                "slice_axis": "Z",
                "axis_labels": ["XY", "XZ", "YZ"],
            }
            image, created = await _create_test_image_if_missing(
                project_id=project_id,
                file_path=file_path,
                metadata=metadata,
                db=db,
                current_user=current_user,
                allow_metadata_only=True,
            )
            images_created += 1 if created else 0
            uploaded_records.append({"filename": file_path.name, "image_id": str(image.id), "metadata": metadata})

        ingest_payload = schemas.InspectionBulkIngestPayload(
            batches=[
                schemas.InspectionIngestBatchRecord(
                    name="PT3_SYNTH_MPR_BATCH01",
                    description="Synthetic PT3 3D stack test data",
                    parts=[
                        schemas.InspectionIngestPartRecord(
                            serial_number="SN3D0001",
                            display_name="PT3 synthetic MPR stack",
                            metadata={
                                "source": "vista-test-data",
                                "volume_stack_id": "PT3_SYNTH_MPR_001",
                                "volume_shape": {
                                    "axial": volume_info.shape[0],
                                    "coronal": volume_info.shape[1],
                                    "sagittal": volume_info.shape[2],
                                },
                                "mpr": {
                                    "volume_shape": {
                                        "axial": volume_info.shape[0],
                                        "coronal": volume_info.shape[1],
                                        "sagittal": volume_info.shape[2],
                                    },
                                    "axis_labels": ["XY", "XZ", "YZ"],
                                },
                                "source_images": uploaded_records,
                            },
                        )
                    ],
                )
            ]
        )
    else:
        fixture_paths = sorted(
            path
            for path in TEST_DATA_ROOT.iterdir()
            if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
        )
        if not fixture_paths:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PT1/PT2 test data not found")
        for file_path in fixture_paths:
            metadata = _metadata_from_hierarchy_filename(file_path)
            if metadata is None:
                continue
            metadata = {**metadata, "project_type": project_type}
            image, created = await _create_test_image_if_missing(
                project_id=project_id,
                file_path=file_path,
                metadata=metadata,
                db=db,
                current_user=current_user,
            )
            images_created += 1 if created else 0
            uploaded_records.append({"filename": file_path.name, "image_id": str(image.id), "metadata": metadata})
        ingest_payload = _build_hierarchy_ingest_records(uploaded_records)

    ingest_result = await _bulk_ingest_project_parts(
        project_id=project_id,
        payload=ingest_payload,
        db=db,
        current_user=current_user,
    )
    return {
        "project_id": project_id,
        "project_type": project_type,
        "images_received": len(uploaded_records),
        "images_created": images_created,
        "ingest": ingest_result,
    }


@router.post(
    "/projects/{project_id}/ingest",
    response_model=schemas.InspectionBulkIngestResponse,
)
async def bulk_ingest_project_parts(
    project_id: uuid.UUID,
    payload: schemas.InspectionBulkIngestPayload,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await _get_project_with_access_check(project_id=project_id, db=db, current_user=current_user)
    return await _bulk_ingest_project_parts(
        project_id=project_id,
        payload=payload,
        db=db,
        current_user=current_user,
    )
