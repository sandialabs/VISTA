"""Resolve ``.nsipro`` references in ingest part metadata and merge into parts."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from repositories import project_metadata as project_metadata_repository
from services.inspection import nsipro_payloads
from services.inspection.ingest_source_images import merge_source_image_records
from services.inspection.nsipro_payloads import NsiproParserContract, dict_or_empty

PASSTHROUGH_NSIPRO_KEYS = (
    "nsipro_metadata",
    "nsipro_payload",
    "nsipro_payload_ref",
    "nsipro_payloads_by_ref",
    "associated_metadata_ref",
    "associated_metadata",
)


@dataclass
class IngestNsiproContext:
    """Request-local state shared while normalizing every ingested part."""

    db: object
    project_id: uuid.UUID
    contract: NsiproParserContract
    project_metadata_by_key: dict | None = None
    nsipro_payload_by_ref: dict[str, dict] | None = None
    project_identifiers: dict[str, list[str]] | None = field(default=None)


async def _lookup_bundle(ctx: IngestNsiproContext, metadata_key: str) -> dict | None:
    if ctx.project_metadata_by_key is None:
        project_metadata = (
            await project_metadata_repository.get_project_metadata_by_key(
                db=ctx.db, project_id=ctx.project_id, key=metadata_key
            )
        )
    else:
        project_metadata = ctx.project_metadata_by_key.get(metadata_key)
    if project_metadata and isinstance(project_metadata.value, dict):
        return project_metadata.value or None
    return None


async def resolve_associated_nsipro_payload(
    ctx: IngestNsiproContext, metadata: dict
) -> tuple[str, dict] | None:
    """Return the first ``(ref, payload)`` an ingest record's refs resolve to."""
    cache = ctx.nsipro_payload_by_ref
    for metadata_key in nsipro_payloads.candidate_metadata_reference_keys(metadata):
        bundle = await _lookup_bundle(ctx, metadata_key)
        if not bundle:
            continue
        reference = dict_or_empty(metadata.get("associated_metadata"))
        cached_payload = cache.get(metadata_key) if cache is not None else None
        if cached_payload is not None:
            # The parsed payload is canonical for a project-metadata key, but
            # strict parser declarations belong to each individual reference.
            # Validate every occurrence even when parsing is request-cached.
            nsipro_payloads.validate_nsipro_parser_contract(
                bundle=bundle, reference=reference, contract=ctx.contract
            )
            return metadata_key, cached_payload
        payload = nsipro_payloads.normalize_nsipro_bundle_payload(
            bundle=bundle, reference=reference, contract=ctx.contract
        )
        if payload:
            if cache is not None:
                cache[metadata_key] = payload
            return metadata_key, payload
    return None


async def _normalize_source_image_records(
    ctx: IngestNsiproContext, source_images: list, resolved_payloads: dict
) -> tuple[list, str | None]:
    """Resolve per-image refs; return records and the first resolved ref."""
    normalized_records, first_reference = [], None
    for record in source_images:
        if not isinstance(record, dict):
            normalized_records.append(record)
            continue
        normalized_record = {**record}
        resolution = await resolve_associated_nsipro_payload(ctx, normalized_record)
        if resolution:
            reference, payload = resolution
            resolved_payloads.setdefault(reference, payload)
            nsipro_payloads.collect_extracted_project_identifiers(
                payload, ctx.project_identifiers
            )
            first_reference = first_reference or reference
            # Source-image records stay compact. Keep an explicitly supplied
            # legacy inline ``nsipro_payload`` untouched, but do not create
            # another full copy while resolving references.
            normalized_record["associated_metadata_ref"] = reference
            normalized_record["nsipro_payload_ref"] = reference
        normalized_records.append(normalized_record)
    return normalized_records, first_reference


def _apply_primary_payload(
    normalized: dict, primary_reference: str, resolved_payloads: dict
) -> None:
    primary_payload = resolved_payloads[primary_reference]
    normalized["nsipro_payload_ref"] = primary_reference
    normalized["nsipro_payload"] = primary_payload
    normalized["nsipro_metadata"] = primary_payload["metadata"]
    additional_payloads = {
        str(reference): payload
        for reference, payload in dict_or_empty(
            normalized.get("nsipro_payloads_by_ref")
        ).items()
        if str(reference) != primary_reference and isinstance(payload, dict)
    }
    additional_payloads.update(
        {
            reference: payload
            for reference, payload in resolved_payloads.items()
            if reference != primary_reference
        }
    )
    if additional_payloads:
        normalized["nsipro_payloads_by_ref"] = additional_payloads
    else:
        normalized.pop("nsipro_payloads_by_ref", None)


async def normalize_ingest_part_metadata(
    ctx: IngestNsiproContext, metadata: dict | None
) -> dict | None:
    """Resolve top-level and per-image ``.nsipro`` refs into part metadata."""
    if metadata is None:
        return None
    if not isinstance(metadata, dict):
        return metadata
    normalized = {**metadata}
    resolved_payloads: dict[str, dict] = {}
    primary_reference: str | None = None
    top_level = await resolve_associated_nsipro_payload(ctx, normalized)
    if top_level:
        primary_reference, top_level_payload = top_level
        resolved_payloads[primary_reference] = top_level_payload
        nsipro_payloads.collect_extracted_project_identifiers(
            top_level_payload, ctx.project_identifiers
        )
    source_images = normalized.get("source_images")
    if isinstance(source_images, list):
        records, first_record_ref = await _normalize_source_image_records(
            ctx, source_images, resolved_payloads
        )
        normalized["source_images"] = records
        primary_reference = primary_reference or first_record_ref
    if primary_reference:
        _apply_primary_payload(normalized, primary_reference, resolved_payloads)
    return normalized


def collect_ingest_metadata_reference_keys(payload) -> list[str]:
    """Collect every project-metadata reference used by a bulk ingest request."""
    reference_keys: set[str] = set()
    ingest_parts = [part for batch in payload.batches for part in batch.parts]
    ingest_parts.extend(payload.unassigned_parts)
    for ingest_part in ingest_parts:
        metadata = ingest_part.metadata_json
        if not isinstance(metadata, dict):
            continue
        reference_keys.update(
            nsipro_payloads.candidate_metadata_reference_keys(metadata)
        )
        source_images = metadata.get("source_images")
        if not isinstance(source_images, list):
            continue
        for record in source_images:
            if isinstance(record, dict):
                reference_keys.update(
                    nsipro_payloads.candidate_metadata_reference_keys(record)
                )
    return sorted(reference_keys)


def _merged_payloads_by_ref(current: dict, incoming: dict) -> dict | None:
    """Return the merged secondary payload map, or None when unchanged."""
    incoming_primary_ref = str(incoming.get("nsipro_payload_ref") or "").strip()
    if not (incoming_primary_ref and isinstance(incoming.get("nsipro_payload"), dict)):
        return None
    combined = {
        str(reference): payload
        for reference, payload in dict_or_empty(
            current.get("nsipro_payloads_by_ref")
        ).items()
        if isinstance(payload, dict)
    }
    current_primary_ref = str(current.get("nsipro_payload_ref") or "").strip()
    if current_primary_ref and isinstance(current.get("nsipro_payload"), dict):
        combined[current_primary_ref] = current["nsipro_payload"]
    combined.update(
        {
            str(reference): payload
            for reference, payload in dict_or_empty(
                incoming.get("nsipro_payloads_by_ref")
            ).items()
            if isinstance(payload, dict)
        }
    )
    combined.pop(incoming_primary_ref, None)
    if combined:
        return combined
    if "nsipro_payloads_by_ref" in current or "nsipro_payloads_by_ref" in incoming:
        return {}
    return None


def merge_existing_part_ingest_metadata(
    existing_metadata: object, incoming_metadata: object
) -> dict:
    """Return the metadata patch an ingest applies to an already-existing part."""
    current = existing_metadata if isinstance(existing_metadata, dict) else {}
    incoming = incoming_metadata if isinstance(incoming_metadata, dict) else {}
    patch = {key: incoming[key] for key in PASSTHROUGH_NSIPRO_KEYS if key in incoming}
    payloads_by_ref = _merged_payloads_by_ref(current, incoming)
    if payloads_by_ref is not None:
        patch["nsipro_payloads_by_ref"] = payloads_by_ref
    incoming_source_images = incoming.get("source_images")
    if isinstance(incoming_source_images, list):
        current_source_images = current.get("source_images")
        merged = merge_source_image_records(
            current_source_images if isinstance(current_source_images, list) else [],
            incoming_source_images,
        )
        if merged is not None:
            patch["source_images"] = merged
    return patch
