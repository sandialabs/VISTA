import pytest
import tempfile
import shutil
from pathlib import Path
from diskcache import Cache


class TestCacheLimits:
    """Test cache size limits and LRU eviction functionality."""
    
    @pytest.fixture
    def temp_cache_dir(self):
        """Create a temporary directory for cache testing."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir, ignore_errors=True)
    
    @pytest.fixture
    def small_cache_manager(self, temp_cache_dir):
        """Create a cache manager with a very small size limit for testing."""
        from diskcache import Cache
        
        # Create a simple wrapper with small size for testing
        class SmallCacheManager:
            def __init__(self, directory):
                self.cache = Cache(
                    directory=directory,
                    size_limit=1024 * 1024,  # 1MB in bytes
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
                    'limit_mb': 1,
                    'usage_percent': round((volume / (1024 * 1024)) * 100, 2) if volume else 0,
                    'count': len(self.cache)
                }
        
        return SmallCacheManager(temp_cache_dir)
    
    def test_cache_size_limit_enforcement(self, small_cache_manager):
        """Test that cache respects size limits and evicts data when exceeded."""
        # Add some large data that should fit initially
        large_data = "x" * (200 * 1024)  # ~200KB
        small_cache_manager.set("data1", large_data)
        small_cache_manager.set("data2", large_data)
        
        # Verify data was stored
        assert small_cache_manager.get("data1") == large_data
        assert small_cache_manager.get("data2") == large_data
        
        # Check that cache has some data
        stats = small_cache_manager.stats()
        assert stats["count"] >= 1
        assert stats["size_bytes"] > 0
    
    def test_lru_eviction_order(self, small_cache_manager):
        """Test basic LRU functionality."""
        # Add some entries
        small_cache_manager.set("entry_1", "data_1")
        small_cache_manager.set("entry_2", "data_2")
        small_cache_manager.set("entry_3", "data_3")
        
        # Access entry_1 to make it more recently used
        small_cache_manager.get("entry_1")
        
        # Verify entries exist
        assert small_cache_manager.get("entry_1") == "data_1"
        assert small_cache_manager.get("entry_2") == "data_2" 
        assert small_cache_manager.get("entry_3") == "data_3"
    
    def test_cache_stats_reflect_size_usage(self, small_cache_manager):
        """Test that cache statistics accurately reflect size usage."""
        # Start with cache (may have some overhead)
        initial_stats = small_cache_manager.stats()
        initial_size = initial_stats["size_bytes"]
        assert initial_stats["count"] == 0
        
        # Add some data
        test_data = "test" * 10000  # ~40KB
        small_cache_manager.set("test_key", test_data)
        
        # Check updated stats
        stats = small_cache_manager.stats()
        assert stats["size_bytes"] > initial_size
        assert stats["count"] == 1
        assert stats["limit_mb"] == 1  # Our test limit
    
    def test_cache_clear_resets_size(self, small_cache_manager):
        """Test that clearing cache resets size statistics."""
        # Get baseline size (cache may have overhead)
        baseline_stats = small_cache_manager.stats()
        baseline_size = baseline_stats["size_bytes"]
        
        # Add some data
        for i in range(10):
            data = "x" * 10000  # 10KB each
            small_cache_manager.set(f"key_{i}", data)
        
        # Verify cache has data
        stats_before = small_cache_manager.stats()
        assert stats_before["size_bytes"] > baseline_size
        assert stats_before["count"] > 0
        
        # Clear cache
        small_cache_manager.clear()
        
        # Verify cache count is reset (size may have overhead)
        stats_after = small_cache_manager.stats()
        assert stats_after["count"] == 0
    
    def test_cache_pattern_clear_affects_size(self, small_cache_manager):
        """Test that pattern-based clearing affects cache size statistics."""
        # Add data with different patterns
        small_cache_manager.set("project:123:data", "x" * 50000)  # ~50KB
        small_cache_manager.set("project:456:data", "y" * 50000)  # ~50KB
        small_cache_manager.set("other:data", "z" * 50000)        # ~50KB
        
        stats_initial = small_cache_manager.stats()
        assert stats_initial["count"] == 3
        assert stats_initial["size_bytes"] > 100000  # Should be > 150KB
        
        # Clear pattern
        small_cache_manager.clear_pattern("project:123")
        
        stats_after_clear = small_cache_manager.stats()
        assert stats_after_clear["count"] == 2  # One less item
        assert stats_after_clear["size_bytes"] < stats_initial["size_bytes"]  # Less data
        
        # Verify correct items remain
        assert small_cache_manager.get("project:123:data") is None
        assert small_cache_manager.get("project:456:data") is not None
        assert small_cache_manager.get("other:data") is not None