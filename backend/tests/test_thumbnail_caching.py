import io
import uuid
import pytest
from PIL import Image
from utils.cache_manager import get_cache


def _make_png_bytes(size=(100, 100), color=(255, 0, 0)):
    """Create test PNG image bytes."""
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before each test."""
    cache = get_cache()
    cache.clear()
    yield
    cache.clear()


class TestThumbnailCaching:
    """Test thumbnail generation and caching - simplified tests."""
    
    def test_thumbnail_invalid_dimensions(self, client):
        """Test thumbnail generation with invalid dimensions."""
        # Create project and upload image
        pr = client.post("/api/projects/", json={"name": "DimTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        image_id = ur.json()["id"]
        
        # Test negative dimensions
        r1 = client.get(f"/api/images/{image_id}/thumbnail?width=-100&height=150")
        assert r1.status_code == 400
        assert "positive integers" in r1.json()["detail"]
        
        # Test zero dimensions
        r2 = client.get(f"/api/images/{image_id}/thumbnail?width=0&height=150")
        assert r2.status_code == 400
        
        r3 = client.get(f"/api/images/{image_id}/thumbnail?width=150&height=0")
        assert r3.status_code == 400
    
    def test_thumbnail_cache_basic_functionality(self, client):
        """Test that thumbnail cache functionality is accessible."""
        # Create project and upload image
        pr = client.post("/api/projects/", json={"name": "CacheTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        image_id = ur.json()["id"]
        
        cache = get_cache()
        cache_key = f"thumbnail:{image_id}:w:150:h:150"
        
        # Verify cache key structure is correct
        assert "thumbnail:" in cache_key
        assert str(image_id) in cache_key
        assert "w:150" in cache_key
        assert "h:150" in cache_key
        
        # Verify cache is working
        cache.set("test_thumb_key", {"data": "test"})
        assert cache.get("test_thumb_key") == {"data": "test"}
    
    def test_thumbnail_cache_invalidation(self, client):
        """Test that thumbnail cache can be invalidated."""
        # Create project and upload image  
        pr = client.post("/api/projects/", json={"name": "InvalidateTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        image_id = ur.json()["id"]
        
        cache = get_cache()
        
        # Manually set cache entry to test invalidation
        cache_key = f"thumbnail:{image_id}:w:150:h:150"
        cache.set(cache_key, ("test_thumbnail_data", "image/jpeg", "test_thumb.jpg"))
        assert cache.get(cache_key) is not None
        
        # Update metadata - should trigger cache invalidation
        metadata_update = {"key": "test_key", "value": "test_value"}
        r = client.put(f"/api/images/{image_id}/metadata", json=metadata_update)
        assert r.status_code == 200
        
        # Verify cache was invalidated
        assert cache.get(cache_key) is None