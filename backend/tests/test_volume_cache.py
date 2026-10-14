import asyncio
import hashlib
import io
import stat
import threading

import numpy as np
import pytest

from utils import volume_cache
from utils.volume_cache import (
    VolumeCacheError,
    _reset_volume_cache_for_tests,
    build_volume_source_identity,
    ensure_materialized_npy,
    get_npy_volume_handle,
    materialized_npy_path,
)
from utils.volume_loader import MAX_VOLUME_LOAD_BYTES


def _npy_payload(array: np.ndarray) -> bytes:
    output = io.BytesIO()
    np.save(output, array)
    return output.getvalue()


@pytest.fixture(autouse=True)
def reset_process_volume_cache():
    _reset_volume_cache_for_tests()
    yield
    _reset_volume_cache_for_tests()


@pytest.mark.asyncio
async def test_concurrent_cold_requests_stream_once_and_share_read_only_memmap(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    payload = _npy_payload(np.arange(4 * 5 * 6, dtype=np.uint16).reshape((4, 5, 6)))
    identity = build_volume_source_identity(
        image_id="image-1",
        storage_key="project/image-1/volume.npy",
        size_bytes=len(payload),
    )
    downloads = 0

    async def stream_source():
        nonlocal downloads
        downloads += 1
        await asyncio.sleep(0.02)
        midpoint = len(payload) // 2
        yield payload[:midpoint]
        yield payload[midpoint:]

    handles = await asyncio.gather(
        *(get_npy_volume_handle(identity, stream_source) for _ in range(20))
    )

    assert downloads == 1
    assert all(isinstance(handle.array, np.memmap) for handle in handles)
    assert all(handle.array is handles[0].array for handle in handles)
    assert handles[0].array.flags.writeable is False
    assert handles[0].shape == (4, 5, 6)
    assert handles[0].path.read_bytes() == payload


@pytest.mark.asyncio
@pytest.mark.parametrize("channel_count", [3, 4])
async def test_color_volume_uses_same_streamed_read_only_memmap_path(
    monkeypatch, tmp_path, channel_count
):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    source = np.arange(2 * 3 * 4 * channel_count, dtype=np.uint8).reshape(
        (2, 3, 4, channel_count)
    )
    payload = _npy_payload(source)
    identity = build_volume_source_identity(
        image_id=f"image-color-{channel_count}",
        storage_key=f"project/color-{channel_count}.npy",
        size_bytes=len(payload),
    )
    downloads = 0

    async def stream_source():
        nonlocal downloads
        downloads += 1
        yield payload

    first, second = await asyncio.gather(
        get_npy_volume_handle(identity, stream_source),
        get_npy_volume_handle(identity, stream_source),
    )

    assert downloads == 1
    assert first.array is second.array
    assert isinstance(first.array, np.memmap)
    assert first.array.flags.writeable is False
    assert first.shape == source.shape
    np.testing.assert_array_equal(first.array, source)


@pytest.mark.asyncio
async def test_truncated_download_is_not_published_and_can_retry(monkeypatch, tmp_path):
    cache_root = tmp_path / "volumes"
    monkeypatch.setattr(volume_cache.settings, "VOLUME_CACHE_DIR", str(cache_root))
    payload = _npy_payload(np.zeros((2, 3, 4), dtype=np.uint8))
    identity = build_volume_source_identity(
        image_id="image-2",
        storage_key="project/image-2/volume.npy",
        size_bytes=len(payload),
    )

    async def truncated_source():
        yield payload[:-1]

    with pytest.raises(VolumeCacheError, match="incomplete"):
        await ensure_materialized_npy(identity, truncated_source)

    assert not list(cache_root.glob("*.npy"))
    assert not any(path.name.endswith(".part") for path in cache_root.iterdir())

    downloads = 0

    async def complete_source():
        nonlocal downloads
        downloads += 1
        yield payload

    materialized = await ensure_materialized_npy(identity, complete_source)
    assert downloads == 1
    assert materialized.read_bytes() == payload


@pytest.mark.asyncio
async def test_invalid_download_cleans_unique_partial_file(monkeypatch, tmp_path):
    cache_root = tmp_path / "volumes"
    monkeypatch.setattr(volume_cache.settings, "VOLUME_CACHE_DIR", str(cache_root))
    payload = b"not-a-numpy-volume"
    identity = build_volume_source_identity(
        image_id="image-3",
        storage_key="project/image-3/volume.npy",
        size_bytes=len(payload),
    )

    async def invalid_source():
        yield payload

    with pytest.raises(VolumeCacheError, match="Invalid NumPy volume"):
        await ensure_materialized_npy(identity, invalid_source)

    assert not list(cache_root.glob("*.npy"))
    assert not any(path.name.endswith(".part") for path in cache_root.iterdir())


@pytest.mark.asyncio
async def test_malformed_published_file_is_replaced_atomically(monkeypatch, tmp_path):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    payload = _npy_payload(np.ones((2, 3, 4), dtype=np.uint8))
    identity = build_volume_source_identity(
        image_id="image-corrupt-cache",
        storage_key="project/image-corrupt-cache/volume.npy",
        size_bytes=len(payload),
    )
    cached_path = materialized_npy_path(identity)
    cached_path.write_bytes(b"x" * len(payload))
    downloads = 0

    async def valid_source():
        nonlocal downloads
        downloads += 1
        yield payload

    handle = await get_npy_volume_handle(identity, valid_source)

    assert downloads == 1
    assert isinstance(handle.array, np.memmap)
    assert cached_path.read_bytes() == payload


@pytest.mark.asyncio
async def test_declared_oversize_reports_built_in_limit_without_streaming(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    identity = build_volume_source_identity(
        image_id="image-oversize",
        storage_key="project/image-oversize/volume.npy",
        size_bytes=MAX_VOLUME_LOAD_BYTES + 1,
    )
    streamed = False

    async def unexpected_source():
        nonlocal streamed
        streamed = True
        yield b""

    with pytest.raises(VolumeCacheError, match="built-in materialized-file limit"):
        await ensure_materialized_npy(identity, unexpected_source)

    assert streamed is False


@pytest.mark.asyncio
async def test_changed_source_version_replaces_superseded_materialized_file(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    first_payload = _npy_payload(np.zeros((2, 2, 2), dtype=np.uint8))
    second_payload = _npy_payload(np.ones((2, 2, 2), dtype=np.uint8))
    first = build_volume_source_identity(
        image_id="image-4",
        storage_key="project/image-4/volume.npy",
        size_bytes=len(first_payload),
        metadata={"content_sha256": hashlib.sha256(first_payload).hexdigest()},
    )
    second = build_volume_source_identity(
        image_id="image-4",
        storage_key="project/image-4/volume.npy",
        size_bytes=len(second_payload),
        metadata={"content_sha256": hashlib.sha256(second_payload).hexdigest()},
    )

    async def first_source():
        yield first_payload

    async def second_source():
        yield second_payload

    first_path = await ensure_materialized_npy(first, first_source)
    second_path = await ensure_materialized_npy(second, second_source)

    assert first.version != second.version
    assert first_path != second_path
    assert first_path.exists() is False
    assert second_path.read_bytes() == second_payload


def test_identity_ignores_database_updated_at_and_preserves_empty_field_compatibility():
    kwargs = {
        "image_id": "stable-image",
        "storage_key": "project/stable-image/volume.npy",
        "size_bytes": 1234,
        "created_at": "2026-07-21T10:00:00Z",
    }
    absent = build_volume_source_identity(**kwargs, updated_at=None)
    edited = build_volume_source_identity(**kwargs, updated_at="2026-07-22T11:12:13Z")
    old_fields = (
        "stable-image",
        "project/stable-image/volume.npy",
        "1234",
        "",
        "2026-07-21T10:00:00Z",
        "",
    )

    assert absent.version == edited.version
    assert (
        absent.version
        == hashlib.sha256("\0".join(old_fields).encode("utf-8")).hexdigest()
    )


@pytest.mark.asyncio
async def test_disk_budget_evicts_oldest_entry(monkeypatch, tmp_path):
    cache_root = tmp_path / "volumes"
    payloads = [
        _npy_payload(np.full((2, 2, 2), value, dtype=np.uint8)) for value in range(3)
    ]
    monkeypatch.setattr(volume_cache.settings, "VOLUME_CACHE_DIR", str(cache_root))
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_MAX_BYTES", len(payloads[0]) * 2
    )
    clock = iter(range(1, 100))
    monkeypatch.setattr(volume_cache.time, "time_ns", lambda: next(clock))
    paths = []
    for index, payload in enumerate(payloads):
        identity = build_volume_source_identity(
            image_id=f"budget-image-{index}",
            storage_key=f"project/budget-{index}.npy",
            size_bytes=len(payload),
        )

        async def source(payload=payload):
            yield payload

        paths.append(await ensure_materialized_npy(identity, source))

    assert paths[0].exists() is False
    assert paths[1].exists()
    assert paths[2].exists()
    assert (
        sum(path.stat().st_size for path in cache_root.glob("*.npy"))
        <= len(payloads[0]) * 2
    )


@pytest.mark.asyncio
async def test_eviction_cannot_unlink_entry_before_request_opens_memmap(
    monkeypatch, tmp_path
):
    cache_root = tmp_path / "volumes"
    first_payload = _npy_payload(np.zeros((2, 2, 2), dtype=np.uint8))
    second_payload = _npy_payload(np.ones((2, 2, 2), dtype=np.uint8))
    assert len(first_payload) == len(second_payload)
    monkeypatch.setattr(volume_cache.settings, "VOLUME_CACHE_DIR", str(cache_root))
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_MAX_BYTES", len(first_payload)
    )
    first = build_volume_source_identity(
        image_id="pin-race-first",
        storage_key="project/pin-race-first.npy",
        size_bytes=len(first_payload),
    )
    second = build_volume_source_identity(
        image_id="pin-race-second",
        storage_key="project/pin-race-second.npy",
        size_bytes=len(second_payload),
    )

    async def first_source():
        yield first_payload

    async def second_source():
        yield second_payload

    first_path = await ensure_materialized_npy(first, first_source)
    await asyncio.sleep(0)
    _reset_volume_cache_for_tests()
    open_started = threading.Event()
    allow_open = threading.Event()
    original_open = volume_cache._open_cached_memmap

    def blocked_open(path):
        if path == first_path:
            open_started.set()
            assert allow_open.wait(timeout=5)
        return original_open(path)

    monkeypatch.setattr(volume_cache, "_open_cached_memmap", blocked_open)
    first_task = asyncio.create_task(get_npy_volume_handle(first, first_source))
    assert await asyncio.to_thread(open_started.wait, 5)
    second_task = asyncio.create_task(ensure_materialized_npy(second, second_source))
    await asyncio.sleep(0.05)

    assert first_path.exists()
    assert second_task.done() is False

    allow_open.set()
    first_handle, second_path = await asyncio.gather(first_task, second_task)

    assert int(first_handle.array[0, 0, 0]) == 0
    assert first_path.exists() is False
    assert second_path.exists()


@pytest.mark.asyncio
async def test_cold_publication_stays_locked_until_memmap_is_open(
    monkeypatch, tmp_path
):
    cache_root = tmp_path / "volumes"
    first_payload = _npy_payload(np.full((2, 2, 2), 3, dtype=np.uint8))
    second_payload = _npy_payload(np.full((2, 2, 2), 7, dtype=np.uint8))
    assert len(first_payload) == len(second_payload)
    monkeypatch.setattr(volume_cache.settings, "VOLUME_CACHE_DIR", str(cache_root))
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_MAX_BYTES", len(first_payload)
    )
    first = build_volume_source_identity(
        image_id="cold-race-first",
        storage_key="project/cold-race-first.npy",
        size_bytes=len(first_payload),
    )
    second = build_volume_source_identity(
        image_id="cold-race-second",
        storage_key="project/cold-race-second.npy",
        size_bytes=len(second_payload),
    )
    first_path = materialized_npy_path(first)
    publication_started = threading.Event()
    allow_publication = threading.Event()
    original_remember = volume_cache._remember_verified_checksum

    def blocked_after_replace(path, expected_sha256):
        if path == first_path:
            assert path.exists()
            publication_started.set()
            assert allow_publication.wait(timeout=5)
        return original_remember(path, expected_sha256)

    async def first_source():
        yield first_payload

    async def second_source():
        yield second_payload

    monkeypatch.setattr(
        volume_cache, "_remember_verified_checksum", blocked_after_replace
    )
    first_task = asyncio.create_task(get_npy_volume_handle(first, first_source))
    assert await asyncio.to_thread(publication_started.wait, 5)
    second_task = asyncio.create_task(ensure_materialized_npy(second, second_source))
    await asyncio.sleep(0.05)

    assert first_path.exists()
    assert second_task.done() is False

    allow_publication.set()
    first_handle, second_path = await asyncio.gather(first_task, second_task)

    assert int(first_handle.array[0, 0, 0]) == 3
    assert first_path.exists() is False
    assert second_path.exists()


@pytest.mark.asyncio
async def test_superseded_source_version_is_removed(monkeypatch, tmp_path):
    cache_root = tmp_path / "volumes"
    monkeypatch.setattr(volume_cache.settings, "VOLUME_CACHE_DIR", str(cache_root))
    first_payload = _npy_payload(np.zeros((2, 2, 2), dtype=np.uint8))
    second_payload = _npy_payload(np.ones((2, 2, 2), dtype=np.uint8))

    async def materialize(payload):
        identity = build_volume_source_identity(
            image_id="same-image",
            storage_key="project/same.npy",
            size_bytes=len(payload),
            metadata={"content_sha256": hashlib.sha256(payload).hexdigest()},
        )

        async def source():
            yield payload

        return await ensure_materialized_npy(identity, source)

    first_path = await materialize(first_payload)
    second_path = await materialize(second_payload)

    assert first_path.exists() is False
    assert second_path.read_bytes() == second_payload


@pytest.mark.asyncio
async def test_sha256_detects_same_size_corruption_and_reopens_memmap(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    payload = _npy_payload(np.arange(8, dtype=np.uint8).reshape((2, 2, 2)))
    corrupt = _npy_payload(np.full((2, 2, 2), 9, dtype=np.uint8))
    assert len(payload) == len(corrupt)
    identity = build_volume_source_identity(
        image_id="checksum-image",
        storage_key="project/checksum.npy",
        size_bytes=len(payload),
        metadata={"content_sha256": hashlib.sha256(payload).hexdigest()},
    )
    downloads = 0

    async def source():
        nonlocal downloads
        downloads += 1
        yield payload

    first = await get_npy_volume_handle(identity, source)
    first.path.write_bytes(corrupt)
    second = await get_npy_volume_handle(identity, source)

    assert downloads == 2
    assert second.array is not first.array
    assert np.array_equal(second.array, np.arange(8, dtype=np.uint8).reshape((2, 2, 2)))


def test_cache_directory_is_private(monkeypatch, tmp_path):
    monkeypatch.setattr(
        volume_cache.settings,
        "VOLUME_CACHE_DIR",
        str(tmp_path / "private-volume-cache"),
    )
    root = volume_cache.volume_cache_root()

    assert stat.S_IMODE(root.stat().st_mode) == 0o700


@pytest.mark.asyncio
async def test_worker_lru_touches_do_not_invalidate_other_worker_checksum_signature(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(
        volume_cache.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volumes")
    )
    payload = _npy_payload(np.arange(8, dtype=np.uint8).reshape((2, 2, 2)))
    identity = build_volume_source_identity(
        image_id="checksum-lru-image",
        storage_key="project/checksum-lru.npy",
        size_bytes=len(payload),
        metadata={"content_sha256": hashlib.sha256(payload).hexdigest()},
    )

    async def source():
        yield payload

    path = await ensure_materialized_npy(identity, source)
    source_mtime_ns = path.stat().st_mtime_ns
    _reset_volume_cache_for_tests()
    hash_calls = 0
    original_hash = volume_cache._hash_file_sha256

    def counted_hash(path):
        nonlocal hash_calls
        hash_calls += 1
        return original_hash(path)

    monkeypatch.setattr(volume_cache, "_hash_file_sha256", counted_hash)
    await ensure_materialized_npy(identity, source)
    worker_one_signatures = dict(volume_cache._validated_file_signatures)
    _reset_volume_cache_for_tests()
    await ensure_materialized_npy(identity, source)
    volume_cache._validated_file_signatures.clear()
    volume_cache._validated_file_signatures.update(worker_one_signatures)
    await ensure_materialized_npy(identity, source)

    assert hash_calls == 3
    assert path.stat().st_mtime_ns == source_mtime_ns
    assert isinstance(
        volume_cache._read_cache_metadata(path).get("last_access_ns"), int
    )
    assert all(
        not key.endswith(".part") for key in volume_cache._validated_file_signatures
    )
