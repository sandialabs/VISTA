from concurrent.futures import Future

from core import group_auth_helper
from main import app
from services.images import volumes as image_volume_service
from utils import cache_manager, volume_cache


class _FakeCacheManager:
    def __init__(self):
        self.values = {"leaked": "value"}
        self.clear_calls = 0

    def clear(self):
        self.clear_calls += 1
        self.values.clear()


def test_process_state_isolation_restores_only_safe_completed_state(
    monkeypatch,
    backend_process_state_isolation_context,
):
    original_overrides = app.dependency_overrides
    original_override_contents = dict(original_overrides)
    fake_cache_manager = _FakeCacheManager()
    monkeypatch.setattr(cache_manager, "_cache_manager", fake_cache_manager)

    group_key = ("isolation@example.com", "isolation-group", False)
    slice_key = ("isolation-image", "axial", 1, "isolation-version")
    summary_key = ("isolation-image", "isolation-version", 1)
    memmap_key = "/tmp/vista-isolation-volume.npy"
    slice_future_key = ("isolation-future", "axial", 1, "isolation-version")
    summary_future_key = ("isolation-future", "isolation-version", 1)
    slice_future = Future()
    summary_future = Future()

    try:
        with backend_process_state_isolation_context():
            app.dependency_overrides = {object(): object()}
            group_auth_helper._group_membership_cache[group_key] = (True, 0.0)
            with image_volume_service.volume_slice_png_cache_lock:
                image_volume_service.volume_slice_png_cache[slice_key] = b"png"
                image_volume_service.volume_slice_render_futures[slice_future_key] = (
                    slice_future
                )
            with image_volume_service.volume_render_summary_cache_lock:
                image_volume_service.volume_render_summary_cache[summary_key] = {
                    "kind": "test"
                }
                image_volume_service.volume_render_summary_futures[
                    summary_future_key
                ] = summary_future
            with volume_cache._memmap_cache_lock:
                volume_cache._memmap_cache[memmap_key] = object()
                volume_cache._validated_file_signatures[memmap_key] = (1, 1, None)

        assert app.dependency_overrides is original_overrides
        assert app.dependency_overrides == original_override_contents
        assert group_key not in group_auth_helper._group_membership_cache
        assert fake_cache_manager.values == {}
        assert fake_cache_manager.clear_calls == 1
        with image_volume_service.volume_slice_png_cache_lock:
            assert slice_key not in image_volume_service.volume_slice_png_cache
            assert (
                image_volume_service.volume_slice_render_futures[slice_future_key]
                is slice_future
            )
        with image_volume_service.volume_render_summary_cache_lock:
            assert summary_key not in image_volume_service.volume_render_summary_cache
            assert (
                image_volume_service.volume_render_summary_futures[summary_future_key]
                is summary_future
            )
        with volume_cache._memmap_cache_lock:
            assert memmap_key not in volume_cache._memmap_cache
            assert memmap_key not in volume_cache._validated_file_signatures
    finally:
        # Futures represent live work and are intentionally outside the
        # autouse fixture's cleanup boundary, so this test owns their removal.
        with image_volume_service.volume_slice_png_cache_lock:
            image_volume_service.volume_slice_render_futures.pop(slice_future_key, None)
        with image_volume_service.volume_render_summary_cache_lock:
            image_volume_service.volume_render_summary_futures.pop(
                summary_future_key, None
            )


def test_process_state_isolation_does_not_create_cache_manager(
    monkeypatch,
    backend_process_state_isolation_context,
):
    monkeypatch.setattr(cache_manager, "_cache_manager", None)

    with backend_process_state_isolation_context():
        pass

    assert cache_manager._cache_manager is None
