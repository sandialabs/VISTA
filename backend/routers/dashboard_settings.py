from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core import schemas
from core.database import (
    get_current_database_url,
    normalize_async_database_url,
    switch_database_url,
)
from core.models import DataInstance, InspectionPart, Project
from sqlalchemy.ext.asyncio import create_async_engine


router = APIRouter(
    prefix="/dashboard/settings",
    tags=["Dashboard Settings"],
)


class DatabaseUrlRequest(BaseModel):
    database_url: str = Field(..., min_length=1, max_length=2048)

    @field_validator("database_url")
    @classmethod
    def validate_supported_url(cls, value: str) -> str:
        cleaned = value.strip()
        supported_prefixes = (
            "postgresql://",
            "postgresql+asyncpg://",
            "sqlite://",
            "sqlite+aiosqlite://",
        )
        if not cleaned.startswith(supported_prefixes):
            raise ValueError("Database URL must use postgresql, postgresql+asyncpg, sqlite, or sqlite+aiosqlite.")
        return cleaned


class DatabaseUrlResponse(BaseModel):
    database_url: str


class DashboardProjectPreview(schemas.Project):
    image_count: int = 0
    part_count: int = 0


class DatabaseUrlPreviewResponse(BaseModel):
    database_url: str
    project_count: int
    projects: list[DashboardProjectPreview]


async def _load_dashboard_preview(database_url: str) -> DatabaseUrlPreviewResponse:
    preview_engine = create_async_engine(normalize_async_database_url(database_url), echo=False, future=True)
    try:
        async with AsyncSession(preview_engine) as db:
            project_rows = (await db.execute(select(Project).order_by(Project.created_at.desc()).limit(100))).scalars().all()
            project_ids = [project.id for project in project_rows]
            image_counts = {project_id: 0 for project_id in project_ids}
            part_counts = {project_id: 0 for project_id in project_ids}

            if project_ids:
                image_count_rows = await db.execute(
                    select(DataInstance.project_id, func.count(DataInstance.id))
                    .where(DataInstance.project_id.in_(project_ids), DataInstance.deleted_at.is_(None))
                    .group_by(DataInstance.project_id)
                )
                image_counts.update({project_id: count for project_id, count in image_count_rows})

                part_count_rows = await db.execute(
                    select(InspectionPart.project_id, func.count(InspectionPart.id))
                    .where(InspectionPart.project_id.in_(project_ids))
                    .group_by(InspectionPart.project_id)
                )
                part_counts.update({project_id: count for project_id, count in part_count_rows})

            projects = [
                DashboardProjectPreview.model_validate(project).model_copy(
                    update={
                        "image_count": image_counts.get(project.id, 0),
                        "part_count": part_counts.get(project.id, 0),
                    }
                )
                for project in project_rows
            ]
            return DatabaseUrlPreviewResponse(
                database_url=database_url,
                project_count=len(projects),
                projects=projects,
            )
    finally:
        await preview_engine.dispose()


@router.get("/database-url", response_model=DatabaseUrlResponse)
async def read_database_url():
    return DatabaseUrlResponse(database_url=get_current_database_url())


@router.post("/database-url/preview", response_model=DatabaseUrlPreviewResponse)
async def preview_database_url(payload: DatabaseUrlRequest):
    try:
        return await _load_dashboard_preview(payload.database_url)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to preview dashboard from the provided database URL: {exc}",
        ) from exc


@router.post("/database-url/accept", response_model=DatabaseUrlResponse)
async def accept_database_url(payload: DatabaseUrlRequest):
    try:
        accepted_url = await switch_database_url(payload.database_url)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to switch to the provided database URL: {exc}",
        ) from exc
    return DatabaseUrlResponse(database_url=accepted_url)
