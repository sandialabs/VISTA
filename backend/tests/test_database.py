import pytest
from unittest.mock import patch
import asyncpg
from core.database import create_db_and_tables, get_db, Base


class TestDatabase:
    """Test database functionality"""

    @pytest.mark.asyncio
    async def test_create_db_and_tables_success(self):
        """Should succeed under sqlite memory DB configured in conftest."""
        await create_db_and_tables()

    @pytest.mark.asyncio
    async def test_create_db_and_tables_connection_error(self):
        """Simulate 'database does not exist' error and expect sys.exit(1)."""
        exc = asyncpg.exceptions.InvalidCatalogNameError("database does not exist")
        with patch.object(Base.metadata, 'create_all', side_effect=exc):
            with patch('sys.exit') as mock_exit:
                await create_db_and_tables()
                mock_exit.assert_called_once_with(1)

    @pytest.mark.asyncio
    async def test_create_db_and_tables_name_resolution_error(self):
        """Simulate DNS resolution error and expect sys.exit(1)."""
        error = Exception("Name or service not known")
        with patch.object(Base.metadata, 'create_all', side_effect=error):
            with patch('sys.exit') as mock_exit:
                await create_db_and_tables()
                mock_exit.assert_called_once_with(1)

    @pytest.mark.asyncio
    async def test_create_db_and_tables_authentication_error(self):
        """Simulate authentication error and expect sys.exit(1)."""
        error = Exception("password authentication failed")
        with patch.object(Base.metadata, 'create_all', side_effect=error):
            with patch('sys.exit') as mock_exit:
                await create_db_and_tables()
                mock_exit.assert_called_once_with(1)

    @pytest.mark.asyncio
    async def test_create_db_and_tables_connection_refused(self):
        """Simulate connection refused error and expect sys.exit(1)."""
        error = Exception("Connection refused")
        with patch.object(Base.metadata, 'create_all', side_effect=error):
            with patch('sys.exit') as mock_exit:
                await create_db_and_tables()
                mock_exit.assert_called_once_with(1)

    def test_get_db_is_async_gen(self):
        """get_db should be an async generator."""
        gen = get_db()
        assert hasattr(gen, "__aiter__") or hasattr(gen, "__anext__")