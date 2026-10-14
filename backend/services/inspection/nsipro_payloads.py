"""Normalize stored ``.nsipro`` project-metadata bundles into part payloads."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from metadata.nsipro_parsers import get_nsipro_parser, parse_nsipro_text
from repositories import project_metadata as project_metadata_repository
from services.errors import UnprocessableError
from services.inspection import workspace as inspection_workspace_service

NSIPRO_FILE_TYPES = {"nsipro", ".nsipro"}
STORED_NSIPRO_TEXT_KEYS = (
    "text",
    "raw_text",
    "raw",
    "raw_payload",
    "raw_content",
    "file_content",
    "content",
)
STRICT_PARSER_FLAGS = (
    "strict",
    "strict_mode",
    "strict_version_match",
    "strict_parser_match",
)


@dataclass(frozen=True)
class NsiproParserContract:
    """The configured parser plus the version/hash a project expects."""

    parser: Any
    expected_version: str
    expected_hash: str
    strict: bool


def dict_or_empty(candidate: object) -> dict:
    """Return candidate if it is a dict, else an empty dict."""
    return candidate if isinstance(candidate, dict) else {}


def resolve_configured_nsipro_parser(project_config: dict) -> NsiproParserContract:
    """Resolve the configured ``.nsipro`` parser contract from project config."""
    nsipro_config = dict_or_empty(
        dict_or_empty(project_config.get("metadata_parsers")).get("nsipro")
    )
    parser = get_nsipro_parser(nsipro_config.get("parser_id"))
    expected_version = str(
        nsipro_config.get("parser_version") or parser.version
    ).strip()
    expected_hash = str(nsipro_config.get("parser_hash") or parser.parser_hash).strip()
    strict = bool(any(nsipro_config.get(flag) for flag in STRICT_PARSER_FLAGS))
    return NsiproParserContract(parser, expected_version, expected_hash, strict)


async def load_project_parser_contract(
    *, db, project_id: uuid.UUID, project_type: str | None
) -> NsiproParserContract:
    """Resolve the ``.nsipro`` parser contract from the project configuration."""
    metadata = await project_metadata_repository.get_project_metadata_by_key(
        db=db,
        project_id=project_id,
        key=inspection_workspace_service.PROJECT_CONFIGURATION_KEY,
    )
    default_config = inspection_workspace_service.default_project_configuration(
        project_type
    )
    raw_config = metadata.value if metadata and isinstance(metadata.value, dict) else {}
    project_config = inspection_workspace_service.configuration_for_project_type(
        ({**default_config, **raw_config}),
        project_type,
    )
    return resolve_configured_nsipro_parser(project_config)


def candidate_metadata_reference_keys(metadata: dict) -> list[str]:
    """Return the candidate project-metadata keys referenced by metadata."""
    keys: list[str] = []
    raw_ref = metadata.get("associated_metadata_ref")
    if isinstance(raw_ref, str) and raw_ref.strip():
        keys.append(raw_ref.strip())
    associated = metadata.get("associated_metadata")
    if isinstance(associated, dict):
        for candidate_key in ("project_metadata_key", "key"):
            value = associated.get(candidate_key)
            if isinstance(value, str) and value.strip():
                keys.append(value.strip())
    return list(dict.fromkeys(keys))


def extract_stored_nsipro_text(bundle: dict) -> str:
    """Return the first non-empty raw ``.nsipro`` text found in bundle."""
    for key in STORED_NSIPRO_TEXT_KEYS:
        value = bundle.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def validate_nsipro_parser_contract(
    *, bundle: dict, reference: dict, contract: NsiproParserContract
) -> None:
    """Raise if the strict parser contract does not match the stored bundle."""
    if not contract.strict:
        return
    parser = contract.parser
    observed_parser_id = str(
        reference.get("parser_id") or bundle.get("parser_id") or parser.id
    ).strip()
    observed_version = str(
        reference.get("parser_version")
        or bundle.get("parser_version")
        or contract.expected_version
    ).strip()
    observed_hash = str(
        reference.get("parser_hash")
        or bundle.get("parser_hash")
        or contract.expected_hash
    ).strip()
    mismatches = []
    if observed_parser_id != parser.id:
        mismatches.append(
            f"parser_id expected {parser.id!r} got {observed_parser_id!r}"
        )
    if observed_version != contract.expected_version:
        mismatches.append(
            f"parser_version expected {contract.expected_version!r} "
            f"got {observed_version!r}"
        )
    if observed_hash != contract.expected_hash:
        mismatches.append("parser_hash mismatch")
    if mismatches:
        raise UnprocessableError(
            ".nsipro parser contract mismatch: " + "; ".join(mismatches)
        )


def _parse_stored_bundle_metadata(
    bundle: dict, reference: dict, contract: NsiproParserContract
) -> dict:
    """Rebuild a parser-shaped payload when only parsed metadata is stored.

    Previously derived ``extracted_fields`` are preserved so downstream code
    can keep using normalized business values (for example, parsed project
    identifiers) even when raw ``.nsipro`` text is not present.
    """
    metadata = bundle.get("metadata")
    if not isinstance(metadata, dict):
        raise UnprocessableError(
            "Associated .nsipro metadata does not contain parsed metadata or raw text."
        )
    return {
        "parser": bundle.get("parser")
        or reference.get("parser")
        or "nsipro-stored-metadata",
        "parser_id": contract.parser.id,
        "parser_version": contract.expected_version,
        "parser_hash": contract.expected_hash,
        "source_filename": bundle.get("source_filename")
        or bundle.get("filename")
        or reference.get("source_filename"),
        "metadata": metadata,
        "extracted_fields": dict_or_empty(bundle.get("extracted_fields")),
        "warnings": list(bundle.get("warnings") or []),
    }


def _parse_bundle(bundle: dict, reference: dict, contract: NsiproParserContract):
    raw_text = extract_stored_nsipro_text(bundle)
    if not raw_text:
        return _parse_stored_bundle_metadata(bundle, reference, contract)
    # Re-parse raw content so the backend stays authoritative for structured
    # metadata interpretation.
    source_filename = str(bundle.get("source_filename") or bundle.get("filename") or "")
    return parse_nsipro_text(raw_text, source_filename, contract.parser.id)


def _payload_from_parse(
    parsed: dict, bundle: dict, reference: dict, contract: NsiproParserContract
) -> dict:
    payload = {
        "parser": parsed.get("parser"),
        "parser_id": parsed.get("parser_id") or contract.parser.id,
        "parser_version": parsed.get("parser_version") or contract.expected_version,
        "parser_hash": parsed.get("parser_hash") or contract.expected_hash,
        "source_filename": parsed.get("source_filename")
        or bundle.get("source_filename")
        or bundle.get("filename"),
        "content_hash": bundle.get("content_hash") or reference.get("content_hash"),
        "metadata": dict_or_empty(parsed.get("metadata")),
        "warnings": list(parsed.get("warnings") or []),
    }
    # Keep derived business fields beside the raw parsed structure, but do not
    # add an empty field to legacy payloads.
    extracted_fields = (
        parsed.get("extracted_fields")
        if isinstance(parsed.get("extracted_fields"), dict)
        else dict_or_empty(bundle.get("extracted_fields"))
    )
    if extracted_fields:
        payload["extracted_fields"] = extracted_fields
    return payload


def normalize_nsipro_bundle_payload(
    *, bundle: dict, reference: dict, contract: NsiproParserContract
) -> dict | None:
    """Return the canonical payload for an ``.nsipro`` bundle, else None."""
    if str(bundle.get("file_type") or "").strip().lower() not in NSIPRO_FILE_TYPES:
        return None
    validate_nsipro_parser_contract(
        bundle=bundle, reference=reference, contract=contract
    )
    parsed = _parse_bundle(bundle, reference, contract)
    return _payload_from_parse(parsed, bundle, reference, contract)


def combine_metadata_source_values(source_payloads: list[dict]) -> dict:
    """Merge metadata from multiple sources, recording any value collisions."""
    combined: dict = {}
    collisions: dict = {}
    for source in source_payloads:
        source_key = str(source.get("key") or "").strip()
        for key, value in dict_or_empty(source.get("metadata")).items():
            if key in combined and combined[key] != value:
                collisions.setdefault(key, []).append(
                    {"source_key": source_key, "value": value}
                )
                continue
            combined[key] = value
    if collisions:
        combined["metadata_source_collisions"] = collisions
    return combined


def collect_extracted_project_identifiers(
    nsipro_payload: dict | None,
    accumulator: dict[str, list[str]] | None,
) -> None:
    """Collect derived project identifiers from a normalized .nsipro payload."""
    if accumulator is None or not isinstance(nsipro_payload, dict):
        return
    extracted_fields = dict_or_empty(nsipro_payload.get("extracted_fields"))
    project_identifiers = extracted_fields.get("project_identifiers")
    if not isinstance(project_identifiers, dict):
        return
    for key, value in project_identifiers.items():
        safe_key = str(key).strip()
        if not safe_key:
            continue
        values = value if isinstance(value, (list, tuple, set)) else [value]
        collected_values = accumulator.setdefault(safe_key, [])
        for candidate in values:
            if candidate is None:
                continue
            safe_value = str(candidate).strip()
            if safe_value and safe_value not in collected_values:
                collected_values.append(safe_value)
