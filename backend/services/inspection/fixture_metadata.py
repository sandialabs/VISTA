"""Derive built-in test-data image metadata and hierarchy ingest records."""

from __future__ import annotations

import re
from pathlib import Path

from metadata.nsipro_parsers import parse_nsipro_text
from schemas import inspection_parts as inspection_part_schemas
from utils.metadata_values import parse_metadata_boolean

FALLBACK_HIERARCHY_KEYS = [
    "design_number",
    "lot_number",
    "set_number",
    "serial_number",
    "side",
    "modality",
    "overlay",
]


def load_nsipro_metadata_fixture(root: Path) -> dict | None:
    """Parse the first ``.nsipro`` fixture file found under root, if any."""
    nsipro_files = sorted(root.glob("*.nsipro"))
    if not nsipro_files:
        return None
    nsipro_path = nsipro_files[0]
    return parse_nsipro_text(nsipro_path.read_text(encoding="utf-8"), nsipro_path.name)


def metadata_from_hierarchy_filename(path: Path) -> dict | None:
    """Derive hierarchy metadata from a filename with the 7-token convention."""
    tokens = path.stem.split("_")
    if len(tokens) != 7:
        return None
    (
        design_number,
        lot_number,
        part_set_or_batch,
        serial_number,
        side,
        modality,
        overlay,
    ) = tokens
    metadata = {
        "design_number": design_number,
        "lot_number": lot_number,
        "serial_number": serial_number,
        "side": side.lower(),
        "modality": modality.lower(),
        "overlay": parse_metadata_boolean(overlay),
        "source": "vista-test-data",
    }
    if part_set_or_batch.upper().startswith("BATCH"):
        metadata["batch_number"] = part_set_or_batch
    else:
        metadata["set_number"] = part_set_or_batch
    return metadata


def coerce_filename_metadata(metadata: dict) -> dict:
    """Normalize filename-derived metadata fields into their canonical shape."""
    coerced = dict(metadata)
    for key in ("side", "modality"):
        if key in coerced and coerced[key] is not None:
            coerced[key] = str(coerced[key]).strip().lower()
    if "overlay" in coerced:
        overlay_value = coerced["overlay"]
        overlay_keyword = str(overlay_value).strip().lower() in {
            "overlay",
            "ov",
            "mask",
            "heatmap",
        }
        coerced["overlay"] = parse_metadata_boolean(
            overlay_value,
            fallback=overlay_keyword,
        )
    part_set_or_batch = coerced.pop("part_set_or_batch", None)
    if part_set_or_batch and not (
        coerced.get("set_number") or coerced.get("batch_number")
    ):
        part_set_or_batch = str(part_set_or_batch).strip()
        if part_set_or_batch.upper().startswith("BATCH"):
            coerced["batch_number"] = part_set_or_batch
        else:
            coerced["set_number"] = part_set_or_batch
    coerced.setdefault("source", "vista-test-data")
    return coerced


def metadata_from_regex_file(path: Path, regex_path: Path) -> dict | None:
    """Derive metadata by matching a filename against a sibling regex file."""
    pattern = regex_path.read_text(encoding="utf-8").strip()
    if not pattern:
        return None
    match = re.search(pattern, path.stem)
    if not match:
        return None
    if match.groupdict():
        metadata = {
            key: value for key, value in match.groupdict().items() if value is not None
        }
    else:
        metadata = {
            key: value
            for key, value in zip(FALLBACK_HIERARCHY_KEYS, match.groups(), strict=False)
        }
    return coerce_filename_metadata(metadata)


def nearest_regex_file(path: Path, root: Path) -> Path | None:
    """Return the nearest ancestor ``regex.txt`` file between path and root."""
    current = path.parent
    root = root.resolve()
    while True:
        candidate = current / "regex.txt"
        if candidate.exists() and candidate.is_file():
            return candidate
        if current.resolve() == root:
            return None
        current = current.parent


def metadata_from_test_data_file(path: Path, root: Path) -> dict | None:
    """Derive metadata for a test-data file from a regex file or its name."""
    regex_path = nearest_regex_file(path, root)
    if regex_path:
        return metadata_from_regex_file(path, regex_path)
    return metadata_from_hierarchy_filename(path)


REQUIRED_HIERARCHY_KEYS = (
    "design_number",
    "lot_number",
    "serial_number",
    "side",
    "modality",
)


def _hierarchy_part_key(metadata: dict) -> str | None:
    if any(not metadata.get(key) for key in REQUIRED_HIERARCHY_KEYS):
        return None
    group_number = metadata.get("set_number") or metadata.get("batch_number")
    if not group_number:
        return None
    return "_".join(
        [
            metadata["design_number"],
            metadata["lot_number"],
            group_number,
            metadata["serial_number"],
        ]
    )


def _new_hierarchy_part(metadata: dict) -> dict:
    design, lot = metadata["design_number"], metadata["lot_number"]
    batch_number = metadata.get("batch_number")
    group_number = metadata.get("set_number") or batch_number
    return {
        "batch_name": "_".join([design, lot, batch_number]) if batch_number else None,
        "batch_description": (
            f"Design {design}, lot {lot}, batch {batch_number}"
            if batch_number
            else None
        ),
        "serial_number": metadata["serial_number"],
        "display_name": " ".join(
            [design, lot, group_number, metadata["serial_number"]]
        ),
        "metadata": {
            "design_number": design,
            "lot_number": lot,
            "serial_number": metadata["serial_number"],
            "configured_views": [],
            "modalities": [],
            "view_images": {},
            "overlay_images": {},
            "source_images": [],
            "source": "vista-test-data",
        },
    }


def _add_record_to_part(part: dict, record: dict, metadata: dict) -> None:
    part_metadata = part["metadata"]
    for key in ("set_number", "batch_number"):
        if metadata.get(key):
            part_metadata[key] = metadata[key]
    side, modality = metadata["side"], metadata["modality"]
    if side not in part_metadata["configured_views"]:
        part_metadata["configured_views"].append(side)
    if modality not in part_metadata["modalities"]:
        part_metadata["modalities"].append(modality)
    part_metadata["source_images"].append(
        {
            "filename": record["filename"],
            "side": side,
            "modality": modality,
            "overlay": metadata["overlay"],
            "image_id": str(record["image_id"]),
        }
    )
    if metadata["overlay"]:
        part_metadata["overlay_images"].setdefault(side, {})[modality] = record[
            "filename"
        ]
    elif side not in part_metadata["view_images"]:
        part_metadata["view_images"][side] = record["filename"]


def _group_records_into_parts(uploaded_records: list[dict]) -> list[dict]:
    parts_by_key: dict[str, dict] = {}
    for record in uploaded_records:
        metadata = record.get("metadata") or {}
        part_key = _hierarchy_part_key(metadata)
        if part_key is None:
            continue
        part = parts_by_key.setdefault(part_key, _new_hierarchy_part(metadata))
        _add_record_to_part(part, record, metadata)
    return list(parts_by_key.values())


def build_hierarchy_ingest_records(
    uploaded_records: list[dict],
) -> inspection_part_schemas.InspectionBulkIngestPayload:
    """Group hierarchy-named test images into batches and parts for ingest."""
    batches_by_name: dict[str, inspection_part_schemas.InspectionIngestBatchRecord] = {}
    unassigned_parts: list[inspection_part_schemas.InspectionIngestPartRecord] = []
    for part in _group_records_into_parts(uploaded_records):
        part["metadata"]["configured_views"].sort()
        part["metadata"]["modalities"].sort()
        ingest_part = inspection_part_schemas.InspectionIngestPartRecord(
            serial_number=part["serial_number"],
            display_name=part["display_name"],
            metadata=part["metadata"],
        )
        if not part["batch_name"]:
            unassigned_parts.append(ingest_part)
            continue
        batch = batches_by_name.setdefault(
            part["batch_name"],
            inspection_part_schemas.InspectionIngestBatchRecord(
                name=part["batch_name"],
                description=part["batch_description"],
                parts=[],
            ),
        )
        batch.parts.append(ingest_part)
    for batch in batches_by_name.values():
        batch.parts.sort(key=lambda item: item.serial_number)
    unassigned_parts.sort(key=lambda item: item.serial_number)
    return inspection_part_schemas.InspectionBulkIngestPayload(
        batches=list(batches_by_name.values()),
        unassigned_parts=unassigned_parts,
    )
