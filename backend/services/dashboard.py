"""Dashboard folders: create, edit, move, archive, delete, listing and search.

Folders are a directory tree inside one access group (``meta_group_id``).
Rules (see docs/dashboard-folders.md):

* Nothing moves between access groups.
* A folder or project is *locked* when it, or an ancestor folder, is archived.
  Locked items cannot be renamed, edited or moved; nothing moves into or out of
  a locked folder. Projects inside become read-only (``utils.dependencies``).
* Archiving a parent locks everything below it without touching the
  descendants' own flags, so unarchiving restores their earlier state.
* Deleting a folder deletes every subfolder and every project below it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Iterable

from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import locks, models
from repositories import projects as project_repository
from repositories.audit import log_db_operation
from schemas import folders as folder_schemas
from schemas import projects as project_schemas
from services.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationFailedError,
)

SORT_FIELDS = {
    "created": models.Project.created_at,
    "last_activity": models.Project.last_activity_at,
    "archived": models.Project.archived_at,
    "name": models.Project.name,
}
MAX_PAGE = 500
# Folders are loaded per access group for tree computations; keep that bounded.
MAX_FOLDERS_PER_GROUP = 5000


_PENDING_AUDIT = "vista_pending_dashboard_audit"


def _audit(db: AsyncSession, commit: bool, *args) -> None:
    """Write an audit line now (already committed) or after the caller commits.

    Uncommitted operations (bulk requests) are queued on the session and
    flushed by ``flush_audit`` after a successful commit; a rollback discards
    them via ``discard_audit``, so rolled-back changes are never logged.
    """
    if commit:
        log_db_operation(*args)
    else:
        db.sync_session.info.setdefault(_PENDING_AUDIT, []).append(args)


def flush_audit(db: AsyncSession) -> None:
    for args in db.sync_session.info.pop(_PENDING_AUDIT, []):
        log_db_operation(*args)


def discard_audit(db: AsyncSession) -> None:
    db.sync_session.info.pop(_PENDING_AUDIT, None)


def name_key(name: str) -> str:
    """Sibling-uniqueness key: NFC, inner whitespace collapsed, casefolded."""
    import unicodedata

    return " ".join(unicodedata.normalize("NFC", name).split()).casefold()


def delete_confirmation_phrase(folder: models.DashboardFolder) -> str:
    return f"DELETE {folder.name}"


def _now() -> datetime:
    return datetime.now(UTC)


def _folder_locked_detail(name: str) -> str:
    return (
        f"The folder '{name}' is archived (or inside an archived folder) and is "
        "locked. Unarchive it first."
    )


# --- Lookups -------------------------------------------------------------


async def get_folder(
    db: AsyncSession, folder_id: uuid.UUID, *, accessible_groups: Iterable[str]
) -> models.DashboardFolder:
    """A folder the caller may see; 404 when missing or in another group.

    Folders in groups the caller cannot access are reported as missing so their
    IDs cannot be probed.
    """
    folder = await db.get(models.DashboardFolder, folder_id)
    if folder is None or folder.meta_group_id not in set(accessible_groups):
        raise NotFoundError("Folder not found")
    return folder


async def lock_folder_tree(db: AsyncSession, meta_group_id: str) -> None:
    """Serialize folder-tree changes within one access group.

    Two concurrent moves (A under B, B under A) would each pass the cycle check
    against their own snapshot and together form a detached cycle. On
    PostgreSQL a transaction-scoped advisory lock per group makes the second
    move wait and then see the first; SQLite already serializes writers.
    After taking the lock the session's cached folder rows are refreshed.
    """
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"vista.dashboard_folders:{meta_group_id}"},
        )
        for obj in list(db.identity_map.values()):
            if isinstance(obj, models.DashboardFolder):
                await db.refresh(obj)


async def _assert_unique_name(
    db: AsyncSession,
    *,
    meta_group_id: str,
    parent_id: uuid.UUID | None,
    key: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    query = select(models.DashboardFolder.id).where(
        models.DashboardFolder.meta_group_id == meta_group_id,
        models.DashboardFolder.name_key == key,
        models.DashboardFolder.parent_id.is_(None)
        if parent_id is None
        else models.DashboardFolder.parent_id == parent_id,
    )
    if exclude_id is not None:
        query = query.where(models.DashboardFolder.id != exclude_id)
    if (await db.execute(query.limit(1))).first() is not None:
        raise ConflictError("A folder with this name already exists here.")


async def _assert_target_folder(
    db: AsyncSession,
    target_id: uuid.UUID | None,
    *,
    meta_group_id: str,
    accessible_groups: Iterable[str],
) -> models.DashboardFolder | None:
    """Validate a destination folder: same access group and not locked."""
    if target_id is None:
        return None
    target = await get_folder(db, target_id, accessible_groups=accessible_groups)
    if target.meta_group_id != meta_group_id:
        raise ForbiddenError("Items cannot be moved between access groups.")
    if await locks.is_folder_or_ancestor_archived(db, target.id):
        raise ForbiddenError(_folder_locked_detail(target.name))
    return target


async def _touch_folders(db: AsyncSession, *folder_ids: uuid.UUID | None) -> None:
    ids = [fid for fid in folder_ids if fid is not None]
    if ids:
        await db.execute(
            update(models.DashboardFolder)
            .where(models.DashboardFolder.id.in_(ids))
            .values(last_activity_at=_now())
            .execution_options(synchronize_session=False)
        )


async def _commit(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "name" in str(exc.orig).lower() or "unique" in str(exc.orig).lower():
            raise ConflictError("A folder with this name already exists here.") from exc
        raise ConflictError(
            "The folder tree changed while saving; reload and try again."
        ) from exc


# --- Serialization --------------------------------------------------------


async def _project_stats(
    db: AsyncSession, meta_group_id: str, *, include_archived: bool
) -> list[tuple[uuid.UUID | None, bool, datetime | None]]:
    """``(folder_id, is_archived, max last_activity, count)`` per folder/flag.

    Aggregated in SQL so large groups do not ship every project row.
    """
    query = (
        select(
            models.Project.folder_id,
            models.Project.is_archived,
            func.max(models.Project.last_activity_at),
            func.count(models.Project.id),
        )
        .where(models.Project.meta_group_id == meta_group_id)
        .group_by(models.Project.folder_id, models.Project.is_archived)
    )
    return [tuple(row) for row in (await db.execute(query)).all()]


def _max_dt(*values: datetime | None) -> datetime | None:
    present = [v for v in values if v is not None]
    if not present:
        return None
    # SQLite returns naive datetimes; compare everything as UTC.
    return max(v if v.tzinfo else v.replace(tzinfo=UTC) for v in present)


def serialize_folders(
    index: locks.FolderIndex,
    folder_ids: Iterable[uuid.UUID],
    project_stats: list[tuple[uuid.UUID | None, bool, datetime | None, int]],
    *,
    include_archived: bool,
) -> list[folder_schemas.Folder]:
    locked = index.effectively_archived()
    direct: dict[uuid.UUID | None, int] = {}
    newest: dict[uuid.UUID | None, datetime | None] = {}
    for folder_id, is_archived, last_activity, count in project_stats:
        visible = include_archived or (
            not is_archived and (folder_id is None or folder_id not in locked)
        )
        if visible:
            direct[folder_id] = direct.get(folder_id, 0) + count
        newest[folder_id] = _max_dt(newest.get(folder_id), last_activity)

    # Subtree aggregates in one children-first pass (O(folders)).
    totals: dict[uuid.UUID, int] = {}
    latest: dict[uuid.UUID, datetime | None] = {}
    for fid in index.postorder():
        kids = index.children.get(fid, [])
        totals[fid] = direct.get(fid, 0) + sum(totals.get(c, 0) for c in kids)
        latest[fid] = _max_dt(
            index.folders[fid].last_activity_at,
            newest.get(fid),
            *(latest.get(c) for c in kids),
        )

    out = []
    for fid in folder_ids:
        folder = index.folders[fid]
        total = totals.get(fid, direct.get(fid, 0))
        last_edited = latest.get(fid, folder.last_activity_at)
        nearest_locker = index.nearest_archived_ancestor(folder.parent_id)
        visible_children = [
            c
            for c in index.children.get(fid, [])
            if include_archived or c not in locked
        ]
        out.append(
            folder_schemas.Folder(
                id=folder.id,
                meta_group_id=folder.meta_group_id,
                parent_id=folder.parent_id,
                name=folder.name,
                description=folder.description,
                created_by=folder.created_by,
                created_at=folder.created_at,
                updated_at=folder.updated_at,
                is_archived=bool(folder.is_archived),
                archived_at=folder.archived_at,
                archived_by=folder.archived_by,
                effective_archived=fid in locked,
                locked_by_folder_id=nearest_locker,
                last_edited_at=last_edited,
                project_count=direct.get(fid, 0),
                total_project_count=total,
                folder_count=len(visible_children),
                path=[{"id": str(p.id), "name": p.name} for p in index.path(fid)],
            )
        )
    return out


def _sort_folders(folders: list[folder_schemas.Folder]) -> list[folder_schemas.Folder]:
    """Newest "last edited" first; name breaks ties."""
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    return sorted(
        folders,
        key=lambda f: (
            -(_max_dt(f.last_edited_at) or epoch).timestamp(),
            f.name.casefold(),
        ),
    )


async def folder_response(
    db: AsyncSession, folder: models.DashboardFolder
) -> folder_schemas.Folder:
    index = await locks.load_folder_index(db, [folder.meta_group_id])
    stats = await _project_stats(db, folder.meta_group_id, include_archived=True)
    # Inside a locked folder everything is archived; count it rather than
    # report an archived folder as empty.
    include_archived = folder.id in index.effectively_archived()
    return serialize_folders(
        index, [folder.id], stats, include_archived=include_archived
    )[0]


async def folder_tree(
    db: AsyncSession, meta_group_id: str, *, include_archived: bool
) -> folder_schemas.FolderTree:
    index = await locks.load_folder_index(db, [meta_group_id])
    locked = index.effectively_archived()
    ids = [fid for fid in index.folders if include_archived or fid not in locked]
    stats = await _project_stats(db, meta_group_id, include_archived=include_archived)
    folders = _sort_folders(
        serialize_folders(index, ids, stats, include_archived=include_archived)
    )
    root_count = sum(
        count
        for folder_id, is_archived, _, count in stats
        if folder_id is None and (include_archived or not is_archived)
    )
    total = sum(
        count
        for folder_id, is_archived, _, count in stats
        if include_archived
        or (not is_archived and (folder_id is None or folder_id not in locked))
    )
    return folder_schemas.FolderTree(
        meta_group_id=meta_group_id,
        folders=folders,
        root_project_count=root_count,
        total_project_count=total,
    )


async def decorate_projects(
    db: AsyncSession,
    projects: list[models.Project],
    *,
    index: locks.FolderIndex | None = None,
) -> list[project_schemas.Project]:
    """Project responses with counts, folder path and effective lock state."""
    if not projects:
        return []
    if index is None:
        index = await locks.load_folder_index(db, {p.meta_group_id for p in projects})
    locked = index.effectively_archived()
    counts = await project_repository.get_project_dashboard_counts(
        db, [p.id for p in projects]
    )
    out = []
    for project in projects:
        path = index.path(project.folder_id)
        locker = index.nearest_archived_ancestor(project.folder_id)
        out.append(
            project_schemas.Project.model_validate(project).model_copy(
                update={
                    **counts.get(project.id, {"image_count": 0, "part_count": 0}),
                    "folder_path": [
                        project_schemas.FolderPathEntry(id=f.id, name=f.name)
                        for f in path
                    ],
                    "effective_archived": bool(project.is_archived)
                    or (project.folder_id is not None and project.folder_id in locked),
                    "locked_by_folder_id": locker,
                }
            )
        )
    return out


# --- Folder mutations -----------------------------------------------------


async def create_folder(
    db: AsyncSession,
    payload: folder_schemas.FolderCreate,
    *,
    user_email: str,
    accessible_groups: Iterable[str],
) -> models.DashboardFolder:
    accessible_groups = list(accessible_groups)
    if payload.meta_group_id not in accessible_groups:
        raise ForbiddenError(
            f"User '{user_email}' cannot create folders in group '{payload.meta_group_id}'."
        )
    await lock_folder_tree(db, payload.meta_group_id)
    if payload.parent_id is not None:
        index = await locks.load_folder_index(db, [payload.meta_group_id])
        await _assert_target_folder(
            db,
            payload.parent_id,
            meta_group_id=payload.meta_group_id,
            accessible_groups=accessible_groups,
        )
        if index.depth(payload.parent_id) + 1 > locks.MAX_FOLDER_DEPTH:
            raise ValidationFailedError(
                f"Folders can be nested at most {locks.MAX_FOLDER_DEPTH} levels deep."
            )
    key = name_key(payload.name)
    await _assert_unique_name(
        db, meta_group_id=payload.meta_group_id, parent_id=payload.parent_id, key=key
    )
    existing = (
        await db.execute(
            select(func.count(models.DashboardFolder.id)).where(
                models.DashboardFolder.meta_group_id == payload.meta_group_id
            )
        )
    ).scalar_one()
    if existing >= MAX_FOLDERS_PER_GROUP:
        raise ValidationFailedError(
            f"An access group can have at most {MAX_FOLDERS_PER_GROUP} folders."
        )
    now = _now()
    folder = models.DashboardFolder(
        meta_group_id=payload.meta_group_id,
        parent_id=payload.parent_id,
        name=payload.name,
        name_key=key,
        description=(payload.description or None),
        created_by=user_email,
        created_at=now,
        last_activity_at=now,
    )
    db.add(folder)
    await _touch_folders(db, payload.parent_id)
    await _commit(db)
    await db.refresh(folder)
    log_db_operation(
        "CREATE",
        "dashboard_folders",
        folder.id,
        user_email,
        {
            "name": folder.name,
            "meta_group_id": folder.meta_group_id,
            "parent_id": str(folder.parent_id) if folder.parent_id else None,
        },
    )
    return folder


async def update_folder(
    db: AsyncSession,
    folder: models.DashboardFolder,
    payload: folder_schemas.FolderUpdate,
    *,
    user_email: str,
) -> models.DashboardFolder:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return folder
    if (await locks.folder_lock_state(db, folder)).locked:
        raise ForbiddenError(_folder_locked_detail(folder.name))
    if "name" in updates:
        if updates["name"] is None:
            raise ValidationFailedError("Folder name is required.")
        key = name_key(updates["name"])
        await _assert_unique_name(
            db,
            meta_group_id=folder.meta_group_id,
            parent_id=folder.parent_id,
            key=key,
            exclude_id=folder.id,
        )
        folder.name = updates["name"]
        folder.name_key = key
    if "description" in updates:
        folder.description = updates["description"] or None
    folder.updated_at = _now()
    folder.last_activity_at = folder.updated_at
    await _commit(db)
    await db.refresh(folder)
    log_db_operation(
        "UPDATE", "dashboard_folders", folder.id, user_email, {"changes": updates}
    )
    return folder


async def move_folder(
    db: AsyncSession,
    folder: models.DashboardFolder,
    target_parent_id: uuid.UUID | None,
    *,
    user_email: str,
    accessible_groups: Iterable[str],
    commit: bool = True,
) -> uuid.UUID | None:
    """Move a folder (and everything inside) under ``target_parent_id``.

    Returns the previous parent ID (for undo).
    """
    previous = folder.parent_id
    if target_parent_id == folder.parent_id:
        return previous
    if (await locks.folder_lock_state(db, folder)).locked:
        raise ForbiddenError(_folder_locked_detail(folder.name))
    index = await locks.load_folder_index(db, [folder.meta_group_id])
    if target_parent_id is not None and target_parent_id in index.subtree(folder.id):
        raise ValidationFailedError(
            "A folder cannot be moved into itself or one of its subfolders."
        )
    await _assert_target_folder(
        db,
        target_parent_id,
        meta_group_id=folder.meta_group_id,
        accessible_groups=accessible_groups,
    )
    if (
        index.depth(target_parent_id) + index.subtree_height(folder.id)
        > locks.MAX_FOLDER_DEPTH
    ):
        raise ValidationFailedError(
            f"Folders can be nested at most {locks.MAX_FOLDER_DEPTH} levels deep."
        )
    await _assert_unique_name(
        db,
        meta_group_id=folder.meta_group_id,
        parent_id=target_parent_id,
        key=folder.name_key,
        exclude_id=folder.id,
    )
    folder.parent_id = target_parent_id
    folder.last_activity_at = _now()
    await _touch_folders(db, previous, target_parent_id)
    if commit:
        await _commit(db)
        await db.refresh(folder)
    _audit(
        db,
        commit,
        "MOVE",
        "dashboard_folders",
        folder.id,
        user_email,
        {
            "from_parent_id": str(previous) if previous else None,
            "to_parent_id": str(target_parent_id) if target_parent_id else None,
        },
    )
    return previous


async def move_project(
    db: AsyncSession,
    project: models.Project,
    target_folder_id: uuid.UUID | None,
    *,
    user_email: str,
    accessible_groups: Iterable[str],
    commit: bool = True,
) -> uuid.UUID | None:
    """Move a project to ``target_folder_id``. Returns the previous folder ID."""
    previous = project.folder_id
    if target_folder_id == project.folder_id:
        return previous
    if project.is_archived:
        raise ForbiddenError(
            "This project is archived and read-only. Unarchive it to move it."
        )
    state = await locks.project_lock_state(db, project)
    if state.locked_by_folder_id is not None:
        raise ForbiddenError(_folder_locked_detail(state.locked_by_folder_name or ""))
    await _assert_target_folder(
        db,
        target_folder_id,
        meta_group_id=project.meta_group_id,
        accessible_groups=accessible_groups,
    )
    project.folder_id = target_folder_id
    await _touch_folders(db, previous, target_folder_id)
    if commit:
        await db.commit()
        await db.refresh(project)
    _audit(
        db,
        commit,
        "MOVE",
        "projects",
        project.id,
        user_email,
        {
            "from_folder_id": str(previous) if previous else None,
            "to_folder_id": str(target_folder_id) if target_folder_id else None,
        },
    )
    return previous


async def set_folder_archived(
    db: AsyncSession,
    folder: models.DashboardFolder,
    archived: bool,
    *,
    user_email: str,
    commit: bool = True,
) -> models.DashboardFolder:
    """Archive or unarchive a folder.

    Archiving locks the whole subtree through inheritance; descendants keep
    their own flags. Unarchiving is refused while an ancestor is archived.
    """
    if bool(folder.is_archived) == archived:
        return folder
    # A locked folder's own flag is frozen in both directions, so unarchiving
    # the ancestor restores exactly the earlier state.
    if await locks.is_folder_or_ancestor_archived(db, folder.parent_id):
        raise ForbiddenError(
            "This folder is inside an archived folder. Unarchive the parent folder first."
        )
    folder.is_archived = archived
    folder.archived_at = _now() if archived else None
    folder.archived_by = user_email if archived else None
    folder.last_activity_at = _now()
    if commit:
        await db.commit()
        await db.refresh(folder)
    _audit(
        db,
        commit,
        "ARCHIVE" if archived else "UNARCHIVE",
        "dashboard_folders",
        folder.id,
        user_email,
        {},
    )
    return folder


async def create_project(
    db: AsyncSession,
    payload: project_schemas.ProjectCreate,
    *,
    created_by: str,
) -> models.Project:
    """Create a project, optionally inside a folder of the same access group.

    One transaction: the folder check, the insert and the folder "last edited"
    bump commit together; a folder deleted concurrently yields 409, not 500.
    """
    if payload.folder_id is not None:
        folder = await db.get(models.DashboardFolder, payload.folder_id)
        if folder is None or folder.meta_group_id != payload.meta_group_id:
            raise ValidationFailedError(
                "The folder does not exist in this access group."
            )
        if await locks.is_folder_or_ancestor_archived(db, folder.id):
            raise ForbiddenError(
                f"The folder '{folder.name}' is archived and locked. Unarchive it first."
            )
    now = _now()
    project = models.Project(
        **payload.model_dump(), created_by=created_by, last_activity_at=now
    )
    db.add(project)
    await _touch_folders(db, payload.folder_id)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("The folder was changed or removed; try again.") from exc
    await db.refresh(project)
    log_db_operation(
        "CREATE",
        "projects",
        project.id,
        created_by,
        {
            "name": project.name,
            "meta_group_id": project.meta_group_id,
            "folder_id": str(project.folder_id) if project.folder_id else None,
        },
    )
    return project


async def set_project_archived(
    db: AsyncSession,
    project: models.Project,
    archived: bool,
    *,
    user_email: str | None,
    commit: bool = True,
) -> models.Project:
    """Archive/unarchive a project with the shared rules.

    Only the creator may change a project's archive state. Inside an archived
    folder the project's own flag is frozen in both directions, so unarchiving
    the folder restores exactly the earlier state.
    """
    if project.created_by and project.created_by != user_email:
        raise ForbiddenError(
            f"Only the project creator can {'archive' if archived else 'unarchive'} this project."
        )
    if bool(project.is_archived) == archived:
        return project
    if await locks.is_folder_or_ancestor_archived(db, project.folder_id):
        raise ForbiddenError(
            "This project is inside an archived folder. Unarchive the folder first."
        )
    project.is_archived = archived
    project.archived_at = _now() if archived else None
    if commit:
        await db.commit()
        await db.refresh(project)
    _audit(
        db,
        commit,
        "ARCHIVE" if archived else "UNARCHIVE",
        "projects",
        project.id,
        user_email or "system",
        {},
    )
    return project


async def delete_preview(
    db: AsyncSession, folder: models.DashboardFolder
) -> folder_schemas.FolderDeletePreview:
    index = await locks.load_folder_index(db, [folder.meta_group_id])
    subtree = index.subtree(folder.id)
    project_ids = [
        row[0]
        for row in (
            await db.execute(
                select(models.Project.id).where(
                    models.Project.folder_id.in_(subtree),
                    models.Project.meta_group_id == folder.meta_group_id,
                )
            )
        ).all()
    ]
    images = 0
    if project_ids:
        images = (
            await db.execute(
                select(func.count(models.DataInstance.id)).where(
                    models.DataInstance.project_id.in_(project_ids)
                )
            )
        ).scalar_one()
    return folder_schemas.FolderDeletePreview(
        folder_id=folder.id,
        name=folder.name,
        folders=len(subtree),
        projects=len(project_ids),
        images=int(images),
        confirmation_phrase=delete_confirmation_phrase(folder),
    )


async def delete_folder(
    db: AsyncSession,
    folder: models.DashboardFolder,
    confirmation_phrase: str,
    *,
    user_email: str,
) -> tuple[folder_schemas.FolderDeleteResponse, list[uuid.UUID]]:
    """Delete a folder, every subfolder, and every project below it.

    Returns the response and the deleted project IDs (for cache invalidation).
    """
    if await locks.is_folder_or_ancestor_archived(db, folder.parent_id):
        raise ForbiddenError(
            "This folder is inside an archived folder. Delete or unarchive the "
            "archived folder instead."
        )
    expected = delete_confirmation_phrase(folder)
    if confirmation_phrase != expected:
        raise ValidationFailedError(
            f"Confirmation phrase mismatch. Expected '{expected}'."
        )
    index = await locks.load_folder_index(db, [folder.meta_group_id])
    subtree = index.subtree(folder.id)
    projects = list(
        (
            await db.execute(
                select(models.Project).where(
                    models.Project.folder_id.in_(subtree),
                    models.Project.meta_group_id == folder.meta_group_id,
                )
            )
        )
        .scalars()
        .all()
    )
    project_ids = [p.id for p in projects]
    for project in projects:
        await db.delete(project)
    # Defensive: a project of another access group must never be deleted
    # through this folder; detach any such (invalid) link to its own root.
    await db.execute(
        update(models.Project)
        .where(
            models.Project.folder_id.in_(subtree),
            models.Project.meta_group_id != folder.meta_group_id,
        )
        .values(folder_id=None)
        .execution_options(synchronize_session=False)
    )
    await db.flush()
    # Children first so the self-referencing FK never blocks (SQLite has no
    # cascade unless foreign keys are enabled).
    depth_order = sorted(subtree, key=lambda fid: -index.depth(fid))
    for fid in depth_order:
        await db.delete(index.folders[fid])
        await db.flush()
    await _touch_folders(db, folder.parent_id)
    await db.commit()
    for pid in project_ids:
        log_db_operation(
            "DELETE",
            "projects",
            pid,
            user_email,
            {"via_folder_delete": str(folder.id)},
        )
    log_db_operation(
        "DELETE",
        "dashboard_folders",
        folder.id,
        user_email,
        {"folders": len(subtree), "projects": len(project_ids)},
    )
    return folder_schemas.FolderDeleteResponse(
        folder_id=folder.id,
        folders_deleted=len(subtree),
        projects_deleted=len(project_ids),
    ), project_ids


# --- Listing and search ---------------------------------------------------


def _like_pattern(query: str) -> str:
    folded = models.search_fold(query)
    escaped = folded.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def list_items(
    db: AsyncSession,
    *,
    meta_group_id: str,
    folder_id: uuid.UUID | None,
    query: str | None,
    recursive: bool,
    include_archived: bool,
    project_type: str | None,
    created_by: str | None,
    archived_filter: str | None,
    sort: str,
    order: str,
    offset: int,
    limit: int,
    ids: list[uuid.UUID] | None = None,
) -> folder_schemas.DashboardItems:
    """Folders and projects at a location, or search results below it.

    A non-empty ``query`` searches every folder and project below
    ``folder_id`` (the whole access group at the root) by keyword.
    ``project_type`` and ``created_by`` filter projects only; folders are
    never hidden by them.
    """
    index = await locks.load_folder_index(db, [meta_group_id])
    if folder_id is not None and folder_id not in index.folders:
        raise NotFoundError("Folder not found")
    locked = index.effectively_archived()
    q = (query or "").strip()
    searching = bool(q)
    recursive = recursive or searching

    if folder_id is None:
        scope_folders = set(index.folders) if recursive else None
    else:
        scope_folders = set(index.descendants(folder_id)) if recursive else None

    # --- Folders
    folder_ids: list[uuid.UUID]
    if ids is not None:
        folder_ids = []
    elif recursive:
        folder_ids = list(scope_folders or [])
    else:
        folder_ids = list(index.children.get(folder_id, []))
    if not include_archived or archived_filter == "active":
        folder_ids = [f for f in folder_ids if f not in locked]
    elif archived_filter == "archived":
        folder_ids = [f for f in folder_ids if f in locked]
    if searching:
        needle = models.search_fold(q)
        folder_ids = [
            f
            for f in folder_ids
            if needle
            in models.search_fold(index.folders[f].name, index.folders[f].description)
        ]
    # Type and creator filters narrow projects only: folders stay visible so
    # they can be opened, and the projects inside them are filtered.
    stats = await _project_stats(db, meta_group_id, include_archived=include_archived)
    folders = _sort_folders(
        serialize_folders(index, folder_ids, stats, include_archived=include_archived)
    )

    # --- Projects
    pq = select(models.Project).where(models.Project.meta_group_id == meta_group_id)
    if ids is not None:
        pq = pq.where(models.Project.id.in_(ids))
    elif recursive:
        if folder_id is not None:
            pq = pq.where(models.Project.folder_id.in_([folder_id, *scope_folders]))
    else:
        pq = pq.where(
            models.Project.folder_id.is_(None)
            if folder_id is None
            else models.Project.folder_id == folder_id
        )
    hidden = list(locked)

    def _archived_expr():
        cond = models.Project.is_archived.is_(True)
        if hidden:
            # folder_id IS NOT NULL keeps the expression two-valued: for root
            # projects "NULL IN (...)" is NULL, and NOT NULL would drop them.
            cond = or_(
                cond,
                and_(
                    models.Project.folder_id.is_not(None),
                    models.Project.folder_id.in_(hidden),
                ),
            )
        return cond

    if not include_archived or archived_filter == "active":
        pq = pq.where(~_archived_expr())
    elif archived_filter == "archived":
        pq = pq.where(_archived_expr())
    if searching:
        pattern = _like_pattern(q)
        pq = pq.where(models.Project.search_text.like(pattern, escape="\\"))
    if project_type:
        pq = pq.where(models.Project.project_type == project_type.strip().upper())
    if created_by:
        pq = pq.where(
            func.lower(models.Project.created_by) == created_by.strip().lower()
        )

    total = (
        await db.execute(select(func.count()).select_from(pq.subquery()))
    ).scalar_one()
    column = SORT_FIELDS.get(sort, models.Project.last_activity_at)
    direction = column.asc() if order == "asc" else column.desc()
    pq = pq.order_by(direction.nulls_last(), models.Project.name, models.Project.id)
    limit = max(1, min(limit, MAX_PAGE))
    pq = pq.offset(max(offset, 0)).limit(limit)
    page = list((await db.execute(pq)).scalars().all())
    projects = await decorate_projects(db, page, index=index)

    current = None
    if folder_id is not None:
        current = serialize_folders(
            index, [folder_id], stats, include_archived=folder_id in locked or include_archived
        )[0]
    return folder_schemas.DashboardItems(
        meta_group_id=meta_group_id,
        folder_id=folder_id,
        current_folder=current,
        query=q or None,
        recursive=recursive,
        folders=folders,
        projects=projects,
        total_folders=len(folders),
        total_projects=int(total),
        offset=max(offset, 0),
        limit=limit,
    )
