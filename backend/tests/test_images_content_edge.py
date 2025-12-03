import io
import uuid
import pytest
from PIL import Image


def _png_bytes():
    img = Image.new("RGB", (4, 4), (0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


def test_content_disposition_sanitization(client, monkeypatch):
    # Create project and upload image with dangerous filename
    pr = client.post("/api/projects/", json={"name": "PH", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]
    data = _png_bytes()
    ur = client.post(f"/api/projects/{pid}/images", files={"file": ('bad"name\n.png', io.BytesIO(data), "image/png")})
    image_id = ur.json()["id"]

    class Resp:
        def __init__(self, data):
            self._data = data
        def raise_for_status(self):
            return None
        async def aread(self):
            return self._data
        def iter_bytes(self):
            yield self._data

    class Client:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url):
            return Resp(data)

    monkeypatch.setattr("routers.images.httpx.AsyncClient", Client)
    r = client.get(f"/api/images/{image_id}/content")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    # With the new secure implementation, quotes are properly used around the filename
    # and dangerous characters are sanitized out
    assert "\n" not in cd and "\r" not in cd
    # Verify quotes are properly used in the header
    assert 'filename="' in cd


def test_content_http_error(client, monkeypatch):
    # Create project and upload image
    pr = client.post("/api/projects/", json={"name": "PE", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]
    data = _png_bytes()
    ur = client.post(f"/api/projects/{pid}/images", files={"file": ('ok.png', io.BytesIO(data), "image/png")})
    image_id = ur.json()["id"]

    class BadResp(Exception):
        pass

    class Client:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url):
            raise BadResp("boom")

    monkeypatch.setattr("routers.images.httpx.AsyncClient", Client)
    r = client.get(f"/api/images/{image_id}/content")
    assert r.status_code == 500
