import uuid
from sqlalchemy import select, update, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from core import models, schemas
from typing import List, Optional, Dict, Any

from ._common import log_db_operation


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[models.User]:
    result = await db.execute(select(models.User).where(models.User.email == email))
    return result.scalars().first()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[models.User]:
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    return result.scalars().first()


async def create_user(db: AsyncSession, user: schemas.UserCreate, created_by: Optional[str] = None) -> models.User:
    # Only include fields that exist on the SQLAlchemy model
    payload = user.model_dump()
    allowed_keys = {"email", "username", "is_active"}
    filtered = {k: v for k, v in payload.items() if k in allowed_keys}
    db_user = models.User(**filtered)
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)

    log_db_operation("CREATE", "users", db_user.id, created_by or "system", {"email": user.email})
    return db_user


async def update_user(db: AsyncSession, user_id: uuid.UUID, user_data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[models.User]:
    # First check if the user exists
    db_user = await get_user_by_id(db, user_id)
    if not db_user:
        return None

    # Update the user
    await db.execute(
        update(models.User)
        .where(models.User.id == user_id)
        .values(**user_data)
    )
    await db.commit()

    log_db_operation("UPDATE", "users", user_id, updated_by or "system", {"changes": user_data})

    # Refresh and return the updated user
    return await get_user_by_id(db, user_id)


async def get_project(db: AsyncSession, project_id: uuid.UUID) -> Optional[models.Project]:
    result = await db.execute(select(models.Project).where(models.Project.id == project_id))
    return result.scalars().first()


async def get_projects_by_group_ids(db: AsyncSession, group_ids: List[str], skip: int = 0, limit: int = 100) -> List[models.Project]:
    """Get projects whose meta_group_id is in the given group IDs list."""
    if not group_ids:
        return []
    result = await db.execute(
        select(models.Project)
        .where(models.Project.meta_group_id.in_(group_ids))
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def get_all_projects(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[models.Project]:
    """Get all projects in the database."""
    result = await db.execute(
        select(models.Project)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


async def create_project(db: AsyncSession, project: schemas.ProjectCreate, created_by: Optional[str] = None) -> models.Project:
    db_project = models.Project(**project.model_dump())
    db.add(db_project)
    await db.commit()
    await db.refresh(db_project)

    log_db_operation("CREATE", "projects", db_project.id, created_by or "system", {"name": project.name, "meta_group_id": project.meta_group_id})
    return db_project


async def get_image_class(db: AsyncSession, class_id: uuid.UUID) -> Optional[models.ImageClass]:
    result = await db.execute(select(models.ImageClass).where(models.ImageClass.id == class_id))
    return result.scalars().first()


async def get_image_classes_for_project(db: AsyncSession, project_id: uuid.UUID) -> List[models.ImageClass]:
    result = await db.execute(
        select(models.ImageClass)
        .where(models.ImageClass.project_id == project_id)
    )
    return result.scalars().all()


async def create_image_class(db: AsyncSession, image_class: schemas.ImageClassCreate, created_by: Optional[str] = None) -> models.ImageClass:
    db_image_class = models.ImageClass(**image_class.model_dump())
    db.add(db_image_class)
    await db.commit()
    await db.refresh(db_image_class)

    log_db_operation("CREATE", "image_classes", db_image_class.id, created_by or "system", {"name": image_class.name, "project_id": str(image_class.project_id)})
    return db_image_class


async def update_image_class(db: AsyncSession, class_id: uuid.UUID, image_class_data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[models.ImageClass]:
    db_image_class = await get_image_class(db, class_id)
    if not db_image_class:
        return None

    await db.execute(
        update(models.ImageClass)
        .where(models.ImageClass.id == class_id)
        .values(**image_class_data)
    )
    await db.commit()

    log_db_operation("UPDATE", "image_classes", class_id, updated_by or "system", {"changes": image_class_data})
    return await get_image_class(db, class_id)


async def delete_image_class(db: AsyncSession, class_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    db_image_class = await get_image_class(db, class_id)
    if not db_image_class:
        return False

    log_db_operation("DELETE", "image_classes", class_id, deleted_by or "system", {"name": db_image_class.name})

    await db.execute(delete(models.ImageClass).where(models.ImageClass.id == class_id))
    await db.commit()
    return True


async def get_image_classification(db: AsyncSession, classification_id: uuid.UUID) -> Optional[models.ImageClassification]:
    result = await db.execute(
        select(models.ImageClassification)
        .options(selectinload(models.ImageClassification.image_class))
        .where(models.ImageClassification.id == classification_id)
    )
    return result.scalars().first()


async def get_classifications_for_image(db: AsyncSession, image_id: uuid.UUID) -> List[models.ImageClassification]:
    result = await db.execute(
        select(models.ImageClassification)
        .options(selectinload(models.ImageClassification.image_class))
        .where(models.ImageClassification.image_id == image_id)
    )
    return result.scalars().all()


async def create_image_classification(db: AsyncSession, classification: schemas.ImageClassificationCreate, created_by: Optional[str] = None) -> models.ImageClassification:
    db_classification = models.ImageClassification(**classification.model_dump())
    db.add(db_classification)
    await db.commit()
    await db.refresh(db_classification)

    log_db_operation("CREATE", "image_classifications", db_classification.id, created_by or "system", {"image_id": str(classification.image_id), "class_id": str(classification.class_id)})

    # Explicitly load the classification without the relationship
    # to avoid the MissingGreenlet error
    result = await db.execute(
        select(models.ImageClassification)
        .where(models.ImageClassification.id == db_classification.id)
    )
    return result.scalars().first()


async def delete_image_classification(db: AsyncSession, classification_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    db_classification = await get_image_classification(db, classification_id)
    if not db_classification:
        return False

    log_db_operation("DELETE", "image_classifications", classification_id, deleted_by or "system", {"image_id": str(db_classification.image_id), "class_id": str(db_classification.class_id)})

    await db.execute(delete(models.ImageClassification).where(models.ImageClassification.id == classification_id))
    await db.commit()
    return True


async def get_comment(db: AsyncSession, comment_id: uuid.UUID) -> Optional[models.ImageComment]:
    result = await db.execute(
        select(models.ImageComment)
        .options(selectinload(models.ImageComment.author))
        .where(models.ImageComment.id == comment_id)
    )
    return result.scalars().first()


async def get_comments_for_image(db: AsyncSession, image_id: uuid.UUID) -> List[models.ImageComment]:
    result = await db.execute(
        select(models.ImageComment)
        .options(selectinload(models.ImageComment.author))
        .where(models.ImageComment.image_id == image_id)
        .order_by(models.ImageComment.created_at)
    )
    return result.scalars().all()


async def create_comment(db: AsyncSession, comment: schemas.ImageCommentCreate, created_by: Optional[str] = None) -> models.ImageComment:
    db_comment = models.ImageComment(**comment.model_dump())
    db.add(db_comment)
    await db.commit()
    await db.refresh(db_comment)

    log_db_operation("CREATE", "image_comments", db_comment.id, created_by or "system", {"image_id": str(comment.image_id), "text_length": len(comment.text)})

    # Explicitly load the comment without the relationship
    # to avoid the MissingGreenlet error
    result = await db.execute(
        select(models.ImageComment)
        .where(models.ImageComment.id == db_comment.id)
    )
    return result.scalars().first()


async def update_comment(db: AsyncSession, comment_id: uuid.UUID, comment_data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[models.ImageComment]:
    db_comment = await get_comment(db, comment_id)
    if not db_comment:
        return None

    await db.execute(
        update(models.ImageComment)
        .where(models.ImageComment.id == comment_id)
        .values(**comment_data)
    )
    await db.commit()

    log_db_operation("UPDATE", "image_comments", comment_id, updated_by or "system", {"changes": comment_data})
    return await get_comment(db, comment_id)


async def delete_comment(db: AsyncSession, comment_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    db_comment = await get_comment(db, comment_id)
    if not db_comment:
        return False

    log_db_operation("DELETE", "image_comments", comment_id, deleted_by or "system", {"text_length": len(db_comment.text)})

    await db.execute(delete(models.ImageComment).where(models.ImageComment.id == comment_id))
    await db.commit()
    return True


async def get_project_metadata(db: AsyncSession, metadata_id: uuid.UUID) -> Optional[models.ProjectMetadata]:
    result = await db.execute(select(models.ProjectMetadata).where(models.ProjectMetadata.id == metadata_id))
    return result.scalars().first()


async def get_project_metadata_by_key(db: AsyncSession, project_id: uuid.UUID, key: str) -> Optional[models.ProjectMetadata]:
    result = await db.execute(
        select(models.ProjectMetadata)
        .where(and_(
            models.ProjectMetadata.project_id == project_id,
            models.ProjectMetadata.key == key
        ))
    )
    return result.scalars().first()


async def get_all_project_metadata(db: AsyncSession, project_id: uuid.UUID) -> List[models.ProjectMetadata]:
    result = await db.execute(
        select(models.ProjectMetadata)
        .where(models.ProjectMetadata.project_id == project_id)
    )
    return result.scalars().all()


async def create_or_update_project_metadata(db: AsyncSession, metadata: schemas.ProjectMetadataCreate, created_by: Optional[str] = None) -> models.ProjectMetadata:
    existing_metadata = await get_project_metadata_by_key(db, metadata.project_id, metadata.key)

    if existing_metadata:
        await db.execute(
            update(models.ProjectMetadata)
            .where(models.ProjectMetadata.id == existing_metadata.id)
            .values(value=metadata.value)
        )
        await db.commit()

        log_db_operation("UPDATE", "project_metadata", existing_metadata.id, created_by or "system", {"key": metadata.key, "project_id": str(metadata.project_id)})
        return await get_project_metadata_by_key(db, metadata.project_id, metadata.key)
    else:
        db_metadata = models.ProjectMetadata(**metadata.model_dump())
        db.add(db_metadata)
        await db.commit()
        await db.refresh(db_metadata)

        log_db_operation("CREATE", "project_metadata", db_metadata.id, created_by or "system", {"key": metadata.key, "project_id": str(metadata.project_id)})
        return db_metadata


async def delete_project_metadata(db: AsyncSession, metadata_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    db_metadata = await get_project_metadata(db, metadata_id)
    if not db_metadata:
        return False

    log_db_operation("DELETE", "project_metadata", metadata_id, deleted_by or "system", {"key": db_metadata.key})

    await db.execute(delete(models.ProjectMetadata).where(models.ProjectMetadata.id == metadata_id))
    await db.commit()
    return True


async def delete_project_metadata_by_key(db: AsyncSession, project_id: uuid.UUID, key: str, deleted_by: Optional[str] = None) -> bool:
    db_metadata = await get_project_metadata_by_key(db, project_id, key)
    if not db_metadata:
        return False

    log_db_operation("DELETE", "project_metadata", db_metadata.id, deleted_by or "system", {"key": key, "project_id": str(project_id)})

    await db.execute(
        delete(models.ProjectMetadata)
        .where(and_(
            models.ProjectMetadata.project_id == project_id,
            models.ProjectMetadata.key == key
        ))
    )
    await db.commit()
    return True


async def get_api_key_by_hash(db: AsyncSession, key_hash: str) -> Optional[models.ApiKey]:
    result = await db.execute(
        select(models.ApiKey)
        .options(selectinload(models.ApiKey.user))
        .where(models.ApiKey.key_hash == key_hash)
    )
    return result.scalars().first()


async def get_api_keys_for_user(db: AsyncSession, user_id: uuid.UUID) -> List[models.ApiKey]:
    result = await db.execute(
        select(models.ApiKey)
        .where(models.ApiKey.user_id == user_id)
        .order_by(models.ApiKey.created_at.desc())
    )
    return result.scalars().all()


async def get_all_active_api_keys(db: AsyncSession) -> List[models.ApiKey]:
    """Get all active API keys with user relationships loaded"""
    result = await db.execute(
        select(models.ApiKey)
        .options(selectinload(models.ApiKey.user))
        .where(models.ApiKey.is_active == True)
    )
    return result.scalars().all()


async def create_api_key(db: AsyncSession, api_key: schemas.ApiKeyCreate, user_id: uuid.UUID, key_hash: str, created_by: Optional[str] = None) -> models.ApiKey:
    db_api_key = models.ApiKey(
        user_id=user_id,
        key_hash=key_hash,
        name=api_key.name
    )
    db.add(db_api_key)
    await db.commit()
    await db.refresh(db_api_key)

    log_db_operation("CREATE", "api_keys", db_api_key.id, created_by or "system", {"name": api_key.name, "user_id": str(user_id)})
    return db_api_key


async def update_api_key_last_used(db: AsyncSession, api_key_id: uuid.UUID) -> None:
    from sqlalchemy.sql import func
    await db.execute(
        update(models.ApiKey)
        .where(models.ApiKey.id == api_key_id)
        .values(last_used_at=func.now())
    )
    await db.commit()


async def deactivate_api_key(db: AsyncSession, api_key_id: uuid.UUID, deactivated_by: Optional[str] = None) -> bool:
    result = await db.execute(select(models.ApiKey).where(models.ApiKey.id == api_key_id))
    db_api_key = result.scalars().first()
    if not db_api_key:
        return False

    await db.execute(
        update(models.ApiKey)
        .where(models.ApiKey.id == api_key_id)
        .values(is_active=False)
    )
    await db.commit()

    log_db_operation("UPDATE", "api_keys", api_key_id, deactivated_by or "system", {"deactivated": True})
    return True
