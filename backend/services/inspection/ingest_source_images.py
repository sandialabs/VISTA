"""Merge ingested ``source_images`` records into an existing part's records."""

from __future__ import annotations


def source_image_identity(record: dict) -> tuple[str, str]:
    """Return the (image_id, filename) pair identifying a source image."""
    return (
        str(record.get("image_id") or "").strip(),
        str(record.get("filename") or "").strip(),
    )


class _SourceRecordIndex:
    """Index records by durable image ID and by the legacy filename fallback.

    A filename may legitimately refer to multiple identified images, so it
    must not become an alias between two different IDs. ``legacy`` holds
    only records that have no image ID.
    """

    def __init__(self, records: list) -> None:
        self.by_image_id: dict[str, dict[int, None]] = {}
        self.by_filename: dict[str, dict[int, None]] = {}
        self.legacy: dict[str, dict[int, None]] = {}
        for index, record in enumerate(records):
            if isinstance(record, dict):
                self.add(index, record)

    def _maps(self, record: dict):
        image_id, filename = source_image_identity(record)
        yield self.by_image_id, image_id
        yield self.by_filename, filename
        if not image_id:
            yield self.legacy, filename

    def add(self, index: int, record: dict) -> None:
        for index_map, key in self._maps(record):
            if key:
                index_map.setdefault(key, {})[index] = None

    def remove(self, index: int, record: dict) -> None:
        for index_map, key in self._maps(record):
            candidates = index_map.get(key) if key else None
            if candidates is None:
                continue
            candidates.pop(index, None)
            if not candidates:
                index_map.pop(key, None)

    def match(self, record: dict) -> int | None:
        image_id, filename = source_image_identity(record)
        matching_index = _first(self.by_image_id, image_id) if image_id else None
        if matching_index is None and filename:
            # Identified records may fall back only to a legacy record with no
            # ID. A legacy incoming record may fall back to any record with the
            # same filename because one side lacks a durable identity.
            filename_map = self.legacy if image_id else self.by_filename
            matching_index = _first(filename_map, filename)
        return matching_index


def _first(index_map: dict[str, dict[int, None]], key: str) -> int | None:
    candidates = index_map.get(key)
    return next(iter(candidates)) if candidates else None


def _merged_record(existing_record: dict, incoming_record: dict) -> dict:
    next_record = {**existing_record, **incoming_record}
    existing_image_id, _ = source_image_identity(existing_record)
    incoming_image_id, _ = source_image_identity(incoming_record)
    if existing_image_id and not incoming_image_id:
        # Legacy payloads must not erase an identity already known by the
        # project merely because they omit it.
        next_record["image_id"] = existing_record.get("image_id")
    return next_record


def merge_source_image_records(
    current_records: list, incoming_records: list
) -> list | None:
    """Return merged records, or None when nothing changed."""
    merged = [
        dict(record) if isinstance(record, dict) else record
        for record in current_records
    ]
    index = _SourceRecordIndex(merged)
    changed = False
    for incoming_record in incoming_records:
        if not isinstance(incoming_record, dict):
            continue
        matching_index = index.match(incoming_record)
        if matching_index is not None and isinstance(merged[matching_index], dict):
            existing_record = merged[matching_index]
            next_record = _merged_record(existing_record, incoming_record)
            if next_record != existing_record:
                index.remove(matching_index, existing_record)
                merged[matching_index] = next_record
                index.add(matching_index, next_record)
                changed = True
        else:
            merged.append(incoming_record)
            index.add(len(merged) - 1, incoming_record)
            changed = True
    return merged if changed else None
