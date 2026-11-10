"""The groups the authenticating proxy last asserted for each user.

Used by ``VISTA_AUTH_BACKEND=custom``. The proxy (oauth2-proxy) puts the signed-in
user's groups in a header on every request it forwards. ``utils.dependencies.
get_current_user`` records them here, after the request's X-Proxy-Secret matched,
and ``core.group_auth`` answers membership from what is recorded. Because the
answer depends on the user and not on the request, a request that carries no proxy
headers (an API key, the MCP server, a background task) gets its user's groups as
of the user's last proxy request, for ``GROUPS_SNAPSHOT_TTL_SECONDS``.

Each proxy request is a full assertion: it replaces the user's groups, and a
missing header means none. The table ``user_group_snapshots`` keeps them across
restarts and shares them between replicas; every process holds a copy in memory
(``is_member`` is synchronous and never touches the database) and reloads it every
``GROUPS_SNAPSHOT_REFRESH_SECONDS``. A write that fails is logged and the
in-memory record stands, so the request itself is never affected.
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import Iterable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone

from .config import settings

logger = logging.getLogger(__name__)

# An unchanged assertion rewrites its rows at most this often: the rows' age is
# what the other replicas measure the TTL from.
_REWRITE_SECONDS = 300
# One denial log line per user per this long, and one per kind of warning.
_QUIET_SECONDS = 600
_MAX_QUIET_ENTRIES = 10000


@dataclass
class _Entry:
    groups: frozenset[str]
    asserted_at: float
    persisted_at: float  # when the rows were last written; 0.0 = not in the table


_entries: dict[str, _Entry] = {}
_quiet_until: dict[str, float] = {}
_warned: set[str] = set()


def enabled() -> bool:
    return (settings.VISTA_AUTH_BACKEND or "").strip().lower() == "custom"


def _norm(email: str | None) -> str:
    return (email or "").lower().strip()


def _utc(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def _ts(value: datetime) -> float:
    if value.tzinfo is None:  # SQLite returns naive datetimes
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def _session_factory():
    from . import database  # looked up per call: the engine can be rebuilt

    return database.AsyncSessionLocal()


def _persist() -> bool:
    return not settings.FAST_TEST_MODE


def _log_denied(email: str, why: str, now: float) -> None:
    if _quiet_until.get(email, 0.0) > now:
        return
    if len(_quiet_until) >= _MAX_QUIET_ENTRIES:
        _quiet_until.clear()
    _quiet_until[email] = now + _QUIET_SECONDS
    logger.info(
        "No groups for user: %s. They get groups from a request through the proxy.",
        why,
        extra={"user": email.replace("\n", "").replace("\r", "")},
    )


def _warn_once(key: str, message: str, *args) -> None:
    if key not in _warned:
        _warned.add(key)
        logger.warning(message, *args)


def warn_no_groups_header(header: str) -> None:
    _warn_once(
        "no-groups-header",
        "A proxy request carried no %s header: its user has no groups. Check the "
        "front door passes the groups claim on (oauth2-proxy --pass-user-headers "
        "and the claim it reads).",
        header,
    )


def warn_unverified_proxy() -> None:
    _warn_once(
        "no-secret",
        "VISTA_AUTH_BACKEND=custom but PROXY_SHARED_SECRET is unset: proxy groups "
        "are not trusted, so none are recorded and nobody is a member of anything.",
    )


def is_member(email: str, group_id: str, now: float | None = None) -> bool:
    """True when the user's last proxy assertion, still within the TTL, has the group."""
    email = _norm(email)
    now = time.time() if now is None else now
    entry = _entries.get(email)
    if entry is None:
        _log_denied(email, "no groups recorded", now)
        return False
    if now - entry.asserted_at > settings.GROUPS_SNAPSHOT_TTL_SECONDS:
        _log_denied(email, "recorded groups expired", now)
        return False
    return group_id in entry.groups


def groups_for_new_key(email: str) -> list[str] | None:
    """The groups a new API key for this user should carry: their groups as just
    asserted by the proxy. None when the backend is not ``custom``."""
    if not enabled():
        return None
    entry = _entries.get(_norm(email))
    return sorted(entry.groups) if entry is not None else []


async def _write(email: str, groups: frozenset[str], now: float) -> None:
    from sqlalchemy import delete, insert

    from .models import UserGroupSnapshot as Row

    async with _session_factory() as session, session.begin():
        await session.execute(delete(Row).where(Row.email == email))
        if groups:
            await session.execute(
                insert(Row),
                [
                    {"email": email, "group_id": g, "asserted_at": _utc(now)}
                    for g in sorted(groups)
                ],
            )


async def record(email: str, groups: Iterable[str], now: float | None = None) -> None:
    """Record a proxy assertion: the user's groups are exactly these, as of now."""
    email = _norm(email)
    if not email:
        return
    groups = frozenset(groups)
    now = time.time() if now is None else now
    prev = _entries.get(email)
    if (
        prev is not None
        and prev.groups == groups
        and prev.persisted_at
        and now - prev.persisted_at < _REWRITE_SECONDS
    ):
        prev.asserted_at = now
        return
    entry = _Entry(groups, now, 0.0)
    _entries[email] = entry
    if not _persist():
        return
    try:
        await _write(email, groups, now)
        entry.persisted_at = now
    except Exception:
        logger.exception("Could not persist the groups recorded for a user")


async def load(now: float | None = None) -> int:
    """Reload the table into memory. Returns the number of users with groups."""
    from sqlalchemy import delete, select

    from .models import UserGroupSnapshot as Row

    now = time.time() if now is None else now
    ttl = settings.GROUPS_SNAPSHOT_TTL_SECONDS
    async with _session_factory() as session, session.begin():
        await session.execute(delete(Row).where(Row.asserted_at < _utc(now - ttl)))
        rows = (
            await session.execute(select(Row.email, Row.group_id, Row.asserted_at))
        ).all()

    stored: dict[str, tuple[set[str], float]] = {}
    for email, group_id, asserted_at in rows:
        groups, newest = stored.get(email, (set(), 0.0))
        groups.add(group_id)
        stored[email] = (groups, max(newest, _ts(asserted_at)))

    for email, (groups, ts) in stored.items():
        local = _entries.get(email)
        if local is not None and local.groups == groups:
            local.persisted_at = max(local.persisted_at, ts)
        elif local is None or local.asserted_at <= ts:
            _entries[email] = _Entry(frozenset(groups), ts, ts)
        # else: this process holds a newer assertion that is not in the table yet
    for email in list(_entries):
        entry = _entries[email]
        gone = email not in stored and entry.persisted_at > 0.0
        if gone or now - entry.asserted_at > ttl:
            del _entries[email]
    return len(stored)


async def refresh_loop() -> None:
    interval = max(5, settings.GROUPS_SNAPSHOT_REFRESH_SECONDS)
    while True:
        await asyncio.sleep(interval)
        try:
            await load()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Could not reload the recorded user groups")


@asynccontextmanager
async def running():
    """Load the table, then keep it fresh while the block runs. A no-op unless
    the backend is ``custom`` (and not under FAST_TEST_MODE, which has no database)."""
    task = None
    if enabled() and _persist():
        try:
            count = await load()
            logger.info("Loaded the recorded groups of %d users", count)
        except Exception:
            logger.exception("Could not load the recorded user groups")
        task = asyncio.create_task(refresh_loop())
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
