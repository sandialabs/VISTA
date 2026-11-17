"""Archive locks for dashboard folders and projects.

A project or folder is *locked* (read-only) when it is archived itself or when
any ancestor folder is archived. Each row keeps its own ``is_archived`` flag;
the inherited part is always derived from the ancestor chain, so unarchiving a
parent restores exactly the state its descendants had before.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models

# Folders may nest at most this deep (root folder = depth 1).
MAX_FOLDER_DEPTH = 32


@dataclass(frozen=True)
class LockState:
    """Why (and whether) something is read-only."""

    own_archived: bool
    # Nearest archived ancestor folder, if any.
    locked_by_folder_id: uuid.UUID | None = None
    locked_by_folder_name: str | None = None

    @property
    def locked(self) -> bool:
        return self.own_archived or self.locked_by_folder_id is not None


async def folder_ancestors(
    db: AsyncSession, folder_id: uuid.UUID | None
) -> list[models.DashboardFolder]:
    """The folder and its ancestors, nearest first (empty for the root).

    Walks at most ``MAX_FOLDER_DEPTH + 1`` levels so a corrupted cycle cannot
    loop forever.
    """
    chain: list[models.DashboardFolder] = []
    seen: set[uuid.UUID] = set()
    current = folder_id
    while (
        current is not None and current not in seen and len(chain) <= MAX_FOLDER_DEPTH
    ):
        seen.add(current)
        # populate_existing: lock decisions must see committed state, not a
        # copy cached in this session earlier (another request may have
        # archived or moved the folder since).
        folder = await db.get(models.DashboardFolder, current, populate_existing=True)
        if folder is None:
            break
        chain.append(folder)
        current = folder.parent_id
    return chain


def _nearest_archived(
    chain: Iterable[models.DashboardFolder],
) -> models.DashboardFolder | None:
    for folder in chain:
        if folder.is_archived:
            return folder
    return None


async def project_lock_state(db: AsyncSession, project: models.Project) -> LockState:
    """Lock state of a project: its own archive flag plus its folder chain."""
    archived_folder = _nearest_archived(await folder_ancestors(db, project.folder_id))
    return LockState(
        own_archived=bool(project.is_archived),
        locked_by_folder_id=archived_folder.id if archived_folder else None,
        locked_by_folder_name=archived_folder.name if archived_folder else None,
    )


async def folder_lock_state(
    db: AsyncSession, folder: models.DashboardFolder
) -> LockState:
    """Lock state of a folder: its own flag plus its ancestors (not itself)."""
    archived_folder = _nearest_archived(await folder_ancestors(db, folder.parent_id))
    return LockState(
        own_archived=bool(folder.is_archived),
        locked_by_folder_id=archived_folder.id if archived_folder else None,
        locked_by_folder_name=archived_folder.name if archived_folder else None,
    )


async def is_folder_or_ancestor_archived(
    db: AsyncSession, folder_id: uuid.UUID | None
) -> bool:
    """True when the folder itself or any ancestor is archived (root: False)."""
    return _nearest_archived(await folder_ancestors(db, folder_id)) is not None


@dataclass
class FolderIndex:
    """All folders of some access groups, indexed for tree computations."""

    folders: dict[uuid.UUID, models.DashboardFolder]
    children: dict[uuid.UUID | None, list[uuid.UUID]]

    def descendants(self, folder_id: uuid.UUID) -> list[uuid.UUID]:
        """Every folder below ``folder_id`` (not including it)."""
        out: list[uuid.UUID] = []
        stack = list(self.children.get(folder_id, []))
        seen: set[uuid.UUID] = set()
        while stack:
            fid = stack.pop()
            if fid in seen:
                continue
            seen.add(fid)
            out.append(fid)
            stack.extend(self.children.get(fid, []))
        return out

    def subtree(self, folder_id: uuid.UUID) -> list[uuid.UUID]:
        return [folder_id, *self.descendants(folder_id)]

    def effectively_archived(self) -> set[uuid.UUID]:
        """Folders that are archived themselves or below an archived folder.

        Computed once per index (top-down walk, O(folders)).
        """
        cached = getattr(self, "_locked_cache", None)
        if cached is not None:
            return cached
        locked: set[uuid.UUID] = set()
        stack = [(fid, False) for fid in self.children.get(None, [])]
        seen: set[uuid.UUID] = set()
        while stack:
            fid, parent_locked = stack.pop()
            if fid in seen:
                continue
            seen.add(fid)
            is_locked = parent_locked or bool(self.folders[fid].is_archived)
            if is_locked:
                locked.add(fid)
            stack.extend((c, is_locked) for c in self.children.get(fid, []))
        self._locked_cache = locked
        return locked

    def nearest_archived_ancestor(
        self, folder_id: uuid.UUID | None
    ) -> uuid.UUID | None:
        """Nearest archived folder at or above ``folder_id``."""
        for folder in reversed(self.path(folder_id)):
            if folder.is_archived:
                return folder.id
        return None

    def postorder(self) -> list[uuid.UUID]:
        """Folders children-before-parents (for subtree aggregates)."""
        order: list[uuid.UUID] = []
        stack = [(fid, False) for fid in self.children.get(None, [])]
        seen: set[uuid.UUID] = set()
        while stack:
            fid, expanded = stack.pop()
            if expanded:
                order.append(fid)
                continue
            if fid in seen:
                continue
            seen.add(fid)
            stack.append((fid, True))
            stack.extend((c, False) for c in self.children.get(fid, []))
        return order

    def path(self, folder_id: uuid.UUID | None) -> list[models.DashboardFolder]:
        """Root-first path to ``folder_id`` (inclusive)."""
        chain: list[models.DashboardFolder] = []
        seen: set[uuid.UUID] = set()
        current = folder_id
        while current is not None and current in self.folders and current not in seen:
            seen.add(current)
            chain.append(self.folders[current])
            current = self.folders[current].parent_id
        return list(reversed(chain))

    def depth(self, folder_id: uuid.UUID | None) -> int:
        return len(self.path(folder_id))

    def subtree_height(self, folder_id: uuid.UUID) -> int:
        """Levels in the subtree rooted at ``folder_id`` (a leaf is 1)."""
        best = 1
        stack = [(folder_id, 1)]
        seen: set[uuid.UUID] = set()
        while stack:
            fid, level = stack.pop()
            if fid in seen:
                continue
            seen.add(fid)
            best = max(best, level)
            stack.extend((c, level + 1) for c in self.children.get(fid, []))
        return best


async def load_folder_index(
    db: AsyncSession, meta_group_ids: Iterable[str]
) -> FolderIndex:
    groups = [g for g in set(meta_group_ids) if g]
    folders: dict[uuid.UUID, models.DashboardFolder] = {}
    children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    if groups:
        rows = await db.execute(
            select(models.DashboardFolder)
            .where(models.DashboardFolder.meta_group_id.in_(groups))
            .execution_options(populate_existing=True)
        )
        for folder in rows.scalars().all():
            folders[folder.id] = folder
    for fid, folder in folders.items():
        parent = folder.parent_id if folder.parent_id in folders else None
        children.setdefault(parent, []).append(fid)
    return FolderIndex(folders=folders, children=children)


async def effectively_archived_folder_ids(
    db: AsyncSession, meta_group_ids: Iterable[str]
) -> set[uuid.UUID]:
    """Folder IDs in these groups that are archived or below an archived folder."""
    return (await load_folder_index(db, meta_group_ids)).effectively_archived()
