import os
import asyncio
import uuid
import pytest
from fastapi.testclient import TestClient

from core.config import settings
import utils.dependencies as deps
import utils.crud as crud
from core import schemas


# Removed group header parsing tests since groups are now server-side only


def test_generate_and_hash_api_key():
    key1 = deps.generate_api_key()
    key2 = deps.generate_api_key()
    assert key1 != key2
    assert len(key1) >= 43  # token_urlsafe ~43 chars for 32 bytes
    h = deps.hash_api_key(key1)
    assert len(h) == 128  # PBKDF2: 64 chars salt + 64 chars hash
    assert h != key1


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
    user = schemas.User(email="newuser@example.com")
    uid = await deps.resolve_user_id(user, db_session)
    assert isinstance(uid, uuid.UUID)
    # Resolving again returns same id
    uid2 = await deps.resolve_user_id(user, db_session)
    assert uid2 == uid
