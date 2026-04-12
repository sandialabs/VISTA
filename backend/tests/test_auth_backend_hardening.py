"""Tests for the fail-closed group-auth backend hardening (issue C1).

Covers:
- ``_check_group_membership`` raises NotImplementedError unless an auth
  backend is configured.
- ``run_auth_startup_self_test`` refuses to start with an unconfigured or
  stub backend, or when demo emails resolve as members.
- ``Settings.validate_production_safety`` refuses unsafe prod config.
"""

import pytest
from unittest.mock import patch

from core.config import settings
from core.group_auth import (
    _check_group_membership,
    is_user_in_group as core_is_user_in_group,
    run_auth_startup_self_test,
)


class TestFailClosedByDefault:
    def test_unconfigured_backend_raises(self):
        with patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", None):
            with pytest.raises(NotImplementedError):
                _check_group_membership("admin@example.com", "admin")

    def test_unknown_backend_raises(self):
        with patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "garbage"):
            with pytest.raises(NotImplementedError):
                _check_group_membership("admin@example.com", "admin")

    def test_custom_stub_raises_not_implemented(self):
        with patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "custom"):
            with pytest.raises(NotImplementedError):
                _check_group_membership("admin@example.com", "admin")

    def test_demo_backend_works_outside_production(self):
        with patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "ENV", "development"), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "demo"):
            assert _check_group_membership("admin@example.com", "admin") is True

    def test_demo_backend_refused_in_production(self):
        with patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "ENV", "production"), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "demo"):
            # Check via the public entry point so the production guard fires.
            assert core_is_user_in_group("admin@example.com", "admin") is False

    def test_debug_bypass_refused_in_production(self):
        """If somehow DEBUG=true in production, the bypass still denies access."""
        with patch.object(settings, "DEBUG", True), \
             patch.object(settings, "ENV", "production"):
            assert core_is_user_in_group("admin@example.com", "admin") is False


class TestStartupSelfTest:
    def test_unconfigured_backend_fails_startup(self):
        with patch.object(settings, "VISTA_AUTH_BACKEND", None):
            with pytest.raises(RuntimeError, match="VISTA_AUTH_BACKEND is not set"):
                run_auth_startup_self_test()

    def test_unknown_backend_fails_startup(self):
        with patch.object(settings, "VISTA_AUTH_BACKEND", "bogus"):
            with pytest.raises(RuntimeError, match="Unknown VISTA_AUTH_BACKEND"):
                run_auth_startup_self_test()

    def test_demo_in_production_fails_startup(self):
        with patch.object(settings, "VISTA_AUTH_BACKEND", "demo"), \
             patch.object(settings, "ENV", "production"):
            with pytest.raises(RuntimeError, match="demo is not allowed"):
                run_auth_startup_self_test()

    def test_custom_stub_fails_startup(self):
        with patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "ENV", "development"):
            with pytest.raises(RuntimeError, match="still.*raises NotImplementedError"):
                run_auth_startup_self_test()

    def test_custom_insecure_fails_startup(self):
        """If a custom backend grants demo emails access, startup fails."""
        always_true = lambda email, group: True
        with patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "ENV", "development"), \
             patch("core.group_auth._check_group_membership", side_effect=always_true):
            with pytest.raises(RuntimeError, match="self-test failed"):
                run_auth_startup_self_test()

    def test_custom_secure_passes_startup(self):
        """A custom backend that denies demo emails passes the self-test."""
        deny_all = lambda email, group: False
        with patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "ENV", "development"), \
             patch("core.group_auth._check_group_membership", side_effect=deny_all):
            # Should not raise.
            run_auth_startup_self_test()

    def test_demo_in_development_passes_startup(self):
        with patch.object(settings, "VISTA_AUTH_BACKEND", "demo"), \
             patch.object(settings, "ENV", "development"):
            run_auth_startup_self_test()


class TestProductionSafetyValidator:
    def test_non_production_is_noop(self):
        with patch.object(settings, "ENV", "development"), \
             patch.object(settings, "DEBUG", True), \
             patch.object(settings, "SKIP_HEADER_CHECK", True), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "demo"), \
             patch.object(settings, "PROXY_SHARED_SECRET", None):
            # No exception expected outside production.
            settings.validate_production_safety()

    def test_production_with_debug_raises(self):
        with patch.object(settings, "ENV", "production"), \
             patch.object(settings, "DEBUG", True), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "PROXY_SHARED_SECRET", "secret"):
            with pytest.raises(RuntimeError, match="DEBUG=true"):
                settings.validate_production_safety()

    def test_production_with_skip_header_check_raises(self):
        with patch.object(settings, "ENV", "production"), \
             patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", True), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "PROXY_SHARED_SECRET", "secret"):
            with pytest.raises(RuntimeError, match="SKIP_HEADER_CHECK"):
                settings.validate_production_safety()

    def test_production_with_demo_backend_raises(self):
        with patch.object(settings, "ENV", "production"), \
             patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "demo"), \
             patch.object(settings, "PROXY_SHARED_SECRET", "secret"):
            with pytest.raises(RuntimeError, match="demo is not allowed"):
                settings.validate_production_safety()

    def test_production_without_proxy_secret_raises(self):
        with patch.object(settings, "ENV", "production"), \
             patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "PROXY_SHARED_SECRET", None):
            with pytest.raises(RuntimeError, match="PROXY_SHARED_SECRET"):
                settings.validate_production_safety()

    def test_production_safe_config_passes(self):
        with patch.object(settings, "ENV", "production"), \
             patch.object(settings, "DEBUG", False), \
             patch.object(settings, "SKIP_HEADER_CHECK", False), \
             patch.object(settings, "VISTA_AUTH_BACKEND", "custom"), \
             patch.object(settings, "PROXY_SHARED_SECRET", "super-secret"):
            settings.validate_production_safety()
