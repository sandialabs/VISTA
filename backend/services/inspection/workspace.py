"""Workspace and project-configuration helpers for inspection workbench."""

from __future__ import annotations

from sqlalchemy import select

from core import models
from core.project_types import DEFAULT_PROJECT_TYPE, normalize_project_type
from repositories import project_metadata as project_metadata_repository
from schemas import inspection_workspace as inspection_workspace_schemas
from schemas import project_metadata as project_metadata_schemas

PROJECT_CONFIGURATION_KEY = "inspection_workbench.project_configuration"
WORKSPACE_STATE_KEY_PREFIX = "inspection_workbench.workspace_state"
PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX = (
    "inspection_workbench.project_type_interface_layout_default"
)
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


def normalize_panel_dimension(
    value: object, *, fallback: int, minimum: int, maximum: int
) -> int:
    """Coerce a panel dimension to an int clamped between minimum and maximum."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def normalize_workspace_state(raw_state: object) -> dict:
    """Normalize a raw workspace state payload into a safe, defaulted shape."""
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
            "width_px": normalize_panel_dimension(
                candidate.get("width_px"),
                fallback=defaults["width_px"],
                minimum=220,
                maximum=1200,
            ),
            "height_px": normalize_panel_dimension(
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
    viewport_candidate = (
        viewport_transform if isinstance(viewport_transform, dict) else {}
    )
    default_viewport = WORKSPACE_INSPECTOR_DEFAULTS["viewport_transform"]
    normalized_viewport_transform = {
        "zoom": max(
            0.5,
            min(
                4.0,
                float(viewport_candidate.get("zoom", default_viewport["zoom"]))
                if isinstance(
                    viewport_candidate.get("zoom", default_viewport["zoom"]),
                    (int, float),
                )
                else float(default_viewport["zoom"]),
            ),
        ),
        "panX": normalize_panel_dimension(
            viewport_candidate.get("panX"),
            fallback=default_viewport["panX"],
            minimum=-200,
            maximum=200,
        ),
        "panY": normalize_panel_dimension(
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
            normalized_measurements.append(
                {
                    "id": measurement_id,
                    "label": label,
                    "value": value,
                }
            )
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


def normalize_project_type_name(project_type: str | None) -> str:
    """Return the normalized project type name."""
    return normalize_project_type(project_type)


def default_defect_types(project_type: str | None) -> list[dict]:
    """Return the default defect types for a project type."""
    project_type_suffix = normalize_project_type_name(project_type)
    return [
        {
            "name": f"DefectType{index + 1}_{project_type_suffix}",
            "color": color,
            "definition": "",
        }
        for index, color in enumerate(DEFAULT_DEFECT_TYPE_COLORS)
    ]


def default_project_configuration(
    project_type: str | None = DEFAULT_PROJECT_TYPE,
) -> dict:
    """Return the default inspection project configuration for a project type."""
    project_type_name = normalize_project_type_name(project_type)
    config = {
        "image_modalities": [
            {
                "id": "visual",
                "label": "Visual",
                "calibration_required": False,
                "example_image_uploaded": False,
            }
        ],
        "part_views": [
            {
                "id": "front",
                "label": "Front",
                "required_modalities": ["visual"],
                "source": "manual",
            },
            {
                "id": "back",
                "label": "Back",
                "required_modalities": ["visual"],
                "source": "manual",
            },
        ],
        "defect_types": default_defect_types(project_type_name),
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
            "inspection_tile_max_columns": 8,
            "pt3_3d_guides": {
                "crosshair_transparency_percent": 50,
                "crosshair_line_width_px": 1.25,
                "plane_outline_transparency_percent": 0,
                "plane_outline_line_width_px": 1.25,
            },
        },
        "phase_settings": {
            "manual_phase_selection_enabled": False,
            "manual_phase": "data_ingestion",
        },
        "metadata_parsers": {
            "nsipro": {
                "parser_id": "default",
            },
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
    }
    if project_type_name != "PT1":
        config["file_naming_scheme"] = {
            "use_filename_convention": True,
            "hierarchy_levels": [
                {
                    "id": "drawing_number",
                    "label": "Drawing Number",
                    "abbreviation": "D",
                },
                {"id": "part_number", "label": "Part Number", "abbreviation": "P"},
                {"id": "lot_number", "label": "Lot Number", "abbreviation": "L"},
                {"id": "serial_number", "label": "Serial Number", "abbreviation": "S"},
                {"id": "revision", "label": "Revision", "abbreviation": "R"},
            ],
            "image_descriptors": [
                {"id": "view", "label": "View", "abbreviation": "V"},
                {"id": "modality", "label": "Modality", "abbreviation": "M"},
            ],
        }
    return config


def prune_config_to_source_shape(
    *, persisted_config: dict, source_config: dict
) -> dict:
    """Trim optional top-level config keys that were absent in source payloads."""
    if not isinstance(persisted_config, dict):
        return {}
    if not isinstance(source_config, dict):
        return persisted_config
    pruned = dict(persisted_config)
    for optional_key in (
        "phase_settings",
        "metadata_parsers",
        "project_owner",
        "current_user",
        "interface_layout",
        "calibration",
    ):
        if optional_key not in source_config:
            pruned.pop(optional_key, None)
    return pruned


def configuration_for_project_type(config: dict, project_type: str | None) -> dict:
    """Return config with keys not applicable to the project type removed."""
    resolved = dict(config) if isinstance(config, dict) else {}
    if normalize_project_type_name(project_type) == "PT1":
        resolved.pop("file_naming_scheme", None)
    return resolved


def dump_project_configuration_payload(
    config: inspection_workspace_schemas.InspectionProjectConfiguration,
) -> dict:
    """Dump an inspection project configuration to a JSON-safe dict."""
    dumped = config.model_dump(mode="json", exclude_unset=True)
    metadata_parsers = dumped.get("metadata_parsers")
    nsipro_dump = (
        metadata_parsers.get("nsipro") if isinstance(metadata_parsers, dict) else None
    )
    nsipro_config = getattr(getattr(config, "metadata_parsers", None), "nsipro", None)
    fields_set = getattr(nsipro_config, "model_fields_set", set())
    if isinstance(nsipro_dump, dict):
        for optional_key, default_value in (
            ("parser_version", None),
            ("parser_hash", None),
            ("strict_version_match", False),
        ):
            if (
                optional_key not in fields_set
                and nsipro_dump.get(optional_key) == default_value
            ):
                nsipro_dump.pop(optional_key, None)
    return dumped


def strip_optional_default_sections(config: dict) -> dict:
    """Remove config sections that still match their default values."""
    if not isinstance(config, dict):
        return {}
    pruned = dict(config)
    if pruned.get("phase_settings") == {
        "manual_phase_selection_enabled": False,
        "manual_phase": "data_ingestion",
    }:
        pruned.pop("phase_settings", None)
    if pruned.get("metadata_parsers") == {"nsipro": {"parser_id": "default"}}:
        pruned.pop("metadata_parsers", None)
    if pruned.get("project_owner") == {"name": "", "email": ""}:
        pruned.pop("project_owner", None)
    if pruned.get("current_user") == {"username": "", "sso_authenticated": False}:
        pruned.pop("current_user", None)
    if pruned.get("interface_layout") == {"default_model": None}:
        pruned.pop("interface_layout", None)
    return pruned


def project_type_interface_layout_metadata_key(project_type: str) -> str:
    """Return the project-metadata key for a project type's interface-layout default."""
    return f"{PROJECT_TYPE_INTERFACE_LAYOUT_KEY_PREFIX}:{project_type}"


def normalize_layout_model(candidate: object) -> dict:
    """Validate and return a layout model, raising if its shape is invalid."""
    if not isinstance(candidate, dict):
        raise ValueError("layout_model must be an object")
    layout_node = candidate.get("layout")
    if not isinstance(layout_node, dict) or layout_node.get("type") not in {
        "row",
        "tabset",
    }:
        raise ValueError("layout_model must include a valid layout root")
    return candidate


async def get_workspace_state(*, db, project_id, user_email: str) -> dict:
    """Return normalized per-user inspection workspace state."""
    metadata_key = f"{WORKSPACE_STATE_KEY_PREFIX}:{user_email.strip().lower()}"
    metadata = await project_metadata_repository.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=metadata_key,
    )
    raw_state = metadata.value if metadata else {}
    return {
        "project_id": project_id,
        "user_email": user_email,
        "state": normalize_workspace_state(raw_state),
        "updated_at": metadata.updated_at if metadata else None,
    }


async def update_workspace_state(*, db, project_id, user_email: str, state: object):
    """Persist and return normalized per-user inspection workspace state."""
    metadata_key = f"{WORKSPACE_STATE_KEY_PREFIX}:{user_email.strip().lower()}"
    updated = await project_metadata_repository.create_or_update_project_metadata(
        db=db,
        metadata=project_metadata_schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=metadata_key,
            value=normalize_workspace_state(state),
        ),
        created_by=user_email,
    )
    return {
        "project_id": project_id,
        "user_email": user_email,
        "state": normalize_workspace_state(updated.value),
        "updated_at": updated.updated_at,
    }


async def resolve_project_type_interface_layout_default(
    *, db, project_type: str
) -> dict | None:
    """Return the most recent project-type interface-layout default."""
    normalized_project_type = normalize_project_type_name(project_type)
    metadata_key = project_type_interface_layout_metadata_key(normalized_project_type)
    stmt = (
        select(models.ProjectMetadata.value)
        .join(models.Project, models.Project.id == models.ProjectMetadata.project_id)
        .where(
            models.Project.project_type == normalized_project_type,
            models.ProjectMetadata.key == metadata_key,
        )
        .order_by(models.ProjectMetadata.updated_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    value = result.scalar_one_or_none()
    return value if isinstance(value, dict) else None


async def get_project_configuration(*, db, project_id, project) -> dict:
    """Return resolved inspection project configuration."""
    metadata = await project_metadata_repository.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=PROJECT_CONFIGURATION_KEY,
    )
    default_config = default_project_configuration(project.project_type)
    raw_config = (
        metadata.value
        if metadata and isinstance(metadata.value, dict)
        else default_config
    )
    resolved_config = configuration_for_project_type(raw_config, project.project_type)
    interface_layout = resolved_config.get("interface_layout")
    has_project_default_layout = isinstance(interface_layout, dict) and isinstance(
        interface_layout.get("default_model"), dict
    )
    if not has_project_default_layout:
        project_type_default = await resolve_project_type_interface_layout_default(
            db=db,
            project_type=project.project_type or "PT1",
        )
        if project_type_default:
            resolved_config["interface_layout"] = {
                "default_model": project_type_default
            }
    return {
        "project_id": project_id,
        "config": resolved_config,
        "updated_at": metadata.updated_at if metadata else None,
    }


async def update_project_configuration(
    *, db, project_id, project, config, user_email: str
):
    """Persist and return resolved inspection project configuration."""
    updated = await project_metadata_repository.create_or_update_project_metadata(
        db=db,
        metadata=project_metadata_schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=PROJECT_CONFIGURATION_KEY,
            value=configuration_for_project_type(
                dump_project_configuration_payload(config),
                project.project_type,
            ),
        ),
        created_by=user_email,
    )
    persisted = (
        configuration_for_project_type(updated.value, project.project_type)
        if isinstance(updated.value, dict)
        else default_project_configuration(project.project_type)
    )
    return {
        "project_id": project_id,
        "config": persisted,
        "updated_at": updated.updated_at,
    }


async def save_project_default_interface_layout(
    *, db, project_id, project, layout_model: object, user_email: str
) -> dict:
    """Persist a project-specific interface-layout default."""
    metadata = await project_metadata_repository.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=PROJECT_CONFIGURATION_KEY,
    )
    default_config = default_project_configuration(project.project_type)
    raw_config = (
        metadata.value
        if metadata and isinstance(metadata.value, dict)
        else default_config
    )
    config = {**default_config, **raw_config}
    config["interface_layout"] = {
        "default_model": normalize_layout_model(layout_model),
    }
    updated = await project_metadata_repository.create_or_update_project_metadata(
        db=db,
        metadata=project_metadata_schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=PROJECT_CONFIGURATION_KEY,
            value=configuration_for_project_type(config, project.project_type),
        ),
        created_by=user_email,
    )
    persisted = (
        configuration_for_project_type(updated.value, project.project_type)
        if isinstance(updated.value, dict)
        else default_project_configuration(project.project_type)
    )
    return {
        "project_id": project_id,
        "config": persisted,
        "updated_at": updated.updated_at,
    }


async def save_project_type_default_interface_layout(
    *, db, project_id, project, layout_model: object, user_email: str
) -> None:
    """Persist a project-type interface-layout default."""
    metadata_key = project_type_interface_layout_metadata_key(
        project.project_type or "PT1"
    )
    await project_metadata_repository.create_or_update_project_metadata(
        db=db,
        metadata=project_metadata_schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=metadata_key,
            value=normalize_layout_model(layout_model),
        ),
        created_by=user_email,
    )


async def clone_project_configuration(
    *,
    db,
    project_id,
    target_project,
    source_project,
    source_project_id,
    user_email: str,
) -> dict:
    """Clone inspection configuration from a source project to a target project."""
    source_metadata = await project_metadata_repository.get_project_metadata_by_key(
        db=db,
        project_id=source_project_id,
        key=PROJECT_CONFIGURATION_KEY,
    )
    source_config = (
        source_metadata.value
        if source_metadata and isinstance(source_metadata.value, dict)
        else default_project_configuration(source_project.project_type)
    )
    source_config = configuration_for_project_type(
        source_config,
        target_project.project_type,
    )
    updated = await project_metadata_repository.create_or_update_project_metadata(
        db=db,
        metadata=project_metadata_schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=PROJECT_CONFIGURATION_KEY,
            value=source_config,
        ),
        created_by=user_email,
    )
    return {
        "project_id": project_id,
        "source_project_id": source_project_id,
        "config": strip_optional_default_sections(source_config),
        "updated_at": updated.updated_at,
    }
