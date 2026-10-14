"""Persistent, memory-mapped cache for NumPy voxel volumes.

The image routes keep authorization and object-storage access policy.  This
module owns only the local lifecycle of an already-authorized ``.npy`` source:
one streamed materialization per source version, atomic publication, and a
small process-local LRU of read-only memory maps.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import tempfile
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from core.config import settings
from utils.volume_loader import (
    MAX_VOLUME_LOAD_BYTES,
    REFERENCE_VOLUME_READ_LIMITS,
    load_numpy_volume,
)

try:  # pragma: no cover - VISTA's deployment target is Linux.
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None


class VolumeCacheError(ValueError):
    """Raised when the local volume-cache service cannot complete an operation."""


class InvalidVolumeSourceError(VolumeCacheError):
    """Raised when authorized source bytes violate the NumPy volume contract."""


class VolumeSourceReadError(Exception):
    """Raised by an authorized byte stream when object storage is unavailable."""

    def __init__(self, *, timed_out: bool = False):
        super().__init__("Authorized volume source is unavailable")
        self.timed_out = timed_out


@dataclass(frozen=True)
class VolumeSourceIdentity:
    image_id: str
    storage_key: str
    size_bytes: int | None
    version: str
    content_sha256: str | None = None


@dataclass(frozen=True)
class VolumeHandle:
    identity: VolumeSourceIdentity
    path: Path
    array: np.ndarray

    @property
    def shape(self) -> tuple[int, ...]:
        return tuple(int(value) for value in self.array.shape)

    @property
    def dtype(self) -> np.dtype:
        return self.array.dtype


AuthorizedByteStream = Callable[[], AsyncIterator[bytes]]

_materialization_tasks: dict[tuple[int, str], asyncio.Task[VolumeHandle]] = {}
_materialization_tasks_lock = threading.Lock()
_memmap_cache: OrderedDict[str, np.ndarray] = OrderedDict()
_memmap_cache_lock = threading.RLock()
_validated_file_signatures: dict[str, tuple[int, int, str | None]] = {}
logger = logging.getLogger(__name__)


def _usable_sha256(value: object) -> str | None:
    candidate = str(value or "").strip().strip('"').lower()
    if candidate.startswith("sha256:"):
        candidate = candidate.split(":", 1)[1]
    if len(candidate) == 64 and all(
        character in "0123456789abcdef" for character in candidate
    ):
        return candidate
    return None


def build_volume_source_identity(
    *,
    image_id: object,
    storage_key: str | None,
    size_bytes: int | None,
    metadata: object = None,
    created_at: object = None,
    updated_at: object = None,
) -> VolumeSourceIdentity:
    """Build a deterministic source version without reading object bytes.

    Image storage keys are immutable in VISTA's upload/import APIs.  Stored
    checksums and timestamps provide additional invalidation signals for older
    or externally restored database records.
    """

    safe_metadata = metadata if isinstance(metadata, dict) else {}
    checksum = next(
        (
            str(safe_metadata.get(key))
            for key in ("content_sha256", "checksum", "etag", "e_tag")
            if safe_metadata.get(key)
        ),
        "",
    )
    normalized_size = None
    if (
        isinstance(size_bytes, int)
        and not isinstance(size_bytes, bool)
        and size_bytes >= 0
    ):
        normalized_size = size_bytes
    fields = (
        str(image_id),
        str(storage_key or ""),
        "" if normalized_size is None else str(normalized_size),
        checksum,
        str(created_at or ""),
        # Keep the historical empty field so identities created before this
        # change remain stable when ``updated_at`` was absent.  A database
        # metadata edit must not invalidate unchanged object bytes.
        "",
    )
    version = hashlib.sha256("\0".join(fields).encode("utf-8")).hexdigest()
    return VolumeSourceIdentity(
        image_id=str(image_id),
        storage_key=str(storage_key or ""),
        size_bytes=normalized_size,
        version=version,
        content_sha256=_usable_sha256(checksum),
    )


def volume_cache_root() -> Path:
    """Return a writable cache root that survives dev-container recreation."""

    explicit = str(settings.VOLUME_CACHE_DIR or "").strip()
    shared = str(settings.CACHE_DIR or "").strip()
    if explicit:
        root = Path(explicit).expanduser()
    elif shared:
        root = Path(shared).expanduser() / "volume-files"
    else:
        root = Path(__file__).resolve().parents[1] / "_cache" / "volume-files"
    configured = bool(explicit or shared)

    def prepare(candidate: Path) -> Path:
        candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
        candidate.chmod(0o700)
        return candidate.resolve()

    try:
        return prepare(root)
    except OSError as exc:
        if configured:
            raise VolumeCacheError(
                f"Configured volume cache directory is unavailable: {exc}"
            ) from exc
        fallback = Path(tempfile.gettempdir()) / f"vista-volume-files-{os.getuid()}"
        logger.warning(
            "Default volume cache directory is unavailable; using private temporary cache"
        )
        try:
            return prepare(fallback)
        except OSError as fallback_exc:
            raise VolumeCacheError(
                "No writable volume cache directory is available"
            ) from fallback_exc


def _volume_cache_max_bytes() -> int:
    try:
        value = int(settings.VOLUME_CACHE_MAX_BYTES)
    except (TypeError, ValueError) as exc:
        raise VolumeCacheError(
            "VOLUME_CACHE_MAX_BYTES must be a positive integer"
        ) from exc
    if value < 1:
        raise VolumeCacheError("VOLUME_CACHE_MAX_BYTES must be a positive integer")
    return value


def materialized_npy_path(identity: VolumeSourceIdentity) -> Path:
    return volume_cache_root() / f"{identity.version}.npy"


def get_materialized_npy_path(identity: VolumeSourceIdentity) -> Path | None:
    path = materialized_npy_path(identity)
    return path if path.is_file() else None


def _file_signature(
    path: Path, expected_sha256: str | None
) -> tuple[int, int, str | None]:
    stat = path.stat()
    return (int(stat.st_size), int(stat.st_mtime_ns), expected_sha256)


def _hash_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_obj:
        while chunk := file_obj.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_materialized_npy(
    path: Path,
    expected_size: int | None,
    expected_sha256: str | None = None,
) -> None:
    try:
        actual_size = path.stat().st_size
    except OSError as exc:
        raise VolumeCacheError(f"Could not inspect cached NumPy volume: {exc}") from exc
    if expected_size is not None and actual_size != expected_size:
        raise InvalidVolumeSourceError(
            "NumPy source download is incomplete: "
            f"received {actual_size} bytes, expected {expected_size} bytes"
        )
    if expected_sha256:
        # Some container filesystems can preserve size and timestamp metadata for
        # rapid same-size rewrites. Rehash checksum-backed entries on every
        # validation so corrupted cache files are never served from a stale
        # process-local signature.
        actual_sha256 = _hash_file_sha256(path)
        if actual_sha256 != expected_sha256:
            raise InvalidVolumeSourceError(
                "NumPy source checksum does not match the stored SHA-256"
            )
    try:
        info = load_numpy_volume(path, limits=REFERENCE_VOLUME_READ_LIMITS)
        array = np.load(path, mmap_mode="r", allow_pickle=False)
        if tuple(array.shape) != tuple(info.array_shape):
            raise ValueError("NumPy header shape changed during validation")
    except ValueError as exc:
        raise InvalidVolumeSourceError(f"Invalid NumPy volume: {exc}") from exc
    except (OSError, MemoryError) as exc:
        raise VolumeCacheError(
            "Could not validate the materialized NumPy volume"
        ) from exc
    finally:
        mapped = locals().get("array")
        mmap_object = getattr(mapped, "_mmap", None)
        if mmap_object is not None:
            mmap_object.close()
    if expected_sha256:
        _validated_file_signatures[str(path)] = _file_signature(path, expected_sha256)


def _remember_verified_checksum(path: Path, expected_sha256: str | None) -> None:
    if expected_sha256:
        _validated_file_signatures[str(path)] = _file_signature(path, expected_sha256)


def _invalidate_cached_memmap(path: Path) -> None:
    key = str(path)
    with _memmap_cache_lock:
        # Do not close here: an in-flight slice may still hold the returned
        # map. Removing it guarantees future requests open the replacement.
        _memmap_cache.pop(key, None)
    _validated_file_signatures.pop(key, None)


def _metadata_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".meta.json")


def _write_cache_metadata_payload(path: Path, payload: dict[str, object]) -> None:
    metadata_path = _metadata_path(path)
    temp_path = metadata_path.with_name(
        f".{metadata_path.name}.{uuid.uuid4().hex}.part"
    )
    try:
        with temp_path.open("x", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
        temp_path.chmod(0o600)
        os.replace(temp_path, metadata_path)
    finally:
        temp_path.unlink(missing_ok=True)


def _write_cache_metadata(path: Path, identity: VolumeSourceIdentity) -> None:
    payload = {
        "image_id": identity.image_id,
        "storage_key": identity.storage_key,
        "version": identity.version,
        "size_bytes": path.stat().st_size,
        "content_sha256": identity.content_sha256,
        "last_access_ns": time.time_ns(),
    }
    _write_cache_metadata_payload(path, payload)


def _read_cache_metadata(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(_metadata_path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _touch_cache_entry(path: Path) -> None:
    """Record LRU access without mutating the source file's checksum signature."""

    payload = _read_cache_metadata(path)
    payload["last_access_ns"] = time.time_ns()
    _write_cache_metadata_payload(path, payload)


def _unlink_cache_entry(path: Path) -> None:
    _invalidate_cached_memmap(path)
    path.unlink(missing_ok=True)
    _metadata_path(path).unlink(missing_ok=True)


def _prune_volume_cache_locked(
    root: Path,
    identity: VolumeSourceIdentity,
    keep_path: Path | None,
    *,
    incoming_size: int = 0,
) -> None:
    """Prune while the caller holds the cache-wide eviction lock."""

    limit = _volume_cache_max_bytes()
    if incoming_size > limit:
        raise VolumeCacheError(
            f"NumPy source requires {incoming_size} bytes, exceeding the configured "
            f"volume cache limit of {limit} bytes"
        )
    candidates: list[tuple[Path, int, int]] = []
    for path in root.glob("*.npy"):
        if keep_path is not None and path == keep_path:
            continue
        metadata = _read_cache_metadata(path)
        if (
            metadata.get("image_id") == identity.image_id
            and metadata.get("storage_key") == identity.storage_key
            and metadata.get("version") != identity.version
        ):
            _unlink_cache_entry(path)
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        raw_access = metadata.get("last_access_ns")
        access_ns = (
            raw_access
            if isinstance(raw_access, int) and not isinstance(raw_access, bool)
            else int(stat.st_mtime_ns)
        )
        candidates.append((path, int(stat.st_size), access_ns))

    keep_size = 0
    if keep_path is not None and keep_path.is_file():
        keep_size = int(keep_path.stat().st_size)
    total = keep_size + incoming_size + sum(size for _path, size, _access in candidates)
    for path, size, _access in sorted(candidates, key=lambda item: item[2]):
        if total <= limit:
            break
        _unlink_cache_entry(path)
        total -= size


def _prune_volume_cache(
    root: Path,
    identity: VolumeSourceIdentity,
    keep_path: Path | None,
    *,
    incoming_size: int = 0,
) -> None:
    """Remove superseded versions, then least-recently used files."""

    eviction_lock = _acquire_publication_lock(root / ".eviction.lock")
    try:
        _prune_volume_cache_locked(
            root,
            identity,
            keep_path,
            incoming_size=incoming_size,
        )
    finally:
        _release_publication_lock(eviction_lock)


def _acquire_publication_lock(lock_path: Path):
    lock_file = None
    try:
        lock_file = lock_path.open("a+b")
        if fcntl is not None:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        return lock_file
    except OSError as exc:
        if lock_file is not None:
            lock_file.close()
        raise VolumeCacheError("Could not acquire a volume cache lock") from exc


def _release_publication_lock(lock_file) -> None:
    release_error = None
    try:
        if fcntl is not None:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    except OSError as exc:
        release_error = exc
    try:
        lock_file.close()
    except OSError as exc:
        release_error = release_error or exc
    if release_error is not None:
        raise VolumeCacheError(
            "Could not release a volume cache lock"
        ) from release_error


def _validate_prune_and_pin_existing(
    identity: VolumeSourceIdentity,
    path: Path,
) -> VolumeHandle | None:
    """Validate and open an existing entry without an eviction/open gap."""

    eviction_lock = _acquire_publication_lock(path.parent / ".eviction.lock")
    try:
        if not path.is_file():
            return None
        try:
            _validate_materialized_npy(
                path,
                identity.size_bytes,
                identity.content_sha256,
            )
        except InvalidVolumeSourceError:
            _unlink_cache_entry(path)
            return None
        _prune_volume_cache_locked(path.parent, identity, path)
        array = _open_cached_memmap(path)
        return VolumeHandle(identity=identity, path=path, array=array)
    finally:
        _release_publication_lock(eviction_lock)


def _publish_prune_and_pin(
    identity: VolumeSourceIdentity,
    temp_path: Path,
    final_path: Path,
) -> VolumeHandle:
    """Publish, prune, and pin a cold entry under one eviction lock."""

    eviction_lock = _acquire_publication_lock(final_path.parent / ".eviction.lock")
    try:
        _invalidate_cached_memmap(final_path)
        os.replace(temp_path, final_path)
        _remember_verified_checksum(final_path, identity.content_sha256)
        _write_cache_metadata(final_path, identity)
        _prune_volume_cache_locked(final_path.parent, identity, final_path)
        array = _open_cached_memmap(final_path)
        return VolumeHandle(identity=identity, path=final_path, array=array)
    finally:
        _release_publication_lock(eviction_lock)


async def _materialize_npy_once(
    identity: VolumeSourceIdentity,
    stream_factory: AuthorizedByteStream,
) -> VolumeHandle:
    final_path = materialized_npy_path(identity)
    lock_path = final_path.with_suffix(".lock")
    lock_file = None
    temp_path: Path | None = None
    try:
        lock_file = await asyncio.to_thread(_acquire_publication_lock, lock_path)
        cache_limit = _volume_cache_max_bytes()
        if final_path.is_file():
            handle = await asyncio.to_thread(
                _validate_prune_and_pin_existing,
                identity,
                final_path,
            )
            if handle is not None:
                return handle

        if identity.size_bytes is not None:
            await asyncio.to_thread(
                _prune_volume_cache,
                final_path.parent,
                identity,
                None,
                incoming_size=identity.size_bytes,
            )

        if (
            identity.size_bytes is not None
            and identity.size_bytes > MAX_VOLUME_LOAD_BYTES
        ):
            raise InvalidVolumeSourceError(
                f"NumPy source declares {identity.size_bytes} bytes, exceeding the built-in "
                f"materialized-file limit of {MAX_VOLUME_LOAD_BYTES} bytes"
            )

        temp_path = final_path.with_name(
            f".{final_path.name}.{os.getpid()}.{uuid.uuid4().hex}.part"
        )
        received = 0
        digest = hashlib.sha256() if identity.content_sha256 else None
        with temp_path.open("xb") as output:
            async for chunk in stream_factory():
                if not chunk:
                    continue
                received += len(chunk)
                if received > MAX_VOLUME_LOAD_BYTES:
                    raise InvalidVolumeSourceError(
                        "NumPy source exceeds the built-in materialized-file limit of "
                        f"{MAX_VOLUME_LOAD_BYTES} bytes"
                    )
                if received > cache_limit:
                    raise VolumeCacheError(
                        "NumPy source exceeds the configured volume cache limit of "
                        f"{cache_limit} bytes"
                    )
                if digest is not None:
                    digest.update(chunk)
                await asyncio.to_thread(output.write, chunk)
            await asyncio.to_thread(output.flush)
            await asyncio.to_thread(os.fsync, output.fileno())

        if identity.size_bytes is not None and received != identity.size_bytes:
            raise InvalidVolumeSourceError(
                "NumPy source download is incomplete: "
                f"received {received} bytes, expected {identity.size_bytes} bytes"
            )
        if digest is not None and digest.hexdigest() != identity.content_sha256:
            raise InvalidVolumeSourceError(
                "NumPy source checksum does not match the stored SHA-256"
            )
        # The stream checksum already verifies the temporary file's payload;
        # structural validation remains necessary before publication.
        await asyncio.to_thread(
            _validate_materialized_npy, temp_path, identity.size_bytes
        )
        handle = await asyncio.to_thread(
            _publish_prune_and_pin,
            identity,
            temp_path,
            final_path,
        )
        temp_path = None
        return handle
    except asyncio.CancelledError:
        raise
    except VolumeSourceReadError:
        raise
    except VolumeCacheError:
        raise
    except Exception as exc:
        raise VolumeCacheError(f"Could not materialize NumPy volume: {exc}") from exc
    finally:
        cleanup_error = None
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError as exc:
                cleanup_error = VolumeCacheError(
                    "Could not clean up a partial volume cache entry"
                )
                cleanup_error.__cause__ = exc
        # Releasing an advisory lock is fast and must not itself be skipped if
        # this materialization task is being cancelled.
        if lock_file is not None:
            try:
                _release_publication_lock(lock_file)
            except VolumeCacheError as exc:
                cleanup_error = cleanup_error or exc
        if cleanup_error is not None:
            raise cleanup_error


def _remove_finished_task(
    key: tuple[int, str], task: asyncio.Task[VolumeHandle]
) -> None:
    with _materialization_tasks_lock:
        if _materialization_tasks.get(key) is task:
            _materialization_tasks.pop(key, None)


async def _get_coalesced_npy_volume_handle(
    identity: VolumeSourceIdentity,
    stream_factory: AuthorizedByteStream,
) -> VolumeHandle:
    """Return one pinned handle, coalescing concurrent cold requests."""

    loop = asyncio.get_running_loop()
    final_path = materialized_npy_path(identity)
    task_key = (id(loop), str(final_path))
    with _materialization_tasks_lock:
        task = _materialization_tasks.get(task_key)
        if task is None:
            task = loop.create_task(_materialize_npy_once(identity, stream_factory))
            _materialization_tasks[task_key] = task
            task.add_done_callback(
                lambda finished: _remove_finished_task(task_key, finished)
            )
    return await asyncio.shield(task)


async def ensure_materialized_npy(
    identity: VolumeSourceIdentity,
    stream_factory: AuthorizedByteStream,
) -> Path:
    """Return one validated local file after opening its read-only memmap."""

    handle = await _get_coalesced_npy_volume_handle(identity, stream_factory)
    return handle.path


def _memmap_cache_limit() -> int:
    try:
        return max(1, int(settings.VOLUME_MEMMAP_CACHE_ITEMS))
    except ValueError:
        return 8


def _open_cached_memmap(path: Path) -> np.ndarray:
    key = str(path)
    with _memmap_cache_lock:
        cached = _memmap_cache.get(key)
        if cached is not None:
            _memmap_cache.move_to_end(key)
            with contextlib.suppress(OSError):
                _touch_cache_entry(path)
            return cached
        try:
            array = np.load(path, mmap_mode="r", allow_pickle=False)
        except (OSError, ValueError, MemoryError) as exc:
            raise VolumeCacheError(f"Could not memory-map NumPy volume: {exc}") from exc
        if array.ndim not in {3, 4} or (
            array.ndim == 4 and array.shape[-1] not in {3, 4}
        ):
            mmap_object = getattr(array, "_mmap", None)
            if mmap_object is not None:
                mmap_object.close()
            raise VolumeCacheError(
                "NumPy volume must be scalar [z, y, x], RGB [z, y, x, 3], or RGBA [z, y, x, 4]"
            )
        _memmap_cache[key] = array
        _memmap_cache.move_to_end(key)
        with contextlib.suppress(OSError):
            _touch_cache_entry(path)
        while len(_memmap_cache) > _memmap_cache_limit():
            # Do not explicitly close an evicted map: an in-flight request may
            # still hold it.  Its final reference will close it normally.
            _memmap_cache.popitem(last=False)
        return array


async def get_npy_volume_handle(
    identity: VolumeSourceIdentity,
    stream_factory: AuthorizedByteStream,
) -> VolumeHandle:
    return await _get_coalesced_npy_volume_handle(identity, stream_factory)


def _reset_volume_cache_for_tests() -> None:
    """Drop process-local handles; persistent files remain caller-owned."""

    with _memmap_cache_lock:
        arrays = list(_memmap_cache.values())
        _memmap_cache.clear()
        _validated_file_signatures.clear()
    for array in arrays:
        mmap_object = getattr(array, "_mmap", None)
        if mmap_object is not None:
            mmap_object.close()
