import os
from importlib import reload
import core.config as config_mod


def test_bool_parsing_extended(monkeypatch):
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
