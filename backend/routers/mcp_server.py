"""
MCP (Model Context Protocol) Server for VISTA.

Exposes VISTA core functions as MCP tools for AI assistants (e.g., atlas-ui-3).
Authentication uses a shared secret key with trusted username field.
"""

import uuid
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession

from core import schemas, models
from core.database import get_db
from core.config import settings
from core.group_auth_helper import is_user_in_group
import utils.crud as crud
from utils.boto3_client import get_presigned_download_url
from utils.serialization import to_data_instance_schema

logger = logging.getLogger(__name__)


# Helper function to verify MCP secret key
async def verify_mcp_auth(
    x_mcp_secret: str = Header(None, alias="X-MCP-Secret"),
    x_username: str = Header(None, alias="X-Username"),
) -> str:
    """
    Verify MCP authentication via secret key.
    Returns the trusted username.
    """
    if not settings.MCP_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MCP server is not enabled"
        )
    
    expected_secret = settings.MCP_SECRET_KEY
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MCP secret key not configured"
        )
    
    if not x_mcp_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-MCP-Secret header"
        )
    
    # Handle case sensitivity and allow None comparison
    if str(x_mcp_secret) != str(expected_secret):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid MCP secret key"
        )
    
    if not x_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Username header (trusted username field)"
        )
    
    return x_username


# FastAPI Router for MCP endpoint
router = APIRouter(
    prefix="/mcp",
    tags=["MCP"],
)


# MCP Tool Functions (called by invoke endpoint)

async def mcp_get_projects(
    username: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = None,
) -> Dict[str, Any]:
    """
    Get all projects that the user has access to.
    
    Args:
        username: Username of the user (from trusted X-Username header)
        skip: Number of projects to skip for pagination (default: 0)
        limit: Maximum number of projects to return (default: 100, max: 100)
        db: Database session
    
    Returns:
        Dictionary with projects list and pagination info
    """
    # Validate pagination params
    if limit > 100:
        limit = 100
    if skip < 0:
        skip = 0
    
    # Create a user object for group checking
    user = schemas.User(
        email=username,
        username=username,
        is_active=True,
        groups=settings.MOCK_USER_GROUPS if settings.CHECK_MOCK_MEMBERSHIP else []
    )
    
    # Get all projects
    all_projects = await crud.get_all_projects(db=db, skip=0, limit=1000)
    
    # Filter projects by user's group membership
    accessible_projects = []
    for project in all_projects:
        if is_user_in_group(user.email, project.meta_group_id):
            accessible_projects.append({
                "id": str(project.id),
                "name": project.name,
                "description": project.description,
                "meta_group_id": project.meta_group_id,
                "created_at": project.created_at.isoformat() if project.created_at else None,
                "updated_at": project.updated_at.isoformat() if project.updated_at else None,
            })
    
    # Apply pagination
    paginated_projects = accessible_projects[skip:skip + limit]
    
    return {
        "projects": paginated_projects,
        "total": len(accessible_projects),
        "skip": skip,
        "limit": limit,
        "has_more": (skip + limit) < len(accessible_projects)
    }


async def mcp_get_images(
    username: str,
    project_id: str,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
    db: AsyncSession = None,
) -> Dict[str, Any]:
    """
    Get images in a specific project.
    
    Args:
        username: Username of the user (from trusted X-Username header)
        project_id: UUID of the project
        skip: Number of images to skip for pagination (default: 0)
        limit: Maximum number of images to return (default: 100, max: 100)
        include_deleted: Whether to include soft-deleted images (default: False)
        db: Database session
    
    Returns:
        Dictionary with images list and pagination info
    """
    # Validate pagination params
    if limit > 100:
        limit = 100
    if skip < 0:
        skip = 0
    
    try:
        proj_uuid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid project_id format: {project_id}"
        )
    
    # Get project and verify access
    db_project = await crud.get_project(db=db, project_id=proj_uuid)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    # Check user's group membership
    if not is_user_in_group(username, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{username}' does not have access to project '{project_id}'"
        )
    
    # Get images
    images_list = await crud.list_data_instances(
        db=db,
        project_id=proj_uuid,
        skip=skip,
        limit=limit,
        include_deleted=include_deleted,
        deleted_only=False
    )
    
    # Convert to dict format
    images_data = []
    for img in images_list:
        img_dict = {
            "id": str(img.id),
            "filename": img.filename,
            "content_type": img.content_type,
            "size_bytes": img.size_bytes,
            "object_storage_key": img.object_storage_key,
            "uploaded_by_user_id": img.uploaded_by_user_id,
            "created_at": img.created_at.isoformat() if img.created_at else None,
            "updated_at": img.updated_at.isoformat() if img.updated_at else None,
        }
        
        # Add deletion info if applicable
        if img.deleted_at:
            img_dict["deleted_at"] = img.deleted_at.isoformat()
            img_dict["deletion_reason"] = img.deletion_reason
        
        # Add metadata if present
        if hasattr(img, 'metadata_') and img.metadata_:
            img_dict["metadata"] = img.metadata_
        
        images_data.append(img_dict)
    
    return {
        "project_id": project_id,
        "images": images_data,
        "count": len(images_data),
        "skip": skip,
        "limit": limit,
    }


async def mcp_get_image_info(
    username: str,
    image_id: str,
    db: AsyncSession = None,
) -> Dict[str, Any]:
    """
    Get detailed information about a specific image.
    
    Args:
        username: Username of the user (from trusted X-Username header)
        image_id: UUID of the image
        db: Database session
    
    Returns:
        Dictionary with detailed image information
    """
    try:
        img_uuid = uuid.UUID(image_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image_id format: {image_id}"
        )
    
    # Get image
    db_image = await crud.get_data_instance(db=db, image_id=img_uuid)
    if db_image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found"
        )
    
    # Get project to verify access
    db_project = await crud.get_project(db=db, project_id=db_image.project_id)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    # Check user's group membership
    if not is_user_in_group(username, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{username}' does not have access to this image"
        )
    
    # Build response
    image_info = {
        "id": str(db_image.id),
        "filename": db_image.filename,
        "content_type": db_image.content_type,
        "size_bytes": db_image.size_bytes,
        "object_storage_key": db_image.object_storage_key,
        "project_id": str(db_image.project_id),
        "project_name": db_project.name,
        "uploaded_by_user_id": db_image.uploaded_by_user_id,
        "created_at": db_image.created_at.isoformat() if db_image.created_at else None,
        "updated_at": db_image.updated_at.isoformat() if db_image.updated_at else None,
    }
    
    # Add deletion info if applicable
    if db_image.deleted_at:
        image_info["deleted_at"] = db_image.deleted_at.isoformat()
        image_info["deletion_reason"] = db_image.deletion_reason
        image_info["pending_hard_delete_at"] = db_image.pending_hard_delete_at.isoformat() if db_image.pending_hard_delete_at else None
    
    # Add metadata if present
    if hasattr(db_image, 'metadata_') and db_image.metadata_:
        image_info["metadata"] = db_image.metadata_
    
    return image_info


async def mcp_get_image_url(
    username: str,
    image_id: str,
    expiry_seconds: int = 3600,
    db: AsyncSession = None,
) -> Dict[str, Any]:
    """
    Get a presigned URL to download/view an image.
    
    Args:
        username: Username of the user (from trusted X-Username header)
        image_id: UUID of the image
        expiry_seconds: URL expiry time in seconds (default: 3600 = 1 hour)
        db: Database session
    
    Returns:
        Dictionary with presigned URL and image metadata
    """
    try:
        img_uuid = uuid.UUID(image_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image_id format: {image_id}"
        )
    
    # Validate expiry
    if expiry_seconds < 60:
        expiry_seconds = 60
    if expiry_seconds > 86400:  # Max 24 hours
        expiry_seconds = 86400
    
    # Get image
    db_image = await crud.get_data_instance(db=db, image_id=img_uuid)
    if db_image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found"
        )
    
    # Get project to verify access
    db_project = await crud.get_project(db=db, project_id=db_image.project_id)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    # Check user's group membership
    if not is_user_in_group(username, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User '{username}' does not have access to this image"
        )
    
    # Generate presigned URL
    presigned_url = get_presigned_download_url(
        bucket_name=settings.S3_BUCKET,
        object_name=db_image.object_storage_key,
        expiration=expiry_seconds
    )
    
    if not presigned_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate presigned URL"
        )
    
    return {
        "image_id": image_id,
        "filename": db_image.filename,
        "content_type": db_image.content_type,
        "presigned_url": presigned_url,
        "expires_in_seconds": expiry_seconds,
    }


# Tool registry mapping tool names to functions
MCP_TOOLS = {
    "get_projects": {
        "function": mcp_get_projects,
        "description": "Get all projects that the user has access to with pagination support"
    },
    "get_images": {
        "function": mcp_get_images,
        "description": "Get images in a specific project with pagination support"
    },
    "get_image_info": {
        "function": mcp_get_image_info,
        "description": "Get detailed information about a specific image"
    },
    "get_image_url": {
        "function": mcp_get_image_url,
        "description": "Get a presigned URL to download/view an image"
    },
}


# FastAPI endpoints


@router.post("/tools/invoke")
async def invoke_mcp_tool(
    request: Request,
    username: str = Depends(verify_mcp_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Invoke an MCP tool with authentication.
    
    This endpoint receives MCP tool invocation requests from atlas-ui-3
    and routes them to the appropriate MCP tool handler.
    """
    body = await request.json()
    
    tool_name = body.get("tool")
    arguments = body.get("arguments", {})
    
    if not tool_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing 'tool' field in request"
        )
    
    # Check if tool exists
    if tool_name not in MCP_TOOLS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tool '{tool_name}' not found. Available tools: {list(MCP_TOOLS.keys())}"
        )
    
    # Add username and db to arguments
    arguments["username"] = username
    arguments["db"] = db
    
    try:
        # Call the tool function
        tool_func = MCP_TOOLS[tool_name]["function"]
        result = await tool_func(**arguments)
        
        return {
            "success": True,
            "tool": tool_name,
            "result": result,
        }
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error invoking MCP tool '{tool_name}': {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error invoking tool: {str(e)}"
        )


@router.get("/tools")
async def list_mcp_tools(
    username: str = Depends(verify_mcp_auth),
):
    """
    List all available MCP tools.
    """
    tools_info = []
    for tool_name, tool_config in MCP_TOOLS.items():
        tools_info.append({
            "name": tool_name,
            "description": tool_config["description"],
        })
    
    return {
        "tools": tools_info
    }


@router.get("/health")
async def mcp_health():
    """
    Health check for MCP server.
    """
    return {
        "status": "healthy",
        "mcp_enabled": settings.MCP_ENABLED,
        "service": "VISTA MCP Server"
    }
