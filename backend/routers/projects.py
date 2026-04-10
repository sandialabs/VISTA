import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import utils.crud as crud
from core import schemas
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from utils.dependencies import get_current_user
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
async def read_projects(
    skip: int = 0,
    limit: int = 100,
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Get all projects that the current user has access to.
    By default archived projects are excluded; pass include_archived=true to include them.
    """
    from utils.dependencies import get_accessible_projects_for_user
    
    projects = await get_accessible_projects_for_user(
        db=db, 
        user=current_user, 
        skip=skip, 
        limit=limit,
        include_archived=include_archived,
    )
    return projects

@router.get("/{project_id}", response_model=schemas.Project)
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


@router.patch("/{project_id}/archive", response_model=schemas.Project)
async def archive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Archive a project, making it read-only and hidden from the default view.
    Only the project creator can archive it."""
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
    # Note: projects without a recorded creator (created_by is NULL, i.e. legacy projects)
    # can be archived by any group member, since there is no creator to enforce ownership.

    result = await crud.archive_project(db=db, project_id=project_id, archived_by=current_user.email)

    # Invalidate project list cache for all common pagination patterns
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
    """Unarchive a project, restoring full access and visibility.
    Only the project creator can unarchive it."""
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
    # Note: projects without a recorded creator (created_by is NULL, i.e. legacy projects)
    # can be unarchived by any group member, since there is no creator to enforce ownership.

    result = await crud.unarchive_project(db=db, project_id=project_id, unarchived_by=current_user.email)

    # Invalidate project list cache for all common pagination patterns
    cache = Cache()
    for pattern_limit in [10, 20, 50, 100]:
        await cache.delete(f"projects:user:{current_user.email}:skip:0:limit:{pattern_limit}")

    return result
