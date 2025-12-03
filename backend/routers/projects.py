import uuid
from fastapi import APIRouter, Depends, HTTPException, status
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
#@cached(ttl=3600, key_builder=lambda *args, **kwargs: f"projects:user:{kwargs['current_user'].email}:skip:{kwargs.get('skip', 0)}:limit:{kwargs.get('limit', 100)}")
async def read_projects(
    skip: int = 0,
    limit: int = 100,
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
        limit=limit
    )
    return projects

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
