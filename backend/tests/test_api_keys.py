import os
import uuid
import pytest


def _auth_headers():
    # In tests, DEBUG and SKIP_HEADER_CHECK are true, so mock user works
    return {}


def test_create_list_deactivate_api_key(client):
    # Create an API key
    payload = {"name": "CI token"}
    r = client.post("/api/api-keys", json=payload, headers=_auth_headers())
    assert r.status_code == 201
    body = r.json()
    assert "key" in body and body["key"]
    api_key = body["api_key"]
    assert api_key["name"] == "CI token"
    assert api_key["is_active"] is True

    # List API keys
    r2 = client.get("/api/api-keys", headers=_auth_headers())
    assert r2.status_code == 200
    items = r2.json()
    assert len(items) >= 1
    key_id = uuid.UUID(items[0]["id"])  # sanity

    # Deactivate the key
    r3 = client.delete(f"/api/api-keys/{key_id}", headers=_auth_headers())
    assert r3.status_code == 204

    # Verify deactivated
    r4 = client.get("/api/api-keys", headers=_auth_headers())
    assert r4.status_code == 200
    found = next(k for k in r4.json() if k["id"] == str(key_id))
    assert found["is_active"] is False
