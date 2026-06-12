"""Backend .nsipro parser registry and validation helpers.

The frontend can parse .nsipro files before uploading associated metadata, but
inspection ingest is backend-authoritative: stored project metadata references are
re-read during ingest and normalized before being persisted on inspection parts.
"""

from __future__ import annotations

import hashlib
import html
import json
import xml.etree.ElementTree as ET
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

def xml_local_name(name: str) -> str:
    return name.rsplit("}", 1)[-1] if "}" in name else name

def append_xml_child(parent: dict[str, Any], key: str, value: Any) -> None:
    if key in parent:
        if not isinstance(parent[key], list):
            parent[key] = [parent[key]]
        parent[key].append(value)
    else:
        parent[key] = value

def xml_element_to_metadata(element: ET.Element) -> Any:
    attributes = {xml_local_name(key): parse_scalar_metadata_value(value) for key, value in element.attrib.items()}
    child_elements = list(element)
    direct_text = (element.text or "").strip()

    if not child_elements and not attributes:
        return parse_scalar_metadata_value(direct_text)

    result: dict[str, Any] = {}
    if attributes:
        result["@attributes"] = attributes

    for child in child_elements:
        append_xml_child(result, xml_local_name(child.tag), xml_element_to_metadata(child))
        if child.tail and child.tail.strip():
            existing_text = str(result.get("#text", ""))
            result["#text"] = " ".join(part for part in [existing_text, child.tail.strip()] if part)

    if direct_text:
        result["#text"] = parse_scalar_metadata_value(direct_text)
    return result

def leading_whitespace_width(value: str) -> int:
    """Return indentation width while treating tabs as four spaces."""

    width = 0
    for char in value:
        if char == " ":
            width += 1
        elif char == "\t":
            width += 4
        else:
            break
    return width

def _parse_lenient_xml_like_tag_line(line: str) -> tuple[str, str] | None:
    """Parse one NSI XML-like opening tag line.

    Some NSI .nsipro files use an XML-like format rather than XML: tag names
    may contain spaces and scalar values are stored as ``<Tag Name>value``
    without corresponding closing tags. This helper intentionally accepts only a
    single leading tag and leaves the rest of the line as the raw scalar value.
    """

    stripped = line.strip()
    if not stripped.startswith("<") or stripped.startswith(("</", "<?", "<!")):
        return None
    tag_end = stripped.find(">")
    if tag_end <= 1:
        return None
    tag_name = stripped[1:tag_end].strip()
    if not tag_name or tag_name.endswith("/"):
        tag_name = tag_name.rstrip("/").strip()
    if not tag_name:
        return None
    raw_value = stripped[tag_end + 1 :].strip()
    inline_closing_tag = f"</{tag_name}>"
    if raw_value.endswith(inline_closing_tag):
        raw_value = raw_value[: -len(inline_closing_tag)].strip()
    return tag_name, raw_value

def parse_lenient_nsipro_xml_like_text(text: str) -> dict[str, Any]:
    """Parse NSI XML-like .nsipro text that is not well-formed XML.

    The parser is line-oriented by design because NSI pseudo-XML scalar fields
    are represented as ``<field>value`` lines. Empty opening tags become
    containers only when followed by deeper indentation or an explicit closing
    tag; otherwise they remain empty scalar fields.
    """

    root: dict[str, Any] = {}
    stack: list[dict[str, Any]] = [{"tag": None, "indent": -1, "data": root}]

    for raw_line in str(text or "").splitlines():
        if not raw_line.strip():
            continue
        stripped = raw_line.strip()
        indent = leading_whitespace_width(raw_line)

        if stripped.startswith("<?") or stripped.startswith("<!--"):
            continue

        if stripped.startswith("</"):
            closing_name = stripped[2 : stripped.find(">")].strip() if ">" in stripped else stripped[2:].strip()
            while len(stack) > 1:
                frame = stack.pop()
                if frame["tag"] == closing_name:
                    break
            continue

        parsed = _parse_lenient_xml_like_tag_line(raw_line)
        if not parsed:
            continue

        tag_name, raw_value = parsed
        while len(stack) > 1 and indent <= int(stack[-1]["indent"]):
            stack.pop()

        parent = stack[-1]["data"]
        if not isinstance(parent, dict):
            continue

        if raw_value:
            append_xml_child(parent, tag_name, parse_scalar_metadata_value(html.unescape(raw_value)))
        else:
            child: dict[str, Any] = {}
            append_xml_child(parent, tag_name, child)
            stack.append({"tag": tag_name, "indent": indent, "data": child})

    if not root:
        raise ValueError("No XML-like metadata entries were found in the .nsipro file.")
    return root

def parse_nsipro_xml_text(text: str) -> dict[str, Any]:
    trimmed = str(text or "").strip()
    if not trimmed.startswith("<"):
        raise ValueError("Not an XML .nsipro document.")
    lowered = trimmed.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise ValueError("XML .nsipro metadata with DOCTYPE or entity declarations is not supported.")
    try:
        root = ET.fromstring(trimmed)
    except ET.ParseError:
        return parse_lenient_nsipro_xml_like_text(trimmed)
    return {xml_local_name(root.tag): xml_element_to_metadata(root)}

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
        if str(text or "").strip().startswith("<"):
            return "nsipro-xml", parse_nsipro_xml_text(text)
        return "nsipro-key-value", parse_generic_nsipro_key_value_text(text)

def normalize_deployment_metadata_key(key: Any) -> str:
    value = str(key or "").strip()
    chars: list[str] = []
    previous_is_lower_or_digit = False
    for char in value:
        if char.isupper() and previous_is_lower_or_digit:
            chars.append("_")
        if char.isalnum():
            chars.append(char.lower())
            previous_is_lower_or_digit = char.islower() or char.isdigit()
        else:
            if chars and chars[-1] != "_":
                chars.append("_")
            previous_is_lower_or_digit = False
    return "".join(chars).strip("_")

def normalize_deployment_section(section: Any) -> dict[str, Any]:
    if not isinstance(section, dict):
        return {}
    normalized: dict[str, Any] = {}
    for key, value in section.items():
        normalized_key = normalize_deployment_metadata_key(key)
        if normalized_key:
            normalized[normalized_key] = value
    return normalized

def first_deployment_section(metadata: dict[str, Any], candidate_names: list[str]) -> dict[str, Any] | None:
    normalized_candidates = {normalize_deployment_metadata_key(name) for name in candidate_names}
    for key, value in metadata.items():
        if normalize_deployment_metadata_key(key) in normalized_candidates and isinstance(value, dict):
            return value
    return None

def _parse_deployment_a_nsipro_text(text: str) -> tuple[str, dict[str, Any]]:
    parser_name, metadata = _parse_default_nsipro_text(text)
    deployment_section = first_deployment_section(metadata, ["deployment", "deployment metadata", "capture deployment"])
    custom_field_section = first_deployment_section(metadata, ["custom fields", "custom_fields", "deployment custom fields"])
    if not deployment_section and not custom_field_section:
        return parser_name, metadata
    normalized: dict[str, Any] = {}
    if deployment_section:
        normalized["deployment"] = normalize_deployment_section(deployment_section)
    if custom_field_section:
        normalized["custom_fields"] = normalize_deployment_section(custom_field_section)
    return parser_name, normalized

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

NSIPRO_PARSERS["deployment_a"] = NsiproParser(
    id="deployment_a",
    version=GENERIC_NSIPRO_PARSER_VERSION,
    parser_hash=stable_parser_hash("deployment_a", GENERIC_NSIPRO_PARSER_VERSION),
    parse=_parse_deployment_a_nsipro_text,
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
