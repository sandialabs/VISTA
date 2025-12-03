import pytest
from sqlalchemy.ext.asyncio import AsyncSession
import utils.crud as crud
from core import schemas
from core.models import User

@pytest.mark.asyncio
async def test_create_and_get_user(db_session: AsyncSession):
    """
    Test creating a new user and retrieving it from the database.
    """
    user_in = schemas.UserCreate(email="test@example.com", username="testuser")
    db_user = await crud.create_user(db_session, user_in)
    
    assert db_user.email == "test@example.com"
    assert db_user.username == "testuser"
    assert db_user.id is not None
    
    retrieved_user = await crud.get_user_by_email(db_session, "test@example.com")
    assert retrieved_user is not None
    assert retrieved_user.email == "test@example.com"

@pytest.mark.asyncio
async def test_get_user_by_email_not_found(db_session: AsyncSession):
    """
    Test retrieving a non-existent user by email.
    """
    retrieved_user = await crud.get_user_by_email(db_session, "nonexistent@example.com")
    assert retrieved_user is None
