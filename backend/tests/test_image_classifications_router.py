import io
import uuid
import pytest
from PIL import Image


def _make_png_bytes(size=(10, 10), color=(0, 128, 255)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_create_and_list_image_classifications(client):
    # Create project
    pr = client.post("/api/projects/", json={"name": "P5", "description": None, "meta_group_id": "g"})
    assert pr.status_code == 201
    pid = pr.json()["id"]

    # Upload image
    img_bytes = _make_png_bytes()
    files = {"file": ("c.png", img_bytes, "image/png")}
    ur = client.post(f"/api/projects/{pid}/images", files=files)
    assert ur.status_code == 201
    image_id = ur.json()["id"]

    # Create image class
    cr = client.post(
        f"/api/projects/{pid}/classes",
        json={"name": "car", "description": None, "project_id": pid},
    )
    assert cr.status_code == 201
    class_id = cr.json()["id"]

    # Create classification (this used to 500 due to missing crud.get_image)
    clr = client.post(
        f"/api/images/{image_id}/classifications",
        json={"image_id": image_id, "class_id": class_id},
    )
    assert clr.status_code == 201, clr.text
    body = clr.json()
    assert body["image_id"] == image_id
    assert body["class_id"] == class_id
    assert body["created_by_id"] is not None

    # List classifications for the image
    lr = client.get(f"/api/images/{image_id}/classifications")
    assert lr.status_code == 200
    items = lr.json()
    assert isinstance(items, list) and len(items) >= 1


def test_delete_classification(client):
    """Any project member can delete a classification via the API."""
    # Setup: project, image, class, classification
    pr = client.post("/api/projects/", json={"name": "DelTest", "description": None, "meta_group_id": "g"})
    assert pr.status_code == 201
    pid = pr.json()["id"]

    img_bytes = _make_png_bytes()
    ur = client.post(f"/api/projects/{pid}/images", files={"file": ("d.png", img_bytes, "image/png")})
    assert ur.status_code == 201
    image_id = ur.json()["id"]

    cr = client.post(f"/api/projects/{pid}/classes", json={"name": "label", "description": None, "project_id": pid})
    assert cr.status_code == 201
    class_id = cr.json()["id"]

    clr = client.post(f"/api/images/{image_id}/classifications", json={"image_id": image_id, "class_id": class_id})
    assert clr.status_code == 201
    classification_id = clr.json()["id"]

    # Delete the classification
    dr = client.delete(f"/api/classifications/{classification_id}")
    assert dr.status_code == 204

    # Verify it's gone
    lr = client.get(f"/api/images/{image_id}/classifications")
    assert lr.status_code == 200
    assert len(lr.json()) == 0


def test_delete_classification_not_found(client):
    """Deleting a non-existent classification returns 404."""
    fake_id = str(uuid.uuid4())
    dr = client.delete(f"/api/classifications/{fake_id}")
    assert dr.status_code == 404
