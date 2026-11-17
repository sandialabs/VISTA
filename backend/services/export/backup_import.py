"""Backup archive import orchestration.

Owns the transactional behaviour for restoring a project backup archive as a
new project, or importing one into an already-active project: mode and
confirmation validation, opening the ZIP archive, looping over
``services.export.imports.import_project_backup_payload``, rollback on
failure, and building the response payload. Also owns archive preview.

Raises ``services.errors.ValidationFailedError`` (HTTP 400) for malformed
input and ``services.errors.ConflictError`` (HTTP 409) for conflicting
imported records; ``main.py`` maps both to the same ``{detail, error_context}``
JSON error body the routers return for HTTP errors.
"""

from __future__ import annotations

import json
import uuid
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from typing import IO, Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from schemas import users as user_schemas
from services.errors import ConflictError, ValidationFailedError
from services.export import backups as export_backup_service
from services.export import imports as export_import_service

CanAccessGroup = Callable[..., Any]

_BAD_ZIP_DETAIL = "Backup file is not a valid ZIP archive"
_CONFIRM_DETAIL = "Type IMPORT to confirm import"
_CONFLICT_DETAIL = "Import failed due to conflicting imported records"


def preview_project_backup_import(file_obj: IO[bytes]) -> dict:
    """Summarize a project or dashboard backup ZIP without importing it."""
    try:
        with zipfile.ZipFile(file_obj) as archive:
            return export_backup_service.preview_project_backup_import_payload(archive)
    except zipfile.BadZipFile as exc:
        raise ValidationFailedError(_BAD_ZIP_DETAIL) from exc


def _validate_restore_as_new(mode: str, confirmation: str) -> None:
    if mode != "restore_as_new":
        raise ValidationFailedError(
            "Only restore_as_new import mode is supported by this endpoint"
        )
    if confirmation != "IMPORT":
        raise ValidationFailedError(_CONFIRM_DETAIL)


def _validate_active_project_mode(mode: str, confirmation: str) -> None:
    if mode not in {"append_active", "overwrite_active"}:
        raise ValidationFailedError(
            "Choose append_active or overwrite_active import mode"
        )
    if confirmation != "IMPORT":
        raise ValidationFailedError(_CONFIRM_DETAIL)


async def import_project_backup_archive(
    *,
    file_obj: IO[bytes],
    mode: str,
    confirmation: str,
    db: AsyncSession,
    current_user: user_schemas.User,
    can_access_group: CanAccessGroup,
) -> dict:
    """Restore every project found in a backup archive as new projects."""
    _validate_restore_as_new(mode, confirmation)
    try:
        with zipfile.ZipFile(file_obj) as archive:
            manifest = export_backup_service.manifest_from_zip(archive)
            dashboard_state = {}
            if "dashboard-state.json" in archive.namelist():
                dashboard_state = json.loads(
                    archive.read("dashboard-state.json").decode("utf-8")
                )
            project_paths = export_backup_service.project_backup_paths(
                manifest, archive
            )
            folder_map, folders_created = await restore_dashboard_folders(
                db,
                export_backup_service.load_dashboard_folders(archive),
                user_email=current_user.email,
                can_access_group=can_access_group,
            )
            imported_projects = []
            for path in project_paths:
                payload = export_backup_service.load_project_backup_payload(
                    archive, path
                )
                imported_projects.append(
                    await export_import_service.import_project_backup_payload(
                        archive=archive,
                        payload=payload,
                        db=db,
                        current_user=current_user,
                        mode=mode,
                        target_project=None,
                        can_access_group=can_access_group,
                        folder_map=folder_map,
                    )
                )
    except zipfile.BadZipFile as exc:
        await db.rollback()
        raise ValidationFailedError(_BAD_ZIP_DETAIL) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(_CONFLICT_DETAIL) from exc
    except Exception:
        await db.rollback()
        raise

    return {
        "ok": True,
        "format": manifest.get("format"),
        "projects_created": imported_projects,
        "project_count": len(imported_projects),
        "folders_created": folders_created,
        "dashboard_state": dashboard_state,
    }


async def import_project_backup_archive_into_active_project(
    *,
    file_obj: IO[bytes],
    mode: str,
    confirmation: str,
    db: AsyncSession,
    current_user: user_schemas.User,
    target_project: models.Project,
    can_access_group: CanAccessGroup,
) -> dict:
    """Import a single-project backup archive into an active project."""
    _validate_active_project_mode(mode, confirmation)
    try:
        with zipfile.ZipFile(file_obj) as archive:
            manifest = export_backup_service.manifest_from_zip(archive)
            project_paths = export_backup_service.project_backup_paths(
                manifest, archive
            )
            if len(project_paths) != 1:
                raise ValidationFailedError(
                    "Importing into the active project requires a bundle "
                    "with exactly one project"
                )
            payload = export_backup_service.load_project_backup_payload(
                archive, project_paths[0]
            )
            imported_project = (
                await export_import_service.import_project_backup_payload(
                    archive=archive,
                    payload=payload,
                    db=db,
                    current_user=current_user,
                    mode=mode,
                    target_project=target_project,
                    can_access_group=can_access_group,
                )
            )
    except zipfile.BadZipFile as exc:
        await db.rollback()
        raise ValidationFailedError(_BAD_ZIP_DETAIL) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(_CONFLICT_DETAIL) from exc
    except Exception:
        await db.rollback()
        raise

    return {
        "ok": True,
        "format": manifest.get("format"),
        "mode": mode,
        "project": imported_project,
        "project_count": 1,
    }


async def restore_dashboard_folders(
    db: AsyncSession,
    folders: list[dict],
    *,
    user_email: str,
    can_access_group: CanAccessGroup,
) -> tuple[dict[str, tuple[uuid.UUID, str]], int]:
    """Recreate backup folders with new IDs.

    Returns ``(old_id -> (new_id, meta_group_id), count)``. Folder rows are
    validated like API input (names cleaned; invalid rows skipped). Folders in
    groups the importer cannot access are skipped, a child whose parent is in
    another access group (or was skipped) is skipped with its subtree, and a
    name clash with an existing sibling gets " (Imported)", " (Imported 2)", ...
    appended. Archive flags are kept. Parents come before children.
    """
    from core import locks
    from schemas.folders import FOLDER_DESCRIPTION_MAX, clean_folder_name
    from services.dashboard import name_key

    folder_map: dict[str, tuple[uuid.UUID, str]] = {}
    created = 0
    for row in folders[: 10_000]:
        old_id = str(row.get("id") or "")
        group = str(row.get("meta_group_id") or "").strip()
        try:
            name = clean_folder_name(str(row.get("name") or ""))
        except ValueError:
            continue
        if not old_id or not group or not can_access_group(user_email, group):
            continue
        parent_old = row.get("parent_id")
        parent_id = None
        if parent_old:
            parent_entry = folder_map.get(str(parent_old))
            if parent_entry is None or parent_entry[1] != group:
                continue  # Parent skipped or in another access group.
            parent_id = parent_entry[0]
        depth = len(await locks.folder_ancestors(db, parent_id)) if parent_id else 0
        if depth + 1 > locks.MAX_FOLDER_DEPTH:
            continue
        candidate = name
        suffix = 1
        while True:
            exists = (
                await db.execute(
                    select(models.DashboardFolder.id).where(
                        models.DashboardFolder.meta_group_id == group,
                        models.DashboardFolder.name_key == name_key(candidate),
                        models.DashboardFolder.parent_id.is_(None)
                        if parent_id is None
                        else models.DashboardFolder.parent_id == parent_id,
                    )
                )
            ).first()
            if exists is None:
                break
            label = "Imported" if suffix == 1 else f"Imported {suffix}"
            candidate = f"{name[: 255 - len(label) - 3]} ({label})"
            suffix += 1
        description = str(row.get("description") or "")[:FOLDER_DESCRIPTION_MAX] or None
        archived = bool(row.get("is_archived", False))
        folder = models.DashboardFolder(
            meta_group_id=group,
            parent_id=parent_id,
            name=candidate,
            name_key=name_key(candidate),
            description=description,
            created_by=user_email,
            is_archived=archived,
            archived_at=datetime.now(UTC) if archived else None,
            archived_by=user_email if archived else None,
        )
        db.add(folder)
        await db.flush()
        folder_map[old_id] = (folder.id, group)
        created += 1
    return folder_map, created
