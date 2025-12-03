import uuid
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# User schemas
class UserBase(BaseModel):
    email: EmailStr
    username: Optional[str] = None
    is_active: bool = True
    groups: Optional[List[str]] = None

class UserCreate(UserBase):
    pass

class User(UserBase):
    id: Optional[uuid.UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

# Project schemas
class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    meta_group_id: str = Field(..., min_length=1, max_length=255)

class ProjectCreate(ProjectBase):
    pass

class Project(ProjectBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

# DataInstance schemas
class DataInstanceBase(BaseModel):
    filename: str
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    metadata_: Optional[Dict[str, Any]] = Field(None, alias="metadata")

class DataInstanceCreate(DataInstanceBase):
    project_id: uuid.UUID
    object_storage_key: str
    uploaded_by_user_id: str
    uploader_id: Optional[uuid.UUID] = None

class DataInstance(DataInstanceBase):
    id: uuid.UUID
    project_id: uuid.UUID
    object_storage_key: str
    uploaded_by_user_id: str
    uploader_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Deletion fields
    deleted_at: Optional[datetime] = None
    deleted_by_user_id: Optional[uuid.UUID] = None
    deletion_reason: Optional[str] = None
    pending_hard_delete_at: Optional[datetime] = None
    hard_deleted_at: Optional[datetime] = None
    hard_deleted_by_user_id: Optional[uuid.UUID] = None
    storage_deleted: bool = False

    @field_validator('metadata_', mode='before')
    @classmethod
    def validate_metadata(cls, v):
        # If it's None, return None
        if v is None:
            return None
        
        # If it's already a dict, return it
        if isinstance(v, dict):
            return v
            
        # If it has a __class__ attribute and it's a MetaData object, return an empty dict
        if hasattr(v, '__class__') and getattr(v, '__class__').__name__ == 'MetaData':
            return {}
            
        # Try to convert to dict if possible
        try:
            if hasattr(v, '_asdict'):
                return v._asdict()
            elif hasattr(v, 'items'):
                return dict(v.items())
            elif isinstance(v, str):
                import json
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    return {"value": v}
        except (TypeError, ValueError, AttributeError):
            # Handle any parsing errors by logging and returning default
            logger.warning("Failed to parse JSON value, using default", extra={"value_type": type(v).__name__})
            
        # If all else fails, return an empty dict
        return {}

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

# ImageClass schemas
class ImageClassBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None

class ImageClassCreate(ImageClassBase):
    project_id: uuid.UUID

class ImageClass(ImageClassBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

# ImageClassification schemas
class ImageClassificationBase(BaseModel):
    image_id: uuid.UUID
    class_id: uuid.UUID
    
    @field_validator('image_id', 'class_id', mode='before')
    @classmethod
    def validate_uuid(cls, v):
        if isinstance(v, str):
            try:
                return uuid.UUID(v)
            except ValueError:
                raise ValueError(f"Invalid UUID format: {v}")
        return v

class ImageClassificationCreate(ImageClassificationBase):
    created_by_id: Optional[uuid.UUID] = None

class ImageClassification(ImageClassificationBase):
    id: uuid.UUID
    created_by_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # Remove the related data that's causing issues
    # image_class: Optional[ImageClass] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

# ImageComment schemas
class ImageCommentBase(BaseModel):
    text: str = Field(..., min_length=1)

class ImageCommentCreate(ImageCommentBase):
    image_id: uuid.UUID
    author_id: Optional[uuid.UUID] = None
    
    @field_validator('image_id', 'author_id', mode='before')
    @classmethod
    def validate_uuid(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return uuid.UUID(v)
            except ValueError:
                raise ValueError(f"Invalid UUID format: {v}")
        return v

class ImageComment(ImageCommentBase):
    id: uuid.UUID
    image_id: uuid.UUID
    author_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # Remove the related data that's causing issues
    # author: Optional[User] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

# ProjectMetadata schemas
class ProjectMetadataBase(BaseModel):
    key: str = Field(..., min_length=1, max_length=255)
    value: Any = None

class ProjectMetadataCreate(ProjectMetadataBase):
    project_id: uuid.UUID

class ProjectMetadata(ProjectMetadataBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class PresignedUrlResponse(BaseModel):
    url: str
    object_key: str
    method: str = "GET"

# ApiKey schemas
class ApiKeyBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)

class ApiKeyCreate(ApiKeyBase):
    pass

class ApiKey(ApiKeyBase):
    id: uuid.UUID
    user_id: uuid.UUID
    is_active: bool
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class ApiKeyCreateResponse(BaseModel):
    api_key: ApiKey
    key: str  # The raw API key (only shown once)


# Deletion / Audit Schemas
class ImageDeletionEvent(BaseModel):
    id: uuid.UUID
    image_id: uuid.UUID
    project_id: uuid.UUID
    actor_user_id: Optional[uuid.UUID] = None
    action: str
    reason: Optional[str] = None
    storage_deleted: bool
    previous_state: Optional[Dict[str, Any]] = None
    at: datetime

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class ImageDeletionEventList(BaseModel):
    events: List[ImageDeletionEvent]
    total: int


# ----------------- ML Analysis Schemas -----------------
class MLAnnotationBase(BaseModel):
    annotation_type: str = Field(..., min_length=3, max_length=50)
    class_name: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0, le=1)
    data: Dict[str, Any]
    storage_path: Optional[str] = None
    ordering: Optional[int] = None

class MLAnnotationCreate(MLAnnotationBase):
    pass

class MLAnnotation(MLAnnotationBase):
    id: uuid.UUID
    analysis_id: uuid.UUID
    created_at: datetime

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class MLAnalysisBase(BaseModel):
    model_name: str = Field(
        ...,
        min_length=2,
        max_length=255,
        pattern=r'^[a-zA-Z0-9_\-]+$',
        description="Model name (alphanumeric, dash, underscore only)"
    )
    model_version: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Model version identifier"
    )
    parameters: Optional[Dict[str, Any]] = None

class MLAnalysisCreate(MLAnalysisBase):
    image_id: uuid.UUID

class MLAnalysis(MLAnalysisBase):
    id: uuid.UUID
    image_id: uuid.UUID
    status: str
    error_message: Optional[str] = None
    provenance: Optional[Dict[str, Any]] = None
    requested_by_id: uuid.UUID
    external_job_id: Optional[str] = None
    priority: int
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    annotations: Optional[List[MLAnnotation]] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class MLAnalysisList(BaseModel):
    analyses: List[MLAnalysis]
    total: int

class MLAnnotationList(BaseModel):
    annotations: List[MLAnnotation]
    total: int


