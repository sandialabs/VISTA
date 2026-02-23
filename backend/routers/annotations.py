import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.schemas import User
from core.schemas_annotations import (
    UserAnnotationCreate, UserAnnotationUpdate,
    UserAnnotation, UserAnnotationList,
)
from utils.dependencies import (
    get_current_user, get_image_or_403, resolve_user_id,
    check_collection_allows,
)
from utils.crud_annotations import (
    create_annotation, get_annotation, get_annotations_for_image,
    count_annotations_for_image, update_annotation, delete_annotation,
)
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(tags=["annotations"])


@router.post("/images/{image_id}/annotations", response_model=UserAnnotation)
async def create_annotation_endpoint(
    image_id: uuid.UUID,
    body: UserAnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    image = await get_image_or_403(image_id, db, current_user)
    if body.collection_id:
        await check_collection_allows(body.collection_id, "create_annotation", db)
    user_id = await resolve_user_id(current_user, db)
    ann = await create_annotation(
        db,
        image_id=image.id,
        project_id=image.project_id,
        collection_id=body.collection_id,
        bbox_class_id=body.bbox_class_id,
        created_by_id=user_id,
        x_min=body.x_min,
        y_min=body.y_min,
        x_max=body.x_max,
        y_max=body.y_max,
        image_width=body.image_width,
        image_height=body.image_height,
        notes=body.notes,
        origin=body.origin,
    )
    return UserAnnotation.model_validate(ann)


@router.get("/images/{image_id}/annotations", response_model=UserAnnotationList)
async def list_annotations_endpoint(
    image_id: uuid.UUID,
    collection_id: Optional[uuid.UUID] = Query(None),
    skip: int = 0,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_image_or_403(image_id, db, current_user)
    items = await get_annotations_for_image(db, image_id, collection_id, skip, limit)
    total = await count_annotations_for_image(db, image_id, collection_id)
    return UserAnnotationList(
        annotations=[UserAnnotation.model_validate(a) for a in items],
        total=total,
    )


@router.patch("/annotations/{annotation_id}", response_model=UserAnnotation)
async def update_annotation_endpoint(
    annotation_id: uuid.UUID,
    body: UserAnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ann = await get_annotation(db, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await get_image_or_403(ann.image_id, db, current_user)
    if ann.collection_id:
        await check_collection_allows(ann.collection_id, "modify_annotation", db)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await update_annotation(db, annotation_id, data)
    return UserAnnotation.model_validate(updated)


@router.delete("/annotations/{annotation_id}", status_code=204)
async def delete_annotation_endpoint(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ann = await get_annotation(db, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await get_image_or_403(ann.image_id, db, current_user)
    if ann.collection_id:
        await check_collection_allows(ann.collection_id, "modify_annotation", db)
    await delete_annotation(db, annotation_id)
