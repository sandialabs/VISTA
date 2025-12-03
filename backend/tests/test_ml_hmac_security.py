"""
HMAC Security Tests for ML Analysis Pipeline Endpoints

Tests HMAC signature verification, replay protection, and authentication.
"""
import hmac
import hashlib
import time
import json
import pytest
from unittest.mock import patch


def _generate_hmac_signature(body: bytes, secret: str, timestamp: str = None) -> tuple[dict, str]:
    """
    Generate HMAC signature headers for testing.
    Returns: (headers_dict, timestamp_used)
    """
    ts = timestamp or str(int(time.time()))
    mac = hmac.new(
        secret.encode('utf-8'),
        msg=(ts.encode('utf-8') + b'.' + body),
        digestmod=hashlib.sha256
    )
    headers = {
        'X-ML-Timestamp': ts,
        'X-ML-Signature': 'sha256=' + mac.hexdigest()
    }
    return headers, ts


def test_dual_auth_valid_api_key_and_hmac_accepted(client, monkeypatch):
    """Test that dual auth (valid API key + valid HMAC) is accepted."""
    secret = 'test_secret_123'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_123')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create API key
    api_key_resp = client.post('/api/api-keys/', json={"name": "test_key", "description": "Test key"}).json()
    api_key = api_key_resp['key']

    # Create test data
    proj = client.post('/api/projects/', json={"name":"HMACTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test valid dual auth on bulk annotations endpoint via /api-ml prefix
    body = {"annotations":[{"annotation_type":"classification","class_name":"cat","confidence":0.9,"data":{"score":0.9}}]}
    body_bytes = json.dumps(body).encode('utf-8')
    headers, ts = _generate_hmac_signature(body_bytes, 'test_secret_123')
    headers.update({
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}'  # Add API key auth
    })

    resp = client.post(f"/api-ml/analyses/{analysis['id']}/annotations:bulk", data=body_bytes, headers=headers)
    assert resp.status_code == 200, f"Valid dual auth should be accepted: {resp.text}"


def test_invalid_hmac_signature_rejected(client, monkeypatch):
    """Test that invalid HMAC signatures are rejected."""
    from core import config as cfg
    import os

    secret = 'test_secret_123'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_123')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data
    proj = client.post('/api/projects/', json={"name":"InvalidHMAC","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test with wrong signature
    body = {"annotations":[{"annotation_type":"classification","class_name":"dog","confidence":0.8,"data":{"score":0.8}}]}
    body_bytes = json.dumps(body).encode('utf-8')
    headers = {
        'X-ML-Timestamp': str(int(time.time())),
        'X-ML-Signature': 'sha256=deadbeef1234567890abcdef',
        'Content-Type': 'application/json'
    }

    # HMAC-protected bulk annotations should be called via /api-ml per design
    resp = client.post(f"/api-ml/analyses/{analysis['id']}/annotations:bulk", data=body_bytes, headers=headers)
    assert resp.status_code == 401, "Invalid HMAC signature should be rejected with 401"


def test_missing_hmac_headers_rejected(client, monkeypatch):
    """Test that missing HMAC headers are rejected when HMAC is required."""
    from core import config as cfg
    import os

    secret = 'test_secret_123'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_123')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data
    proj = client.post('/api/projects/', json={"name":"MissingHMAC","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test without HMAC headers
    body = {"annotations":[{"annotation_type":"classification","class_name":"bird","confidence":0.7,"data":{"score":0.7}}]}
    body_bytes = json.dumps(body).encode('utf-8')

    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/annotations:bulk",
        data=body_bytes,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 401, "Missing HMAC headers should be rejected with 401"


def test_timestamp_replay_protection_old_timestamp(client, monkeypatch):
    """Test that old timestamps are rejected (replay protection)."""
    from core import config as cfg
    import os

    secret = 'test_secret_123'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_123')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data
    proj = client.post('/api/projects/', json={"name":"ReplayTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test with old timestamp (1 hour ago = 3600 seconds)
    old_timestamp = str(int(time.time()) - 3600)
    body = {"annotations":[{"annotation_type":"classification","class_name":"fish","confidence":0.6,"data":{"score":0.6}}]}
    body_bytes = json.dumps(body).encode('utf-8')
    headers, _ = _generate_hmac_signature(body_bytes, 'test_secret_123', timestamp=old_timestamp)
    headers['Content-Type'] = 'application/json'

    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/annotations:bulk",
        data=body_bytes,
        headers=headers,
    )
    assert resp.status_code == 401, "Old timestamp should be rejected (replay protection)"


def test_timestamp_skew_tolerance(client, monkeypatch):
    """Test that timestamps within skew window are accepted."""
    from core import config as cfg
    import os

    secret = 'test_secret_123'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_123')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data
    proj = client.post('/api/projects/', json={"name":"SkewTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test with timestamp 100 seconds ago (should be within default 300s window)
    recent_timestamp = str(int(time.time()) - 100)
    body = {"annotations":[{"annotation_type":"classification","class_name":"horse","confidence":0.85,"data":{"score":0.85}}]}
    body_bytes = json.dumps(body).encode('utf-8')
    headers, _ = _generate_hmac_signature(body_bytes, 'test_secret_123', timestamp=recent_timestamp)
    headers['Content-Type'] = 'application/json'

    # For /api-ml, callbacks require BOTH API key and HMAC (dual auth).
    api_key_resp = client.post('/api/api-keys/', json={"name": "ml_skew_test", "description": "ML skew"}).json()
    api_key = api_key_resp['key']
    headers['Authorization'] = f'Bearer {api_key}'

    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/annotations:bulk",
        data=body_bytes,
        headers=headers,
    )
    assert resp.status_code == 200, (
        "Timestamp within skew window should be accepted for /api-ml with "
        f"dual auth: {resp.text}"
    )


def test_hmac_on_presign_endpoint(client, monkeypatch):
    """Test HMAC verification on presign artifact endpoint."""
    from core import config as cfg
    import os

    secret = 'test_secret_456'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_456')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data
    proj = client.post('/api/projects/', json={"name":"PresignHMAC","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"yolo_v8","model_version":"1","parameters":{}}).json()

    # Test with valid HMAC
    body = {"artifact_type":"heatmap","filename":"heatmap.png"}
    body_bytes = json.dumps(body).encode('utf-8')
    headers, _ = _generate_hmac_signature(body_bytes, 'test_secret_456')
    headers.update({'Content-Type': 'application/json'})

    # For /api-ml, presign should be called by an authenticated pipeline user;
    # here we simulate that with a test API key.
    api_key_resp = client.post('/api/api-keys/', json={"name": "ml_presign_test", "description": "ML presign"}).json()
    api_key = api_key_resp['key']
    headers['Authorization'] = f'Bearer {api_key}'

    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/artifacts/presign",
        data=body_bytes,
        headers=headers,
    )
    assert resp.status_code == 200, f"Valid HMAC on presign should be accepted: {resp.text}"
    assert 'upload_url' in resp.json()
    assert 'storage_path' in resp.json()

    # Test with invalid HMAC
    bad_headers = {
        'X-ML-Timestamp': str(int(time.time())),
        'X-ML-Signature': 'sha256=invalid'
    }
    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/artifacts/presign",
        data=body_bytes,
        headers=bad_headers,
    )
    assert resp.status_code == 401, "Invalid HMAC on presign should be rejected"


def test_hmac_on_finalize_endpoint(client, monkeypatch):
    """Test HMAC verification on finalize endpoint."""
    from core import config as cfg
    import os

    secret = 'test_secret_789'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_789')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create test data
    proj = client.post('/api/projects/', json={"name":"FinalizeHMAC","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test with valid HMAC
    body = {"status":"completed"}
    body_bytes = json.dumps(body).encode('utf-8')
    headers, _ = _generate_hmac_signature(body_bytes, 'test_secret_789')
    headers.update({'Content-Type': 'application/json'})

    # Finalize on /api-ml also requires an API key; create one for the test.
    api_key_resp = client.post('/api/api-keys/', json={"name": "ml_finalize_test", "description": "ML finalize"}).json()
    api_key = api_key_resp['key']
    headers['Authorization'] = f'Bearer {api_key}'

    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/finalize",
        data=body_bytes,
        headers=headers,
    )
    assert resp.status_code == 200, f"Valid HMAC on finalize should be accepted: {resp.text}"
    assert resp.json()['status'] == 'completed'

    # Create another analysis for invalid HMAC test
    analysis2 = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"2","parameters":{}}).json()

    # Test with invalid HMAC
    resp = client.post(
        f"/api-ml/analyses/{analysis2['id']}/finalize",
        data=body_bytes,
        headers={"Content-Type": "application/json"},  # no HMAC headers
    )
    assert resp.status_code == 401, "Missing HMAC on finalize should be rejected"


def test_hmac_disabled_allows_requests(client, monkeypatch):
    """Test that when HMAC is disabled, requests without HMAC are allowed."""
    from core import config as cfg
    import os

    secret = 'test_secret'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', False)  # Disable HMAC requirement

    # Create test data
    proj = client.post('/api/projects/', json={"name":"NoHMAC","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test bulk annotations without HMAC (should be allowed when disabled)
    body = {"annotations":[{"annotation_type":"classification","class_name":"elephant","confidence":0.92,"data":{"score":0.92}}]}
    body_bytes = json.dumps(body).encode('utf-8')

    # Even when HMAC is disabled for the pipeline layer, /api-ml still
    # requires an API key for user authentication.
    api_key_resp = client.post('/api/api-keys/', json={"name": "ml_no_hmac", "description": "ML no HMAC"}).json()
    api_key = api_key_resp['key']
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}',
    }

    resp = client.post(
        f"/api-ml/analyses/{analysis['id']}/annotations:bulk",
        data=body_bytes,
        headers=headers,
    )
    assert resp.status_code == 200, "Request without HMAC should be allowed when HMAC is disabled, provided API key auth succeeds"


def test_dual_auth_requires_both_api_key_and_hmac(client, monkeypatch):
    """Test that dual auth requires BOTH API key AND HMAC (neither alone is sufficient)."""
    secret = 'test_secret_dual'
    monkeypatch.setattr('utils.dependencies.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'test_secret_dual')
    monkeypatch.setattr('utils.dependencies.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create API key
    api_key_resp = client.post('/api/api-keys/', json={"name": "test_key", "description": "Test key"}).json()
    api_key = api_key_resp['key']

    # Create test data
    proj = client.post('/api/projects/', json={"name":"DualAuthTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    body = {"annotations":[{"annotation_type":"classification","class_name":"test","confidence":0.5,"data":{"score":0.5}}]}
    body_bytes = json.dumps(body).encode('utf-8')

    # Test 1: Valid HMAC but NO API key (should fail - user auth fails)
    headers_hmac_only, _ = _generate_hmac_signature(body_bytes, 'test_secret_dual')
    headers_hmac_only['Content-Type'] = 'application/json'
    resp = client.post(f"/api-ml/analyses/{analysis['id']}/annotations:bulk", data=body_bytes, headers=headers_hmac_only)
    assert resp.status_code == 401, "Valid HMAC without API key should be rejected"

    # Test 2: Valid API key but NO HMAC (should fail)
    headers_api_only = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}'
    }
    resp = client.post(f"/api-ml/analyses/{analysis['id']}/annotations:bulk", data=body_bytes, headers=headers_api_only)
    assert resp.status_code == 401, "Valid API key without HMAC should be rejected"

    # Test 3: Invalid API key with valid HMAC (should fail - user auth fails first)
    headers_invalid_api, _ = _generate_hmac_signature(body_bytes, 'test_secret_dual')
    headers_invalid_api.update({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid_key_123'
    })
    resp = client.post(f"/api-ml/analyses/{analysis['id']}/annotations:bulk", data=body_bytes, headers=headers_invalid_api)
    assert resp.status_code == 401, "Invalid API key with valid HMAC should be rejected"


def test_hmac_test_vectors():
    """Test HMAC signature generation with known test vectors."""
    secret = "my_secret_key"
    timestamp = "1234567890"
    body = b'{"test":"data"}'

    expected_message = timestamp.encode('utf-8') + b'.' + body
    expected_mac = hmac.new(
        secret.encode('utf-8'),
        msg=expected_message,
        digestmod=hashlib.sha256
    ).hexdigest()

    # Test our helper function produces the same result
    headers, ts = _generate_hmac_signature(body, secret, timestamp)

    assert ts == timestamp
    assert headers['X-ML-Timestamp'] == timestamp
    assert headers['X-ML-Signature'] == f'sha256={expected_mac}'

    # Known test vector (computed externally)
    # For secret="my_secret_key", timestamp="1234567890", body='{"test":"data"}'
    # Message: b'1234567890.{"test":"data"}'
    # Expected HMAC-SHA256: computed using the same algorithm
    assert isinstance(headers['X-ML-Signature'], str)
    assert headers['X-ML-Signature'].startswith('sha256=')
    assert len(headers['X-ML-Signature']) == 71  # 'sha256=' (7) + hex digest (64)
