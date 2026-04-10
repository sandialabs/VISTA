import io
from PIL import Image


def _make_png_bytes(size=(10, 10), color=(0, 128, 255)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_comment_response_includes_author(client):
    """Comments returned by the API must include the author object with email."""
    # Setup: project + image
    pr = client.post("/api/projects/", json={"name": "CmtTest", "description": None, "meta_group_id": "g"})
    assert pr.status_code == 201
    pid = pr.json()["id"]

    ur = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("img.png", _make_png_bytes(), "image/png")},
    )
    assert ur.status_code == 201
    image_id = ur.json()["id"]

    # Create a comment
    cr = client.post(f"/api/images/{image_id}/comments", json={"text": "Looks good"})
    assert cr.status_code == 201
    body = cr.json()

    # The create response must include the author
    assert body.get("author") is not None, "author missing from create response"
    assert body["author"].get("email") is not None, "author.email missing from create response"

    # List comments -- author must also be present
    lr = client.get(f"/api/images/{image_id}/comments")
    assert lr.status_code == 200
    comments = lr.json()
    assert len(comments) >= 1
    for comment in comments:
        assert comment.get("author") is not None, "author missing from list response"
        assert comment["author"].get("email") is not None, "author.email missing from list response"
