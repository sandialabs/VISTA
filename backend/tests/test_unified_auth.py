"""
Tests for the unified authentication system introduced by the unified-auth branch.

Covers:
- API key authentication flow (valid key, invalid key, deactivated key)
- require_proxy_user rejecting Bearer tokens on sensitive endpoints
- Production mode proxy header validation
- Auth method tracking on request.state
- Log injection sanitization in crud._sanitize_log_value
- Error message consistency
"""

import uuid
import pytest
from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from fastapi.security import HTTPAuthorizationCredentials

from utils.dependencies import (
    get_current_user,
    require_proxy_user,
    verify_api_key,
    hash_api_key,
    generate_api_key,
)
from utils.crud import _sanitize_log_value, log_db_operation
from core.config import settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_request(headers=None):
    """Build a minimal mock Request."""
    request = Mock()
    request.state = SimpleNamespace()
    request.headers = MagicMock()
    request.headers.items.return_value = list((headers or {}).items())
    return request


def _make_db_user(email="test@example.com", user_id=None):
    """Build a mock database user row."""
    m = Mock()
    m.id = user_id or uuid.uuid4()
    m.email = email
    m.username = None
    m.is_active = True
    m.created_at = None
    m.updated_at = None
    return m


def _make_api_key_record(user, key_hash, active=True):
    """Build a mock API key record with nested user."""
    rec = Mock()
    rec.id = uuid.uuid4()
    rec.key_hash = key_hash
    rec.is_active = active
    rec.user = user
    return rec


# ---------------------------------------------------------------------------
# API key authentication flow
# ---------------------------------------------------------------------------

class TestApiKeyAuth:
    """Test Bearer-token (API key) authentication through get_current_user."""

    @pytest.mark.asyncio
    async def test_valid_api_key_resolves_user(self):
        """A valid Bearer token returns the associated user."""
        raw_key = generate_api_key()
        key_hash = hash_api_key(raw_key)
        db_user = _make_db_user("apiuser@example.com")
        api_key_record = _make_api_key_record(db_user, key_hash)

        request = _make_request()
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=raw_key)
        mock_db = AsyncMock()

        with patch("utils.dependencies.crud") as mock_crud:
            mock_crud.get_all_active_api_keys = AsyncMock(return_value=[api_key_record])
            mock_crud.update_api_key_last_used = AsyncMock()
            user = await get_current_user(request, mock_db, credentials=creds)

        assert user.email == "apiuser@example.com"
        assert request.state.auth_method == "api_key"
        mock_crud.update_api_key_last_used.assert_called_once_with(mock_db, api_key_record.id)

    @pytest.mark.asyncio
    async def test_invalid_api_key_raises_401(self):
        """A Bearer token that matches no active key returns 401."""
        request = _make_request()
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bogus-key")
        mock_db = AsyncMock()

        with patch("utils.dependencies.crud") as mock_crud:
            mock_crud.get_all_active_api_keys = AsyncMock(return_value=[])
            with pytest.raises(Exception) as exc_info:
                await get_current_user(request, mock_db, credentials=creds)
            assert exc_info.value.status_code == 401
            assert "Invalid API key" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_wrong_key_among_many_raises_401(self):
        """When keys exist but none match, 401 is returned."""
        real_key = generate_api_key()
        real_hash = hash_api_key(real_key)
        db_user = _make_db_user()
        record = _make_api_key_record(db_user, real_hash)

        request = _make_request()
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrong-key")
        mock_db = AsyncMock()

        with patch("utils.dependencies.crud") as mock_crud:
            mock_crud.get_all_active_api_keys = AsyncMock(return_value=[record])
            with pytest.raises(Exception) as exc_info:
                await get_current_user(request, mock_db, credentials=creds)
            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_api_key_takes_priority_over_headers(self):
        """Bearer token is checked before proxy/debug headers."""
        raw_key = generate_api_key()
        key_hash = hash_api_key(raw_key)
        db_user = _make_db_user("apiuser@example.com")
        record = _make_api_key_record(db_user, key_hash)

        request = _make_request({"x-user-email": "proxy@example.com"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=raw_key)
        mock_db = AsyncMock()

        with patch("utils.dependencies.crud") as mock_crud:
            mock_crud.get_all_active_api_keys = AsyncMock(return_value=[record])
            mock_crud.update_api_key_last_used = AsyncMock()
            user = await get_current_user(request, mock_db, credentials=creds)

        assert user.email == "apiuser@example.com"
        assert request.state.auth_method == "api_key"


# ---------------------------------------------------------------------------
# require_proxy_user blocks API keys on sensitive endpoints
# ---------------------------------------------------------------------------

class TestRequireProxyUser:
    """Sensitive endpoints reject API key auth via require_proxy_user."""

    @pytest.mark.asyncio
    async def test_bearer_token_rejected_with_403(self):
        """Any Bearer token is rejected with 403."""
        request = _make_request()
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="any-key")
        mock_db = AsyncMock()

        with pytest.raises(Exception) as exc_info:
            await require_proxy_user(request, mock_db, credentials=creds)
        assert exc_info.value.status_code == 403
        assert "proxy authentication" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_proxy_user_allowed_without_bearer(self):
        """Without Bearer token, require_proxy_user falls through to get_current_user."""
        request = _make_request({"x-user-email": "admin@example.com"})
        mock_db = AsyncMock()
        db_user = _make_db_user("admin@example.com")

        with patch("utils.dependencies.settings") as mock_settings:
            mock_settings.DEBUG = True
            mock_settings.SKIP_HEADER_CHECK = False
            mock_settings.MOCK_USER_EMAIL = "mock@example.com"
            mock_settings.X_USER_ID_HEADER = "X-User-Email"
            with patch("utils.dependencies.crud") as mock_crud:
                mock_crud.get_user_by_email = AsyncMock(return_value=db_user)
                user = await require_proxy_user(request, mock_db, credentials=None)

        assert user.email == "admin@example.com"

    def test_api_key_create_rejected_with_bearer(self, client):
        """POST /api/api-keys with Bearer token returns 403."""
        resp = client.post(
            "/api/api-keys",
            json={"name": "sneaky-key"},
            headers={"Authorization": "Bearer some-api-key"},
        )
        assert resp.status_code == 403

    def test_api_key_list_rejected_with_bearer(self, client):
        """GET /api/api-keys with Bearer token returns 403."""
        resp = client.get(
            "/api/api-keys",
            headers={"Authorization": "Bearer some-api-key"},
        )
        assert resp.status_code == 403

    def test_api_key_delete_rejected_with_bearer(self, client):
        """DELETE /api/api-keys/{id} with Bearer token returns 403."""
        fake_id = str(uuid.uuid4())
        resp = client.delete(
            f"/api/api-keys/{fake_id}",
            headers={"Authorization": "Bearer some-api-key"},
        )
        assert resp.status_code == 403

    def test_user_create_rejected_with_bearer(self, client):
        """POST /api/users/ with Bearer token returns 403."""
        resp = client.post(
            "/api/users/",
            json={"email": "new@example.com"},
            headers={"Authorization": "Bearer some-api-key"},
        )
        assert resp.status_code == 403

    def test_user_read_rejected_with_bearer(self, client):
        """GET /api/users/{id} with Bearer token returns 403."""
        fake_id = str(uuid.uuid4())
        resp = client.get(
            f"/api/users/{fake_id}",
            headers={"Authorization": "Bearer some-api-key"},
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Production mode proxy header validation
# ---------------------------------------------------------------------------

class TestProductionProxyAuth:
    """Test proxy header auth in production mode (DEBUG=false)."""

    @pytest.mark.asyncio
    async def test_missing_proxy_secret_rejects(self):
        """No X-Proxy-Secret header in production mode returns 401."""
        request = _make_request({"x-user-email": "user@example.com"})
        mock_db = AsyncMock()

        with patch("utils.dependencies.settings") as s:
            s.DEBUG = False
            s.SKIP_HEADER_CHECK = False
            s.PROXY_SHARED_SECRET = "real-secret"
            s.X_PROXY_SECRET_HEADER = "X-Proxy-Secret"
            s.X_USER_ID_HEADER = "X-User-Email"
            with pytest.raises(Exception) as exc_info:
                await get_current_user(request, mock_db, credentials=None)
            assert exc_info.value.status_code == 401
            assert "proxy" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_wrong_proxy_secret_rejects(self):
        """Wrong X-Proxy-Secret in production mode returns 401."""
        request = _make_request({
            "x-user-email": "user@example.com",
            "x-proxy-secret": "wrong-secret",
        })
        mock_db = AsyncMock()

        with patch("utils.dependencies.settings") as s:
            s.DEBUG = False
            s.SKIP_HEADER_CHECK = False
            s.PROXY_SHARED_SECRET = "real-secret"
            s.X_PROXY_SECRET_HEADER = "X-Proxy-Secret"
            s.X_USER_ID_HEADER = "X-User-Email"
            with pytest.raises(Exception) as exc_info:
                await get_current_user(request, mock_db, credentials=None)
            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_proxy_headers_succeed(self):
        """Correct proxy secret + valid email resolves user."""
        request = _make_request({
            "x-user-email": "user@example.com",
            "x-proxy-secret": "real-secret",
        })
        mock_db = AsyncMock()
        db_user = _make_db_user("user@example.com")

        with patch("utils.dependencies.settings") as s:
            s.DEBUG = False
            s.SKIP_HEADER_CHECK = False
            s.PROXY_SHARED_SECRET = "real-secret"
            s.X_PROXY_SECRET_HEADER = "X-Proxy-Secret"
            s.X_USER_ID_HEADER = "X-User-Email"
            with patch("utils.dependencies.crud") as mock_crud:
                mock_crud.get_user_by_email = AsyncMock(return_value=db_user)
                user = await get_current_user(request, mock_db, credentials=None)

        assert user.email == "user@example.com"
        assert request.state.auth_method == "proxy"

    @pytest.mark.asyncio
    async def test_missing_email_header_rejects(self):
        """Valid proxy secret but no email header returns 401."""
        request = _make_request({"x-proxy-secret": "real-secret"})
        mock_db = AsyncMock()

        with patch("utils.dependencies.settings") as s:
            s.DEBUG = False
            s.SKIP_HEADER_CHECK = False
            s.PROXY_SHARED_SECRET = "real-secret"
            s.X_PROXY_SECRET_HEADER = "X-Proxy-Secret"
            s.X_USER_ID_HEADER = "X-User-Email"
            with pytest.raises(Exception) as exc_info:
                await get_current_user(request, mock_db, credentials=None)
            assert exc_info.value.status_code == 401
            assert "Authentication required" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Auth method tracking
# ---------------------------------------------------------------------------

class TestAuthMethodTracking:
    """Verify request.state.auth_method is set correctly."""

    @pytest.mark.asyncio
    async def test_debug_mode_sets_debug(self):
        """Debug/test mode sets auth_method = 'debug'."""
        request = _make_request()
        mock_db = AsyncMock()
        db_user = _make_db_user("mock@example.com")

        with patch("utils.dependencies.settings") as s:
            s.DEBUG = True
            s.SKIP_HEADER_CHECK = False
            s.MOCK_USER_EMAIL = "mock@example.com"
            s.X_USER_ID_HEADER = "X-User-Email"
            with patch("utils.dependencies.crud") as mock_crud:
                mock_crud.get_user_by_email = AsyncMock(return_value=db_user)
                await get_current_user(request, mock_db, credentials=None)

        assert request.state.auth_method == "debug"

    @pytest.mark.asyncio
    async def test_api_key_sets_api_key(self):
        """Valid API key sets auth_method = 'api_key'."""
        raw_key = generate_api_key()
        key_hash = hash_api_key(raw_key)
        db_user = _make_db_user()
        record = _make_api_key_record(db_user, key_hash)

        request = _make_request()
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=raw_key)
        mock_db = AsyncMock()

        with patch("utils.dependencies.crud") as mock_crud:
            mock_crud.get_all_active_api_keys = AsyncMock(return_value=[record])
            mock_crud.update_api_key_last_used = AsyncMock()
            await get_current_user(request, mock_db, credentials=creds)

        assert request.state.auth_method == "api_key"


# ---------------------------------------------------------------------------
# Log injection sanitization
# ---------------------------------------------------------------------------

class TestLogSanitization:
    """Test _sanitize_log_value prevents log forging."""

    def test_strips_newlines_from_strings(self):
        assert _sanitize_log_value("clean") == "clean"
        assert _sanitize_log_value("line1\nline2") == "line1line2"
        assert _sanitize_log_value("line1\r\nline2") == "line1line2"
        assert _sanitize_log_value("\rstart") == "start"

    def test_sanitizes_nested_dicts(self):
        data = {"name": "evil\ninjection", "safe": 42}
        result = _sanitize_log_value(data)
        assert result == {"name": "evilinjection", "safe": 42}

    def test_sanitizes_nested_lists(self):
        data = ["ok", "bad\nvalue", 123]
        result = _sanitize_log_value(data)
        assert result == ["ok", "badvalue", 123]

    def test_sanitizes_deeply_nested(self):
        data = {"outer": {"inner": ["a\nb", {"deep": "c\rd"}]}}
        result = _sanitize_log_value(data)
        assert result == {"outer": {"inner": ["ab", {"deep": "cd"}]}}

    def test_passthrough_non_strings(self):
        assert _sanitize_log_value(42) == 42
        assert _sanitize_log_value(None) is None
        assert _sanitize_log_value(True) is True

    def test_log_db_operation_sanitizes_additional_info(self):
        """log_db_operation passes additional_info through sanitization."""
        record_id = uuid.uuid4()
        with patch("utils.crud._common.logger") as mock_logger:
            log_db_operation(
                "CREATE", "api_keys", record_id,
                "user@example.com",
                {"name": "my-key\nINJECTED_LINE", "user_id": "abc"},
            )
            call_kwargs = mock_logger.info.call_args
            extra = call_kwargs.kwargs.get("extra") or call_kwargs[1].get("extra")
            assert "\n" not in str(extra["additional_info"])
            assert extra["additional_info"]["name"] == "my-keyINJECTED_LINE"


# ---------------------------------------------------------------------------
# API key verify / hash edge cases
# ---------------------------------------------------------------------------

class TestApiKeyHashing:
    """Edge cases for API key hashing and verification."""

    def test_correct_key_verifies(self):
        raw = generate_api_key()
        hashed = hash_api_key(raw)
        assert verify_api_key(raw, hashed) is True

    def test_wrong_key_fails(self):
        raw = generate_api_key()
        hashed = hash_api_key(raw)
        assert verify_api_key("wrong-key", hashed) is False

    def test_corrupted_hash_fails(self):
        raw = generate_api_key()
        assert verify_api_key(raw, "not-a-valid-hex-hash") is False

    def test_empty_hash_fails(self):
        assert verify_api_key("some-key", "") is False

    def test_each_key_produces_unique_hash(self):
        k1 = generate_api_key()
        k2 = generate_api_key()
        h1 = hash_api_key(k1)
        h2 = hash_api_key(k2)
        assert h1 != h2

    def test_same_key_different_salts(self):
        """Hashing the same key twice produces different hashes (random salt)."""
        raw = generate_api_key()
        h1 = hash_api_key(raw)
        h2 = hash_api_key(raw)
        assert h1 != h2
        assert verify_api_key(raw, h1) is True
        assert verify_api_key(raw, h2) is True


# ---------------------------------------------------------------------------
# Integration: /api/me endpoint with different auth modes
# ---------------------------------------------------------------------------

class TestMeEndpoint:
    """Integration tests for GET /api/users/me."""

    def test_me_returns_user_in_debug_mode(self, client):
        """GET /api/users/me returns the mock user in debug mode."""
        resp = client.get("/api/users/me")
        assert resp.status_code == 200
        data = resp.json()
        assert "email" in data

    def test_me_with_custom_header(self, client):
        """GET /api/users/me with X-User-Email returns that user."""
        resp = client.get(
            "/api/users/me",
            headers={"X-User-Email": "custom@example.com"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "custom@example.com"

    def test_me_with_invalid_bearer_returns_401(self, client):
        """GET /api/users/me with bad Bearer token returns 401."""
        resp = client.get(
            "/api/users/me",
            headers={"Authorization": "Bearer invalid-key-abc123"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Integration: end-to-end API key auth via /api/users/me
# ---------------------------------------------------------------------------

class TestApiKeyEndToEnd:
    """Create an API key via proxy auth, then use it as Bearer token."""

    def test_api_key_authenticates_to_me_endpoint(self, client):
        """Full flow: create key, then use it to call /api/users/me."""
        # Step 1: create key (proxy auth in debug mode)
        create_resp = client.post("/api/api-keys", json={"name": "e2e-key"})
        assert create_resp.status_code == 201
        raw_key = create_resp.json()["key"]

        # Step 2: use Bearer token to call /api/users/me
        me_resp = client.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {raw_key}"},
        )
        assert me_resp.status_code == 200
        assert "email" in me_resp.json()

    def test_deactivated_key_rejected(self, client):
        """After deactivating a key, it can no longer authenticate."""
        # Create
        create_resp = client.post("/api/api-keys", json={"name": "temp-key"})
        assert create_resp.status_code == 201
        raw_key = create_resp.json()["key"]
        key_id = create_resp.json()["api_key"]["id"]

        # Deactivate
        del_resp = client.delete(f"/api/api-keys/{key_id}")
        assert del_resp.status_code == 204

        # Attempt use
        me_resp = client.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {raw_key}"},
        )
        assert me_resp.status_code == 401
