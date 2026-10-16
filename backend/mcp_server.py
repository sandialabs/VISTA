#!/usr/bin/env python3
"""VISTA MCP Server

This MCP (Model Context Protocol) server exposes VISTA backend functionality
to external clients like Atlas-UI-3. It provides tools for managing projects,
images, classifications, and metadata.

The server runs as an HTTP service with API key authentication.
"""

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.auth import StaticTokenVerifier
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from core.database import AsyncSessionLocal
from core.group_auth_helper import is_user_in_group
from repositories import comments as comment_repository
from repositories import image_classes as image_class_repository
from repositories import images as image_repository
from repositories import project_metadata as project_metadata_repository
from repositories import projects as project_repository
from repositories import users as user_repository
from schemas import comments as comment_schemas
from schemas import image_classes as image_class_schemas
from schemas import project_metadata as project_metadata_schemas
from schemas import projects as project_schemas
from schemas import users as user_schemas
from utils.boto3_client import get_presigned_download_url
from utils.dependencies import get_accessible_projects_for_user

# Type aliases for clarity
ProjectUUID = str  # String representation of a project UUID

DEFAULT_MCP_API_KEY = "vista-default-key-change-me"


def _load_mcp_api_key() -> str:
    """Load and validate the MCP bearer token before starting the server."""
    api_key = settings.VISTA_MCP_API_KEY
    if not api_key or api_key == DEFAULT_MCP_API_KEY:
        raise RuntimeError(
            "VISTA_MCP_API_KEY must be set to a non-default value before "
            "starting the MCP server"
        )
    return api_key


logger = logging.getLogger(__name__)
VISTA_MCP_API_KEY = _load_mcp_api_key()

# Configure API key authentication
auth_provider = StaticTokenVerifier(
    tokens={
        VISTA_MCP_API_KEY: {
            "client_id": "vista-mcp-client",
            "scopes": ["vista:read", "vista:write"],
        }
    }
)

# Initialize MCP server with HTTP and authentication
mcp = FastMCP("VISTA", auth=auth_provider)


# Database session helper
@asynccontextmanager
async def get_session():
    """Get async database session with proper cleanup."""
    async with AsyncSessionLocal() as session:
        yield session


async def get_or_create_user(db: AsyncSession, username: str) -> models.User:
    """Get or create a user by username/email.
    Atlas provides the username, which we trust.
    """
    # Treat username as email if it contains @, otherwise use as-is
    email = username if "@" in username else f"{username}@local"

    user = await user_repository.get_user_by_email(db, email)
    if not user:
        user_create = user_schemas.UserCreate(
            email=email, username=username, is_active=True
        )
        user = await user_repository.create_user(
            db, user_create, created_by="mcp_server"
        )

    return user


@mcp.tool()
async def get_projects(
    username: str, skip: int = 0, limit: int = 100
) -> list[dict[str, Any]]:
    """Get all projects accessible to the user.

    Args:
        username: The username/email of the user (trusted from Atlas)
        skip: Number of projects to skip (for pagination)
        limit: Maximum number of projects to return

    Returns:
        List of projects with their details
    """
    # Validate pagination parameters
    if skip < 0:
        return [{"error": "skip must be >= 0"}]
    if limit < 1 or limit > 1000:
        return [{"error": "limit must be between 1 and 1000"}]

    async with get_session() as db:
        user = await get_or_create_user(db, username)

        # Convert user model to schema for dependencies
        user_schema = user_schemas.User.model_validate(user)

        projects = await get_accessible_projects_for_user(db, user_schema, skip, limit)

        return [
            {
                "project_id": str(p.id),
                "name": p.name,
                "description": p.description,
                "meta_group_id": p.meta_group_id,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in projects
        ]


@mcp.tool()
async def get_project(username: str, project_id: ProjectUUID) -> dict[str, Any]:
    """Get details of a specific project.

    Args:
        username: The username/email of the user (trusted from Atlas)
        project_id: UUID string identifying the project (not the project name)

    Returns:
        Project details
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            pid = uuid.UUID(project_id)
        except ValueError:
            return {"error": "Invalid project_id format"}

        project = await project_repository.get_project(db, pid)
        if not project:
            return {"error": "Project not found"}

        # Check user has access
        if not is_user_in_group(user.email, project.meta_group_id):
            return {"error": "Access denied to this project"}

        return {
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "meta_group_id": project.meta_group_id,
            "created_at": project.created_at.isoformat()
            if project.created_at
            else None,
            "updated_at": project.updated_at.isoformat()
            if project.updated_at
            else None,
        }


@mcp.tool()
async def get_images(
    username: str,
    project_id: ProjectUUID,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
) -> list[dict[str, Any]]:
    """Get images in a project.

    Args:
        username: The username/email of the user (trusted from Atlas)
        project_id: UUID string identifying the project (not the project name)
        skip: Number of images to skip (for pagination)
        limit: Maximum number of images to return
        include_deleted: Whether to include soft-deleted images

    Returns:
        List of images with their details
    """
    # Validate pagination parameters
    if skip < 0:
        return [{"error": "skip must be >= 0"}]
    if limit < 1 or limit > 1000:
        return [{"error": "limit must be between 1 and 1000"}]

    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            pid = uuid.UUID(project_id)
        except ValueError:
            return [{"error": "Invalid project_id format"}]

        project = await project_repository.get_project(db, pid)
        if not project:
            return [{"error": "Project not found"}]

        # Check user has access
        if not is_user_in_group(user.email, project.meta_group_id):
            return [{"error": "Access denied to this project"}]

        # Get images with proper pagination handling for deleted vs non-deleted
        if include_deleted:
            # For include_deleted, we need both active and deleted images
            # Use a database query that combines both with proper pagination
            from sqlalchemy import select

            query = (
                select(models.DataInstance)
                .where(models.DataInstance.project_id == pid)
                .order_by(models.DataInstance.created_at.desc())
            )

            query = query.offset(skip).limit(limit)
            result = await db.execute(query)
            images = result.scalars().all()
        else:
            images = await image_repository.get_data_instances_for_project(
                db, pid, skip, limit
            )

        return [
            {
                "id": str(img.id),
                "project_id": str(img.project_id),
                "filename": img.filename,
                "content_type": img.content_type,
                "size_bytes": img.size_bytes,
                "metadata": img.metadata_json if hasattr(img, "metadata_json") else {},
                "uploaded_by": img.uploaded_by_user_id,
                "created_at": img.created_at.isoformat() if img.created_at else None,
                "deleted_at": img.deleted_at.isoformat() if img.deleted_at else None,
            }
            for img in images
        ]


@mcp.tool()
async def get_image_info(username: str, image_id: str) -> dict[str, Any]:
    """Get detailed information about a specific image.

    Args:
        username: The username/email of the user (trusted from Atlas)
        image_id: UUID of the image

    Returns:
        Image details including metadata and download URL
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            iid = uuid.UUID(image_id)
        except ValueError:
            return {"error": "Invalid image_id format"}

        image = await image_repository.get_data_instance(db, iid)
        if not image:
            return {"error": "Image not found"}

        # Get project and check access
        project = await project_repository.get_project(db, image.project_id)
        if not project:
            return {"error": "Project not found"}

        if not is_user_in_group(user.email, project.meta_group_id):
            return {"error": "Access denied to this image"}

        # Get presigned download URL
        download_url = None
        try:
            download_url = get_presigned_download_url(
                settings.S3_BUCKET, image.object_storage_key, image.filename
            )
        except Exception as e:
            download_url = f"Error generating URL: {str(e)}"

        return {
            "id": str(image.id),
            "project_id": str(image.project_id),
            "filename": image.filename,
            "content_type": image.content_type,
            "size_bytes": image.size_bytes,
            "metadata": image.metadata_json if hasattr(image, "metadata_json") else {},
            "uploaded_by": image.uploaded_by_user_id,
            "created_at": image.created_at.isoformat() if image.created_at else None,
            "download_url": download_url,
            "deleted_at": image.deleted_at.isoformat() if image.deleted_at else None,
        }


@mcp.tool()
async def add_image_metadata(
    username: str, image_id: str, key: str, value: Any
) -> dict[str, Any]:
    """Add or update a metadata field on an image.

    Args:
        username: The username/email of the user (trusted from Atlas)
        image_id: UUID of the image
        key: Metadata key to add/update
        value: Metadata value

    Returns:
        Success status and updated metadata
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            iid = uuid.UUID(image_id)
        except ValueError:
            return {"error": "Invalid image_id format"}

        image = await image_repository.get_data_instance(db, iid)
        if not image:
            return {"error": "Image not found"}

        # Get project and check access
        project = await project_repository.get_project(db, image.project_id)
        if not project:
            return {"error": "Project not found"}

        if not is_user_in_group(user.email, project.meta_group_id):
            return {"error": "Access denied to this image"}

        # Update metadata directly using SQLAlchemy
        from sqlalchemy import update

        current_metadata = image.metadata_json or {}
        current_metadata[key] = value

        await db.execute(
            update(models.DataInstance)
            .where(models.DataInstance.id == iid)
            .values(metadata_json=current_metadata)
        )
        await db.commit()

        return {"success": True, "image_id": str(iid), "metadata": current_metadata}


@mcp.tool()
async def get_image_classes(
    username: str, project_id: ProjectUUID
) -> list[dict[str, Any]]:
    """Get all classification labels (classes) for a project.

    Args:
        username: The username/email of the user (trusted from Atlas)
        project_id: UUID string identifying the project (not the project name)

    Returns:
        List of image classes
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            pid = uuid.UUID(project_id)
        except ValueError:
            return [{"error": "Invalid project_id format"}]

        project = await project_repository.get_project(db, pid)
        if not project:
            return [{"error": "Project not found"}]

        if not is_user_in_group(user.email, project.meta_group_id):
            return [{"error": "Access denied to this project"}]

        classes = await image_class_repository.get_image_classes_for_project(db, pid)

        return [
            {
                "id": str(c.id),
                "project_id": str(c.project_id),
                "name": c.name,
                "description": c.description,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in classes
        ]


@mcp.tool()
async def add_image_classification(
    username: str, image_id: str, class_id: str
) -> dict[str, Any]:
    """Add a classification to an image.

    Args:
        username: The username/email of the user (trusted from Atlas)
        image_id: UUID of the image
        class_id: UUID of the image class

    Returns:
        Success status and classification details
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            iid = uuid.UUID(image_id)
            cid = uuid.UUID(class_id)
        except ValueError:
            return {"error": "Invalid UUID format"}

        image = await image_repository.get_data_instance(db, iid)
        if not image:
            return {"error": "Image not found"}

        # Get project and check access
        project = await project_repository.get_project(db, image.project_id)
        if not project:
            return {"error": "Project not found"}

        if not is_user_in_group(user.email, project.meta_group_id):
            return {"error": "Access denied"}

        # Create classification
        classification_create = image_class_schemas.ImageClassificationCreate(
            image_id=iid, class_id=cid, created_by_id=user.id
        )

        classification = await image_class_repository.create_image_classification(
            db, classification_create, user.email
        )

        return {
            "success": True,
            "id": str(classification.id),
            "image_id": str(classification.image_id),
            "class_id": str(classification.class_id),
            "created_at": classification.created_at.isoformat()
            if classification.created_at
            else None,
        }


@mcp.tool()
async def get_image_comments(username: str, image_id: str) -> list[dict[str, Any]]:
    """Get comments on an image.

    Args:
        username: The username/email of the user (trusted from Atlas)
        image_id: UUID of the image

    Returns:
        List of comments
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            iid = uuid.UUID(image_id)
        except ValueError:
            return [{"error": "Invalid image_id format"}]

        image = await image_repository.get_data_instance(db, iid)
        if not image:
            return [{"error": "Image not found"}]

        # Get project and check access
        project = await project_repository.get_project(db, image.project_id)
        if not project:
            return [{"error": "Project not found"}]

        if not is_user_in_group(user.email, project.meta_group_id):
            return [{"error": "Access denied"}]

        comments = await comment_repository.get_comments_for_image(db, iid)

        return [
            {
                "id": str(c.id),
                "image_id": str(c.image_id),
                "text": c.text,
                "author_id": str(c.author_id),
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ]


@mcp.tool()
async def add_image_comment(username: str, image_id: str, text: str) -> dict[str, Any]:
    """Add a comment to an image.

    Args:
        username: The username/email of the user (trusted from Atlas)
        image_id: UUID of the image
        text: Comment text

    Returns:
        Success status and comment details
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            iid = uuid.UUID(image_id)
        except ValueError:
            return {"error": "Invalid image_id format"}

        image = await image_repository.get_data_instance(db, iid)
        if not image:
            return {"error": "Image not found"}

        # Get project and check access
        project = await project_repository.get_project(db, image.project_id)
        if not project:
            return {"error": "Project not found"}

        if not is_user_in_group(user.email, project.meta_group_id):
            return {"error": "Access denied"}

        # Create comment
        comment_create = comment_schemas.ImageCommentCreate(
            image_id=iid, text=text, author_id=user.id
        )

        comment = await comment_repository.create_comment(
            db, comment_create, user.email
        )

        return {
            "success": True,
            "id": str(comment.id),
            "image_id": str(comment.image_id),
            "text": comment.text,
            "author_id": str(comment.author_id),
            "created_at": comment.created_at.isoformat()
            if comment.created_at
            else None,
        }


@mcp.tool()
async def create_project(
    username: str, name: str, meta_group_id: str, description: str | None = None
) -> dict[str, Any]:
    """Create a new project.

    Args:
        username: The username/email of the user (trusted from Atlas)
        name: Project name
        meta_group_id: Group ID for access control
        description: Optional project description

    Returns:
        Created project details
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        # Check if user has access to the group
        if not is_user_in_group(user.email, meta_group_id):
            return {"error": f"User does not have access to group '{meta_group_id}'"}

        project_create = project_schemas.ProjectCreate(
            name=name, description=description, meta_group_id=meta_group_id
        )

        project = await project_repository.create_project(
            db, project_create, created_by=user.email
        )

        return {
            "success": True,
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "meta_group_id": project.meta_group_id,
            "created_at": project.created_at.isoformat()
            if project.created_at
            else None,
        }


@mcp.tool()
async def get_project_metadata(
    username: str, project_id: ProjectUUID
) -> list[dict[str, Any]]:
    """Get all metadata key-value pairs for a project.

    Args:
        username: The username/email of the user (trusted from Atlas)
        project_id: UUID string identifying the project (not the project name)

    Returns:
        List of metadata entries
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            pid = uuid.UUID(project_id)
        except ValueError:
            return [{"error": "Invalid project_id format"}]

        project = await project_repository.get_project(db, pid)
        if not project:
            return [{"error": "Project not found"}]

        if not is_user_in_group(user.email, project.meta_group_id):
            return [{"error": "Access denied"}]

        # Get all project metadata entries
        from sqlalchemy import select

        result = await db.execute(
            select(models.ProjectMetadata).where(
                models.ProjectMetadata.project_id == pid
            )
        )
        metadata_list = result.scalars().all()

        return [
            {
                "id": str(m.id),
                "project_id": str(m.project_id),
                "key": m.key,
                "value": m.value,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in metadata_list
        ]


@mcp.tool()
async def add_project_metadata(
    username: str, project_id: ProjectUUID, key: str, value: str
) -> dict[str, Any]:
    """Add or update a metadata key-value pair for a project.

    Args:
        username: The username/email of the user (trusted from Atlas)
        project_id: UUID string identifying the project (not the project name)
        key: Metadata key
        value: Metadata value

    Returns:
        Success status and metadata details
    """
    async with get_session() as db:
        user = await get_or_create_user(db, username)

        try:
            pid = uuid.UUID(project_id)
        except ValueError:
            return {"error": "Invalid project_id format"}

        project = await project_repository.get_project(db, pid)
        if not project:
            return {"error": "Project not found"}

        if not is_user_in_group(user.email, project.meta_group_id):
            return {"error": "Access denied"}

        metadata_create = project_metadata_schemas.ProjectMetadataCreate(
            project_id=pid, key=key, value=value
        )

        metadata = await project_metadata_repository.create_or_update_project_metadata(
            db, metadata_create, created_by=user.email
        )

        return {
            "success": True,
            "id": str(metadata.id),
            "project_id": str(metadata.project_id),
            "key": metadata.key,
            "value": metadata.value,
            "created_at": metadata.created_at.isoformat()
            if metadata.created_at
            else None,
        }


if __name__ == "__main__":
    # Run the MCP server over HTTP
    host = settings.MCP_HOST
    port = settings.MCP_PORT

    logger.info("Starting VISTA MCP Server on http://%s:%s/mcp", host, port)
    logger.info("API key authentication is required")
    logger.info("Use 'Authorization: Bearer <VISTA_MCP_API_KEY>' header")

    # Run MCP server with HTTP transport on /mcp endpoint
    mcp.run(transport="http", host=host, port=port, path="/mcp")
