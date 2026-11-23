"""Dashboard folders, moves, bulk actions, listing and search."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.database import get_db
from repositories import projects as project_repository
from schemas import folders as folder_schemas
from schemas import projects as project_schemas
from schemas import users as user_schemas
from services import dashboard as dashboard_service
from services.errors import ForbiddenError, NotFoundError, ServiceError
from utils import cache_manager
from utils.dependencies import (
    get_accessible_group_ids,
    get_current_user,
    get_project_or_403,
    require_authenticated_user,
)

router = APIRouter(tags=["Dashboard Folders"])


async def _groups(db: AsyncSession, user: user_schemas.User) -> list[str]:
    return await get_accessible_group_ids(db, user)


def _require_group(meta_group_id: str, groups: list[str], email: str) -> str:
    meta_group_id = (meta_group_id or "").strip()
    if meta_group_id not in groups:
        raise ForbiddenError(
            f"User '{email}' does not have access to group '{meta_group_id}'."
        )
    return meta_group_id


# --- Folders --------------------------------------------------------------


@router.get("/folders/tree", response_model=folder_schemas.FolderTree)
async def read_folder_tree(
    meta_group_id: str = Query(..., min_length=1, max_length=255),
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Every folder in an access group with counts and effective lock state."""
    group = _require_group(
        meta_group_id, await _groups(db, current_user), current_user.email
    )
    return await dashboard_service.folder_tree(
        db, group, include_archived=include_archived
    )


@router.post("/folders", response_model=folder_schemas.Folder, status_code=201)
async def create_folder(
    payload: folder_schemas.FolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    folder = await dashboard_service.create_folder(
        db,
        payload,
        user_email=current_user.email,
        accessible_groups=await _groups(db, current_user),
    )
    return await dashboard_service.folder_response(db, folder)


@router.get("/folders/{folder_id}", response_model=folder_schemas.Folder)
async def read_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    folder = await dashboard_service.get_folder(
        db, folder_id, accessible_groups=await _groups(db, current_user)
    )
    return await dashboard_service.folder_response(db, folder)


@router.patch("/folders/{folder_id}", response_model=folder_schemas.Folder)
async def update_folder(
    folder_id: uuid.UUID,
    payload: folder_schemas.FolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    folder = await dashboard_service.get_folder(
        db, folder_id, accessible_groups=await _groups(db, current_user)
    )
    folder = await dashboard_service.update_folder(
        db, folder, payload, user_email=current_user.email
    )
    return await dashboard_service.folder_response(db, folder)


@router.post("/folders/{folder_id}/move", response_model=folder_schemas.Folder)
async def move_folder(
    folder_id: uuid.UUID,
    payload: folder_schemas.FolderMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    groups = await _groups(db, current_user)
    folder = await dashboard_service.get_folder(db, folder_id, accessible_groups=groups)
    await dashboard_service.lock_folder_tree(db, folder.meta_group_id)
    await dashboard_service.move_folder(
        db,
        folder,
        payload.parent_id,
        user_email=current_user.email,
        accessible_groups=groups,
    )
    return await dashboard_service.folder_response(db, folder)


@router.post("/folders/{folder_id}/archive", response_model=folder_schemas.Folder)
async def archive_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    folder = await dashboard_service.get_folder(
        db, folder_id, accessible_groups=await _groups(db, current_user)
    )
    await dashboard_service.lock_folder_tree(db, folder.meta_group_id)
    await dashboard_service.set_folder_archived(
        db, folder, True, user_email=current_user.email
    )
    return await dashboard_service.folder_response(db, folder)


@router.post("/folders/{folder_id}/unarchive", response_model=folder_schemas.Folder)
async def unarchive_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    folder = await dashboard_service.get_folder(
        db, folder_id, accessible_groups=await _groups(db, current_user)
    )
    await dashboard_service.lock_folder_tree(db, folder.meta_group_id)
    await dashboard_service.set_folder_archived(
        db, folder, False, user_email=current_user.email
    )
    return await dashboard_service.folder_response(db, folder)


@router.get(
    "/folders/{folder_id}/delete-preview",
    response_model=folder_schemas.FolderDeletePreview,
)
async def preview_folder_delete(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    folder = await dashboard_service.get_folder(
        db, folder_id, accessible_groups=await _groups(db, current_user)
    )
    return await dashboard_service.delete_preview(db, folder)


@router.delete(
    "/folders/{folder_id}", response_model=folder_schemas.FolderDeleteResponse
)
async def delete_folder(
    folder_id: uuid.UUID,
    payload: folder_schemas.FolderDeleteRequest,
    db: AsyncSession = Depends(get_db),
    # Same bar as project deletion: a signed-in user, never an API key.
    current_user: user_schemas.User = Depends(require_authenticated_user),
):
    folder = await dashboard_service.get_folder(
        db, folder_id, accessible_groups=await _groups(db, current_user)
    )
    await dashboard_service.lock_folder_tree(db, folder.meta_group_id)
    response, project_ids = await dashboard_service.delete_folder(
        db, folder, payload.confirmation_phrase, user_email=current_user.email
    )
    for pid in project_ids:
        cache_manager.invalidate_project_images(pid)
    return response


# --- Projects -------------------------------------------------------------


@router.post("/projects/{project_id}/move", response_model=project_schemas.Project)
async def move_project(
    project_id: uuid.UUID,
    payload: project_schemas.ProjectMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    project = await get_project_or_403(project_id, db, current_user)
    await dashboard_service.lock_folder_tree(db, project.meta_group_id)
    await dashboard_service.move_project(
        db,
        project,
        payload.folder_id,
        user_email=current_user.email,
        accessible_groups=await _groups(db, current_user),
    )
    return (await dashboard_service.decorate_projects(db, [project]))[0]


# --- Bulk -----------------------------------------------------------------


async def _resolve_item(
    db: AsyncSession,
    item: folder_schemas.DashboardItemRef,
    groups: list[str],
) -> models.Project | models.DashboardFolder:
    if item.type == "folder":
        return await dashboard_service.get_folder(db, item.id, accessible_groups=groups)
    project = await project_repository.get_project(db, item.id)
    if project is None or project.meta_group_id not in groups:
        raise NotFoundError("Project not found")
    return project


def _error_detail(exc: Exception) -> str:
    if isinstance(exc, ServiceError):
        return str(exc.detail)
    return "Unexpected error."


async def _run_bulk(db, items, apply, failed_detail):
    """Apply ``apply(obj)`` to each item in one transaction: all or nothing.

    Stops at the first failure (a failed flush leaves the session unusable),
    reports per-item results, and writes audit lines only after the commit.
    """
    results: list[folder_schemas.BulkItemResult] = []
    seen: set[tuple[str, uuid.UUID]] = set()
    failed = False
    for item in items:
        key = (item.type, item.id)
        if key in seen:
            continue
        seen.add(key)
        if failed:
            results.append(
                folder_schemas.BulkItemResult(
                    type=item.type, id=item.id, ok=False, detail=failed_detail
                )
            )
            continue
        try:
            previous = await apply(item)
            # Later items must see this change (cycles, name clashes).
            await db.flush()
            results.append(
                folder_schemas.BulkItemResult(
                    type=item.type, id=item.id, ok=True, previous_folder_id=previous
                )
            )
        except Exception as exc:  # noqa: BLE001 - reported per item
            failed = True
            results.append(
                folder_schemas.BulkItemResult(
                    type=item.type, id=item.id, ok=False, detail=_error_detail(exc)
                )
            )
    if not failed:
        try:
            await db.commit()
        except IntegrityError:
            failed = True
            for r in results:
                r.ok = False
                r.detail = "A folder with this name already exists at the destination."
    if failed:
        await db.rollback()
        dashboard_service.discard_audit(db)
        for r in results:
            if r.ok:
                r.ok = False
                r.detail = failed_detail
                r.previous_folder_id = None
        return folder_schemas.BulkResult(ok=False, results=results)
    dashboard_service.flush_audit(db)
    return folder_schemas.BulkResult(ok=True, results=results)


@router.post("/dashboard/bulk/move", response_model=folder_schemas.BulkResult)
async def bulk_move(
    payload: folder_schemas.BulkMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Move many items into one folder: all or nothing."""
    groups = await _groups(db, current_user)
    locked_groups: set[str] = set()

    async def apply(item):
        obj = await _resolve_item(db, item, groups)
        if obj.meta_group_id not in locked_groups:
            await dashboard_service.lock_folder_tree(db, obj.meta_group_id)
            locked_groups.add(obj.meta_group_id)
        move = (
            dashboard_service.move_folder
            if isinstance(obj, models.DashboardFolder)
            else dashboard_service.move_project
        )
        return await move(
            db,
            obj,
            payload.target_folder_id,
            user_email=current_user.email,
            accessible_groups=groups,
            commit=False,
        )

    return await _run_bulk(
        db, payload.items, apply, "Not moved: another item in this request failed."
    )


@router.post("/dashboard/bulk/archive", response_model=folder_schemas.BulkResult)
async def bulk_archive(
    payload: folder_schemas.BulkArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Archive or unarchive many items: all or nothing.

    Projects keep their creator-only archive rule; items inside an archived
    folder keep their own flags frozen.
    """
    groups = await _groups(db, current_user)

    # Parents first, so an item made locked by an earlier item in the same
    # request is refused instead of silently changing its frozen flag.
    async def apply(item):
        obj = await _resolve_item(db, item, groups)
        if isinstance(obj, models.DashboardFolder):
            await dashboard_service.set_folder_archived(
                db, obj, payload.archived, user_email=current_user.email, commit=False
            )
        else:
            await dashboard_service.set_project_archived(
                db, obj, payload.archived, user_email=current_user.email, commit=False
            )
        return None

    return await _run_bulk(
        db, payload.items, apply, "Not changed: another item in this request failed."
    )


# --- Listing / search -----------------------------------------------------


@router.get("/dashboard/items", response_model=folder_schemas.DashboardItems)
async def list_dashboard_items(
    meta_group_id: str = Query(..., min_length=1, max_length=255),
    folder_id: uuid.UUID | None = Query(None),
    q: str | None = Query(None, max_length=255),
    recursive: bool = Query(False),
    include_archived: bool = Query(False),
    project_type: str | None = Query(None, max_length=16),
    created_by: str | None = Query(None, max_length=255),
    archived: Literal["any", "active", "archived"] = Query("any"),
    sort: Literal["created", "last_activity", "archived", "name"] = Query(
        "last_activity"
    ),
    order: Literal["asc", "desc"] = Query("desc"),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=dashboard_service.MAX_PAGE),
    ids: list[uuid.UUID] | None = Query(None, max_length=200),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Folders and projects at a location; ``q`` searches everything below it."""
    group = _require_group(
        meta_group_id, await _groups(db, current_user), current_user.email
    )
    return await dashboard_service.list_items(
        db,
        meta_group_id=group,
        folder_id=folder_id,
        query=q,
        recursive=recursive,
        include_archived=include_archived,
        project_type=project_type,
        created_by=created_by,
        archived_filter=None if archived == "any" else archived,
        sort=sort,
        order=order,
        offset=offset,
        limit=limit,
        ids=ids,
    )
