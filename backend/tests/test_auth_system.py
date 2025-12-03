"""
Comprehensive tests for the new unified authentication system.
Tests middleware, group auth, and security functions.
"""

import pytest
from types import SimpleNamespace
from fastapi import Request
from fastapi.testclient import TestClient
from unittest.mock import Mock, AsyncMock, patch

from middleware.auth import (
    get_user_from_header, 
    auth_middleware
)
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


class TestAuthMiddleware:
    """Test the unified auth middleware functionality."""
    
    @pytest.fixture
    def mock_request(self):
        request = Mock(spec=Request)
        request.state = SimpleNamespace()
        request.headers = {}
        return request
    
    @pytest.fixture  
    def mock_call_next(self):
        call_next = AsyncMock()
        call_next.return_value = Mock()  # Mock response
        return call_next
    
    @pytest.mark.asyncio
    async def test_debug_mode_with_header(self, mock_request, mock_call_next):
        """Test auth middleware in debug mode with valid header."""
        mock_request.headers = {"X-User-Id": "test@example.com"}
        
        with patch('middleware.auth.settings.DEBUG', True):
            with patch('middleware.auth.settings.MOCK_USER_EMAIL', 'test@example.com'):
                response = await auth_middleware(mock_request, mock_call_next)
        
        assert mock_request.state.user_email == "test@example.com"
        assert mock_request.state.is_authenticated is True
        assert hasattr(mock_request.state, 'user_groups')
        mock_call_next.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_debug_mode_without_header(self, mock_request, mock_call_next):
        """Test auth middleware in debug mode without header uses mock user."""
        mock_request.headers = {}
        
        with patch('middleware.auth.settings.DEBUG', True):
            with patch('middleware.auth.settings.MOCK_USER_EMAIL', 'mock@example.com'):
                response = await auth_middleware(mock_request, mock_call_next)
        
        assert mock_request.state.user_email == "mock@example.com"
        assert mock_request.state.is_authenticated is True
        mock_call_next.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_production_mode_valid_header(self, mock_request, mock_call_next):
        """Test auth middleware in production mode with valid header."""
        mock_request.headers = {"x-user-id": "prod@example.com"}
        
        with patch('middleware.auth.settings.DEBUG', False):
            with patch('middleware.auth.settings.X_USER_ID_HEADER', 'X-User-Id'):
                response = await auth_middleware(mock_request, mock_call_next)
        
        assert mock_request.state.user_email == "prod@example.com"
        assert mock_request.state.is_authenticated is True
        mock_call_next.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_production_mode_missing_header(self, mock_request, mock_call_next):
        """Test auth middleware in production mode with missing header returns 500 when PROXY_SHARED_SECRET is not set."""
        mock_request.headers = {}
        
        with patch('middleware.auth.settings.DEBUG', False):
            with patch('middleware.auth.settings.SKIP_HEADER_CHECK', False):
                with patch('middleware.auth.settings.PROXY_SHARED_SECRET', None):
                    with patch('middleware.auth.settings.X_USER_ID_HEADER', 'X-User-Id'):
                        response = await auth_middleware(mock_request, mock_call_next)
        
        # Should return JSONResponse with 500 when PROXY_SHARED_SECRET is not configured
        assert hasattr(response, 'status_code')
        assert response.status_code == 500
        mock_call_next.assert_not_called()
    
    @pytest.mark.asyncio  
    async def test_production_mode_proxy_secret_validation(self, mock_request, mock_call_next):
        """Test auth middleware validates proxy secret when configured."""
        mock_request.headers = {
            "x-user-id": "secure@example.com",
            "x-proxy-secret": "correct-secret"
        }
        
        with patch('middleware.auth.settings.DEBUG', False):
            with patch('middleware.auth.settings.PROXY_SHARED_SECRET', 'correct-secret'):
                with patch('middleware.auth.settings.X_USER_ID_HEADER', 'X-User-Id'):
                    with patch('middleware.auth.settings.X_PROXY_SECRET_HEADER', 'X-Proxy-Secret'):
                        response = await auth_middleware(mock_request, mock_call_next)
        
        assert mock_request.state.user_email == "secure@example.com"
        mock_call_next.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_production_mode_wrong_proxy_secret(self, mock_request, mock_call_next):
        """Test auth middleware rejects wrong proxy secret."""
        mock_request.headers = {
            "x-user-id": "secure@example.com",
            "x-proxy-secret": "wrong-secret"
        }
        
        with patch('middleware.auth.settings.DEBUG', False):
            with patch('middleware.auth.settings.SKIP_HEADER_CHECK', False):
                with patch('middleware.auth.settings.PROXY_SHARED_SECRET', 'correct-secret'):
                    with patch('middleware.auth.settings.X_PROXY_SECRET_HEADER', 'X-Proxy-Secret'):
                        response = await auth_middleware(mock_request, mock_call_next)
        
        assert hasattr(response, 'status_code')
        assert response.status_code == 401
        mock_call_next.assert_not_called()


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
                with patch.object(settings, 'MOCK_USER_EMAIL', 'mock@example.com'):
                    with patch.object(settings, 'MOCK_USER_GROUPS_JSON', '["admin", "users"]'):
                        assert core_is_user_in_group("mock@example.com", "admin") is True
                        assert core_is_user_in_group("mock@example.com", "users") is True
                        assert core_is_user_in_group("mock@example.com", "nonexistent") is False
    
    def test_case_insensitive_email(self):
        """Test that email comparison is case insensitive."""
        with patch.object(settings, 'DEBUG', False):
            with patch.object(settings, 'SKIP_HEADER_CHECK', False):
                with patch.object(settings, 'MOCK_USER_EMAIL', 'Mock@Example.COM'):
                    with patch.object(settings, 'MOCK_USER_GROUPS_JSON', '["admin"]'):
                        # Should normalize both sides of the comparison
                        assert core_is_user_in_group("mock@example.com", "admin") is True


class TestGroupAuthHelper:
    """Test group auth helper functions with caching."""
    
    def setup_method(self):
        """Clear cache before each test."""
        clear_cache()
    
    def test_caching_functionality(self):
        """Test that results are cached properly."""
        with patch('core.group_auth_helper._core_is_user_in_group', return_value=True) as mock_core:
            # First call should hit the core function
            result1 = is_user_in_group("user@example.com", "test-group")
            assert result1 is True
            assert mock_core.call_count == 1
            
            # Second call should use cache
            result2 = is_user_in_group("user@example.com", "test-group")
            assert result2 is True
            assert mock_core.call_count == 1  # Still 1, no additional call
    
    def test_is_user_in_any_group(self):
        """Test checking membership in any of multiple groups."""
        with patch('core.group_auth_helper._core_is_user_in_group') as mock_core:
            mock_core.side_effect = lambda u, g: g in ['group2', 'group3']
            clear_cache()  # Ensure clean state
            
            assert is_user_in_any_group("user@example.com", ["group1", "group2"]) is True
            assert is_user_in_any_group("user@example.com", ["group1", "group4"]) is False
            assert is_user_in_any_group("user@example.com", []) is False
    
    def test_is_user_in_all_groups(self):
        """Test checking membership in all of multiple groups."""
        with patch('core.group_auth_helper._core_is_user_in_group') as mock_core:
            mock_core.side_effect = lambda u, g: g in ['group1', 'group2']
            clear_cache()  # Ensure clean state
            
            assert is_user_in_all_groups("user@example.com", ["group1", "group2"]) is True
            assert is_user_in_all_groups("user@example.com", ["group1", "group3"]) is False
            assert is_user_in_all_groups("user@example.com", []) is False
    
    def test_get_user_groups(self):
        """Test getting list of groups user belongs to."""
        with patch('core.group_auth_helper._core_is_user_in_group') as mock_core:
            mock_core.side_effect = lambda u, g: g in ['admin', 'users']
            clear_cache()  # Ensure clean state
            
            groups = get_user_groups("user@example.com", ["admin", "users", "guests"])
            assert groups == ["admin", "users"]
    
    def test_clear_user_cache(self):
        """Test clearing cache for specific user."""
        with patch('core.group_auth_helper._core_is_user_in_group', return_value=True) as mock_core:
            clear_cache()  # Start with clean state
            
            # Cache some results for different users
            is_user_in_group("user1@example.com", "group1")
            is_user_in_group("user2@example.com", "group1")
            
            # Clear cache for user1 only
            clear_user_cache("user1@example.com")
            
            # user1's results should require new calls, user2's should be cached
            is_user_in_group("user1@example.com", "group1")  # Should call core
            is_user_in_group("user2@example.com", "group1")  # Should use cache
            
            # user1's call should have been made twice (initial + after cache clear)
            # user2's call should have been made once (initial only)
            assert mock_core.call_count == 3  # 2 initial calls + 1 for user1 after clear
    
    def test_cache_stats(self):
        """Test cache statistics reporting."""
        with patch('core.group_auth.is_user_in_group', return_value=True):
            # Add some cached entries
            is_user_in_group("user1@example.com", "group1")
            is_user_in_group("user2@example.com", "group2")
            
            stats = get_cache_stats()
            assert stats['total_entries'] == 2
            assert stats['valid_entries'] == 2
            assert stats['expired_entries'] == 0
            assert 'cache_ttl_seconds' in stats


class TestMiddlewareHelpers:
    """Test middleware helper functions."""
    
    def test_direct_request_state_access(self):
        """Test that code should access request.state directly - no wrapper functions needed."""
        request = Mock()
        request.state.user_email = "test@example.com"
        
        # Code should access request.state.user_email directly
        assert getattr(request.state, 'user_email', None) == "test@example.com"
        
        # Missing attributes should return None with getattr default
        request_empty = Mock()
        request_empty.state = Mock(spec=[])
        assert getattr(request_empty.state, 'user_email', None) is None
    
    # Note: Groups are always looked up server-side, never stored in request.state
    


class TestConfigIntegration:
    """Test integration with config settings."""
    
    def test_custom_header_names(self):
        """Test that custom header names from config are respected."""
        request = Mock()
        request.headers = {"custom-user-header": "test@example.com"}
        request.state = SimpleNamespace()
        call_next = AsyncMock(return_value=Mock())
        
        with patch('middleware.auth.settings.DEBUG', False):
            with patch('middleware.auth.settings.X_USER_ID_HEADER', 'Custom-User-Header'):
                import asyncio
                asyncio.run(auth_middleware(request, call_next))
        
        assert request.state.user_email == "test@example.com"
    
    def test_server_side_group_lookup_only(self):
        """Test that groups are always looked up server-side, never from headers."""
        request = Mock()
        request.headers = {
            "x-user-id": "test@example.com",
            "x-user-groups": "admin,users,guests",  # This should be ignored
            "x-proxy-secret": "test-secret"
        }
        request.state = SimpleNamespace()
        call_next = AsyncMock(return_value=Mock())
        
        with patch('middleware.auth.settings.DEBUG', False):
            with patch('middleware.auth.settings.SKIP_HEADER_CHECK', False):
                with patch('middleware.auth.settings.PROXY_SHARED_SECRET', 'test-secret'):
                    with patch('middleware.auth.settings.X_USER_ID_HEADER', 'X-User-Id'):
                        with patch('middleware.auth.settings.X_PROXY_SECRET_HEADER', 'X-Proxy-Secret'):
                            import asyncio
                            asyncio.run(auth_middleware(request, call_next))
        
        assert request.state.user_email == "test@example.com"
        # Groups should never be set from headers - always looked up server-side
        assert not hasattr(request.state, 'user_groups')


if __name__ == "__main__":
    # Run basic tests if called directly
    pytest.main([__file__, "-v"])