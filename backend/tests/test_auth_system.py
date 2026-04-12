"""
Comprehensive tests for the unified authentication system.
Tests get_current_user dependency, group auth, and security functions.
"""

import pytest
from types import SimpleNamespace
from fastapi import Request
from fastapi.testclient import TestClient
from unittest.mock import Mock, AsyncMock, patch, MagicMock

from utils.dependencies import get_user_from_header, get_current_user
from core.group_auth import is_user_in_group as core_is_user_in_group
from core.group_auth_helper import (
    is_user_in_group,
    is_user_in_any_group,
    is_user_in_all_groups,
    get_user_groups,
    clear_cache,
    clear_user_cache,
    get_cache_stats
)
from core.config import settings


class TestUserHeaderExtraction:
    """Test user email extraction from headers."""

    def test_valid_email_extraction(self):
        assert get_user_from_header("test@example.com") == "test@example.com"
        assert get_user_from_header("  Test@Example.COM  ") == "test@example.com"
        assert get_user_from_header("user123+tag@domain.co.uk") == "user123+tag@domain.co.uk"

    def test_invalid_email_rejection(self):
        assert get_user_from_header("") is None
        assert get_user_from_header(None) is None
        assert get_user_from_header("invalid-email") is None
        assert get_user_from_header("@domain.com") is None
        assert get_user_from_header("user@") is None
        assert get_user_from_header("spaces in@email.com") is None


class TestGetCurrentUser:
    """Test the get_current_user dependency."""

    @pytest.mark.asyncio
    async def test_debug_mode_with_header(self):
        """In debug mode, valid header email is used."""
        request = Mock(spec=Request)
        request.state = SimpleNamespace()
        request.headers = MagicMock()
        request.headers.items.return_value = [("x-user-email", "test@example.com")]

        mock_db = AsyncMock()
        mock_db_user = Mock()
        mock_db_user.id = None
        mock_db_user.email = "test@example.com"
        mock_db_user.username = None
        mock_db_user.is_active = True
        mock_db_user.created_at = None
        mock_db_user.updated_at = None

        with patch('utils.dependencies.settings') as mock_settings:
            mock_settings.DEBUG = True
            mock_settings.SKIP_HEADER_CHECK = False
            mock_settings.MOCK_USER_EMAIL = "mock@example.com"
            mock_settings.X_USER_ID_HEADER = "X-User-Email"
            with patch('utils.dependencies.crud') as mock_crud:
                mock_crud.get_user_by_email = AsyncMock(return_value=mock_db_user)
                user = await get_current_user(request, mock_db, credentials=None)

        assert user.email == "test@example.com"

    @pytest.mark.asyncio
    async def test_debug_mode_fallback_to_mock(self):
        """In debug mode without header, MOCK_USER_EMAIL is used."""
        request = Mock(spec=Request)
        request.state = SimpleNamespace()
        request.headers = MagicMock()
        request.headers.items.return_value = []

        mock_db = AsyncMock()
        mock_db_user = Mock()
        mock_db_user.id = None
        mock_db_user.email = "mock@example.com"
        mock_db_user.username = None
        mock_db_user.is_active = True
        mock_db_user.created_at = None
        mock_db_user.updated_at = None

        with patch('utils.dependencies.settings') as mock_settings:
            mock_settings.DEBUG = True
            mock_settings.SKIP_HEADER_CHECK = False
            mock_settings.MOCK_USER_EMAIL = "mock@example.com"
            mock_settings.X_USER_ID_HEADER = "X-User-Email"
            with patch('utils.dependencies.crud') as mock_crud:
                mock_crud.get_user_by_email = AsyncMock(return_value=mock_db_user)
                user = await get_current_user(request, mock_db, credentials=None)

        assert user.email == "mock@example.com"

    @pytest.mark.asyncio
    async def test_invalid_api_key_raises_401(self):
        """Invalid Bearer token raises 401."""
        from fastapi.security import HTTPAuthorizationCredentials
        request = Mock(spec=Request)
        request.state = SimpleNamespace()

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad-key")
        mock_db = AsyncMock()

        with patch('utils.dependencies.crud') as mock_crud:
            mock_crud.get_all_active_api_keys = AsyncMock(return_value=[])
            with pytest.raises(Exception) as exc_info:
                await get_current_user(request, mock_db, credentials=creds)
            assert exc_info.value.status_code == 401


class TestGroupAuth:
    """Test core group authorization functionality."""

    def test_debug_mode_allows_all(self):
        """Test that debug mode allows all group access."""
        with patch.object(settings, 'DEBUG', True):
            assert core_is_user_in_group("any@example.com", "any-group") is True

    def test_empty_inputs(self):
        """Test handling of empty inputs."""
        with patch.object(settings, 'DEBUG', False):
            assert core_is_user_in_group("", "group") is False
            assert core_is_user_in_group("user@example.com", "") is False
            assert core_is_user_in_group(None, "group") is False

    def test_mock_user_groups(self):
        """Test mock user group membership."""
        with patch.object(settings, 'DEBUG', False):
            with patch.object(settings, 'SKIP_HEADER_CHECK', False):
                with patch.object(settings, 'VISTA_AUTH_BACKEND', 'demo'):
                    with patch.object(settings, 'MOCK_USER_EMAIL', 'mock@example.com'):
                        with patch.object(settings, 'MOCK_USER_GROUPS_JSON', '["admin", "users"]'):
                            assert core_is_user_in_group("mock@example.com", "admin") is True
                            assert core_is_user_in_group("mock@example.com", "users") is True
                            assert core_is_user_in_group("mock@example.com", "nonexistent") is False

    def test_case_insensitive_email(self):
        """Test that email comparison is case insensitive."""
        with patch.object(settings, 'DEBUG', False):
            with patch.object(settings, 'SKIP_HEADER_CHECK', False):
                with patch.object(settings, 'VISTA_AUTH_BACKEND', 'demo'):
                    with patch.object(settings, 'MOCK_USER_EMAIL', 'Mock@Example.COM'):
                        with patch.object(settings, 'MOCK_USER_GROUPS_JSON', '["admin"]'):
                            assert core_is_user_in_group("mock@example.com", "admin") is True

    def test_unconfigured_backend_raises(self):
        """Without VISTA_AUTH_BACKEND set, checks raise NotImplementedError."""
        with patch.object(settings, 'DEBUG', False):
            with patch.object(settings, 'SKIP_HEADER_CHECK', False):
                with patch.object(settings, 'VISTA_AUTH_BACKEND', None):
                    with pytest.raises(NotImplementedError):
                        core_is_user_in_group("admin@example.com", "admin")

    def test_demo_backend_refused_in_production(self):
        """Demo backend is refused when ENV=production."""
        with patch.object(settings, 'DEBUG', False):
            with patch.object(settings, 'SKIP_HEADER_CHECK', False):
                with patch.object(settings, 'ENV', 'production'):
                    with patch.object(settings, 'VISTA_AUTH_BACKEND', 'demo'):
                        assert core_is_user_in_group("admin@example.com", "admin") is False


class TestGroupAuthHelper:
    """Test group auth helper functions with caching."""

    def setup_method(self):
        """Clear cache before each test."""
        clear_cache()

    def test_caching_functionality(self):
        """Test that results are cached properly."""
        with patch('core.group_auth_helper._core_is_user_in_group', return_value=True) as mock_core:
            result1 = is_user_in_group("user@example.com", "test-group")
            assert result1 is True
            assert mock_core.call_count == 1

            result2 = is_user_in_group("user@example.com", "test-group")
            assert result2 is True
            assert mock_core.call_count == 1

    def test_is_user_in_any_group(self):
        """Test checking membership in any of multiple groups."""
        with patch('core.group_auth_helper._core_is_user_in_group') as mock_core:
            mock_core.side_effect = lambda u, g: g in ['group2', 'group3']
            clear_cache()

            assert is_user_in_any_group("user@example.com", ["group1", "group2"]) is True
            assert is_user_in_any_group("user@example.com", ["group1", "group4"]) is False
            assert is_user_in_any_group("user@example.com", []) is False

    def test_is_user_in_all_groups(self):
        """Test checking membership in all of multiple groups."""
        with patch('core.group_auth_helper._core_is_user_in_group') as mock_core:
            mock_core.side_effect = lambda u, g: g in ['group1', 'group2']
            clear_cache()

            assert is_user_in_all_groups("user@example.com", ["group1", "group2"]) is True
            assert is_user_in_all_groups("user@example.com", ["group1", "group3"]) is False
            assert is_user_in_all_groups("user@example.com", []) is False

    def test_get_user_groups(self):
        """Test getting list of groups user belongs to."""
        with patch('core.group_auth_helper._core_is_user_in_group') as mock_core:
            mock_core.side_effect = lambda u, g: g in ['admin', 'users']
            clear_cache()

            groups = get_user_groups("user@example.com", ["admin", "users", "guests"])
            assert groups == ["admin", "users"]

    def test_clear_user_cache(self):
        """Test clearing cache for specific user."""
        with patch('core.group_auth_helper._core_is_user_in_group', return_value=True) as mock_core:
            clear_cache()

            is_user_in_group("user1@example.com", "group1")
            is_user_in_group("user2@example.com", "group1")

            clear_user_cache("user1@example.com")

            is_user_in_group("user1@example.com", "group1")
            is_user_in_group("user2@example.com", "group1")

            assert mock_core.call_count == 3

    def test_cache_stats(self):
        """Test cache statistics reporting."""
        with patch('core.group_auth.is_user_in_group', return_value=True):
            is_user_in_group("user1@example.com", "group1")
            is_user_in_group("user2@example.com", "group2")

            stats = get_cache_stats()
            assert stats['total_entries'] == 2
            assert stats['valid_entries'] == 2
            assert stats['expired_entries'] == 0
            assert 'cache_ttl_seconds' in stats


class TestConfigIntegration:
    """Test integration with config settings."""

    def test_server_side_group_lookup_only(self):
        """Test that groups are always looked up server-side, never from headers."""
        # With the new dependency-based auth, group headers are never consumed.
        # This test validates the principle by checking that get_user_from_header
        # only returns an email, not groups.
        email = get_user_from_header("test@example.com")
        assert email == "test@example.com"
        # The function only returns a string email, never group information.


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
