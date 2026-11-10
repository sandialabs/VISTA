"""Shared maintenance of a part's ``source_images`` records.

VISTA treats user-supplied image metadata (``side``, ``modality``, ``view``,
or any other descriptor key) as opaque: it is stored verbatim and never
renamed, lower-cased, defaulted, or aggregated into derived groups.

Parts ingested before this policy may still carry the legacy derived keys
``configured_views``, ``modalities``, ``view_images`` and ``overlay_images``.
They are never created or recomputed here. When images are removed from a
part, references to exactly those removed images are pruned from the legacy
``view_images``/``overlay_images`` maps so they cannot resurrect a removed
image. Entries for images that were never mirrored into ``source_images`` are
left untouched.
"""

from __future__ import annotations

from typing import Any

from utils.metadata_values import parse_metadata_boolean

LEGACY_IMAGE_MAP_KEYS = ("view_images", "overlay_images")
LEGACY_DERIVED_GROUP_KEYS = ("configured_views", "modalities")
USER_IMAGE_DESCRIPTOR_KEYS = ("side", "modality")


def user_image_descriptor_fields(image_metadata: Any) -> dict:
    """Copy user-supplied descriptor fields verbatim, omitting absent ones.

    Values are never lower-cased, stringified, or defaulted: ``{"side": "B"}``
    stays ``"B"`` and ``{"view": 18}`` is not touched. A missing value is left
    missing rather than replaced with a placeholder such as ``"overlay"``.
    """
    if not isinstance(image_metadata, dict):
        return {}
    return {
        key: image_metadata[key]
        for key in USER_IMAGE_DESCRIPTOR_KEYS
        if image_metadata.get(key) not in (None, "")
    }


def normalize_source_image_record(record: Any) -> dict | None:
    """Return a structurally valid source record, or None when unusable.

    Only VISTA-owned structural fields are normalized: the filename is
    trimmed and the ``overlay`` flag is parsed to a boolean. Every other
    field, including user metadata, is preserved exactly as supplied.
    """
    if not isinstance(record, dict):
        return None
    filename = str(record.get("filename") or "").strip()
    if not filename:
        return None
    return {
        **record,
        "filename": filename,
        "overlay": parse_metadata_boolean(record.get("overlay")),
    }


def normalize_source_image_records(records: Any) -> list[dict]:
    """Normalize a list of source records, dropping unusable entries."""
    if not isinstance(records, list):
        return []
    normalized = (normalize_source_image_record(record) for record in records)
    return [record for record in normalized if record is not None]


def _record_identities(records: Any) -> tuple[set[str], set[str]]:
    image_ids: set[str] = set()
    filenames: set[str] = set()
    if not isinstance(records, list):
        return image_ids, filenames
    for record in records:
        if not isinstance(record, dict):
            continue
        image_id = str(record.get("image_id") or "").strip()
        filename = str(record.get("filename") or "").strip()
        if image_id:
            image_ids.add(image_id)
        if filename:
            filenames.add(filename)
    return image_ids, filenames


def removed_record_identities(
    previous_records: Any, retained_records: Any
) -> tuple[set[str], set[str]]:
    """Return (image_ids, filenames) of records removed between two lists.

    Records are matched by ``image_id`` when present, otherwise by filename.
    The filename of every removed record is reported, because a legacy
    filename-only map reference to it can no longer be resolved to a single
    surviving image.
    """
    retained_ids, _ = _record_identities(retained_records)
    retained_filename_only = {
        str(record.get("filename") or "").strip()
        for record in (retained_records if isinstance(retained_records, list) else [])
        if isinstance(record, dict) and not str(record.get("image_id") or "").strip()
    }
    removed_ids: set[str] = set()
    removed_filenames: set[str] = set()
    if not isinstance(previous_records, list):
        return removed_ids, removed_filenames
    for record in previous_records:
        if not isinstance(record, dict):
            continue
        image_id = str(record.get("image_id") or "").strip()
        filename = str(record.get("filename") or "").strip()
        if image_id:
            if image_id in retained_ids:
                continue
            removed_ids.add(image_id)
        elif not filename or filename in retained_filename_only:
            continue
        if filename:
            removed_filenames.add(filename)
    return removed_ids, removed_filenames


def _image_ref_identity(image_ref: Any) -> tuple[str, str]:
    if isinstance(image_ref, dict):
        return (
            str(image_ref.get("image_id") or "").strip(),
            str(image_ref.get("filename") or "").strip(),
        )
    return "", str(image_ref or "").strip()


def _references_removed_image(
    image_ref: Any, removed_ids: set[str], removed_filenames: set[str]
) -> bool:
    image_id, filename = _image_ref_identity(image_ref)
    if image_id:
        return image_id in removed_ids
    return bool(filename) and filename in removed_filenames


def prune_legacy_image_maps(
    metadata: dict, removed_ids: set[str], removed_filenames: set[str]
) -> dict:
    """Return legacy map keys present in metadata with removed images pruned.

    Only keys already present in ``metadata`` are returned; nothing is
    created for parts that never had legacy maps.
    """
    pruned: dict[str, Any] = {}
    view_images = metadata.get("view_images")
    if isinstance(view_images, dict):
        pruned["view_images"] = {
            key: image_ref
            for key, image_ref in view_images.items()
            if not _references_removed_image(image_ref, removed_ids, removed_filenames)
        }
    overlay_images = metadata.get("overlay_images")
    if isinstance(overlay_images, dict):
        next_overlay_images: dict[str, Any] = {}
        for group_key, group in overlay_images.items():
            if isinstance(group, dict):
                kept = {
                    key: image_ref
                    for key, image_ref in group.items()
                    if not _references_removed_image(
                        image_ref, removed_ids, removed_filenames
                    )
                }
                if kept:
                    next_overlay_images[group_key] = kept
            elif not _references_removed_image(group, removed_ids, removed_filenames):
                next_overlay_images[group_key] = group
        pruned["overlay_images"] = next_overlay_images
    return pruned


def metadata_with_source_images(
    metadata: dict,
    source_images: Any,
    *,
    previous_source_images: Any = None,
) -> dict:
    """Return metadata with replaced source_images and consistent legacy maps.

    ``previous_source_images`` defaults to the records currently stored in
    ``metadata``; images present there but absent from ``source_images`` are
    pruned from legacy ``view_images``/``overlay_images`` maps.
    """
    if previous_source_images is None:
        previous_source_images = metadata.get("source_images")
    normalized = normalize_source_image_records(source_images)
    removed_ids, removed_filenames = removed_record_identities(
        previous_source_images, normalized
    )
    return {
        **metadata,
        "source_images": normalized,
        **prune_legacy_image_maps(metadata, removed_ids, removed_filenames),
    }
