"""Size-bounded on-disk cache that stores values as JSON, never as pickles.

It replaces diskcache, whose default serializer is pickle: anyone who can write to
the cache directory could otherwise make the application execute code when it
reads an entry. Here an entry is a small JSON header followed by raw bytes, and
only JSON types, ``bytes`` and ``tuple`` values round-trip; anything else is
rejected on write and never instantiated on read.

Layout: keys of the form ``<kind>:<uuid>:...`` (every key built in
``utils.cache_manager``) live under ``<root>/<kind>/<uuid>/``, so invalidating
such a prefix removes one directory instead of scanning every entry. Other keys
live under ``<root>/_other/``. File names are SHA-256 digests of the key.

Each entry file is written to a temporary name and renamed into place, so
readers in other processes never see a partial entry. Reads refresh the file's
modification time, and when the cache grows past its size limit the entries
with the oldest modification time are removed first (least recently used).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import struct
import tempfile
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

_MAGIC = b"VCE1"
_SUFFIX = ".vce"
_TYPE_TAG = "__vista_cache__"
_OTHER_BUCKET = "_other"
_BUCKET_KEY = re.compile(r"^([a-z_]+):([0-9a-fA-F-]{8,64}):")
_BUCKET_PATTERN = re.compile(r"^([a-z_]+):([0-9a-fA-F-]{8,64}):$")
# After an eviction pass the cache is trimmed to this fraction of its limit, so
# a cache sitting at its limit does not rescan the directory on every write.
_EVICT_TARGET = 0.9


class FileCache:
    """Directory-backed cache with expiry, LRU eviction and prefix invalidation."""

    def __init__(self, directory: str | os.PathLike[str], size_limit: int) -> None:
        """Open (and create if needed) a cache rooted at ``directory``."""
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.size_limit = int(size_limit)
        self._lock = threading.Lock()
        self._approx_size: int | None = None

    # -- public API ---------------------------------------------------------

    def set(self, key: str, value: Any, expire: float | None = None) -> bool:
        """Store ``value`` under ``key``; ``expire`` is a lifetime in seconds."""
        payload = _encode_entry(_require_key(key), value, expire)
        path = self._path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = _file_size(path)
        fd, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
            os.replace(tmp_name, path)
        except BaseException:
            _unlink(Path(tmp_name))
            raise
        self._account(len(payload) - previous)
        return True

    def get(self, key: str, default: Any = None) -> Any:
        """Return the value for ``key``, or ``default`` if missing or expired."""
        path = self._path_for(_require_key(key))
        entry = _read_entry(path)
        if entry is None or entry[0] != key:
            return default
        _key, expires_at, value = entry
        if expires_at is not None and expires_at <= time.time():
            self._remove(path)
            return default
        try:
            os.utime(path)
        except OSError:
            pass
        return value

    def delete(self, key: str) -> bool:
        """Remove ``key``; return whether an entry existed."""
        return self._remove(self._path_for(_require_key(key)))

    def clear_pattern(self, pattern: str) -> int:
        """Remove every entry whose key contains ``pattern``; return the count.

        A ``<kind>:<uuid>:`` pattern is a key prefix in this codebase, so it
        removes that bucket directory without reading any entries.
        """
        bucket = _BUCKET_PATTERN.match(pattern)
        if bucket:
            return self._remove_bucket(self.directory / bucket[1] / bucket[2].lower())
        removed = 0
        for path in self._entry_paths():
            entry = _read_entry(path)
            if entry is not None and pattern in entry[0] and self._remove(path):
                removed += 1
        return removed

    def clear(self) -> None:
        """Remove every entry."""
        for child in list(self.directory.iterdir()):
            if child.is_dir():
                _rmtree_atomic(child)
            elif child.name.endswith((_SUFFIX, ".tmp")):
                _unlink(child)
        with self._lock:
            self._approx_size = 0

    def volume(self) -> int:
        """Return the total size of all entries in bytes."""
        return sum(_file_size(path) for path in self._entry_paths())

    def __len__(self) -> int:
        """Return the number of stored entries (including not yet expired ones)."""
        return sum(1 for _ in self._entry_paths())

    def keys(self) -> Iterator[str]:
        """Yield the key of every readable entry."""
        for path in self._entry_paths():
            entry = _read_entry(path)
            if entry is not None:
                yield entry[0]

    # -- internals ----------------------------------------------------------

    def _path_for(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        bucket = _BUCKET_KEY.match(key)
        if bucket:
            parent = self.directory / bucket[1] / bucket[2].lower()
        else:
            parent = self.directory / _OTHER_BUCKET / digest[:2]
        return parent / f"{digest}{_SUFFIX}"

    def _entry_paths(self) -> Iterator[Path]:
        for root, _dirs, files in os.walk(self.directory):
            for name in files:
                if name.endswith(_SUFFIX):
                    yield Path(root) / name

    def _remove(self, path: Path) -> bool:
        size = _file_size(path)
        if not _unlink(path):
            return False
        self._account(-size)
        return True

    def _remove_bucket(self, bucket: Path) -> int:
        if not bucket.is_dir():
            return 0
        entries = [p for p in bucket.rglob(f"*{_SUFFIX}")]
        freed = sum(_file_size(p) for p in entries)
        _rmtree_atomic(bucket)
        self._account(-freed)
        return len(entries)

    def _account(self, delta: int) -> None:
        with self._lock:
            if self._approx_size is None:
                self._approx_size = self.volume()
            else:
                self._approx_size = max(0, self._approx_size + delta)
            over_limit = self.size_limit > 0 and self._approx_size > self.size_limit
        if over_limit:
            self._evict()

    def _evict(self) -> None:
        entries = []
        for path in self._entry_paths():
            try:
                stat = path.stat()
            except OSError:
                continue
            entries.append((stat.st_mtime, stat.st_size, path))
        total = sum(size for _mtime, size, _path in entries)
        target = int(self.size_limit * _EVICT_TARGET)
        for _mtime, size, path in sorted(entries, key=lambda item: item[0]):
            if total <= target:
                break
            if _unlink(path):
                total -= size
        with self._lock:
            self._approx_size = total


def _require_key(key: Any) -> str:
    if not isinstance(key, str):
        raise TypeError(f"cache keys must be str, not {type(key).__name__}")
    return key


def _encode_entry(key: str, value: Any, expire: float | None) -> bytes:
    blobs: list[bytes] = []
    header = {
        "key": key,
        "expires_at": None if expire is None else time.time() + float(expire),
        "value": _encode_value(value, blobs),
        "blobs": [len(blob) for blob in blobs],
    }
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return b"".join(
        [_MAGIC, struct.pack(">I", len(header_bytes)), header_bytes, *blobs]
    )


def _encode_value(value: Any, blobs: list[bytes]) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        blobs.append(bytes(value))
        return {_TYPE_TAG: "bytes", "index": len(blobs) - 1}
    if isinstance(value, tuple):
        return {_TYPE_TAG: "tuple", "items": [_encode_value(v, blobs) for v in value]}
    if isinstance(value, list):
        return [_encode_value(item, blobs) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(name, str) for name in value):
            raise TypeError("cached dict keys must be str")
        encoded = {name: _encode_value(item, blobs) for name, item in value.items()}
        if _TYPE_TAG in value:
            return {_TYPE_TAG: "dict", "items": encoded}
        return encoded
    raise TypeError(
        f"{type(value).__name__} is not cacheable; store JSON types, bytes or tuples"
    )


def _decode_value(value: Any, blobs: list[bytes]) -> Any:
    if isinstance(value, list):
        return [_decode_value(item, blobs) for item in value]
    if not isinstance(value, dict):
        return value
    tag = value.get(_TYPE_TAG)
    if tag == "bytes":
        return blobs[int(value["index"])]
    if tag == "tuple":
        return tuple(_decode_value(item, blobs) for item in value["items"])
    if tag == "dict":
        value = value["items"]
    return {name: _decode_value(item, blobs) for name, item in value.items()}


def _read_entry(path: Path) -> tuple[str, float | None, Any] | None:
    """Return ``(key, expires_at, value)``; unreadable or corrupt entries are misses."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    try:
        if data[:4] != _MAGIC:
            raise ValueError("bad magic")
        (header_len,) = struct.unpack(">I", data[4:8])
        header = json.loads(data[8 : 8 + header_len].decode("utf-8"))
        offset = 8 + header_len
        blobs = []
        for size in header["blobs"]:
            blobs.append(data[offset : offset + size])
            offset += size
        if offset != len(data):
            raise ValueError("length mismatch")
        expires_at = header["expires_at"]
        return (
            str(header["key"]),
            (None if expires_at is None else float(expires_at)),
            _decode_value(header["value"], blobs),
        )
    except ValueError, KeyError, TypeError, IndexError, struct.error:
        _unlink(path)
        return None


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _unlink(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def _rmtree_atomic(directory: Path) -> None:
    """Rename the directory away first so readers never see it half removed."""
    doomed = directory.with_name(f".{directory.name}.{os.getpid()}.{time.time_ns()}.rm")
    try:
        directory.rename(doomed)
    except OSError:
        doomed = directory
    shutil.rmtree(doomed, ignore_errors=True)
