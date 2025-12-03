import pytest
from core.config import settings
from core.group_auth_helper import is_user_in_group
from core import schemas


def test_is_user_in_group_debug(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    assert is_user_in_group("a@b.com", "g1") is True


def test_is_user_in_group_non_debug_with_groups(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SKIP_HEADER_CHECK", False)
    # Test with dev mapping - user@example.com has project-alpha-group access
    assert is_user_in_group("user@example.com", "project-alpha-group") is True
    assert is_user_in_group("user@example.com", "nonexistent") is False
