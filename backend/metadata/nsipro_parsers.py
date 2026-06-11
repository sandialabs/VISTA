"""Backend .nsipro parser registry and validation helpers.

The frontend can parse .nsipro files before uploading associated metadata, but
inspection ingest is backend-authoritative: stored project metadata references are
re-read during ingest and normalized before being persisted on inspection parts.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable

DEFAULT_NSIPRO_PARSER_ID = "default"
GENERIC_NSIPRO_PARSER_VERSION = "1.0.0"
GENERIC_NSIPRO_PARSER_HASH = "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df"


def stable_parser_hash(parser_id: str, parser_version: str) -> str:
    """Return the stable parser hash used in frontend/backend payload contracts."""

    digest = hashlib.sha256(f"nsipro:{parser_id}:{parser_version}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def parse_scalar_metadata_value(raw_value: Any) -> Any:
    value = str(raw_value or "").strip()
    if not value:
        return ""
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered == "null":
        return None
    try:
        if any(char in value for char in [".", "e", "E"]):
            return float(value)
        return int(value)
    except ValueError:
        pass
    try:
        return json.loads(value)
    except Exception:
        return value.strip("'\"")


def parse_generic_nsipro_key_value_text(text: str) -> dict[str, Any]:
    root: dict[str, Any] = {}
    current_section = root
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", ";", "//")):
            continue
        if line.startswith("[") and line.endswith("]"):
            section_name = line[1:-1].strip()
            if not section_name:
                continue
            section = root.setdefault(section_name, {})
            if not isinstance(section, dict):
                section = {}
                root[section_name] = section
            current_section = section
            continue
        delimiter_indexes = [index for index in (line.find("="), line.find(":")) if index > 0]
        if not delimiter_indexes:
            continue
        delimiter_index = min(delimiter_indexes)
        key = line[:delimiter_index].strip()
        if not key:
            continue
        current_section[key] = parse_scalar_metadata_value(line[delimiter_index + 1:])
    if not root:
        raise ValueError("No metadata entries were found in the .nsipro file.")
    return root


def _parse_default_nsipro_text(text: str) -> tuple[str, dict[str, Any]]:
    try:
        return "nsipro-json", json.loads(str(text or "").strip())
    except json.JSONDecodeError:
        return "nsipro-key-value", parse_generic_nsipro_key_value_text(text)


@dataclass(frozen=True)
class NsiproParser:
    id: str
    version: str
    parser_hash: str
    parse: Callable[[str], tuple[str, dict[str, Any]]]


NSIPRO_PARSERS: dict[str, NsiproParser] = {
    parser_id: NsiproParser(
        id=parser_id,
        version=GENERIC_NSIPRO_PARSER_VERSION,
        parser_hash=stable_parser_hash(parser_id, GENERIC_NSIPRO_PARSER_VERSION),
        parse=_parse_default_nsipro_text,
    )
    for parser_id in (DEFAULT_NSIPRO_PARSER_ID, "deployment_a", "deployment_b")
}
# Keep the default hash explicit for frontend parity and easier contract review.
NSIPRO_PARSERS[DEFAULT_NSIPRO_PARSER_ID] = NsiproParser(
    id=DEFAULT_NSIPRO_PARSER_ID,
    version=GENERIC_NSIPRO_PARSER_VERSION,
    parser_hash=GENERIC_NSIPRO_PARSER_HASH,
    parse=_parse_default_nsipro_text,
)


def get_nsipro_parser(parser_id: str | None) -> NsiproParser:
    normalized_parser_id = str(parser_id or "").strip() or DEFAULT_NSIPRO_PARSER_ID
    parser = NSIPRO_PARSERS.get(normalized_parser_id)
    if not parser:
        raise ValueError(f"Unknown .nsipro parser configured: {normalized_parser_id}.")
    return parser


def parse_nsipro_text(text: str, filename: str = "", parser_id: str | None = None) -> dict[str, Any]:
    parser = get_nsipro_parser(parser_id)
    parser_name, metadata = parser.parse(text)
    return {
        "parser": parser_name,
        "parser_id": parser.id,
        "parser_version": parser.version,
        "parser_hash": parser.parser_hash,
        "source_filename": filename,
        "metadata": metadata,
        "warnings": [],
    }
