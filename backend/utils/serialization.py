"""
Serialization utilities for converting database models to API schemas.
Centralizes metadata serialization logic to avoid repetition.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from core import models
from schemas import images as image_schemas


def _normalize_utc_timestamp(value: datetime | None) -> datetime | None:
    """Give database and application timestamps one API timezone contract."""

    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def data_instance_schema_from_values(
    *,
    id: uuid.UUID,
    project_id: uuid.UUID,
    filename: str,
    object_storage_key: str,
    uploaded_by_user_id: str,
    created_at: datetime,
    group_id: uuid.UUID | None = None,
    content_type: str | None = None,
    size_bytes: int | None = None,
    metadata: Any = None,
    uploader_id: uuid.UUID | None = None,
    updated_at: datetime | None = None,
    deleted_at: datetime | None = None,
    deleted_by_user_id: uuid.UUID | None = None,
    deletion_reason: str | None = None,
    pending_hard_delete_at: datetime | None = None,
    hard_deleted_at: datetime | None = None,
    hard_deleted_by_user_id: uuid.UUID | None = None,
    storage_deleted: bool = False,
) -> image_schemas.DataInstance:
    """Build a response schema without reading SQLAlchemy-managed state.

    Write paths use this pure value factory before their durable commit.  The
    resulting response therefore cannot trigger implicit async ORM I/O after
    commit, and response construction failures remain safe to roll back and
    compensate in object storage.
    """

    return image_schemas.DataInstance(
        id=id,
        project_id=project_id,
        group_id=group_id,
        filename=filename,
        object_storage_key=object_storage_key,
        content_type=content_type,
        size_bytes=size_bytes,
        metadata_=normalize_metadata_dict(metadata),
        uploaded_by_user_id=uploaded_by_user_id,
        uploader_id=uploader_id,
        created_at=_normalize_utc_timestamp(created_at),
        updated_at=_normalize_utc_timestamp(updated_at),
        deleted_at=_normalize_utc_timestamp(deleted_at),
        deleted_by_user_id=deleted_by_user_id,
        deletion_reason=deletion_reason,
        pending_hard_delete_at=_normalize_utc_timestamp(pending_hard_delete_at),
        hard_deleted_at=_normalize_utc_timestamp(hard_deleted_at),
        hard_deleted_by_user_id=hard_deleted_by_user_id,
        storage_deleted=storage_deleted,
    )


def to_data_instance_schema(
    db_image: models.DataInstance,
) -> image_schemas.DataInstance:
    """
    Convert a database DataInstance model to a Pydantic schema.
    Handles metadata serialization consistently.

    Args:
        db_image: The database model instance

    Returns:
        Pydantic schema instance with properly serialized metadata
    """
    # Convert metadata_ to dict format expected by the schema
    metadata_dict = {}
    if db_image.metadata_json:
        # If it's already a dict, use it directly
        if isinstance(db_image.metadata_json, dict):
            metadata_dict = db_image.metadata_json
        # If it's a string, try to parse it as JSON
        elif isinstance(db_image.metadata_json, str):
            try:
                import json

                metadata_dict = json.loads(db_image.metadata_json)
            except (json.JSONDecodeError, TypeError):
                metadata_dict = {}
        # If it's some other type with attributes, convert to dict
        elif hasattr(db_image.metadata_json, "__dict__"):
            metadata_dict = {
                k: v
                for k, v in db_image.metadata_json.__dict__.items()
                if not k.startswith("_")
            }

    # Build schema matching core.image_schemas.DataInstance fields including deletion metadata.
    # This adapter is for already-loaded read models. Write paths should call
    # data_instance_schema_from_values before commit instead.
    return data_instance_schema_from_values(
        id=db_image.id,
        project_id=db_image.project_id,
        group_id=getattr(db_image, "group_id", None),
        filename=db_image.filename,
        object_storage_key=db_image.object_storage_key,
        content_type=getattr(db_image, "content_type", None),
        size_bytes=getattr(db_image, "size_bytes", None),
        metadata=metadata_dict,
        uploaded_by_user_id=getattr(db_image, "uploaded_by_user_id", None),
        uploader_id=getattr(db_image, "uploader_id", None),
        created_at=db_image.created_at,
        updated_at=db_image.updated_at,
        deleted_at=getattr(db_image, "deleted_at", None),
        deleted_by_user_id=getattr(db_image, "deleted_by_user_id", None),
        deletion_reason=getattr(db_image, "deletion_reason", None),
        pending_hard_delete_at=getattr(db_image, "pending_hard_delete_at", None),
        hard_deleted_at=getattr(db_image, "hard_deleted_at", None),
        hard_deleted_by_user_id=getattr(db_image, "hard_deleted_by_user_id", None),
        storage_deleted=getattr(db_image, "storage_deleted", False),
    )


def normalize_metadata_dict(metadata_: Any) -> dict[str, Any]:
    """
    Normalize metadata from various formats to a dictionary.

    Args:
        metadata_: The metadata in various possible formats

    Returns:
        A dictionary representation of the metadata
    """
    if metadata_ is None:
        return {}

    if isinstance(metadata_, dict):
        return metadata_

    if isinstance(metadata_, str):
        try:
            import json

            return json.loads(metadata_)
        except (json.JSONDecodeError, TypeError):
            return {}

    if hasattr(metadata_, "__dict__"):
        return {k: v for k, v in metadata_.__dict__.items() if not k.startswith("_")}

    # Fallback: try to convert to dict
    try:
        return dict(metadata_)
    except (TypeError, ValueError):
        return {}
