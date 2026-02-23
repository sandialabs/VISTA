import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.schemas import User
from core.schemas_annotations import (
    BoundingBoxClassCreate, BoundingBoxClassUpdate, BoundingBoxClass,
)
from utils.dependencies import (
    get_current_user, get_project_or_403, resolve_user_id,
    check_collection_allows,
)
from utils.crud_collections import get_collection
from utils.crud_bbox_classes import (
    create_bbox_class, get_bbox_class, get_bbox_classes_for_collection,
    update_bbox_class, delete_bbox_class,
)
from typing import List

logger = logging.getLogger(__name__)
router = APIRouter(tags=["bbox-classes"])


@router.post("/collections/{collection_id}/bbox-classes", response_model=BoundingBoxClass)
async def create_bbox_class_endpoint(
    collection_id: uuid.UUID,
    body: BoundingBoxClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll = await get_collection(db, collection_id)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    await get_project_or_403(coll.project_id, db, current_user)
    await check_collection_allows(collection_id, "manage_classes", db)
    obj = await create_bbox_class(
        db,
        project_id=coll.project_id,
        collection_id=collection_id,
        name=body.name,
        color=body.color,
        description=body.description,
    )
    return BoundingBoxClass.model_validate(obj)


@router.get("/collections/{collection_id}/bbox-classes", response_model=List[BoundingBoxClass])
async def list_bbox_classes_endpoint(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll = await get_collection(db, collection_id)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    await get_project_or_403(coll.project_id, db, current_user)
    items = await get_bbox_classes_for_collection(db, collection_id)
    return [BoundingBoxClass.model_validate(i) for i in items]


@router.patch("/bbox-classes/{bbox_class_id}", response_model=BoundingBoxClass)
async def update_bbox_class_endpoint(
    bbox_class_id: uuid.UUID,
    body: BoundingBoxClassUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    obj = await get_bbox_class(db, bbox_class_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Bounding box class not found")
    await get_project_or_403(obj.project_id, db, current_user)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await update_bbox_class(db, bbox_class_id, data)
    return BoundingBoxClass.model_validate(updated)


@router.delete("/bbox-classes/{bbox_class_id}", status_code=204)
async def delete_bbox_class_endpoint(
    bbox_class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    obj = await get_bbox_class(db, bbox_class_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Bounding box class not found")
    await get_project_or_403(obj.project_id, db, current_user)
    await check_collection_allows(obj.collection_id, "manage_classes", db)
    await delete_bbox_class(db, bbox_class_id)
