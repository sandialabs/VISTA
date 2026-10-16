"""Flatten parsed ``.nsipro`` metadata into deterministic query-field records."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Any


@dataclass(frozen=True, slots=True)
class NsiproFieldLimits:
    """Resource limits applied before metadata field rows reach the database."""

    max_depth: int = 32
    max_items: int = 10_000
    max_key_bytes: int = 4 * 1024
    max_path_bytes: int = 128 * 1024
    max_string_bytes: int = 1024 * 1024
    max_total_path_bytes: int = 16 * 1024 * 1024
    max_total_string_bytes: int = 32 * 1024 * 1024
    max_numeric_digits: int = 1_000


DEFAULT_NSIPRO_FIELD_LIMITS = NsiproFieldLimits()


class NsiproFieldError(ValueError):
    """Base error for metadata that cannot be represented as field rows."""


class NsiproFieldLimitError(NsiproFieldError):
    """Raised when parsed metadata exceeds a field materialization limit."""


class NsiproFieldValueError(NsiproFieldError):
    """Raised when parsed metadata contains an unsupported scalar value."""


@dataclass(frozen=True, slots=True)
class NsiproField:
    """One scalar or empty-container leaf from parsed ``.nsipro`` metadata."""

    field_path: str
    field_path_hash: str
    field_name: str
    ordinal: int
    value_type: str
    value_json: Any
    value_text: str | None
    value_text_hash: str | None
    value_number: Decimal | None
    value_boolean: bool | None


@dataclass(frozen=True, slots=True)
class NsiproMetadataSource:
    """One authoritative project-metadata source attached to an inspection part."""

    source_ref: str
    source_filename: str | None
    metadata: dict[str, Any]


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _escape_json_pointer_segment(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _json_pointer(segments: tuple[str, ...]) -> str:
    if not segments:
        return ""
    return "/" + "/".join(_escape_json_pointer_segment(segment) for segment in segments)


def _validate_utf8_size(value: str, *, maximum: int, label: str) -> None:
    if len(value.encode("utf-8")) > maximum:
        raise NsiproFieldLimitError(
            f".nsipro metadata {label} exceeds the {maximum}-byte limit"
        )


def _field_for_leaf(
    *,
    value: Any,
    path: str,
    field_name: str,
    ordinal: int,
    limits: NsiproFieldLimits,
) -> NsiproField:
    value_text: str | None = None
    value_text_hash: str | None = None
    value_number: Decimal | None = None
    value_boolean: bool | None = None

    if value is None:
        value_type = "null"
    elif isinstance(value, bool):
        value_type = "boolean"
        value_boolean = value
    elif isinstance(value, int):
        value_type = "integer"
        value_number = Decimal(value)
        numeric_digits = (
            1 if value_number.is_zero() else value_number.copy_abs().adjusted() + 1
        )
        if numeric_digits > limits.max_numeric_digits:
            raise NsiproFieldLimitError(
                ".nsipro metadata numeric value exceeds the "
                f"{limits.max_numeric_digits}-digit limit"
            )
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise NsiproFieldValueError(".nsipro metadata numbers must be finite")
        value_type = "number"
        value_number = Decimal(str(value))
    elif isinstance(value, str):
        _validate_utf8_size(
            value,
            maximum=limits.max_string_bytes,
            label="string value",
        )
        value_type = "string"
        value_text = value
        value_text_hash = _sha256_text(value)
    elif isinstance(value, dict) and not value:
        value_type = "object"
    elif isinstance(value, list) and not value:
        value_type = "array"
    else:
        raise NsiproFieldValueError(
            f"Unsupported .nsipro metadata value type: {type(value).__name__}"
        )

    return NsiproField(
        field_path=path,
        field_path_hash=_sha256_text(path),
        field_name=field_name,
        ordinal=ordinal,
        value_type=value_type,
        value_json=value,
        value_text=value_text,
        value_text_hash=value_text_hash,
        value_number=value_number,
        value_boolean=value_boolean,
    )


def flatten_nsipro_metadata(
    metadata: Any,
    *,
    limits: NsiproFieldLimits = DEFAULT_NSIPRO_FIELD_LIMITS,
) -> list[NsiproField]:
    """Return ordered leaf records for a parsed ``.nsipro`` metadata tree.

    Paths are RFC 6901 JSON Pointers relative to the parser's ``metadata``
    object. Object insertion order and list order are retained. Non-empty
    containers are traversal nodes; empty objects and arrays are emitted so the
    relational representation does not lose their presence.
    """
    fields: list[NsiproField] = []
    visited_items = 0
    total_path_bytes = 0
    total_string_bytes = 0
    stack: list[tuple[Any, tuple[str, ...], str, int]] = [(metadata, (), "", 0)]

    while stack:
        value, segments, field_name, depth = stack.pop()
        if depth > limits.max_depth:
            raise NsiproFieldLimitError(
                f".nsipro metadata exceeds the maximum depth of {limits.max_depth}"
            )

        path = _json_pointer(segments)
        path_bytes = len(path.encode("utf-8"))
        _validate_utf8_size(
            path,
            maximum=limits.max_path_bytes,
            label="field path",
        )
        total_path_bytes += path_bytes
        if total_path_bytes > limits.max_total_path_bytes:
            raise NsiproFieldLimitError(
                ".nsipro metadata exceeds the aggregate field-path byte limit"
            )

        if isinstance(value, dict) and value:
            visited_items += len(value)
            if visited_items > limits.max_items:
                raise NsiproFieldLimitError(
                    ".nsipro metadata exceeds the maximum item count of "
                    f"{limits.max_items}"
                )
            for key, child in reversed(value.items()):
                segment = str(key)
                _validate_utf8_size(
                    segment,
                    maximum=limits.max_key_bytes,
                    label="field name",
                )
                stack.append((child, (*segments, segment), segment, depth + 1))
            continue

        if isinstance(value, list) and value:
            visited_items += len(value)
            if visited_items > limits.max_items:
                raise NsiproFieldLimitError(
                    ".nsipro metadata exceeds the maximum item count of "
                    f"{limits.max_items}"
                )
            for index in range(len(value) - 1, -1, -1):
                segment = str(index)
                stack.append((value[index], (*segments, segment), segment, depth + 1))
            continue

        if len(fields) >= limits.max_items:
            raise NsiproFieldLimitError(
                ".nsipro metadata exceeds the maximum field count of "
                f"{limits.max_items}"
            )
        if isinstance(value, str):
            total_string_bytes += len(value.encode("utf-8"))
            if total_string_bytes > limits.max_total_string_bytes:
                raise NsiproFieldLimitError(
                    ".nsipro metadata exceeds the aggregate string-value byte limit"
                )
        fields.append(
            _field_for_leaf(
                value=value,
                path=path,
                field_name=field_name,
                ordinal=len(fields),
                limits=limits,
            )
        )

    return fields


def collect_active_nsipro_source_refs(metadata: Any) -> list[str]:
    """Return de-duplicated source refs that are active in part metadata."""
    if not isinstance(metadata, dict):
        return []

    primary_ref = str(metadata.get("nsipro_payload_ref") or "").strip()
    metadata_sources = metadata.get("nsipro_metadata_sources")
    active_refs: list[str] = []
    seen_refs: set[str] = set()

    def add_active_ref(reference: Any) -> None:
        source_ref = str(reference or "").strip()
        if source_ref and source_ref not in seen_refs:
            seen_refs.add(source_ref)
            active_refs.append(source_ref)

    add_active_ref(primary_ref)
    add_active_ref(metadata.get("associated_metadata_ref"))
    associated_metadata = metadata.get("associated_metadata")
    if isinstance(associated_metadata, dict):
        add_active_ref(
            associated_metadata.get("project_metadata_key")
            or associated_metadata.get("key")
        )

    associated_refs = metadata.get("associated_metadata_refs")
    if isinstance(associated_refs, list):
        for reference in associated_refs:
            add_active_ref(reference)

    source_images = metadata.get("source_images")
    if isinstance(source_images, list):
        for source_image in source_images:
            if not isinstance(source_image, dict):
                continue
            add_active_ref(source_image.get("nsipro_payload_ref"))
            add_active_ref(source_image.get("associated_metadata_ref"))
            associated = source_image.get("associated_metadata")
            if isinstance(associated, dict):
                add_active_ref(
                    associated.get("project_metadata_key") or associated.get("key")
                )

    if isinstance(metadata_sources, list):
        for source in metadata_sources:
            if isinstance(source, dict):
                add_active_ref(source.get("key") or source.get("project_metadata_key"))

    return active_refs


def collect_indexable_nsipro_sources(
    metadata: Any,
    *,
    authoritative_payloads_by_ref: dict[str, dict[str, Any]] | None = None,
) -> list[NsiproMetadataSource]:
    """Return active, referenced ``.nsipro`` payloads from stored part metadata.

    Payload dictionaries retained only for history in ``nsipro_payloads_by_ref``
    are deliberately ignored unless another current reference points to them.
    Legacy inline payloads without a project-metadata reference also remain
    JSON-only because their parser provenance is not authoritative.
    """
    if not isinstance(metadata, dict):
        return []

    active_refs = collect_active_nsipro_source_refs(metadata)
    if authoritative_payloads_by_ref is not None:
        authoritative_sources: list[NsiproMetadataSource] = []
        for source_ref in active_refs:
            payload = authoritative_payloads_by_ref.get(source_ref)
            if not isinstance(payload, dict):
                continue
            parsed_metadata = payload.get("metadata")
            if not isinstance(parsed_metadata, dict):
                continue
            filename = payload.get("source_filename") or payload.get("filename")
            authoritative_sources.append(
                NsiproMetadataSource(
                    source_ref=source_ref,
                    source_filename=str(filename).strip() if filename else None,
                    metadata=parsed_metadata,
                )
            )
        return authoritative_sources

    payloads_by_ref: dict[str, NsiproMetadataSource] = {}

    def register_payload(reference: Any, payload: Any) -> None:
        source_ref = str(reference or "").strip()
        if (
            not source_ref
            or source_ref in payloads_by_ref
            or not isinstance(payload, dict)
        ):
            return
        parsed_metadata = payload.get("metadata")
        if not isinstance(parsed_metadata, dict):
            return
        filename = payload.get("source_filename") or payload.get("filename")
        payloads_by_ref[source_ref] = NsiproMetadataSource(
            source_ref=source_ref,
            source_filename=str(filename).strip() if filename else None,
            metadata=parsed_metadata,
        )

    primary_ref = str(metadata.get("nsipro_payload_ref") or "").strip()
    register_payload(primary_ref, metadata.get("nsipro_payload"))
    additional_payloads = metadata.get("nsipro_payloads_by_ref")
    if isinstance(additional_payloads, dict):
        for reference, payload in additional_payloads.items():
            register_payload(reference, payload)
    metadata_sources = metadata.get("nsipro_metadata_sources")
    if isinstance(metadata_sources, list):
        for source in metadata_sources:
            if isinstance(source, dict):
                register_payload(
                    source.get("key") or source.get("project_metadata_key"),
                    source,
                )

    return [
        payloads_by_ref[source_ref]
        for source_ref in active_refs
        if source_ref in payloads_by_ref
    ]
