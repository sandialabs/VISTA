import uuid
import io
import os
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query, Body
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import utils.crud as crud
from core import schemas, models
from core.database import get_db
from core.config import settings
from core.group_auth_helper import is_user_in_group
from utils.dependencies import get_current_user
from utils.dependencies import get_project_or_403, get_project_or_403_writable, get_image_or_403_writable
from utils.boto3_client import upload_file_to_s3, get_presigned_download_url, delete_file_from_s3
from utils.serialization import to_data_instance_schema
from utils.file_security import get_content_disposition_header
from utils.cache_manager import get_cache
import json as _json
from PIL import Image

router = APIRouter(
    tags=["Images"],
)

@router.post("/projects/{project_id}/images", response_model=schemas.DataInstance, status_code=status.HTTP_201_CREATED)
async def upload_image_to_project(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    metadata_json: Optional[str] = Form(None, alias="metadata"),
    group_identifier: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Uploads an image file to a specified project.
    It handles file validation, metadata parsing, and storage.
    The image is associated with the project and the uploading user.
    Optionally accepts group_identifier to assign the image to a group (find-or-create).
    """
    db_project = await get_project_or_403_writable(project_id, db, current_user)
    # Capture scalar values before any blocking IO to avoid MissingGreenlet
    # errors when SQLAlchemy tries to lazy-load expired attributes.
    db_project_id = db_project.id
    image_id = uuid.uuid4()
    object_storage_key = f"{db_project_id}/{image_id}/{file.filename}"
    parsed_metadata: Optional[Dict[str, Any]] = None
    if metadata_json:
        try:
            parsed_metadata = _json.loads(metadata_json)
        except _json.JSONDecodeError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON format for metadata")
    # If metadata_json is None or empty string, parsed_metadata remains None
    # Basic validation
    max_size = int(os.getenv("MAX_UPLOAD_BYTES", "10485760"))  # 10MB default
    # Try to read a small chunk to estimate streaming health, but do not load all into memory
    try:
        file.file.seek(0, io.SEEK_END)
        file_size = file.file.tell()
        file.file.seek(0)
        if file_size and file_size > max_size:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    except Exception:
        # If we cannot get size ahead of time, proceed to stream; S3 client will handle
        file_size = None
    success = await upload_file_to_s3(
        bucket_name=settings.S3_BUCKET,
        object_name=object_storage_key,
        file_data=file.file,
        length=file_size or 0,
        content_type=file.content_type
    )
    if not success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to upload file to object storage")

    # Resolve group_id if a group_identifier was supplied
    resolved_group_id: Optional[uuid.UUID] = None
    if group_identifier and group_identifier.strip():
        group = await crud.get_or_create_image_group(
            db, project_id, group_identifier.strip(), created_by=current_user.email
        )
        resolved_group_id = group.id

    data_instance_create = schemas.DataInstanceCreate(
        project_id=db_project_id,
        filename=file.filename,
        object_storage_key=object_storage_key,
        content_type=file.content_type,
        size_bytes=file_size,
        metadata=parsed_metadata,
        uploaded_by_user_id=current_user.email,
        group_id=resolved_group_id,
    )
    db_data_instance = await crud.create_data_instance(db=db, data_instance=data_instance_create)
    
    # Invalidate project images cache
    cache = get_cache()
    cache.clear_pattern(f"project_images:{project_id}")
    
    # Use utility function for consistent metadata serialization
    return to_data_instance_schema(db_data_instance)

@router.get("/projects/{project_id}/images", response_model=List[schemas.DataInstance])
async def list_images_in_project(
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    search_field: Optional[str] = Query(None),
    search_value: Optional[str] = Query(None),
    group_id: Optional[uuid.UUID] = Query(None),
    ungrouped: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Retrieves a list of images for a given project.
    It first verifies project existence and user access, then uses a per-user
    cache for performance before falling back to the database.
    Optionally filter by group_id, or pass ungrouped=true to get images with no group.
    These two filters are mutually exclusive.
    """
    if group_id is not None and ungrouped:
        raise HTTPException(status_code=400, detail="group_id and ungrouped=true are mutually exclusive")
    if deleted_only and (group_id is not None or ungrouped):
        raise HTTPException(status_code=400, detail="group_id and ungrouped filters cannot be combined with deleted_only")

    # Check project access BEFORE cache lookup to prevent cross-user data leakage
    try:
        await get_project_or_403(project_id, db, current_user)
    except HTTPException as e:
        if e.status_code == status.HTTP_404_NOT_FOUND:
            # If project doesn't exist, return empty list instead of 404
            return []
        # Re-raise other exceptions (like permission issues)
        raise

    # Check cache (keyed per-user to prevent cross-user leakage)
    cache = get_cache()
    cache_key = f"project_images:{project_id}:user:{current_user.email}:skip:{skip}:limit:{limit}:include_deleted:{include_deleted}:deleted_only:{deleted_only}:search_field:{search_field}:search_value:{search_value}:group_id:{group_id}:ungrouped:{ungrouped}"
    cached_images = cache.get(cache_key)

    if cached_images is not None:
        return cached_images
        
    # Get images for the project
    if deleted_only:
        images = await crud.get_deleted_images_for_project(db=db, project_id=project_id, skip=skip, limit=limit)
    else:
        images = await crud.get_data_instances_for_project(
            db=db,
            project_id=project_id,
            skip=skip,
            limit=limit,
            search_field=search_field,
            search_value=search_value,
            group_id=group_id,
            ungrouped=ungrouped,
        )
    
    # Process images using utility function for consistent serialization
    response_images = []
    if images:
        for img in images:
            try:
                # Skip deleted images unless explicitly requested
                if img.deleted_at is not None and not include_deleted and not deleted_only:
                    continue
                response_images.append(to_data_instance_schema(img))
            except Exception as e:
                print(f"Error serializing image {img.id}: {e}")
                # Skip this image but continue processing others
                continue
    
    # Cache the result (30 minutes) - cache even if empty list
    cache.set(cache_key, response_images, expire=30*60)
    
    return response_images

# Add trailing slash version to handle frontend requests
@router.get("/projects/{project_id}/images/", response_model=List[schemas.DataInstance])
async def list_images_in_project_with_slash(
    project_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    search_field: Optional[str] = Query(None),
    search_value: Optional[str] = Query(None),
    group_id: Optional[uuid.UUID] = Query(None),
    ungrouped: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Provides an alternative endpoint for listing project images.
    This route handles requests with a trailing slash, redirecting to the main function.
    It ensures compatibility with various frontend routing configurations.
    """
    # Just call the main function to avoid code duplication
    return await list_images_in_project(project_id, skip, limit, include_deleted, deleted_only, search_field, search_value, group_id, ungrouped, db, current_user)


@router.get("/images/{image_id}", response_model=schemas.DataInstance)
async def get_image_metadata(
    image_id: uuid.UUID,
    include_deleted: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Fetches metadata for a specific image using its ID.
    It verifies image existence and user access before checking the per-user
    cache, then falls back to serialization from the database record.
    """
    # Check image existence and access BEFORE cache lookup to prevent
    # serving stale data after permission revocation
    db_image = await crud.get_data_instance(db=db, image_id=image_id)
    if db_image is None or (db_image.deleted_at and not include_deleted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    is_member = is_user_in_group(current_user.email, db_image.project.meta_group_id)
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to image '{image_id}'",
        )

    # Check cache (keyed per-user) for serialized response
    cache = get_cache()
    cache_key = f"image:{image_id}:user:{current_user.email}:metadata"
    cached_metadata = cache.get(cache_key)

    if cached_metadata is not None:
        return cached_metadata

    # Use utility function for consistent metadata serialization
    result = to_data_instance_schema(db_image)

    # Cache the result (1 hour)
    cache.set(cache_key, result, expire=60*60)

    return result

import httpx
from fastapi.responses import StreamingResponse

@router.get("/images/{image_id}/download", response_model=schemas.PresignedUrlResponse)
async def get_image_download_url(
    image_id: uuid.UUID,
    include_deleted: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Generates a presigned URL for downloading a specific image.
    It retrieves the image details and checks user permissions.
    The URL allows direct download from the object storage.
    """
    db_image = await crud.get_data_instance(db=db, image_id=image_id)
    if db_image is None or (db_image.deleted_at and not include_deleted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    is_member = is_user_in_group(current_user.email, db_image.project.meta_group_id)
    if not is_member:
         raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to image '{image_id}'",
        )
    
    # Get the presigned URL for internal use
    internal_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=db_image.object_storage_key
    )
    if not internal_url:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate download URL")
    
    # Create a proxy URL that goes through our API
    proxy_url = f"/images/{image_id}/content"
    
    return schemas.PresignedUrlResponse(url=proxy_url, object_key=db_image.object_storage_key)

# Content types that browsers can display natively
WEB_FRIENDLY_CONTENT_TYPES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'
}


def convert_to_web_format(image_data: bytes, content_type: str) -> tuple[bytes, str]:
    """
    Convert non-web-friendly image formats to PNG/JPEG while preserving dimensions.
    Returns (converted_data, new_content_type) or (original_data, original_content_type).
    """
    if content_type in WEB_FRIENDLY_CONTENT_TYPES:
        return image_data, content_type

    try:
        img = Image.open(io.BytesIO(image_data))

        # Determine output format based on image characteristics
        if img.mode in ('RGBA', 'LA', 'PA') or (img.mode == 'P' and 'transparency' in img.info):
            # Has transparency - use PNG
            if img.mode == 'P':
                img = img.convert('RGBA')
            elif img.mode in ('LA', 'PA'):
                img = img.convert('RGBA')
            output_format = 'PNG'
            output_content_type = 'image/png'
        else:
            # No transparency - use JPEG for efficiency
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            output_format = 'JPEG'
            output_content_type = 'image/jpeg'

        output_buffer = io.BytesIO()
        if output_format == 'JPEG':
            img.save(output_buffer, format=output_format, quality=95)
        else:
            img.save(output_buffer, format=output_format)
        output_buffer.seek(0)
        return output_buffer.getvalue(), output_content_type

    except Exception:
        # If conversion fails, return original data
        return image_data, content_type


@router.get("/images/{image_id}/content", response_class=StreamingResponse)
async def get_image_content(
    image_id: uuid.UUID,
    include_deleted: bool = Query(False),
    convert: bool = Query(True, description="Convert non-web formats (TIFF, BMP) to PNG/JPEG"),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Streams the content of an image from object storage.
    This endpoint acts as a proxy, ensuring proper access control.
    It returns the image data with appropriate headers for inline display.

    Non-web-friendly formats (TIFF, BMP, etc.) are automatically converted to
    PNG or JPEG to ensure browser compatibility while preserving original dimensions.
    Set convert=false to download the original file without conversion.
    """
    db_image = await crud.get_data_instance(db=db, image_id=image_id)
    if db_image is None or (db_image.deleted_at and not include_deleted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    # Check access permissions
    is_member = is_user_in_group(current_user.email, db_image.project.meta_group_id)
    if not is_member:
         raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to image '{image_id}'",
        )

    # Get the presigned URL for internal use
    internal_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=db_image.object_storage_key
    )
    if not internal_url:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate download URL")

    # Use httpx to fetch the image from s3
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(internal_url)
            response.raise_for_status()

            content_type = db_image.content_type or "application/octet-stream"

            # Check if conversion is needed and requested
            if convert and content_type not in WEB_FRIENDLY_CONTENT_TYPES:
                # Need to read full content for conversion
                image_data = await response.aread()
                converted_data, converted_type = convert_to_web_format(image_data, content_type)
                return StreamingResponse(
                    content=io.BytesIO(converted_data),
                    media_type=converted_type,
                    headers={
                        "Content-Disposition": get_content_disposition_header(db_image.filename, "inline")
                    }
                )

            # Return original content for web-friendly formats or when convert=false
            return StreamingResponse(
                content=response.iter_bytes(),
                media_type=content_type,
                headers={
                    "Content-Disposition": get_content_disposition_header(db_image.filename, "inline")
                }
            )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error fetching image from storage: {str(e)}"
            )
        except Exception as e:
            # Ensure any unexpected exception is returned as 500 per tests
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Unexpected error fetching image: {str(e)}"
            )

@router.get("/images/{image_id}/thumbnail", response_class=StreamingResponse)
async def get_image_thumbnail(
    image_id: uuid.UUID,
    width: int = Query(200, description="Thumbnail width in pixels"),
    height: int = Query(200, description="Thumbnail height in pixels"),
    include_deleted: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Generates and returns a thumbnail for a given image.
    It resizes the image to specified dimensions while maintaining aspect ratio.
    The thumbnail is cached for subsequent requests.
    """
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Width and height must be positive integers")
    
    # Check cache first
    cache = get_cache()
    cache_key = f"thumbnail:{image_id}:w:{width}:h:{height}"
    cached_thumbnail = cache.get(cache_key)
    
    if cached_thumbnail:
        thumbnail_data, content_type, filename = cached_thumbnail
        return StreamingResponse(
            content=io.BytesIO(thumbnail_data),
            media_type=content_type,
            headers={
                "Content-Disposition": get_content_disposition_header(filename, "inline")
            }
        )
    
    db_image = await crud.get_data_instance(db=db, image_id=image_id)
    if db_image is None or (db_image.deleted_at and not include_deleted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    
    # Check access permissions
    is_member = is_user_in_group(current_user.email, db_image.project.meta_group_id)
    if not is_member:
         raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{current_user.email}' does not have access to image '{image_id}'",
        )
    
    # Get the presigned URL for internal use
    internal_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=db_image.object_storage_key
    )
    if not internal_url:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate download URL")
    
    # Use httpx to fetch the image from Minio
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(internal_url)
            response.raise_for_status()
            
            # Get the image data
            image_data = await response.aread()
            
            # Use PIL to resize the image
            try:
                img = Image.open(io.BytesIO(image_data))

                # Resize the image while maintaining aspect ratio
                img.thumbnail((width, height))

                # Convert to web-friendly format for thumbnails
                # Handle TIFF, CMYK, 16-bit, and other non-web formats
                if img.mode in ('LA', 'PA'):
                    # Convert to RGBA to preserve transparency
                    img = img.convert('RGBA')
                    img_format = 'PNG'
                elif img.mode == 'RGBA':
                    # Already RGBA, just use PNG
                    img_format = 'PNG'
                elif img.mode == 'P':
                    # Palette mode may have transparency info
                    if 'transparency' in img.info:
                        img = img.convert('RGBA')
                        img_format = 'PNG'
                    else:
                        img = img.convert('RGB')
                        img_format = 'JPEG'
                elif img.mode not in ('RGB', 'L'):
                    # Convert CMYK, 16-bit, 1-bit, etc. to RGB for JPEG
                    img = img.convert('RGB')
                    img_format = 'JPEG'
                elif img.format in ('JPEG', 'PNG', 'GIF', 'WEBP'):
                    # Keep original web-friendly format
                    img_format = img.format
                else:
                    # Default non-web formats (TIFF, BMP, etc.) to JPEG
                    img_format = 'JPEG'

                # Save the resized image to a bytes buffer
                output_buffer = io.BytesIO()
                img.save(output_buffer, format=img_format)
                output_buffer.seek(0)

                # Determine the content type based on the image format
                content_type_map = {
                    'JPEG': 'image/jpeg',
                    'PNG': 'image/png',
                    'GIF': 'image/gif',
                    'WEBP': 'image/webp'
                }
                content_type = content_type_map.get(img_format, 'image/jpeg')
                
                # Cache the thumbnail (24 hours)
                thumbnail_filename = f"thumbnail_{db_image.filename}" if db_image.filename else "thumbnail"
                thumbnail_data = output_buffer.getvalue()
                cache.set(cache_key, (thumbnail_data, content_type, thumbnail_filename), expire=24*3600)
                
                # Return the thumbnail
                output_buffer.seek(0)
                return StreamingResponse(
                    content=output_buffer,
                    media_type=content_type,
                    headers={
                        "Content-Disposition": get_content_disposition_header(thumbnail_filename, "inline")
                    }
                )
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Error generating thumbnail: {str(e)}"
                )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error fetching image from storage: {str(e)}"
            )

class MetadataUpdate(BaseModel):
    key: str
    value: Any

class ImageDeleteRequest(BaseModel):
    reason: str
    force: Optional[bool] = False

@router.delete("/projects/{project_id}/images/{image_id}", response_model=schemas.DataInstance)
async def delete_image(
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    body: ImageDeleteRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    if len(body.reason or "") < settings.IMAGE_DELETE_REASON_MIN_CHARS:
        raise HTTPException(status_code=400, detail=f"Reason must be at least {settings.IMAGE_DELETE_REASON_MIN_CHARS} characters")
    db_image = await get_image_or_403_writable(image_id, db, current_user)
    if db_image.project_id != project_id:
        raise HTTPException(status_code=404, detail="Image not found")
    retention_days = settings.IMAGE_DELETE_RETENTION_DAYS
    actor_user_id = current_user.id
    if not db_image.deleted_at:
        prev_state = {"deleted_at": None}
        db_image = await crud.soft_delete_image(db, db_image, actor_user_id=actor_user_id, reason=body.reason, retention_days=retention_days)
        await crud.create_image_deletion_event(db, image=db_image, actor_user_id=actor_user_id, action="soft_delete", reason=body.reason, previous_state=prev_state)
    if body.force and not db_image.storage_deleted:
        # Future: verify current_user is project owner/admin; placeholder uses membership only.
        delete_file_from_s3(settings.S3_BUCKET, db_image.object_storage_key)
        await crud.mark_image_storage_deleted(db, db_image, actor_user_id=actor_user_id, hard=True)
        await crud.create_image_deletion_event(db, image=db_image, actor_user_id=actor_user_id, action="force_delete", reason=body.reason, previous_state={})
    await db.commit()
    await db.refresh(db_image)
    cache = get_cache()
    cache.clear_pattern(f"project_images:{project_id}")
    cache.clear_pattern(f"image:{image_id}:")
    cache.clear_pattern(f"thumbnail:{image_id}")
    return to_data_instance_schema(db_image)

@router.post("/projects/{project_id}/images/{image_id}/restore", response_model=schemas.DataInstance)
async def restore_deleted_image(
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    db_image = await get_image_or_403_writable(image_id, db, current_user)
    if db_image.project_id != project_id:
        raise HTTPException(status_code=404, detail="Image not found")
    if not db_image.deleted_at:
        return to_data_instance_schema(db_image)
    if db_image.storage_deleted:
        raise HTTPException(status_code=409, detail="Image permanently deleted")
    from datetime import datetime, timezone
    retention_deadline = db_image.pending_hard_delete_at
    if retention_deadline and datetime.now(timezone.utc) > retention_deadline:
        raise HTTPException(status_code=410, detail="Retention expired")
    await crud.restore_image(db, db_image)
    await crud.create_image_deletion_event(db, image=db_image, actor_user_id=current_user.id, action="restore", reason=None, previous_state={})
    await db.commit()
    await db.refresh(db_image)
    cache = get_cache()
    cache.clear_pattern(f"project_images:{project_id}")
    cache.clear_pattern(f"image:{image_id}:")
    cache.clear_pattern(f"thumbnail:{image_id}")
    return to_data_instance_schema(db_image)

@router.get("/projects/{project_id}/images/deletion-events", response_model=schemas.ImageDeletionEventList)
async def list_image_deletion_events(
    project_id: uuid.UUID,
    image_id: Optional[uuid.UUID] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    events = await crud.list_image_deletion_events(db, project_id, image_id=image_id, skip=skip, limit=limit)
    total = await crud.count_image_deletion_events(db, project_id, image_id=image_id)
    return schemas.ImageDeletionEventList(events=events, total=total)

@router.put("/images/{image_id}/metadata", response_model=schemas.DataInstance, status_code=status.HTTP_200_OK)
async def update_image_metadata(
    image_id: uuid.UUID,
    metadata: MetadataUpdate = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Updates the metadata for a specific image.
    It allows adding or modifying a key-value pair in the image's metadata.
    The changes are persisted to the database and caches are invalidated.
    """
    db_image = await get_image_or_403_writable(image_id, db, current_user)

    # Update the metadata
    current_metadata = db_image.metadata_json or {}
    current_metadata[metadata.key] = metadata.value
    
    # Update the database
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image_id)
        .values(metadata_json=current_metadata)
    )
    await db.commit()
    
    # Invalidate caches
    cache = get_cache()
    cache.clear_pattern(f"image:{image_id}:")
    cache.clear_pattern(f"project_images:{db_image.project_id}")
    cache.clear_pattern(f"thumbnail:{image_id}")
    
    # Return the updated image; build response dict ensuring updated metadata is present
    await db.refresh(db_image)
    try:
        return schemas.DataInstance(
            id=db_image.id,
            project_id=db_image.project_id,
            filename=db_image.filename,
            object_storage_key=db_image.object_storage_key,
            content_type=db_image.content_type,
            size_bytes=db_image.size_bytes,
            metadata_=current_metadata or {},
            uploaded_by_user_id=db_image.uploaded_by_user_id,
            uploader_id=db_image.uploader_id,
            created_at=db_image.created_at,
            updated_at=db_image.updated_at,
        )
    except Exception as e:
        print(f"Error building DataInstance response: {e}")
        raise

@router.delete("/images/{image_id}/metadata/{key}", response_model=schemas.DataInstance, status_code=status.HTTP_200_OK)
async def delete_image_metadata(
    image_id: uuid.UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Deletes a specific metadata key-value pair from an image.
    It first retrieves the image, checks permissions, and then removes the metadata.
    The database is updated, and relevant caches are cleared.
    """
    db_image = await get_image_or_403_writable(image_id, db, current_user)

    # Update the metadata
    current_metadata = db_image.metadata_json or {}
    if key in current_metadata:
        del current_metadata[key]
    
    # Update the database
    await db.execute(
        update(models.DataInstance)
        .where(models.DataInstance.id == image_id)
        .values(metadata_json=current_metadata)
    )
    await db.commit()
    
    # Invalidate caches
    cache = get_cache()
    cache.clear_pattern(f"image:{image_id}:")
    cache.clear_pattern(f"project_images:{db_image.project_id}")
    cache.clear_pattern(f"thumbnail:{image_id}")
    
    # Return the updated image; build response dict ensuring updated metadata is present
    await db.refresh(db_image)
    try:
        return schemas.DataInstance(
            id=db_image.id,
            project_id=db_image.project_id,
            filename=db_image.filename,
            object_storage_key=db_image.object_storage_key,
            content_type=db_image.content_type,
            size_bytes=db_image.size_bytes,
            metadata_=current_metadata or {},
            uploaded_by_user_id=db_image.uploaded_by_user_id,
            uploader_id=db_image.uploader_id,
            created_at=db_image.created_at,
            updated_at=db_image.updated_at,
        )
    except Exception as e:
        print(f"Error building DataInstance response: {e}")
        raise
