import io
import uuid
import pytest
from PIL import Image


def _img():
    import io
    from PIL import Image
    img = Image.new("RGB", (8, 8), (0, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_update_and_delete_metadata(client):
    # Create project and upload image
    pr = client.post("/api/projects/", json={"name": "Px", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]
    ur = client.post(f"/api/projects/{pid}/images", files={"file": ("c.png", _img(), "image/png")})
    assert ur.status_code == 201
    image_id = ur.json()["id"]

    # Update metadata
    r1 = client.put(f"/api/images/{image_id}/metadata", json={"key": "k", "value": 1})
    assert r1.status_code == 200
    assert r1.json()["metadata"]["k"] == 1

    # Delete metadata key
    r2 = client.delete(f"/api/images/{image_id}/metadata/k")
    assert r2.status_code == 200
    assert "k" not in r2.json().get("metadata", {})
