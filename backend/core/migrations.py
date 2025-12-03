"""Deprecated ad-hoc migration module.

This file is retained temporarily for backward compatibility imports.
All schema evolution is now handled by Alembic migrations.
"""

async def run_migrations():  # noqa: D401
    """No-op placeholder; real migrations executed via Alembic."""
    return
