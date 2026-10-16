import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import ProgrammingError

import utils.dependencies as deps
from core.config import settings
from schemas.users import User

# Removed group header parsing tests since groups are now server-side only


def test_generate_and_hash_api_key():
    key1 = deps.generate_api_key()
    key2 = deps.generate_api_key()
    assert key1 != key2
    assert len(key1) >= 43  # token_urlsafe ~43 chars for 32 bytes
    h = deps.hash_api_key(key1)
    assert len(h) == 128  # PBKDF2: 64 chars salt + 64 chars hash
    assert h != key1


@pytest.mark.smoke
def test_server_side_auth_flow(client, monkeypatch):
    # Force production mode with server-side group lookup
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SKIP_HEADER_CHECK", False)
    monkeypatch.setattr(settings, "PROXY_SHARED_SECRET", "shh")

    # Minimal request that triggers get_current_user
    headers = {
        settings.X_PROXY_SECRET_HEADER: "shh",
        settings.X_USER_ID_HEADER: "proxyuser@example.com",
        # Groups header is ignored - groups looked up server-side
        "x-user-groups": '["grp1","grp2"]',
    }

    # Hitting projects list should succeed with auth via headers
    resp = client.get("/api/projects/", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_resolve_user_id_creates_user(db_session):
    # Given a pydantic user not yet in DB
    user = User(email="newuser@example.com")
    uid = await deps.resolve_user_id(user, db_session)
    assert isinstance(uid, uuid.UUID)
    # Resolving again returns same id
    uid2 = await deps.resolve_user_id(user, db_session)
    assert uid2 == uid


@pytest.mark.asyncio
async def test_ensure_user_in_db_returns_actionable_error_when_users_table_missing(
    db_session, monkeypatch
):
    async def _raise_missing_table(*args, **kwargs):
        raise ProgrammingError(
            "SELECT ... FROM users ...",
            {},
            Exception('relation "users" does not exist'),
        )

    monkeypatch.setattr(deps.user_repository, "get_user_by_email", _raise_missing_table)

    with pytest.raises(HTTPException) as exc_info:
        await deps._ensure_user_in_db("missing@example.com", db_session)

    assert exc_info.value.status_code == 503
    assert "Run 'alembic upgrade head'" in exc_info.value.detail
