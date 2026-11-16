"""Routes for inspection nonconformance reports (NCRs)."""

import uuid

from fastapi import APIRouter, Body, Depends, Query, status
from pydantic import StrictInt
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from schemas import inspection_ncrs as ncr_schemas
from schemas import users as user_schemas
from services.inspection import ncrs as ncr_service
from utils.dependencies import ReadableProject, WritableProject, get_current_user

router = APIRouter(tags=["Inspection NCRs"])

PART_NCRS_PATH = "/projects/{project_id}/parts/{part_id}/ncrs"
PART_NCR_PATH = PART_NCRS_PATH + "/{ncr_id}"


@router.get(
    "/projects/{project_id}/ncrs",
    response_model=ncr_schemas.InspectionNcrListResponse,
)
async def list_project_ncrs(
    project_id: uuid.UUID,
    project: ReadableProject,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """List every NCR in a project, ordered by NCR number."""
    return await ncr_service.list_project_ncrs(
        db=db, project_id=project_id, include_deleted=include_deleted
    )


@router.get(
    "/projects/{project_id}/ncrs/{ncr_id}",
    response_model=ncr_schemas.InspectionNcrDetail,
)
async def get_project_ncr(
    project_id: uuid.UUID,
    ncr_id: uuid.UUID,
    project: ReadableProject,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Return one NCR with history by project, even if its part was deleted."""
    return await ncr_service.get_ncr_detail(
        db=db,
        project_id=project_id,
        part_id=None,
        ncr_id=ncr_id,
        include_deleted=include_deleted,
    )


@router.get(PART_NCRS_PATH, response_model=ncr_schemas.InspectionNcrListResponse)
async def list_part_ncrs(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    project: ReadableProject,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """List NCRs for one part; add ``include_deleted=true`` for deleted ones."""
    return await ncr_service.list_part_ncrs(
        db=db, project_id=project_id, part_id=part_id, include_deleted=include_deleted
    )


@router.post(
    PART_NCRS_PATH,
    response_model=ncr_schemas.InspectionNcrDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_part_ncr(
    part_id: uuid.UUID,
    project: WritableProject,
    payload: ncr_schemas.InspectionNcrCreate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Create an NCR on a part."""
    return await ncr_service.create_ncr(
        db=db,
        project=project,
        part_id=part_id,
        payload=payload,
        user_email=current_user.email,
    )


@router.get(PART_NCR_PATH, response_model=ncr_schemas.InspectionNcrDetail)
async def get_part_ncr(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    ncr_id: uuid.UUID,
    project: ReadableProject,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Return one NCR with its change history (deleted ones on request)."""
    return await ncr_service.get_ncr_detail(
        db=db,
        project_id=project_id,
        part_id=part_id,
        ncr_id=ncr_id,
        include_deleted=include_deleted,
    )


@router.patch(PART_NCR_PATH, response_model=ncr_schemas.InspectionNcrDetail)
async def update_part_ncr(
    part_id: uuid.UUID,
    ncr_id: uuid.UUID,
    project: WritableProject,
    payload: ncr_schemas.InspectionNcrUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Edit an NCR. Editing an approved NCR revokes its approval."""
    return await ncr_service.update_ncr(
        db=db,
        project=project,
        part_id=part_id,
        ncr_id=ncr_id,
        payload=payload,
        user_email=current_user.email,
    )


@router.post(PART_NCR_PATH + "/approve", response_model=ncr_schemas.InspectionNcrDetail)
async def approve_part_ncr(
    part_id: uuid.UUID,
    ncr_id: uuid.UUID,
    project: WritableProject,
    expected_version: StrictInt | None = Body(None, embed=True, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Approve an NCR and its disposition."""
    return await ncr_service.approve_ncr(
        db=db,
        project=project,
        part_id=part_id,
        ncr_id=ncr_id,
        user=current_user,
        expected_version=expected_version,
    )


@router.delete(PART_NCR_PATH, status_code=status.HTTP_204_NO_CONTENT)
async def delete_part_ncr(
    part_id: uuid.UUID,
    ncr_id: uuid.UUID,
    project: WritableProject,
    expected_version: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Soft-delete an NCR. It is kept with its history for traceability."""
    await ncr_service.delete_ncr(
        db=db,
        project=project,
        part_id=part_id,
        ncr_id=ncr_id,
        user_email=current_user.email,
        expected_version=expected_version,
    )
    return None
