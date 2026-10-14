"""Database access helpers for user accounts."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories.audit import log_db_operation
from schemas import users as user_schemas


async def get_user_by_email(db: AsyncSession, email: str) -> models.User | None:
    """Return the user with ``email``, or ``None`` if no such user exists."""
    result = await db.execute(select(models.User).where(models.User.email == email))
    return result.scalars().first()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> models.User | None:
    """Return the user with id ``user_id``, or ``None`` if no such user exists."""
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    return result.scalars().first()


async def create_user(
    db: AsyncSession,
    user: user_schemas.UserCreate,
    created_by: str | None = None,
) -> models.User:
    """Create a new user, keeping only the allowed fields, and log the creation."""
    payload = user.model_dump()
    allowed_keys = {"email", "username", "is_active"}
    filtered = {key: value for key, value in payload.items() if key in allowed_keys}
    db_user = models.User(**filtered)
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)

    log_db_operation(
        "CREATE", "users", db_user.id, created_by or "system", {"email": user.email}
    )
    return db_user


async def update_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    user_data: dict[str, Any],
    updated_by: str | None = None,
) -> models.User | None:
    """Update ``user_id`` with ``user_data`` and log the change."""
    db_user = await get_user_by_id(db, user_id)
    if not db_user:
        return None

    await db.execute(
        update(models.User).where(models.User.id == user_id).values(**user_data)
    )
    await db.commit()

    log_db_operation(
        "UPDATE", "users", user_id, updated_by or "system", {"changes": user_data}
    )

    return await get_user_by_id(db, user_id)
