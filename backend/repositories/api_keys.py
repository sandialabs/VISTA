"""Database access helpers for API keys."""

from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import func

from core import models
from repositories.audit import log_db_operation
from schemas import api_keys as api_key_schemas


async def get_api_key_by_hash(db: AsyncSession, key_hash: str) -> models.ApiKey | None:
    """Return an API key by its hash, with the owning user eagerly loaded."""
    result = await db.execute(
        select(models.ApiKey)
        .options(selectinload(models.ApiKey.user))
        .where(models.ApiKey.key_hash == key_hash)
    )
    return result.scalars().first()


async def get_api_keys_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> list[models.ApiKey]:
    """Return all API keys belonging to a user, newest first."""
    result = await db.execute(
        select(models.ApiKey)
        .where(models.ApiKey.user_id == user_id)
        .order_by(models.ApiKey.created_at.desc())
    )
    return result.scalars().all()


async def get_all_active_api_keys(db: AsyncSession) -> list[models.ApiKey]:
    """Return all active API keys, with the owning user eagerly loaded."""
    result = await db.execute(
        select(models.ApiKey)
        .options(selectinload(models.ApiKey.user))
        .where(models.ApiKey.is_active)
    )
    return result.scalars().all()


async def create_api_key(
    db: AsyncSession,
    api_key: api_key_schemas.ApiKeyCreate,
    user_id: uuid.UUID,
    key_hash: str,
    created_by: str | None = None,
) -> models.ApiKey:
    """Create an API key for a user and log the creation."""
    db_api_key = models.ApiKey(
        user_id=user_id,
        key_hash=key_hash,
        name=api_key.name,
    )
    db.add(db_api_key)
    await db.commit()
    await db.refresh(db_api_key)

    log_db_operation(
        "CREATE",
        "api_keys",
        db_api_key.id,
        created_by or "system",
        {"name": api_key.name, "user_id": str(user_id)},
    )
    return db_api_key


async def update_api_key_last_used(db: AsyncSession, api_key_id: uuid.UUID) -> None:
    """Update the last-used timestamp for an API key."""
    await db.execute(
        update(models.ApiKey)
        .where(models.ApiKey.id == api_key_id)
        .values(last_used_at=func.now())
    )
    await db.commit()


async def deactivate_api_key(
    db: AsyncSession,
    api_key_id: uuid.UUID,
    deactivated_by: str | None = None,
) -> bool:
    """Deactivate an API key and log the change, returning whether it existed."""
    result = await db.execute(
        select(models.ApiKey).where(models.ApiKey.id == api_key_id)
    )
    db_api_key = result.scalars().first()
    if not db_api_key:
        return False

    await db.execute(
        update(models.ApiKey)
        .where(models.ApiKey.id == api_key_id)
        .values(is_active=False)
    )
    await db.commit()

    log_db_operation(
        "UPDATE",
        "api_keys",
        api_key_id,
        deactivated_by or "system",
        {"deactivated": True},
    )
    return True
