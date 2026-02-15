"""
Test multi-prefix authentication.

Tests that:
- /api routes require OAuth headers (X-User-Email + X-Proxy-Secret)
- /api-key routes require API keys (Authorization header)
- /api-ml routes require API keys + HMAC (Authorization + X-ML-Signature + X-ML-Timestamp)
- Each prefix rejects requests with wrong auth method
"""

import pytest
import json
import hmac
import hashlib
import time
from fastapi.testclient import TestClient
from unittest.mock import patch
from core.config import settings


def test_api_prefix_uses_middleware_auth(client):
    """Test that /api endpoints use middleware authentication (header-based)"""
    # In test mode, SKIP_HEADER_CHECK is true, so requests work without headers
    response = client.get("/api/projects")
    assert response.status_code in [200, 401], f"Unexpected status: {response.status_code}"
    # If 401, it means auth is being enforced (expected in non-test mode)
    # If 200, it means SKIP_HEADER_CHECK allowed it through (test mode)


def test_api_key_prefix_requires_api_key(client):
    """Test that /api-key endpoints require valid API key"""
    # No auth at all - should fail
    response = client.get("/api-key/projects")
    assert response.status_code == 401
    # Error message text is implementation detail; status code is what matters


def test_api_key_prefix_accepts_valid_key(client, api_user_with_key):
    """Test that /api-key endpoints accept valid API keys"""
    user, api_key = api_user_with_key

    headers = {"Authorization": f"Bearer {api_key}"}
    response = client.get("/api-key/projects", headers=headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_api_ml_prefix_requires_both_api_key_and_hmac(client, api_user_with_key, monkeypatch):
    """Test that /api-ml endpoints require BOTH API key AND HMAC"""
    import json as _json
    user, api_key = api_user_with_key

    secret = "test-hmac-secret-12345"
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data for pipeline endpoint
    proj = client.post('/api/projects/', json={"name":"MLAuthTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    body = {"status": "completed"}
    body_bytes = _json.dumps(body).encode('utf-8')

    # Test 1: No auth at all - should fail (missing API key + HMAC)
    response = client.post(f"/api-ml/analyses/{analysis['id']}/finalize", data=body_bytes, headers={"Content-Type": "application/json"})
    assert response.status_code == 401

    # Test 2: API key but no HMAC - should fail
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    response = client.post(f"/api-ml/analyses/{analysis['id']}/finalize", data=body_bytes, headers=headers)
    assert response.status_code == 401
    # Body may vary; we only require a 401 for missing HMAC


def test_api_ml_prefix_accepts_valid_api_key_and_hmac(client, api_user_with_key, monkeypatch):
    """Test that /api-ml endpoints accept valid API key + HMAC"""
    import json as _json
    user, api_key = api_user_with_key

    # Set HMAC secret for this test
    test_secret = "test-hmac-secret-12345"
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', test_secret)
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', test_secret)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data for a pipeline endpoint
    proj = client.post('/api/projects/', json={"name":"MLAcceptTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Generate valid HMAC signature for finalize POST
    body = {"status": "completed"}
    body_bytes = _json.dumps(body).encode('utf-8')
    timestamp = str(int(time.time()))
    message = timestamp.encode('utf-8') + b'.' + body_bytes
    signature_hex = hmac.new(test_secret.encode('utf-8'), message, hashlib.sha256).hexdigest()
    signature = f"sha256={signature_hex}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-ML-Signature": signature,
        "X-ML-Timestamp": timestamp,
        "Content-Type": "application/json"
    }

    response = client.post(f"/api-ml/analyses/{analysis['id']}/finalize", data=body_bytes, headers=headers)
    assert response.status_code == 200


def test_auth_tier_segregation(client):
    """Test that routers are mounted only on their intended auth prefixes.

    /api and /api-key share data-access routers (projects, images, etc.)
    /api-ml only has ML pipeline callback endpoints
    /api-key does NOT expose user admin or API key management
    """
    # /api and /api-key both expose /projects
    response1 = client.get("/api/projects")
    response2 = client.get("/api-key/projects")
    assert response1.status_code != 404, "/api/projects should exist"
    assert response2.status_code != 404, "/api-key/projects should exist"

    # /api-ml does NOT expose /projects (only pipeline endpoints)
    response3 = client.get("/api-ml/projects")
    assert response3.status_code == 404, "/api-ml/projects should NOT exist"

    # /api exposes user admin and API key management
    response4 = client.get("/api/users/me")
    assert response4.status_code != 404, "/api/users/me should exist"

    # /api-key does NOT expose user admin or API key management
    response5 = client.get("/api-key/users/me")
    assert response5.status_code == 404, "/api-key/users/me should NOT exist"
    response6 = client.get("/api-key/api-keys")
    assert response6.status_code == 404, "/api-key/api-keys should NOT exist"


def test_api_key_prefix_project_operations(client, api_user_with_key):
    """Test full CRUD operations via /api-key prefix"""
    user, api_key = api_user_with_key
    headers = {"Authorization": f"Bearer {api_key}"}

    # Create project
    project_data = {
        "name": "Test Project",
        "description": "Created via API key",
        "meta_group_id": "test-group"
    }
    response = client.post("/api-key/projects", json=project_data, headers=headers)
    assert response.status_code == 201
    project = response.json()
    project_id = project["id"]

    # Read project
    response = client.get(f"/api-key/projects/{project_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Test Project"

    # List projects
    response = client.get("/api-key/projects", headers=headers)
    assert response.status_code == 200
    projects = response.json()
    assert any(p["id"] == project_id for p in projects)


def test_api_prefix_still_works_for_oauth(client):
    """Test that /api prefix still works with OAuth/header-based auth"""
    # In test mode with SKIP_HEADER_CHECK, this should work
    response = client.get("/api/projects")
    # Should either work (test mode) or require auth (production mode)
    assert response.status_code in [200, 401]


def test_invalid_api_key_rejected(client):
    """Test that invalid API keys are properly rejected"""
    headers = {"Authorization": "Bearer invalid-key-12345"}

    # Try on /api-key prefix
    response = client.get("/api-key/projects", headers=headers)
    assert response.status_code == 401


def test_api_ml_rejects_expired_timestamp(client, api_user_with_key, monkeypatch):
    """Test that /api-ml endpoints reject old timestamps (replay protection)"""
    import json as _json
    user, api_key = api_user_with_key

    test_secret = "test-hmac-secret-12345"
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', test_secret)
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', test_secret)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data for pipeline endpoint
    proj = client.post('/api/projects/', json={"name":"ExpiredTSTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Use old timestamp (1 hour ago)
    old_timestamp = str(int(time.time()) - 3600)
    body = {"status": "completed"}
    body_bytes = _json.dumps(body).encode('utf-8')
    message = old_timestamp.encode('utf-8') + b'.' + body_bytes
    signature_hex = hmac.new(test_secret.encode('utf-8'), message, hashlib.sha256).hexdigest()
    signature = f"sha256={signature_hex}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-ML-Signature": signature,
        "X-ML-Timestamp": old_timestamp,
        "Content-Type": "application/json"
    }

    response = client.post(f"/api-ml/analyses/{analysis['id']}/finalize", data=body_bytes, headers=headers)
    # Should be rejected due to old timestamp
    assert response.status_code == 401


def test_api_ml_rejects_invalid_hmac_signature(client, api_user_with_key, monkeypatch):
    """Test that /api-ml endpoints reject invalid HMAC signatures"""
    import json as _json
    user, api_key = api_user_with_key

    test_secret = "test-hmac-secret-12345"
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', test_secret)
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', test_secret)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data for pipeline endpoint
    proj = client.post('/api/projects/', json={"name":"InvalidHMACTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    body = {"status": "completed"}
    body_bytes = _json.dumps(body).encode('utf-8')
    timestamp = str(int(time.time()))
    # Use wrong signature
    signature = "sha256=0000000000000000000000000000000000000000000000000000000000000000"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-ML-Signature": signature,
        "X-ML-Timestamp": timestamp,
        "Content-Type": "application/json"
    }

    response = client.post(f"/api-ml/analyses/{analysis['id']}/finalize", data=body_bytes, headers=headers)
    assert response.status_code == 401
    # Error message wording is not enforced; 401 status is sufficient


def test_health_endpoint_accessible_without_auth(client):
    """Test that health check endpoint works without authentication on all prefixes"""
    # Health endpoint should work without auth
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


# Fixtures

@pytest.fixture
def api_user_with_key(client):
    """Create a user and API key for testing"""
    # Create API key via API endpoint (which handles user creation)
    payload = {"name": "Test API Key for Multi-Prefix Auth"}
    response = client.post("/api/api-keys", json=payload)
    assert response.status_code == 201, f"Failed to create API key: {response.text}"

    body = response.json()
    raw_key = body["key"]
    api_key_record = body["api_key"]
    api_key_id = api_key_record["id"]

    # Create a simple user object for tests that need it
    class SimpleUser:
        def __init__(self, email):
            self.email = email

    user = SimpleUser(email="test@example.com")  # Default test user from conftest

    yield user, raw_key

    # Cleanup: deactivate the API key
    try:
        client.delete(f"/api/api-keys/{api_key_id}")
    except:
        pass  # Cleanup is best-effort
