import sys

import pytest

from core.config import settings


def _import_mcp_server_with_api_key(monkeypatch, api_key):
    sys.modules.pop("mcp_server", None)
    monkeypatch.setattr(settings, "VISTA_MCP_API_KEY", api_key)

    import importlib

    return importlib.import_module("mcp_server")


@pytest.mark.parametrize("api_key", [None, "", "vista-default-key-change-me"])
def test_mcp_server_rejects_missing_or_default_api_key(monkeypatch, api_key):
    with pytest.raises(RuntimeError, match="VISTA_MCP_API_KEY must be set"):
        _import_mcp_server_with_api_key(monkeypatch, api_key)

    sys.modules.pop("mcp_server", None)


def test_mcp_server_uses_settings_api_key(monkeypatch):
    module = _import_mcp_server_with_api_key(monkeypatch, "configured-mcp-key")

    assert module.VISTA_MCP_API_KEY == "configured-mcp-key"

    sys.modules.pop("mcp_server", None)
