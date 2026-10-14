import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from repositories import project_metadata as metadata_repository
from schemas import project_metadata as project_metadata_schemas
from schemas import users as user_schemas
from utils.dependencies import (
    get_current_user,
    get_project_or_403,
    get_project_or_403_writable,
)

router = APIRouter(
    tags=["Project Metadata"],
)


@router.post(
    "/projects/{project_id}/metadata",
    response_model=project_metadata_schemas.ProjectMetadata,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_metadata(
    project_id: uuid.UUID,
    metadata: project_metadata_schemas.ProjectMetadataBase,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(project_id, db, current_user)

    # Create the metadata create object
    metadata_create = project_metadata_schemas.ProjectMetadataCreate(
        project_id=project_id,
        key=metadata.key,
        value=metadata.value,
    )

    # Create or update the metadata
    return await metadata_repository.create_or_update_project_metadata(
        db=db, metadata=metadata_create
    )


@router.get(
    "/projects/{project_id}/metadata",
    response_model=list[project_metadata_schemas.ProjectMetadata],
)
async def list_project_metadata(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project
    await get_project_or_403(project_id, db, current_user)

    # Get all metadata for the project
    return await metadata_repository.get_all_project_metadata(
        db=db, project_id=project_id
    )


@router.get(
    "/projects/{project_id}/metadata/{key}",
    response_model=project_metadata_schemas.ProjectMetadata,
)
async def get_project_metadata(
    project_id: uuid.UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project
    await get_project_or_403(project_id, db, current_user)

    # Get the metadata
    db_metadata = await metadata_repository.get_project_metadata_by_key(
        db=db, project_id=project_id, key=key
    )
    if db_metadata is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Metadata with key '{key}' not found",
        )

    return db_metadata


@router.put(
    "/projects/{project_id}/metadata/{key}",
    response_model=project_metadata_schemas.ProjectMetadata,
)
async def update_project_metadata(
    project_id: uuid.UUID,
    key: str,
    metadata: project_metadata_schemas.ProjectMetadataBase,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(project_id, db, current_user)

    # Ensure the key in the path matches the one in the request body
    if key != metadata.key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Key in the path must match the key in the request body",
        )

    # Create the metadata create object
    metadata_create = project_metadata_schemas.ProjectMetadataCreate(
        project_id=project_id,
        key=metadata.key,
        value=metadata.value,
    )

    # Create or update the metadata
    return await metadata_repository.create_or_update_project_metadata(
        db=db, metadata=metadata_create
    )


@router.delete(
    "/projects/{project_id}/metadata/{key}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_project_metadata(
    project_id: uuid.UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(project_id, db, current_user)

    # Delete the metadata
    success = await metadata_repository.delete_project_metadata_by_key(
        db=db, project_id=project_id, key=key
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Metadata with key '{key}' not found",
        )

    return None


@router.get("/projects/{project_id}/metadata-dict", response_model=dict[str, Any])
async def get_project_metadata_as_dict(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """
    Get all project metadata as a dictionary where keys are the metadata keys and values are the metadata values.
    This is a convenience endpoint for clients that want to work with metadata as a simple key-value dictionary.
    """
    # Check if the user has access to the project
    await get_project_or_403(project_id, db, current_user)

    # Get all metadata for the project
    metadata_list = await metadata_repository.get_all_project_metadata(
        db=db, project_id=project_id
    )

    # Convert to dictionary
    metadata_dict = {item.key: item.value for item in metadata_list}

    return metadata_dict


@router.put("/projects/{project_id}/metadata-dict", response_model=dict[str, Any])
async def update_project_metadata_dict(
    project_id: uuid.UUID,
    metadata_dict: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_user: user_schemas.User = Depends(get_current_user),
):
    """
    Update project metadata using a dictionary. This will create or update metadata entries for each key-value pair in the dictionary.
    This is a convenience endpoint for clients that want to work with metadata as a simple key-value dictionary.
    """
    # Check if the user has access to the project (and that it's not archived)
    await get_project_or_403_writable(project_id, db, current_user)

    # Create or update each metadata entry
    for key, value in metadata_dict.items():
        metadata_create = project_metadata_schemas.ProjectMetadataCreate(
            project_id=project_id,
            key=key,
            value=value,
        )
        await metadata_repository.create_or_update_project_metadata(
            db=db, metadata=metadata_create
        )

    # Get the updated metadata dictionary
    return await get_project_metadata_as_dict(
        project_id=project_id, db=db, current_user=current_user
    )
