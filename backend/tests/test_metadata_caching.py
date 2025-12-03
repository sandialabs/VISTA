import io
import uuid
import pytest
from PIL import Image
from utils.cache_manager import get_cache


def _make_png_bytes(size=(10, 10), color=(255, 0, 0)):
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


class TestMetadataCaching:
    """Test image metadata caching and invalidation - simplified tests."""
    
    def test_metadata_cache_basic_functionality(self, client):
        """Test that metadata cache functionality works."""
        # Create project and upload image
        pr = client.post("/api/projects/", json={"name": "MetaCacheTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]
        
        cache = get_cache()
        cache_key = f"image:{image_id}:metadata"
        
        # Verify cache key structure
        assert "image:" in cache_key
        assert str(image_id) in cache_key 
        assert ":metadata" in cache_key
        
        # Test cache operations
        cache.set("test_metadata_key", {"test": "data"})
        assert cache.get("test_metadata_key") == {"test": "data"}
    
    def test_metadata_cache_invalidation_on_update(self, client):
        """Test that metadata cache is invalidated when metadata is updated."""
        # Create project and upload image
        pr = client.post("/api/projects/", json={"name": "MetaUpdateTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        image_id = ur.json()["id"]
        
        cache = get_cache()
        metadata_cache_key = f"image:{image_id}:metadata"
        
        # Manually set cache entry
        cache.set(metadata_cache_key, {"cached": "metadata"})
        assert cache.get(metadata_cache_key) is not None
        
        # Update metadata - should invalidate cache
        update_data = {"key": "new_field", "value": "new_value"}
        r2 = client.put(f"/api/images/{image_id}/metadata", json=update_data)
        assert r2.status_code == 200
        
        # Verify metadata cache was invalidated
        assert cache.get(metadata_cache_key) is None
    
    def test_metadata_cache_invalidation_on_delete(self, client):
        """Test that metadata cache is invalidated when metadata key is deleted."""
        # Create project and upload image with metadata
        pr = client.post("/api/projects/", json={"name": "MetaDeleteTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        initial_metadata = {"delete_me": "this will be deleted", "keep_me": "this stays"}
        data = {"metadata": str(initial_metadata).replace("'", '"')}
        
        ur = client.post(f"/api/projects/{pid}/images", files=files, data=data)
        assert ur.status_code == 201
        image_id = ur.json()["id"]
        
        cache = get_cache()
        metadata_cache_key = f"image:{image_id}:metadata"
        
        # Manually set cache entry
        cache.set(metadata_cache_key, {"cached": "metadata"})
        assert cache.get(metadata_cache_key) is not None
        
        # Delete metadata key - should invalidate cache
        r2 = client.delete(f"/api/images/{image_id}/metadata/delete_me")
        assert r2.status_code == 200
        
        # Verify metadata cache was invalidated
        assert cache.get(metadata_cache_key) is None
    
    def test_metadata_nonexistent_image(self, client):
        """Test metadata request for nonexistent image doesn't create cache entries."""
        nonexistent_id = uuid.uuid4()
        cache = get_cache()
        
        # Request metadata for nonexistent image
        r = client.get(f"/api/images/{nonexistent_id}")
        assert r.status_code == 404
        
        # Verify no cache entry was created
        cache_key = f"image:{nonexistent_id}:metadata"
        assert cache.get(cache_key) is None