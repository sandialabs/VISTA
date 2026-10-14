import io
import logging
import uuid
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from schemas import export as export_schemas
from schemas import users as user_schemas
from services.export import backup_import as export_backup_import_service
from services.export import backups as export_backup_service
from services.export import bundles as export_bundle_service
from services.export import excel as export_excel_service
from services.export import project_backups as export_project_backup_service
from services.export import report_payloads as export_report_payload_service
from services.export import report_pdf as export_report_pdf_service
from services.export import storage as export_storage_service
from services.project_report_images import build_project_report_with_images_pdf
from utils.dependencies import (
    ReadableProject,
    get_accessible_projects_for_user,
    get_current_user,
)
from utils.streaming_zip import iter_streaming_zip

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Export"])


@router.get("/projects/{project_id}/export-excel")
async def export_project_excel(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """
    Export all project image data as a Microsoft Excel (.xlsx) file.

    Each image corresponds to one row. Columns are dynamic:
    - Filename (always first)
    - One column per unique metadata key found across all project images
    - Review Status, Reviewer, Review Date (most recent review for the image)
    - Image Classes (derived from classifications)
    - Comment (derived from comments)
    """

    rows, all_meta_keys = await export_excel_service.collect_project_excel_rows(
        db,
        project_id,
    )

    # Generate Excel workbook
    wb = export_excel_service.build_workbook(db_project.name, rows, all_meta_keys)

    # Stream response
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    safe_name = "".join(
        c if c.isalnum() or c in (" ", "-", "_") else "_" for c in db_project.name
    ).strip()
    filename = f"{safe_name}_export.xlsx"

    logger.info(
        "Excel export generated for project",
        extra={
            "row_count": len(rows),
        },
    )

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/projects/{project_id}/report-json")
async def export_project_report_json(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    schema_version: int = Query(default=3),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    if schema_version not in {2, 3}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="schema_version must be 2 or 3",
        )

    if schema_version == 2:
        report_payload = (
            await export_report_payload_service.build_legacy_project_report_payload(
                project_id=project_id,
                db=db,
                db_project=db_project,
            )
        )
    else:
        report_payload = (
            await export_report_payload_service.build_project_report_payload(
                project_id=project_id,
                db=db,
                db_project=db_project,
                schema_version=schema_version,
            )
        )
    return JSONResponse(content=report_payload)


@router.get("/projects/{project_id}/report-pdf")
async def export_project_report_pdf(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    schema_version: int = Query(default=3),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    if schema_version not in {2, 3}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="schema_version must be 2 or 3",
        )
    if schema_version == 2:
        report_payload = (
            await export_report_payload_service.build_legacy_project_report_payload(
                project_id=project_id,
                db=db,
                db_project=db_project,
            )
        )
        pdf_bytes = export_report_pdf_service.build_legacy_simple_report_pdf(
            report_payload
        )
    else:
        report_payload = (
            await export_report_payload_service.build_project_report_payload(
                project_id=project_id,
                db=db,
                db_project=db_project,
                schema_version=schema_version,
            )
        )
        pdf_bytes = export_report_pdf_service.build_simple_report_pdf(report_payload)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": export_report_pdf_service.report_content_disposition(
                db_project.name,
                "report",
            )
        },
    )


@router.get("/projects/{project_id}/report-with-images-pdf")
async def export_project_report_with_images_pdf(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    report = await build_project_report_with_images_pdf(
        project_id=project_id,
        db=db,
        project=db_project,
    )
    return Response(
        content=report.pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": export_report_pdf_service.report_content_disposition(
                db_project.name,
                "report-with-images",
            )
        },
    )


@router.get("/projects/{project_id}/export-bundle-json")
async def export_project_bundle_json(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    bundle_payload = await export_bundle_service.collect_project_bundle_payload(
        project_id=project_id,
        db=db,
        db_project=db_project,
    )
    return JSONResponse(content=bundle_payload)


@router.post("/projects/{project_id}/export-bundle/s3")
async def export_project_bundle_archive_to_s3(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    payload: export_schemas.S3ProjectExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    context = await export_project_backup_service.collect_project_backup_payload(
        project_id=project_id,
        db=db,
        db_project=db_project,
        current_user=current_user,
        include_images=payload.include_images,
        include_overlays=payload.include_overlays,
        include_metadata=payload.include_metadata,
        include_created_overlays=payload.include_created_overlays,
        include_project_configuration=payload.include_project_configuration,
        include_deleted=payload.include_deleted,
    )
    archive_bytes = await export_storage_service.zip_entries_to_bytes(
        export_backup_service.project_backup_entries(
            context,
            include_legacy_files=True,
            include_root_manifest=True,
        )
    )
    result = await export_storage_service.upload_backup_bytes_to_s3(
        s3_url=payload.s3_url,
        payload=archive_bytes,
        content_type="application/zip",
    )
    result["project_id"] = str(project_id)
    return result


@router.get("/projects/{project_id}/export-bundle")
async def export_project_bundle_archive(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    include_images: bool = True,
    include_overlays: bool = True,
    include_metadata: bool = True,
    include_created_overlays: bool = True,
    include_project_configuration: bool = True,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    context = await export_project_backup_service.collect_project_backup_payload(
        project_id=project_id,
        db=db,
        db_project=db_project,
        current_user=current_user,
        include_images=include_images,
        include_overlays=include_overlays,
        include_metadata=include_metadata,
        include_created_overlays=include_created_overlays,
        include_project_configuration=include_project_configuration,
        include_deleted=include_deleted,
    )
    safe_name = export_bundle_service.safe_export_name(db_project.name, "project")
    filename = f"{safe_name}_export_bundle.zip"
    return StreamingResponse(
        iter_streaming_zip(
            export_backup_service.project_backup_entries(
                context,
                include_legacy_files=True,
                include_root_manifest=True,
            )
        ),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-VISTA-Backup-Estimated-Bytes": str(
                export_backup_service.estimate_project_backup_size_bytes(context)
            ),
        },
    )


@router.get("/projects/{project_id}/export-bundle/estimate")
async def estimate_project_bundle_archive(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    include_images: bool = True,
    include_overlays: bool = True,
    include_metadata: bool = True,
    include_created_overlays: bool = True,
    include_project_configuration: bool = True,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    context = await export_project_backup_service.collect_project_backup_payload(
        project_id=project_id,
        db=db,
        db_project=db_project,
        current_user=current_user,
        include_images=include_images,
        include_overlays=include_overlays,
        include_metadata=include_metadata,
        include_created_overlays=include_created_overlays,
        include_project_configuration=include_project_configuration,
        include_deleted=include_deleted,
    )
    return {
        "estimated_bytes": export_backup_service.estimate_project_backup_size_bytes(
            context
        ),
        "artifact_counts": context["artifact_counts"],
    }


@router.post("/projects/import/preview")
async def preview_project_backup_import(
    file: UploadFile = File(...),
    current_user: user_schemas.User = Depends(get_current_user),
):
    del current_user
    return await _preview_backup(file)


async def _preview_backup(file: UploadFile) -> dict:
    try:
        return export_backup_import_service.preview_project_backup_import(file.file)
    finally:
        await file.close()


@router.post("/projects/import")
async def import_project_backup(
    file: UploadFile = File(...),
    mode: str = Form("restore_as_new"),
    confirmation: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await _restore_backup_as_new(file, mode, confirmation, db, current_user)


async def _restore_backup_as_new(
    file: UploadFile,
    mode: str,
    confirmation: str,
    db: AsyncSession,
    current_user: user_schemas.User,
) -> dict:
    try:
        return await export_backup_import_service.import_project_backup_archive(
            file_obj=file.file,
            mode=mode,
            confirmation=confirmation,
            db=db,
            current_user=current_user,
            can_access_group=is_user_in_group,
        )
    finally:
        await file.close()


async def _download_s3_backup(s3_url: str) -> UploadFile:
    return UploadFile(
        filename=s3_url,
        file=await export_storage_service.download_backup_from_s3(s3_url=s3_url),
    )


@router.post("/projects/{project_id}/import/s3")
async def import_project_backup_into_active_project_from_s3(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    payload: export_schemas.S3ProjectImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await _import_backup_into_project(
        await _download_s3_backup(payload.s3_url),
        payload.mode,
        payload.confirmation,
        db_project,
        db,
        current_user,
    )


@router.post("/projects/{project_id}/import")
async def import_project_backup_into_active_project(
    project_id: uuid.UUID,
    db_project: ReadableProject,
    file: UploadFile = File(...),
    mode: str = Form("append_active"),
    confirmation: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await _import_backup_into_project(
        file, mode, confirmation, db_project, db, current_user
    )


async def _import_backup_into_project(
    file: UploadFile,
    mode: str,
    confirmation: str,
    db_project: models.Project,
    db: AsyncSession,
    current_user: user_schemas.User,
) -> dict:
    try:
        return await export_backup_import_service.import_project_backup_archive_into_active_project(
            file_obj=file.file,
            mode=mode,
            confirmation=confirmation,
            db=db,
            current_user=current_user,
            target_project=db_project,
            can_access_group=is_user_in_group,
        )
    finally:
        await file.close()


@router.post("/dashboard/export/s3")
async def export_dashboard_backup_to_s3(
    payload: export_schemas.S3DashboardExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    (
        entries,
        _dashboard_state,
        _estimate,
    ) = await export_backup_service.build_dashboard_backup_entries(
        payload.model_dump(),
        db=db,
        current_user=current_user,
        list_projects=get_accessible_projects_for_user,
    )
    archive_bytes = await export_storage_service.zip_entries_to_bytes(entries)
    return await export_storage_service.upload_backup_bytes_to_s3(
        s3_url=payload.s3_url,
        payload=archive_bytes,
        content_type="application/vnd.vista.dashboard-backup+zip",
    )


@router.post("/dashboard/export")
async def export_dashboard_backup(
    options: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    (
        entries,
        _dashboard_state,
        estimated_bytes,
    ) = await export_backup_service.build_dashboard_backup_entries(
        options,
        db=db,
        current_user=current_user,
        list_projects=get_accessible_projects_for_user,
    )
    filename = (
        f"vista-dashboard-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.vistabundle"
    )
    return StreamingResponse(
        iter_streaming_zip(entries),
        media_type="application/vnd.vista.dashboard-backup+zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-VISTA-Backup-Estimated-Bytes": str(estimated_bytes),
        },
    )


@router.post("/dashboard/import/preview")
async def preview_dashboard_backup_import(
    file: UploadFile = File(...),
    current_user: user_schemas.User = Depends(get_current_user),
):
    del current_user
    return await _preview_backup(file)


@router.post("/dashboard/import/s3")
async def import_dashboard_backup_from_s3(
    payload: export_schemas.S3DashboardImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await _restore_backup_as_new(
        await _download_s3_backup(payload.s3_url),
        payload.mode,
        payload.confirmation,
        db,
        current_user,
    )


@router.post("/dashboard/import")
async def import_dashboard_backup(
    file: UploadFile = File(...),
    mode: str = Form("restore_as_new"),
    confirmation: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await _restore_backup_as_new(file, mode, confirmation, db, current_user)
