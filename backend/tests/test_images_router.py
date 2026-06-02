import io
import uuid
import zipfile
import pytest
import numpy as np
from PIL import Image


def _make_png_bytes(size=(10, 10), color=(255, 0, 0)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _make_encoded_index_png_bytes(index: int) -> io.BytesIO:
    """Create a tiny RGB PNG whose only pixel encodes ``index``."""
    img = Image.new(
        "RGB",
        (1, 1),
        ((index >> 16) & 0xFF, (index >> 8) & 0xFF, index & 0xFF),
    )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _decode_encoded_index_png_bytes(payload: bytes) -> int:
    with Image.open(io.BytesIO(payload)) as img:
        red, green, blue = img.convert("RGB").getpixel((0, 0))
    return (red << 16) | (green << 8) | blue


def _make_tiff_bytes(frame_count=1, size=(10, 10)):
    frames = [Image.new("L", size, color=i * 20) for i in range(frame_count)]
    buf = io.BytesIO()
    frames[0].save(buf, format="TIFF", save_all=frame_count > 1, append_images=frames[1:])
    buf.seek(0)
    return buf


def _make_raster_bytes(fmt: str, size=(12, 10), color=(64, 128, 192)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return buf


def _create_project(client, name="Synthetic Formats"):
    pr = client.post("/api/projects/", json={"name": name, "description": None, "meta_group_id": "g"})
    assert pr.status_code == 201
    return pr.json()["id"]


@pytest.mark.parametrize(
    "filename,content_type,pil_format",
    [
        ("synthetic.png", "image/png", "PNG"),
        ("synthetic.jpg", "image/jpeg", "JPEG"),
        ("synthetic.bmp", "image/bmp", "BMP"),
        ("synthetic.tiff", "image/tiff", "TIFF"),
    ],
)
def test_e2e_supported_2d_formats_upload_and_render_thumbnail(client, monkeypatch, filename, content_type, pil_format):
    pid = _create_project(client, name=f"2d-{pil_format}")
    payload = _make_raster_bytes(pil_format)
    upload = client.post(f"/api/projects/{pid}/images", files={"file": (filename, payload, content_type)})
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    class Resp:
        def __init__(self, data, ctype):
            self._data = data
            self.headers = {"content-type": ctype}
            self.status_code = 200

        def raise_for_status(self):
            return None

        async def aread(self):
            return self._data

        def iter_bytes(self):
            yield self._data

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url):
            return Resp(payload.getvalue(), content_type)

    monkeypatch.setattr("routers.images.httpx.AsyncClient", Client)
    thumb = client.get(f"/api/images/{image_id}/thumbnail?width=16&height=16")
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/")


def test_list_images_nonexistent_project_returns_empty(client):
    pid = uuid.uuid4()
    r = client.get(f"/api/projects/{pid}/images")
    assert r.status_code == 200
    assert r.json() == []


def test_upload_image_and_list(client):
    # Create project
    pr = client.post("/api/projects/", json={"name": "P", "description": None, "meta_group_id": "g"})
    assert pr.status_code == 201
    pid = pr.json()["id"]

    # Upload image
    img_bytes = _make_png_bytes()
    files = {
        "file": ("test.png", img_bytes, "image/png"),
    }
    data = {"metadata": '{"a":1}'}
    ur = client.post(f"/api/projects/{pid}/images", files=files, data=data)
    assert ur.status_code == 201
    body = ur.json()
    assert body["filename"] == "test.png"
    assert body["project_id"] == pid
    # List
    lr = client.get(f"/api/projects/{pid}/images")
    assert lr.status_code == 200
    items = lr.json()
    assert len(items) == 1


def test_upload_image_bad_metadata(client):
    pr = client.post("/api/projects/", json={"name": "P2", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]
    img_bytes = _make_png_bytes()
    files = {"file": ("x.png", img_bytes, "image/png")}
    data = {"metadata": "{not-json}"}
    r = client.post(f"/api/projects/{pid}/images", files=files, data=data)
    assert r.status_code == 400


def test_upload_numpy_voxel_data_accepts_3d_arrays(client):
    pr = client.post("/api/projects/", json={"name": "P5", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]

    voxel_array = np.zeros((8, 16, 16), dtype=np.float32)
    payload = io.BytesIO()
    np.save(payload, voxel_array)
    payload.seek(0)

    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.npy", payload, "application/octet-stream")},
    )
    assert r.status_code == 201
    assert r.json()["filename"] == "volume.npy"


def test_upload_numpy_voxel_data_rejects_non_3d_arrays(client):
    pr = client.post("/api/projects/", json={"name": "P6", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]

    voxel_array = np.zeros((16, 16), dtype=np.float32)
    payload = io.BytesIO()
    np.save(payload, voxel_array)
    payload.seek(0)

    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("invalid_volume.npy", payload, "application/octet-stream")},
    )
    assert r.status_code == 400
    assert "Invalid 3D voxel data" in str(r.json())


def test_upload_tiff_marks_2d_load_mode(client):
    pr = client.post("/api/projects/", json={"name": "Tiff2D", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]

    payload = _make_tiff_bytes(frame_count=1)
    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("slice.tif", payload, "image/tiff")},
    )
    assert r.status_code == 201
    metadata = r.json().get("metadata") or {}
    assert metadata.get("tiff_dimensionality") == "2d"
    assert metadata.get("load_mode") == "single_image"


def test_upload_tiff_marks_3d_load_mode(client):
    pr = client.post("/api/projects/", json={"name": "Tiff3D", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]

    payload = _make_tiff_bytes(frame_count=4)
    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("stack.tiff", payload, "image/tiff")},
    )
    assert r.status_code == 201
    metadata = r.json().get("metadata") or {}
    assert metadata.get("tiff_dimensionality") == "3d"
    assert metadata.get("load_mode") == "volume"


def test_upload_inspiro_voxel_data_accepts_3d_arrays(client):
    pr = client.post("/api/projects/", json={"name": "P7", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]

    npy_bytes = io.BytesIO()
    np.save(npy_bytes, np.zeros((4, 8, 8), dtype=np.uint16))
    npy_bytes.seek(0)

    payload = io.BytesIO()
    with zipfile.ZipFile(payload, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("voxels.npy", npy_bytes.getvalue())
    payload.seek(0)

    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("scan.inspiro", payload, "application/octet-stream")},
    )
    assert r.status_code == 201
    assert r.json()["filename"] == "scan.inspiro"


def test_e2e_supported_3d_numpy_formats_upload_and_volume_introspection(client):
    pid = _create_project(client, name="3d-all")

    volume = np.arange(4 * 6 * 8, dtype=np.uint16).reshape((4, 6, 8))

    npy_payload = io.BytesIO()
    np.save(npy_payload, volume)
    npy_payload.seek(0)
    npy_upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("synthetic.npy", npy_payload, "application/octet-stream")},
    )
    assert npy_upload.status_code == 201

    npz_payload = io.BytesIO()
    np.savez(npz_payload, voxels=volume)
    npz_payload.seek(0)
    npz_upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("synthetic.npz", npz_payload, "application/octet-stream")},
    )
    assert npz_upload.status_code == 201

    inspiro_payload = io.BytesIO()
    with zipfile.ZipFile(inspiro_payload, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        array_buf = io.BytesIO()
        np.save(array_buf, volume)
        archive.writestr("voxels.npy", array_buf.getvalue())
    inspiro_payload.seek(0)
    inspiro_upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("synthetic.inspiro", inspiro_payload, "application/octet-stream")},
    )
    assert inspiro_upload.status_code == 201

    listed = client.get(f"/api/projects/{pid}/images")
    assert listed.status_code == 200
    filenames = {item["filename"] for item in listed.json()}
    assert {"synthetic.npy", "synthetic.npz", "synthetic.inspiro"}.issubset(filenames)


def test_get_download_url_and_content_and_thumbnail(client, monkeypatch):
    # Create project and upload image
    pr = client.post("/api/projects/", json={"name": "P3", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]
    img_bytes = _make_png_bytes((20, 20))
    files = {"file": ("a.png", img_bytes, "image/png")}
    ur = client.post(f"/api/projects/{pid}/images", files=files)
    assert ur.status_code == 201
    image_id = ur.json()["id"]

    # Download URL uses proxy path
    dr = client.get(f"/api/images/{image_id}/download")
    assert dr.status_code == 200
    assert dr.json()["url"].endswith(f"/images/{image_id}/content")

    # Mock httpx client to return our bytes for content and thumbnail
    class Resp:
        def __init__(self, data, ctype="image/png"):
            self._data = data
            self.headers = {"content-type": ctype}
            self.status_code = 200

        def raise_for_status(self):
            return None

        async def aread(self):
            return self._data

        def iter_bytes(self):
            # Simple iterator over bytes
            yield self._data

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url):
            # Return fixed PNG
            return Resp(_make_png_bytes().getvalue())

    monkeypatch.setattr("routers.images.httpx.AsyncClient", Client)

    # Proxy content
    cr = client.get(f"/api/images/{image_id}/content")
    assert cr.status_code == 200
    assert cr.headers["content-type"].startswith("image/")

    # Thumbnail
    tr = client.get(f"/api/images/{image_id}/thumbnail?width=8&height=8")
    assert tr.status_code == 200
    assert tr.headers["content-type"].startswith("image/")


def test_thumbnail_bad_dimensions(client):
    # Create project and upload image
    pr = client.post("/api/projects/", json={"name": "P4", "description": None, "meta_group_id": "g"})
    pid = pr.json()["id"]
    img_bytes = _make_png_bytes()
    ur = client.post(f"/api/projects/{pid}/images", files={"file": ("b.png", img_bytes, "image/png")})
    image_id = ur.json()["id"]
    r = client.get(f"/api/images/{image_id}/thumbnail?width=0&height=10")
    assert r.status_code == 400


def test_upload_and_list_5000_tiny_encoded_images(client, monkeypatch):
    """Vista can ingest and list 5,000 tiny images without losing any files."""
    image_count = 5000
    pid = _create_project(client, name="5000-image-load")
    uploaded_indices = set()

    async def validate_and_capture_upload(
        *, bucket_name, object_name, file_data, length, content_type
    ):
        del bucket_name, length
        payload = file_data.read()
        file_data.seek(0)
        decoded_index = _decode_encoded_index_png_bytes(payload)
        assert object_name.endswith(f"encoded-{decoded_index:04d}.png")
        assert content_type == "image/png"
        uploaded_indices.add(decoded_index)
        return True

    monkeypatch.setattr("routers.images.upload_file_to_s3", validate_and_capture_upload)

    for index in range(1, image_count + 1):
        response = client.post(
            f"/api/projects/{pid}/images",
            files={
                "file": (
                    f"encoded-{index:04d}.png",
                    _make_encoded_index_png_bytes(index),
                    "image/png",
                )
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["filename"] == f"encoded-{index:04d}.png"

    assert uploaded_indices == set(range(1, image_count + 1))

    listed = client.get(f"/api/projects/{pid}/images?limit={image_count}")
    assert listed.status_code == 200
    items = listed.json()
    assert len(items) == image_count
    assert {item["filename"] for item in items} == {
        f"encoded-{index:04d}.png" for index in range(1, image_count + 1)
    }


def test_list_project_s3_files_filters_supported_objects(client, monkeypatch):
    pid = _create_project(client, name="S3 List")

    async def fake_list_s3_objects(bucket, prefix, max_keys=1000):
        assert bucket == "source-bucket"
        assert prefix == "incoming"
        return [
            {"key": "incoming/a.png", "size": 12},
            {"key": "incoming/readme.txt", "size": 4},
            {"key": "incoming/folder/", "size": 0},
            {"key": "incoming/volume.npy", "size": 20},
        ]

    monkeypatch.setattr("routers.images.list_s3_objects", fake_list_s3_objects)
    response = client.post(f"/api/projects/{pid}/s3/list", json={"s3_url": "s3://source-bucket/incoming"})

    assert response.status_code == 200
    body = response.json()
    assert body["bucket"] == "source-bucket"
    assert body["prefix"] == "incoming"
    assert [obj["key"] for obj in body["objects"]] == ["incoming/a.png", "incoming/volume.npy"]


def test_import_project_s3_files_creates_image_records(client, monkeypatch):
    pid = _create_project(client, name="S3 Import")
    copied = []

    async def fake_get_s3_object_info(bucket, key):
        assert bucket == "source-bucket"
        return {"size": 12, "content_type": "image/png", "metadata": {}}

    async def fake_copy_s3_object_to_s3(source_bucket, source_key, destination_bucket, destination_key):
        copied.append((source_bucket, source_key, destination_bucket, destination_key))
        return True

    monkeypatch.setattr("routers.images.get_s3_object_info", fake_get_s3_object_info)
    monkeypatch.setattr("routers.images.copy_s3_object_to_s3", fake_copy_s3_object_to_s3)

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": ["incoming/a.png"],
            "per_file_metadata": {"incoming/a.png": {"lot": "LOT1"}},
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["failed"] == []
    assert len(body["imported"]) == 1
    imported = body["imported"][0]
    assert imported["filename"] == "a.png"
    assert imported["project_id"] == pid
    assert imported["content_type"] == "image/png"
    assert imported["metadata"]["source"] == "s3_import"
    assert imported["metadata"]["source_s3_bucket"] == "source-bucket"
    assert imported["metadata"]["source_s3_key"] == "incoming/a.png"
    assert imported["metadata"]["lot"] == "LOT1"
    assert copied[0][0] == "source-bucket"
    assert copied[0][1] == "incoming/a.png"

    listed = client.get(f"/api/projects/{pid}/images")
    assert listed.status_code == 200
    assert [item["filename"] for item in listed.json()] == ["a.png"]


def test_import_project_s3_files_rejects_key_outside_prefix(client):
    pid = _create_project(client, name="S3 Import Guard")
    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={"s3_url": "s3://source-bucket/incoming", "keys": ["other/a.png"]},
    )

    assert response.status_code == 400
    assert "outside the requested S3 URL prefix" in response.json()["detail"]
