import uuid
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    purpose: str = Field(default="labeling", pattern=r"^(labeling|review|inspection)$")


class CollectionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class CollectionPhaseUpdate(BaseModel):
    phase: str = Field(..., pattern=r"^(draft|annotating|review|certified)$")
    reopen_reason: Optional[str] = None


class CollectionCertifyRequest(BaseModel):
    certification_notes: Optional[str] = None


class Collection(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: Optional[str] = None
    purpose: str
    phase: str
    source_collection_id: Optional[uuid.UUID] = None
    ml_model_name: Optional[str] = None
    ml_model_version: Optional[str] = None
    certified_by_id: Optional[uuid.UUID] = None
    certified_at: Optional[datetime] = None
    certification_notes: Optional[str] = None
    archived_at: Optional[datetime] = None
    created_by_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    image_count: int = 0

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }


class CollectionList(BaseModel):
    collections: List[Collection]
    total: int


class CollectionImageIds(BaseModel):
    image_ids: List[uuid.UUID]


class ImageReviewCreate(BaseModel):
    status: str = Field(..., pattern=r"^(reviewed|flagged)$")
    notes: Optional[str] = None


class ImageReviewResponse(BaseModel):
    id: uuid.UUID
    collection_id: uuid.UUID
    image_id: uuid.UUID
    reviewer_id: uuid.UUID
    status: str
    notes: Optional[str] = None
    reviewed_at: datetime

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }


class ReviewProgress(BaseModel):
    total_images: int
    reviewed: int
    flagged: int
    unreviewed: int
    annotation_total: int
    annotation_approved: int
    annotation_pending: int
    annotation_rejected: int
    annotation_flagged: int
