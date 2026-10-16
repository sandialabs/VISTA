"""Fixtures for the opt-in, Alembic-backed PostgreSQL integration lane."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from alembic import command
from core import database as core_database
from core.config import settings
from core.database import get_db
from main import app

BACKEND_ROOT = Path(__file__).resolve().parents[2]
POSTGRES_TEST_DATABASE_ENV = "VISTA_POSTGRES_TEST_DATABASE_URL"


@dataclass(frozen=True)
class PostgresTestUrls:
    async_url: str
    sync_url: str


def _postgres_test_urls(raw_url: str) -> PostgresTestUrls:
    parsed = make_url(raw_url.strip())
    if parsed.get_backend_name() not in {"postgres", "postgresql"}:
        raise ValueError(
            f"{POSTGRES_TEST_DATABASE_ENV} must be a PostgreSQL URL, "
            f"not {parsed.get_backend_name()!r}"
        )
    database_name = (parsed.database or "").lower()
    if not (database_name.startswith("test_") or database_name.endswith("_test")):
        raise ValueError(
            f"{POSTGRES_TEST_DATABASE_ENV} must select a dedicated test "
            "database whose name starts with 'test_' or ends with '_test'; "
            f"refusing database {parsed.database!r}"
        )
    return PostgresTestUrls(
        async_url=parsed.set(drivername="postgresql+asyncpg").render_as_string(
            hide_password=False
        ),
        sync_url=parsed.set(drivername="postgresql+psycopg2").render_as_string(
            hide_password=False
        ),
    )


def _alembic_config(sync_url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    # ConfigParser treats percent-encoded URL characters as interpolation.
    config.set_main_option("sqlalchemy.url", sync_url.replace("%", "%%"))
    return config


@pytest.fixture(scope="session")
def postgres_test_urls() -> PostgresTestUrls:
    raw_url = os.getenv(POSTGRES_TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(
            f"set {POSTGRES_TEST_DATABASE_ENV} to run PostgreSQL integration tests"
        )
    try:
        return _postgres_test_urls(raw_url)
    except ValueError as error:
        pytest.fail(str(error), pytrace=False)


@pytest.fixture(scope="session")
def postgres_migrated_database(
    postgres_test_urls: PostgresTestUrls,
) -> PostgresTestUrls:
    """Bring the explicitly selected test database to Alembic head.

    This lane intentionally creates schema only through Alembic. CI first
    upgrades a fresh database to the previous revision and then to head; this
    idempotent fixture also makes the opt-in local command convenient.
    """

    original_database_url = settings.DATABASE_URL
    settings.DATABASE_URL = postgres_test_urls.async_url
    try:
        command.upgrade(
            _alembic_config(postgres_test_urls.sync_url),
            "head",
        )
    finally:
        settings.DATABASE_URL = original_database_url
    return postgres_test_urls


@pytest.fixture
def postgres_engine(postgres_migrated_database: PostgresTestUrls):
    # NullPool keeps connections bound to the event loop that created them.
    # Tests use both pytest-asyncio and TestClient's background event loop.
    engine = create_async_engine(
        postgres_migrated_database.async_url,
        poolclass=NullPool,
    )
    original_database_url = settings.DATABASE_URL
    original_engine = core_database.engine
    original_session_bind = core_database.AsyncSessionLocal.kw.get("bind")
    settings.DATABASE_URL = postgres_migrated_database.async_url
    core_database.engine = engine
    core_database.AsyncSessionLocal.configure(bind=engine)
    try:
        yield engine
    finally:
        core_database.AsyncSessionLocal.configure(bind=original_session_bind)
        core_database.engine = original_engine
        settings.DATABASE_URL = original_database_url
        asyncio.run(engine.dispose())


@pytest.fixture
def postgres_session_factory(postgres_engine):
    return async_sessionmaker(
        bind=postgres_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


async def _truncate_application_tables(postgres_engine) -> None:
    async with postgres_engine.begin() as connection:
        table_names = (
            (
                await connection.execute(
                    text(
                        """
                    SELECT tablename
                    FROM pg_catalog.pg_tables
                    WHERE schemaname = current_schema()
                      AND tablename <> 'alembic_version'
                    ORDER BY tablename
                    """
                    )
                )
            )
            .scalars()
            .all()
        )
        if not table_names:
            return
        preparer = connection.dialect.identifier_preparer
        quoted_tables = ", ".join(preparer.quote(name) for name in table_names)
        await connection.execute(
            text(f"TRUNCATE TABLE {quoted_tables} RESTART IDENTITY CASCADE")
        )


@pytest_asyncio.fixture(autouse=True)
async def clean_postgres_database(postgres_engine):
    await _truncate_application_tables(postgres_engine)
    yield
    await _truncate_application_tables(postgres_engine)


@pytest.fixture
def postgres_client(postgres_session_factory):
    async def override_get_db():
        async with postgres_session_factory() as session:
            yield session

    sentinel = object()
    previous_override = app.dependency_overrides.get(get_db, sentinel)
    app.dependency_overrides[get_db] = override_get_db
    try:
        with (
            patch("services.images.upload.upload_file_to_s3", return_value=True),
            patch(
                "routers.images.get_presigned_download_url",
                return_value="http://example.test/presigned",
            ),
            TestClient(app) as client,
        ):
            yield client
    finally:
        if previous_override is sentinel:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override


@pytest.fixture
def production_proxy_headers(monkeypatch):
    shared_secret = "postgres-integration-proxy-secret"
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SKIP_HEADER_CHECK", False)
    monkeypatch.setattr(settings, "PROXY_SHARED_SECRET", shared_secret)
    monkeypatch.setattr(settings, "X_USER_ID_HEADER", "X-User-Email")
    monkeypatch.setattr(settings, "X_PROXY_SECRET_HEADER", "X-Proxy-Secret")
    return {
        "X-User-Email": settings.MOCK_USER_EMAIL,
        "X-Proxy-Secret": shared_secret,
    }
