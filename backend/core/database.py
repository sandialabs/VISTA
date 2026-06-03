from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import text
from typing import AsyncGenerator
import sys
from .config import settings


def normalize_async_database_url(database_url: str) -> str:
    """Return a SQLAlchemy async URL for supported VISTA databases."""
    normalized = (database_url or "").strip()
    if normalized.startswith('sqlite:') and not normalized.startswith('sqlite+aiosqlite:'):
        return normalized.replace('sqlite:', 'sqlite+aiosqlite:', 1)
    if normalized.startswith('postgresql://'):
        return normalized.replace('postgresql://', 'postgresql+asyncpg://', 1)
    return normalized


def _build_engine(database_url: str):
    return create_async_engine(
        normalize_async_database_url(database_url),
        echo=False,
        future=True,
    )


engine = _build_engine(settings.DATABASE_URL)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


def get_current_database_url() -> str:
    return settings.DATABASE_URL


async def validate_database_url(database_url: str) -> None:
    """Validate that a candidate database URL can be reached with the async driver."""
    candidate_engine = _build_engine(database_url)
    try:
        async with candidate_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    finally:
        await candidate_engine.dispose()


async def switch_database_url(database_url: str) -> str:
    """Switch this running backend process to a new database URL for the session."""
    global engine, AsyncSessionLocal

    cleaned_url = (database_url or "").strip()
    await validate_database_url(cleaned_url)

    old_engine = engine
    new_engine = _build_engine(cleaned_url)
    try:
        async with new_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        await new_engine.dispose()
        raise

    settings.DATABASE_URL = cleaned_url  # type: ignore[attr-defined]
    engine = new_engine
    AsyncSessionLocal.configure(bind=engine)
    await old_engine.dispose()
    return settings.DATABASE_URL


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

async def create_db_and_tables():
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        # Handle different types of database connection errors with user-friendly messages
        error_msg = str(e)
        print(f"   Current DATABASE_URL: {settings.DATABASE_URL}")

        if "gaierror" in error_msg or "Name or service not known" in error_msg:
            print("\n❌ DATABASE CONNECTION ERROR:")
            print("Cannot connect to PostgreSQL database.")
            print("The database hostname cannot be resolved.")
            print("\nPossible solutions:")
            print("1. Make sure PostgreSQL container is running: cd backend && ./run.sh")
            print("2. Check if Docker/container engine is running")
            print("3. Verify DATABASE_URL in .env file")
            print(f"   Current DATABASE_URL: {settings.DATABASE_URL}")

        elif "Connection refused" in error_msg:
            print("\n❌ DATABASE CONNECTION ERROR:")
            print("PostgreSQL database is not accepting connections.")
            print("The database server may not be running or is not ready yet.")
            print("\nPossible solutions:")
            print("1. Start PostgreSQL container: cd backend && ./run.sh")
            print("2. Wait for PostgreSQL to finish starting up")
            print(f"   Current DATABASE_URL: {settings.DATABASE_URL}")
            print("3. Check if the database port is correct (default: 5433)")

        elif "authentication failed" in error_msg or "password authentication failed" in error_msg:
            print("\n❌ DATABASE AUTHENTICATION ERROR:")
            print("Invalid database credentials.")
            print("\nPossible solutions:")
            print("1. Check database username/password in .env file")
            print("2. Verify PostgreSQL container was created with correct credentials")
            print(f"   Current credentials: {settings.POSTGRES_USER}@{settings.DATABASE_URL.split('@')[1] if '@' in settings.DATABASE_URL else 'unknown'}")

        elif "does not exist" in error_msg and "database" in error_msg:
            print("\n❌ DATABASE DOES NOT EXIST:")
            print("The specified database does not exist.")
            print(f"Database '{settings.POSTGRES_DB}' was not found.")
            print("\nPossible solutions:")
            print("1. Check database name in .env file")
            print("2. Recreate PostgreSQL container with correct database name")

        else:
            print("\n❌ DATABASE ERROR:")
            print("An unexpected database error occurred.")
            print(f"Error details: {error_msg}")
            print("\nGeneral solutions:")
            print("1. Make sure PostgreSQL container is running: cd backend && ./run.sh")
            print("2. Check your .env file configuration")

        print(f"\nFull error for debugging:")
        print(f"{type(e).__name__}: {error_msg}")
        sys.exit(1)
