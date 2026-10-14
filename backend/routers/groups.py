"""Router for image group management."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from core.database import get_db
from repositories import image_groups as image_group_repository
from schemas import image_groups as image_group_schemas
from schemas import users as user_schemas
from utils import cache_manager
from utils.dependencies import (
    get_current_user,
    get_project_or_403,
    get_project_or_403_writable,
)

router = APIRouter(tags=["Groups"])


# ---- helpers ----


async def _get_group_or_403(
    group_id: uuid.UUID,
    db: AsyncSession,
    current_user: user_schemas.User,
) -> models.ImageGroup:
    group = await image_group_repository.get_image_group(db, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )
    # Verify project access
    await get_project_or_403(group.project_id, db, current_user)
    return group


async def _get_group_or_403_writable(
    group_id: uuid.UUID,
    db: AsyncSession,
    current_user: user_schemas.User,
) -> models.ImageGroup:
    group = await image_group_repository.get_image_group(db, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )
    # Verify project access and that the project is not archived
    await get_project_or_403_writable(group.project_id, db, current_user)
    return group


async def _enrich_group(
    group: models.ImageGroup,
    db: AsyncSession,
) -> image_group_schemas.ImageGroup:
    """Add image_count and aggregate_review_status to a group schema."""
    image_count = await image_group_repository.count_images_for_group(db, group.id)
    agg_status = await image_group_repository.get_aggregate_review_status_for_group(
        db, group.id
    )
    schema = image_group_schemas.ImageGroup.model_validate(group)
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
    counts = await image_group_repository.get_image_counts_for_groups(db, group_ids)
    agg_statuses = (
        await image_group_repository.get_aggregate_review_statuses_for_groups(
            db, group_ids
        )
    )
    enriched = []
    for g in groups:
        schema = image_group_schemas.ImageGroup.model_validate(g)
        schema.image_count = counts.get(g.id, 0)
        schema.aggregate_review_status = agg_statuses.get(g.id)
        enriched.append(schema)
    return enriched


# ---- endpoints ----


@router.get(
    "/projects/{project_id}/groups",
    response_model=image_group_schemas.ImageGroupList,
)
async def list_groups(
    project_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """List all groups in a project with image counts and aggregate review status."""
    await get_project_or_403(project_id, db, current_user)
    groups = await image_group_repository.list_image_groups(
        db, project_id, skip=skip, limit=limit, search=search
    )
    total = await image_group_repository.count_image_groups(
        db, project_id, search=search
    )
    enriched = await _enrich_groups_batch(groups, db)
    return image_group_schemas.ImageGroupList(groups=enriched, total=total)


@router.post(
    "/projects/{project_id}/groups",
    response_model=image_group_schemas.ImageGroup,
    status_code=status.HTTP_201_CREATED,
)
async def create_group(
    project_id: uuid.UUID,
    body: image_group_schemas.ImageGroupBase,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Create a new image group in a project."""
    await get_project_or_403_writable(project_id, db, current_user)
    existing = await image_group_repository.get_image_group_by_identifier(
        db, project_id, body.identifier
    )
    if existing:
        detail = (
            f"Group with identifier '{body.identifier}' already exists in this project"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        )
    create_data = image_group_schemas.ImageGroupCreate(
        project_id=project_id,
        identifier=body.identifier,
        display_name=body.display_name,
    )
    try:
        group = await image_group_repository.create_image_group(
            db, create_data, created_by=current_user.email
        )
    except IntegrityError:
        detail = (
            f"Group with identifier '{body.identifier}' already exists in this project"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        ) from None
    return await _enrich_group(group, db)


@router.get(
    "/groups/{group_id}",
    response_model=image_group_schemas.ImageGroup,
)
async def get_group(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Get details of a specific group."""
    group = await _get_group_or_403(group_id, db, current_user)
    return await _enrich_group(group, db)


@router.patch(
    "/groups/{group_id}",
    response_model=image_group_schemas.ImageGroup,
)
async def update_group(
    group_id: uuid.UUID,
    body: image_group_schemas.ImageGroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Update a group's identifier or display_name."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    if body.identifier is not None and body.identifier != group.identifier:
        existing = await image_group_repository.get_image_group_by_identifier(
            db, group.project_id, body.identifier
        )
        if existing:
            detail = f"Group with identifier '{body.identifier}' already exists in this project"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=detail,
            )
    updated = await image_group_repository.update_image_group(
        db, group, body, updated_by=current_user.email
    )
    return await _enrich_group(updated, db)


@router.delete(
    "/groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_group(
    group_id: uuid.UUID,
    delete_images: bool = Query(False, description="Also soft-delete member images"),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Delete a group. Optionally also soft-deletes its images."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    project_id = group.project_id
    affected_image_ids = await image_group_repository.delete_image_group(
        db,
        group,
        delete_images=delete_images,
        deleted_by=current_user.email,
        actor_user_id=current_user.id,
        retention_days=settings.IMAGE_DELETE_RETENTION_DAYS,
    )
    cache_manager.invalidate_images(project_id, affected_image_ids)


@router.post(
    "/groups/{group_id}/images",
    status_code=status.HTTP_200_OK,
)
async def assign_images_to_group(
    group_id: uuid.UUID,
    image_ids: list[uuid.UUID],
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Assign a list of images to this group."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    count = await image_group_repository.assign_images_to_group(
        db,
        group.id,
        image_ids,
        project_id=group.project_id,
        assigned_by=current_user.email,
    )
    cache_manager.invalidate_images(group.project_id, image_ids)
    return {"assigned": count}


@router.delete(
    "/groups/{group_id}/images",
    status_code=status.HTTP_200_OK,
)
async def remove_images_from_group(
    group_id: uuid.UUID,
    image_ids: list[uuid.UUID],
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Remove a list of images from this group (sets group_id to NULL)."""
    group = await _get_group_or_403_writable(group_id, db, current_user)
    count = await image_group_repository.remove_images_from_group(
        db,
        group.id,
        image_ids,
        project_id=group.project_id,
        removed_by=current_user.email,
    )
    cache_manager.invalidate_images(group.project_id, image_ids)
    return {"removed": count}


@router.get(
    "/projects/{project_id}/has-groups",
)
async def project_has_groups(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Return whether the project has any image groups."""
    await get_project_or_403(project_id, db, current_user)
    has_groups = await image_group_repository.has_image_groups(db, project_id)
    return {"has_groups": has_groups}


@router.get(
    "/projects/{project_id}/ungrouped-count",
)
async def get_ungrouped_count(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Return the count of ungrouped (non-deleted) images in a project."""
    await get_project_or_403(project_id, db, current_user)
    count = await image_group_repository.count_ungrouped_images(db, project_id)
    return {"count": count}
