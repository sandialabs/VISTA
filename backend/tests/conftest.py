import pytest
import pytest_asyncio
import asyncio
import os
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from unittest.mock import Mock, patch
import uuid

# Set test environment variables before importing app components
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["FAST_TEST_MODE"] = "true"
os.environ["S3_ENDPOINT"] = "localhost:9000"
os.environ["S3_ACCESS_KEY"] = "test-key"
os.environ["S3_SECRET_KEY"] = "test-secret"
os.environ["S3_BUCKET"] = "test-bucket"
os.environ["SKIP_HEADER_CHECK"] = "true"
os.environ["DEBUG"] = "true"
os.environ["ML_CALLBACK_HMAC_SECRET"] = "test-hmac-secret-12345"  # Set explicitly for tests

from main import app
from core.database import Base, get_db
from core.schemas import User

# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    echo=True,
)

TestingSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture
def client():
    """Create test client with fresh database"""
    async def setup_db():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def teardown_db():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    loop.run_until_complete(setup_db())
    # Patch S3 helpers to avoid external calls during tests
    # Important: Patch where they are used (routers.images.*), not the module defining them
    from unittest.mock import patch
    with patch('routers.images.upload_file_to_s3', return_value=True), \
         patch('routers.images.get_presigned_download_url', return_value='http://example/presigned'):
        with TestClient(app) as c:
            yield c
    loop.run_until_complete(teardown_db())

@pytest_asyncio.fixture
async def db_session():
    """Create a test database session"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async with TestingSessionLocal() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
def mock_s3_client():
    """Mock S3 client for testing"""
    with patch('boto3_client.boto3_client') as mock_client:
        mock_client.upload_fileobj = Mock(return_value=True)
        mock_client.head_bucket = Mock(return_value=True)
        mock_client.create_bucket = Mock(return_value=True)
        mock_client.generate_presigned_url = Mock(return_value="http://test-url")
        yield mock_client

@pytest.fixture
def sample_user():
    """Sample user data for testing"""
    return {
        "id": str(uuid.uuid4()),
        "email": "test@example.com",
        "username": "testuser",
        "is_active": True,
        "groups": ["admin-group", "data-scientists"]
    }

@pytest.fixture
def sample_project():
    """Sample project data for testing"""
    return {
        "name": "Test Project",
        "description": "A test project",
        "meta_group_id": "test-group"
    }

@pytest.fixture
def auth_headers():
    """Sample authentication headers"""
    return {
        "X-User-Id": "test@example.com",
        "X-User-Groups": '["admin-group", "data-scientists"]'
    }
