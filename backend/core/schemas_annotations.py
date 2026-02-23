import uuid
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class UserAnnotationCreate(BaseModel):
    image_id: uuid.UUID
    bbox_class_id: uuid.UUID
    collection_id: Optional[uuid.UUID] = None
    x_min: float = Field(..., ge=0)
    y_min: float = Field(..., ge=0)
    x_max: float = Field(..., ge=0)
    y_max: float = Field(..., ge=0)
    image_width: int = Field(..., gt=0)
    image_height: int = Field(..., gt=0)
    notes: Optional[str] = None
    origin: str = Field(default="manual", pattern=r"^(manual|ml_assisted|imported)$")


class UserAnnotationUpdate(BaseModel):
    bbox_class_id: Optional[uuid.UUID] = None
    x_min: Optional[float] = Field(None, ge=0)
    y_min: Optional[float] = Field(None, ge=0)
    x_max: Optional[float] = Field(None, ge=0)
    y_max: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


class UserAnnotation(BaseModel):
    id: uuid.UUID
    image_id: uuid.UUID
    project_id: uuid.UUID
    collection_id: Optional[uuid.UUID] = None
    bbox_class_id: uuid.UUID
    created_by_id: uuid.UUID
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    image_width: int
    image_height: int
    review_status: str
    reviewed_by_id: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    review_comment: Optional[str] = None
    origin: str
    original_annotation_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }


class UserAnnotationList(BaseModel):
    annotations: List[UserAnnotation]
    total: int


class AnnotationReviewCreate(BaseModel):
    review_status: str = Field(..., pattern=r"^(approved|rejected|flagged)$")
    review_comment: Optional[str] = None


class BoundingBoxClassCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: str = Field(default="#FF0000", pattern=r"^#[0-9A-Fa-f]{6}$")
    description: Optional[str] = None


class BoundingBoxClassUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    description: Optional[str] = None


class BoundingBoxClass(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    collection_id: uuid.UUID
    name: str
    color: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }
