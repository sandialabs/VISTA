"""Project backup import database helpers."""

from __future__ import annotations

import uuid
import zipfile
from collections.abc import Callable
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy import func as _func
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from repositories import users as user_repository
from services.errors import ForbiddenError
from services.export import bundles as export_bundle_service
from services.export import storage as export_storage_service
from utils import cache_manager


class ImportAccessError(ForbiddenError, PermissionError):
    """Raised when the current user cannot import into the target group/project."""


async def ensure_import_user(
    db: AsyncSession,
    source_user_id: str | None,
    source_user_by_id: dict[str, dict],
    current_user: Any,
) -> models.User:
    """Return an existing or newly-created user for an imported actor reference."""
    source_user = source_user_by_id.get(str(source_user_id or ""), {})
    email = source_user.get("email") or current_user.email
    db_user = await user_repository.get_user_by_email(db, email)
    if db_user:
        return db_user
    db_user = models.User(
        email=email,
        username=source_user.get("username"),
        is_active=source_user.get("is_active", True),
    )
    db.add(db_user)
    await db.flush()
    return db_user


async def unique_import_project_name(db: AsyncSession, name: str, mode: str) -> str:
    """Return a non-conflicting project name for restore-as-new imports."""
    if mode != "restore_as_new":
        return name
    base = f"{name} (Imported)"
    candidate = base
    suffix = 2
    while True:
        exists_result = await db.execute(
            select(_func.count())
            .select_from(models.Project)
            .where(models.Project.name == candidate)
        )
        if exists_result.scalar_one() == 0:
            return candidate
        candidate = f"{base} {suffix}"
        suffix += 1


async def clear_project_import_data(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Delete import-replace data for a project while preserving the project row."""
    image_ids_result = await db.execute(
        select(models.DataInstance.id).where(
            models.DataInstance.project_id == project_id
        )
    )
    image_ids = [row[0] for row in image_ids_result.all()]
    if image_ids:
        analysis_ids_result = await db.execute(
            select(models.MLAnalysis.id).where(
                models.MLAnalysis.image_id.in_(image_ids)
            )
        )
        analysis_ids = [row[0] for row in analysis_ids_result.all()]
        if analysis_ids:
            await db.execute(
                delete(models.MLAnnotation).where(
                    models.MLAnnotation.analysis_id.in_(analysis_ids)
                )
            )
        await db.execute(
            delete(models.ImageDeletionEvent).where(
                models.ImageDeletionEvent.image_id.in_(image_ids)
            )
        )
        await db.execute(
            delete(models.MLAnalysis).where(models.MLAnalysis.image_id.in_(image_ids))
        )
        await db.execute(
            delete(models.ImageClassification).where(
                models.ImageClassification.image_id.in_(image_ids)
            )
        )
        await db.execute(
            delete(models.ImageComment).where(
                models.ImageComment.image_id.in_(image_ids)
            )
        )
        await db.execute(
            delete(models.ImageReview).where(models.ImageReview.image_id.in_(image_ids))
        )
        await db.execute(
            delete(models.DataInstance).where(models.DataInstance.id.in_(image_ids))
        )

    await db.execute(
        delete(models.ImageClass).where(models.ImageClass.project_id == project_id)
    )
    await db.execute(
        delete(models.InspectionPart).where(
            models.InspectionPart.project_id == project_id
        )
    )
    await db.execute(
        delete(models.InspectionBatch).where(
            models.InspectionBatch.project_id == project_id
        )
    )
    await db.execute(
        delete(models.ImageGroup).where(models.ImageGroup.project_id == project_id)
    )
    await db.execute(
        delete(models.ProjectMetadata).where(
            models.ProjectMetadata.project_id == project_id
        )
    )


async def existing_filename_counts(
    db: AsyncSession, project_id: uuid.UUID
) -> dict[str, int]:
    """Count active data-instance filenames in a project."""
    result = await db.execute(
        select(models.DataInstance.filename)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.is_(None))
    )
    counts: dict[str, int] = {}
    for (filename,) in result.all():
        safe_filename = str(filename or "").strip()
        if safe_filename:
            counts[safe_filename] = counts.get(safe_filename, 0) + 1
    return counts


async def existing_value_counts(
    db: AsyncSession, model: Any, column_name: str, project_id: uuid.UUID
) -> dict[str, int]:
    """Count existing non-blank values for a project-scoped model column."""
    column = getattr(model, column_name)
    result = await db.execute(select(column).where(model.project_id == project_id))
    counts: dict[str, int] = {}
    for (value,) in result.all():
        safe_value = str(value or "").strip()
        if safe_value:
            counts[safe_value] = counts.get(safe_value, 0) + 1
    return counts


async def import_project_backup_payload(
    *,
    archive: zipfile.ZipFile,
    payload: dict,
    db: AsyncSession,
    current_user: Any,
    mode: str,
    can_access_group: Callable[[str, str], bool],
    target_project: models.Project | None = None,
) -> dict:
    """Import one project backup payload into a new or existing project."""
    source_project = payload["project"]
    if target_project is None:
        target_group = source_project.get("meta_group_id") or ""
        if not can_access_group(current_user.email, target_group):
            raise ImportAccessError(
                f"User '{current_user.email}' cannot import project into group "
                f"'{target_group}'."
            )
    else:
        target_group = target_project.meta_group_id
        if not can_access_group(current_user.email, target_group):
            raise ImportAccessError(
                f"User '{current_user.email}' cannot import into project "
                f"'{target_project.id}'."
            )

    source_user_by_id = {
        str(user.get("id")): user for user in payload.get("users", []) if user.get("id")
    }
    if target_project is None:
        project_name = await unique_import_project_name(
            db, source_project.get("name") or "Imported Project", mode
        )
        db_project = models.Project(
            name=project_name,
            description=source_project.get("description") or "",
            meta_group_id=target_group,
            project_type=source_project.get("project_type") or "PT1",
            created_by=current_user.email,
            is_archived=bool(source_project.get("is_archived", False)),
            archived_at=None,
        )
        db.add(db_project)
        await db.flush()
    else:
        db_project = target_project
        if mode == "overwrite_active":
            await clear_project_import_data(db, db_project.id)
            db_project.project_type = (
                source_project.get("project_type") or db_project.project_type
            )
            db_project.description = (
                source_project.get("description") or db_project.description
            )
            await db.flush()

    filename_counts = await existing_filename_counts(db, db_project.id)
    group_identifier_counts = await existing_value_counts(
        db, models.ImageGroup, "identifier", db_project.id
    )
    metadata_key_counts = await existing_value_counts(
        db, models.ProjectMetadata, "key", db_project.id
    )
    batch_name_counts = await existing_value_counts(
        db, models.InspectionBatch, "name", db_project.id
    )
    part_serial_counts = await existing_value_counts(
        db, models.InspectionPart, "serial_number", db_project.id
    )

    group_map: dict[str, uuid.UUID] = {}
    for source_group in payload.get("image_groups", []):
        identifier = export_bundle_service.dedupe_import_filename(
            source_group.get("identifier") or "imported", group_identifier_counts
        )
        db_group = models.ImageGroup(
            project_id=db_project.id,
            identifier=identifier,
            display_name=source_group.get("display_name") or None,
        )
        db.add(db_group)
        await db.flush()
        group_map[str(source_group.get("id"))] = db_group.id

    for source_metadata in payload.get("project_metadata", []):
        key = export_bundle_service.dedupe_import_filename(
            source_metadata.get("key") or "imported.metadata", metadata_key_counts
        )
        db.add(
            models.ProjectMetadata(
                project_id=db_project.id,
                key=key,
                value=source_metadata.get("value_json"),
            )
        )

    batch_map: dict[str, uuid.UUID] = {}
    for source_batch in payload.get("batches", []):
        batch_name = export_bundle_service.dedupe_import_filename(
            source_batch.get("name") or "Imported Batch", batch_name_counts
        )
        db_batch = models.InspectionBatch(
            project_id=db_project.id,
            name=batch_name,
            description=source_batch.get("description") or None,
            owner=source_batch.get("owner") or None,
            status=source_batch.get("status") or "not_started",
        )
        db.add(db_batch)
        await db.flush()
        batch_map[str(source_batch.get("id"))] = db_batch.id

    part_map: dict[str, uuid.UUID] = {}
    for source_part in payload.get("parts", []):
        serial_number = export_bundle_service.dedupe_import_filename(
            source_part.get("serial_number") or str(uuid.uuid4()), part_serial_counts
        )
        db_part = models.InspectionPart(
            project_id=db_project.id,
            batch_id=batch_map.get(str(source_part.get("batch_id"))),
            serial_number=serial_number,
            display_name=source_part.get("display_name") or None,
            review_state=source_part.get("review_state") or "unreviewed",
            metadata_json=source_part.get("metadata_json")
            if isinstance(source_part.get("metadata_json"), dict)
            else {},
        )
        db.add(db_part)
        await db.flush()
        part_map[str(source_part.get("id"))] = db_part.id

    image_map: dict[str, uuid.UUID] = {}
    files_uploaded = 0
    missing_files = 0
    archive_names = set(archive.namelist())
    for source_image in payload.get("images", []):
        new_image_id = uuid.uuid4()
        source_filename = source_image.get("filename") or f"{new_image_id}.bin"
        filename = export_bundle_service.dedupe_import_filename(
            source_filename, filename_counts
        )
        object_storage_key = f"{db_project.id}/{new_image_id}/{filename}"
        archive_path = source_image.get("archive_path") or ""
        artifact_present = bool(archive_path and archive_path in archive_names)
        if artifact_present:
            artifact_bytes = archive.read(archive_path)
            if export_storage_service.storage_enabled():
                if export_storage_service.write_storage_object_bytes_sync(
                    object_storage_key, artifact_bytes, source_image.get("content_type")
                ):
                    files_uploaded += 1
                else:
                    missing_files += 1
            else:
                # Test/offline mode: preserve DB state while marking that storage
                # was not written.
                missing_files += 1
        else:
            missing_files += 1
        metadata = (
            source_image.get("metadata_json")
            if isinstance(source_image.get("metadata_json"), dict)
            else {}
        )
        metadata = {
            **metadata,
            "source_backup": {
                "project_id": source_project.get("id"),
                "image_id": source_image.get("image_id"),
                "artifact_present": artifact_present,
                "original_filename": source_filename,
                "duplicate_filename_tagged": filename != source_filename,
            },
        }
        uploader = await ensure_import_user(
            db, source_image.get("uploader_id"), source_user_by_id, current_user
        )
        db_image = models.DataInstance(
            id=new_image_id,
            project_id=db_project.id,
            group_id=group_map.get(str(source_image.get("group_id"))),
            filename=filename,
            object_storage_key=object_storage_key,
            content_type=source_image.get("content_type") or None,
            size_bytes=source_image.get("size_bytes"),
            metadata_json=metadata,
            uploaded_by_user_id=source_image.get("uploaded_by") or uploader.email,
            uploader_id=uploader.id,
        )
        db.add(db_image)
        image_map[str(source_image.get("image_id"))] = new_image_id

    class_map: dict[str, uuid.UUID] = {}
    for source_class in payload.get("image_classes", []):
        db_class = models.ImageClass(
            project_id=db_project.id,
            name=source_class.get("name") or "Imported Class",
            description=source_class.get("description") or None,
        )
        db.add(db_class)
        await db.flush()
        class_map[str(source_class.get("id"))] = db_class.id

    for source_classification in payload.get("classifications", []):
        image_id = image_map.get(str(source_classification.get("image_id")))
        class_id = class_map.get(str(source_classification.get("class_id")))
        if not image_id or not class_id:
            continue
        actor = await ensure_import_user(
            db,
            source_classification.get("created_by_id"),
            source_user_by_id,
            current_user,
        )
        db.add(
            models.ImageClassification(
                image_id=image_id, class_id=class_id, created_by_id=actor.id
            )
        )

    for source_comment in payload.get("comments", []):
        image_id = image_map.get(str(source_comment.get("image_id")))
        if not image_id:
            continue
        author = await ensure_import_user(
            db, source_comment.get("author_id"), source_user_by_id, current_user
        )
        db.add(
            models.ImageComment(
                image_id=image_id,
                author_id=author.id,
                text=source_comment.get("text") or "",
            )
        )

    for source_review in payload.get("reviews", []):
        image_id = image_map.get(str(source_review.get("image_id")))
        if not image_id:
            continue
        reviewer = await ensure_import_user(
            db, source_review.get("reviewer_id"), source_user_by_id, current_user
        )
        db.add(
            models.ImageReview(
                image_id=image_id,
                project_id=db_project.id,
                reviewer_id=reviewer.id,
                status=source_review.get("status") or "pass",
                notes=source_review.get("notes"),
            )
        )

    analysis_map: dict[str, uuid.UUID] = {}
    for source_analysis in payload.get("ml_analyses", []):
        image_id = image_map.get(str(source_analysis.get("image_id")))
        if not image_id:
            continue
        requester = await ensure_import_user(
            db, source_analysis.get("requested_by_id"), source_user_by_id, current_user
        )
        db_analysis = models.MLAnalysis(
            image_id=image_id,
            model_name=source_analysis.get("model_name") or "imported_model",
            model_version=source_analysis.get("model_version") or "unknown",
            status=source_analysis.get("status") or "completed",
            error_message=source_analysis.get("error_message"),
            parameters=source_analysis.get("parameters"),
            provenance=source_analysis.get("provenance"),
            requested_by_id=requester.id,
            external_job_id=None,
            priority=source_analysis.get("priority") or 0,
        )
        db.add(db_analysis)
        await db.flush()
        analysis_map[str(source_analysis.get("id"))] = db_analysis.id

    for source_annotation in payload.get("ml_annotations", []):
        analysis_id = analysis_map.get(str(source_annotation.get("analysis_id")))
        if not analysis_id:
            continue
        db.add(
            models.MLAnnotation(
                analysis_id=analysis_id,
                annotation_type=source_annotation.get("annotation_type")
                or "classification",
                class_name=source_annotation.get("class_name"),
                confidence=source_annotation.get("confidence"),
                data=source_annotation.get("data")
                if isinstance(source_annotation.get("data"), dict)
                else {},
                storage_path=source_annotation.get("storage_path"),
                ordering=source_annotation.get("ordering"),
            )
        )

    await db.commit()
    cache_manager.invalidate_project_images(db_project.id)
    return {
        "source_project_id": source_project.get("id"),
        "new_project_id": str(db_project.id),
        "name": db_project.name,
        "images_created": len(image_map),
        "files_uploaded": files_uploaded,
        "missing_files": missing_files,
    }
