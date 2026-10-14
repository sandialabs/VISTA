"""Database access helpers for image comments."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import models
from repositories.audit import log_db_operation
from schemas import comments as comment_schemas


async def get_comment(
    db: AsyncSession,
    comment_id: uuid.UUID,
) -> models.ImageComment | None:
    """Return a comment by ID, with its author eagerly loaded."""
    result = await db.execute(
        select(models.ImageComment)
        .options(selectinload(models.ImageComment.author))
        .where(models.ImageComment.id == comment_id)
    )
    return result.scalars().first()


async def get_comments_for_image(
    db: AsyncSession,
    image_id: uuid.UUID,
) -> list[models.ImageComment]:
    """Return all comments for an image, oldest first."""
    result = await db.execute(
        select(models.ImageComment)
        .options(selectinload(models.ImageComment.author))
        .where(models.ImageComment.image_id == image_id)
        .order_by(models.ImageComment.created_at)
    )
    return result.scalars().all()


async def create_comment(
    db: AsyncSession,
    comment: comment_schemas.ImageCommentCreate,
    created_by: str | None = None,
) -> models.ImageComment:
    """Create a comment, log the creation, and return it with its author loaded."""
    db_comment = models.ImageComment(**comment.model_dump())
    db.add(db_comment)
    await db.commit()
    await db.refresh(db_comment)

    log_db_operation(
        "CREATE",
        "image_comments",
        db_comment.id,
        created_by or "system",
        {"image_id": str(comment.image_id), "text_length": len(comment.text)},
    )

    result = await db.execute(
        select(models.ImageComment)
        .options(selectinload(models.ImageComment.author))
        .where(models.ImageComment.id == db_comment.id)
    )
    return result.scalars().first()


async def update_comment(
    db: AsyncSession,
    comment_id: uuid.UUID,
    comment_data: dict[str, Any],
    updated_by: str | None = None,
) -> models.ImageComment | None:
    """Update a comment's fields, log the change, and return the updated row."""
    db_comment = await get_comment(db, comment_id)
    if not db_comment:
        return None

    await db.execute(
        update(models.ImageComment)
        .where(models.ImageComment.id == comment_id)
        .values(**comment_data)
    )
    await db.commit()

    log_db_operation(
        "UPDATE",
        "image_comments",
        comment_id,
        updated_by or "system",
        {"changes": comment_data},
    )

    return await get_comment(db, comment_id)


async def delete_comment(
    db: AsyncSession,
    comment_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    """Delete a comment and log the deletion, returning whether it existed."""
    db_comment = await get_comment(db, comment_id)
    if not db_comment:
        return False

    log_db_operation(
        "DELETE",
        "image_comments",
        comment_id,
        deleted_by or "system",
        {"text_length": len(db_comment.text)},
    )

    await db.execute(
        delete(models.ImageComment).where(models.ImageComment.id == comment_id)
    )
    await db.commit()
    return True
