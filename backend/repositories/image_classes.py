"""Database access helpers for image classes and image classifications."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core import models
from repositories.audit import log_db_operation
from schemas import image_classes as image_class_schemas


async def get_image_class(
    db: AsyncSession,
    class_id: uuid.UUID,
) -> models.ImageClass | None:
    """Return the image class with id ``class_id``, or ``None`` if absent."""
    result = await db.execute(
        select(models.ImageClass).where(models.ImageClass.id == class_id)
    )
    return result.scalars().first()


async def get_image_classes_for_project(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> list[models.ImageClass]:
    """Return all image classes defined for ``project_id``."""
    result = await db.execute(
        select(models.ImageClass).where(models.ImageClass.project_id == project_id)
    )
    return result.scalars().all()


async def create_image_class(
    db: AsyncSession,
    image_class: image_class_schemas.ImageClassCreate,
    created_by: str | None = None,
) -> models.ImageClass:
    """Create a new image class and log the creation."""
    db_image_class = models.ImageClass(**image_class.model_dump())
    db.add(db_image_class)
    await db.commit()
    await db.refresh(db_image_class)

    log_db_operation(
        "CREATE",
        "image_classes",
        db_image_class.id,
        created_by or "system",
        {"name": image_class.name, "project_id": str(image_class.project_id)},
    )
    return db_image_class


async def update_image_class(
    db: AsyncSession,
    class_id: uuid.UUID,
    image_class_data: dict[str, Any],
    updated_by: str | None = None,
) -> models.ImageClass | None:
    """Update ``class_id`` with ``image_class_data`` and log the change."""
    db_image_class = await get_image_class(db, class_id)
    if not db_image_class:
        return None

    await db.execute(
        update(models.ImageClass)
        .where(models.ImageClass.id == class_id)
        .values(**image_class_data)
    )
    await db.commit()

    log_db_operation(
        "UPDATE",
        "image_classes",
        class_id,
        updated_by or "system",
        {"changes": image_class_data},
    )

    return await get_image_class(db, class_id)


async def delete_image_class(
    db: AsyncSession,
    class_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    """Delete ``class_id`` and log the deletion. Return whether it existed."""
    db_image_class = await get_image_class(db, class_id)
    if not db_image_class:
        return False

    log_db_operation(
        "DELETE",
        "image_classes",
        class_id,
        deleted_by or "system",
        {"name": db_image_class.name},
    )

    await db.execute(delete(models.ImageClass).where(models.ImageClass.id == class_id))
    await db.commit()
    return True


async def get_image_classification(
    db: AsyncSession,
    classification_id: uuid.UUID,
) -> models.ImageClassification | None:
    """Return the image classification with id ``classification_id``."""
    result = await db.execute(
        select(models.ImageClassification)
        .options(selectinload(models.ImageClassification.image_class))
        .where(models.ImageClassification.id == classification_id)
    )
    return result.scalars().first()


async def get_classifications_for_image(
    db: AsyncSession,
    image_id: uuid.UUID,
) -> list[models.ImageClassification]:
    """Return all image classifications for ``image_id``."""
    result = await db.execute(
        select(models.ImageClassification)
        .options(selectinload(models.ImageClassification.image_class))
        .where(models.ImageClassification.image_id == image_id)
    )
    return result.scalars().all()


async def create_image_classification(
    db: AsyncSession,
    classification: image_class_schemas.ImageClassificationCreate,
    created_by: str | None = None,
) -> models.ImageClassification:
    """Create a new image classification and log the creation."""
    db_classification = models.ImageClassification(**classification.model_dump())
    db.add(db_classification)
    await db.commit()
    await db.refresh(db_classification)

    log_db_operation(
        "CREATE",
        "image_classifications",
        db_classification.id,
        created_by or "system",
        {
            "image_id": str(classification.image_id),
            "class_id": str(classification.class_id),
        },
    )

    result = await db.execute(
        select(models.ImageClassification).where(
            models.ImageClassification.id == db_classification.id
        )
    )
    return result.scalars().first()


async def delete_image_classification(
    db: AsyncSession,
    classification_id: uuid.UUID,
    deleted_by: str | None = None,
) -> bool:
    """Delete ``classification_id`` and log the deletion. Return whether it existed."""
    db_classification = await get_image_classification(db, classification_id)
    if not db_classification:
        return False

    log_db_operation(
        "DELETE",
        "image_classifications",
        classification_id,
        deleted_by or "system",
        {
            "image_id": str(db_classification.image_id),
            "class_id": str(db_classification.class_id),
        },
    )

    await db.execute(
        delete(models.ImageClassification).where(
            models.ImageClassification.id == classification_id
        )
    )
    await db.commit()
    return True
