"""Tests for the JSON file cache that replaced diskcache (no pickle)."""

import ast
import os
import threading
import time
import uuid
from pathlib import Path

import pytest

from utils import file_cache
from utils.file_cache import FileCache

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def cache(tmp_path):
    return FileCache(tmp_path / "cache", size_limit=10 * 1024 * 1024)


def test_cache_modules_never_use_pickle():
    """The cache must never deserialize objects: no pickle-family imports at all."""
    for name in ("utils/file_cache.py", "utils/cache_manager.py"):
        imported = set()
        for node in ast.walk(ast.parse((BACKEND / name).read_text())):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        assert not imported & {"pickle", "dill", "shelve", "marshal", "diskcache"}, name


def test_round_trips_json_bytes_and_tuples(cache):
    value = {
        "items": [1, 2.5, "three", None, True],
        "nested": {"a": [{"b": "c"}]},
        "blob": b"\x00\x01binary\xff",
        "pair": (b"png-bytes", "image/png", "thumb.png"),
        "__vista_cache__": "a user key that looks like the type tag",
    }
    cache.set("other:key", value)
    assert cache.get("other:key") == value
    assert isinstance(cache.get("other:key")["pair"], tuple)


def test_thumbnail_payload_shape_round_trips(cache):
    key = f"thumbnail:{uuid.uuid4()}:w:64:h:64"
    payload = (os.urandom(4096), "image/jpeg", "a.jpg")
    cache.set(key, payload)
    assert cache.get(key) == payload


def test_rejects_values_that_are_not_plain_data(cache):
    class Custom:
        pass

    for bad in (Custom(), {1: "int key"}, {"x": {1, 2}}):
        with pytest.raises(TypeError):
            cache.set("other:bad", bad)
    with pytest.raises(TypeError):
        cache.set(123, "value")  # type: ignore[arg-type]
    assert cache.get("other:bad") is None


def test_missing_key_returns_default(cache):
    assert cache.get("nope") is None
    assert cache.get("nope", "fallback") == "fallback"
    assert cache.delete("nope") is False


def test_expiry(cache, monkeypatch):
    now = [1_000_000.0]
    monkeypatch.setattr(file_cache.time, "time", lambda: now[0])
    cache.set("k", "v", expire=10)
    now[0] += 9
    assert cache.get("k") == "v"
    now[0] += 2
    assert cache.get("k") is None
    assert len(cache) == 0


def test_delete_and_clear(cache):
    cache.set("a", 1)
    cache.set(f"image:{uuid.uuid4()}:user:x:metadata", {"id": 1})
    assert cache.delete("a") is True
    assert cache.get("a") is None
    cache.clear()
    assert len(cache) == 0
    assert cache.volume() == 0


def test_prefix_invalidation_removes_only_that_bucket(cache):
    first, second = uuid.uuid4(), uuid.uuid4()
    cache.set(f"project_images:{first}:user:a:skip:0", [1])
    cache.set(f"project_images:{first}:user:b:skip:0", [2])
    cache.set(f"project_images:{second}:user:a:skip:0", [3])
    cache.set(f"image:{first}:user:a:metadata", {"keep": True})
    assert cache.clear_pattern(f"project_images:{first}:") == 2
    assert cache.get(f"project_images:{first}:user:a:skip:0") is None
    assert cache.get(f"project_images:{second}:user:a:skip:0") == [3]
    assert cache.get(f"image:{first}:user:a:metadata") == {"keep": True}


def test_substring_pattern_scans_keys(cache):
    cache.set("project:123:images", ["a"])
    cache.set("project:123:metadata", {"n": 1})
    cache.set("project:456:images", ["b"])
    assert cache.clear_pattern("project:123") == 2
    assert sorted(cache.keys()) == ["project:456:images"]


def test_lru_eviction_keeps_recently_read_entries(tmp_path):
    cache = FileCache(tmp_path / "small", size_limit=300 * 1024)
    blob = b"x" * (100 * 1024)
    cache.set("old", blob)
    cache.set("recent", blob)
    past = time.time() - 3600
    for key in ("old", "recent"):
        os.utime(cache._path_for(key), (past, past))
    assert cache.get("recent") == blob  # refreshes its modification time
    cache.set("third", blob)
    cache.set("fourth", blob)  # pushes the cache over its 300 KB limit
    assert cache.get("old") is None
    assert cache.get("recent") == blob
    assert cache.volume() <= 300 * 1024


def test_corrupt_and_truncated_entries_are_misses(cache):
    cache.set("k", {"v": 1})
    path = cache._path_for("k")
    path.write_bytes(path.read_bytes()[:-3])
    assert cache.get("k") is None
    assert not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x80\x04garbage-that-looks-like-a-pickle")
    assert cache.get("k") is None


def test_hash_collision_guard_checks_the_stored_key(cache):
    cache.set("k1", "one")
    target = cache._path_for("k2")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(cache._path_for("k1").read_bytes())
    assert cache.get("k2") is None


def test_concurrent_writers_never_produce_partial_entries(cache):
    key = f"thumbnail:{uuid.uuid4()}:w:1:h:1"
    payloads = [(bytes([i]) * 50_000, "image/png", f"{i}.png") for i in range(8)]
    errors = []

    def write(payload):
        try:
            for _ in range(20):
                cache.set(key, payload)
                assert cache.get(key) in payloads
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(p,)) for p in payloads]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors
    assert cache.get(key) in payloads
    assert not list(Path(cache.directory).rglob("*.tmp"))


def test_legacy_diskcache_files_are_removed(tmp_path, monkeypatch):
    from core.config import settings
    from utils import cache_manager

    legacy = tmp_path / "legacy"
    (legacy / "3f").mkdir(parents=True)
    (legacy / "3f" / "abc.val").write_bytes(b"pickled")
    (legacy / "cache.db").write_bytes(b"sqlite")
    monkeypatch.setattr(settings, "uses_ephemeral_cache_dir", lambda: False)
    monkeypatch.setattr(settings, "CACHE_DIR", str(legacy))
    manager = cache_manager.CacheManager()
    assert not (legacy / "cache.db").exists()
    assert not (legacy / "3f").exists()
    manager.set("k", "v")
    assert manager.get("k") == "v"
