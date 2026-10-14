"""Analyze input-source discovery helpers."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from analyze_toolbox import WorkflowGraph, WorkflowInputSource
from analyze_toolbox.image_decode import is_supported_analyze_source_filename
from core import models
from repositories import inspection as inspection_repository
from schemas.analyze import (
    AnalyzeImageSourceRecord,
    AnalyzeInputSourceResponse,
    AnalyzePartSourceRecord,
)
from services.analyze import execution as analyze_execution_service
from services.analyze import overlays as analyze_overlay_service


def source_images_for_part(part: models.InspectionPart) -> list[dict[str, Any]]:
    """Return non-deleted source image records referenced by an inspection part."""
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    source_images, _analysis_outputs = (
        analyze_overlay_service.split_source_and_analysis_records(metadata)
    )
    return [
        record
        for record in source_images
        if isinstance(record, dict)
        and not analyze_overlay_service.is_overlay_delete_candidate(record)
    ]


async def load_default_part_images(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> AnalyzeInputSourceResponse:
    """Load Analyze input image candidates from inspection part metadata."""
    parts = await inspection_repository.list_inspection_parts(
        db=db, project_id=project_id
    )
    image_ids = set()
    filenames = set()
    part_sources: dict[uuid.UUID, list[dict[str, Any]]] = {}

    for part in parts:
        records = source_images_for_part(part)
        part_sources[part.id] = records
        for record in records:
            record_image_id = analyze_execution_service.safe_uuid(
                record.get("image_id")
            )
            if record_image_id:
                image_ids.add(record_image_id)
            filename = str(record.get("filename") or "").strip()
            if filename:
                filenames.add(filename)

    image_lookup: dict[str, models.DataInstance] = {}
    if image_ids or filenames:
        conditions = [
            models.DataInstance.project_id == project_id,
            models.DataInstance.deleted_at.is_(None),
        ]
        image_filters = []
        if image_ids:
            image_filters.append(models.DataInstance.id.in_(image_ids))
        if filenames:
            image_filters.append(models.DataInstance.filename.in_(filenames))
        result = await db.execute(
            select(models.DataInstance)
            .where(*conditions)
            .where(
                image_filters[0]
                if len(image_filters) == 1
                else image_filters[0] | image_filters[1]
            )
        )
        for image in result.scalars().all():
            image_lookup[str(image.id)] = image
            image_lookup[image.filename] = image

    deduped_images: dict[str, AnalyzeImageSourceRecord] = {}
    part_records: list[AnalyzePartSourceRecord] = []

    for part in parts:
        image_count = 0
        for record in part_sources.get(part.id, []):
            filename = str(record.get("filename") or "").strip()
            record_image_id = analyze_execution_service.safe_uuid(
                record.get("image_id")
            )
            image = image_lookup.get(str(record_image_id)) if record_image_id else None
            image = image or image_lookup.get(filename)
            if not image and record_image_id:
                continue
            if not image:
                continue
            if not is_supported_analyze_source_filename(image.filename):
                continue
            image_count += 1
            image_metadata = (
                image.metadata_json if isinstance(image.metadata_json, dict) else {}
            )
            source_key = str(image.id)
            deduped_images[source_key] = AnalyzeImageSourceRecord(
                image_id=image.id,
                filename=image.filename,
                part_id=part.id,
                part_serial_number=part.serial_number,
                part_display_name=part.display_name,
                modality=record.get("modality") or image_metadata.get("modality"),
                side=record.get("side") or image_metadata.get("side"),
                overlay=bool(record.get("overlay") or image_metadata.get("overlay")),
                slice_axis=record.get("slice_axis") or image_metadata.get("slice_axis"),
                slice_index=record.get("slice_index")
                if record.get("slice_index") is not None
                else image_metadata.get("slice_index"),
                content_type=image.content_type,
                size_bytes=image.size_bytes,
                metadata=record,
            )
        part_records.append(
            AnalyzePartSourceRecord(
                part_id=part.id,
                serial_number=part.serial_number,
                display_name=part.display_name,
                image_count=image_count,
            )
        )

    images = sorted(
        deduped_images.values(),
        key=lambda item: (
            item.part_serial_number,
            item.slice_index is None,
            item.slice_index if item.slice_index is not None else 0,
            item.filename,
        ),
    )
    return AnalyzeInputSourceResponse(
        project_id=project_id,
        source=WorkflowInputSource(
            project_id=project_id,
            image_count=len(images),
            part_count=len(parts),
        ),
        parts=part_records,
        images=images,
    )


async def workflow_with_server_source(
    *,
    project_id: uuid.UUID,
    workflow: WorkflowGraph,
    db: AsyncSession,
    example_image_selection_source_id: str,
) -> WorkflowGraph:
    """Return a workflow with its source counts resolved from server data."""
    if workflow.source.project_id and workflow.source.project_id != project_id:
        raise ValueError("Workflow source project_id does not match route project_id")
    input_source = await load_default_part_images(db, project_id)
    server_source = input_source.source
    if workflow.source.kind == "manual_selection":
        selected_image_ids = set(workflow.source.selected_image_ids)
        if workflow.source.example_image_id:
            selected_image_ids.add(workflow.source.example_image_id)
        selected_part_ids = (
            set()
            if workflow.source.id == example_image_selection_source_id
            else set(workflow.source.selected_part_ids)
        )
        selected_images = [
            image
            for image in input_source.images
            if (image.image_id and image.image_id in selected_image_ids)
            or image.part_id in selected_part_ids
        ]
        selected_parts = {image.part_id for image in selected_images}
        server_source = workflow.source.model_copy(
            update={
                "project_id": project_id,
                "image_count": len(selected_images),
                "part_count": len(selected_parts),
            }
        )
    return workflow.model_copy(update={"source": server_source})
