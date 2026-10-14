"""Utilities for extracting and normalizing business-specific fields.

Operates on already-parsed `.nsipro` metadata.

Why this module exists
----------------------
`nsipro_parsers.py` is responsible for generic structural parsing:
it reads NSI project files and converts them into nested Python metadata.

That generic parser should remain focused on:
- JSON/XML/XML-like/key-value parsing
- scalar value conversion
- preserving file hierarchy

This module sits *after* that parsing step and is responsible for
business-specific interpretation, such as:
- extracting the "Project Name" field
- normalizing that project name
- parsing structured identifiers embedded in the project name
- returning a clean extracted-fields payload

Keeping this logic separate makes the design more maintainable:
- the parser remains generic
- extraction logic can evolve independently
- future identifier formats can be supported here without destabilizing
  the core parser
"""

from __future__ import annotations

import re
from typing import Any


def nested_get(obj: Any, path: list[Any], default: Any = None) -> Any:
    """Safely traverse a nested structure of dictionaries/lists.

    Parameters
    ----------
    obj:
        The root object to traverse.
    path:
        A list of keys and/or integer indexes describing the path.
    default:
        The value to return if the path does not exist.

    Returns:
    -------
    Any
        The value found at the path, or `default` if the path cannot
        be resolved.

    Why this helper matters
    -----------------------
    Parsed `.nsipro` metadata is deeply nested and may vary between files.
    Using a safe traversal helper avoids repetitive chains of `.get(...)`
    calls and prevents `KeyError` / `IndexError` when fields are absent.
    """
    current = obj
    for key in path:
        if (
            isinstance(current, dict)
            and key in current
            or isinstance(current, list)
            and isinstance(key, int)
            and 0 <= key < len(current)
        ):
            current = current[key]
        else:
            return default
    return current


def extract_project_name(metadata: dict[str, Any]) -> str:
    """Extract the canonical NSI project name from parsed metadata.

    Current assumption
    ------------------
    For the NSI files currently being handled, the project name is stored at:

        metadata["NSI Reconstruction Project"]["Project Name"]

    Parameters
    ----------
    metadata:
        Parsed `.nsipro` metadata dictionary.

    Returns:
    -------
    str
        The extracted project name as a trimmed string.
        Returns an empty string if the field is missing.

    Notes:
    -----
    This helper is intentionally narrow and explicit. If future NSI files
    use a different location for the project name, this function is the
    right place to add fallback paths.
    """
    value = nested_get(metadata, ["NSI Reconstruction Project", "Project Name"], "")
    return str(value or "").strip()


def normalize_whitespace_to_dash(value: str) -> str:
    """Normalize a freeform string by converting whitespace runs to '-'.

    Example:
    -------
        "PN_123 LOT_222 SN_A100 MO_456" -> "PN_123-LOT_222-SN_A100-MO_456"

    Why this helper exists
    ----------------------
    This is useful when a consumer wants a normalized single-token form
    of a project name or identifier string while preserving the original
    alphanumeric content.
    """
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""
    return re.sub(r"\s+", "-", cleaned)


def parse_project_identifier_string(value: str) -> dict[str, str]:
    """Parse a structured identifier string embedded in the project name.

    Current supported format
    ------------------------
        PN_XXXXXX-XX LOT_XXX SN_XXXX MO_XXXXXX

    Token-to-key mapping
    --------------------
        PN  -> part-num
        LOT -> lot-num
        SN  -> serial-num
        MO  -> man-num

    Important behavior
    ------------------
    - Identifier values are stored as strings
    - The full token is preserved, including its prefix
      (for example, `PN_123456-78` is stored as `PN_123456-78`)
    - Mixed alphanumeric content is preserved
    - Leading zeroes are preserved
    - Missing or malformed tokens are simply ignored

    Parameters
    ----------
    value:
        Raw project-name string or identifier-containing string.

    Returns:
    -------
    dict[str, str]
        Extracted project identifier fields.

    Expandability
    -------------
    If future naming conventions appear, this function can be extended to:
    - support alternate prefixes
    - support alternate delimiters
    - support multiple patterns
    - emit warnings/validation info if needed
    """
    token_map = {
        "PN": "part-num",
        "LOT": "lot-num",
        "SN": "serial-num",
        "MO": "man-num",
    }

    results: dict[str, str] = {}
    tokens = str(value or "").strip().split()

    for token in tokens:
        normalized_token = token.strip()
        match = re.fullmatch(r"([A-Z]+)_(.+)", normalized_token)
        if not match:
            continue

        prefix = match.group(1)
        metadata_key = token_map.get(prefix)
        if metadata_key:
            # Preserve the full token, including the original prefix, because
            # the business requirement now treats the prefix as part of the
            # stored identifier value.
            results[metadata_key] = normalized_token

    return results


def extract_nsipro_business_fields(metadata: dict[str, Any]) -> dict[str, Any]:
    """Build a normalized business-field extraction payload from parsed metadata.

    Returns a structured dictionary that keeps raw and derived values separate.

    Example shape
    -------------
    {
        "project_name_raw": "...",
        "project_name_normalized": "...",
        "project_identifiers": {
            "part-num": "...",
            "lot-num": "...",
            "serial-num": "...",
            "man-num": "...",
        }
    }

    Why this function exists
    ------------------------
    This gives downstream code a stable, centralized extraction output
    without changing the raw parsed metadata structure.
    """
    project_name_raw = extract_project_name(metadata)
    project_name_normalized = normalize_whitespace_to_dash(project_name_raw)
    project_identifiers = parse_project_identifier_string(project_name_raw)

    return {
        "project_name_raw": project_name_raw,
        "project_name_normalized": project_name_normalized,
        "project_identifiers": project_identifiers,
    }
