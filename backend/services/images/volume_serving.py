"""Serve volume metadata, render summaries, slices, and connected selections.

Each workflow reads an already authorized image through ``volume_sources`` and
raises only typed service errors, which ``main.py`` maps to HTTP responses.
"""

from __future__ import annotations

import asyncio
import logging
import zipfile
from contextlib import suppress
from typing import Any

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from schemas import inspection_volumes as inspection_volume_schemas
from services.errors import ServiceError, ValidationFailedError
from services.images import volume_sources
from services.images import volumes as image_volume_service
from services.images.volume_rendering import (
    VOLUME_RENDER_SUMMARY_VERSION,
    axis_slice,
    connected_volume_selection,
)
from services.images.volume_sources import VolumeSourceAccess
from utils import cache_manager
from utils.transactions import commit_database_transaction
from utils.volume_cache import (
    InvalidVolumeSourceError,
    VolumeCacheError,
    VolumeSourceIdentity,
    VolumeSourceReadError,
    get_materialized_npy_path,
    get_npy_volume_handle,
)
from utils.volume_loader import REFERENCE_VOLUME_READ_LIMITS, VolumeReadLimits

logger = logging.getLogger(__name__)

VOLUME_SLICE_AXES = {"axial", "coronal", "sagittal"}


def _image_metadata(db_image: models.DataInstance) -> dict:
    return db_image.metadata_json if isinstance(db_image.metadata_json, dict) else {}


def _volume_error(exc: Exception, action: str) -> ServiceError:
    """Map a volume read failure to the client-safe error for ``action``."""
    if isinstance(exc, VolumeSourceReadError):
        return volume_sources.storage_read_error(exc)
    if isinstance(exc, InvalidVolumeSourceError):
        return ValidationFailedError(f"Unable to {action}: {exc}")
    if isinstance(exc, VolumeCacheError):
        return ServiceError("Volume cache is temporarily unavailable")
    return ValidationFailedError(f"Unable to {action}: {exc}")


def _required_volume_kind(db_image: models.DataInstance) -> str:
    kind = image_volume_service.volume_source_kind(db_image.filename or "")
    if not kind:
        raise ValidationFailedError("Unsupported multi-image file type")
    return kind


def volume_meta(
    shape: tuple[int, ...], dtype: np.dtype, *, source_kind: str
) -> dict[str, Any]:
    """Build API volume metadata, rejecting unsupported layouts as invalid."""
    try:
        return image_volume_service.volume_meta_from_shape(
            shape,
            dtype,
            source_kind=source_kind,
        )
    except ValueError as exc:
        raise ValidationFailedError(str(exc)) from exc


def _load_materialized_volume(
    payload: bytes, kind: str, filename: str, limits: VolumeReadLimits | None = None
) -> np.ndarray:
    if kind == "tiff":
        return image_volume_service.load_tiff_volume(payload, limits=limits)
    return image_volume_service.load_numpy_volume(
        payload,
        filename,
        limits=limits or REFERENCE_VOLUME_READ_LIMITS,
    )


async def _persist_rebuilt_tiff_volume_metadata(
    db: AsyncSession,
    db_image: models.DataInstance,
    meta: dict[str, Any],
) -> None:
    project_id = db_image.project_id
    image_id = db_image.id
    existing = _image_metadata(db_image)
    dimensions = (
        meta.get("dimensions") if isinstance(meta.get("dimensions"), dict) else {}
    )
    rebuilt = {
        "load_mode": "volume",
        "tiff_dimensionality": "3d",
        "frame_count": meta.get("image_count"),
        "volume_shape": {
            "axial": dimensions.get("axial"),
            "coronal": dimensions.get("coronal"),
            "sagittal": dimensions.get("sagittal"),
        },
        "pixel_dtype": meta.get("pixel_dtype"),
        "voxel_dtype": meta.get("voxel_dtype"),
        "bit_depth": meta.get("bit_depth"),
        "channel_count": meta.get("channel_count"),
        "color_mode": meta.get("color_mode"),
    }
    rebuilt = {key: value for key, value in rebuilt.items() if value is not None}
    if not rebuilt or all(existing.get(key) == value for key, value in rebuilt.items()):
        return
    try:
        db_image.metadata_json = {**existing, **rebuilt}
        db.add(db_image)
        await commit_database_transaction(db)
        cache_manager.invalidate_images(project_id, [db_image.id])
    except Exception:
        with suppress(Exception):
            await db.rollback()
        logger.warning(
            "Could not persist rebuilt TIFF volume metadata for image %s",
            image_id,
            exc_info=True,
        )


async def _read_cached_or_source_npy_header(
    db_image: models.DataInstance, access: VolumeSourceAccess
) -> tuple[tuple[int, ...], str]:
    """Prefer the materialized cache header, discarding an invalid entry."""
    identity = volume_sources.volume_source_identity(db_image)
    materialized_path = get_materialized_npy_path(identity)
    if materialized_path is None:
        return await volume_sources.read_authorized_npy_header(db_image, access)
    try:
        return await asyncio.to_thread(
            volume_sources.read_npy_header_from_path,
            materialized_path,
        )
    except FileNotFoundError:
        return await volume_sources.read_authorized_npy_header(db_image, access)
    except ValueError:
        try:
            await asyncio.to_thread(materialized_path.unlink, missing_ok=True)
        except OSError as exc:
            raise VolumeCacheError(
                "Could not discard invalid cached volume metadata"
            ) from exc
        return await volume_sources.read_authorized_npy_header(db_image, access)
    except OSError as exc:
        raise VolumeCacheError("Could not read cached volume metadata") from exc


async def _npy_volume_meta(
    db_image: models.DataInstance, access: VolumeSourceAccess, metadata: dict
) -> dict[str, Any]:
    meta = image_volume_service.persisted_npy_volume_meta(metadata)
    if meta is not None:
        return meta
    shape, dtype_text = await _read_cached_or_source_npy_header(db_image, access)
    safe_shape, safe_dtype, channel_count, _color_mode = (
        image_volume_service.validated_npy_shape_dtype(
            shape,
            np.dtype(dtype_text),
            limits=REFERENCE_VOLUME_READ_LIMITS,
        )
    )
    array_shape = safe_shape + ((channel_count,) if channel_count != 1 else ())
    return volume_meta(array_shape, safe_dtype, source_kind="npy")


async def _materialized_volume_meta(
    db: AsyncSession,
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    kind: str,
    metadata: dict,
) -> dict[str, Any]:
    meta = (
        image_volume_service.persisted_tiff_volume_meta(
            metadata,
            limits=REFERENCE_VOLUME_READ_LIMITS,
        )
        if kind == "tiff"
        else None
    )
    if meta is not None:
        return meta
    payload = await volume_sources.read_authorized_image_bytes(db_image, access)
    volume = _load_materialized_volume(payload, kind, db_image.filename or "")
    meta = volume_meta(volume.shape, volume.dtype, source_kind=kind)
    if kind == "tiff":
        await _persist_rebuilt_tiff_volume_metadata(db, db_image, meta)
    return meta


async def get_volume_metadata(
    db: AsyncSession, db_image: models.DataInstance, access: VolumeSourceAccess
) -> dict[str, Any]:
    """Return volume dimensions, preferring persisted or header-only metadata."""
    kind = _required_volume_kind(db_image)
    metadata = _image_metadata(db_image)
    try:
        if kind == "npy":
            meta = await _npy_volume_meta(db_image, access, metadata)
        else:
            meta = await _materialized_volume_meta(db, db_image, access, kind, metadata)
    except ServiceError:
        raise
    except Exception as exc:
        raise _volume_error(exc, "read volume") from exc
    meta.update(
        {
            "filename": db_image.filename,
            "content_type": db_image.content_type,
            "metadata_bit_depth": metadata.get("bit_depth")
            or metadata.get("bits_per_sample"),
        }
    )
    return meta


def _npy_stream_factory(db_image: models.DataInstance, access: VolumeSourceAccess):
    return lambda: volume_sources.iter_authorized_npy_bytes(db_image, access)


async def get_volume_render_summary(
    db_image: models.DataInstance, access: VolumeSourceAccess
) -> dict[str, Any]:
    """Return optional, bounded slice hints for sparse NPY RGBA rendering."""
    kind = image_volume_service.volume_source_kind(db_image.filename or "")
    if kind != "npy":
        raise ValidationFailedError(
            "Render summaries are available only for NumPy .npy volumes"
        )
    identity = volume_sources.volume_source_identity(db_image)
    cache_key = (str(db_image.id), identity.version, VOLUME_RENDER_SUMMARY_VERSION)
    try:
        handle = await get_npy_volume_handle(
            identity, _npy_stream_factory(db_image, access)
        )
        summary = await image_volume_service.get_or_compute_volume_render_summary(
            cache_key, handle.array
        )
    except Exception as exc:
        raise _volume_error(exc, "summarize volume") from exc
    return {
        **summary,
        "source_kind": kind,
        "dimensions": {
            "axial": int(handle.shape[0]),
            "coronal": int(handle.shape[1]),
            "sagittal": int(handle.shape[2]),
        },
    }


def _axis_slice(array: np.ndarray, axis: str, index: int) -> np.ndarray:
    try:
        return axis_slice(array, axis, index)
    except ValueError as exc:
        raise ValidationFailedError(str(exc)) from exc


async def _load_slice_volume(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    kind: str,
    identity: VolumeSourceIdentity,
) -> np.ndarray:
    if kind == "npy":
        handle = await get_npy_volume_handle(
            identity, _npy_stream_factory(db_image, access)
        )
        return handle.array
    payload = await volume_sources.read_authorized_image_bytes(db_image, access)
    return _load_materialized_volume(payload, kind, db_image.filename or "")


async def _render_volume_slice_png(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    kind: str,
    identity: VolumeSourceIdentity,
    cache_key: tuple[str, str, int, str],
) -> bytes:
    _image_id, axis, index, _version = cache_key
    volume = await _load_slice_volume(db_image, access, kind, identity)
    dimensions = volume_meta(volume.shape, volume.dtype, source_kind=kind)["dimensions"]
    if index >= int(dimensions[axis]):
        raise ValidationFailedError("Slice index is outside the selected axis")
    return await image_volume_service.get_or_render_volume_slice_png(
        cache_key,
        _axis_slice(volume, axis, index),
    )


async def get_volume_slice_png(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    *,
    axis: str,
    index: int,
) -> tuple[bytes, str]:
    """Return ``(png, normalized_axis)`` for one cached or rendered slice."""
    kind = _required_volume_kind(db_image)
    safe_axis = axis if axis in VOLUME_SLICE_AXES else "axial"
    identity = volume_sources.volume_source_identity(db_image)
    cache_key = (str(db_image.id), safe_axis, int(index), identity.version)
    png = image_volume_service.get_cached_volume_slice_png(cache_key)
    if png is not None:
        return png, safe_axis
    try:
        png = await _render_volume_slice_png(
            db_image, access, kind, identity, cache_key
        )
    except ServiceError:
        raise
    except Exception as exc:
        raise _volume_error(exc, "render volume slice") from exc
    return png, safe_axis


def _enforce_connected_selection_decoded_volume_limits(
    volume: np.ndarray,
    *,
    limits: VolumeReadLimits | None = None,
) -> None:
    """Recheck actual decoded layout before flood-fill touches the array."""
    active_limits = (
        limits or image_volume_service.volume_connected_selection_read_limits()
    )
    array = np.asarray(volume)
    dimensions = volume_meta(array.shape, array.dtype, source_kind="selection")[
        "dimensions"
    ]
    spatial_voxels = (
        int(dimensions["axial"])
        * int(dimensions["coronal"])
        * int(dimensions["sagittal"])
    )
    decoded_bytes = int(array.size) * int(array.dtype.itemsize)
    if spatial_voxels > active_limits.max_voxels:
        raise ValueError(
            "Volume declares "
            f"{spatial_voxels} voxels, exceeding the connected-selection "
            f"{active_limits.max_voxels}-voxel limit"
        )
    if decoded_bytes > active_limits.max_decoded_bytes:
        raise ValueError(
            "Volume occupies "
            f"{decoded_bytes} decoded bytes, exceeding the connected-selection "
            f"{active_limits.max_decoded_bytes}-byte limit"
        )


def _decode_selection_source(
    source: bytes | None, kind: str, filename: str, limits: VolumeReadLimits
) -> np.ndarray:
    if source is None:
        raise ValueError("Volume source is unavailable")
    if len(source) > limits.max_source_bytes:
        raise ValueError(
            "Volume source exceeds the connected-selection "
            f"{limits.max_source_bytes}-byte source limit"
        )
    try:
        volume = _load_materialized_volume(source, kind, filename, limits)
    except (OSError, EOFError, zipfile.BadZipFile) as exc:
        raise ValueError(
            "Volume source is invalid or could not be decoded safely"
        ) from exc
    _enforce_connected_selection_decoded_volume_limits(volume, limits=limits)
    return volume


def decode_and_select_connected_volume(
    *,
    kind: str,
    source: bytes | None,
    filename: str,
    volume: np.ndarray | None,
    seed: list[int],
    sensitivity: float,
    display_min: float | None,
    display_max: float | None,
    max_voxels: int,
    max_examined: int,
    max_runs: int,
) -> dict[str, Any]:
    """Decode non-NPY sources and run flood-fill in one bounded worker job."""
    limits = image_volume_service.volume_connected_selection_read_limits()
    resolved_volume = (
        _decode_selection_source(source, kind, filename, limits)
        if volume is None
        else volume
    )
    return connected_volume_selection(
        resolved_volume,
        seed=seed,
        sensitivity=sensitivity,
        display_min=display_min,
        display_max=display_max,
        max_voxels=max_voxels,
        max_examined=max_examined,
        max_runs=max_runs,
    )


def _enforce_declared_source_size(
    db_image: models.DataInstance, kind: str, limits: VolumeReadLimits
) -> None:
    if kind == "npy" or db_image.size_bytes is None:
        return
    try:
        materialized_source_bytes = int(db_image.size_bytes)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Volume source size metadata is invalid") from exc
    volume_sources.enforce_materialized_volume_source_limit(
        materialized_source_bytes,
        max_bytes=limits.max_source_bytes,
    )


async def _selection_inputs(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    kind: str,
    limits: VolumeReadLimits,
) -> tuple[bytes | None, np.ndarray | None]:
    """Return ``(source, volume)``: an NPY handle array or bounded source bytes."""
    if kind == "npy":
        identity = volume_sources.volume_source_identity(db_image)
        handle = await get_npy_volume_handle(
            identity, _npy_stream_factory(db_image, access)
        )
        return None, handle.array
    source = await volume_sources.read_authorized_image_bytes(
        db_image,
        access,
        max_bytes=limits.max_source_bytes,
    )
    volume_sources.enforce_materialized_volume_source_limit(
        len(source),
        max_bytes=limits.max_source_bytes,
    )
    return source, None


async def _run_connected_selection(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    kind: str,
    payload: inspection_volume_schemas.VolumeConnectedSelectionRequest,
) -> dict[str, Any]:
    limits = image_volume_service.volume_connected_selection_read_limits()
    _enforce_declared_source_size(db_image, kind, limits)
    async with image_volume_service.volume_connected_selection_slot() as selection:
        async with image_volume_service.volume_connected_selection_materialization_slot(
            kind
        ) as decode_lease:
            source, volume = await _selection_inputs(db_image, access, kind, limits)
            worker_future = (
                image_volume_service.volume_connected_selection_executor.submit(
                    decode_and_select_connected_volume,
                    kind=kind,
                    source=source,
                    filename=db_image.filename or "",
                    volume=volume,
                    seed=payload.seed,
                    sensitivity=payload.sensitivity,
                    display_min=payload.display_min,
                    display_max=payload.display_max,
                    max_voxels=payload.max_voxels,
                    max_examined=payload.max_examined,
                    max_runs=payload.max_runs,
                )
            )
            selection.release_when_done(worker_future)
            if decode_lease is not None:
                decode_lease.release_when_done(worker_future)
            return await asyncio.wrap_future(worker_future)


async def select_connected_volume(
    db_image: models.DataInstance,
    access: VolumeSourceAccess,
    payload: inspection_volume_schemas.VolumeConnectedSelectionRequest,
) -> dict[str, Any]:
    """Select a guarded 6-connected intensity region from an authorized volume."""
    kind = _required_volume_kind(db_image)
    try:
        return await _run_connected_selection(db_image, access, kind, payload)
    except ServiceError:
        raise
    except (VolumeSourceReadError, VolumeCacheError) as exc:
        raise _volume_error(exc, "select volume") from exc
    except ValueError as exc:
        raise ValidationFailedError(str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Unexpected volume connected-selection failure for image %s (%s)",
            db_image.id,
            kind,
        )
        raise ServiceError("Unable to select volume") from exc
