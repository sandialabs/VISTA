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
import zipfile
from collections.abc import Callable
from typing import IO, Any

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
