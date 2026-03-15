import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from core import schemas
from core.database import get_db
from utils.dependencies import (
    get_current_user,
    get_user_context,
    UserContext,
    get_project_or_403,
)
from utils.crud.collections import (
    create_collection,
    get_collection,
    get_collections_for_project,
    update_collection,
    delete_collection,
    lock_collection,
    unlock_collection,
    set_review_required,
    add_images_to_collection,
    remove_image_from_collection,
    get_collection_images,
    count_collection_images,
)

router = APIRouter(
    tags=["Collections"],
)


async def _get_collection_or_404(
    collection_id: uuid.UUID, db: AsyncSession
):
    """Fetch a collection or raise 404."""
    coll = await get_collection(db, collection_id)
    if not coll:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found"
        )
    return coll


async def _check_not_locked(coll):
    """Raise 409 if the collection is locked."""
    if coll.is_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Collection is locked and cannot be modified",
        )


@router.post(
    "/projects/{project_id}/collections",
    response_model=schemas.Collection,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_collection(
    project_id: uuid.UUID,
    body: schemas.CollectionBase,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Create a new collection within a project."""
    await get_project_or_403(project_id, db, user_context.user)

    create_data = schemas.CollectionCreate(
        project_id=project_id,
        name=body.name,
        description=body.description,
    )
    return await create_collection(
        db=db, collection_data=create_data,
        user_id=user_context.id, created_by=user_context.email,
    )


@router.get(
    "/projects/{project_id}/collections",
    response_model=List[schemas.Collection],
)
async def list_project_collections(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """List all collections for a project."""
    await get_project_or_403(project_id, db, current_user)
    return await get_collections_for_project(db, project_id)


@router.get(
    "/collections/{collection_id}",
    response_model=schemas.Collection,
)
async def get_single_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get a single collection by ID."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, current_user)
    return coll


@router.patch(
    "/collections/{collection_id}",
    response_model=schemas.Collection,
)
async def update_single_collection(
    collection_id: uuid.UUID,
    body: schemas.CollectionUpdate,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Update a collection name or description."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)
    await _check_not_locked(coll)

    update_data = body.model_dump(exclude_unset=True)
    updated = await update_collection(db, collection_id, update_data)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update collection",
        )
    return updated


@router.delete(
    "/collections/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_single_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Delete a collection."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)
    await _check_not_locked(coll)

    success = await delete_collection(db, collection_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete collection",
        )
    return None


@router.post(
    "/collections/{collection_id}/images",
    response_model=List[schemas.CollectionImageInfo],
    status_code=status.HTTP_201_CREATED,
)
async def add_collection_images(
    collection_id: uuid.UUID,
    body: schemas.CollectionImageAdd,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Add images to a collection."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)
    await _check_not_locked(coll)

    return await add_images_to_collection(
        db, collection_id, body.image_ids, user_context.id,
    )


@router.delete(
    "/collections/{collection_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_collection_image(
    collection_id: uuid.UUID,
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Remove an image from a collection."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)
    await _check_not_locked(coll)

    success = await remove_image_from_collection(db, collection_id, image_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found in collection",
        )
    return None


@router.get(
    "/collections/{collection_id}/images",
    response_model=List[schemas.CollectionImageInfo],
)
async def list_collection_images(
    collection_id: uuid.UUID,
    skip: int = 0,
    limit: int = 1000,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """List images in a collection."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, current_user)
    return await get_collection_images(db, collection_id, skip=skip, limit=limit)


@router.post(
    "/collections/{collection_id}/lock",
    response_model=schemas.Collection,
)
async def lock_single_collection(
    collection_id: uuid.UUID,
    body: schemas.CollectionLockRequest,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Lock a collection to prevent modifications."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)

    locked = await lock_collection(
        db, collection_id, user_context.id, reason=body.reason,
    )
    if not locked:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to lock collection",
        )
    return locked


@router.post(
    "/collections/{collection_id}/unlock",
    response_model=schemas.Collection,
)
async def unlock_single_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Unlock a collection to allow modifications."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)

    unlocked = await unlock_collection(db, collection_id)
    if not unlocked:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to unlock collection",
        )
    return unlocked


@router.post(
    "/collections/{collection_id}/review-required",
    response_model=schemas.Collection,
)
async def toggle_review_required(
    collection_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Toggle the review_required flag on a collection."""
    coll = await _get_collection_or_404(collection_id, db)
    await get_project_or_403(coll.project_id, db, user_context.user)

    required = body.get("required", False)
    updated = await set_review_required(db, collection_id, required)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update review requirement",
        )
    return updated
