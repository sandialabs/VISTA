"""Project "last change" tracking.

``mark_project_activity(session, project_id)`` records that a project's data is
being changed in the current transaction. Just before it commits, one UPDATE
sets ``projects.last_activity_at`` for every recorded project inside the same
transaction; marks are cleared on commit and on rollback, so a write that rolls
back never bumps it.

The shared writable-access check (``utils.dependencies``) marks the project, so
every guarded write path counts without per-route code. Read paths that happen
to commit (self-healing repairs, default checkpoint seeding) and per-user UI
state do not pass that check and therefore do not count.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import event, update
from sqlalchemy.orm import Session

_INFO_KEY = "vista_touched_projects"


def _sync_session(session) -> Session:
    # AsyncSession wraps a sync Session; the hook is registered on the latter.
    return getattr(session, "sync_session", session)


def mark_project_activity(session, project_id: uuid.UUID | None) -> None:
    """Record that ``project_id`` changes in this session's next commit."""
    if project_id is None:
        return
    sync = _sync_session(session)
    sync.info.setdefault(_INFO_KEY, set()).add(project_id)


def pending_project_activity(session) -> set[uuid.UUID]:
    return set(_sync_session(session).info.get(_INFO_KEY, set()))


@event.listens_for(Session, "before_commit")
def _bump_last_activity(session: Session) -> None:
    touched = session.info.get(_INFO_KEY)
    if not touched:
        return
    from . import models

    now = datetime.now(UTC)
    session.execute(
        update(models.Project)
        .where(models.Project.id.in_(list(touched)))
        # Keep updated_at as is: it tracks edits to the project row itself.
        .values(last_activity_at=now, updated_at=models.Project.updated_at)
        .execution_options(synchronize_session=False)
    )
    # Keep identity-map copies in step so responses show the new time.
    for obj in list(session.identity_map.values()):
        if isinstance(obj, models.Project) and obj.id in touched:
            from sqlalchemy.orm.attributes import set_committed_value

            set_committed_value(obj, "last_activity_at", now)


@event.listens_for(Session, "after_commit")
def _clear_after_commit(session: Session) -> None:
    # Marks belong to one transaction: a later commit in the same session
    # (e.g. after a rolled-back write) must not bump these projects again.
    session.info.pop(_INFO_KEY, None)


@event.listens_for(Session, "after_rollback")
def _clear_after_rollback(session: Session) -> None:
    session.info.pop(_INFO_KEY, None)
