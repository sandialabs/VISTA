"""Inspection part display-order identity resolution.

Display order mixes source-image, analysis-output, and view-image records
into a single ordered list of canonical identities, with filenames accepted
as aliases for an image id when the alias is unambiguous.
"""

from __future__ import annotations

from repositories import inspection as inspection_repository
from services.errors import NotFoundError, UnprocessableError
from utils.metadata_values import parse_metadata_boolean


def _backing_display_records(metadata: dict) -> list[dict[str, object]]:
    """Collect source-image and analysis-output records with delete state."""
    backing_records: list[dict[str, object]] = []
    for collection_key in ("source_images", "analysis_outputs"):
        records = metadata.get(collection_key)
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            image_id = str(record.get("image_id") or "").strip()
            filename = str(record.get("filename") or "").strip()
            if image_id or filename:
                backing_records.append(
                    {
                        "image_id": image_id,
                        "filename": filename,
                        "delete_candidate": (
                            parse_metadata_boolean(
                                record.get("overlay_delete_candidate")
                            )
                            or parse_metadata_boolean(record.get("delete_candidate"))
                        ),
                    }
                )
    return backing_records


def _view_image_display_records(
    metadata: dict, backing_records: list[dict[str, object]]
) -> list[dict[str, str]]:
    """Return display records contributed by view_images, honoring deletes."""
    display_records: list[dict[str, str]] = []
    view_images = metadata.get("view_images")
    if not isinstance(view_images, dict):
        return display_records
    for image_ref in view_images.values():
        if isinstance(image_ref, dict):
            image_id = str(image_ref.get("image_id") or "").strip()
            filename = str(image_ref.get("filename") or "").strip()
        else:
            image_id = ""
            filename = str(image_ref or "").strip()
        if not image_id and not filename:
            continue
        matching_backing_records = [
            record
            for record in backing_records
            if (
                record["image_id"] == image_id
                if image_id
                else bool(filename and record["filename"] == filename)
            )
        ]
        if matching_backing_records and all(
            record["delete_candidate"] for record in matching_backing_records
        ):
            continue
        display_records.append({"image_id": image_id, "filename": filename})
    return display_records


def _canonicalize_display_records(
    display_records: list[dict[str, str]],
) -> tuple[list[str], set[str], dict[str, set[str]]]:
    """Resolve display records into natural order, ids, and filename aliases."""
    image_ids = {record["image_id"] for record in display_records if record["image_id"]}
    filename_to_ids: dict[str, set[str]] = {}
    for record in display_records:
        if record["filename"] and record["image_id"]:
            filename_to_ids.setdefault(record["filename"], set()).add(
                record["image_id"]
            )

    natural_order: list[str] = []
    seen_identities: set[str] = set()
    filename_aliases: dict[str, set[str]] = {}
    for record in display_records:
        image_id = record["image_id"]
        filename = record["filename"]
        candidate_ids = filename_to_ids.get(filename, set()) if filename else set()
        if image_id:
            canonical_ref = image_id
        elif len(candidate_ids) == 1:
            canonical_ref = next(iter(candidate_ids))
        elif len(candidate_ids) > 1:
            continue
        else:
            canonical_ref = filename
        if not canonical_ref:
            continue
        if canonical_ref not in seen_identities:
            natural_order.append(canonical_ref)
            seen_identities.add(canonical_ref)
        if filename:
            filename_aliases.setdefault(filename, set()).add(canonical_ref)

    for filename, candidate_ids in filename_to_ids.items():
        filename_aliases.setdefault(filename, set()).update(candidate_ids)
    return natural_order, image_ids, filename_aliases


def part_image_display_identities(
    metadata: dict,
) -> tuple[list[str], set[str], dict[str, set[str]]]:
    """Return natural display order plus the aliases accepted by its API."""
    backing_records = _backing_display_records(metadata)
    display_records = _view_image_display_records(metadata, backing_records)
    for record in backing_records:
        if record["delete_candidate"]:
            continue
        display_records.append(
            {
                "image_id": str(record["image_id"]),
                "filename": str(record["filename"]),
            }
        )
    return _canonicalize_display_records(display_records)


def _canonical_display_ref(
    image_ref: str, image_ids: set, filename_aliases: dict
) -> str:
    if image_ref in image_ids:
        return image_ref
    candidates = filename_aliases.get(image_ref)
    if not candidates:
        raise UnprocessableError(f"Unknown image reference '{image_ref}'")
    if len(candidates) > 1:
        raise UnprocessableError(
            f"Ambiguous image filename '{image_ref}'; use an image ID"
        )
    return next(iter(candidates))


def _complete_display_order(metadata: dict, image_refs: list[str]) -> list[str]:
    natural_order, image_ids, filename_aliases = part_image_display_identities(metadata)
    requested_order: list[str] = []
    requested_identities: set[str] = set()
    for image_ref in image_refs:
        canonical_ref = _canonical_display_ref(image_ref, image_ids, filename_aliases)
        if canonical_ref in requested_identities:
            raise UnprocessableError(
                f"Image reference '{image_ref}' duplicates another image in image_refs"
            )
        requested_identities.add(canonical_ref)
        requested_order.append(canonical_ref)
    return requested_order + [
        image_ref
        for image_ref in natural_order
        if image_ref not in requested_identities
    ]


async def update_part_image_display_order(
    *, db, project_id, part_id, image_refs: list[str], updated_by: str
):
    """Persist a complete image display order led by the requested references."""
    part = await inspection_repository.get_inspection_part_for_update(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise NotFoundError("Inspection part not found")
    metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    complete_order = _complete_display_order(metadata, image_refs)
    updated = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch={"image_display_order": complete_order},
        updated_by=updated_by,
    )
    if not updated:
        raise NotFoundError("Inspection part not found")
    return updated
