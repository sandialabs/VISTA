"""Router for image group management."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

import utils.crud as crud
from core import schemas, models
from core.config import settings
from core.database import get_db
from utils.dependencies import get_current_user, get_project_or_403, get_project_or_403_writable
from utils.cache_manager import get_cache

router = APIRouter(tags=["Groups"])


# ---- helpers ----

async def _get_group_or_403(
    group_id: uuid.UUID,
    db: AsyncSession,
    current_user: schemas.User,
) -> models.ImageGroup:
    group = await crud.get_image_group(db, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    # Verify project access
    await get_project_or_403(group.project_id, db, current_user)
    return group


async def _get_group_or_403_writable(
    group_id: uuid.UUID,
    db: AsyncSession,
    current_user: schemas.User,
) -> models.ImageGroup:
    group = await crud.get_image_group(db, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    # Verify project access and that the project is not archived
    await get_project_or_403_writable(group.project_id, db, current_user)
    return group


async def _enrich_group(
    group: models.ImageGroup,
    db: AsyncSession,
) -> schemas.ImageGroup:
    """Add image_count and aggregate_review_status to a group schema."""
    image_count = await crud.count_images_for_group(db, group.id)
    agg_status = await crud.get_aggregate_review_status_for_group(db, group.id)
    schema = schemas.ImageGroup.model_validate(group)
    schema.image_count = image_count
    schema.aggregate_review_status = agg_status
    return schema


async def _enrich_groups_batch(
    groups: list,
    db: AsyncSession,
) -> list:
    """Batch-enrich a list of groups with image counts and aggregate review status."""
    if not groups:
        return []
    group_ids = [g.id for g in groups]
    counts = await crud.get_image_counts_for_groups(db, group_ids)
    agg_statuses = await crud.get_aggregate_review_statuses_for_groups(db, group_ids)
    enriched = []
    for g in groups:
        schema = schemas.ImageGroup.model_validate(g)
        schema.image_count = counts.get(g.id, 0)
        schema.aggregate_review_status = agg_statuses.get(g.id)
        enriched.append(schema)
    return enriched


def _invalidate_project_image_cache(project_id: uuid.UUID) -> None:
    """Clear cached image lists for a project after group membership changes."""
    cache = get_cache()
    cache.clear_pattern(f"project_images:{project_id}")


# ---- endpoints ----

@router.get(
    "/projects/{project_id}/groups",
    response_model=schemas.ImageGroupList,
)
async def list_groups(
    project_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """List all groups in a project with image counts and aggregate review status."""
    await get_project_or_403(project_id, db, current_user)
    groups = await crud.list_image_groups(db, project_id, skip=skip, limit=limit, search=search)
    total = await crud.count_image_groups(db, project_id, search=search)
    enriched = await _enrich_groups_batch(groups, db)
    return schemas.ImageGroupList(groups=enriched, total=total)


@router.post(
    "/projects/{project_id}/groups",
    response_model=schemas.ImageGroup,
    status_code=status.HTTP_201_CREATED,
)
async def create_group(
    project_id: uuid.UUID,
    body: schemas.ImageGroupBase,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Create a new image group in a project."""
    await get_project_or_403_writable(project_id, db, current_user)
    existing = await crud.get_image_group_by_identifier(db, project_id, body.identifier)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Group with identifier '{body.identifier}' already exists in this project",
        )
    create_data = schemas.ImageGroupCreate(
        project_id=project_id,
        identifier=body.identifier,
        display_name=body.display_name,
    )
    try:
        group = await crud.create_image_group(db, create_data, created_by=current_user.email)
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Group with identifier '{body.identifier}' already exists in this project",
        )
    return await _enrich_group(group, db)


@router.get(
    "/groups/{group_id}",
    response_model=schemas.ImageGroup,
)
async def get_group(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get details of a specific group."""
    group = await _get_group_or_403(group_id, db, current_user)
    return await _enrich_group(group, db)


@router.patch(
    "/groups/{group_id}",
    response_model=schemas.ImageGroup,
)
async def update_group(
    group_id: uuid.UUID,
    body: schemas.ImageGroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Update a group's identifier or display_name."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    if body.identifier is not None and body.identifier != group.identifier:
        existing = await crud.get_image_group_by_identifier(db, group.project_id, body.identifier)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Group with identifier '{body.identifier}' already exists in this project",
            )
    updated = await crud.update_image_group(db, group, body, updated_by=current_user.email)
    return await _enrich_group(updated, db)


@router.delete(
    "/groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_group(
    group_id: uuid.UUID,
    delete_images: bool = Query(False, description="Also soft-delete member images"),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Delete a group. Optionally also soft-deletes its images."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    project_id = group.project_id
    await crud.delete_image_group(
        db, group,
        delete_images=delete_images,
        deleted_by=current_user.email,
        actor_user_id=current_user.id,
        retention_days=settings.IMAGE_DELETE_RETENTION_DAYS,
    )
    _invalidate_project_image_cache(project_id)


@router.post(
    "/groups/{group_id}/images",
    status_code=status.HTTP_200_OK,
)
async def assign_images_to_group(
    group_id: uuid.UUID,
    image_ids: List[uuid.UUID],
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Assign a list of images to this group."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    count = await crud.assign_images_to_group(db, group.id, image_ids, project_id=group.project_id, assigned_by=current_user.email)
    _invalidate_project_image_cache(group.project_id)
    return {"assigned": count}


@router.delete(
    "/groups/{group_id}/images",
    status_code=status.HTTP_200_OK,
)
async def remove_images_from_group(
    group_id: uuid.UUID,
    image_ids: List[uuid.UUID],
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Remove a list of images from this group (sets group_id to NULL)."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    count = await crud.remove_images_from_group(db, group.id, image_ids, project_id=group.project_id, removed_by=current_user.email)
    _invalidate_project_image_cache(group.project_id)
    return {"removed": count}


@router.get(
    "/projects/{project_id}/has-groups",
)
async def project_has_groups(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Return whether the project has any image groups."""
    await get_project_or_403(project_id, db, current_user)
    has_groups = await crud.has_image_groups(db, project_id)
    return {"has_groups": has_groups}


@router.get(
    "/projects/{project_id}/ungrouped-count",
)
async def get_ungrouped_count(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Return the count of ungrouped (non-deleted) images in a project."""
    await get_project_or_403(project_id, db, current_user)
    count = await crud.count_ungrouped_images(db, project_id)
    return {"count": count}
