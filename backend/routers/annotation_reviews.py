import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from core import schemas
from core.database import get_db
from utils.dependencies import (
    get_current_user,
    get_user_context,
    UserContext,
    get_project_or_403,
)
from utils.crud.annotation_reviews import (
    create_annotation_review,
    get_reviews_for_annotation,
    get_annotation_review_stats,
    get_audit_events,
    count_audit_events,
)

router = APIRouter(
    tags=["Annotation Reviews"],
)


@router.post(
    "/user-annotations/{annotation_id}/reviews",
    response_model=schemas.AnnotationReview,
    status_code=status.HTTP_201_CREATED,
)
async def create_review(
    annotation_id: uuid.UUID,
    body: schemas.AnnotationReviewBase,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    """Create a review for a user annotation (approve, reject, flag_revision)."""
    review_data = schemas.AnnotationReviewCreate(
        annotation_id=annotation_id,
        annotation_type="user",
        reviewer_id=user_context.id,
        action=body.action,
        comment=body.comment,
        edits_made=body.edits_made,
    )
    return await create_annotation_review(
        db=db, review_data=review_data, created_by=user_context.email,
    )


@router.get(
    "/user-annotations/{annotation_id}/reviews",
    response_model=List[schemas.AnnotationReview],
)
async def list_reviews(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get the review history for a user annotation."""
    return await get_reviews_for_annotation(
        db=db, annotation_id=annotation_id, annotation_type="user",
    )


@router.get(
    "/projects/{project_id}/annotation-review-status",
)
async def get_project_annotation_review_status(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get aggregate annotation review stats for a project."""
    await get_project_or_403(project_id, db, current_user)
    return await get_annotation_review_stats(db=db, project_id=project_id)


@router.get(
    "/projects/{project_id}/audit-log",
    response_model=schemas.AuditEventList,
)
async def get_project_audit_log(
    project_id: uuid.UUID,
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Get the audit log for a project (paginated)."""
    await get_project_or_403(project_id, db, current_user)

    events = await get_audit_events(
        db=db,
        entity_type=entity_type,
        action=action,
        skip=skip,
        limit=limit,
    )
    total = await count_audit_events(
        db=db,
        entity_type=entity_type,
    )
    return schemas.AuditEventList(events=events, total=total)
