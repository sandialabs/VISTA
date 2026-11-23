def test_users_me_endpoint(client):
    r = client.get("/api/users/me")
    assert r.status_code == 200
    me = r.json()
    assert me["email"].endswith("@example.com")


def test_create_and_get_user(client):
    payload = {"email": "u1@example.com", "username": "u1"}
    r = client.post("/api/users/", json=payload)
    # In debug mode, admin checks pass and user creation succeeds with 201
    assert r.status_code == 201
    created = r.json()
    uid = created["id"]
    r2 = client.get(f"/api/users/{uid}")
    assert r2.status_code == 200
    assert r2.json()["email"] == "u1@example.com"


def test_update_user_self(client):
    # Create user
    payload = {"email": "u2@example.com", "username": "u2"}
    r = client.post("/api/users/", json=payload)
    # In debug mode, admin checks pass and user creation succeeds with 201
    assert r.status_code == 201
    uid = r.json()["id"]
    # Update same user allowed when DEBUG mock bypass returns True for group checks
    upd = {"email": "u2@example.com", "username": "u2x"}
    r2 = client.patch(f"/api/users/{uid}", json=upd)
    assert r2.status_code == 200
    assert r2.json()["username"] == "u2x"


def test_current_user_groups_listed_before_any_project_exists(client):
    """Groups come from the auth backend, not from existing projects, so a new
    access group appears before anyone has created a project in it."""
    from core.config import settings

    r = client.get("/api/users/me/groups")
    assert r.status_code == 200
    assert r.json() == sorted(set(settings.MOCK_USER_GROUPS))
