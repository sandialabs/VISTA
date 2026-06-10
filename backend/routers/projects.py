import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import utils.crud as crud
from core import schemas
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from utils.dependencies import get_current_user, require_proxy_user
from aiocache import Cache

router = APIRouter(
    tags=["Projects"],
)

@router.post("/", response_model=schemas.Project, status_code=status.HTTP_201_CREATED)
async def create_new_project(
    project: schemas.ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Create a new project if the user has access to the specified group.
    This uses the new approach of checking if the user is a member of the project's group.
    """
    # Check if the user is a member of the project's group
    is_member = is_user_in_group(current_user.email, project.meta_group_id)
    
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' cannot create projects in group '{project.meta_group_id}'. Please contact an administrator for access.",
        )
    db_project = await crud.create_project(db=db, project=project, created_by=current_user.email)
    
    # Invalidate all projects cache entries for this user since we added a new project
    cache = Cache()
    # Delete cache entries for common pagination patterns
    cache_patterns = [
        f"projects:user:{current_user.email}:skip:0:limit:100",
        f"projects:user:{current_user.email}:skip:0:limit:50", 
        f"projects:user:{current_user.email}:skip:0:limit:20",
        f"projects:user:{current_user.email}:skip:0:limit:10"
    ]
    
    for cache_key in cache_patterns:
        await cache.delete(cache_key)
    
    return db_project

@router.get("/", response_model=List[schemas.Project])
#@cached(ttl=3600, key_builder=lambda *args, **kwargs: f"projects:user:{kwargs['current_user'].email}:skip:{kwargs.get('skip', 0)}:limit:{kwargs.get('limit', 100)}")
async def read_projects(
    skip: int = 0,
    limit: int = 100,
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Get all projects that the current user has access to.
    This uses the new approach of iterating through projects and checking if the user
    is a member of each project's group.
    """
    from utils.dependencies import get_accessible_projects_for_user
    
    # Get all projects the user has access to
    projects = await get_accessible_projects_for_user(
        db=db, 
        user=current_user, 
        skip=skip, 
        limit=limit,
        include_archived=include_archived,
    )
    dashboard_counts = await crud.get_project_dashboard_counts(db, [project.id for project in projects])
    return [
        schemas.Project.model_validate(project).model_copy(
            update=dashboard_counts.get(project.id, {"image_count": 0, "part_count": 0})
        )
        for project in projects
    ]

@router.get("/{project_id}", response_model=schemas.Project)
#@cached(ttl=3600, key_builder=lambda *args, **kwargs: f"project:{kwargs['project_id']}:user:{kwargs['current_user'].email}")
async def read_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Get a specific project by ID, if the user has access to it.
    This uses the new approach of checking if the user is a member of the project's group.
    """
    db_project = await crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    
    # Check if the user is a member of the project's group
    is_member = is_user_in_group(current_user.email, db_project.meta_group_id)
    
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to project '{project_id}' (group '{db_project.meta_group_id}'). Please contact an administrator if you need access to this project.",
        )
    return db_project


@router.put("/{project_id}", response_model=schemas.Project)
async def update_existing_project(
    project_id: uuid.UUID,
    project_update: schemas.ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Update project metadata (name, description, group, project_type) if the user has access.
    """
    db_project = await crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Must have access to current project group.
    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to update project '{project_id}' (group '{db_project.meta_group_id}').",
        )

    updates = project_update.model_dump(exclude_unset=True)
    if "meta_group_id" in updates and not is_user_in_group(current_user.email, updates["meta_group_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' cannot move project '{project_id}' to group '{updates['meta_group_id']}'.",
        )

    updated = await crud.update_project(
        db=db,
        project_id=project_id,
        project=project_update,
        updated_by=current_user.email,
    )
    assert updated is not None

    cache = Cache()
    cache_patterns = [
        f"projects:user:{current_user.email}:skip:0:limit:100",
        f"projects:user:{current_user.email}:skip:0:limit:50",
        f"projects:user:{current_user.email}:skip:0:limit:20",
        f"projects:user:{current_user.email}:skip:0:limit:10",
    ]
    for cache_key in cache_patterns:
        await cache.delete(cache_key)

    return updated


@router.delete("/{project_id}", response_model=schemas.ProjectDeleteResponse)
async def delete_existing_project(
    project_id: uuid.UUID,
    payload: schemas.ProjectDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(require_proxy_user),
):
    """
    Delete a project after explicit user confirmation.
    Requires proxy-authenticated user context and exact confirmation phrase:
    ``DELETE <project_name>``.
    """
    db_project = await crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to delete project '{project_id}' (group '{db_project.meta_group_id}').",
        )

    expected_phrase = f"DELETE {db_project.name}"
    if payload.confirmation_phrase != expected_phrase:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Confirmation phrase mismatch. Expected '{expected_phrase}'.",
        )

    deleted = await crud.delete_project(db=db, project_id=project_id, deleted_by=current_user.email)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    cache = Cache()
    cache_patterns = [
        f"projects:user:{current_user.email}:skip:0:limit:100",
        f"projects:user:{current_user.email}:skip:0:limit:50",
        f"projects:user:{current_user.email}:skip:0:limit:20",
        f"projects:user:{current_user.email}:skip:0:limit:10",
    ]
    for cache_key in cache_patterns:
        await cache.delete(cache_key)

    return schemas.ProjectDeleteResponse(project_id=project_id, deleted=True, deleted_by=current_user.email)


@router.patch("/{project_id}/archive", response_model=schemas.Project)
async def archive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Archive a project, making it read-only and hidden from the default view."""
    db_project = await crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    if db_project.created_by and db_project.created_by != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project creator can archive this project.",
        )

    result = await crud.archive_project(db=db, project_id=project_id, archived_by=current_user.email)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    cache = Cache()
    for pattern_limit in [10, 20, 50, 100]:
        await cache.delete(f"projects:user:{current_user.email}:skip:0:limit:{pattern_limit}")

    return result


@router.patch("/{project_id}/unarchive", response_model=schemas.Project)
async def unarchive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Unarchive a project, restoring full access and visibility."""
    db_project = await crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    if db_project.created_by and db_project.created_by != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project creator can unarchive this project.",
        )

    result = await crud.unarchive_project(db=db, project_id=project_id, unarchived_by=current_user.email)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    cache = Cache()
    for pattern_limit in [10, 20, 50, 100]:
        await cache.delete(f"projects:user:{current_user.email}:skip:0:limit:{pattern_limit}")

    return result
