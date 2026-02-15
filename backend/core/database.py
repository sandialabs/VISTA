from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from typing import AsyncGenerator
import logging
import sys
from .config import settings

logger = logging.getLogger(__name__)

# Use aiosqlite for SQLite URLs to support async operations
database_url = settings.DATABASE_URL
if database_url.startswith('sqlite:'):
    # Convert sqlite:// to sqlite+aiosqlite:// for async support
    database_url = database_url.replace('sqlite:', 'sqlite+aiosqlite:', 1)

engine = create_async_engine(
    database_url,
    echo=False,
    future=True
)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

async def create_db_and_tables():
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        error_msg = str(e)

        if "gaierror" in error_msg or "Name or service not known" in error_msg:
            logger.error(
                "DATABASE CONNECTION ERROR: Cannot resolve database hostname. "
                "Ensure PostgreSQL is running (cd backend && ./run.sh) and "
                "DATABASE_URL is correct in .env"
            )
        elif "Connection refused" in error_msg:
            logger.error(
                "DATABASE CONNECTION ERROR: PostgreSQL is not accepting connections. "
                "Start the container (cd backend && ./run.sh) or check the port (default: 5433)"
            )
        elif "authentication failed" in error_msg or "password authentication failed" in error_msg:
            logger.error(
                "DATABASE AUTHENTICATION ERROR: Invalid credentials. "
                "Check username/password in .env"
            )
        elif "does not exist" in error_msg and "database" in error_msg:
            logger.error(
                "DATABASE DOES NOT EXIST: Database '%s' not found. "
                "Check database name in .env", settings.POSTGRES_DB
            )
        else:
            logger.error("DATABASE ERROR: %s: %s", type(e).__name__, error_msg)

        logger.error("DATABASE_URL: %s", settings.DATABASE_URL)
        sys.exit(1)
