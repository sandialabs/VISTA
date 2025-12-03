"""
Simple test for the new authentication system.
"""

import pytest
from unittest.mock import patch
from middleware.auth import get_user_from_header
from core.group_auth_helper import is_user_in_group, clear_cache
from core.config import settings


def test_get_user_from_header():
    """Test user email extraction from headers"""
    assert get_user_from_header("test@example.com") == "test@example.com"
    assert get_user_from_header("  Test@Example.COM  ") == "test@example.com"
    assert get_user_from_header("") is None
    assert get_user_from_header(None) is None
    assert get_user_from_header("invalid-email") is None


def test_debug_mode_auth():
    """Test group membership in debug mode"""
    clear_cache()
    
    # In debug mode, all group checks should return True
    with patch.object(settings, 'DEBUG', True):
        assert is_user_in_group("any@example.com", "any-group") is True
        assert is_user_in_group("test@example.com", "admin") is True


def test_production_mode_auth():
    """Test group membership in production mode"""
    clear_cache()
    
    # In production mode, should check actual group membership
    with patch.object(settings, 'DEBUG', False):
        with patch.object(settings, 'SKIP_HEADER_CHECK', False):
            with patch.object(settings, 'MOCK_USER_EMAIL', 'mock@example.com'):
                with patch.object(settings, 'MOCK_USER_GROUPS_JSON', '["admin", "users"]'):
                    # Mock user should have admin access
                    assert is_user_in_group("mock@example.com", "admin") is True
                    assert is_user_in_group("mock@example.com", "users") is True
                    assert is_user_in_group("mock@example.com", "nonexistent") is False
                    
                    # Unknown user should not have access
                    assert is_user_in_group("unknown@example.com", "admin") is False


def test_group_membership():
    """Test group membership checks"""
    clear_cache()
    
    with patch.object(settings, 'DEBUG', False):
        with patch.object(settings, 'SKIP_HEADER_CHECK', False):
            # Test admin user (from dev mapping)
            assert is_user_in_group("admin@example.com", "admin") is True
            assert is_user_in_group("admin@example.com", "data-scientists") is True
            assert is_user_in_group("admin@example.com", "nonexistent-group") is False
            
            # Test regular user (from dev mapping)
            assert is_user_in_group("user@example.com", "project-alpha-group") is True
            assert is_user_in_group("user@example.com", "admin") is False


if __name__ == "__main__":
    # Run basic tests
    test_get_user_from_header()
    test_debug_mode_auth()
    test_production_mode_auth()
    test_group_membership()
    print("✅ All authentication tests passed!")
