import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from core import models, schemas
from typing import List, Optional


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
