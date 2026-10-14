from importlib import reload

import core.config as config_mod


def test_bool_parsing_extended(monkeypatch):
    # core.config.settings is a process-wide singleton that other already-imported
    # modules reference directly (e.g. `from core.config import settings`).
    # reload() replaces that singleton with a new object, which would silently
    # desync any module holding the old reference for the rest of the test
    # session, so always restore the original object afterward.
    original_settings = config_mod.settings
    try:
        monkeypatch.setenv("DEBUG", " true\n")
        monkeypatch.setenv("SKIP_HEADER_CHECK", "false ")
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db:5432/x")
        monkeypatch.setenv("POSTGRES_USER", "u")
        monkeypatch.setenv("POSTGRES_PASSWORD", "p")
        monkeypatch.setenv("POSTGRES_DB", "x")
        monkeypatch.setenv("POSTGRES_SERVER", "db")
        m = reload(config_mod)
        s = m.settings
        assert s.DEBUG is True
        assert s.SKIP_HEADER_CHECK is False
    finally:
        config_mod.settings = original_settings
