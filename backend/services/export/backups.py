"""Project and dashboard backup archive helpers."""

from __future__ import annotations

import json
import zipfile
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from services.errors import ValidationFailedError
from services.export import bundles as export_bundle_service
from services.export import project_backups as export_project_backup_service
from services.export import storage as export_storage_service
from services.inspection.workspace import PROJECT_CONFIGURATION_KEY
from utils.streaming_zip import StreamingZipEntry

ProjectLister = Callable[..., Awaitable[list]]


def manifest_from_zip(archive: zipfile.ZipFile) -> dict:
    """Load and validate a VISTA backup manifest from a ZIP archive."""
    if "manifest.json" not in archive.namelist():
        raise ValidationFailedError("Backup is missing manifest.json")
    try:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    except Exception as exc:
        raise ValidationFailedError("Backup manifest is not valid JSON") from exc
    if manifest.get("version") != 1:
        raise ValidationFailedError("Unsupported backup version")
    if manifest.get("format") not in {"vista-project-backup", "vista-dashboard-backup"}:
        raise ValidationFailedError("Unsupported backup format")
    return manifest


def project_backup_paths(manifest: dict, archive: zipfile.ZipFile) -> list[str]:
    """Return project backup payload paths in manifest order when possible."""
    names = set(archive.namelist())
    if manifest.get("format") == "vista-project-backup":
        project_id = str(manifest.get("project", {}).get("id") or "")
        path = f"projects/{project_id}/project-backup.json"
        if path in names:
            return [path]
    paths = []
    for project in manifest.get("projects", []):
        project_id = str(project.get("id") or project.get("source_project_id") or "")
        path = f"projects/{project_id}/project-backup.json"
        if path in names:
            paths.append(path)
    if not paths:
        paths = sorted(
            name
            for name in names
            if name.startswith("projects/") and name.endswith("/project-backup.json")
        )
    if not paths:
        raise ValidationFailedError("Backup contains no project backup payloads")
    return paths


def load_project_backup_payload(archive: zipfile.ZipFile, path: str) -> dict:
    """Load and validate one project backup payload from a ZIP archive."""
    try:
        payload = json.loads(archive.read(path).decode("utf-8"))
    except Exception as exc:
        raise ValidationFailedError(f"Invalid project backup payload: {path}") from exc
    if not isinstance(payload.get("project"), dict):
        raise ValidationFailedError(f"Project backup payload missing project: {path}")
    return payload


def preview_project_backup_import_payload(archive: zipfile.ZipFile) -> dict:
    """Summarize a project or dashboard backup ZIP without importing it."""
    manifest = manifest_from_zip(archive)
    project_paths = project_backup_paths(manifest, archive)
    archive_names = set(archive.namelist())
    projects = []
    missing_artifacts = []
    for path in project_paths:
        payload = load_project_backup_payload(archive, path)
        project = payload["project"]
        images = payload.get("images", [])
        project_missing = [
            {
                "image_id": image.get("image_id"),
                "filename": image.get("filename"),
                "archive_path": image.get("archive_path"),
            }
            for image in images
            if image.get("archive_path")
            and image.get("archive_path") not in archive_names
        ]
        missing_artifacts.extend(project_missing)
        projects.append(
            {
                "source_project_id": project.get("id"),
                "name": project.get("name"),
                "project_type": project.get("project_type"),
                "meta_group_id": project.get("meta_group_id"),
                "images": len(images),
                "parts": len(payload.get("parts", [])),
                "comments": len(payload.get("comments", [])),
                "classifications": len(payload.get("classifications", [])),
                "reviews": len(payload.get("reviews", [])),
                "missing_artifacts": len(project_missing),
            }
        )

    return {
        "valid": True,
        "format": manifest.get("format"),
        "version": manifest.get("version"),
        "scope": manifest.get("scope"),
        "projects": projects,
        "project_count": len(projects),
        "missing_artifacts": missing_artifacts,
        "warnings": ["Some image artifacts are missing from the backup."]
        if missing_artifacts
        else [],
    }


def estimate_project_backup_size_bytes(context: dict) -> int:
    """Return an approximate uncompressed backup size for progress UI."""
    total = 0
    for image_ref in context.get("image_refs", []):
        if image_ref.get("archive_path"):
            total += int(image_ref.get("size_bytes") or 0)
    # Account for JSON/TOML sidecars. This is intentionally approximate because
    # the final ZIP stream is compressed and does not have a reliable content
    # length before generation finishes.
    total += len(export_bundle_service.json_bytes(context.get("backup_payload", {})))
    total += len(export_bundle_service.json_bytes(context.get("manifest_payload", {})))
    if context.get("legacy_bundle_payload"):
        total += len(
            export_bundle_service.json_bytes(context.get("legacy_bundle_payload", {}))
        )
    return max(total, 1)


def estimate_dashboard_backup_size_bytes(
    contexts: list[dict], dashboard_state: dict
) -> int:
    """Return an approximate dashboard backup size for progress UI."""
    return max(
        sum(estimate_project_backup_size_bytes(context) for context in contexts)
        + len(export_bundle_service.json_bytes(dashboard_state))
        + 2048,
        1,
    )


def project_backup_entries(
    context: dict,
    *,
    include_legacy_files: bool = True,
    include_root_manifest: bool = True,
) -> list[StreamingZipEntry]:
    """Build the ordered ZIP entries for a restorable project backup."""
    project_id = context["project_id"]
    backup_payload = context["backup_payload"]
    manifest_payload = context["manifest_payload"]
    artifact_counts = context["artifact_counts"]
    missing_artifacts = context["missing_artifacts"]

    entries: list[StreamingZipEntry] = []
    for image_ref in context["image_refs"]:
        archive_path = image_ref.get("archive_path")
        if archive_path:
            entries.append(
                StreamingZipEntry(
                    archive_path,
                    export_storage_service.artifact_content_factory(
                        image_ref, manifest_payload, artifact_counts, missing_artifacts
                    ),
                    stream=True,
                )
            )

    if include_root_manifest:
        entries.append(
            StreamingZipEntry(
                "manifest.json",
                lambda: export_bundle_service.json_bytes(manifest_payload),
            )
        )

    entries.extend(
        [
            StreamingZipEntry(
                f"projects/{project_id}/project-backup.json",
                lambda: export_bundle_service.json_bytes(backup_payload),
            ),
            StreamingZipEntry(
                f"projects/{project_id}/project.json",
                lambda: export_bundle_service.json_bytes(backup_payload["project"]),
            ),
            StreamingZipEntry(
                f"projects/{project_id}/images.json",
                lambda: export_bundle_service.json_bytes(backup_payload["images"]),
            ),
            StreamingZipEntry(
                f"projects/{project_id}/project-metadata.json",
                lambda: export_bundle_service.json_bytes(
                    backup_payload["project_metadata"]
                ),
            ),
            StreamingZipEntry(
                f"projects/{project_id}/dashboard-state.json",
                lambda: export_bundle_service.json_bytes({}),
            ),
        ]
    )

    if include_legacy_files:
        bundle_payload = context["legacy_bundle_payload"]
        entries.extend(
            [
                StreamingZipEntry(
                    "export-manifest.json",
                    lambda: export_bundle_service.json_bytes(
                        {
                            "project": manifest_payload["project"],
                            "bundle_summary": manifest_payload["bundle_summary"],
                            "export": {
                                "format": "vista-project-export",
                                "version": 1,
                                "generated_at": manifest_payload["generated_at"],
                                "generated_by": manifest_payload["generated_by"],
                                "options": manifest_payload["options"],
                                "artifact_counts": artifact_counts,
                                "missing_artifacts": missing_artifacts,
                            },
                            "image_references": backup_payload["images"],
                        }
                    ),
                ),
                StreamingZipEntry(
                    "export-manifest.toml",
                    lambda: export_bundle_service.build_toml_document(
                        tables={
                            "project": export_bundle_service.json_safe(
                                manifest_payload["project"]
                            ),
                            "export": export_bundle_service.json_safe(
                                {
                                    "format": "vista-project-export",
                                    "version": 1,
                                    "generated_at": manifest_payload["generated_at"],
                                    "generated_by": manifest_payload["generated_by"],
                                }
                            ),
                            "bundle_summary": export_bundle_service.json_safe(
                                manifest_payload["bundle_summary"]
                            ),
                        },
                        arrays={
                            "image_references": export_bundle_service.json_safe(
                                backup_payload["images"]
                            )
                        },
                    ),
                ),
            ]
        )
        options = manifest_payload.get("options", {})
        if options.get("include_project_configuration", True):
            entries.append(
                StreamingZipEntry(
                    "project-configuration.toml",
                    lambda: export_bundle_service.build_toml_document(
                        tables={
                            "project": export_bundle_service.json_safe(
                                manifest_payload["project"]
                            ),
                            "project_configuration": {
                                "metadata_key": PROJECT_CONFIGURATION_KEY,
                                "config_json": export_bundle_service.json_safe(
                                    backup_payload["project_configuration"]
                                ),
                            },
                        }
                    ),
                )
            )
        if options.get("include_metadata", True):
            entries.extend(
                [
                    StreamingZipEntry(
                        "project-metadata.toml",
                        lambda: export_bundle_service.build_toml_document(
                            arrays={
                                "project_metadata": export_bundle_service.json_safe(
                                    backup_payload["project_metadata"]
                                )
                            }
                        ),
                    ),
                    StreamingZipEntry(
                        "images.toml",
                        lambda: export_bundle_service.build_toml_document(
                            arrays={
                                "images": export_bundle_service.json_safe(
                                    backup_payload["images"]
                                )
                            }
                        ),
                    ),
                    StreamingZipEntry(
                        "parts.toml",
                        lambda: export_bundle_service.build_toml_document(
                            arrays={
                                "batches": export_bundle_service.json_safe(
                                    backup_payload["batches"]
                                ),
                                "parts": export_bundle_service.json_safe(
                                    backup_payload["parts"]
                                ),
                            }
                        ),
                    ),
                ]
            )
        if options.get("include_created_overlays", True):
            entries.append(
                StreamingZipEntry(
                    "created-overlays.toml",
                    lambda: export_bundle_service.build_toml_document(
                        tables={
                            "project": export_bundle_service.json_safe(
                                manifest_payload["project"]
                            )
                        },
                        arrays={
                            "annotations": bundle_payload.get("bundle_summary", {})
                            .get("annotations", {})
                            .get("records", []),
                            "overlay_layers": bundle_payload.get("bundle_summary", {})
                            .get("overlays", {})
                            .get("records", []),
                            "measurement_runs": bundle_payload.get("bundle_summary", {})
                            .get("measurements", {})
                            .get("records", []),
                        },
                    ),
                )
            )
    return entries


def dashboard_backup_entries(
    contexts: list[dict],
    options: dict,
    *,
    generated_at: str,
    generated_by: str,
) -> tuple[list[StreamingZipEntry], dict, int]:
    """Build dashboard backup ZIP entries from already-collected project contexts."""
    include_archived = bool(options.get("include_archived", False))
    dashboard_state = (
        options.get("dashboard_state")
        if isinstance(options.get("dashboard_state"), dict)
        else {}
    )
    manifest_payload = {
        "format": "vista-dashboard-backup",
        "version": 1,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "scope": "dashboard",
        "project_count": len(contexts),
        "projects": [context["manifest_payload"]["project"] for context in contexts],
        "options": {
            "include_archived": include_archived,
            "include_images": bool(options.get("include_images", True)),
            "include_overlays": bool(options.get("include_overlays", True)),
            "include_metadata": bool(options.get("include_metadata", True)),
            "include_created_overlays": bool(
                options.get("include_created_overlays", True)
            ),
            "include_project_configuration": bool(
                options.get("include_project_configuration", True)
            ),
            "include_deleted": bool(options.get("include_deleted", False)),
            "include_ui_state": bool(options.get("include_ui_state", True)),
        },
    }
    entries: list[StreamingZipEntry] = []
    for context in contexts:
        entries.extend(
            project_backup_entries(
                context,
                include_legacy_files=False,
                include_root_manifest=False,
            )
        )
    entries.append(
        StreamingZipEntry(
            "manifest.json", lambda: export_bundle_service.json_bytes(manifest_payload)
        )
    )
    entries.append(
        StreamingZipEntry(
            "dashboard-state.json",
            lambda: export_bundle_service.json_bytes(dashboard_state),
        )
    )
    return (
        entries,
        dashboard_state,
        estimate_dashboard_backup_size_bytes(contexts, dashboard_state),
    )


async def build_dashboard_backup_entries(
    options: dict,
    *,
    db,
    current_user,
    list_projects: ProjectLister,
) -> tuple[list[StreamingZipEntry], dict, int]:
    """Collect project contexts and build dashboard backup ZIP entries."""
    include_archived = bool(options.get("include_archived", False))
    projects = await list_projects(
        db=db,
        user=current_user,
        skip=0,
        limit=int(options.get("limit", 1000) or 1000),
        include_archived=include_archived,
    )
    contexts = []
    for project in projects:
        contexts.append(
            await export_project_backup_service.collect_project_backup_payload(
                project_id=project.id,
                db=db,
                db_project=project,
                current_user=current_user,
                include_images=bool(options.get("include_images", True)),
                include_overlays=bool(options.get("include_overlays", True)),
                include_metadata=bool(options.get("include_metadata", True)),
                include_created_overlays=bool(
                    options.get("include_created_overlays", True)
                ),
                include_project_configuration=bool(
                    options.get("include_project_configuration", True)
                ),
                include_deleted=bool(options.get("include_deleted", False)),
            )
        )

    return dashboard_backup_entries(
        contexts,
        options,
        generated_at=datetime.now(UTC).isoformat(),
        generated_by=current_user.email,
    )
