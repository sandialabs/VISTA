"""Bulk-ingest inspection batches and parts in one transaction."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from metadata.nsipro_fields import (
    NsiproFieldError,
    NsiproFieldLimitError,
    collect_active_nsipro_source_refs,
    collect_indexable_nsipro_sources,
)
from repositories import audit as audit_repository
from repositories import inspection as inspection_repository
from repositories import project_metadata as project_metadata_repository
from schemas import inspection_parts as inspection_part_schemas
from services.errors import UnprocessableError
from services.inspection import ingest_metadata, nsipro_field_rows, nsipro_payloads


@dataclass
class _IngestRun:
    """Request-local state for one bulk ingest."""

    project_id: uuid.UUID
    user_email: str
    nsipro: ingest_metadata.IngestNsiproContext
    batches_by_name: dict
    parts_by_serial: dict
    counters: dict
    discrepancies: list[dict] = field(default_factory=list)
    seen_serials: set[str] = field(default_factory=set)
    parts_needing_field_sync: dict = field(default_factory=dict)


def _initial_counters(payload) -> dict:
    return {
        "batches_received": len(payload.batches),
        "parts_received": sum(len(batch.parts) for batch in payload.batches)
        + len(payload.unassigned_parts),
        "batches_created": 0,
        "parts_created": 0,
        "parts_skipped_existing": 0,
        "parts_skipped_discrepancy": 0,
    }


async def _start_run(
    *, db, project_id, payload, user_email, project_type
) -> _IngestRun:
    contract = await nsipro_payloads.load_project_parser_contract(
        db=db, project_id=project_id, project_type=project_type
    )
    metadata_by_key = await project_metadata_repository.get_project_metadata_by_keys(
        db=db,
        project_id=project_id,
        keys=ingest_metadata.collect_ingest_metadata_reference_keys(payload),
    )
    existing_batches = await inspection_repository.list_inspection_batches(
        db=db, project_id=project_id
    )
    payload_parts = [part for batch in payload.batches for part in batch.parts]
    payload_parts.extend(payload.unassigned_parts)
    existing_parts = (
        await inspection_repository.list_inspection_parts_for_update_by_serial_numbers(
            db=db,
            project_id=project_id,
            serial_numbers=[part.serial_number for part in payload_parts],
        )
    )
    return _IngestRun(
        project_id=project_id,
        user_email=user_email,
        nsipro=ingest_metadata.IngestNsiproContext(
            db=db,
            project_id=project_id,
            contract=contract,
            project_metadata_by_key=metadata_by_key,
            nsipro_payload_by_ref={},
            project_identifiers={},
        ),
        batches_by_name={batch.name: batch for batch in existing_batches},
        parts_by_serial={part.serial_number: part for part in existing_parts},
        counters=_initial_counters(payload),
    )


def _record_discrepancy(run: _IngestRun, code, batch_name, serial, message) -> None:
    run.counters["parts_skipped_discrepancy"] += 1
    run.discrepancies.append(
        {
            "code": code,
            "batch_name": batch_name or "unassigned",
            "serial_number": serial,
            "message": message,
        }
    )


async def _resolve_batch(db, run: _IngestRun, ingest_batch):
    target_batch = run.batches_by_name.get(ingest_batch.name)
    if target_batch is not None:
        return target_batch
    target_batch = await inspection_repository.create_inspection_batch(
        db=db,
        project_id=run.project_id,
        batch=inspection_part_schemas.InspectionBatchCreate(
            name=ingest_batch.name, description=ingest_batch.description
        ),
        created_by=run.user_email,
        commit=False,
    )
    # SQLAlchemy's UUID default is normally materialized during a flush.
    # Assign it now so every missing batch can be staged before its parts
    # without one flush per batch; the final unit-of-work flush orders batch
    # inserts ahead of their part foreign keys.
    if target_batch.id is None:
        target_batch.id = uuid.uuid4()
    run.batches_by_name[ingest_batch.name] = target_batch
    run.counters["batches_created"] += 1
    return target_batch


async def _merge_into_existing_part(run: _IngestRun, existing_part, ingest_part):
    sync_requested = nsipro_field_rows.has_explicit_nsipro_metadata_sync_intent(
        ingest_part.metadata_json
    )
    normalized = await ingest_metadata.normalize_ingest_part_metadata(
        run.nsipro, ingest_part.metadata_json
    )
    if collect_indexable_nsipro_sources(
        normalized, authoritative_payloads_by_ref=run.nsipro.nsipro_payload_by_ref
    ):
        sync_requested = True
    if isinstance(normalized, dict):
        patch = ingest_metadata.merge_existing_part_ingest_metadata(
            existing_part.metadata_json, normalized
        )
        if patch:
            # ``existing_part`` is tracked from the request-local serial map;
            # mutate it directly instead of re-selecting through the CRUD
            # helper (an O(n) query loop for multi-view imports).
            current = (
                existing_part.metadata_json
                if isinstance(existing_part.metadata_json, dict)
                else {}
            )
            existing_part.metadata_json = {**current, **patch}
    if sync_requested:
        # Rebuild from post-merge metadata. This also deletes stale derived
        # rows when an ingest explicitly clears its .nsipro association.
        run.parts_needing_field_sync[existing_part.id] = existing_part
    run.counters["parts_skipped_existing"] += 1


async def _create_part(db, run: _IngestRun, ingest_part, serial, target_batch_id):
    normalized = await ingest_metadata.normalize_ingest_part_metadata(
        run.nsipro, ingest_part.metadata_json
    )
    created = await inspection_repository.create_inspection_part(
        db=db,
        project_id=run.project_id,
        part=inspection_part_schemas.InspectionPartCreate(
            batch_id=target_batch_id,
            serial_number=serial,
            display_name=ingest_part.display_name,
            metadata=normalized,
            review_state=ingest_part.review_state,
        ),
        created_by=run.user_email,
        commit=False,
    )
    if created.id is None:
        created.id = uuid.uuid4()
    run.parts_by_serial[serial] = created
    if collect_active_nsipro_source_refs(normalized):
        run.parts_needing_field_sync[created.id] = created
    run.counters["parts_created"] += 1


async def _ingest_part(db, run: _IngestRun, ingest_part, batch_name, target_batch_id):
    serial = ingest_part.serial_number.strip()
    if serial in run.seen_serials:
        _record_discrepancy(
            run,
            "duplicate_serial_in_payload",
            batch_name,
            serial,
            "Serial number appears more than once in ingest payload",
        )
        return
    run.seen_serials.add(serial)
    existing_part = run.parts_by_serial.get(serial)
    if existing_part is None:
        await _create_part(db, run, ingest_part, serial, target_batch_id)
        return
    if (
        target_batch_id
        and existing_part.batch_id
        and existing_part.batch_id != target_batch_id
    ):
        _record_discrepancy(
            run,
            "serial_already_assigned_to_other_batch",
            batch_name,
            serial,
            "Serial number already belongs to a different batch in this project",
        )
        return
    await _merge_into_existing_part(run, existing_part, ingest_part)


async def _ingest_payload_parts(db, run: _IngestRun, payload) -> None:
    resolved_batches = [
        (ingest_batch, await _resolve_batch(db, run, ingest_batch))
        for ingest_batch in payload.batches
    ]
    for ingest_batch, target_batch in resolved_batches:
        for ingest_part in ingest_batch.parts:
            await _ingest_part(db, run, ingest_part, ingest_batch.name, target_batch.id)
    for ingest_part in payload.unassigned_parts:
        await _ingest_part(db, run, ingest_part, None, None)


async def _canonicalize_active_refs(db, run: _IngestRun) -> None:
    """Load and normalize every active ref not already resolved by the ingest."""
    active_refs = {
        source_ref
        for part in run.parts_needing_field_sync.values()
        for source_ref in collect_active_nsipro_source_refs(part.metadata_json)
    }
    metadata_by_key = run.nsipro.project_metadata_by_key
    missing = sorted(active_refs.difference(metadata_by_key))
    if missing:
        metadata_by_key.update(
            await project_metadata_repository.get_project_metadata_by_keys(
                db=db, project_id=run.project_id, keys=missing
            )
        )
    payload_by_ref = run.nsipro.nsipro_payload_by_ref
    for source_ref in sorted(active_refs):
        if source_ref in payload_by_ref:
            continue
        project_metadata = metadata_by_key.get(source_ref)
        bundle = (
            project_metadata.value
            if project_metadata and isinstance(project_metadata.value, dict)
            else None
        )
        if not bundle:
            continue
        canonical = nsipro_payloads.normalize_nsipro_bundle_payload(
            bundle=bundle,
            reference={"project_metadata_key": source_ref},
            contract=run.nsipro.contract,
        )
        if canonical:
            payload_by_ref[source_ref] = canonical


def _synchronized_field_rows(run: _IngestRun) -> dict[uuid.UUID, list[dict]]:
    payload_by_ref = run.nsipro.nsipro_payload_by_ref
    for part in run.parts_needing_field_sync.values():
        synchronized = nsipro_field_rows.synchronize_authoritative_nsipro_payloads(
            part.metadata_json, authoritative_payloads_by_ref=payload_by_ref
        )
        if synchronized is not part.metadata_json:
            part.metadata_json = synchronized
    field_cache: dict = {}
    fields_by_part: dict[uuid.UUID, list[dict]] = {}
    total_rows = 0
    for part_id, part in run.parts_needing_field_sync.items():
        field_values = nsipro_field_rows.metadata_field_values_for_sources(
            collect_indexable_nsipro_sources(
                part.metadata_json, authoritative_payloads_by_ref=payload_by_ref
            ),
            field_cache=field_cache,
        )
        total_rows += len(field_values)
        if total_rows > nsipro_field_rows.MAX_NSIPRO_FIELD_ROWS_PER_INGEST:
            raise NsiproFieldLimitError(
                ".nsipro metadata exceeds the aggregate field-row limit of "
                f"{nsipro_field_rows.MAX_NSIPRO_FIELD_ROWS_PER_INGEST} for one ingest"
            )
        fields_by_part[part_id] = field_values
    return fields_by_part


async def _persist_derived_rows(db, run: _IngestRun) -> None:
    await _canonicalize_active_refs(db, run)
    await inspection_repository.replace_inspection_part_metadata_fields(
        db=db, project_id=run.project_id, fields_by_part=_synchronized_field_rows(run)
    )
    if run.nsipro.project_identifiers:
        await project_metadata_repository.store_project_identifier_metadata(
            db=db,
            project_id=run.project_id,
            identifiers=run.nsipro.project_identifiers,
            created_by=run.user_email,
            commit=False,
        )


async def _run_ingest_transaction(*, db, project_id, payload, user_email, project_type):
    try:
        run = await _start_run(
            db=db,
            project_id=project_id,
            payload=payload,
            user_email=user_email,
            project_type=project_type,
        )
        await _ingest_payload_parts(db, run, payload)
        await _persist_derived_rows(db, run)
        await db.flush()
        await db.commit()
    except NsiproFieldError as exc:
        await db.rollback()
        raise UnprocessableError(str(exc)) from exc
    except Exception:
        await db.rollback()
        raise
    return run


async def bulk_ingest_project_parts(
    *,
    db,
    project_id: uuid.UUID,
    payload: inspection_part_schemas.InspectionBulkIngestPayload,
    user_email: str,
    project_type: str | None = None,
) -> dict:
    """Create missing batches/parts and merge metadata into existing parts.

    The whole ingest commits once; any failure rolls back every staged batch,
    part, derived field row, and project-identifier record.
    """
    started = time.perf_counter()
    run = await _run_ingest_transaction(
        db=db,
        project_id=project_id,
        payload=payload,
        user_email=user_email,
        project_type=project_type,
    )
    audit_repository.log_db_operation(
        "BULK_INGEST",
        "inspection_parts",
        project_id,
        user_email,
        {
            **run.counters,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
        },
    )
    return {
        "project_id": project_id,
        "counters": run.counters,
        "discrepancies": run.discrepancies,
    }
