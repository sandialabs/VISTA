from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from typing import AsyncGenerator
import sys
from .config import settings

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
