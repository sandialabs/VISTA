from __future__ import annotations

import pytest

from core import database as core_database
from tests.postgres.conftest import _postgres_test_urls


@pytest.mark.parametrize(
    ("raw_url", "database_name"),
    [
        (
            "postgresql://user:password@localhost/test_vista",
            "test_vista",
        ),
        (
            "postgresql+psycopg2://user:password@localhost/vista_test",
            "vista_test",
        ),
    ],
)
def test_postgres_lane_accepts_only_clearly_test_named_databases(
    raw_url,
    database_name,
):
    urls = _postgres_test_urls(raw_url)

    assert urls.async_url.endswith(f"/{database_name}")
    assert urls.sync_url.endswith(f"/{database_name}")
    assert urls.async_url.startswith("postgresql+asyncpg://")
    assert urls.sync_url.startswith("postgresql+psycopg2://")


@pytest.mark.parametrize(
    "database_name",
    [
        "",
        "postgres",
        "template0",
        "template1",
        "vista",
        "production",
    ],
)
def test_postgres_lane_rejects_non_test_database_names(database_name):
    database_suffix = f"/{database_name}" if database_name else ""

    with pytest.raises(ValueError, match="dedicated test database"):
        _postgres_test_urls("postgresql://user:password@localhost" + database_suffix)


def test_postgres_lane_rejects_non_postgres_urls():
    with pytest.raises(ValueError, match="must be a PostgreSQL URL"):
        _postgres_test_urls("sqlite+aiosqlite:///vista_test")


def test_fast_suite_keeps_its_default_sqlite_database_binding():
    assert core_database.engine.url.get_backend_name() == "sqlite"
    assert core_database.AsyncSessionLocal.kw["bind"] is core_database.engine
