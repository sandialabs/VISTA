"""Report PT3 splat job status and resolve published splat asset files.

Status payloads are built from the part's lifecycle metadata. Published
assets are only returned when their files are contained in the PT3 cache;
internal paths and lifecycle records never reach the public payload.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from core.config import settings
from repositories import inspection as inspection_repository
from schemas import inspection_pt3 as inspection_pt3_schemas
from services.errors import NotFoundError
from services.inspection import pt3_assets as inspection_pt3_asset_service

PART_NOT_FOUND_DETAIL = "Inspection part not found"
_REAL_PRIVATE_KEYS = {"asset_path", "asset_url", "previous_ready_asset", "source_files"}


def _lifecycle_asset(metadata: object, metadata_key: str) -> tuple[dict, dict]:
    safe_metadata = metadata if isinstance(metadata, dict) else {}
    asset = safe_metadata.get(metadata_key)
    return safe_metadata, asset if isinstance(asset, dict) else {}


def _stack_ids(safe_metadata: dict, asset: dict, volume_stack_id: str | None):
    requested_stack = str(volume_stack_id).strip() if volume_stack_id else ""
    asset_stack = str(
        asset.get("volume_stack_id") or safe_metadata.get("volume_stack_id") or ""
    ).strip()
    return requested_stack, asset_stack


def _status_value(asset: dict, asset_path: Path | None) -> str:
    raw_status = str(asset.get("status") or "").strip().lower()
    if raw_status in {"pending", "failed"}:
        return raw_status
    if raw_status in {"", "ready"} and asset_path is not None:
        return "ready"
    return "missing"


def splat_status_from_metadata(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    metadata: object,
    *,
    volume_stack_id: str | None = None,
) -> inspection_pt3_schemas.PT3SplatGenerationStatus:
    """Build the Simplified splat status payload for a part."""
    safe_metadata, asset = _lifecycle_asset(metadata, "pt3_splat_asset")
    requested_stack, asset_stack = _stack_ids(safe_metadata, asset, volume_stack_id)
    if requested_stack and asset_stack and requested_stack != asset_stack:
        return inspection_pt3_schemas.PT3SplatGenerationStatus(
            status="missing", part_id=part_id, volume_stack_id=requested_stack
        )
    asset_path = inspection_pt3_asset_service.contained_pt3_simplified_splat_asset_path(
        asset, project_id=project_id, part_id=part_id, cache_key=None
    )
    status_value = _status_value(asset, asset_path)
    public_asset = inspection_pt3_asset_service.public_pt3_simplified_splat_asset(asset)
    asset_url = None
    if status_value == "ready":
        asset_url = (
            f"/api/projects/{project_id}/parts/{part_id}/volume-splat-assets/"
            f"{asset.get('cache_key')}"
        )
        public_asset["asset_url"] = asset_url
    else:
        public_asset.pop("asset_url", None)
    return inspection_pt3_schemas.PT3SplatGenerationStatus(
        status=status_value,
        part_id=part_id,
        volume_stack_id=requested_stack or asset_stack or None,
        asset_url=asset_url,
        cache_key=asset.get("cache_key"),
        output_format=asset.get("output_format"),
        splat_count=asset.get("splat_count") if status_value == "ready" else None,
        error=asset.get("error") if status_value == "failed" else None,
        metadata=public_asset,
    )


def _real_asset_url(
    status_value: str, project_id: uuid.UUID, part_id: uuid.UUID, asset: dict
) -> str | None:
    if status_value != "ready":
        return None
    return (
        f"/api/projects/{project_id}/parts/{part_id}/"
        f"real-gaussian-splat-assets/{asset.get('cache_key')}"
    )


def _real_status_response(
    *,
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    asset: dict,
    status_value: str,
    volume_stack_id: str | None,
) -> inspection_pt3_schemas.PT3RealSplatGenerationStatus:
    # The nested fallback is an internal lifecycle record and contains the
    # server cache path. Keep it out of both POST and polling responses.
    public_asset = {
        key: value for key, value in asset.items() if key not in _REAL_PRIVATE_KEYS
    }
    asset_url = _real_asset_url(status_value, project_id, part_id, asset)
    if asset_url:
        public_asset["asset_url"] = asset_url
    return inspection_pt3_schemas.PT3RealSplatGenerationStatus(
        status=status_value,
        job_id=asset.get("job_id"),
        part_id=part_id,
        volume_stack_id=volume_stack_id,
        asset_url=asset_url,
        cache_key=asset.get("cache_key"),
        splat_count=asset.get("splat_count") if status_value == "ready" else None,
        progress_percent=float(
            asset.get("progress_percent") or (100 if status_value == "ready" else 0)
        ),
        stage=str(asset.get("stage") or status_value),
        error=(asset.get("error") if status_value == "failed" else None),
        metadata={
            **public_asset,
            "provider_configured": bool(
                str(settings.PT3_REAL_3DGS_PROVIDER or "").strip()
            ),
            "voxel_direct_available": True,
        },
    )


def real_splat_status_from_metadata(
    project_id: uuid.UUID,
    part_id: uuid.UUID,
    metadata: object,
    *,
    volume_stack_id: str | None = None,
) -> inspection_pt3_schemas.PT3RealSplatGenerationStatus:
    """Build the Real 3DGS status payload for a part."""
    safe_metadata, asset = _lifecycle_asset(metadata, "pt3_real_splat_asset")
    requested_stack, asset_stack = _stack_ids(safe_metadata, asset, volume_stack_id)
    if requested_stack and asset_stack and requested_stack != asset_stack:
        return inspection_pt3_schemas.PT3RealSplatGenerationStatus(
            status="missing", part_id=part_id, volume_stack_id=requested_stack
        )
    asset_path = inspection_pt3_asset_service.contained_pt3_real_splat_asset_path(
        asset, project_id=project_id, part_id=part_id
    )
    status_value = _status_value(asset, asset_path)
    return _real_status_response(
        project_id=project_id,
        part_id=part_id,
        asset=asset,
        status_value=status_value,
        volume_stack_id=requested_stack or asset_stack or None,
    )


async def _require_part(db: AsyncSession, project_id: uuid.UUID, part_id: uuid.UUID):
    part = await inspection_repository.get_inspection_part(
        db=db, project_id=project_id, part_id=part_id
    )
    if not part:
        raise NotFoundError(PART_NOT_FOUND_DETAIL)
    return part


async def get_part_splat_status(
    db: AsyncSession, *, project_id: uuid.UUID, part_id: uuid.UUID
) -> inspection_pt3_schemas.PT3SplatGenerationStatus:
    """Return the Simplified splat status for a part."""
    part = await _require_part(db, project_id, part_id)
    return splat_status_from_metadata(project_id, part.id, part.metadata_json)


async def get_part_real_splat_status(
    db: AsyncSession, *, project_id: uuid.UUID, part_id: uuid.UUID
) -> inspection_pt3_schemas.PT3RealSplatGenerationStatus:
    """Return the Real 3DGS status for a part."""
    part = await _require_part(db, project_id, part_id)
    return real_splat_status_from_metadata(project_id, part.id, part.metadata_json)


async def get_volume_stack_splat_status(
    db: AsyncSession, *, project_id: uuid.UUID, volume_stack_id: str
) -> inspection_pt3_schemas.PT3SplatGenerationStatus:
    """Return the first Simplified splat status bound to a volume stack."""
    result = await db.execute(
        select(models.InspectionPart).where(
            models.InspectionPart.project_id == project_id
        )
    )
    for part in result.scalars().all():
        status_payload = splat_status_from_metadata(
            project_id, part.id, part.metadata_json, volume_stack_id=volume_stack_id
        )
        if status_payload.status != "missing":
            return status_payload
        metadata = part.metadata_json if isinstance(part.metadata_json, dict) else {}
        if str(metadata.get("volume_stack_id") or "").strip() == volume_stack_id:
            return status_payload
    return inspection_pt3_schemas.PT3SplatGenerationStatus(
        status="missing", volume_stack_id=volume_stack_id
    )


async def real_splat_asset_file(
    db: AsyncSession, *, project_id: uuid.UUID, part_id: uuid.UUID, cache_key: str
) -> Path:
    """Return the contained Real 3DGS asset file for a cache key."""
    part = await _require_part(db, project_id, part_id)
    _, lifecycle_asset = _lifecycle_asset(part.metadata_json, "pt3_real_splat_asset")
    asset = inspection_pt3_asset_service.pt3_real_splat_asset_for_cache(
        lifecycle_asset, cache_key
    )
    asset_path = inspection_pt3_asset_service.contained_pt3_real_splat_asset_path(
        asset, project_id=project_id, part_id=part_id, cache_key=cache_key
    )
    if asset_path is None:
        raise NotFoundError("Real Gaussian splat asset file not found")
    return asset_path


async def simplified_splat_asset_file(
    db: AsyncSession, *, project_id: uuid.UUID, part_id: uuid.UUID, cache_key: str
) -> tuple[Path, str]:
    """Return the contained Simplified splat asset file and its media type."""
    part = await _require_part(db, project_id, part_id)
    _, asset = _lifecycle_asset(part.metadata_json, "pt3_splat_asset")
    raw_status = str(asset.get("status") or "").strip().lower()
    if raw_status not in {"", "ready"}:
        raise NotFoundError("Volume splat asset not found")
    asset_path = inspection_pt3_asset_service.contained_pt3_simplified_splat_asset_path(
        asset, project_id=project_id, part_id=part_id, cache_key=cache_key
    )
    if asset_path is None:
        raise NotFoundError("Volume splat asset file not found")
    media_type = (
        "application/json"
        if asset_path.suffix.lower() in {".json", ".splat"}
        else "application/octet-stream"
    )
    return asset_path, media_type
