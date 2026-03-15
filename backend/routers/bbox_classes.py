import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from core import schemas
from core.database import get_db
from utils.dependencies import (
    get_current_user, get_user_context, UserContext, get_project_or_403,
)
from utils.crud.bbox_classes import (
    create_bbox_class, get_bbox_class, get_bbox_classes_for_project,
    update_bbox_class, delete_bbox_class,
)

router = APIRouter(tags=["BBox Classes"])


@router.post(
    "/projects/{project_id}/bbox-classes",
    response_model=schemas.BBoxClass,
    status_code=status.HTTP_201_CREATED,
)
async def create_bbox_class_endpoint(
    project_id: uuid.UUID,
    bbox_class: schemas.BBoxClassBase,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    await get_project_or_403(project_id, db, user_context.user)
    bbox_class_create = schemas.BBoxClassCreate(
        project_id=project_id,
        name=bbox_class.name,
        description=bbox_class.description,
        color=bbox_class.color,
    )
    return await create_bbox_class(
        db=db, bbox_class=bbox_class_create, created_by=user_context.email,
    )


@router.get(
    "/projects/{project_id}/bbox-classes",
    response_model=List[schemas.BBoxClass],
)
async def list_bbox_classes(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return await get_bbox_classes_for_project(db=db, project_id=project_id)


@router.get(
    "/bbox-classes/{class_id}",
    response_model=schemas.BBoxClass,
)
async def get_bbox_class_endpoint(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    db_class = await get_bbox_class(db=db, class_id=class_id)
    if not db_class:
        raise HTTPException(status_code=404, detail="BBox class not found")
    await get_project_or_403(db_class.project_id, db, current_user)
    return db_class


@router.patch(
    "/bbox-classes/{class_id}",
    response_model=schemas.BBoxClass,
)
async def update_bbox_class_endpoint(
    class_id: uuid.UUID,
    update: schemas.BBoxClassUpdate,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    db_class = await get_bbox_class(db=db, class_id=class_id)
    if not db_class:
        raise HTTPException(status_code=404, detail="BBox class not found")
    await get_project_or_403(db_class.project_id, db, user_context.user)
    update_dict = update.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await update_bbox_class(
        db=db, class_id=class_id, update_data=update_dict,
        updated_by=user_context.email,
    )
    return result


@router.delete(
    "/bbox-classes/{class_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_bbox_class_endpoint(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    db_class = await get_bbox_class(db=db, class_id=class_id)
    if not db_class:
        raise HTTPException(status_code=404, detail="BBox class not found")
    await get_project_or_403(db_class.project_id, db, user_context.user)
    success = await delete_bbox_class(
        db=db, class_id=class_id, deleted_by=user_context.email,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete bbox class")
    return None
