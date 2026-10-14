import hashlib
import json
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from metadata.nsipro_fields import NsiproFieldLimitError, NsiproMetadataSource
from repositories import inspection as inspection_repository
from repositories import project_metadata as metadata_repository
from schemas import inspection_parts as inspection_part_schemas
from schemas import users as user_schemas
from services.errors import UnprocessableError
from services.inspection import nsipro_field_rows, nsipro_payloads, part_ingest
from services.inspection.ingest_metadata import merge_existing_part_ingest_metadata
from services.inspection.nsipro_payloads import get_nsipro_parser


async def _create_project(db: AsyncSession, *, name: str) -> models.Project:
    project = models.Project(
        name=name,
        description="bulk ingest transaction test",
        meta_group_id=f"{name}-group",
        created_by="transaction-test@example.com",
        project_type="PT1",
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


def _test_user() -> user_schemas.User:
    return user_schemas.User(
        email="transaction-test@example.com", username="transaction-test"
    )


async def _project_row_count(db: AsyncSession, model, project_id) -> int:
    result = await db.execute(
        select(func.count()).select_from(model).where(model.project_id == project_id)
    )
    return result.scalar_one()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@pytest.mark.asyncio
async def test_bulk_existing_part_lookup_uses_deterministic_row_locks():
    db = AsyncMock(spec=AsyncSession)
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db.execute.return_value = result

    await inspection_repository.list_inspection_parts_for_update_by_serial_numbers(
        db=db,
        project_id=uuid.uuid4(),
        serial_numbers=["SN-B", "SN-A"],
    )

    statement = db.execute.await_args.args[0]
    sql = " ".join(str(statement.compile(dialect=postgresql.dialect())).split())
    assert "FOR UPDATE" in sql
    assert (
        "ORDER BY inspection_parts.serial_number ASC, inspection_parts.id ASC"
    ) in sql


def test_metadata_field_cache_distinguishes_changed_content_for_one_source_ref():
    source_ref = "associated_upload_metadata:mutable.nsipro"
    cache = {}

    first = nsipro_field_rows.metadata_field_values_for_sources(
        [
            NsiproMetadataSource(
                source_ref=source_ref,
                source_filename="mutable.nsipro",
                metadata={"capture": {"operator": "alice"}},
            )
        ],
        field_cache=cache,
    )
    second = nsipro_field_rows.metadata_field_values_for_sources(
        [
            NsiproMetadataSource(
                source_ref=source_ref,
                source_filename="mutable.nsipro",
                metadata={"capture": {"operator": "bob"}},
            )
        ],
        field_cache=cache,
    )

    assert first[0]["value_text"] == "alice"
    assert second[0]["value_text"] == "bob"
    assert len(cache) == 2


def test_metadata_field_values_enforce_per_part_aggregate_limit():
    source = NsiproMetadataSource(
        source_ref="associated_upload_metadata:bounded.nsipro",
        source_filename="bounded.nsipro",
        metadata={"first": 1, "second": 2},
    )

    with (
        patch.object(
            nsipro_field_rows,
            "MAX_NSIPRO_FIELD_ROWS_PER_PART",
            1,
        ),
        pytest.raises(NsiproFieldLimitError, match="for one part"),
    ):
        nsipro_field_rows.metadata_field_values_for_sources(
            [source],
            field_cache={},
        )


def test_metadata_field_cache_defers_deep_tree_errors_to_iterative_flattener():
    metadata = {}
    cursor = metadata
    for _ in range(1_100):
        child = {}
        cursor["nested"] = child
        cursor = child

    with pytest.raises(NsiproFieldLimitError, match="maximum depth"):
        nsipro_field_rows.metadata_field_values_for_sources(
            [
                NsiproMetadataSource(
                    source_ref="associated_upload_metadata:deep.nsipro",
                    source_filename="deep.nsipro",
                    metadata=metadata,
                )
            ],
            field_cache={},
        )


def test_source_image_merge_keeps_different_ids_with_the_same_filename_distinct():
    first_image_id = "11111111-1111-1111-1111-111111111111"
    second_image_id = "22222222-2222-2222-2222-222222222222"

    patch = merge_existing_part_ingest_metadata(
        {
            "source_images": [
                {
                    "image_id": first_image_id,
                    "filename": "shared-name.png",
                    "note": "first image",
                }
            ]
        },
        {
            "source_images": [
                {
                    "image_id": second_image_id,
                    "filename": "shared-name.png",
                    "note": "second image",
                }
            ]
        },
    )

    assert patch["source_images"] == [
        {
            "image_id": first_image_id,
            "filename": "shared-name.png",
            "note": "first image",
        },
        {
            "image_id": second_image_id,
            "filename": "shared-name.png",
            "note": "second image",
        },
    ]


def test_source_image_merge_uses_image_id_across_filename_changes():
    image_id = "11111111-1111-1111-1111-111111111111"

    patch = merge_existing_part_ingest_metadata(
        {
            "source_images": [
                {
                    "image_id": image_id,
                    "filename": "before-rename.png",
                    "note": "preserved",
                }
            ]
        },
        {
            "source_images": [
                {
                    "image_id": image_id,
                    "filename": "after-rename.png",
                    "exposure": 2,
                }
            ]
        },
    )

    assert patch["source_images"] == [
        {
            "image_id": image_id,
            "filename": "after-rename.png",
            "note": "preserved",
            "exposure": 2,
        }
    ]


def test_source_image_merge_falls_back_to_filename_when_a_record_lacks_an_id():
    image_id = "11111111-1111-1111-1111-111111111111"

    patch = merge_existing_part_ingest_metadata(
        {
            "source_images": [
                {
                    "filename": "legacy.png",
                    "legacy_note": "preserved",
                }
            ]
        },
        {
            "source_images": [
                {
                    "image_id": image_id,
                    "filename": "legacy.png",
                    "side": "front",
                },
                {
                    "filename": "legacy.png",
                    "modality": "visible",
                },
            ]
        },
    )

    assert patch["source_images"] == [
        {
            "image_id": image_id,
            "filename": "legacy.png",
            "legacy_note": "preserved",
            "side": "front",
            "modality": "visible",
        }
    ]


@pytest.mark.asyncio
async def test_bulk_ingest_commits_two_thousand_parts_once(db_session: AsyncSession):
    project = await _create_project(db_session, name="bulk-two-thousand")
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        batches=[
            inspection_part_schemas.InspectionIngestBatchRecord(
                name=f"batch-{batch_index}",
                parts=[
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number=f"SN-{batch_index:02d}-{part_index:04d}",
                        display_name=f"Part {batch_index}-{part_index}",
                    )
                    for part_index in range(1000)
                ],
            )
            for batch_index in range(2)
        ]
    )

    with (
        patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy,
        patch.object(db_session, "flush", wraps=db_session.flush) as flush_spy,
    ):
        result = await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert commit_spy.await_count == 1
    # Explicit batch UUIDs let the unit of work persist all batches and all
    # 2,000 parts in a single ordered flush.
    assert flush_spy.await_count == 1
    assert result["counters"] == {
        "batches_received": 2,
        "parts_received": 2000,
        "batches_created": 2,
        "parts_created": 2000,
        "parts_skipped_existing": 0,
        "parts_skipped_discrepancy": 0,
    }
    assert await _project_row_count(db_session, models.InspectionBatch, project.id) == 2
    assert (
        await _project_row_count(db_session, models.InspectionPart, project.id) == 2000
    )
    assert (
        await _project_row_count(
            db_session,
            models.InspectionPartMetadataField,
            project.id,
        )
        == 0
    )


@pytest.mark.asyncio
async def test_bulk_ingest_many_distinct_batches_has_bounded_database_work(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-many-distinct-batches")
    existing_batch = await inspection_repository.create_inspection_batch(
        db=db_session,
        project_id=project.id,
        batch=inspection_part_schemas.InspectionBatchCreate(
            name="existing-batch", description="keep existing"
        ),
    )
    new_batch_count = 500
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        batches=[
            inspection_part_schemas.InspectionIngestBatchRecord(
                name="existing-batch",
                description="must not replace existing",
                parts=[
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number="SN-EXISTING-BATCH"
                    )
                ],
            ),
            *[
                inspection_part_schemas.InspectionIngestBatchRecord(
                    name=f"batch-{batch_index:04d}",
                    description=f"Batch {batch_index}",
                    parts=[
                        inspection_part_schemas.InspectionIngestPartRecord(
                            serial_number=f"SN-BATCH-{batch_index:04d}",
                        )
                    ],
                )
                for batch_index in range(new_batch_count)
            ],
            # Repeating a name must reuse the first staged batch, just as it
            # did when batches were flushed one at a time.
            inspection_part_schemas.InspectionIngestBatchRecord(
                name="batch-0000",
                description="must not replace first payload description",
                parts=[
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number="SN-BATCH-0000-SECOND"
                    )
                ],
            ),
        ]
    )

    with (
        patch.object(db_session, "execute", wraps=db_session.execute) as execute_spy,
        patch.object(db_session, "flush", wraps=db_session.flush) as flush_spy,
        patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy,
    ):
        result = await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    # Configuration, existing batches, and existing parts are each loaded
    # once. Counts do not grow with the number of distinct incoming batches.
    assert execute_spy.await_count == 3
    assert flush_spy.await_count == 1
    assert commit_spy.await_count == 1
    assert result["counters"] == {
        "batches_received": new_batch_count + 2,
        "parts_received": new_batch_count + 2,
        "batches_created": new_batch_count,
        "parts_created": new_batch_count + 2,
        "parts_skipped_existing": 0,
        "parts_skipped_discrepancy": 0,
    }

    stored_associations = dict(
        (
            await db_session.execute(
                select(models.InspectionPart.serial_number, models.InspectionBatch.name)
                .join(
                    models.InspectionBatch,
                    models.InspectionPart.batch_id == models.InspectionBatch.id,
                )
                .where(models.InspectionPart.project_id == project.id)
            )
        ).all()
    )
    assert stored_associations["SN-EXISTING-BATCH"] == "existing-batch"
    assert stored_associations["SN-BATCH-0000"] == "batch-0000"
    assert stored_associations["SN-BATCH-0000-SECOND"] == "batch-0000"
    assert stored_associations["SN-BATCH-0499"] == "batch-0499"

    stored_batches = {
        batch.name: batch
        for batch in (
            await db_session.execute(
                select(models.InspectionBatch).where(
                    models.InspectionBatch.project_id == project.id
                )
            )
        ).scalars()
    }
    assert len(stored_batches) == new_batch_count + 1
    assert stored_batches["existing-batch"].id == existing_batch.id
    assert stored_batches["existing-batch"].description == "keep existing"
    assert stored_batches["batch-0000"].description == "Batch 0"


@pytest.mark.asyncio
async def test_bulk_ingest_stores_one_shared_payload_for_two_thousand_source_references(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-shared-metadata-reference")
    metadata_key = "associated_upload_metadata:shared.nsipro"
    large_warning = "W" * (64 * 1024)
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "shared.nsipro",
                "metadata": {"capture": {"operator": "shared-operator"}},
                "warnings": [large_warning],
            },
        )
    )
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-REF-2000-SOURCES",
                metadata={
                    "source_images": [
                        {
                            "image_id": f"00000000-0000-0000-0000-{source_index:012d}",
                            "filename": f"view-{source_index:04d}.png",
                            "associated_metadata_ref": metadata_key,
                        }
                        for source_index in range(2000)
                    ],
                },
            )
        ]
    )

    project_metadata_selects = 0

    def count_project_metadata_selects(
        _conn, _cursor, statement, _parameters, _context, _executemany
    ):
        nonlocal project_metadata_selects
        normalized_statement = " ".join(statement.lower().split())
        if (
            normalized_statement.startswith("select ")
            and " from project_metadata " in normalized_statement
        ):
            project_metadata_selects += 1

    sync_engine = db_session.bind.sync_engine
    event.listen(sync_engine, "before_cursor_execute", count_project_metadata_selects)
    try:
        with patch.object(
            nsipro_payloads,
            "normalize_nsipro_bundle_payload",
            wraps=nsipro_payloads.normalize_nsipro_bundle_payload,
        ) as normalize_payload_spy:
            result = await part_ingest.bulk_ingest_project_parts(
                project_id=project.id,
                payload=payload,
                db=db_session,
                user_email=_test_user().email,
                project_type=project.project_type,
            )
    finally:
        event.remove(
            sync_engine, "before_cursor_execute", count_project_metadata_selects
        )

    # One lookup loads project parser configuration; one IN query preloads all
    # referenced metadata. Per-part and per-source-image normalization is then
    # served from the request-local mapping.
    assert project_metadata_selects == 2
    assert normalize_payload_spy.call_count == 1
    assert result["counters"]["parts_created"] == 1
    stored_part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-REF-2000-SOURCES",
            )
        )
    ).scalar_one()
    stored_metadata = stored_part.metadata_json
    assert stored_metadata["nsipro_payload_ref"] == metadata_key
    assert stored_metadata["nsipro_metadata"] == {
        "capture": {"operator": "shared-operator"}
    }
    assert stored_metadata["nsipro_payload"]["warnings"] == [large_warning]
    assert "nsipro_payloads_by_ref" not in stored_metadata
    assert len(stored_metadata["source_images"]) == 2000
    assert all(
        record["associated_metadata_ref"] == metadata_key
        and record["nsipro_payload_ref"] == metadata_key
        and "nsipro_payload" not in record
        for record in stored_metadata["source_images"]
    )

    payloads_by_ref = {
        stored_metadata["nsipro_payload_ref"]: stored_metadata["nsipro_payload"],
        **stored_metadata.get("nsipro_payloads_by_ref", {}),
    }
    assert {
        record["nsipro_payload_ref"] for record in stored_metadata["source_images"]
    } <= payloads_by_ref.keys()
    compact_json = json.dumps(stored_metadata, separators=(",", ":"))
    assert compact_json.count(large_warning) == 1
    assert len(compact_json) < 1_000_000


@pytest.mark.asyncio
async def test_bulk_ingest_flattens_one_shared_source_once_for_two_thousand_parts(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-shared-field-template")
    metadata_key = "associated_upload_metadata:shared-fields.nsipro"
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "shared-fields.nsipro",
                "metadata": {"capture": {"operator": "shared"}},
            },
        )
    )
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number=f"SN-SHARED-FIELDS-{index:04d}",
                metadata={"associated_metadata_ref": metadata_key},
            )
            for index in range(2_000)
        ]
    )

    with (
        patch.object(
            nsipro_field_rows,
            "flatten_nsipro_metadata",
            wraps=nsipro_field_rows.flatten_nsipro_metadata,
        ) as flatten_spy,
        patch.object(db_session, "flush", wraps=db_session.flush) as flush_spy,
        patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy,
    ):
        result = await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert result["counters"]["parts_created"] == 2_000
    assert flatten_spy.call_count == 1
    assert flush_spy.await_count == 1
    assert commit_spy.await_count == 1
    assert (
        await _project_row_count(
            db_session,
            models.InspectionPartMetadataField,
            project.id,
        )
        == 2_000
    )


@pytest.mark.asyncio
async def test_bulk_ingest_stores_each_distinct_nsipro_reference_once(
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, name="bulk-distinct-metadata-references"
    )
    primary_key = "associated_upload_metadata:primary.nsipro"
    secondary_key = "associated_upload_metadata:secondary.nsipro"
    primary_warning = "primary-payload-marker"
    secondary_warning = "secondary-payload-marker"
    db_session.add_all(
        [
            models.ProjectMetadata(
                project_id=project.id,
                key=primary_key,
                value={
                    "file_type": "nsipro",
                    "source_filename": "primary.nsipro",
                    "metadata": {"capture": {"operator": "primary"}},
                    "warnings": [primary_warning],
                },
            ),
            models.ProjectMetadata(
                project_id=project.id,
                key=secondary_key,
                value={
                    "file_type": "nsipro",
                    "source_filename": "secondary.nsipro",
                    "metadata": {"capture": {"operator": "secondary"}},
                    "warnings": [secondary_warning],
                },
            ),
        ]
    )
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-MULTI-REF",
                metadata={
                    "source_images": [
                        {
                            "filename": "primary-a.png",
                            "associated_metadata_ref": primary_key,
                        },
                        {
                            "filename": "secondary-a.png",
                            "associated_metadata_ref": secondary_key,
                        },
                        {
                            "filename": "secondary-b.png",
                            "associated_metadata_ref": secondary_key,
                        },
                        {
                            "filename": "primary-b.png",
                            "associated_metadata_ref": primary_key,
                        },
                    ]
                },
            )
        ]
    )

    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    stored_part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-MULTI-REF",
            )
        )
    ).scalar_one()
    metadata = stored_part.metadata_json
    assert metadata["nsipro_payload_ref"] == primary_key
    assert metadata["nsipro_payload"]["warnings"] == [primary_warning]
    assert metadata["nsipro_payloads_by_ref"] == {
        secondary_key: {
            "parser": "nsipro-stored-metadata",
            "parser_id": "default",
            "parser_version": get_nsipro_parser("default").version,
            "parser_hash": get_nsipro_parser("default").parser_hash,
            "source_filename": "secondary.nsipro",
            "content_hash": None,
            "metadata": {"capture": {"operator": "secondary"}},
            "warnings": [secondary_warning],
        }
    }
    assert [record["nsipro_payload_ref"] for record in metadata["source_images"]] == [
        primary_key,
        secondary_key,
        secondary_key,
        primary_key,
    ]
    assert all("nsipro_payload" not in record for record in metadata["source_images"])
    compact_json = json.dumps(metadata, separators=(",", ":"))
    assert compact_json.count(primary_warning) == 1
    assert compact_json.count(secondary_warning) == 1
    field_rows = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField)
                .where(models.InspectionPartMetadataField.part_id == stored_part.id)
                .order_by(
                    models.InspectionPartMetadataField.source_ref,
                    models.InspectionPartMetadataField.ordinal,
                )
            )
        )
        .scalars()
        .all()
    )
    assert [
        (field.source_ref, field.field_path, field.value_text) for field in field_rows
    ] == [
        (primary_key, "/capture/operator", "primary"),
        (secondary_key, "/capture/operator", "secondary"),
    ]


@pytest.mark.asyncio
async def test_bulk_ingest_preserves_stored_legacy_inline_source_payload(
    db_session: AsyncSession,
):
    project = await _create_project(
        db_session, name="bulk-legacy-inline-source-payload"
    )
    metadata_key = "associated_upload_metadata:canonical.nsipro"
    legacy_payload = {
        "parser_id": "legacy-inline",
        "metadata": {"capture": {"operator": "legacy"}},
    }
    existing = await inspection_repository.create_inspection_part(
        db=db_session,
        project_id=project.id,
        part=inspection_part_schemas.InspectionPartCreate(
            serial_number="SN-LEGACY-INLINE",
            metadata={
                "source_images": [
                    {
                        "image_id": "11111111-1111-1111-1111-111111111111",
                        "filename": "legacy.png",
                        "nsipro_payload": legacy_payload,
                    }
                ]
            },
        ),
    )
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "canonical.nsipro",
                "metadata": {"capture": {"operator": "canonical"}},
            },
        )
    )
    await db_session.commit()

    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=inspection_part_schemas.InspectionBulkIngestPayload(
            unassigned_parts=[
                inspection_part_schemas.InspectionIngestPartRecord(
                    serial_number="SN-LEGACY-INLINE",
                    metadata={
                        "source_images": [
                            {
                                "image_id": "11111111-1111-1111-1111-111111111111",
                                "filename": "legacy.png",
                                "associated_metadata_ref": metadata_key,
                            }
                        ]
                    },
                )
            ]
        ),
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    await db_session.refresh(existing)
    source = existing.metadata_json["source_images"][0]
    assert source["nsipro_payload"] == legacy_payload
    assert source["associated_metadata_ref"] == metadata_key
    assert source["nsipro_payload_ref"] == metadata_key
    assert existing.metadata_json["nsipro_payload_ref"] == metadata_key
    assert existing.metadata_json["nsipro_payload"]["metadata"] == {
        "capture": {"operator": "canonical"}
    }
    indexed_fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField).where(
                    models.InspectionPartMetadataField.part_id == existing.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert [
        (field.source_ref, field.field_path, field.value_text)
        for field in indexed_fields
    ] == [
        (metadata_key, "/capture/operator", "canonical"),
    ]


@pytest.mark.asyncio
async def test_bulk_ingest_does_not_index_unresolved_caller_supplied_payloads(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-untrusted-inline")
    caller_ref = "associated_upload_metadata:caller-only.nsipro"
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-UNTRUSTED-INLINE",
                metadata={
                    "nsipro_payload_ref": caller_ref,
                    "nsipro_payload": {
                        "source_filename": "caller-only.nsipro",
                        "metadata": {"capture": {"operator": "attacker"}},
                    },
                    "associated_metadata_refs": [caller_ref],
                    "nsipro_metadata_sources": [
                        {
                            "key": caller_ref,
                            "metadata": {"capture": {"operator": "attacker"}},
                        }
                    ],
                },
            )
        ]
    )

    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-UNTRUSTED-INLINE",
            )
        )
    ).scalar_one()
    field_count = (
        await db_session.execute(
            select(func.count())
            .select_from(models.InspectionPartMetadataField)
            .where(models.InspectionPartMetadataField.part_id == part.id)
        )
    ).scalar_one()

    assert part.metadata_json["nsipro_payload_ref"] == caller_ref
    assert field_count == 0


@pytest.mark.asyncio
async def test_bulk_ingest_strict_nsipro_contract_still_rejects_mismatch(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-strict-reference-mismatch")
    project_id = project.id
    metadata_key = "associated_upload_metadata:strict.nsipro"
    db_session.add_all(
        [
            models.ProjectMetadata(
                project_id=project.id,
                key="inspection_workbench.project_configuration",
                value={
                    "metadata_parsers": {
                        "nsipro": {
                            "parser_id": "default",
                            "strict": True,
                        }
                    }
                },
            ),
            models.ProjectMetadata(
                project_id=project.id,
                key=metadata_key,
                value={
                    "file_type": "nsipro",
                    "source_filename": "strict.nsipro",
                    "parser_id": "wrong-parser",
                    "metadata": {"capture": {"operator": "strict"}},
                },
            ),
        ]
    )
    await db_session.commit()

    with pytest.raises(
        UnprocessableError, match="parser contract mismatch"
    ) as exc_info:
        await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=inspection_part_schemas.InspectionBulkIngestPayload(
                unassigned_parts=[
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number="SN-STRICT-MISMATCH",
                        metadata={
                            "source_images": [
                                {
                                    "filename": "strict.png",
                                    "associated_metadata_ref": metadata_key,
                                }
                            ]
                        },
                    )
                ]
            ),
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert exc_info.value.status_code == 422
    assert await _project_row_count(db_session, models.InspectionPart, project_id) == 0
    assert (
        await _project_row_count(
            db_session,
            models.InspectionPartMetadataField,
            project_id,
        )
        == 0
    )


@pytest.mark.asyncio
async def test_bulk_ingest_existing_part_metadata_merge_is_preserved(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-existing-merge")
    existing = await inspection_repository.create_inspection_part(
        db=db_session,
        project_id=project.id,
        part=inspection_part_schemas.InspectionPartCreate(
            serial_number="SN-EXISTING",
            metadata={
                "keep": "unchanged",
                "source_images": [{"filename": "front.png", "note": "keep this too"}],
            },
        ),
    )
    incoming_nsipro = {
        "parser_id": "default",
        "metadata": {"capture": {"operator": "bob"}},
    }
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-EXISTING",
                metadata={
                    "nsipro_metadata": incoming_nsipro["metadata"],
                    "nsipro_payload": incoming_nsipro,
                    "source_images": [
                        {
                            "filename": "front.png",
                            "side": "front",
                            "nsipro_payload": incoming_nsipro,
                        }
                    ],
                },
            )
        ]
    )

    with patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy:
        result = await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert commit_spy.await_count == 1
    assert result["counters"]["parts_created"] == 0
    assert result["counters"]["parts_skipped_existing"] == 1
    await db_session.refresh(existing)
    assert existing.metadata_json == {
        "keep": "unchanged",
        "nsipro_metadata": {"capture": {"operator": "bob"}},
        "nsipro_payload": incoming_nsipro,
        "source_images": [
            {
                "filename": "front.png",
                "note": "keep this too",
                "side": "front",
                "nsipro_payload": incoming_nsipro,
            }
        ],
    }


@pytest.mark.asyncio
async def test_bulk_ingest_existing_part_merges_ordinary_new_views_without_nsipro(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-existing-ordinary-views")
    front_image_id = "11111111-1111-1111-1111-111111111111"
    back_image_id = "22222222-2222-2222-2222-222222222222"
    existing = await inspection_repository.create_inspection_part(
        db=db_session,
        project_id=project.id,
        part=inspection_part_schemas.InspectionPartCreate(
            serial_number="SN-EXISTING-VIEWS",
            metadata={
                "keep": {"reviewer_note": "preserve me"},
                "source_images": [
                    {
                        "image_id": front_image_id,
                        "filename": "front-original.png",
                        "side": "front",
                        "note": "preserve this too",
                    }
                ],
            },
        ),
    )
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-EXISTING-VIEWS",
                metadata={
                    "ignored_top_level_field": "existing metadata remains authoritative",
                    "source_images": [
                        {
                            "image_id": front_image_id,
                            "filename": "front-renamed.png",
                            "exposure": 2,
                        },
                        {
                            "image_id": back_image_id,
                            "filename": "back.png",
                            "side": "back",
                        },
                        {
                            "filename": "back.png",
                            "modality": "visible",
                        },
                    ],
                },
            )
        ]
    )

    with (
        patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy,
        patch.object(
            inspection_repository,
            "get_inspection_part",
            wraps=inspection_repository.get_inspection_part,
        ) as get_part_spy,
    ):
        result = await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert commit_spy.await_count == 1
    assert get_part_spy.await_count == 0
    assert result["counters"]["parts_skipped_existing"] == 1
    await db_session.refresh(existing)
    assert existing.metadata_json == {
        "keep": {"reviewer_note": "preserve me"},
        "source_images": [
            {
                "image_id": front_image_id,
                "filename": "front-renamed.png",
                "side": "front",
                "note": "preserve this too",
                "exposure": 2,
            },
            {
                "image_id": back_image_id,
                "filename": "back.png",
                "side": "back",
                "modality": "visible",
            },
        ],
    }


@pytest.mark.asyncio
async def test_bulk_ingest_rolls_back_all_parts_and_batches_on_late_failure(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-atomic-rollback")
    project_id = project.id
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        batches=[
            inspection_part_schemas.InspectionIngestBatchRecord(
                name="batch-that-must-rollback",
                parts=[
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number="SN-FIRST"
                    ),
                    inspection_part_schemas.InspectionIngestPartRecord(
                        serial_number="SN-FAIL-LATE"
                    ),
                ],
            )
        ]
    )
    real_create_part = inspection_repository.create_inspection_part
    create_calls = 0

    async def fail_on_second_part(*args, **kwargs):
        nonlocal create_calls
        create_calls += 1
        if create_calls == 2:
            raise RuntimeError("forced late ingest failure")
        return await real_create_part(*args, **kwargs)

    with (
        patch(
            "services.inspection.part_ingest.inspection_repository.create_inspection_part",
            side_effect=fail_on_second_part,
        ),
        patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy,
        patch.object(db_session, "rollback", wraps=db_session.rollback) as rollback_spy,
        pytest.raises(RuntimeError, match="forced late ingest failure"),
    ):
        await part_ingest.bulk_ingest_project_parts(
            project_id=project_id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert commit_spy.await_count == 0
    assert rollback_spy.await_count == 1
    assert await _project_row_count(db_session, models.InspectionBatch, project_id) == 0
    assert await _project_row_count(db_session, models.InspectionPart, project_id) == 0
    assert (
        await _project_row_count(
            db_session,
            models.InspectionPartMetadataField,
            project_id,
        )
        == 0
    )


@pytest.mark.asyncio
async def test_bulk_ingest_persists_project_identifiers_in_single_transaction(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-identifier-success")
    metadata_key = "associated_upload_metadata:identifiers.nsipro"
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "identifiers.nsipro",
                "metadata": {"Project Name": "PN_123456-78 LOT_222"},
                "extracted_fields": {
                    "project_identifiers": {
                        "part-num": "PN_123456-78",
                        "lot-num": "LOT_222",
                    }
                },
            },
        )
    )
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-IDENTIFIER-SUCCESS",
                metadata={"associated_metadata_ref": metadata_key},
            )
        ]
    )

    with patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy:
        result = await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert commit_spy.await_count == 1
    assert result["counters"]["parts_created"] == 1
    raw_key = await metadata_repository.get_project_metadata_by_key(
        db_session, project.id, "part-num"
    )
    assert raw_key is None
    reserved = await metadata_repository.get_project_metadata_by_key(
        db_session,
        project.id,
        metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
    )
    assert reserved.value["identifiers"] == {
        "part-num": "PN_123456-78",
        "lot-num": "LOT_222",
    }
    assert reserved.value["conflicts"] == {}


@pytest.mark.asyncio
async def test_bulk_ingest_aggregate_field_limit_rolls_back_all_rows(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-field-limit-rollback")
    project_id = project.id
    metadata_key = "associated_upload_metadata:field-limit.nsipro"
    db_session.add(
        models.ProjectMetadata(
            project_id=project_id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "field-limit.nsipro",
                "metadata": {"operator": "shared"},
                "extracted_fields": {
                    "project_identifiers": {"part-num": "PN_ROLLBACK"}
                },
            },
        )
    )
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number=f"SN-FIELD-LIMIT-{index}",
                metadata={"associated_metadata_ref": metadata_key},
            )
            for index in range(2)
        ]
    )

    with (
        patch.object(
            nsipro_field_rows,
            "MAX_NSIPRO_FIELD_ROWS_PER_INGEST",
            1,
        ),
        pytest.raises(UnprocessableError) as exc_info,
    ):
        await part_ingest.bulk_ingest_project_parts(
            project_id=project_id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert exc_info.value.status_code == 422
    assert "for one ingest" in str(exc_info.value.detail)
    assert await _project_row_count(db_session, models.InspectionPart, project_id) == 0
    assert (
        await _project_row_count(
            db_session,
            models.InspectionPartMetadataField,
            project_id,
        )
        == 0
    )
    identifier_metadata = await metadata_repository.get_project_metadata_by_key(
        db_session,
        project_id,
        metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
    )
    assert identifier_metadata is None


@pytest.mark.asyncio
async def test_inspection_crud_defaults_still_commit_each_operation(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="crud-default-commit")

    with patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy:
        batch = await inspection_repository.create_inspection_batch(
            db=db_session,
            project_id=project.id,
            batch=inspection_part_schemas.InspectionBatchCreate(
                name="default-commit-batch"
            ),
        )
        part = await inspection_repository.create_inspection_part(
            db=db_session,
            project_id=project.id,
            part=inspection_part_schemas.InspectionPartCreate(
                batch_id=batch.id,
                serial_number="SN-DEFAULT-COMMIT",
                metadata={"original": True},
            ),
        )
        updated = await inspection_repository.update_inspection_part_metadata(
            db=db_session,
            project_id=project.id,
            part_id=part.id,
            metadata_patch={"added": True},
        )

    assert commit_spy.await_count == 3
    assert updated is not None
    assert updated.metadata_json == {"original": True, "added": True}


@pytest.mark.asyncio
async def test_bulk_ingest_materializes_distinct_typed_nsipro_fields_once(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-queryable-nsipro-fields")
    metadata_key = "associated_upload_metadata:queryable.nsipro"
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "queryable.nsipro",
                "metadata": {
                    "capture": {
                        "operator": "alice",
                        "exposure_ms": 12.5,
                        "attempts": 3,
                        "valid": True,
                        "note": None,
                        "empty": {},
                        "channels": [
                            {"name": "brightfield"},
                            {"name": "DAPI"},
                        ],
                    }
                },
            },
        )
    )
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-QUERYABLE",
                metadata={
                    "source_images": [
                        {
                            "filename": "front.png",
                            "associated_metadata_ref": metadata_key,
                        },
                        {
                            "filename": "back.png",
                            "associated_metadata_ref": metadata_key,
                        },
                    ]
                },
            )
        ]
    )

    with (
        patch.object(
            nsipro_field_rows,
            "flatten_nsipro_metadata",
            wraps=nsipro_field_rows.flatten_nsipro_metadata,
        ) as flatten_spy,
        patch.object(db_session, "flush", wraps=db_session.flush) as flush_spy,
        patch.object(db_session, "commit", wraps=db_session.commit) as commit_spy,
    ):
        await part_ingest.bulk_ingest_project_parts(
            project_id=project.id,
            payload=payload,
            db=db_session,
            user_email=_test_user().email,
            project_type=project.project_type,
        )

    assert flatten_spy.call_count == 1
    assert flush_spy.await_count == 1
    assert commit_spy.await_count == 1
    part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-QUERYABLE",
            )
        )
    ).scalar_one()
    fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField)
                .where(models.InspectionPartMetadataField.part_id == part.id)
                .order_by(models.InspectionPartMetadataField.ordinal)
            )
        )
        .scalars()
        .all()
    )

    assert len(fields) == 8
    assert {field.source_ref for field in fields} == {metadata_key}
    assert [field.field_path for field in fields] == [
        "/capture/operator",
        "/capture/exposure_ms",
        "/capture/attempts",
        "/capture/valid",
        "/capture/note",
        "/capture/empty",
        "/capture/channels/0/name",
        "/capture/channels/1/name",
    ]
    assert [field.value_type for field in fields] == [
        "string",
        "number",
        "integer",
        "boolean",
        "null",
        "object",
        "string",
        "string",
    ]

    operator_part_id = (
        await db_session.execute(
            select(models.InspectionPartMetadataField.part_id).where(
                models.InspectionPartMetadataField.project_id == project.id,
                models.InspectionPartMetadataField.field_path_hash
                == _sha256("/capture/operator"),
                models.InspectionPartMetadataField.value_text_hash == _sha256("alice"),
                models.InspectionPartMetadataField.field_path == "/capture/operator",
                models.InspectionPartMetadataField.value_text == "alice",
            )
        )
    ).scalar_one()
    numeric_part_id = (
        await db_session.execute(
            select(models.InspectionPartMetadataField.part_id).where(
                models.InspectionPartMetadataField.project_id == project.id,
                models.InspectionPartMetadataField.field_path_hash
                == _sha256("/capture/exposure_ms"),
                models.InspectionPartMetadataField.field_path == "/capture/exposure_ms",
                models.InspectionPartMetadataField.value_number > Decimal("12"),
            )
        )
    ).scalar_one()
    assert operator_part_id == part.id
    assert numeric_part_id == part.id


@pytest.mark.asyncio
async def test_bulk_reingest_replaces_changed_nsipro_fields_and_removes_stale_paths(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-replace-nsipro-fields")
    metadata_key = "associated_upload_metadata:replace.nsipro"
    project_metadata = models.ProjectMetadata(
        project_id=project.id,
        key=metadata_key,
        value={
            "file_type": "nsipro",
            "source_filename": "replace.nsipro",
            "metadata": {
                "capture": {
                    "operator": "alice",
                    "stale": "remove-me",
                }
            },
        },
    )
    db_session.add(project_metadata)
    await db_session.commit()
    payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-REPLACE-FIELDS",
                metadata={
                    "source_images": [
                        {
                            "image_id": "11111111-1111-1111-1111-111111111111",
                            "filename": "view.png",
                            "associated_metadata_ref": metadata_key,
                        }
                    ]
                },
            )
        ]
    )
    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    project_metadata.value = {
        "file_type": "nsipro",
        "source_filename": "replace.nsipro",
        "metadata": {
            "capture": {
                "operator": "bob",
                "fresh": "new-value",
            }
        },
    }
    await db_session.commit()

    result = await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    assert result["counters"]["parts_skipped_existing"] == 1
    part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-REPLACE-FIELDS",
            )
        )
    ).scalar_one()
    fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField)
                .where(models.InspectionPartMetadataField.part_id == part.id)
                .order_by(models.InspectionPartMetadataField.ordinal)
            )
        )
        .scalars()
        .all()
    )

    assert [(field.field_path, field.value_text) for field in fields] == [
        ("/capture/operator", "bob"),
        ("/capture/fresh", "new-value"),
    ]
    assert part.metadata_json["nsipro_metadata"] == {
        "capture": {
            "operator": "bob",
            "fresh": "new-value",
        }
    }


@pytest.mark.asyncio
async def test_bulk_partial_source_reingest_keeps_other_active_source_fields(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-partial-source-refresh")
    primary_key = "associated_upload_metadata:partial-primary.nsipro"
    secondary_key = "associated_upload_metadata:partial-secondary.nsipro"
    primary_metadata = models.ProjectMetadata(
        project_id=project.id,
        key=primary_key,
        value={
            "file_type": "nsipro",
            "source_filename": "partial-primary.nsipro",
            "metadata": {"capture": {"operator": "primary"}},
        },
    )
    secondary_metadata = models.ProjectMetadata(
        project_id=project.id,
        key=secondary_key,
        value={
            "file_type": "nsipro",
            "source_filename": "partial-secondary.nsipro",
            "metadata": {"capture": {"operator": "secondary"}},
        },
    )
    db_session.add_all([primary_metadata, secondary_metadata])
    await db_session.commit()
    initial_payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-PARTIAL-SOURCE-REFRESH",
                metadata={
                    "source_images": [
                        {
                            "image_id": "11111111-1111-1111-1111-111111111111",
                            "filename": "primary.png",
                            "associated_metadata_ref": primary_key,
                        },
                        {
                            "image_id": "22222222-2222-2222-2222-222222222222",
                            "filename": "secondary.png",
                            "associated_metadata_ref": secondary_key,
                        },
                    ]
                },
            )
        ]
    )
    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=initial_payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    secondary_metadata.value = {
        "file_type": "nsipro",
        "source_filename": "partial-secondary.nsipro",
        "metadata": {"capture": {"operator": "secondary-new"}},
    }
    await db_session.commit()

    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=inspection_part_schemas.InspectionBulkIngestPayload(
            unassigned_parts=[
                inspection_part_schemas.InspectionIngestPartRecord(
                    serial_number="SN-PARTIAL-SOURCE-REFRESH",
                    metadata={
                        "source_images": [
                            {
                                "image_id": "11111111-1111-1111-1111-111111111111",
                                "filename": "primary-updated.png",
                                "associated_metadata_ref": primary_key,
                            }
                        ]
                    },
                )
            ]
        ),
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-PARTIAL-SOURCE-REFRESH",
            )
        )
    ).scalar_one()
    fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField)
                .where(models.InspectionPartMetadataField.part_id == part.id)
                .order_by(models.InspectionPartMetadataField.source_ref)
            )
        )
        .scalars()
        .all()
    )

    assert [
        (field.source_ref, field.field_path, field.value_text) for field in fields
    ] == [
        (primary_key, "/capture/operator", "primary"),
        (secondary_key, "/capture/operator", "secondary-new"),
    ]
    assert part.metadata_json["nsipro_payloads_by_ref"][secondary_key]["metadata"] == {
        "capture": {"operator": "secondary-new"}
    }


@pytest.mark.asyncio
async def test_bulk_reingest_clears_fields_when_nsipro_association_is_removed(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-clear-nsipro-fields")
    metadata_key = "associated_upload_metadata:clear.nsipro"
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "file_type": "nsipro",
                "source_filename": "clear.nsipro",
                "metadata": {"capture": {"operator": "alice"}},
            },
        )
    )
    await db_session.commit()
    referenced_payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-CLEAR-FIELDS",
                metadata={"associated_metadata_ref": metadata_key},
            )
        ]
    )
    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=referenced_payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    cleared_payload = inspection_part_schemas.InspectionBulkIngestPayload(
        unassigned_parts=[
            inspection_part_schemas.InspectionIngestPartRecord(
                serial_number="SN-CLEAR-FIELDS",
                metadata={
                    "associated_metadata_ref": None,
                    "associated_metadata": None,
                    "nsipro_payload_ref": None,
                    "nsipro_payload": None,
                    "nsipro_metadata": {},
                    "nsipro_payloads_by_ref": {},
                },
            )
        ]
    )
    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=cleared_payload,
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-CLEAR-FIELDS",
            )
        )
    ).scalar_one()
    field_count = (
        await db_session.execute(
            select(func.count())
            .select_from(models.InspectionPartMetadataField)
            .where(models.InspectionPartMetadataField.part_id == part.id)
        )
    ).scalar_one()

    assert field_count == 0
    assert part.metadata_json["nsipro_payload_ref"] is None


@pytest.mark.asyncio
async def test_bulk_generic_json_association_preserves_existing_nsipro_fields(
    db_session: AsyncSession,
):
    project = await _create_project(db_session, name="bulk-json-keeps-nsipro-fields")
    nsipro_key = "associated_upload_metadata:keep.nsipro"
    json_key = "associated_upload_metadata:ordinary.json"
    db_session.add_all(
        [
            models.ProjectMetadata(
                project_id=project.id,
                key=nsipro_key,
                value={
                    "file_type": "nsipro",
                    "source_filename": "keep.nsipro",
                    "metadata": {"capture": {"operator": "alice"}},
                },
            ),
            models.ProjectMetadata(
                project_id=project.id,
                key=json_key,
                value={
                    "file_type": "json",
                    "source_filename": "ordinary.json",
                    "metadata": {"lot": "LOT-42"},
                },
            ),
        ]
    )
    await db_session.commit()
    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=inspection_part_schemas.InspectionBulkIngestPayload(
            unassigned_parts=[
                inspection_part_schemas.InspectionIngestPartRecord(
                    serial_number="SN-KEEP-NSIPRO-FIELDS",
                    metadata={"associated_metadata_ref": nsipro_key},
                )
            ]
        ),
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    await part_ingest.bulk_ingest_project_parts(
        project_id=project.id,
        payload=inspection_part_schemas.InspectionBulkIngestPayload(
            unassigned_parts=[
                inspection_part_schemas.InspectionIngestPartRecord(
                    serial_number="SN-KEEP-NSIPRO-FIELDS",
                    metadata={
                        "source_images": [
                            {
                                "image_id": "11111111-1111-1111-1111-111111111111",
                                "filename": "ordinary.png",
                                "associated_metadata_ref": json_key,
                            }
                        ]
                    },
                )
            ]
        ),
        db=db_session,
        user_email=_test_user().email,
        project_type=project.project_type,
    )

    part = (
        await db_session.execute(
            select(models.InspectionPart).where(
                models.InspectionPart.project_id == project.id,
                models.InspectionPart.serial_number == "SN-KEEP-NSIPRO-FIELDS",
            )
        )
    ).scalar_one()
    fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField).where(
                    models.InspectionPartMetadataField.part_id == part.id
                )
            )
        )
        .scalars()
        .all()
    )

    assert [(field.field_path, field.value_text) for field in fields] == [
        ("/capture/operator", "alice")
    ]
    assert part.metadata_json["nsipro_payload_ref"] == nsipro_key
    assert part.metadata_json["source_images"][0]["associated_metadata_ref"] == json_key
