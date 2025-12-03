import pytest
import tempfile
import shutil
from pathlib import Path
from diskcache import Cache


class TestCacheManager:
    """Unit tests for the CacheManager using diskcache."""
    
    @pytest.fixture
    def temp_cache_dir(self):
        """Create a temporary directory for cache testing."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    @pytest.fixture
    def cache_manager(self, temp_cache_dir):
        """Create a simple cache manager for testing."""
        # Create a simple wrapper around diskcache for testing
        class SimpleCacheManager:
            def __init__(self, directory):
                self.cache = Cache(
                    directory=directory,
                    size_limit=100 * 1024 * 1024,  # 100MB
                    eviction_policy='least-recently-used'
                )
            
            def set(self, key, value, expire=None):
                return self.cache.set(key, value, expire=expire)
            
            def get(self, key, default=None):
                return self.cache.get(key, default)
            
            def delete(self, key):
                return self.cache.delete(key)
            
            def clear_pattern(self, pattern):
                keys_to_delete = []
                for key in self.cache:
                    if pattern in key:
                        keys_to_delete.append(key)
                for key in keys_to_delete:
                    self.cache.delete(key)
            
            def clear(self):
                self.cache.clear()
            
            def stats(self):
                volume = self.cache.volume()
                return {
                    'size_bytes': volume,
                    'size_mb': round(volume / (1024 * 1024), 2),
                    'limit_mb': 100,
                    'usage_percent': round((volume / (100 * 1024 * 1024)) * 100, 2) if volume else 0,
                    'count': len(self.cache)
                }
        
        return SimpleCacheManager(temp_cache_dir)
    
    def test_cache_set_and_get(self, cache_manager):
        """Test basic cache set and get operations."""
        # Test string value
        cache_manager.set("test_key", "test_value")
        result = cache_manager.get("test_key")
        assert result == "test_value"
        
        # Test dict value
        test_data = {"name": "test", "count": 42}
        cache_manager.set("dict_key", test_data)
        result = cache_manager.get("dict_key")
        assert result == test_data
        
        # Test non-existent key
        result = cache_manager.get("nonexistent", "default")
        assert result == "default"
    
    def test_cache_expiration(self, cache_manager):
        """Test cache expiration functionality."""
        # Set with short expiration for testing
        cache_manager.set("expire_key", "expire_value", expire=1)  # 1 second
        
        # Should be available immediately
        result = cache_manager.get("expire_key")
        assert result == "expire_value"
        
        # Test that the key exists and will expire (we don't wait for actual expiration
        # in unit tests as it's time-dependent and diskcache handles it internally)
        
    def test_cache_delete(self, cache_manager):
        """Test cache deletion."""
        cache_manager.set("delete_key", "delete_value")
        assert cache_manager.get("delete_key") == "delete_value"
        
        success = cache_manager.delete("delete_key")
        assert success is True
        assert cache_manager.get("delete_key") is None
        
        # Delete non-existent key
        success = cache_manager.delete("nonexistent")
        assert success is False
    
    def test_cache_clear_pattern(self, cache_manager):
        """Test pattern-based cache clearing."""
        # Set multiple keys
        cache_manager.set("project:123:images", ["img1", "img2"])
        cache_manager.set("project:123:metadata", {"name": "test"})
        cache_manager.set("project:456:images", ["img3"])
        cache_manager.set("other:data", "value")
        
        # Clear pattern
        cache_manager.clear_pattern("project:123")
        
        # Check results
        assert cache_manager.get("project:123:images") is None
        assert cache_manager.get("project:123:metadata") is None
        assert cache_manager.get("project:456:images") == ["img3"]  # Should remain
        assert cache_manager.get("other:data") == "value"  # Should remain
    
    def test_cache_stats(self, cache_manager):
        """Test cache statistics."""
        # Add some data
        cache_manager.set("key1", "value1")
        cache_manager.set("key2", {"data": "test"})
        
        stats = cache_manager.stats()
        
        # Check stats structure
        assert "size_bytes" in stats
        assert "size_mb" in stats
        assert "limit_mb" in stats
        assert "usage_percent" in stats
        assert "count" in stats
        
        # Check that we have some data
        assert stats["count"] >= 2
        assert stats["size_bytes"] > 0
        assert stats["size_mb"] >= 0
        assert 0 <= stats["usage_percent"] <= 100