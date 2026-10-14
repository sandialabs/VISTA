import asyncio
import io
import uuid

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
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from core.database import get_db
from repositories import images as image_repository
from schemas import image_deletion as image_deletion_schemas
from schemas import images as image_schemas
from schemas import inspection_volumes as inspection_volume_schemas
from schemas import project_metadata as project_metadata_schemas
from schemas import users as user_schemas
from services import image_deletion as image_deletion_service
from services.analyze import execution as analyze_execution_service
from services.images import listing as image_listing_service
from services.images import metadata as image_metadata_service
from services.images import s3_import_workflow as image_s3_import_workflow
from services.images import s3_imports as image_s3_import_service
from services.images import storage_limits as image_storage_limit_service
from services.images import thumbnails as image_thumbnail_service
from services.images import upload as image_upload_service
from services.images import volume_serving as image_volume_serving
from services.images import volume_sources as image_volume_source_service
from utils import cache_manager
from utils.boto3_client import (
    delete_file_from_s3,
    get_presigned_download_url,
)
from utils.dependencies import (
    AccessibleImage,
    WritableProject,
    get_current_user,
    get_image_or_403_writable,
    get_project_or_403,
)
from utils.file_security import get_content_disposition_header

router = APIRouter(
    tags=["Images"],
)

def _inline_image_bytes(db_image: models.DataInstance) -> bytes | None:
    metadata = (
        db_image.metadata_json if isinstance(db_image.metadata_json, dict) else {}
    )
    encoded = metadata.get("analysis_inline_image_base64")
    if not isinstance(encoded, str) or not encoded:
        return None
    try:
        return analyze_execution_service.inline_image_bytes_from_metadata(
            metadata,
            getattr(db_image, "filename", "inline image"),
        )
    except ValueError:
        return None


@router.post(
    "/projects/{project_id}/s3/list", response_model=image_schemas.S3ListResponse
)
async def list_project_s3_files(
    project_id: uuid.UUID,
    request: image_schemas.S3ListRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """List supported files under an S3 URL so the user can choose imports."""
    await get_project_or_403(project_id, db, current_user)
    return await image_s3_import_service.list_supported_s3_files(request)


@router.post(
    "/projects/{project_id}/s3/import",
    response_model=image_schemas.S3ImportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_project_s3_files(
    project_id: uuid.UUID,
    db_project: WritableProject,
    request: image_schemas.S3ImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Copy selected S3 objects with bounded storage work and one DB commit."""
    return await image_s3_import_workflow.import_project_s3_files(
        db=db,
        db_project=db_project,
        request=request,
        current_user=current_user,
    )


@router.post(
    "/projects/{project_id}/images/batch",
    response_model=image_schemas.BatchImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_images_to_project_batch(
    project_id: uuid.UUID,
    db_project: WritableProject,
    files: list[UploadFile] = File(...),
    manifest_file: UploadFile = File(..., alias="manifest"),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await image_upload_service.upload_images_to_project_batch(
        db_project=db_project,
        files=files,
        manifest_file=manifest_file,
        db=db,
        current_user=current_user,
    )


@router.post(
    "/projects/{project_id}/images",
    response_model=image_schemas.DataInstance,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image_to_project(
    project_id: uuid.UUID,
    db_project: WritableProject,
    file: UploadFile = File(...),
    metadata_json: str | None = Form(None, alias="metadata"),
    group_identifier: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await image_upload_service.upload_image_to_project(
        db_project=db_project,
        file=file,
        metadata_json=metadata_json,
        group_identifier=group_identifier,
        db=db,
        current_user=current_user,
    )


@router.get(
    "/projects/{project_id}/images", response_model=list[image_schemas.DataInstance]
)
async def list_images_in_project(
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    search_field: str | None = Query(None),
    search_value: str | None = Query(None),
    group_id: uuid.UUID | None = Query(None),
    ungrouped: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Retrieves a list of images for a given project.
    It first verifies project existence and user access, then uses a per-user
    cache for performance before falling back to the database.
    Optionally filter by group_id, or pass ungrouped=true to get images with no group.
    These two filters are mutually exclusive.
    """
    filters = image_listing_service.ImageListFilters(
        include_deleted=include_deleted,
        deleted_only=deleted_only,
        search_field=search_field,
        search_value=search_value,
        group_id=group_id,
        ungrouped=ungrouped,
    )
    # Check project access BEFORE cache lookup to prevent cross-user data leakage
    try:
        await get_project_or_403(project_id, db, current_user)
    except HTTPException as e:
        if e.status_code == status.HTTP_404_NOT_FOUND:
            # If project doesn't exist, return empty list instead of 404
            return []
        raise
    return await image_listing_service.list_project_images(
        db,
        project_id=project_id,
        user_email=current_user.email,
        filters=filters,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/projects/{project_id}/images-page", response_model=image_schemas.DataInstancePage
)
async def list_images_in_project_page(
    project_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(None, max_length=512),
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    search_field: str | None = Query(None),
    search_value: str | None = Query(None),
    group_id: uuid.UUID | None = Query(None),
    ungrouped: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Return an exact-count, stable keyset page of project images."""
    filters = image_listing_service.ImageListFilters(
        include_deleted=include_deleted,
        deleted_only=deleted_only,
        search_field=search_field,
        search_value=search_value,
        group_id=group_id,
        ungrouped=ungrouped,
    )
    await get_project_or_403(project_id, db, current_user)
    return await image_listing_service.list_project_image_page(
        db, project_id=project_id, filters=filters, limit=limit, cursor=cursor
    )


# Add trailing slash version to handle frontend requests
@router.get(
    "/projects/{project_id}/images/", response_model=list[image_schemas.DataInstance]
)
async def list_images_in_project_with_slash(
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    search_field: str | None = Query(None),
    search_value: str | None = Query(None),
    group_id: uuid.UUID | None = Query(None),
    ungrouped: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Provides an alternative endpoint for listing project images.
    This route handles requests with a trailing slash, redirecting to the main function.
    It ensures compatibility with various frontend routing configurations.
    """
    # Just call the main function to avoid code duplication
    return await list_images_in_project(
        project_id,
        skip,
        limit,
        include_deleted,
        deleted_only,
        search_field,
        search_value,
        group_id,
        ungrouped,
        db,
        current_user,
    )


@router.get("/images/{image_id}", response_model=image_schemas.DataInstance)
async def get_image_metadata(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Fetches metadata for a specific image using its ID.
    It verifies image existence and user access before checking the per-user
    cache, then falls back to serialization from the database record.
    """
    # AccessibleImage checks existence and access BEFORE the cache lookup so
    # revoked permissions never serve stale cached data.
    return await image_listing_service.get_image_record(
        db, db_image=db_image, user_email=current_user.email
    )


@router.get(
    "/images/{image_id}/download",
    response_model=project_metadata_schemas.PresignedUrlResponse,
)
async def get_image_download_url(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Generates a presigned URL for downloading a specific image.
    It retrieves the image details and checks user permissions.
    The URL allows direct download from the object storage.
    """

    # Get the presigned URL for internal use
    internal_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET, object_name=db_image.object_storage_key
    )
    if not internal_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not generate download URL",
        )

    # Create a proxy URL that goes through our API
    proxy_url = f"/images/{image_id}/content"

    return project_metadata_schemas.PresignedUrlResponse(
        url=proxy_url, object_key=db_image.object_storage_key
    )


def _volume_source_access() -> image_volume_source_service.VolumeSourceAccess:
    return image_volume_source_service.VolumeSourceAccess(
        inline_image_bytes=_inline_image_bytes,
        get_presigned_download_url=get_presigned_download_url,
    )


@router.get("/images/{image_id}/volume-metadata")
async def get_image_volume_metadata(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    return await image_volume_serving.get_volume_metadata(
        db, db_image, _volume_source_access()
    )


@router.get("/images/{image_id}/volume-render-summary")
async def get_image_volume_render_summary(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Return optional, bounded slice hints for sparse NPY RGBA rendering."""
    return await image_volume_serving.get_volume_render_summary(
        db_image, _volume_source_access()
    )


@router.get("/images/{image_id}/volume-slice", response_class=StreamingResponse)
async def get_image_volume_slice(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    axis: str = Query("axial"),
    index: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    png, safe_axis = await image_volume_serving.get_volume_slice_png(
        db_image, _volume_source_access(), axis=axis, index=index
    )
    return StreamingResponse(
        content=io.BytesIO(png),
        media_type="image/png",
        headers={
            "Content-Disposition": get_content_disposition_header(
                f"{db_image.filename or 'volume'}-{safe_axis}-{index}.png", "inline"
            ),
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.post(
    "/images/{image_id}/volume-connected-selection",
    response_model=inspection_volume_schemas.VolumeConnectedSelectionResponse,
)
async def select_connected_image_volume(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    payload: inspection_volume_schemas.VolumeConnectedSelectionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Select a guarded 6-connected intensity region from an authorized volume."""
    return await image_volume_serving.select_connected_volume(
        db_image, _volume_source_access(), payload
    )


@router.get("/images/{image_id}/content", response_class=StreamingResponse)
async def get_image_content(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    convert: bool = Query(
        True, description="Convert non-web formats (TIFF, BMP) to PNG/JPEG"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Streams the content of an image from object storage.
    This endpoint acts as a proxy, ensuring proper access control.
    It returns the image data with appropriate headers for inline display.

    Non-web-friendly formats (TIFF, BMP, etc.) are automatically converted to
    PNG or JPEG to ensure browser compatibility while preserving original dimensions.
    Set convert=false to download the original file without conversion.
    """
    content, media_type = await image_thumbnail_service.get_image_content(
        db_image=db_image,
        convert=convert,
        inline_image_bytes=_inline_image_bytes,
        get_presigned_download_url=get_presigned_download_url,
    )
    return StreamingResponse(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": get_content_disposition_header(
                db_image.filename, "inline"
            )
        },
    )


@router.get("/images/{image_id}/thumbnail", response_class=StreamingResponse)
async def get_image_thumbnail(
    image_id: uuid.UUID,
    db_image: AccessibleImage,
    width: int = Query(200, description="Thumbnail width in pixels"),
    height: int = Query(200, description="Thumbnail height in pixels"),
):
    (
        thumbnail_data,
        content_type,
        filename,
    ) = await image_thumbnail_service.get_image_thumbnail(
        db_image=db_image,
        width=width,
        height=height,
        inline_image_bytes=_inline_image_bytes,
        get_presigned_download_url=get_presigned_download_url,
    )
    return StreamingResponse(
        content=io.BytesIO(thumbnail_data),
        media_type=content_type,
        headers={
            "Content-Disposition": get_content_disposition_header(filename, "inline")
        },
    )


async def _delete_image_storage_object(
    bucket_name: str,
    object_storage_key: str,
) -> bool:
    """Run the legacy blocking boto3 deletion without blocking the event loop."""
    async with image_storage_limit_service.storage_operation_slot():
        return await asyncio.to_thread(
            delete_file_from_s3,
            bucket_name,
            object_storage_key,
        )


@router.delete(
    "/projects/{project_id}/images/{image_id}",
    response_model=image_schemas.DataInstance,
)
async def delete_image(
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    body: image_schemas.ImageDeleteRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    normalized_reason = body.reason.strip()
    if len(normalized_reason) < settings.IMAGE_DELETE_REASON_MIN_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Reason must be at least {settings.IMAGE_DELETE_REASON_MIN_CHARS} characters",
        )
    db_image = await get_image_or_403_writable(image_id, db, current_user)
    if db_image.project_id != project_id:
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        outcome = await image_deletion_service.delete_authorized_image(
            db=db,
            project_id=project_id,
            image_id=image_id,
            actor_user_id=current_user.id,
            actor_email=current_user.email,
            reason=normalized_reason,
            retention_days=settings.IMAGE_DELETE_RETENTION_DAYS,
            force=bool(body.force),
            storage_bucket=settings.S3_BUCKET,
            delete_storage=_delete_image_storage_object,
        )
    finally:
        cache_manager.invalidate_images(project_id, [image_id])
    return outcome.image


@router.post(
    "/projects/{project_id}/images/{image_id}/restore",
    response_model=image_schemas.DataInstance,
)
async def restore_deleted_image(
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    db_image = await get_image_or_403_writable(image_id, db, current_user)
    if db_image.project_id != project_id:
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        restored_image = await image_deletion_service.restore_authorized_image(
            db=db,
            project_id=project_id,
            image_id=image_id,
            actor_user_id=current_user.id,
        )
    finally:
        cache_manager.invalidate_images(project_id, [image_id])
    return restored_image


@router.get(
    "/projects/{project_id}/images/deletion-events",
    response_model=image_deletion_schemas.ImageDeletionEventList,
)
async def list_image_deletion_events(
    project_id: uuid.UUID,
    image_id: uuid.UUID | None = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    events = await image_repository.list_image_deletion_events(
        db, project_id, image_id=image_id, skip=skip, limit=limit
    )
    total = await image_repository.count_image_deletion_events(
        db, project_id, image_id=image_id
    )
    return image_deletion_schemas.ImageDeletionEventList(events=events, total=total)


@router.put(
    "/images/{image_id}/metadata",
    response_model=image_schemas.DataInstance,
    status_code=status.HTTP_200_OK,
)
async def update_image_metadata(
    image_id: uuid.UUID,
    metadata: image_schemas.MetadataUpdate = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Updates the metadata for a specific image.
    It allows adding or modifying a key-value pair in the image's metadata.
    The changes are persisted to the database and caches are invalidated.
    """
    db_image = await get_image_or_403_writable(image_id, db, current_user)
    project_id = db_image.project_id

    current_metadata = dict(db_image.metadata_json or {})
    current_metadata[metadata.key] = metadata.value
    return await image_metadata_service.persist_image_metadata(
        db=db,
        db_image=db_image,
        image_id=image_id,
        project_id=project_id,
        metadata=current_metadata,
    )


@router.delete(
    "/images/{image_id}/metadata/{key}",
    response_model=image_schemas.DataInstance,
    status_code=status.HTTP_200_OK,
)
async def delete_image_metadata(
    image_id: uuid.UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """Deletes a specific metadata key-value pair from an image.
    It first retrieves the image, checks permissions, and then removes the metadata.
    The database is updated, and relevant caches are cleared.
    """
    db_image = await get_image_or_403_writable(image_id, db, current_user)
    project_id = db_image.project_id

    current_metadata = dict(db_image.metadata_json or {})
    if key in current_metadata:
        del current_metadata[key]
    return await image_metadata_service.persist_image_metadata(
        db=db,
        db_image=db_image,
        image_id=image_id,
        project_id=project_id,
        metadata=current_metadata,
    )
