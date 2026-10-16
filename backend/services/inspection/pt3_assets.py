"""PT3 splat asset metadata helpers."""

from __future__ import annotations

import contextlib
import re
import shutil
from pathlib import Path
from typing import Any

from services.inspection import pt3_cache


def pt3_provider_camera_view_binding(
    *,
    source_image_ids: list[str],
    camera_image_ids: set[str],
) -> str:
    """Classify provider cameras without letting their IDs select voxel inputs."""
    expected_image_ids = set(source_image_ids)
    if camera_image_ids == expected_image_ids:
        return "server_inferred_source_views"
    return "generated_from_voxel_volume"


def remove_direct_child_cache_path(path: Path, *, parent: Path) -> None:
    """Remove only one resolved job directory immediately below a known root."""
    safe_parent = parent.resolve()
    safe_path = path.resolve()
    if safe_path.parent != safe_parent or safe_path == safe_parent:
        return
    if safe_path.is_dir():
        shutil.rmtree(safe_path, ignore_errors=True)


def cleanup_pt3_simplified_splat_job_input(
    *,
    project_id,
    part_id,
    job_id: str,
) -> None:
    """Best-effort cleanup for a simplified splat job input directory."""
    try:
        input_parent = pt3_cache.pt3_cache_directory(
            "pt3_volume_stacks", project_id, part_id
        )
        input_path = input_parent / pt3_cache.pt3_cache_component(job_id)
        remove_direct_child_cache_path(input_path, parent=input_parent)
    except (OSError, RuntimeError):
        return


def prune_stale_pt3_simplified_splat_output(
    asset_path: Path | None,
    *,
    project_id,
    part_id,
    latest_asset: object,
) -> None:
    """Remove a stale output only when no active/latest job can reference it."""
    if asset_path is None:
        return
    current_asset = latest_asset if isinstance(latest_asset, dict) else {}
    if current_asset.get("status") == "pending":
        return
    try:
        expected_root = pt3_cache.pt3_cache_directory(
            "pt3_splat_assets", project_id, part_id
        )
        candidate = asset_path.resolve()
        referenced_path_text = str(current_asset.get("asset_path") or "").strip()
        referenced_path = (
            Path(referenced_path_text).expanduser().resolve()
            if referenced_path_text
            else None
        )
    except (OSError, RuntimeError):
        return
    if (
        candidate.parent == expected_root
        and candidate.suffix.lower() in pt3_cache.PT3_SIMPLIFIED_SPLAT_EXTENSIONS
        and candidate != referenced_path
        and candidate.is_file()
    ):
        with contextlib.suppress(OSError):
            candidate.unlink(missing_ok=True)


def prune_pt3_simplified_splat_outputs(
    *,
    project_id,
    part_id,
    keep_asset_path: Path,
) -> None:
    """Prune prior content keys after publishing the sole current part asset."""
    try:
        output_root = pt3_cache.pt3_cache_directory(
            "pt3_splat_assets", project_id, part_id
        )
        keep_path = keep_asset_path.resolve()
    except (OSError, RuntimeError):
        return
    if keep_path.parent != output_root or not output_root.is_dir():
        return
    for candidate in output_root.iterdir():
        try:
            resolved_candidate = candidate.resolve()
            if (
                resolved_candidate.parent == output_root
                and resolved_candidate != keep_path
                and resolved_candidate.suffix.lower()
                in pt3_cache.PT3_SIMPLIFIED_SPLAT_EXTENSIONS
                and resolved_candidate.is_file()
            ):
                resolved_candidate.unlink(missing_ok=True)
        except (OSError, RuntimeError):
            continue


def cleanup_pt3_real_splat_job_cache(
    *,
    project_id,
    part_id,
    job_id: str,
    remove_input: bool = True,
    remove_output: bool = True,
) -> None:
    """Best-effort cleanup for Real 3DGS job cache directories."""
    cache_targets = (
        (remove_input, "pt3_volume_stacks"),
        (remove_output, "pt3_real_splat_assets"),
    )
    for should_remove, namespace in cache_targets:
        if not should_remove:
            continue
        try:
            parent = pt3_cache.pt3_cache_directory(namespace, project_id, part_id)
            remove_direct_child_cache_path(
                parent / pt3_cache.pt3_cache_component(job_id),
                parent=parent,
            )
        except (OSError, RuntimeError):
            continue


def prune_pt3_real_splat_job_cache(
    *,
    project_id,
    part_id,
    keep_output_job_id: str | None,
) -> None:
    """Prune superseded outputs while retaining the published asset."""
    output_root = pt3_cache.pt3_cache_directory(
        "pt3_real_splat_assets", project_id, part_id
    )
    if output_root.is_dir():
        for candidate in output_root.iterdir():
            if candidate.is_dir() and candidate.name != keep_output_job_id:
                remove_direct_child_cache_path(candidate, parent=output_root)


def contained_pt3_real_splat_asset_path(
    asset: object,
    *,
    project_id,
    part_id,
    cache_key: str | None = None,
) -> Path | None:
    """Return a readable Real asset only from this part's server cache."""
    if not isinstance(asset, dict):
        return None
    declared_cache_key = str(asset.get("cache_key") or "").strip()
    if (
        not declared_cache_key
        or len(declared_cache_key) > 255
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", declared_cache_key) is None
        or (cache_key is not None and declared_cache_key != cache_key)
    ):
        return None
    raw_path = str(asset.get("asset_path") or "").strip()
    if not raw_path:
        return None
    job_id = str(asset.get("job_id") or "").strip()
    if job_id and (
        len(job_id) > 255 or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", job_id) is None
    ):
        return None
    try:
        expected_root = pt3_cache.pt3_cache_directory(
            "pt3_real_splat_assets",
            project_id,
            part_id,
        )
        asset_path = Path(raw_path).expanduser().resolve()
        expected_job_root = (
            pt3_cache.pt3_cache_directory(
                "pt3_real_splat_assets",
                project_id,
                part_id,
                job_id,
            )
            if job_id
            else None
        )
    except (OSError, RuntimeError):
        return None
    if (
        expected_root not in asset_path.parents
        or (
            expected_job_root is not None
            and expected_job_root not in asset_path.parents
        )
        or asset_path.suffix.lower() != ".json"
        or not asset_path.is_file()
    ):
        return None
    return asset_path


def usable_previous_pt3_real_splat_asset(
    asset: object,
    *,
    project_id,
    part_id,
) -> dict | None:
    """Return a contained, still-readable published asset for recompute fallback."""
    if not isinstance(asset, dict):
        return None
    candidate = asset
    if candidate.get("status") != "ready":
        nested = candidate.get("previous_ready_asset")
        candidate = nested if isinstance(nested, dict) else {}
    if (
        candidate.get("status") != "ready"
        or not candidate.get("cache_key")
        or not candidate.get("asset_path")
    ):
        return None
    asset_path = contained_pt3_real_splat_asset_path(
        candidate,
        project_id=project_id,
        part_id=part_id,
    )
    if asset_path is None:
        return None
    retained_asset = {
        key: value for key, value in candidate.items() if key != "previous_ready_asset"
    }
    retained_asset["asset_path"] = str(asset_path)
    retained_asset["asset_url"] = (
        f"/api/projects/{project_id}/parts/{part_id}/"
        f"real-gaussian-splat-assets/{candidate.get('cache_key')}"
    )
    return retained_asset


def contained_pt3_simplified_splat_asset_path(
    asset: object,
    *,
    project_id,
    part_id,
    cache_key: str | None = None,
) -> Path | None:
    """Return a readable Simplified asset only when its metadata is cache-contained."""
    if not isinstance(asset, dict):
        return None
    declared_cache_key = str(asset.get("cache_key") or "").strip()
    if (
        not declared_cache_key
        or len(declared_cache_key) > 255
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", declared_cache_key) is None
        or (cache_key is not None and declared_cache_key != cache_key)
    ):
        return None
    raw_path = str(asset.get("asset_path") or "").strip()
    if not raw_path:
        return None
    try:
        expected_root = pt3_cache.pt3_cache_directory(
            "pt3_splat_assets", project_id, part_id
        )
        asset_path = Path(raw_path).expanduser().resolve()
    except (OSError, RuntimeError):
        return None
    if (
        asset_path.parent != expected_root
        or asset_path.suffix.lower() not in pt3_cache.PT3_SIMPLIFIED_SPLAT_EXTENSIONS
        or asset_path.stem != declared_cache_key
        or not asset_path.is_file()
    ):
        return None
    return asset_path


def pt3_real_splat_asset_for_cache(asset: object, cache_key: str) -> dict:
    """Resolve the current asset, or the last good asset during recompute."""
    if not isinstance(asset, dict):
        return {}
    if (
        str(asset.get("status") or "").strip().lower() in {"", "ready"}
        and asset.get("cache_key") == cache_key
    ):
        return asset
    previous = asset.get("previous_ready_asset")
    if (
        asset.get("status") == "pending"
        and isinstance(previous, dict)
        and str(previous.get("status") or "").strip().lower() in {"", "ready"}
        and previous.get("cache_key") == cache_key
    ):
        return previous
    return {}


def public_pt3_real_splat_error(exc: Exception) -> str:
    """Redact server-local paths from Real 3DGS provider/cache errors."""
    message = str(exc).strip() or exc.__class__.__name__
    replacements = [(str(pt3_cache.REPO_ROOT.resolve()), "<repository>")]
    with contextlib.suppress(pt3_cache.PT3CacheUnavailableError, OSError, RuntimeError):
        replacements.insert(0, (str(pt3_cache.pt3_cache_root().resolve()), "<cache>"))
    for private_path, label in replacements:
        message = message.replace(private_path, label)

    message = re.sub(
        r"(?P<quote>['\"])(?:/|[A-Za-z]:[\\/]|\\\\)[^'\"]+(?P=quote)",
        lambda match: f"{match.group('quote')}<path>{match.group('quote')}",
        message,
    )
    message = re.sub(
        r"(^|[\s(=\"'])(?:/[^\s'\"<>]+|[A-Za-z]:[\\/][^\s'\"<>]+|\\\\[^\s'\"<>]+)",
        lambda match: f"{match.group(1)}<path>",
        message,
    )
    return message[:1000]


def public_pt3_simplified_splat_asset(asset: object) -> dict:
    """Strip server filesystem locations from Simplified asset responses."""
    if not isinstance(asset, dict):
        return {}
    public_asset = {
        key: value
        for key, value in asset.items()
        if key not in {"asset_path", "source_files"}
    }
    conversion_parameters = public_asset.get("conversion_parameters")
    if isinstance(conversion_parameters, dict):
        public_parameters = dict(conversion_parameters)
        public_parameters.pop("source_path", None)
        public_asset["conversion_parameters"] = public_parameters
    return public_asset


def pt3_voxel_geometry(volume_info: Any, metadata: dict) -> dict:
    """Build Real 3DGS voxel geometry metadata from loaded volume information."""
    declared = (
        metadata.get("pt3_volume_geometry")
        if isinstance(metadata.get("pt3_volume_geometry"), dict)
        else {}
    )
    spacing = (
        declared.get("spacing")
        or metadata.get("spacing")
        or metadata.get("voxel_spacing")
        or [1.0, 1.0, 1.0]
    )
    origin = declared.get("origin") or metadata.get("origin") or [0.0, 0.0, 0.0]
    direction = (
        declared.get("direction")
        or metadata.get("direction")
        or [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    )
    scalar_range = (
        declared.get("scalar_range")
        or metadata.get("scalar_range")
        or metadata.get("scalarRange")
    )
    return {
        "format": volume_info.format,
        "shape_zyx": list(volume_info.shape),
        "dtype": volume_info.dtype,
        "channel_count": volume_info.channel_count,
        "color_mode": volume_info.color_mode,
        "spacing_xyz": list(spacing),
        "origin_xyz": list(origin),
        "direction": list(direction),
        "scalar_range": list(scalar_range)
        if isinstance(scalar_range, (list, tuple))
        else None,
    }
