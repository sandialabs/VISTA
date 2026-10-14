"""Project backup payload collection helpers."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from core import models
from services.export import bundles as export_bundle_service
from services.inspection.workspace import (
    PROJECT_CONFIGURATION_KEY,
    default_project_configuration,
)


async def collect_project_backup_payload(
    *,
    project_id,
    db,
    db_project,
    current_user,
    include_images: bool = True,
    include_overlays: bool = True,
    include_metadata: bool = True,
    include_created_overlays: bool = True,
    include_project_configuration: bool = True,
    include_deleted: bool = False,
) -> dict:
    """Collect a restorable project backup payload plus artifact references."""
    bundle_payload = await export_bundle_service.collect_project_bundle_payload(
        project_id=project_id, db=db, db_project=db_project
    )
    image_query = (
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .order_by(models.DataInstance.created_at.asc(), models.DataInstance.id.asc())
    )
    if not include_deleted:
        image_query = image_query.where(models.DataInstance.deleted_at.is_(None))
    image_rows = (await db.execute(image_query)).scalars().all()

    group_rows = (
        (
            await db.execute(
                select(models.ImageGroup)
                .where(models.ImageGroup.project_id == project_id)
                .order_by(
                    models.ImageGroup.identifier.asc(), models.ImageGroup.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    batch_rows = (
        (
            await db.execute(
                select(models.InspectionBatch)
                .where(models.InspectionBatch.project_id == project_id)
                .order_by(
                    models.InspectionBatch.name.asc(), models.InspectionBatch.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    part_rows = (
        (
            await db.execute(
                select(models.InspectionPart)
                .where(models.InspectionPart.project_id == project_id)
                .order_by(
                    models.InspectionPart.serial_number.asc(),
                    models.InspectionPart.id.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    project_metadata_rows = (
        (
            await db.execute(
                select(models.ProjectMetadata)
                .where(models.ProjectMetadata.project_id == project_id)
                .order_by(
                    models.ProjectMetadata.key.asc(), models.ProjectMetadata.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    image_class_rows = (
        (
            await db.execute(
                select(models.ImageClass)
                .where(models.ImageClass.project_id == project_id)
                .order_by(models.ImageClass.name.asc(), models.ImageClass.id.asc())
            )
        )
        .scalars()
        .all()
    )

    image_ids = [image.id for image in image_rows]
    image_class_ids = [image_class.id for image_class in image_class_rows]
    classification_rows = []
    comment_rows = []
    review_rows = []
    ml_analysis_rows = []
    ml_annotation_rows = []
    if image_ids:
        classification_rows = (
            (
                await db.execute(
                    select(models.ImageClassification)
                    .where(models.ImageClassification.image_id.in_(image_ids))
                    .order_by(
                        models.ImageClassification.created_at.asc(),
                        models.ImageClassification.id.asc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        comment_rows = (
            (
                await db.execute(
                    select(models.ImageComment)
                    .where(models.ImageComment.image_id.in_(image_ids))
                    .order_by(
                        models.ImageComment.created_at.asc(),
                        models.ImageComment.id.asc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        review_rows = (
            (
                await db.execute(
                    select(models.ImageReview)
                    .where(models.ImageReview.image_id.in_(image_ids))
                    .order_by(
                        models.ImageReview.created_at.asc(), models.ImageReview.id.asc()
                    )
                )
            )
            .scalars()
            .all()
        )
        ml_analysis_rows = (
            (
                await db.execute(
                    select(models.MLAnalysis)
                    .where(models.MLAnalysis.image_id.in_(image_ids))
                    .order_by(
                        models.MLAnalysis.created_at.asc(), models.MLAnalysis.id.asc()
                    )
                )
            )
            .scalars()
            .all()
        )
    ml_analysis_ids = [analysis.id for analysis in ml_analysis_rows]
    if ml_analysis_ids:
        ml_annotation_rows = (
            (
                await db.execute(
                    select(models.MLAnnotation)
                    .where(models.MLAnnotation.analysis_id.in_(ml_analysis_ids))
                    .order_by(
                        models.MLAnnotation.created_at.asc(),
                        models.MLAnnotation.id.asc(),
                    )
                )
            )
            .scalars()
            .all()
        )

    user_ids = set()
    for image in image_rows:
        if image.uploader_id:
            user_ids.add(image.uploader_id)
        if image.deleted_by_user_id:
            user_ids.add(image.deleted_by_user_id)
    for classification in classification_rows:
        if classification.created_by_id:
            user_ids.add(classification.created_by_id)
    for comment in comment_rows:
        if comment.author_id:
            user_ids.add(comment.author_id)
    for review in review_rows:
        if review.reviewer_id:
            user_ids.add(review.reviewer_id)
    for analysis in ml_analysis_rows:
        if analysis.requested_by_id:
            user_ids.add(analysis.requested_by_id)
    user_rows = []
    if user_ids:
        user_rows = (
            (
                await db.execute(
                    select(models.User)
                    .where(models.User.id.in_(list(user_ids)))
                    .order_by(models.User.email.asc())
                )
            )
            .scalars()
            .all()
        )

    project_configuration = default_project_configuration(db_project.project_type)
    for metadata in project_metadata_rows:
        if metadata.key == PROJECT_CONFIGURATION_KEY and isinstance(
            metadata.value, dict
        ):
            project_configuration = {**project_configuration, **metadata.value}
            break

    part_overlay_filenames: set[str] = set()
    for part in part_rows:
        metadata_obj = (
            part.metadata_json if isinstance(part.metadata_json, dict) else {}
        )
        source_images = metadata_obj.get("source_images")
        if isinstance(source_images, list):
            for record in source_images:
                if (
                    isinstance(record, dict)
                    and record.get("overlay")
                    and record.get("filename")
                ):
                    part_overlay_filenames.add(str(record["filename"]))

    used_paths: set[str] = set()
    image_refs = []
    artifact_counts = {
        "images_requested": 0,
        "overlays_requested": 0,
        "files_written": 0,
        "files_missing": 0,
    }
    for image in image_rows:
        is_overlay = export_bundle_service.image_record_is_overlay(
            image.filename, image.metadata_json, part_overlay_filenames
        )
        should_include_file = include_overlays if is_overlay else include_images
        archive_path = ""
        if should_include_file:
            artifact_counts[
                "overlays_requested" if is_overlay else "images_requested"
            ] += 1
            archive_path = export_bundle_service.dedupe_archive_path(
                f"projects/{project_id}/artifacts/overlays"
                if is_overlay
                else f"projects/{project_id}/artifacts/images",
                image.filename or f"{image.id}.bin",
                used_paths,
            )
        image_refs.append(
            {
                "image_id": str(image.id),
                "filename": image.filename,
                "archive_path": archive_path,
                "artifact_kind": "overlay" if is_overlay else "image",
                "object_storage_key": image.object_storage_key,
                "size_bytes": image.size_bytes,
                "content_type": image.content_type or "",
                "uploaded_by": image.uploaded_by_user_id or "",
                "uploader_id": str(image.uploader_id) if image.uploader_id else "",
                "group_id": str(image.group_id) if image.group_id else "",
                "created_at": image.created_at,
                "updated_at": image.updated_at,
                "deleted_at": image.deleted_at,
                "deletion_reason": image.deletion_reason,
                "storage_deleted": image.storage_deleted,
                "metadata_json": image.metadata_json
                if isinstance(image.metadata_json, dict)
                else {},
            }
        )

    backup_payload = {
        "project": {
            "id": str(db_project.id),
            "name": db_project.name,
            "description": db_project.description or "",
            "meta_group_id": db_project.meta_group_id,
            "project_type": db_project.project_type,
            "created_by": db_project.created_by or "",
            "is_archived": bool(db_project.is_archived),
            "archived_at": db_project.archived_at,
            "created_at": db_project.created_at,
            "updated_at": db_project.updated_at,
        },
        "users": [
            {
                "id": str(user.id),
                "email": user.email,
                "username": user.username,
                "is_active": user.is_active,
            }
            for user in user_rows
        ],
        "image_groups": [
            {
                "id": str(group.id),
                "identifier": group.identifier,
                "display_name": group.display_name or "",
                "created_at": group.created_at,
                "updated_at": group.updated_at,
            }
            for group in group_rows
        ],
        "project_metadata": [
            {
                "id": str(metadata.id),
                "key": metadata.key,
                "value_json": metadata.value,
                "created_at": metadata.created_at,
                "updated_at": metadata.updated_at,
            }
            for metadata in project_metadata_rows
        ],
        "project_configuration": project_configuration,
        "images": image_refs,
        "batches": [
            {
                "id": str(batch.id),
                "name": batch.name,
                "description": batch.description or "",
                "owner": batch.owner or "",
                "status": batch.status,
                "created_at": batch.created_at,
                "updated_at": batch.updated_at,
            }
            for batch in batch_rows
        ],
        "parts": [
            {
                "id": str(part.id),
                "batch_id": str(part.batch_id) if part.batch_id else "",
                "serial_number": part.serial_number,
                "display_name": part.display_name or "",
                "review_state": part.review_state,
                "metadata_json": part.metadata_json
                if isinstance(part.metadata_json, dict)
                else {},
                "created_at": part.created_at,
                "updated_at": part.updated_at,
            }
            for part in part_rows
        ],
        "image_classes": [
            {
                "id": str(image_class.id),
                "name": image_class.name,
                "description": image_class.description or "",
                "created_at": image_class.created_at,
                "updated_at": image_class.updated_at,
            }
            for image_class in image_class_rows
        ],
        "classifications": [
            {
                "id": str(classification.id),
                "image_id": str(classification.image_id),
                "class_id": str(classification.class_id),
                "created_by_id": str(classification.created_by_id),
                "created_at": classification.created_at,
                "updated_at": classification.updated_at,
            }
            for classification in classification_rows
            if not image_class_ids or classification.class_id in image_class_ids
        ],
        "comments": [
            {
                "id": str(comment.id),
                "image_id": str(comment.image_id),
                "author_id": str(comment.author_id),
                "text": comment.text,
                "created_at": comment.created_at,
                "updated_at": comment.updated_at,
            }
            for comment in comment_rows
        ],
        "reviews": [
            {
                "id": str(review.id),
                "image_id": str(review.image_id),
                "project_id": str(review.project_id),
                "reviewer_id": str(review.reviewer_id),
                "status": review.status,
                "notes": review.notes,
                "created_at": review.created_at,
                "updated_at": review.updated_at,
            }
            for review in review_rows
        ],
        "ml_analyses": [
            {
                "id": str(analysis.id),
                "image_id": str(analysis.image_id),
                "model_name": analysis.model_name,
                "model_version": analysis.model_version,
                "status": analysis.status,
                "error_message": analysis.error_message,
                "parameters": analysis.parameters,
                "provenance": analysis.provenance,
                "requested_by_id": str(analysis.requested_by_id),
                "external_job_id": analysis.external_job_id,
                "priority": analysis.priority,
                "created_at": analysis.created_at,
                "started_at": analysis.started_at,
                "completed_at": analysis.completed_at,
                "updated_at": analysis.updated_at,
            }
            for analysis in ml_analysis_rows
        ],
        "ml_annotations": [
            {
                "id": str(annotation.id),
                "analysis_id": str(annotation.analysis_id),
                "annotation_type": annotation.annotation_type,
                "class_name": annotation.class_name,
                "confidence": annotation.confidence,
                "data": annotation.data,
                "storage_path": annotation.storage_path,
                "ordering": annotation.ordering,
                "created_at": annotation.created_at,
            }
            for annotation in ml_annotation_rows
        ],
    }

    manifest_payload = {
        "format": "vista-project-backup",
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "generated_by": current_user.email,
        "scope": "project",
        "project": backup_payload["project"],
        "bundle_summary": bundle_payload.get("bundle_summary", {}),
        "artifact_counts": artifact_counts,
        "missing_artifacts": [],
        "options": {
            "include_images": include_images,
            "include_overlays": include_overlays,
            "include_metadata": include_metadata,
            "include_created_overlays": include_created_overlays,
            "include_project_configuration": include_project_configuration,
            "include_deleted": include_deleted,
        },
    }

    return {
        "project_id": str(project_id),
        "backup_payload": backup_payload,
        "legacy_bundle_payload": bundle_payload,
        "manifest_payload": manifest_payload,
        "image_refs": image_refs,
        "artifact_counts": artifact_counts,
        "missing_artifacts": manifest_payload["missing_artifacts"],
    }
