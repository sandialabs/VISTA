"""Pydantic schemas for inspection nonconformance reports (NCRs)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

NCR_TEXT_MAX_LENGTH = 10_000
NCR_CODE_MAX_LENGTH = 64

NcrStatus = Literal["open", "approved"]
NcrHistoryAction = Literal["created", "updated", "approved", "deleted"]

# Fields whose changes are recorded in the change history.
NCR_TRACKED_FIELDS = (
    "comment",
    "failure_code",
    "failure_code_description",
    "disposition_code",
    "disposition_code_description",
    "disposition_instructions",
    "status",
)


def _strip(value):
    return value.strip() if isinstance(value, str) else value


def _reject_control_characters(value: str) -> str:
    # Allow newlines and tabs in free text; reject other control characters,
    # including NUL, which PostgreSQL text columns cannot store.
    if any(ord(ch) < 32 and ch not in "\n\r\t" for ch in value):
        raise ValueError("must not contain control characters")
    return value


class _NcrFieldsMixin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator(
        "comment",
        "failure_code",
        "disposition_code",
        "disposition_instructions",
        mode="before",
        check_fields=False,
    )
    @classmethod
    def strip_text(cls, value):
        return _strip(value)

    @field_validator(
        "comment",
        "failure_code",
        "disposition_code",
        "disposition_instructions",
        check_fields=False,
    )
    @classmethod
    def no_control_characters(cls, value):
        if value is None:
            return value
        return _reject_control_characters(value)


class InspectionNcrCreate(_NcrFieldsMixin):
    """Request body for creating an NCR. Every field is required."""

    comment: str = Field(..., min_length=1, max_length=NCR_TEXT_MAX_LENGTH)
    failure_code: str = Field(..., min_length=1, max_length=NCR_CODE_MAX_LENGTH)
    disposition_code: str = Field(..., min_length=1, max_length=NCR_CODE_MAX_LENGTH)
    disposition_instructions: str = Field(
        ..., min_length=1, max_length=NCR_TEXT_MAX_LENGTH
    )


class InspectionNcrUpdate(_NcrFieldsMixin):
    """Partial update. Supplied fields must still be non-empty.

    ``expected_version`` guards against overwriting a concurrent edit.
    """

    comment: str | None = Field(None, min_length=1, max_length=NCR_TEXT_MAX_LENGTH)
    failure_code: str | None = Field(None, min_length=1, max_length=NCR_CODE_MAX_LENGTH)
    disposition_code: str | None = Field(
        None, min_length=1, max_length=NCR_CODE_MAX_LENGTH
    )
    disposition_instructions: str | None = Field(
        None, min_length=1, max_length=NCR_TEXT_MAX_LENGTH
    )
    expected_version: StrictInt | None = Field(None, ge=1)


class InspectionNcrHistoryEntry(BaseModel):
    """One append-only change-history row."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    action: NcrHistoryAction
    actor: str
    at: datetime
    changes: dict[str, dict[str, Any]]


class InspectionNcr(BaseModel):
    """An NCR as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    part_id: uuid.UUID | None
    part_serial_number: str
    ncr_number: int
    ncr_label: str
    status: NcrStatus
    comment: str
    failure_code: str
    failure_code_description: str
    disposition_code: str
    disposition_code_description: str
    disposition_instructions: str
    version: int
    created_at: datetime | None
    created_by: str
    updated_at: datetime | None
    updated_by: str
    approved_at: datetime | None = None
    approved_by: str | None = None
    deleted_at: datetime | None = None
    deleted_by: str | None = None


class InspectionNcrDetail(InspectionNcr):
    """An NCR with its full change history."""

    history: list[InspectionNcrHistoryEntry] = Field(default_factory=list)


class InspectionNcrListResponse(BaseModel):
    """A list of NCRs for a part or project."""

    part_id: uuid.UUID | None = None
    ncrs: list[InspectionNcr]
