"""Pydantic schemas for image reviews."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

VALID_REVIEW_STATUSES = {"pass", "reject_pending", "reject_confirmed"}


class ImageReviewBase(BaseModel):
    """Shared image review fields."""

    status: str = Field(
        ..., description="Review status: pass, reject_pending, reject_confirmed"
    )
    notes: str | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        """Validate supported review status values."""
        if v not in VALID_REVIEW_STATUSES:
            raise ValueError(
                f"status must be one of: {', '.join(sorted(VALID_REVIEW_STATUSES))}"
            )
        return v


class ImageReviewCreate(ImageReviewBase):
    """Input schema for creating an image review."""

    image_id: uuid.UUID
    project_id: uuid.UUID
    reviewer_id: uuid.UUID


class ImageReview(ImageReviewBase):
    """Response schema for an image review."""

    id: uuid.UUID
    image_id: uuid.UUID
    project_id: uuid.UUID
    reviewer_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ImageReviewWithUser(ImageReview):
    """Image review response with reviewer email."""

    reviewer_email: str | None = None


class ImageReviewSummary(BaseModel):
    """Aggregate image review summary."""

    image_id: uuid.UUID
    status: str
    review_count: int
    latest_review: ImageReview | None = None


class ProjectReviewStatus(BaseModel):
    """Aggregate review status for a project."""

    project_id: uuid.UUID
    total_images: int
    reviewed: int
    unreviewed: int
    passed: int
    reject_pending: int
    reject_confirmed: int
