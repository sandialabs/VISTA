import os
from pathlib import Path
from typing import Optional, Any
from diskcache import Cache
from core.config import settings

class CacheManager:
    """Simple wrapper around diskcache with project-specific configuration."""
    
    def __init__(self):
        import tempfile
        
        # In testing/CI environments, prefer temp directory for cache
        if os.getenv('CI') or os.getenv('PYTEST_CURRENT_TEST'):
            cache_dir = Path(tempfile.mkdtemp(prefix='test_cache_'))
        else:
            cache_dir = Path(__file__).parent.parent / '_cache'
            
        cache_dir.mkdir(exist_ok=True)
        
        # Convert MB to bytes for size limit
        size_limit = settings.CACHE_SIZE_MB * 1024 * 1024
        
        try:
            self.cache = Cache(
                directory=str(cache_dir),
                size_limit=size_limit,
                eviction_policy='least-recently-used'
            )
        except Exception as e:
            # Fallback to in-memory dict for testing environments where disk cache might fail
            import logging
            logging.warning(f"Failed to initialize disk cache, falling back to in-memory cache: {e}")
            self._memory_cache = {}
            self.cache = None
    
    def set(self, key: str, value: Any, expire: Optional[float] = None):
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
            keys_to_delete = [key for key in self._memory_cache.keys() if pattern in key]
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
                'size_bytes': volume,
                'size_mb': round(volume / (1024 * 1024), 2),
                'limit_mb': settings.CACHE_SIZE_MB,
                'usage_percent': round((volume / size_limit) * 100, 2) if size_limit > 0 else 0,
                'count': len(self.cache)
            }
        else:
            return {
                'size_bytes': 0,
                'size_mb': 0,
                'limit_mb': settings.CACHE_SIZE_MB,
                'usage_percent': 0,
                'count': len(self._memory_cache)
            }

import threading

# Global cache manager instance with thread lock
_cache_manager: Optional[CacheManager] = None
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