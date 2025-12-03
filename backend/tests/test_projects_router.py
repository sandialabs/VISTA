import uuid
import pytest


def test_projects_list_initially_empty(client):
    r = client.get("/api/projects/")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_read_project(client):
    payload = {"name": "P1", "description": "d", "meta_group_id": "g1"}
    r = client.post("/api/projects/", json=payload)
    assert r.status_code == 201
    proj = r.json()
    pid = proj["id"]
    r2 = client.get(f"/api/projects/{pid}")
    assert r2.status_code == 200
    assert r2.json()["name"] == "P1"
