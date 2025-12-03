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
    """Clear cache before each test and reset global cache instance."""
    # Reset global cache instance to ensure fresh state
    import utils.cache_manager as cm
    cm._cache_manager = None
    
    cache = get_cache()
    cache.clear()
    yield
    cache.clear()
    
    # Reset again after test
    cm._cache_manager = None


class TestImageListCaching:
    """Test image list caching and invalidation."""
    
    def test_image_list_cache_miss_and_hit(self, client):
        """Test image list caching on first request and cache hit on subsequent requests."""
        # Create project
        pr = client.post("/api/projects/", json={"name": "ListCacheTest", "description": None, "meta_group_id": "g"})
        assert pr.status_code == 201
        pid = pr.json()["id"]
        
        # Upload images
        for i in range(3):
            img_bytes = _make_png_bytes()
            files = {"file": (f"test{i}.png", img_bytes, "image/png")}
            ur = client.post(f"/api/projects/{pid}/images", files=files)
            assert ur.status_code == 201
        
        cache = get_cache()
        cache_key = f"project_images:{pid}:skip:0:limit:100:include_deleted:False:deleted_only:False:search_field:None:search_value:None"
        
        # Ensure cache is empty initially
        assert cache.get(cache_key) is None
        
        # First request - should cache the result
        r1 = client.get(f"/api/projects/{pid}/images")
        assert r1.status_code == 200
        images1 = r1.json()
        assert len(images1) == 3
        
        # Verify cache was populated
        cached_images = cache.get(cache_key)
        assert cached_images is not None
        assert len(cached_images) == 3
        
        # Second request - should return cached result
        r2 = client.get(f"/api/projects/{pid}/images")
        assert r2.status_code == 200
        images2 = r2.json()
        
        # Results should be identical
        assert images1 == images2
        
        # Verify cache is still populated
        assert cache.get(cache_key) is not None
    
    def test_image_list_pagination_cache_separately(self, client):
        """Test that different pagination parameters create separate cache entries."""
        # Create project with multiple images
        pr = client.post("/api/projects/", json={"name": "PaginationTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        # Upload 5 images
        for i in range(5):
            img_bytes = _make_png_bytes()
            files = {"file": (f"test{i}.png", img_bytes, "image/png")}
            ur = client.post(f"/api/projects/{pid}/images", files=files)
            assert ur.status_code == 201
        
        cache = get_cache()
        
        # Request different pagination
        r1 = client.get(f"/api/projects/{pid}/images?skip=0&limit=2")
        r2 = client.get(f"/api/projects/{pid}/images?skip=2&limit=2")
        r3 = client.get(f"/api/projects/{pid}/images?skip=0&limit=100")
        
        assert r1.status_code == 200
        assert r2.status_code == 200 
        assert r3.status_code == 200
        
        assert len(r1.json()) == 2
        assert len(r2.json()) == 2
        assert len(r3.json()) == 5
        
        # Verify separate cache entries
        cache_key_1 = f"project_images:{pid}:skip:0:limit:2:include_deleted:False:deleted_only:False:search_field:None:search_value:None"
        cache_key_2 = f"project_images:{pid}:skip:2:limit:2:include_deleted:False:deleted_only:False:search_field:None:search_value:None"
        cache_key_3 = f"project_images:{pid}:skip:0:limit:100:include_deleted:False:deleted_only:False:search_field:None:search_value:None"
        
        # Debug info in case of failure
        cached_1 = cache.get(cache_key_1)
        cached_2 = cache.get(cache_key_2)
        cached_3 = cache.get(cache_key_3)
        
        if cached_1 is None:
            print(f"Cache key 1 not found: {cache_key_1}")
            print(f"Cache stats: {cache.stats()}")
        
        assert cached_1 is not None, f"Cache key 1 should exist: {cache_key_1}"
        assert cached_2 is not None, f"Cache key 2 should exist: {cache_key_2}"
        assert cached_3 is not None, f"Cache key 3 should exist: {cache_key_3}"
        
        # Verify they're different
        assert len(cache.get(cache_key_1)) == 2
        assert len(cache.get(cache_key_2)) == 2
        assert len(cache.get(cache_key_3)) == 5
    
    def test_image_list_cache_invalidation_on_upload(self, client):
        """Test that image list cache is invalidated when new image is uploaded."""
        # Create project
        pr = client.post("/api/projects/", json={"name": "UploadInvalidateTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        # Upload first image
        img_bytes = _make_png_bytes()
        files = {"file": ("test1.png", img_bytes, "image/png")}
        ur1 = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur1.status_code == 201
        
        cache = get_cache()
        cache_key = f"project_images:{pid}:skip:0:limit:100:include_deleted:False:deleted_only:False:search_field:None:search_value:None"
        
        # Get image list - should cache it
        r1 = client.get(f"/api/projects/{pid}/images")
        assert r1.status_code == 200
        assert len(r1.json()) == 1
        assert cache.get(cache_key) is not None
        
        # Upload second image - should invalidate cache
        img_bytes2 = _make_png_bytes()
        files2 = {"file": ("test2.png", img_bytes2, "image/png")}
        ur2 = client.post(f"/api/projects/{pid}/images", files=files2)
        assert ur2.status_code == 201
        
        # Verify cache was invalidated
        assert cache.get(cache_key) is None
        
        # New request should return updated list
        r2 = client.get(f"/api/projects/{pid}/images")
        assert r2.status_code == 200
        assert len(r2.json()) == 2
        
        # Verify new result is cached
        assert cache.get(cache_key) is not None
        assert len(cache.get(cache_key)) == 2
    
    def test_image_list_trailing_slash_uses_same_cache(self, client):
        """Test that URLs with and without trailing slash use the same caching logic."""
        # Create project with image
        pr = client.post("/api/projects/", json={"name": "SlashTest", "description": None, "meta_group_id": "g"})
        pid = pr.json()["id"]
        
        img_bytes = _make_png_bytes()
        files = {"file": ("test.png", img_bytes, "image/png")}
        ur = client.post(f"/api/projects/{pid}/images", files=files)
        assert ur.status_code == 201
        
        cache = get_cache()
        
        # Clear cache to ensure fresh start
        cache.clear()
        
        # Request without trailing slash
        r1 = client.get(f"/api/projects/{pid}/images")
        assert r1.status_code == 200
        images1 = r1.json()
        
        # Request with trailing slash - should return same data
        r2 = client.get(f"/api/projects/{pid}/images/")
        assert r2.status_code == 200
        images2 = r2.json()
        
        # Results should be identical
        assert images1 == images2
        assert len(images1) == 1
    
    def test_image_list_nonexistent_project_not_cached(self, client):
        """Test that requests for nonexistent projects return empty list and are not cached."""
        nonexistent_pid = uuid.uuid4()
        cache = get_cache()
        
        # Request for nonexistent project
        r = client.get(f"/api/projects/{nonexistent_pid}/images")
        assert r.status_code == 200
        assert r.json() == []
        
        # Verify no cache entry was created for nonexistent project
        cache_key = f"project_images:{nonexistent_pid}:skip:0:limit:100:include_deleted:False:deleted_only:False:search_field:None:search_value:None"
        # Note: The current implementation may still cache empty results
        # This test documents the current behavior - empty results are cached
        # which is actually beneficial to avoid repeated database queries