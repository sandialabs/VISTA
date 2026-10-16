import logging
import tempfile
import threading
import uuid
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from diskcache import Cache

from core.config import settings

logger = logging.getLogger(__name__)


class CacheManager:
    """Simple wrapper around diskcache with project-specific configuration."""

    def __init__(self):
        # In testing/CI environments, prefer temp directory for cache
        if settings.uses_ephemeral_cache_dir():
            cache_dir = Path(tempfile.mkdtemp(prefix="test_cache_"))
        elif settings.CACHE_DIR:
            # Use configured cache directory (for Docker environments)
            cache_dir = Path(settings.CACHE_DIR)
        else:
            cache_dir = Path(__file__).parent.parent / "_cache"

        cache_dir.mkdir(exist_ok=True)

        # Convert MB to bytes for size limit
        size_limit = settings.CACHE_SIZE_MB * 1024 * 1024

        try:
            self.cache = Cache(
                directory=str(cache_dir),
                size_limit=size_limit,
                eviction_policy="least-recently-used",
            )
        except Exception as e:
            # Fallback to memory for test environments where disk cache might fail.
            import logging

            logging.warning(
                f"Failed to initialize disk cache, falling back to in-memory cache: {e}"
            )
            self._memory_cache = {}
            self.cache = None

    def set(self, key: str, value: Any, expire: float | None = None):
        """Set a cache entry with optional expiration in seconds."""
        if self.cache is not None:
            return self.cache.set(key, value, expire=expire)
        else:
            # Simple in-memory cache without expiration for testing
            self._memory_cache[key] = value
            return True

    def get(self, key: str, default: Any = None) -> Any:
        """Get a cache entry, return default if not found."""
        if self.cache is not None:
            return self.cache.get(key, default)
        else:
            return self._memory_cache.get(key, default)

    def delete(self, key: str) -> bool:
        """Delete a cache entry."""
        if self.cache is not None:
            return self.cache.delete(key)
        else:
            return self._memory_cache.pop(key, None) is not None

    def clear_pattern(self, pattern: str):
        """Clear all cache entries whose keys contain the pattern."""
        if self.cache is not None:
            keys_to_delete = []
            for key in self.cache:
                if pattern in key:
                    keys_to_delete.append(key)

            for key in keys_to_delete:
                self.cache.delete(key)
        else:
            keys_to_delete = [key for key in self._memory_cache if pattern in key]
            for key in keys_to_delete:
                del self._memory_cache[key]

    def clear(self):
        """Clear all cache entries."""
        if self.cache is not None:
            self.cache.clear()
        else:
            self._memory_cache.clear()

    def stats(self) -> dict:
        """Get cache statistics."""
        if self.cache is not None:
            volume = self.cache.volume()
            size_limit = settings.CACHE_SIZE_MB * 1024 * 1024

            return {
                "size_bytes": volume,
                "size_mb": round(volume / (1024 * 1024), 2),
                "limit_mb": settings.CACHE_SIZE_MB,
                "usage_percent": round((volume / size_limit) * 100, 2)
                if size_limit > 0
                else 0,
                "count": len(self.cache),
            }
        else:
            return {
                "size_bytes": 0,
                "size_mb": 0,
                "limit_mb": settings.CACHE_SIZE_MB,
                "usage_percent": 0,
                "count": len(self._memory_cache),
            }


# Global cache manager instance with thread lock
_cache_manager: CacheManager | None = None
_cache_lock = threading.Lock()


def get_cache() -> CacheManager:
    """Get or create the global cache manager instance (thread-safe)."""
    global _cache_manager
    if _cache_manager is None:
        with _cache_lock:
            # Double-check locking pattern
            if _cache_manager is None:
                _cache_manager = CacheManager()
    return _cache_manager


# Response cache keys. Every cached response and every invalidation builds its
# key here so the patterns cannot drift apart. Keys are per-user so cached
# responses never leak across group memberships.


def project_images_key(
    project_id: uuid.UUID,
    user_email: str,
    *,
    skip: int,
    limit: int,
    include_deleted: bool,
    deleted_only: bool,
    search_field: str | None,
    search_value: str | None,
    group_id: uuid.UUID | None,
    ungrouped: bool,
) -> str:
    return (
        f"{_project_images_prefix(project_id)}user:{user_email}:skip:{skip}"
        f":limit:{limit}:include_deleted:{include_deleted}"
        f":deleted_only:{deleted_only}:search_field:{search_field}"
        f":search_value:{search_value}:group_id:{group_id}:ungrouped:{ungrouped}"
    )


def image_metadata_key(image_id: uuid.UUID, user_email: str) -> str:
    return f"{_image_prefix(image_id)}user:{user_email}:metadata"


def thumbnail_key(image_id: uuid.UUID, width: int, height: int) -> str:
    return f"{_thumbnail_prefix(image_id)}w:{width}:h:{height}"


def _project_images_prefix(project_id: uuid.UUID) -> str:
    return f"project_images:{project_id}:"


def _image_prefix(image_id: uuid.UUID) -> str:
    return f"image:{image_id}:"


def _thumbnail_prefix(image_id: uuid.UUID) -> str:
    return f"thumbnail:{image_id}:"


def invalidate_project_images(project_id: uuid.UUID) -> None:
    """Drop every cached image list for a project after a mutation commits."""
    _clear_patterns_best_effort([_project_images_prefix(project_id)])


def invalidate_images(
    project_id: uuid.UUID, image_ids: Iterable[uuid.UUID] = ()
) -> None:
    """Drop a project's image lists plus cached metadata and thumbnails."""
    patterns = [_project_images_prefix(project_id)]
    for image_id in image_ids:
        patterns.extend((_image_prefix(image_id), _thumbnail_prefix(image_id)))
    _clear_patterns_best_effort(patterns)


def _clear_patterns_best_effort(patterns: list[str]) -> None:
    """Cache failures must not turn a committed mutation into an HTTP failure."""
    try:
        cache = get_cache()
    except Exception:
        logger.warning("Response cache unavailable for invalidation", exc_info=True)
        return
    for pattern in patterns:
        try:
            cache.clear_pattern(pattern)
        except Exception:
            logger.warning(
                "Response cache invalidation failed",
                extra={"cache_pattern": pattern},
                exc_info=True,
            )
