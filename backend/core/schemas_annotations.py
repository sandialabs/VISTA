"""Annotation, collection, and review schemas split from core.schemas.

These schemas cover BBoxClass, UserAnnotation, Collection, AnnotationReview,
and AuditEvent models. Re-exported via core.schemas for backward compatibility.
"""
__all__ = [
    "DEFAULT_BBOX_COLORS",
    "BBoxClassBase", "BBoxClassCreate", "BBoxClass", "BBoxClassUpdate",
    "UserAnnotationBase", "UserAnnotationCreate", "UserAnnotationUpdate",
    "UserAnnotation", "UserAnnotationWithDetails",
    "CollectionBase", "CollectionCreate", "Collection", "CollectionUpdate",
    "CollectionImageAdd", "CollectionImageInfo", "CollectionLockRequest",
    "AnnotationReviewBase", "AnnotationReviewCreate", "AnnotationReview",
    "AuditEventBase", "AuditEvent", "AuditEventList",
]

import uuid
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime


# BBoxClass schemas
DEFAULT_BBOX_COLORS = [
    "#FF9800", "#4CAF50", "#2196F3", "#F44336", "#9C27B0",
    "#00BCD4", "#FFEB3B", "#795548", "#607D8B", "#E91E63",
]

class BBoxClassBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    color: str = Field(default="#FF9800", max_length=7, pattern=r'^#[0-9A-Fa-f]{6}$')

class BBoxClassCreate(BBoxClassBase):
    project_id: uuid.UUID

class BBoxClass(BBoxClassBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class BBoxClassUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r'^#[0-9A-Fa-f]{6}$')


# UserAnnotation schemas
class UserAnnotationBase(BaseModel):
    bbox_class_id: uuid.UUID
    bbox_x_min: float = Field(..., ge=0)
    bbox_y_min: float = Field(..., ge=0)
    bbox_x_max: float = Field(..., ge=0)
    bbox_y_max: float = Field(..., ge=0)
    image_width: int = Field(..., gt=0)
    image_height: int = Field(..., gt=0)
    notes: Optional[str] = None

class UserAnnotationCreate(UserAnnotationBase):
    pass

class UserAnnotationUpdate(BaseModel):
    bbox_class_id: Optional[uuid.UUID] = None
    bbox_x_min: Optional[float] = Field(None, ge=0)
    bbox_y_min: Optional[float] = Field(None, ge=0)
    bbox_x_max: Optional[float] = Field(None, ge=0)
    bbox_y_max: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None

class UserAnnotation(UserAnnotationBase):
    id: uuid.UUID
    image_id: uuid.UUID
    project_id: uuid.UUID
    created_by_user_id: uuid.UUID
    updated_by_user_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class UserAnnotationWithDetails(UserAnnotation):
    class_name: Optional[str] = None
    class_color: Optional[str] = None
    creator_email: Optional[str] = None


# Collection schemas
class CollectionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None

class CollectionCreate(CollectionBase):
    project_id: uuid.UUID

class Collection(CollectionBase):
    id: uuid.UUID
    project_id: uuid.UUID
    is_locked: bool = False
    locked_at: Optional[datetime] = None
    locked_by_user_id: Optional[uuid.UUID] = None
    lock_reason: Optional[str] = None
    review_required: bool = False
    created_by_user_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class CollectionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None

class CollectionImageAdd(BaseModel):
    image_ids: List[uuid.UUID]

class CollectionImageInfo(BaseModel):
    id: uuid.UUID
    collection_id: uuid.UUID
    image_id: uuid.UUID
    added_by_user_id: uuid.UUID
    added_at: datetime

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class CollectionLockRequest(BaseModel):
    reason: Optional[str] = None


# AnnotationReview schemas
VALID_ANNOTATION_REVIEW_ACTIONS = {"approve", "reject", "flag_revision"}

class AnnotationReviewBase(BaseModel):
    action: str = Field(..., description="Review action: approve, reject, flag_revision")
    comment: Optional[str] = None
    edits_made: Optional[Dict[str, Any]] = None

    @field_validator('action')
    @classmethod
    def validate_action(cls, v):
        if v not in VALID_ANNOTATION_REVIEW_ACTIONS:
            raise ValueError(f"action must be one of: {', '.join(sorted(VALID_ANNOTATION_REVIEW_ACTIONS))}")
        return v

class AnnotationReviewCreate(AnnotationReviewBase):
    annotation_id: uuid.UUID
    annotation_type: str = "user"
    reviewer_id: uuid.UUID

class AnnotationReview(AnnotationReviewBase):
    id: uuid.UUID
    annotation_id: uuid.UUID
    annotation_type: str
    reviewer_id: uuid.UUID
    created_at: datetime

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }


# AuditEvent schemas
class AuditEventBase(BaseModel):
    entity_type: str
    entity_id: uuid.UUID
    action: str
    details: Optional[Dict[str, Any]] = None

class AuditEvent(AuditEventBase):
    id: uuid.UUID
    actor_user_id: uuid.UUID
    created_at: datetime

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }

class AuditEventList(BaseModel):
    events: List[AuditEvent]
    total: int
