"""Associate project metadata sources with one inspection part."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from metadata.nsipro_fields import (
    NsiproFieldError,
    collect_active_nsipro_source_refs,
    collect_indexable_nsipro_sources,
)
from repositories import audit as audit_repository
from repositories import inspection as inspection_repository
from repositories import project_metadata as project_metadata_repository
from services.errors import NotFoundError, UnprocessableError
from services.inspection import nsipro_field_rows, nsipro_payloads
from services.inspection import parts as inspection_part_service


@dataclass
class _ResolvedSources:
    source_refs: list[dict] = field(default_factory=list)
    source_payloads: list[dict] = field(default_factory=list)
    nsipro_sources: list[dict] = field(default_factory=list)
    metadata_by_key: dict = field(default_factory=dict)
    authoritative_payloads_by_ref: dict[str, dict] = field(default_factory=dict)


def _source_value(project_metadata) -> dict:
    value = project_metadata.value
    return value if isinstance(value, dict) else {"value": value}


def _source_metadata(value: dict, nsipro_payload: dict | None):
    if nsipro_payload:
        return nsipro_payload.get("metadata")
    metadata = value.get("metadata")
    return metadata if isinstance(metadata, dict) else value


def _add_source(resolved: _ResolvedSources, key: str, value: dict, contract) -> None:
    nsipro_payload = nsipro_payloads.normalize_nsipro_bundle_payload(
        bundle=value,
        reference={"project_metadata_key": key, "key": key},
        contract=contract,
    )
    resolved.source_refs.append(
        {
            "project_metadata_key": key,
            "filename": value.get("filename") or value.get("source_filename"),
            "file_type": value.get("file_type"),
            "parser": value.get("parser"),
            "parser_id": value.get("parser_id"),
        }
    )
    resolved.source_payloads.append(
        {"key": key, "metadata": _source_metadata(value, nsipro_payload)}
    )
    if nsipro_payload:
        resolved.nsipro_sources.append({"key": key, **nsipro_payload})
        resolved.authoritative_payloads_by_ref[key] = nsipro_payload


async def _resolve_requested_sources(
    *, db, project_id, keys: list[str], contract
) -> _ResolvedSources:
    resolved = _ResolvedSources()
    for key in keys:
        project_metadata = (
            await project_metadata_repository.get_project_metadata_by_key(
                db=db, project_id=project_id, key=key
            )
        )
        if project_metadata is None:
            raise NotFoundError(f"Metadata source '{key}' not found")
        resolved.metadata_by_key[key] = project_metadata
        _add_source(resolved, key, _source_value(project_metadata), contract)
    return resolved


def _association_patch(
    current_metadata: dict, keys: list[str], resolved: _ResolvedSources
) -> dict:
    combine = nsipro_payloads.combine_metadata_source_values
    patch = {
        "associated_metadata_refs": keys,
        "associated_metadata_sources": resolved.source_refs,
        "project_metadata_source_values": resolved.source_payloads,
        "project_metadata_combined": combine(resolved.source_payloads)
        if resolved.source_payloads
        else {},
        "nsipro_metadata_sources": resolved.nsipro_sources,
        "nsipro_metadata": combine(resolved.nsipro_sources)
        if resolved.nsipro_sources
        else {},
    }
    if keys:
        patch["associated_metadata_ref"] = keys[0]
        patch["associated_metadata"] = (
            resolved.source_refs[0] if resolved.source_refs else {}
        )
    elif (
        "associated_metadata_ref" in current_metadata
        or "associated_metadata" in current_metadata
    ):
        patch["associated_metadata_ref"] = None
        patch["associated_metadata"] = None
    return patch


async def _load_remaining_active_payloads(
    *, db, project_id, post_patch_metadata: dict, resolved: _ResolvedSources, contract
) -> None:
    """Canonicalize every still-active ref, including bulk-ingest references."""
    authoritative = resolved.authoritative_payloads_by_ref
    for source_ref in collect_active_nsipro_source_refs(post_patch_metadata):
        if source_ref in authoritative:
            continue
        project_metadata = resolved.metadata_by_key.get(source_ref)
        if project_metadata is None:
            project_metadata = (
                await project_metadata_repository.get_project_metadata_by_key(
                    db=db, project_id=project_id, key=source_ref
                )
            )
        if project_metadata is None or not isinstance(project_metadata.value, dict):
            continue
        nsipro_payload = nsipro_payloads.normalize_nsipro_bundle_payload(
            bundle=project_metadata.value,
            reference={"project_metadata_key": source_ref, "key": source_ref},
            contract=contract,
        )
        if nsipro_payload:
            authoritative[source_ref] = nsipro_payload


def _changed_metadata_patch(current_metadata: dict, synchronized: dict) -> dict:
    patch = {
        key: value
        for key, value in synchronized.items()
        if key not in current_metadata or current_metadata[key] != value
    }
    if (
        "nsipro_payloads_by_ref" in current_metadata
        and "nsipro_payloads_by_ref" not in synchronized
    ):
        patch["nsipro_payloads_by_ref"] = {}
    return patch


async def _persist_part_metadata(
    *, db, project_id, part_id, metadata_patch, field_values, user_email
):
    updated = await inspection_repository.update_inspection_part_metadata(
        db=db,
        project_id=project_id,
        part_id=part_id,
        metadata_patch=metadata_patch,
        updated_by=user_email,
        commit=False,
    )
    if not updated:
        raise NotFoundError("Inspection part not found")
    await inspection_repository.replace_inspection_part_metadata_fields(
        db=db, project_id=project_id, fields_by_part={part_id: field_values}
    )
    await db.commit()
    await db.refresh(updated)
    return updated


async def _write_in_transaction(
    *, db, project_id, part_id, synchronized, patch, user_email, resolved
):
    try:
        field_values = nsipro_field_rows.metadata_field_values_for_sources(
            collect_indexable_nsipro_sources(
                synchronized,
                authoritative_payloads_by_ref=resolved.authoritative_payloads_by_ref,
            ),
            field_cache={},
        )
        return await _persist_part_metadata(
            db=db,
            project_id=project_id,
            part_id=part_id,
            metadata_patch=patch,
            field_values=field_values,
            user_email=user_email,
        )
    except NsiproFieldError as exc:
        await db.rollback()
        raise UnprocessableError(str(exc)) from exc
    except Exception:
        await db.rollback()
        raise


async def update_inspection_part_metadata_sources(
    *, db, project, project_id: uuid.UUID, part_id: uuid.UUID, payload, user_email: str
) -> dict:
    """Replace a part's metadata-source association and its derived field rows."""
    part = await inspection_repository.get_inspection_part_for_update(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise NotFoundError("Inspection part not found")
    contract = await nsipro_payloads.load_project_parser_contract(
        db=db, project_id=project_id, project_type=project.project_type
    )
    keys = payload.metadata_source_keys
    resolved = await _resolve_requested_sources(
        db=db, project_id=project_id, keys=keys, contract=contract
    )
    current = part.metadata_json if isinstance(part.metadata_json, dict) else {}
    post_patch = {**current, **_association_patch(current, keys, resolved)}
    await _load_remaining_active_payloads(
        db=db,
        project_id=project_id,
        post_patch_metadata=post_patch,
        resolved=resolved,
        contract=contract,
    )
    synchronized = nsipro_field_rows.synchronize_authoritative_nsipro_payloads(
        post_patch, authoritative_payloads_by_ref=resolved.authoritative_payloads_by_ref
    )
    patch = _changed_metadata_patch(current, synchronized)
    updated = await _write_in_transaction(
        db=db,
        project_id=project_id,
        part_id=part_id,
        synchronized=synchronized,
        patch=patch,
        user_email=user_email,
        resolved=resolved,
    )
    audit_repository.log_db_operation(
        "UPDATE",
        "inspection_parts",
        updated.id,
        user_email,
        {"project_id": str(project_id), "metadata_keys": sorted(patch)},
    )
    return inspection_part_service.serialize_inspection_part(updated)
