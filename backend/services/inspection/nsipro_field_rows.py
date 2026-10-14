"""Derive queryable ``.nsipro`` field rows and refresh canonical payloads."""

from __future__ import annotations

import hashlib
import json

from metadata.nsipro_fields import (
    NsiproField,
    NsiproFieldLimitError,
    NsiproMetadataSource,
    collect_active_nsipro_source_refs,
    flatten_nsipro_metadata,
)
from services.inspection.nsipro_payloads import (
    combine_metadata_source_values,
    dict_or_empty,
)

MAX_NSIPRO_FIELD_ROWS_PER_PART = 20_000
MAX_NSIPRO_FIELD_ROWS_PER_INGEST = 1_000_000
NSIPRO_SYNC_INTENT_KEYS = frozenset(
    {
        "nsipro_metadata",
        "nsipro_metadata_sources",
        "nsipro_payload",
        "nsipro_payload_ref",
        "nsipro_payloads_by_ref",
    }
)


def _validate_source_reference(source: NsiproMetadataSource) -> None:
    if len(source.source_ref) > 255:
        raise NsiproFieldLimitError(
            ".nsipro metadata source reference exceeds the 255-character limit"
        )
    if source.source_filename and len(source.source_filename) > 1024:
        raise NsiproFieldLimitError(
            ".nsipro metadata source filename exceeds the 1024-character limit"
        )


def _metadata_fingerprint(metadata: object) -> str:
    try:
        serialized = json.dumps(
            metadata, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    except (TypeError, ValueError, OverflowError, RecursionError):
        # Let the flattener produce the domain-specific validation error.
        # Invalid trees are not shared through the cache.
        return f"invalid:{id(metadata)}"


def _field_row(source: NsiproMetadataSource, field: NsiproField) -> dict:
    return {
        "source_ref": source.source_ref,
        "source_filename": source.source_filename,
        "field_path": field.field_path,
        "field_path_hash": field.field_path_hash,
        "field_name": field.field_name,
        "ordinal": field.ordinal,
        "value_type": field.value_type,
        "value_json": field.value_json,
        "value_text": field.value_text,
        "value_text_hash": field.value_text_hash,
        "value_number": field.value_number,
        "value_boolean": field.value_boolean,
    }


def metadata_field_values_for_sources(
    sources: list[NsiproMetadataSource],
    *,
    field_cache: dict[tuple[str, str], list[NsiproField]],
) -> list[dict]:
    """Build ORM-ready values while flattening shared source payloads once."""
    values: list[dict] = []
    for source in sources:
        _validate_source_reference(source)
        cache_key = (source.source_ref, _metadata_fingerprint(source.metadata))
        fields = field_cache.get(cache_key)
        if fields is None:
            fields = flatten_nsipro_metadata(source.metadata)
            field_cache[cache_key] = fields
        if len(values) + len(fields) > MAX_NSIPRO_FIELD_ROWS_PER_PART:
            raise NsiproFieldLimitError(
                ".nsipro metadata exceeds the aggregate field-row limit "
                f"of {MAX_NSIPRO_FIELD_ROWS_PER_PART} for one part"
            )
        values.extend(_field_row(source, field) for field in fields)
    return values


def has_explicit_nsipro_metadata_sync_intent(metadata: object) -> bool:
    """Return whether an ingest payload explicitly supplies ``nsipro_*`` data."""
    if not isinstance(metadata, dict):
        return False
    if NSIPRO_SYNC_INTENT_KEYS.intersection(metadata):
        return True
    source_images = metadata.get("source_images")
    if not isinstance(source_images, list):
        return False
    return any(
        isinstance(source_image, dict)
        and bool(NSIPRO_SYNC_INTENT_KEYS.intersection(source_image))
        for source_image in source_images
    )


def _metadata_source_ref(source: dict) -> str:
    return str(source.get("key") or source.get("project_metadata_key") or "").strip()


def _synchronized_additional_payloads(
    current: dict,
    *,
    primary_ref: str,
    active_refs: list[str],
    canonical_refs: list[str],
    metadata_source_refs: set[str],
    authoritative_payloads_by_ref: dict[str, dict],
) -> dict:
    additional_payloads = {
        str(source_ref): payload
        for source_ref, payload in dict_or_empty(
            current.get("nsipro_payloads_by_ref")
        ).items()
        if (
            str(source_ref) != primary_ref
            and str(source_ref) in active_refs
            and str(source_ref) not in metadata_source_refs
            and isinstance(payload, dict)
        )
    }
    additional_payloads.update(
        {
            source_ref: authoritative_payloads_by_ref[source_ref]
            for source_ref in canonical_refs
            if source_ref != primary_ref and source_ref not in metadata_source_refs
        }
    )
    return additional_payloads


def _synchronize_primary_payload(
    synchronized: dict,
    current: dict,
    *,
    primary_ref: str,
    active_refs: list[str],
    canonical_refs: list[str],
    authoritative_payloads_by_ref: dict[str, dict],
) -> None:
    primary_payload = authoritative_payloads_by_ref[primary_ref]
    synchronized["nsipro_payload"] = primary_payload
    synchronized["nsipro_metadata"] = primary_payload.get("metadata", {})
    metadata_sources = current.get("nsipro_metadata_sources")
    metadata_source_refs = (
        {_metadata_source_ref(s) for s in metadata_sources if isinstance(s, dict)}
        if isinstance(metadata_sources, list)
        else set()
    )
    additional_payloads = _synchronized_additional_payloads(
        current,
        primary_ref=primary_ref,
        active_refs=active_refs,
        canonical_refs=canonical_refs,
        metadata_source_refs=metadata_source_refs,
        authoritative_payloads_by_ref=authoritative_payloads_by_ref,
    )
    if additional_payloads:
        synchronized["nsipro_payloads_by_ref"] = additional_payloads
    else:
        synchronized.pop("nsipro_payloads_by_ref", None)


def _synchronize_metadata_sources(
    synchronized: dict,
    metadata_sources: list,
    *,
    primary_ref: str,
    authoritative_payloads_by_ref: dict[str, dict],
) -> None:
    synchronized_sources = []
    for source in metadata_sources:
        if not isinstance(source, dict):
            synchronized_sources.append(source)
            continue
        canonical_payload = authoritative_payloads_by_ref.get(
            _metadata_source_ref(source)
        )
        synchronized_sources.append(
            {**source, **canonical_payload}
            if isinstance(canonical_payload, dict)
            else source
        )
    synchronized["nsipro_metadata_sources"] = synchronized_sources
    if not primary_ref:
        synchronized["nsipro_metadata"] = combine_metadata_source_values(
            [source for source in synchronized_sources if isinstance(source, dict)]
        )


def synchronize_authoritative_nsipro_payloads(
    metadata: object,
    *,
    authoritative_payloads_by_ref: dict[str, dict],
) -> dict:
    """Refresh active canonical payload snapshots before deriving field rows."""
    current = metadata if isinstance(metadata, dict) else {}
    active_refs = collect_active_nsipro_source_refs(current)
    canonical_refs = [
        source_ref
        for source_ref in active_refs
        if source_ref in authoritative_payloads_by_ref
    ]
    if not canonical_refs:
        return current

    synchronized = {**current}
    primary_ref = str(current.get("nsipro_payload_ref") or "").strip()
    if primary_ref and primary_ref in authoritative_payloads_by_ref:
        _synchronize_primary_payload(
            synchronized,
            current,
            primary_ref=primary_ref,
            active_refs=active_refs,
            canonical_refs=canonical_refs,
            authoritative_payloads_by_ref=authoritative_payloads_by_ref,
        )
    metadata_sources = current.get("nsipro_metadata_sources")
    if isinstance(metadata_sources, list):
        _synchronize_metadata_sources(
            synchronized,
            metadata_sources,
            primary_ref=primary_ref,
            authoritative_payloads_by_ref=authoritative_payloads_by_ref,
        )
    return synchronized
