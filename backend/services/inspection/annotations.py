"""Inspection part annotation helper functions."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from repositories import audit as audit_repository
from repositories import inspection as inspection_repository
from schemas import inspection_annotations as inspection_annotation_schemas
from services.errors import NotFoundError, UnprocessableError
from services.inspection.parts import PartNotFoundError, serialize_inspection_part

ANNOTATIONS_METADATA_KEY = "annotations"
REJECT_PART_DISPOSITION = "reject_part"
INSPECTION_MAX_ANNOTATIONS_PER_PART = 2_048
INSPECTION_MAX_VISTA_SEGMENTS_PER_PART = 64
INSPECTION_MAX_ANNOTATIONS_JSON_BYTES = 32 * 1024 * 1024


class AnnotationLimitError(UnprocessableError, ValueError):
    """Raised when an annotation collection violates configured limits."""


class AnnotationNotFoundError(NotFoundError, ValueError):
    """Raised when an annotation cannot be found on a part."""

    default_detail = "Annotation not found"


class AnnotationValidationError(UnprocessableError, ValueError):
    """Raised when an annotation update fails schema validation.

    ``detail`` is the list of Pydantic error dicts so clients see field errors.
    """

    def __init__(self, errors: list[dict]):
        """Store the Pydantic error dicts as `errors`."""
        super().__init__(errors)
        self.errors = errors

    def __str__(self) -> str:
        """Return a short message; callers read `errors` for detail."""
        return "Invalid annotation"


def part_annotations(
    part: Any, *, metadata_key: str = ANNOTATIONS_METADATA_KEY
) -> list[dict]:
    """Return a safe annotation list from an inspection part metadata payload."""
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    annotations = metadata.get(metadata_key)
    return list(annotations) if isinstance(annotations, list) else []


def annotations_reject_part(
    annotations: list[dict], *, reject_disposition: str = REJECT_PART_DISPOSITION
) -> bool:
    """Return whether any annotation marks the part as rejected."""
    return any(
        str(annotation.get("disposition") or "").strip().lower() == reject_disposition
        for annotation in annotations
        if isinstance(annotation, dict)
    )


def validate_annotation_collection_limits(
    annotations: list[dict],
    *,
    max_annotations: int = INSPECTION_MAX_ANNOTATIONS_PER_PART,
    max_vista_segments: int = INSPECTION_MAX_VISTA_SEGMENTS_PER_PART,
    max_json_bytes: int = INSPECTION_MAX_ANNOTATIONS_JSON_BYTES,
) -> None:
    """Validate annotation count, VISTA segment count, and serialized size limits."""
    if len(annotations) > max_annotations:
        raise AnnotationLimitError(
            f"A part may contain at most {max_annotations} annotations"
        )
    if any(not isinstance(annotation, dict) for annotation in annotations):
        raise AnnotationLimitError("Part annotations must contain only JSON objects")
    vista_segment_count = sum(
        1
        for annotation in annotations
        if (
            annotation.get("annotation_kind") == "vista_segment"
            or (
                isinstance(annotation.get("geometry"), dict)
                and "segment" in annotation["geometry"]
            )
        )
    )
    if vista_segment_count > max_vista_segments:
        raise AnnotationLimitError(
            f"A part may contain at most {max_vista_segments} VISTA segment annotations"
        )
    try:
        serialized_size = len(
            json.dumps(
                annotations, ensure_ascii=False, allow_nan=False, separators=(",", ":")
            ).encode("utf-8")
        )
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise AnnotationLimitError(
            "Annotations must contain JSON-compatible finite values"
        ) from exc
    if serialized_size > max_json_bytes:
        raise AnnotationLimitError(
            f"Part annotations must contain at most {max_json_bytes} serialized bytes"
        )


def _validation_errors(exc: ValidationError) -> list[dict]:
    return [
        {
            "loc": list(error.get("loc", ())),
            "msg": error.get("msg", "Invalid annotation"),
            "type": error.get("type", "value_error"),
        }
        for error in exc.errors(include_url=False)
    ]


async def _persist_part_annotations(
    *,
    db,
    project_id,
    part_id,
    annotations: list[dict],
    updated_by: str,
    commit: bool = True,
):
    persisted = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={ANNOTATIONS_METADATA_KEY: annotations},
        updated_by=updated_by,
        commit=False,
    )
    if not persisted:
        raise PartNotFoundError("Inspection part not found")
    if annotations_reject_part(annotations):
        persisted.review_state = "reject_confirmed"
    if commit:
        await db.commit()
        await db.refresh(persisted)
        audit_repository.log_db_operation(
            "UPDATE",
            "inspection_parts",
            persisted.id,
            updated_by or "system",
            {
                "project_id": str(project_id),
                "metadata_keys": [ANNOTATIONS_METADATA_KEY],
                **(
                    {"review_state": "reject_confirmed"}
                    if annotations_reject_part(annotations)
                    else {}
                ),
            },
        )
    return persisted


async def create_part_annotation(
    *,
    db,
    project_id,
    part_id,
    part,
    payload: inspection_annotation_schemas.InspectionAnnotationCreate,
    current_user_email: str,
) -> dict:
    """Append an annotation to a part and persist metadata/review updates."""
    now = datetime.now(UTC).isoformat()
    annotation_entry = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "created_at": now,
        "created_by": current_user_email or "Unknown",
        "updated_at": now,
        "updated_by": current_user_email,
    }
    annotations = part_annotations(part)
    annotations.append(annotation_entry)
    validate_annotation_collection_limits(annotations)
    await _persist_part_annotations(
        db=db,
        project_id=project_id,
        part_id=part_id,
        annotations=annotations,
        updated_by=current_user_email,
    )
    return annotation_entry


async def update_part_annotation(
    *,
    db,
    project_id,
    part_id,
    part,
    annotation_id,
    payload: inspection_annotation_schemas.InspectionAnnotationUpdate,
    current_user_email: str,
) -> dict:
    """Update an existing part annotation and persist metadata/review changes."""
    existing_annotations = part_annotations(part)
    validate_annotation_collection_limits(existing_annotations)
    update_payload = payload.model_dump(exclude_none=True)
    now = datetime.now(UTC).isoformat()
    updated_annotation = None
    updated_annotations = []

    for annotation in existing_annotations:
        if annotation.get("id") == str(annotation_id):
            annotation = {
                **annotation,
                **update_payload,
                "updated_at": now,
                "updated_by": current_user_email,
            }
            try:
                validated_annotation = (
                    inspection_annotation_schemas.InspectionAnnotation.model_validate(
                        annotation
                    )
                )
            except ValidationError as exc:
                raise AnnotationValidationError(_validation_errors(exc)) from exc
            annotation = validated_annotation.model_dump(mode="json")
            updated_annotation = annotation
        updated_annotations.append(annotation)

    if not updated_annotation:
        raise AnnotationNotFoundError("Annotation not found")

    validate_annotation_collection_limits(updated_annotations)
    await _persist_part_annotations(
        db=db,
        project_id=project_id,
        part_id=part_id,
        annotations=updated_annotations,
        updated_by=current_user_email,
    )
    return updated_annotation


async def delete_part_annotation(
    *,
    db,
    project_id,
    part_id,
    part,
    annotation_id,
    current_user_email: str,
) -> None:
    """Delete an annotation from a part."""
    existing_annotations = part_annotations(part)
    updated_annotations = [
        annotation
        for annotation in existing_annotations
        if annotation.get("id") != str(annotation_id)
    ]
    if len(updated_annotations) == len(existing_annotations):
        raise AnnotationNotFoundError("Annotation not found")
    await _persist_part_annotations(
        db=db,
        project_id=project_id,
        part_id=part_id,
        annotations=updated_annotations,
        updated_by=current_user_email,
        commit=True,
    )


async def update_part_review_state(
    *, db, project_id, part_id, review_state: str, updated_by: str
) -> dict:
    """Set a part's review state; a rejecting annotation forces reject_confirmed."""
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise PartNotFoundError("Inspection part not found")
    if annotations_reject_part(
        part_annotations(part), reject_disposition=REJECT_PART_DISPOSITION
    ):
        review_state = "reject_confirmed"
    updated = await inspection_repository.update_inspection_part_review_state(
        db=db,
        project_id=project_id,
        part_id=part_id,
        review_state=review_state,
        updated_by=updated_by,
    )
    if not updated:
        raise PartNotFoundError("Inspection part not found")
    return serialize_inspection_part(updated)
