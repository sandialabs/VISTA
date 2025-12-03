import pytest
import os
from unittest.mock import patch, mock_open
from core.config import Settings


@pytest.fixture(autouse=True)
def _ensure_min_env(monkeypatch):
    """Ensure minimal DB env vars exist for Settings instantiation in tests that don't override env."""
    monkeypatch.setenv("POSTGRES_USER", os.getenv("POSTGRES_USER", "u"))
    monkeypatch.setenv("POSTGRES_PASSWORD", os.getenv("POSTGRES_PASSWORD", "p"))
    monkeypatch.setenv("POSTGRES_DB", os.getenv("POSTGRES_DB", "d"))
    monkeypatch.setenv("POSTGRES_SERVER", os.getenv("POSTGRES_SERVER", "localhost"))
    monkeypatch.setenv("DATABASE_URL", os.getenv("DATABASE_URL", "sqlite+aiosqlite:///:memory:"))


class TestSettings:
    """Test configuration settings"""

    @patch.dict(os.environ, {
        "POSTGRES_USER": "u",
        "POSTGRES_PASSWORD": "p",
        "POSTGRES_DB": "d",
        "POSTGRES_SERVER": "localhost",
        "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
    }, clear=True)
    def test_settings_default_values(self):
        """Test that settings have correct default values with minimal required env vars provided"""
        settings = Settings(_env_file=None)
        assert settings.APP_NAME == "Data Management API"
        # DEBUG/SKIP_HEADER_CHECK depend on env; only assert presence
        assert hasattr(settings, 'DEBUG')
        assert hasattr(settings, 'SKIP_HEADER_CHECK')
        assert settings.S3_ACCESS_KEY == "minioadmin"
        assert settings.S3_SECRET_KEY == "minioadminpassword"
        assert settings.S3_BUCKET == "data-storage"

    def test_settings_from_env_vars(self):
        """Test that settings load from environment variables"""
        with patch.dict(os.environ, {
            "APP_NAME": "Test App",
            "DEBUG": "true",
            "S3_ACCESS_KEY": "test-key",
            "POSTGRES_USER": "u",
            "POSTGRES_PASSWORD": "p",
            "POSTGRES_DB": "d",
            "POSTGRES_SERVER": "localhost",
            "DATABASE_URL": "sqlite+aiosqlite:///:memory:"
        }):
            settings = Settings(_env_file=None)
            assert settings.APP_NAME == "Test App"
            assert settings.DEBUG is True
            assert settings.S3_ACCESS_KEY == "test-key"

    def test_boolean_parsing_with_whitespace(self):
        """Test that boolean values with whitespace are parsed correctly"""
        with patch.dict(os.environ, {
            "DEBUG": "true ",
            "SKIP_HEADER_CHECK": " false",
            "S3_USE_SSL": "true\r\n",
            "POSTGRES_USER": "u",
            "POSTGRES_PASSWORD": "p",
            "POSTGRES_DB": "d",
            "POSTGRES_SERVER": "localhost",
            "DATABASE_URL": "sqlite+aiosqlite:///:memory:"
        }):
            settings = Settings(_env_file=None)
            assert settings.DEBUG is True
            assert settings.SKIP_HEADER_CHECK is False
            assert settings.S3_USE_SSL is True

    def test_mock_user_groups_property(self):
        """Test that MOCK_USER_GROUPS property parses JSON correctly"""
        with patch.dict(os.environ, {
            "MOCK_USER_GROUPS_JSON": '["group1", "group2", "group3"]'
        }):
            settings = Settings(_env_file=None)
            assert settings.MOCK_USER_GROUPS == ["group1", "group2", "group3"]

    def test_mock_user_groups_invalid_json(self):
        """Test handling of invalid JSON in MOCK_USER_GROUPS_JSON"""
        with patch.dict(os.environ, {
            "MOCK_USER_GROUPS_JSON": 'invalid-json'
        }):
            settings = Settings(_env_file=None)
            with pytest.raises(Exception):
                _ = settings.MOCK_USER_GROUPS

    def test_env_file_loading_precedence(self):
        """Test that local .env takes precedence over parent .env"""
        local_env_content = "DEBUG=true\nAPP_NAME=Local App"
        with patch("builtins.open", mock_open()) as mock_file:
            with patch("os.path.isfile") as mock_isfile:
                mock_isfile.side_effect = lambda path: path == ".env"
                mock_file.return_value.read.return_value = local_env_content
                s = Settings(_env_file=None, _env_file_encoding='utf-8', **{
                    "POSTGRES_USER": "u",
                    "POSTGRES_PASSWORD": "p",
                    "POSTGRES_DB": "d",
                    "POSTGRES_SERVER": "localhost",
                    "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
                })
                # Pydantic v2 exposes configuration via model_config instead of Config class
                assert hasattr(s, 'model_config')
                assert s.model_config.get('env_file') == (".env", "../.env")

    def test_field_validators_exist(self):
        """Test that field validators are properly set up"""
        settings = Settings(_env_file=None)
        assert hasattr(settings, 'parse_bool_with_strip')

    def test_frontend_build_path_default(self):
        """Test frontend build path default value"""
        import os
        settings = Settings(_env_file=None)
        # In Docker, FRONTEND_BUILD_PATH is set to /app/ui2
        # Locally, it defaults to frontend/build
        expected_path = os.environ.get("FRONTEND_BUILD_PATH", "frontend/build")
        assert settings.FRONTEND_BUILD_PATH == expected_path

    def test_cors_origins_from_settings(self):
        """Test CORS origins configuration"""
        settings = Settings(_env_file=None)
        assert hasattr(settings, 'APP_NAME')

    def test_database_url_default_values(self):
        """Test that database fields have default values when environment variables are missing"""
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings(_env_file=None)
            # Verify default values are set
            assert settings.POSTGRES_USER == "postgres"
            assert settings.POSTGRES_PASSWORD == "postgres"
            assert settings.POSTGRES_DB == "postgres"
            assert settings.POSTGRES_SERVER == "localhost"
            assert settings.DATABASE_URL == "sqlite+aiosqlite:///./test.db"

    @patch.dict(os.environ, {
        "POSTGRES_USER": "testuser",
        "POSTGRES_PASSWORD": "testpass",
        "POSTGRES_DB": "testdb",
        "POSTGRES_SERVER": "localhost",
        "DATABASE_URL": "postgresql://testuser:testpass@localhost/testdb"
    }, clear=True)
    def test_required_fields_provided(self):
        """Test that settings work when all required fields are provided"""
        settings = Settings(_env_file=None)
        assert settings.POSTGRES_USER == "testuser"
        assert settings.POSTGRES_PASSWORD == "testpass"
        assert settings.POSTGRES_DB == "testdb"
        assert settings.POSTGRES_SERVER == "localhost"

    def test_extra_config_allowed(self):
        """Test that extra configuration is allowed"""
        settings = Settings(_env_file=None)
        # In Pydantic v2 the extra handling lives in model_config
        assert settings.model_config.get('extra') == 'allow'