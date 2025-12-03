import uuid
from sqlalchemy import select, update, delete, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from core import models, schemas
from typing import List, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

def log_db_operation(operation: str, table: str, record_id: uuid.UUID, user_email: str, additional_info: Optional[Dict] = None):
    """Log database operations with user information"""
    # Sanitize user input to prevent log injection
    safe_user_domain = 'unknown'
    if user_email and '@' in user_email:
        # Only log the domain part to avoid logging PII
        domain = user_email.split('@')[-1]
        safe_user_domain = domain.replace('\n', '').replace('\r', '')
    elif user_email:
        safe_user_domain = 'local'  # For cases without @ symbol
    
    safe_operation = operation.replace('\n', '').replace('\r', '') if operation else 'unknown'
    safe_table = table.replace('\n', '').replace('\r', '') if table else 'unknown'
    
    log_data = {
        "operation": safe_operation,
        "table": safe_table,
        "record_id": str(record_id),
        "user_domain": safe_user_domain,  # Only log domain, not full email
        "additional_info": additional_info or {}
    }
    logger.info("DB_OPERATION", extra=log_data)

# ----------------- ML Analysis CRUD -----------------
async def create_ml_analysis(db: AsyncSession, analysis: schemas.MLAnalysisCreate, requested_by_id: uuid.UUID, status: str = "queued") -> models.MLAnalysis:
    payload = analysis.model_dump()
    db_obj = models.MLAnalysis(
        image_id=payload["image_id"],
        model_name=payload["model_name"],
        model_version=payload["model_version"],
        parameters=payload.get("parameters"),
        status=status,
        requested_by_id=requested_by_id,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def get_ml_analysis(db: AsyncSession, analysis_id: uuid.UUID) -> Optional[models.MLAnalysis]:
    result = await db.execute(
        select(models.MLAnalysis)
        .where(models.MLAnalysis.id == analysis_id)
        .options(selectinload(models.MLAnalysis.annotations))
    )
    return result.scalars().first()

async def get_ml_analysis_for_update(db: AsyncSession, analysis_id: uuid.UUID) -> Optional[models.MLAnalysis]:
    """Get ML analysis with row-level lock for concurrent-safe updates."""
    result = await db.execute(
        select(models.MLAnalysis)
        .where(models.MLAnalysis.id == analysis_id)
        .with_for_update()
    )
    return result.scalars().first()

async def list_ml_analyses_for_image(db: AsyncSession, image_id: uuid.UUID, skip: int = 0, limit: int = 100) -> List[models.MLAnalysis]:
    result = await db.execute(
        select(models.MLAnalysis)
        .where(models.MLAnalysis.image_id == image_id)
        .order_by(models.MLAnalysis.created_at.desc())
        .offset(skip).limit(limit)
    )
    return result.scalars().all()

async def count_ml_analyses_for_image(db: AsyncSession, image_id: uuid.UUID) -> int:
    """Count total ML analyses for an image."""
    from sqlalchemy import func
    result = await db.execute(
        select(func.count()).select_from(models.MLAnalysis).where(models.MLAnalysis.image_id == image_id)
    )
    return result.scalar_one()

async def create_ml_annotation(db: AsyncSession, analysis_id: uuid.UUID, annotation: schemas.MLAnnotationCreate) -> models.MLAnnotation:
    payload = annotation.model_dump()
    db_obj = models.MLAnnotation(
        analysis_id=analysis_id,
        annotation_type=payload["annotation_type"],
        class_name=payload.get("class_name"),
        confidence=payload.get("confidence"),
        data=payload["data"],
        storage_path=payload.get("storage_path"),
        ordering=payload.get("ordering"),
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def list_ml_annotations(db: AsyncSession, analysis_id: uuid.UUID, skip: int = 0, limit: int = 500) -> List[models.MLAnnotation]:
    result = await db.execute(
        select(models.MLAnnotation)
        .where(models.MLAnnotation.analysis_id == analysis_id)
        .order_by(models.MLAnnotation.created_at.asc(), models.MLAnnotation.id.asc())
        .offset(skip).limit(limit)
    )
    return result.scalars().all()

async def count_ml_annotations(db: AsyncSession, analysis_id: uuid.UUID) -> int:
    """Count total annotations for an analysis."""
    from sqlalchemy import func
    result = await db.execute(
        select(func.count()).select_from(models.MLAnnotation).where(models.MLAnnotation.analysis_id == analysis_id)
    )
    return result.scalar_one()

async def bulk_insert_ml_annotations(db: AsyncSession, analysis_id: uuid.UUID, annotations: List[schemas.MLAnnotationCreate]) -> int:
    """Bulk insert annotations efficiently with chunking to prevent memory issues."""
    CHUNK_SIZE = 500  # Process in chunks to avoid memory/timeout issues
    total_inserted = 0

    for i in range(0, len(annotations), CHUNK_SIZE):
        chunk = annotations[i:i + CHUNK_SIZE]
        objs = []
        for ann in chunk:
            payload = ann.model_dump()
            objs.append(models.MLAnnotation(
                analysis_id=analysis_id,
                annotation_type=payload["annotation_type"],
                class_name=payload.get("class_name"),
                confidence=payload.get("confidence"),
                data=payload["data"],
                storage_path=payload.get("storage_path"),
                ordering=payload.get("ordering"),
            ))
        db.add_all(objs)
        await db.flush()  # Flush each chunk but don't commit yet
        total_inserted += len(objs)

    await db.commit()  # Single commit at the end
    return total_inserted

# User CRUD operations
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

# Project CRUD operations
async def get_project(db: AsyncSession, project_id: uuid.UUID) -> Optional[models.Project]:
    result = await db.execute(select(models.Project).where(models.Project.id == project_id))
    return result.scalars().first()

async def get_projects_by_group_ids(db: AsyncSession, group_ids: List[str], skip: int = 0, limit: int = 100) -> List[models.Project]:
    """
    Legacy method to get projects by group IDs.
    This checks if the project's meta_group_id is in the user's groups list.
    
    Args:
        db: Database session
        group_ids: List of group IDs the user is a member of
        skip: Number of records to skip
        limit: Maximum number of records to return
        
    Returns:
        List of projects the user has access to
    """
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
    """
    Get all projects in the database.
    
    Args:
        db: Database session
        skip: Number of records to skip
        limit: Maximum number of records to return
        
    Returns:
        List of all projects
    """
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

# DataInstance CRUD operations
async def get_data_instance(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.DataInstance]:
    result = await db.execute(
        select(models.DataInstance)
        .options(selectinload(models.DataInstance.project))
        .where(models.DataInstance.id == image_id)
        )
    return result.scalars().first()

async def get_data_instance_for_update(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.DataInstance]:
    """Retrieve image without eager loads for update operations."""
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.id == image_id)
        .with_for_update(of=models.DataInstance)
    )
    return result.scalars().first()

# Backwards-compatible alias used by dependencies/get_image_or_403
async def get_image(db: AsyncSession, image_id: uuid.UUID) -> Optional[models.DataInstance]:
    """
    Retrieve a DataInstance by id. Maintains compatibility with older call sites
    that referenced `crud.get_image`.
    """
    return await get_data_instance(db, image_id)

async def get_data_instances_for_project(db: AsyncSession, project_id: uuid.UUID, skip: int = 0, limit: int = 100, search_field: Optional[str] = None, search_value: Optional[str] = None) -> List[models.DataInstance]:
    # First check if the project exists
    project = await get_project(db, project_id)
    if not project:
        return []
        
    query = select(models.DataInstance).where(models.DataInstance.project_id == project_id)
    
    if search_field and search_value:
        search_value_lower = f"%{search_value.lower()}%"
        
        if search_field == 'filename':
            query = query.where(models.DataInstance.filename.ilike(search_value_lower))
        elif search_field == 'content_type':
            query = query.where(models.DataInstance.content_type.ilike(search_value_lower))
        elif search_field == 'uploaded_by':
            query = query.where(models.DataInstance.uploaded_by_user_id.ilike(search_value_lower))
        elif search_field == 'metadata':
            # Search across all metadata values using JSON text search
            # This uses PostgreSQL's jsonb operators
            query = query.where(text("metadata::text ILIKE :search_value")).params(search_value=search_value_lower)
        else:
            # Search specific metadata key using JSON path
            # This searches for the specific key in the metadata JSON
            query = query.where(text("metadata ->> :key ILIKE :search_value")).params(key=search_field, search_value=search_value_lower)
    
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()

async def get_deleted_images_for_project(db: AsyncSession, project_id: uuid.UUID, skip: int = 0, limit: int = 100) -> List[models.DataInstance]:
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.isnot(None))
        .order_by(models.DataInstance.deleted_at.desc())
        .offset(skip).limit(limit)
    )
    return result.scalars().all()

async def count_deleted_images_for_project(db: AsyncSession, project_id: uuid.UUID) -> int:
    from sqlalchemy import func as _func
    result = await db.execute(
        select(_func.count())
        .select_from(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.isnot(None))
    )
    return result.scalar_one()

async def create_image_deletion_event(db: AsyncSession, *, image: models.DataInstance, actor_user_id: Optional[uuid.UUID], action: str, reason: Optional[str], previous_state: Optional[Dict[str, Any]] = None):
    event = models.ImageDeletionEvent(
        image_id=image.id,
        project_id=image.project_id,
        actor_user_id=actor_user_id,
        action=action,
        reason=reason,
        previous_state=previous_state or {},
        storage_deleted=image.storage_deleted,
    )
    db.add(event)
    await db.flush()  # Get id
    return event

async def list_image_deletion_events(db: AsyncSession, project_id: uuid.UUID, image_id: Optional[uuid.UUID] = None, skip: int = 0, limit: int = 100):
    stmt = select(models.ImageDeletionEvent).where(models.ImageDeletionEvent.project_id == project_id)
    if image_id:
        stmt = stmt.where(models.ImageDeletionEvent.image_id == image_id)
    stmt = stmt.order_by(models.ImageDeletionEvent.at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

async def count_image_deletion_events(db: AsyncSession, project_id: uuid.UUID, image_id: Optional[uuid.UUID] = None) -> int:
    from sqlalchemy import func as _func
    stmt = select(_func.count()).select_from(models.ImageDeletionEvent).where(models.ImageDeletionEvent.project_id == project_id)
    if image_id:
        stmt = stmt.where(models.ImageDeletionEvent.image_id == image_id)
    result = await db.execute(stmt)
    return result.scalar_one()

async def soft_delete_image(db: AsyncSession, image: models.DataInstance, *, actor_user_id: Optional[uuid.UUID], reason: str, retention_days: int):
    from datetime import datetime, timezone, timedelta
    if image.deleted_at and image.storage_deleted:
        return image  # already fully deleted
    now = datetime.now(timezone.utc)
    pending_dt = now + timedelta(days=retention_days)
    # If already soft deleted, don't override original deleted_at or pending date
    if not image.deleted_at:
        await db.execute(
            update(models.DataInstance)
            .where(models.DataInstance.id == image.id)
            .values(
                deleted_at=now,
                deleted_by_user_id=actor_user_id,
                deletion_reason=reason,
                pending_hard_delete_at=pending_dt
            )
        )
    else:
        # Update reason if new (append or keep existing? Keep existing to preserve original justification)
        if not image.deletion_reason:
            await db.execute(
                update(models.DataInstance)
                .where(models.DataInstance.id == image.id)
                .values(deletion_reason=reason)
            )
    await db.flush()
    await db.refresh(image)
    return image

async def restore_image(db: AsyncSession, image: models.DataInstance):
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image.id)
        .values(
            deleted_at=None,
            deleted_by_user_id=None,
            deletion_reason=None,
            pending_hard_delete_at=None,
            hard_deleted_at=None,
            hard_deleted_by_user_id=None,
            storage_deleted=False
        )
    )
    await db.flush()
    await db.refresh(image)
    return image

async def mark_image_storage_deleted(db: AsyncSession, image: models.DataInstance, *, actor_user_id: Optional[uuid.UUID], hard: bool):
    from sqlalchemy.sql import func as _func
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image.id)
        .values(
            storage_deleted=True,
            hard_deleted_at=_func.coalesce(models.DataInstance.hard_deleted_at, _func.now()),
            hard_deleted_by_user_id=actor_user_id if hard else models.DataInstance.hard_deleted_by_user_id
        )
    )
    await db.flush()
    await db.refresh(image)
    return image

async def create_data_instance(db: AsyncSession, data_instance: schemas.DataInstanceCreate, created_by: Optional[str] = None) -> models.DataInstance:
    create_data = data_instance.model_dump()
    # Rename Pydantic field name to SQLAlchemy attribute name
    if "metadata_" in create_data:
         create_data["metadata_json"] = create_data.pop("metadata_")
    db_data_instance = models.DataInstance(**create_data)
    db.add(db_data_instance)
    await db.commit()
    await db.refresh(db_data_instance)
    
    log_db_operation("CREATE", "data_instances", db_data_instance.id, created_by or "system", {"filename": data_instance.filename, "project_id": str(data_instance.project_id)})
    return db_data_instance

# ImageClass CRUD operations
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
    # First check if the class exists
    db_image_class = await get_image_class(db, class_id)
    if not db_image_class:
        return None
    
    # Update the class
    await db.execute(
        update(models.ImageClass)
        .where(models.ImageClass.id == class_id)
        .values(**image_class_data)
    )
    await db.commit()
    
    log_db_operation("UPDATE", "image_classes", class_id, updated_by or "system", {"changes": image_class_data})
    
    # Refresh and return the updated class
    return await get_image_class(db, class_id)

async def delete_image_class(db: AsyncSession, class_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    # First check if the class exists
    db_image_class = await get_image_class(db, class_id)
    if not db_image_class:
        return False
    
    log_db_operation("DELETE", "image_classes", class_id, deleted_by or "system", {"name": db_image_class.name})
    
    # Delete the class
    await db.execute(delete(models.ImageClass).where(models.ImageClass.id == class_id))
    await db.commit()
    return True

# ImageClassification CRUD operations
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
    # First check if the classification exists
    db_classification = await get_image_classification(db, classification_id)
    if not db_classification:
        return False
    
    log_db_operation("DELETE", "image_classifications", classification_id, deleted_by or "system", {"image_id": str(db_classification.image_id), "class_id": str(db_classification.class_id)})
    
    # Delete the classification
    await db.execute(delete(models.ImageClassification).where(models.ImageClassification.id == classification_id))
    await db.commit()
    return True

# ImageComment CRUD operations
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
    # First check if the comment exists
    db_comment = await get_comment(db, comment_id)
    if not db_comment:
        return None
    
    # Update the comment
    await db.execute(
        update(models.ImageComment)
        .where(models.ImageComment.id == comment_id)
        .values(**comment_data)
    )
    await db.commit()
    
    log_db_operation("UPDATE", "image_comments", comment_id, updated_by or "system", {"changes": comment_data})
    
    # Refresh and return the updated comment
    return await get_comment(db, comment_id)

async def delete_comment(db: AsyncSession, comment_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    # First check if the comment exists
    db_comment = await get_comment(db, comment_id)
    if not db_comment:
        return False
    
    log_db_operation("DELETE", "image_comments", comment_id, deleted_by or "system", {"text_length": len(db_comment.text)})
    
    # Delete the comment
    await db.execute(delete(models.ImageComment).where(models.ImageComment.id == comment_id))
    await db.commit()
    return True

# ProjectMetadata CRUD operations
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
    # Check if metadata with this key already exists for the project
    existing_metadata = await get_project_metadata_by_key(db, metadata.project_id, metadata.key)
    
    if existing_metadata:
        # Update existing metadata
        await db.execute(
            update(models.ProjectMetadata)
            .where(models.ProjectMetadata.id == existing_metadata.id)
            .values(value=metadata.value)
        )
        await db.commit()
        
        log_db_operation("UPDATE", "project_metadata", existing_metadata.id, created_by or "system", {"key": metadata.key, "project_id": str(metadata.project_id)})
        return await get_project_metadata_by_key(db, metadata.project_id, metadata.key)
    else:
        # Create new metadata
        db_metadata = models.ProjectMetadata(**metadata.model_dump())
        db.add(db_metadata)
        await db.commit()
        await db.refresh(db_metadata)
        
        log_db_operation("CREATE", "project_metadata", db_metadata.id, created_by or "system", {"key": metadata.key, "project_id": str(metadata.project_id)})
        return db_metadata

async def delete_project_metadata(db: AsyncSession, metadata_id: uuid.UUID, deleted_by: Optional[str] = None) -> bool:
    # First check if the metadata exists
    db_metadata = await get_project_metadata(db, metadata_id)
    if not db_metadata:
        return False
    
    log_db_operation("DELETE", "project_metadata", metadata_id, deleted_by or "system", {"key": db_metadata.key})
    
    # Delete the metadata
    await db.execute(delete(models.ProjectMetadata).where(models.ProjectMetadata.id == metadata_id))
    await db.commit()
    return True

async def delete_project_metadata_by_key(db: AsyncSession, project_id: uuid.UUID, key: str, deleted_by: Optional[str] = None) -> bool:
    # First check if the metadata exists
    db_metadata = await get_project_metadata_by_key(db, project_id, key)
    if not db_metadata:
        return False
    
    log_db_operation("DELETE", "project_metadata", db_metadata.id, deleted_by or "system", {"key": key, "project_id": str(project_id)})
    
    # Delete the metadata
    await db.execute(
        delete(models.ProjectMetadata)
        .where(and_(
            models.ProjectMetadata.project_id == project_id,
            models.ProjectMetadata.key == key
        ))
    )
    await db.commit()
    return True

# ApiKey CRUD operations
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
