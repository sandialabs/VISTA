import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.group_auth_helper import is_user_in_group
from repositories import images as image_repository
from repositories import projects as project_repository
from schemas import projects as project_schemas
from schemas import users as user_schemas
from utils import cache_manager
from utils.dependencies import (
    ReadableProject,
    get_current_user,
    get_project_or_403,
    get_project_or_403_writable,
    require_authenticated_user,
)

router = APIRouter(
    tags=["Projects"],
)

logger = logging.getLogger(__name__)


@router.post(
    "/", response_model=project_schemas.Project, status_code=status.HTTP_201_CREATED
)
async def create_new_project(
    project: project_schemas.ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Create a new project if the user has access to the specified group.
    This uses the new approach of checking if the user is a member of the project's group.
    """
    # Check if the user is a member of the project's group
    is_member = is_user_in_group(current_user.email, project.meta_group_id)

    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' cannot create projects in group '{project.meta_group_id}'. Please contact an administrator for access.",
        )
    db_project = await project_repository.create_project(
        db=db, project=project, created_by=current_user.email
    )

    return db_project


@router.get("/", response_model=list[project_schemas.Project])
async def read_projects(
    skip: int = 0,
    limit: int = 100,
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Get all projects that the current user has access to.
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
    dashboard_counts = await project_repository.get_project_dashboard_counts(
        db, [project.id for project in projects]
    )
    return [
        project_schemas.Project.model_validate(project).model_copy(
            update=dashboard_counts.get(project.id, {"image_count": 0, "part_count": 0})
        )
        for project in projects
    ]


@router.get("/{project_id}", response_model=project_schemas.Project)
async def read_project(db_project: ReadableProject):
    """Get a specific project by ID, if the user has access to it."""
    return db_project


@router.get(
    "/{project_id}/data-summary", response_model=project_schemas.ProjectDataSummary
)
async def read_project_data_summary(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Return exact project data counts without loading full project records."""
    started = time.perf_counter()
    await get_project_or_403(project_id, db, current_user)
    access_ms = (time.perf_counter() - started) * 1000

    summary, query_timings = await image_repository.get_project_data_summary(
        db, project_id
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "PROJECT_DATA_SUMMARY",
        extra={
            "project_id": str(project_id),
            "access_ms": round(access_ms, 3),
            **query_timings,
            "total_ms": round(elapsed_ms, 3),
        },
    )
    return project_schemas.ProjectDataSummary(project_id=project_id, **summary)


@router.put("/{project_id}", response_model=project_schemas.Project)
async def update_existing_project(
    project_id: uuid.UUID,
    project_update: project_schemas.ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Update project metadata (name, description, group, project_type) if the user has access."""
    await get_project_or_403_writable(project_id, db, current_user)

    updates = project_update.model_dump(exclude_unset=True)
    if "meta_group_id" in updates and not is_user_in_group(
        current_user.email, updates["meta_group_id"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' cannot move project '{project_id}' to group '{updates['meta_group_id']}'.",
        )

    updated = await project_repository.update_project(
        db=db,
        project_id=project_id,
        project=project_update,
        updated_by=current_user.email,
    )
    assert updated is not None

    return updated


@router.delete("/{project_id}", response_model=project_schemas.ProjectDeleteResponse)
async def delete_existing_project(
    project_id: uuid.UUID,
    payload: project_schemas.ProjectDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(require_authenticated_user),
):
    """Delete a project after explicit user confirmation.
    Requires proxy-authenticated user context and exact confirmation phrase:
    ``DELETE <project_name>``.
    """
    db_project = await get_project_or_403(project_id, db, current_user)

    expected_phrase = f"DELETE {db_project.name}"
    if payload.confirmation_phrase != expected_phrase:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Confirmation phrase mismatch. Expected '{expected_phrase}'.",
        )

    deleted = await project_repository.delete_project(
        db=db, project_id=project_id, deleted_by=current_user.email
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    cache_manager.invalidate_project_images(project_id)

    return project_schemas.ProjectDeleteResponse(
        project_id=project_id, deleted=True, deleted_by=current_user.email
    )


@router.patch("/{project_id}/archive", response_model=project_schemas.Project)
async def archive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Archive a project, making it read-only and hidden from the default view."""
    db_project = await get_project_or_403(project_id, db, current_user)

    if db_project.created_by and db_project.created_by != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project creator can archive this project.",
        )

    result = await project_repository.archive_project(
        db=db, project_id=project_id, archived_by=current_user.email
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    return result


@router.patch("/{project_id}/unarchive", response_model=project_schemas.Project)
async def unarchive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Unarchive a project, restoring full access and visibility."""
    db_project = await get_project_or_403(project_id, db, current_user)

    if db_project.created_by and db_project.created_by != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project creator can unarchive this project.",
        )

    result = await project_repository.unarchive_project(
        db=db, project_id=project_id, unarchived_by=current_user.email
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    return result
