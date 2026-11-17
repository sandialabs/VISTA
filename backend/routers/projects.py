import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from core import locks
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from repositories import images as image_repository
from repositories import projects as project_repository
from schemas import projects as project_schemas
from schemas import users as user_schemas
from services import dashboard as dashboard_service
from utils import cache_manager
from utils.dependencies import (
    ReadableProject,
    get_accessible_projects_page,
    get_current_user,
    get_project_or_403,
    get_project_or_403_writable,
    require_authenticated_user,
)

router = APIRouter(
    tags=["Projects"],
)

logger = logging.getLogger(__name__)

CROSS_GROUP_MOVE_DETAIL = (
    "Projects cannot be moved between access groups. The access group is fixed "
    "when the project is created."
)


@router.post(
    "/", response_model=project_schemas.Project, status_code=status.HTTP_201_CREATED
)
async def create_new_project(
    project: project_schemas.ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Create a new project if the user has access to the specified group.

    ``folder_id`` places it in a dashboard folder of the same access group; the
    folder must not be archived (or inside an archived folder).
    """
    # Check if the user is a member of the project's group
    is_member = is_user_in_group(
        current_user.email, project.meta_group_id, current_user
    )

    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' cannot create projects in group '{project.meta_group_id}'. Please contact an administrator for access.",
        )
    db_project = await dashboard_service.create_project(
        db, project, created_by=current_user.email
    )

    return (await dashboard_service.decorate_projects(db, [db_project]))[0]


@router.get("/", response_model=list[project_schemas.Project])
async def read_projects(
    response: Response,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Get the projects the current user has access to.

    Group filtering happens in the query, before ``skip``/``limit``, so a user
    never loses projects because other groups' projects filled the page. The
    total is returned in the ``X-Total-Count`` header.
    """
    page, total = await get_accessible_projects_page(
        db=db,
        user=current_user,
        skip=skip,
        limit=limit,
        include_archived=include_archived,
    )
    response.headers["X-Total-Count"] = str(total)
    return await dashboard_service.decorate_projects(db, page)


@router.get("/{project_id}", response_model=project_schemas.Project)
async def read_project(
    db_project: ReadableProject, db: AsyncSession = Depends(get_db)
):
    """Get a specific project by ID, if the user has access to it."""
    return (await dashboard_service.decorate_projects(db, [db_project]))[0]


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
    """Update project details (name, description, project_type).

    The access group cannot change: projects never move between access groups.
    Sending the current ``meta_group_id`` is accepted as a no-op.
    """
    db_project = await get_project_or_403_writable(project_id, db, current_user)

    updates = project_update.model_dump(exclude_unset=True)
    if "meta_group_id" in updates:
        if updates["meta_group_id"] != db_project.meta_group_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=CROSS_GROUP_MOVE_DETAIL,
            )
        updates.pop("meta_group_id")
        project_update = project_schemas.ProjectUpdate(**updates)

    updated = await project_repository.update_project(
        db=db,
        project_id=project_id,
        project=project_update,
        updated_by=current_user.email,
    )
    assert updated is not None

    return (await dashboard_service.decorate_projects(db, [updated]))[0]


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
    # An archived project can still be deleted (as before), but not one that is
    # locked by an archived folder: that folder's contents are frozen.
    if await locks.is_folder_or_ancestor_archived(db, db_project.folder_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is inside an archived folder. Unarchive the folder first, or delete the folder.",
        )

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
    await dashboard_service.set_project_archived(
        db, db_project, True, user_email=current_user.email
    )
    return (await dashboard_service.decorate_projects(db, [db_project]))[0]


@router.patch("/{project_id}/unarchive", response_model=project_schemas.Project)
async def unarchive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Unarchive a project, restoring full access and visibility.

    Refused while the project is inside an archived folder.
    """
    db_project = await get_project_or_403(project_id, db, current_user)
    await dashboard_service.set_project_archived(
        db, db_project, False, user_email=current_user.email
    )
    return (await dashboard_service.decorate_projects(db, [db_project]))[0]
