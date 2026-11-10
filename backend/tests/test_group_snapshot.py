"""Tests for proxy-asserted group membership (VISTA_AUTH_BACKEND=custom)."""

import asyncio
import threading

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.requests import Request

from core import group_auth, group_auth_helper, group_snapshot, models
from core.config import settings
from schemas import users as user_schemas
from utils import dependencies

SECRET = "test-proxy-secret"  # pragma: allowlist secret


@pytest.fixture(autouse=True)
def custom_backend(monkeypatch):
    monkeypatch.setattr(settings, "VISTA_AUTH_BACKEND", "custom")
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SKIP_HEADER_CHECK", False)
    monkeypatch.setattr(settings, "PROXY_SHARED_SECRET", SECRET)
    group_snapshot._entries.clear()
    group_snapshot._quiet_until.clear()
    yield
    group_snapshot._entries.clear()


def run(coro):
    return asyncio.run(coro)


def member(email, group):
    return group_auth_helper.is_user_in_group(email, group)


def test_parse_groups_header():
    assert group_auth.parse_groups_header(["a, b", "c", " ,", ""]) == {"a", "b", "c"}
    assert group_auth.parse_groups_header(None) == frozenset()


def test_nothing_recorded_is_not_a_member():
    assert member("alice@example.com", "g") is False
    group_auth.run_auth_startup_self_test()
    for email in group_auth._DEMO_EMAILS:
        assert member(email, "admin") is False


def test_records_are_per_user_and_normalised():
    run(group_snapshot.record("Alice@Example.com ", ["g1"]))
    assert member("alice@example.com", "g1")
    assert not member("alice@example.com", "g2")
    assert not member("bob@example.com", "g1")


def test_each_assertion_replaces_the_last_and_empty_revokes():
    run(group_snapshot.record("alice@example.com", ["g1"]))
    run(group_snapshot.record("alice@example.com", ["g2"]))
    assert member("alice@example.com", "g2") and not member("alice@example.com", "g1")
    run(group_snapshot.record("alice@example.com", []))
    assert not member("alice@example.com", "g2")


def test_membership_does_not_depend_on_the_calling_context():
    run(group_snapshot.record("alice@example.com", ["g1"]))
    seen = {}
    t = threading.Thread(
        target=lambda: seen.update(v=member("alice@example.com", "g1"))
    )
    t.start()
    t.join()
    assert seen["v"] is True
    assert run(asyncio.to_thread(member, "alice@example.com", "g1")) is True


def test_ttl_counts_from_the_last_assertion():
    ttl = settings.GROUPS_SNAPSHOT_TTL_SECONDS
    assert ttl == 7 * 24 * 3600
    run(group_snapshot.record("alice@example.com", ["g"], now=1000.0))
    assert group_snapshot.is_member("alice@example.com", "g", now=1000.0 + ttl)
    assert not group_snapshot.is_member("alice@example.com", "g", now=1000.0 + ttl + 1)
    run(group_snapshot.record("alice@example.com", ["g"], now=1000.0 + ttl))
    assert group_snapshot.is_member("alice@example.com", "g", now=1000.0 + ttl + 1)


def test_concurrent_assertions_stay_apart():
    async def both():
        await asyncio.gather(
            group_snapshot.record("alice@example.com", ["a"]),
            group_snapshot.record("bob@example.com", ["b"]),
        )

    run(both())
    assert member("alice@example.com", "a") and not member("alice@example.com", "b")
    assert member("bob@example.com", "b") and not member("bob@example.com", "a")


def _request(headers):
    raw = [(k.lower().encode(), v.encode()) for k, v in headers]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": raw,
            "query_string": b"",
        }
    )


def _resolve(monkeypatch, headers, credentials=None):
    async def fake_ensure(email, db):
        return email

    async def fake_api_key(creds, db):
        return "key-owner@example.com" if creds.credentials == "good" else None

    monkeypatch.setattr(dependencies, "_ensure_user_in_db", fake_ensure)
    monkeypatch.setattr(dependencies, "_resolve_from_api_key", fake_api_key)

    async def go():
        try:
            return await dependencies.get_current_user(
                _request(headers), object(), credentials
            )
        except Exception as exc:  # HTTPException
            return exc

    return run(go())


def test_proxy_request_records_groups_only_with_the_secret(monkeypatch):
    ok = [("X-User-Email", "carol@example.com"), ("X-Proxy-Secret", SECRET)]
    got = _resolve(monkeypatch, ok + [("X-Forwarded-Groups", "g1,g2")])
    assert got == "carol@example.com"
    assert member("carol@example.com", "g1") and member("carol@example.com", "g2")
    _resolve(
        monkeypatch, ok + [("X-Forwarded-Groups", "g1"), ("X-Forwarded-Groups", "g3")]
    )
    assert member("carol@example.com", "g3") and not member("carol@example.com", "g2")

    bad = [("X-User-Email", "carol@example.com"), ("X-Proxy-Secret", "wrong")]
    refused = _resolve(monkeypatch, bad + [("X-Forwarded-Groups", "admin")])
    assert getattr(refused, "status_code", None) == 401
    assert not member("carol@example.com", "admin")
    assert member("carol@example.com", "g3"), "a refused request changes nothing"


def test_missing_groups_header_asserts_no_groups(monkeypatch):
    ok = [("X-User-Email", "carol@example.com"), ("X-Proxy-Secret", SECRET)]
    _resolve(monkeypatch, ok + [("X-Forwarded-Groups", "g1")])
    _resolve(monkeypatch, ok)
    assert not member("carol@example.com", "g1")


def test_api_key_request_uses_owners_last_groups_and_changes_nothing(monkeypatch):
    run(group_snapshot.record("key-owner@example.com", ["pipeline"]))
    bearer = HTTPAuthorizationCredentials(scheme="Bearer", credentials="good")
    assert _resolve(monkeypatch, [], bearer) == "key-owner@example.com"
    assert member("key-owner@example.com", "pipeline")
    assert not member("key-owner@example.com", "admin")


def test_custom_without_proxy_secret_refuses_to_start(monkeypatch):
    monkeypatch.setattr(settings, "PROXY_SHARED_SECRET", None)
    with pytest.raises(RuntimeError, match="PROXY_SHARED_SECRET"):
        group_auth.run_auth_startup_self_test()
    monkeypatch.setattr(settings, "DEBUG", True)
    group_auth.run_auth_startup_self_test()


@pytest.fixture
def table(tmp_path, monkeypatch):
    """Provide a throwaway SQLite table for PostgreSQL, with persistence on."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'snap.db'}")

    async def create():
        async with engine.begin() as conn:
            await conn.run_sync(models.UserGroupSnapshot.__table__.create)

    run(create())
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(group_snapshot, "_session_factory", lambda: factory())
    monkeypatch.setattr(settings, "FAST_TEST_MODE", False)
    yield factory
    run(engine.dispose())


async def _count(factory):
    async with factory() as s:
        stmt = select(func.count()).select_from(models.UserGroupSnapshot)
        return (await s.execute(stmt)).scalar_one()


def test_table_replace_reload_and_rewrite_window(table):
    async def go():
        await group_snapshot.record("dave@example.com", ["g1", "g2"], now=5000.0)
        assert await _count(table) == 2
        await group_snapshot.record("dave@example.com", ["g2", "g3"], now=5010.0)
        assert await _count(table) == 2

        group_snapshot._entries.clear()  # another replica, or a restart
        assert await group_snapshot.load(now=5011.0) == 1
        assert group_snapshot.is_member("dave@example.com", "g3", now=5011.0)
        assert not group_snapshot.is_member("dave@example.com", "g1", now=5011.0)

        entry = group_snapshot._entries["dave@example.com"]
        await group_snapshot.record("dave@example.com", ["g2", "g3"], now=5100.0)
        assert entry.persisted_at == 5010.0  # unchanged, inside the window
        await group_snapshot.record("dave@example.com", ["g2", "g3"], now=5400.0)
        assert group_snapshot._entries["dave@example.com"].persisted_at == 5400.0

    run(go())


def test_table_reload_keeps_newer_local_and_drops_revoked(table):
    async def go():
        await group_snapshot.record("dave@example.com", ["g1"], now=5000.0)
        group_snapshot._entries["dave@example.com"] = group_snapshot._Entry(
            frozenset({"g9"}), 6000.0, 0.0
        )  # newer, not in the table yet
        await group_snapshot.load(now=6001.0)
        assert group_snapshot.is_member("dave@example.com", "g9", now=6001.0)

        group_snapshot._entries["dave@example.com"].persisted_at = 5999.0
        async with table() as s, s.begin():
            await s.execute(models.UserGroupSnapshot.__table__.delete())
        await group_snapshot.load(now=6002.0)  # revoked elsewhere
        assert not group_snapshot.is_member("dave@example.com", "g9", now=6002.0)

    run(go())


def test_table_purges_expired_rows(table):
    async def go():
        await group_snapshot.record("erin@example.com", ["old"], now=7000.0)
        group_snapshot._entries.clear()
        later = 7000.0 + settings.GROUPS_SNAPSHOT_TTL_SECONDS + 1
        assert await group_snapshot.load(now=later) == 0
        assert await _count(table) == 0

    run(go())


def test_database_failure_does_not_fail_the_request(monkeypatch):
    def boom():
        raise RuntimeError("database down")

    monkeypatch.setattr(settings, "FAST_TEST_MODE", False)
    monkeypatch.setattr(group_snapshot, "_session_factory", boom)
    run(group_snapshot.record("frank@example.com", ["g1"]))
    assert member("frank@example.com", "g1")


def test_running_is_a_noop_under_fast_test_mode():
    async def go():
        async with group_snapshot.running():
            pass

    run(go())


def _user(email, key_groups=None):
    return user_schemas.User(email=email, key_groups=key_groups)


def test_key_with_own_groups_grants_exactly_those():
    run(group_snapshot.record("owner@example.com", ["owner-only"]))
    key_user = _user("owner@example.com", frozenset({"pipeline"}))
    assert group_auth_helper.is_user_in_group("owner@example.com", "pipeline", key_user)
    assert not group_auth_helper.is_user_in_group(
        "owner@example.com", "owner-only", key_user
    )
    # The same owner through the proxy still has their own recorded groups.
    assert member("owner@example.com", "owner-only")
    assert not member("owner@example.com", "pipeline")


def test_key_groups_do_not_expire_with_the_owners_record():
    ttl = settings.GROUPS_SNAPSHOT_TTL_SECONDS
    run(group_snapshot.record("owner@example.com", ["g"], now=1.0))
    assert not group_snapshot.is_member("owner@example.com", "g", now=ttl + 100)
    key_user = _user("owner@example.com", frozenset({"g"}))
    assert group_auth_helper.is_user_in_group("owner@example.com", "g", key_user)


def test_key_without_groups_falls_back_to_the_owners_record():
    run(group_snapshot.record("owner@example.com", ["g"]))
    legacy_key_user = _user("owner@example.com", None)
    assert group_auth_helper.is_user_in_group("owner@example.com", "g", legacy_key_user)


def test_key_with_an_empty_group_list_grants_nothing():
    run(group_snapshot.record("owner@example.com", ["g"]))
    key_user = _user("owner@example.com", frozenset())
    assert not group_auth_helper.is_user_in_group("owner@example.com", "g", key_user)


def test_key_groups_apply_to_their_own_user_only():
    run(group_snapshot.record("bob@example.com", ["bobs"]))
    key_user = _user("owner@example.com", frozenset({"pipeline"}))
    assert not group_auth_helper.is_user_in_group(
        "bob@example.com", "pipeline", key_user
    )
    assert group_auth_helper.is_user_in_group("bob@example.com", "bobs", key_user)


def test_key_groups_never_leave_the_server(monkeypatch):
    dumped = _user("owner@example.com", frozenset({"g"})).model_dump()
    assert "key_groups" not in dumped


def test_new_key_takes_the_creators_asserted_groups(monkeypatch):
    run(group_snapshot.record("owner@example.com", ["b", "a"]))
    assert group_snapshot.groups_for_new_key("Owner@Example.com") == ["a", "b"]
    assert group_snapshot.groups_for_new_key("nobody@example.com") == []
    monkeypatch.setattr(settings, "VISTA_AUTH_BACKEND", "demo")
    assert group_snapshot.groups_for_new_key("owner@example.com") is None


def test_api_key_request_carries_the_keys_groups(monkeypatch):
    class Owner:
        id = None
        email = "owner@example.com"
        username = None
        is_active = True
        created_at = None
        updated_at = None

    class Key:
        id = None
        key_hash = "h"
        user = Owner()
        groups = ["pipeline"]

    async def keys(db):
        return [Key()]

    async def touch(db, key_id):
        return None

    monkeypatch.setattr(
        dependencies.api_key_repository, "get_all_active_api_keys", keys
    )
    monkeypatch.setattr(
        dependencies.api_key_repository, "update_api_key_last_used", touch
    )
    monkeypatch.setattr(dependencies, "verify_api_key", lambda raw, hashed: True)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="k")
    user = run(dependencies._resolve_from_api_key(creds, object()))
    assert user.key_groups == frozenset({"pipeline"})
    Key.groups = None
    assert run(dependencies._resolve_from_api_key(creds, object())).key_groups is None
