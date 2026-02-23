import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from core.schemas import User
from core.schemas_collections import (
    CollectionCreate, CollectionUpdate, CollectionPhaseUpdate,
    CollectionCertifyRequest, Collection, CollectionList,
    CollectionImageIds, ReviewProgress,
)
from core.schemas import DataInstance
from utils.dependencies import (
    get_current_user, get_project_or_403, resolve_user_id,
    check_collection_allows,
)
from utils.crud_collections import (
    create_collection, get_collection, get_collections_for_project,
    count_collections_for_project, update_collection, delete_collection,
    add_images_to_collection, remove_images_from_collection,
    get_collection_images_full, count_collection_images,
    update_collection_phase, certify_collection,
    VALID_PHASE_TRANSITIONS,
)
from utils.crud_image_reviews import get_review_progress
from utils.crud_audit import create_audit_event
from typing import List

logger = logging.getLogger(__name__)
router = APIRouter(tags=["collections"])


async def _get_collection_with_access(
    collection_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> "tuple":
    """Fetch a collection and verify the user can access its project."""
    coll = await get_collection(db, collection_id)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    project = await get_project_or_403(coll.project_id, db, current_user)
    return coll, project


@router.post("/projects/{project_id}/collections", response_model=Collection)
async def create_collection_endpoint(
    project_id: uuid.UUID,
    body: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_403(project_id, db, current_user)
    user_id = await resolve_user_id(current_user, db)
    coll = await create_collection(
        db,
        project_id=project.id,
        name=body.name,
        description=body.description,
        purpose=body.purpose,
        created_by_id=user_id,
    )
    await create_audit_event(
        db,
        entity_type="collection",
        entity_id=coll.id,
        action="created",
        actor_id=user_id,
        project_id=project.id,
        details={"name": body.name, "purpose": body.purpose},
    )
    img_count = await count_collection_images(db, coll.id)
    return Collection.model_validate({**coll.__dict__, "image_count": img_count})


@router.get("/projects/{project_id}/collections", response_model=CollectionList)
async def list_collections_endpoint(
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    items = await get_collections_for_project(db, project_id, skip, limit)
    total = await count_collections_for_project(db, project_id)
    result = []
    for c in items:
        img_count = await count_collection_images(db, c.id)
        result.append(Collection.model_validate({**c.__dict__, "image_count": img_count}))
    return CollectionList(collections=result, total=total)


@router.get("/collections/{collection_id}", response_model=Collection)
async def get_collection_endpoint(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    img_count = await count_collection_images(db, coll.id)
    return Collection.model_validate({**coll.__dict__, "image_count": img_count})


@router.patch("/collections/{collection_id}", response_model=Collection)
async def update_collection_endpoint(
    collection_id: uuid.UUID,
    body: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    if coll.phase != "draft":
        raise HTTPException(status_code=423, detail="Can only edit collection in draft phase")
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await update_collection(db, collection_id, **data)
    img_count = await count_collection_images(db, updated.id)
    return Collection.model_validate({**updated.__dict__, "image_count": img_count})


@router.delete("/collections/{collection_id}", status_code=204)
async def delete_collection_endpoint(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    if coll.phase != "draft":
        raise HTTPException(status_code=423, detail="Can only delete collection in draft phase")
    await delete_collection(db, collection_id)


@router.patch("/collections/{collection_id}/phase", response_model=Collection)
async def update_phase_endpoint(
    collection_id: uuid.UUID,
    body: CollectionPhaseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, project = await _get_collection_with_access(collection_id, db, current_user)
    allowed = VALID_PHASE_TRANSITIONS.get(coll.phase, set())
    if body.phase not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{coll.phase}' to '{body.phase}'",
        )
    if coll.phase == "certified" and body.phase == "review" and not body.reopen_reason:
        raise HTTPException(status_code=400, detail="reopen_reason required to reopen certified collection")
    user_id = await resolve_user_id(current_user, db)
    updated = await update_collection_phase(db, collection_id, body.phase)
    details = {"from": coll.phase, "to": body.phase}
    if body.reopen_reason:
        details["reopen_reason"] = body.reopen_reason
    await create_audit_event(
        db,
        entity_type="collection",
        entity_id=collection_id,
        action="phase_changed",
        actor_id=user_id,
        project_id=project.id,
        details=details,
    )
    img_count = await count_collection_images(db, updated.id)
    return Collection.model_validate({**updated.__dict__, "image_count": img_count})


@router.post("/collections/{collection_id}/certify", response_model=Collection)
async def certify_collection_endpoint(
    collection_id: uuid.UUID,
    body: CollectionCertifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, project = await _get_collection_with_access(collection_id, db, current_user)
    if coll.phase != "review":
        raise HTTPException(status_code=400, detail="Collection must be in review phase to certify")
    progress = await get_review_progress(db, collection_id)
    if progress["unreviewed"] > 0:
        raise HTTPException(status_code=400, detail=f"{progress['unreviewed']} images not yet reviewed")
    if progress["annotation_pending"] > 0 or progress["annotation_flagged"] > 0:
        raise HTTPException(
            status_code=400,
            detail=f"{progress['annotation_pending']} pending and {progress['annotation_flagged']} flagged annotations remain",
        )
    user_id = await resolve_user_id(current_user, db)
    certified = await certify_collection(
        db, collection_id, certified_by_id=user_id,
        certification_notes=body.certification_notes,
    )
    await create_audit_event(
        db,
        entity_type="collection",
        entity_id=collection_id,
        action="certified",
        actor_id=user_id,
        project_id=project.id,
        details={"notes": body.certification_notes},
    )
    img_count = await count_collection_images(db, certified.id)
    return Collection.model_validate({**certified.__dict__, "image_count": img_count})


@router.post("/collections/{collection_id}/images", status_code=200)
async def add_images_endpoint(
    collection_id: uuid.UUID,
    body: CollectionImageIds,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    await check_collection_allows(collection_id, "manage_images", db)
    user_id = await resolve_user_id(current_user, db)
    added = await add_images_to_collection(db, collection_id, body.image_ids, user_id)
    return {"added": added}


@router.delete("/collections/{collection_id}/images", status_code=200)
async def remove_images_endpoint(
    collection_id: uuid.UUID,
    body: CollectionImageIds,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    await check_collection_allows(collection_id, "manage_images", db)
    removed = await remove_images_from_collection(db, collection_id, body.image_ids)
    return {"removed": removed}


@router.get("/collections/{collection_id}/images/full", response_model=List[DataInstance])
async def list_collection_images_endpoint(
    collection_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    images = await get_collection_images_full(db, collection_id, skip, limit)
    return [DataInstance.model_validate(img) for img in images]


@router.get("/collections/{collection_id}/review-progress", response_model=ReviewProgress)
async def review_progress_endpoint(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    coll, _ = await _get_collection_with_access(collection_id, db, current_user)
    progress = await get_review_progress(db, collection_id)
    return ReviewProgress(**progress)
