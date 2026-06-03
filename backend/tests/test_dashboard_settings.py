from routers import dashboard_settings


def test_read_database_url(client):
    response = client.get("/api/dashboard/settings/database-url")

    assert response.status_code == 200
    assert response.json()["database_url"]


def test_accept_database_url_switches_session_url(client, monkeypatch):
    async def fake_switch_database_url(database_url):
        return database_url

    monkeypatch.setattr(dashboard_settings, "switch_database_url", fake_switch_database_url)

    response = client.post(
        "/api/dashboard/settings/database-url/accept",
        json={"database_url": "postgresql+asyncpg://user:pass@db:5432/vista"},
    )

    assert response.status_code == 200
    assert response.json() == {"database_url": "postgresql+asyncpg://user:pass@db:5432/vista"}


def test_accept_database_url_rejects_unsupported_scheme(client):
    response = client.post(
        "/api/dashboard/settings/database-url/accept",
        json={"database_url": "mysql://user:pass@db/vista"},
    )

    assert response.status_code == 422
    assert "Database URL must use" in str(response.json())
