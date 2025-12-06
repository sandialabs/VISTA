"""
Tests for MCP (Model Context Protocol) server endpoints.
"""

import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from core import schemas
from core.config import settings
import utils.crud as crud


pytestmark = pytest.mark.asyncio


class TestMCPAuthentication:
    """Test MCP authentication via secret key."""
    
    def test_mcp_health_no_auth(self, client):
        """Health endpoint should work without auth."""
        response = client.get("/mcp/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "mcp_enabled" in data
    
    def test_list_tools_missing_secret(self, client, monkeypatch):
        """Should reject request without MCP secret."""
        # Ensure MCP is enabled and has a secret
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.get(
            "/mcp/tools",
            headers={"X-Username": "testuser"}
        )
        assert response.status_code == 401
        assert "X-MCP-Secret" in response.json()["detail"]
    
    def test_list_tools_missing_username(self, client, monkeypatch):
        """Should reject request without username."""
        # Ensure MCP is enabled and has a secret
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.get(
            "/mcp/tools",
            headers={"X-MCP-Secret": "test-secret"}
        )
        assert response.status_code == 401
        assert "X-Username" in response.json()["detail"]
    
    def test_list_tools_invalid_secret(self, client, monkeypatch):
        """Should reject request with invalid secret."""
        # Ensure MCP is enabled and has a secret
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'correct-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.get(
            "/mcp/tools",
            headers={
                "X-MCP-Secret": "wrong-secret",
                "X-Username": "testuser"
            }
        )
        assert response.status_code == 403
        assert "Invalid" in response.json()["detail"]
    
    def test_list_tools_valid_auth(self, client, monkeypatch):
        """Should accept request with valid secret and username."""
        # Ensure MCP is enabled and has a secret
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.get(
            "/mcp/tools",
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "tools" in data
        assert isinstance(data["tools"], list)


class TestMCPGetProjects:
    """Test get_projects MCP tool."""
    
    async def test_get_projects_empty(self, client, db_session, monkeypatch):
        """Should return empty list when no projects exist."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret',
            'CHECK_MOCK_MEMBERSHIP': True,
            'MOCK_USER_GROUPS_JSON': '[]'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        monkeypatch.setattr('core.config.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_projects",
                "arguments": {"skip": 0, "limit": 10}
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["tool"] == "get_projects"
    
    async def test_get_projects_with_data(self, client, db_session, sample_project, monkeypatch):
        """Should return projects that user has access to."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret',
            'CHECK_MOCK_MEMBERSHIP': True,
            'MOCK_USER_GROUPS': ['admin-group']
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_projects",
                "arguments": {"skip": 0, "limit": 10}
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
    
    async def test_get_projects_pagination(self, client, db_session, monkeypatch):
        """Should respect pagination parameters."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret',
            'CHECK_MOCK_MEMBERSHIP': True,
            'MOCK_USER_GROUPS_JSON': '[]'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        monkeypatch.setattr('core.config.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_projects",
                "arguments": {"skip": 0, "limit": 5}
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        assert response.status_code == 200


class TestMCPGetImages:
    """Test get_images MCP tool."""
    
    async def test_get_images_invalid_project_id(self, client, monkeypatch):
        """Should reject invalid project UUID."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_images",
                "arguments": {
                    "project_id": "not-a-uuid",
                    "skip": 0,
                    "limit": 10
                }
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        # HTTPException is re-raised, so we get 400 directly
        assert response.status_code == 400
        assert "Invalid" in response.json()["detail"]
    
    async def test_get_images_nonexistent_project(self, client, monkeypatch):
        """Should return 404 for nonexistent project."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        fake_uuid = str(uuid.uuid4())
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_images",
                "arguments": {
                    "project_id": fake_uuid,
                    "skip": 0,
                    "limit": 10
                }
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        # HTTPException is re-raised, so we get 404 directly
        assert response.status_code == 404


class TestMCPGetImageInfo:
    """Test get_image_info MCP tool."""
    
    async def test_get_image_info_invalid_id(self, client, monkeypatch):
        """Should reject invalid image UUID."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_image_info",
                "arguments": {"image_id": "not-a-uuid"}
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        # HTTPException is re-raised, so we get 400 directly
        assert response.status_code == 400
        assert "Invalid" in response.json()["detail"]


class TestMCPGetImageURL:
    """Test get_image_url MCP tool."""
    
    async def test_get_image_url_invalid_id(self, client, monkeypatch):
        """Should reject invalid image UUID."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_image_url",
                "arguments": {
                    "image_id": "not-a-uuid",
                    "expiry_seconds": 3600
                }
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        # HTTPException is re-raised, so we get 400 directly
        assert response.status_code == 400
        assert "Invalid" in response.json()["detail"]
    
    async def test_get_image_url_expiry_validation(self, client, monkeypatch):
        """Should validate expiry_seconds parameter."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        # Test with a valid UUID but nonexistent image
        fake_uuid = str(uuid.uuid4())
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "get_image_url",
                "arguments": {
                    "image_id": fake_uuid,
                    "expiry_seconds": 30  # Should be clamped to 60
                }
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        # Will fail because image doesn't exist with 404
        assert response.status_code == 404


class TestMCPToolInvocation:
    """Test general MCP tool invocation."""
    
    def test_invoke_missing_tool_name(self, client, monkeypatch):
        """Should reject request without tool name."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={"arguments": {}},
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        assert response.status_code == 400
        assert "tool" in response.json()["detail"]
    
    def test_invoke_nonexistent_tool(self, client, monkeypatch):
        """Should reject nonexistent tool name."""
        patched_settings = settings.patch({
            'MCP_ENABLED': True,
            'MCP_SECRET_KEY': 'test-secret'
        })
        monkeypatch.setattr('routers.mcp_server.settings', patched_settings)
        
        response = client.post(
            "/mcp/tools/invoke",
            json={
                "tool": "nonexistent_tool",
                "arguments": {}
            },
            headers={
                "X-MCP-Secret": "test-secret",
                "X-Username": "testuser@example.com"
            }
        )
        # Should get 404 for nonexistent tool
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
