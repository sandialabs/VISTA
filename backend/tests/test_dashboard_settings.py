from routers import dashboard_settings
from utils import dependencies


def test_read_database_url(client):
    response = client.get("/api/dashboard/settings/database-url")

    assert response.status_code == 200
    assert response.json()["database_url"]


def test_read_database_url_requires_authentication(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "DEBUG", False)
    monkeypatch.setattr(dependencies.settings, "SKIP_HEADER_CHECK", False)
    monkeypatch.setattr(dependencies.settings, "PROXY_SHARED_SECRET", "test-secret")
    monkeypatch.setattr(
        dependencies.settings, "X_PROXY_SECRET_HEADER", "X-Proxy-Secret"
    )

    response = client.get("/api/dashboard/settings/database-url")

    assert response.status_code == 401


def test_preview_database_url_rejects_api_key_callers(client):
    response = client.post(
        "/api/dashboard/settings/database-url/preview",
        json={"database_url": "sqlite+aiosqlite:///:memory:"},
        headers={"Authorization": "Bearer some-api-key"},
    )

    assert response.status_code == 403
    assert "api key access is not allowed" in response.json()["detail"].lower()


def test_read_dashboard_version_returns_configured_commit_sha(client, monkeypatch):
    monkeypatch.setattr(
        dashboard_settings.settings, "GITLAB_COMMIT_SHA", " abc123def456 "
    )

    response = client.get("/api/dashboard/settings/version")

    assert response.status_code == 200
    assert response.json() == {"gitlab_commit_sha": "abc123def456"}


def test_read_dashboard_version_allows_unset_commit_sha(client, monkeypatch):
    monkeypatch.setattr(dashboard_settings.settings, "GITLAB_COMMIT_SHA", "")

    response = client.get("/api/dashboard/settings/version")

    assert response.status_code == 200
    assert response.json() == {"gitlab_commit_sha": ""}


def test_accept_database_url_switches_session_url(client, monkeypatch):
    async def fake_switch_database_url(database_url):
        return database_url

    monkeypatch.setattr(
        dashboard_settings, "switch_database_url", fake_switch_database_url
    )

    response = client.post(
        "/api/dashboard/settings/database-url/accept",
        json={"database_url": "postgresql+asyncpg://user:pass@db:5432/vista"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "database_url": "postgresql+asyncpg://user:pass@db:5432/vista"
    }


def test_accept_database_url_rejects_api_key_callers(client):
    response = client.post(
        "/api/dashboard/settings/database-url/accept",
        json={"database_url": "postgresql+asyncpg://user:pass@db:5432/vista"},
        headers={"Authorization": "Bearer some-api-key"},
    )

    assert response.status_code == 403
    assert "api key access is not allowed" in response.json()["detail"].lower()


def test_accept_database_url_rejects_unsupported_scheme(client):
    response = client.post(
        "/api/dashboard/settings/database-url/accept",
        json={"database_url": "mysql://user:pass@db/vista"},
    )

    assert response.status_code == 422
    assert "Database URL must use" in str(response.json())
