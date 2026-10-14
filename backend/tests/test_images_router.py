import asyncio
import io
import json
import struct
import threading
import uuid
import zipfile
from concurrent.futures import Future, ThreadPoolExecutor

import httpx
import numpy as np
import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

import utils.boto3_client as boto3_client_module
import utils.volume_loader as volume_loader_module
from routers import images as images_router
from schemas.images import DataInstance
from schemas.inspection_volumes import VolumeConnectedSelectionRequest
from services.errors import CapacityError
from services.images import listing as image_listing_service
from services.images import metadata as image_metadata_service
from services.images import s3_import_workflow
from services.images import s3_imports as image_s3_import_service
from services.images import storage_limits as image_storage_limit_service
from services.images import upload as image_upload_service
from services.images import volume_rendering as image_volume_rendering_service
from services.images import volume_serving as image_volume_serving
from services.images import volume_sources as image_volume_source_service
from services.images import volumes as image_volume_service
from utils import cache_manager


def _make_png_bytes(size=(10, 10), color=(255, 0, 0)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _make_tiff_bytes(frame_count=1, size=(10, 10)):
    frames = [Image.new("L", size, color=i * 20) for i in range(frame_count)]
    buf = io.BytesIO()
    frames[0].save(
        buf, format="TIFF", save_all=frame_count > 1, append_images=frames[1:]
    )
    buf.seek(0)
    return buf


def _make_uint16_tiff_bytes(values):
    return _make_scalar_image_bytes("TIFF", np.uint16, values)


def _make_scalar_image_bytes(fmt, dtype, values):
    array = np.array(values, dtype=dtype)
    img = Image.fromarray(array)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return buf


def _make_raster_bytes(fmt: str, size=(12, 10), color=(64, 128, 192)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return buf


def _create_project(client, name="Synthetic Formats"):
    pr = client.post(
        "/api/projects/", json={"name": name, "description": None, "meta_group_id": "g"}
    )
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
def test_e2e_supported_2d_formats_upload_and_render_thumbnail(
    client, monkeypatch, filename, content_type, pil_format
):
    pid = _create_project(client, name=f"2d-{pil_format}")
    payload = _make_raster_bytes(pil_format)
    upload = client.post(
        f"/api/projects/{pid}/images", files={"file": (filename, payload, content_type)}
    )
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

    monkeypatch.setattr("services.images.thumbnails.httpx.AsyncClient", Client)
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
    pr = client.post(
        "/api/projects/", json={"name": "P", "description": None, "meta_group_id": "g"}
    )
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


def test_three_same_filename_uploads_keep_distinct_catalog_rows_and_storage_keys(
    client,
):
    pid = _create_project(client, name="Three same-name images")

    uploads = []
    for color in ((255, 0, 0), (0, 255, 0), (0, 0, 255)):
        response = client.post(
            f"/api/projects/{pid}/images",
            files={"file": ("capture.png", _make_png_bytes(color=color), "image/png")},
        )
        assert response.status_code == 201, response.text
        uploads.append(response.json())

    upload_ids = {upload["id"] for upload in uploads}
    storage_keys = {upload["object_storage_key"] for upload in uploads}
    assert len(upload_ids) == 3
    assert len(storage_keys) == 3
    assert {upload["object_storage_key"] for upload in uploads} == {
        f"{pid}/{upload['id']}/capture.png" for upload in uploads
    }

    listed_response = client.get(f"/api/projects/{pid}/images")
    assert listed_response.status_code == 200, listed_response.text
    same_name_rows = [
        image for image in listed_response.json() if image["filename"] == "capture.png"
    ]
    assert {image["id"] for image in same_name_rows} == upload_ids
    assert {image["object_storage_key"] for image in same_name_rows} == storage_keys


@pytest.mark.parametrize(
    "filename,content_type,pil_format",
    [
        ("color.png", "image/png", "PNG"),
        ("color.tiff", "image/tiff", "TIFF"),
    ],
)
def test_upload_ordinary_rgb_image_skips_pixel_extrema_scan(
    client,
    monkeypatch,
    filename,
    content_type,
    pil_format,
):

    pid = _create_project(client, name=f"rgb-no-extrema-{pil_format}")
    payload = _make_raster_bytes(pil_format, size=(128, 96))
    original_open = Image.open
    open_calls = 0
    extrema_calls = 0

    def counted_open(*args, **kwargs):
        nonlocal open_calls
        open_calls += 1
        return original_open(*args, **kwargs)

    def unexpected_extrema(_image):
        nonlocal extrema_calls
        extrema_calls += 1
        raise AssertionError("ordinary RGB upload must not decode pixels for extrema")

    monkeypatch.setattr(Image, "open", counted_open)
    monkeypatch.setattr(Image.Image, "getextrema", unexpected_extrema)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": (filename, payload, content_type)},
    )

    assert response.status_code == 201, response.text
    assert open_calls == 1
    assert extrema_calls == 0
    if pil_format == "TIFF":
        assert response.json()["metadata"]["tiff_dimensionality"] == "2d"


def test_upload_scalar_png_preserves_exact_intensity_metadata(client):
    pid = _create_project(client, name="scalar-intensity-preserved")
    payload = _make_scalar_image_bytes("PNG", np.uint8, [[3, 11], [25, 247]])

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("scalar.png", payload, "image/png")},
    )

    assert response.status_code == 201, response.text
    metadata = response.json()["metadata"]
    assert metadata["pixel_dtype"] == "uint8"
    assert metadata["bit_depth"] == 8
    assert metadata["pixel_value_range"] == {"min": 3, "max": 247}
    assert metadata["intensity_range"] == {"min": 3, "max": 247}


def test_upload_big_endian_uint16_tiff_accepts_unsupported_extrema_mode(client):
    pid = _create_project(client, name="big-endian-tiff-extrema")
    payload = _make_scalar_image_bytes(
        "TIFF",
        np.dtype(">u2"),
        [[1024, 2048], [4096, 12000]],
    )

    with Image.open(payload) as image:
        assert image.mode == "I;16B"
        with pytest.raises(ValueError, match="wrong mode"):
            image.getextrema()
    payload.seek(0)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("big-endian-slice.tif", payload, "image/tiff")},
    )

    assert response.status_code == 201, response.text
    metadata = response.json()["metadata"]
    assert metadata["tiff_dimensionality"] == "2d"
    assert metadata["load_mode"] == "single_image"
    assert metadata["frame_count"] == 1
    assert "pixel_value_range" not in metadata


def test_upload_invalid_tiff_still_rejects_structural_inspection_failure(client):
    pid = _create_project(client, name="invalid-tiff-header")

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("invalid.tif", io.BytesIO(b"not a TIFF"), "image/tiff")},
    )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Invalid TIFF image data:")


def test_upload_inspection_is_dispatched_via_asyncio_to_thread(client, monkeypatch):
    from routers import images as images_router

    pid = _create_project(client, name="threaded-upload-inspection")
    payload = _make_png_bytes(size=(32, 32))
    original_to_thread = images_router.asyncio.to_thread
    dispatched_functions = []

    async def tracked_to_thread(function, *args, **kwargs):
        dispatched_functions.append(function)
        return await original_to_thread(function, *args, **kwargs)

    monkeypatch.setattr(images_router.asyncio, "to_thread", tracked_to_thread)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("threaded.png", payload, "image/png")},
    )

    assert response.status_code == 201, response.text
    assert image_metadata_service.inspect_upload_file in dispatched_functions


def test_upload_image_bad_metadata(client):
    pr = client.post(
        "/api/projects/", json={"name": "P2", "description": None, "meta_group_id": "g"}
    )
    pid = pr.json()["id"]
    img_bytes = _make_png_bytes()
    files = {"file": ("x.png", img_bytes, "image/png")}
    data = {"metadata": "{not-json}"}
    r = client.post(f"/api/projects/{pid}/images", files=files, data=data)
    assert r.status_code == 400


@pytest.mark.parametrize("storage_outcome", ["false", "exception"])
def test_legacy_upload_storage_failures_remove_ambiguous_target(
    client,
    monkeypatch,
    storage_outcome,
):
    pid = _create_project(client, name=f"legacy-storage-{storage_outcome}")
    attempted_keys = []
    deleted_keys = []

    async def fail_upload(*, object_name, **_kwargs):
        attempted_keys.append(object_name)
        if storage_outcome == "exception":
            raise RuntimeError("ambiguous storage failure")
        return False

    def track_delete(_bucket, object_name):
        deleted_keys.append(object_name)
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", fail_upload)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", track_delete)
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("image.png", _make_png_bytes(), "image/png")},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to upload file to object storage"
    assert deleted_keys == attempted_keys
    assert client.get(f"/api/projects/{pid}/images").json() == []


@pytest.mark.parametrize("failure_point", ["database", "group", "autoassign"])
def test_legacy_upload_precommit_failures_roll_back_and_remove_object(
    client,
    monkeypatch,
    failure_point,
):
    project_type = "PT3" if failure_point == "autoassign" else "PT1"
    project = client.post(
        "/api/projects/",
        json={
            "name": f"legacy-{failure_point}-failure",
            "description": None,
            "meta_group_id": "g",
            "project_type": project_type,
        },
    )
    assert project.status_code == 201
    pid = project.json()["id"]
    uploaded_keys = []
    deleted_keys = []

    async def successful_upload(*, object_name, **_kwargs):
        uploaded_keys.append(object_name)
        return True

    def track_delete(_bucket, object_name):
        deleted_keys.append(object_name)
        return True

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", successful_upload)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", track_delete)
    request_data = {}
    if failure_point == "database":

        async def fail_flush(_session, *_args, **_kwargs):
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(AsyncSession, "flush", fail_flush)
    elif failure_point == "group":

        async def fail_group_resolution(*_args, **_kwargs):
            raise RuntimeError("group insert failed")

        monkeypatch.setattr(
            image_upload_service, "resolve_batch_image_groups", fail_group_resolution
        )
        request_data["group_identifier"] = "part-a"
    else:

        async def fail_autoassign(**_kwargs):
            raise RuntimeError("part assignment failed")

        monkeypatch.setattr(
            image_volume_service,
            "autoassign_pt3_volume_upload_to_part",
            fail_autoassign,
        )

    if failure_point == "autoassign":
        payload = io.BytesIO()
        np.save(payload, np.zeros((2, 3, 4), dtype=np.uint16))
        upload_file = ("volume.npy", payload.getvalue(), "application/octet-stream")
    else:
        upload_file = ("image.png", _make_png_bytes(), "image/png")
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": upload_file},
        data=request_data,
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to save uploaded image record"
    assert deleted_keys == uploaded_keys
    assert client.get(f"/api/projects/{pid}/images").json() == []
    if failure_point == "autoassign":
        assert client.get(f"/api/projects/{pid}/parts").json() == []


def test_legacy_upload_commits_image_group_and_pt3_autoassignment_once(
    client, monkeypatch
):
    project = client.post(
        "/api/projects/",
        json={
            "name": "legacy-one-transaction",
            "description": None,
            "meta_group_id": "g",
            "project_type": "PT3",
        },
    )
    pid = project.json()["id"]
    original_commit = AsyncSession.commit
    commit_calls = 0

    async def tracked_commit(session, *args, **kwargs):
        nonlocal commit_calls
        commit_calls += 1
        return await original_commit(session, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "commit", tracked_commit)
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint16))
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.npy", payload.getvalue(), "application/octet-stream")},
        data={"group_identifier": "part-a"},
    )

    assert response.status_code == 201, response.text
    assert commit_calls == 1
    assert response.json()["group_id"]
    assert len(client.get(f"/api/projects/{pid}/parts").json()) == 1


def test_legacy_upload_cache_failure_does_not_report_false_500(client, monkeypatch):
    pid = _create_project(client, name="legacy-cache-failure")

    class FailingCache:
        def get(self, _key):
            return None

        def set(self, _key, _value, *_args, **_kwargs):
            return None

        def clear_pattern(self, _pattern):
            raise RuntimeError("cache unavailable")

    monkeypatch.setattr(cache_manager, "get_cache", lambda: FailingCache())
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("image.png", _make_png_bytes(), "image/png")},
    )

    assert response.status_code == 201, response.text
    listed = client.get(f"/api/projects/{pid}/images")
    assert [item["id"] for item in listed.json()] == [response.json()["id"]]


def test_pt3_upload_numpy_volume_autoassigns_part_named_for_file(client):
    pr = client.post(
        "/api/projects/",
        json={
            "name": "PT3 NPY Auto Part",
            "description": None,
            "meta_group_id": "g",
            "project_type": "PT3",
        },
    )
    pid = pr.json()["id"]

    voxel_array = np.zeros((3, 4, 5), dtype=np.uint16)
    payload = io.BytesIO()
    np.save(payload, voxel_array)
    payload.seek(0)

    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    parts = client.get(f"/api/projects/{pid}/parts")
    assert parts.status_code == 200
    body = parts.json()
    assert len(body) == 1
    part = body[0]
    assert part["serial_number"] == "volume"
    assert part["display_name"] == "volume"
    assert part["metadata"]["source_images"] == [
        {
            "filename": "volume.npy",
            "image_id": image_id,
            "side": "",
            "modality": "",
            "overlay": False,
            "slice_axis": None,
            "slice_index": None,
            "load_mode": "volume",
            "frame_count": 3,
            "volume_shape": {"axial": 3, "coronal": 4, "sagittal": 5},
            "pixel_dtype": "uint16",
            "voxel_dtype": "uint16",
            "bit_depth": 16,
            "bits_per_sample": 16,
            "channel_count": 1,
            "color_mode": "scalar",
            "metadata": {
                "load_mode": "volume",
                "frame_count": 3,
                "volume_shape": {"axial": 3, "coronal": 4, "sagittal": 5},
                "pixel_dtype": "uint16",
                "voxel_dtype": "uint16",
                "bit_depth": 16,
                "bits_per_sample": 16,
                "channel_count": 1,
                "color_mode": "scalar",
            },
        }
    ]


def test_pt3_same_filename_volume_uploads_retain_both_image_ids(client):
    project = client.post(
        "/api/projects/",
        json={
            "name": "PT3 duplicate volume names",
            "description": None,
            "meta_group_id": "g",
            "project_type": "PT3",
        },
    )
    assert project.status_code == 201, project.text
    pid = project.json()["id"]

    uploads = []
    for fill_value in (1, 2):
        payload = io.BytesIO()
        np.save(payload, np.full((2, 3, 4), fill_value, dtype=np.uint16))
        payload.seek(0)
        response = client.post(
            f"/api/projects/{pid}/images",
            files={
                "file": (
                    "volume.npy",
                    payload,
                    "application/octet-stream",
                )
            },
            data={"metadata": json.dumps({"overlay": "false"})},
        )
        assert response.status_code == 201, response.text
        uploads.append(response.json())

    upload_ids = [upload["id"] for upload in uploads]
    assert len(set(upload_ids)) == 2

    parts_response = client.get(f"/api/projects/{pid}/parts")
    assert parts_response.status_code == 200, parts_response.text
    assert len(parts_response.json()) == 1
    source_images = parts_response.json()[0]["metadata"]["source_images"]
    assert [record["image_id"] for record in source_images] == upload_ids
    assert [record["filename"] for record in source_images] == [
        "volume.npy",
        "volume.npy",
    ]
    assert [record["overlay"] for record in source_images] == [False, False]

    listed_response = client.get(f"/api/projects/{pid}/images")
    assert listed_response.status_code == 200, listed_response.text
    assert {
        image["id"]
        for image in listed_response.json()
        if image["filename"] == "volume.npy"
    } == set(upload_ids)


def test_pt3_upload_multipage_tiff_autoassigns_part_named_for_file(client):
    pr = client.post(
        "/api/projects/",
        json={
            "name": "PT3 TIFF Auto Part",
            "description": None,
            "meta_group_id": "g",
            "project_type": "PT3",
        },
    )
    pid = pr.json()["id"]

    upload = client.post(
        f"/api/projects/{pid}/images",
        files={
            "file": (
                "stack.tif",
                _make_tiff_bytes(frame_count=2, size=(6, 7)),
                "image/tiff",
            )
        },
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    parts = client.get(f"/api/projects/{pid}/parts")
    assert parts.status_code == 200
    body = parts.json()
    assert len(body) == 1
    part = body[0]
    assert part["serial_number"] == "stack"
    source = part["metadata"]["source_images"][0]
    assert source["filename"] == "stack.tif"
    assert source["image_id"] == image_id
    assert source["load_mode"] == "volume"
    assert source["tiff_dimensionality"] == "3d"
    assert source["frame_count"] == 2
    assert source["volume_shape"] == {"axial": 2, "coronal": 7, "sagittal": 6}


def test_pt1_upload_numpy_volume_does_not_autoassign_part(client):
    pid = _create_project(client, name="PT1 NPY No Auto Part")
    payload = io.BytesIO()
    np.save(payload, np.zeros((3, 4, 5), dtype=np.uint8))
    payload.seek(0)

    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201

    parts = client.get(f"/api/projects/{pid}/parts")
    assert parts.status_code == 200
    assert parts.json() == []


def test_upload_numpy_voxel_data_accepts_3d_arrays(client):
    pr = client.post(
        "/api/projects/", json={"name": "P5", "description": None, "meta_group_id": "g"}
    )
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


@pytest.mark.parametrize(
    "extension,channel_count,color_mode",
    [
        ("npy", 3, "rgb"),
        ("npz", 4, "rgba"),
        ("inspiro", 3, "rgb"),
    ],
)
def test_upload_color_voxel_data_records_spatial_shape_and_color_layout(
    client, extension, channel_count, color_mode
):
    pid = _create_project(client, name=f"color-{extension}-{color_mode}")
    array = np.zeros((2, 3, 4, channel_count), dtype=np.uint8)
    payload = io.BytesIO()
    if extension == "npy":
        np.save(payload, array)
    else:
        np.savez(payload, voxels=array)
    payload.seek(0)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": (f"volume.{extension}", payload, "application/octet-stream")},
    )

    assert response.status_code == 201, response.text
    metadata = response.json().get("metadata") or {}
    assert metadata["volume_shape"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert metadata["channel_count"] == channel_count
    assert metadata["color_mode"] == color_mode


@pytest.mark.parametrize(
    "dtype,expected_dtype,expected_bit_depth",
    [
        (np.uint8, "uint8", 8),
        (np.uint16, "uint16", 16),
        (np.uint32, "uint32", 32),
        (np.float32, "float32", 32),
    ],
)
def test_upload_numpy_voxel_data_records_dtype_bit_depth_for_display_window(
    client, dtype, expected_dtype, expected_bit_depth
):
    pid = _create_project(client, name=f"npy-{expected_bit_depth}-bit")

    voxel_array = np.arange(2 * 3 * 4, dtype=dtype).reshape((2, 3, 4))
    payload = io.BytesIO()
    np.save(payload, voxel_array)
    payload.seek(0)

    r = client.post(
        f"/api/projects/{pid}/images",
        files={
            "file": (
                f"volume-{expected_bit_depth}.npy",
                payload,
                "application/octet-stream",
            )
        },
    )

    assert r.status_code == 201
    metadata = r.json().get("metadata") or {}
    assert metadata.get("pixel_dtype") == expected_dtype
    assert metadata.get("voxel_dtype") == expected_dtype
    assert metadata.get("bit_depth") == expected_bit_depth
    assert metadata.get("bits_per_sample") == expected_bit_depth
    assert metadata.get("volume_shape") == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert metadata.get("frame_count") == 2
    assert metadata.get("load_mode") == "volume"
    if np.issubdtype(np.dtype(dtype), np.floating):
        assert metadata.get("signed") is True


def test_upload_numpy_voxel_data_derived_dtype_metadata_overrides_client_metadata(
    client,
):
    pid = _create_project(client, name="npy-derived-metadata")

    voxel_array = np.arange(2 * 2 * 2, dtype=np.uint16).reshape((2, 2, 2))
    payload = io.BytesIO()
    np.save(payload, voxel_array)
    payload.seek(0)

    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume-overrides.npy", payload, "application/octet-stream")},
        data={
            "metadata": json.dumps(
                {"pixel_dtype": "uint8", "voxel_dtype": "uint8", "bit_depth": 8}
            )
        },
    )

    assert r.status_code == 201
    metadata = r.json().get("metadata") or {}
    assert metadata.get("pixel_dtype") == "uint16"
    assert metadata.get("voxel_dtype") == "uint16"
    assert metadata.get("bit_depth") == 16
    assert metadata.get("bits_per_sample") == 16


def test_upload_numpy_voxel_data_rejects_non_3d_arrays(client):
    pr = client.post(
        "/api/projects/", json={"name": "P6", "description": None, "meta_group_id": "g"}
    )
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


@pytest.mark.parametrize("shape", [(0, 3, 4), (2, 0, 4), (2, 3, 0), (2, 3, 0, 4)])
def test_upload_numpy_voxel_data_rejects_zero_spatial_dimensions(client, shape):
    pid = _create_project(client, name="zero-dimensional-volume")
    payload = io.BytesIO()
    np.save(payload, np.zeros(shape, dtype=np.uint8))
    payload.seek(0)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("zero.npy", payload, "application/octet-stream")},
    )

    assert response.status_code == 400
    assert "Volume dimensions must be positive integers" in response.json()["detail"]


def test_upload_tiff_marks_2d_load_mode(client):
    pr = client.post(
        "/api/projects/",
        json={"name": "Tiff2D", "description": None, "meta_group_id": "g"},
    )
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
    assert metadata.get("volume_shape") is None
    assert metadata.get("interpretation") is None


def test_upload_tiff_marks_3d_load_mode(client):
    pr = client.post(
        "/api/projects/",
        json={"name": "Tiff3D", "description": None, "meta_group_id": "g"},
    )
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


def test_tiff_volume_metadata_reports_single_frame_tiff_as_voxel_array():
    volume = np.zeros((1, 10, 10), dtype=np.uint8)

    metadata = image_volume_serving.volume_meta(
        volume.shape,
        volume.dtype,
        source_kind="tiff",
    )

    assert metadata["interpretation"] == "voxel_array"


def test_tiff_volume_metadata_reports_multiframe_tiff_as_stack():
    volume = np.zeros((2, 10, 10), dtype=np.uint8)

    metadata = image_volume_serving.volume_meta(
        volume.shape,
        volume.dtype,
        source_kind="tiff",
    )

    assert metadata["interpretation"] == "stack_of_2d_images"


def test_stale_single_frame_tiff_metadata_is_repaired_on_project_load(client):
    pid = _create_project(client, name="repair-stale-tiff-metadata")
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("slice.tif", _make_tiff_bytes(frame_count=1), "image/tiff")},
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]
    stale_updates = {
        "load_mode": "volume",
        "tiff_dimensionality": "3d",
        "frame_count": 1,
        "volume_shape": {"axial": 1, "coronal": 10, "sagittal": 10},
        "interpretation": "stack_of_2d_images",
    }
    for key, value in stale_updates.items():
        response = client.put(
            f"/api/images/{image_id}/metadata", json={"key": key, "value": value}
        )
        assert response.status_code == 200, response.text

    loaded = client.get(f"/api/projects/{pid}/images")

    assert loaded.status_code == 200, loaded.text
    metadata = next(image for image in loaded.json() if image["id"] == image_id)[
        "metadata"
    ]
    assert metadata["tiff_dimensionality"] == "2d"
    assert metadata["load_mode"] == "single_image"
    assert metadata["frame_count"] == 1
    assert "volume_shape" not in metadata
    assert "interpretation" not in metadata

    persisted = client.get(f"/api/images/{image_id}")
    assert persisted.status_code == 200, persisted.text
    assert "interpretation" not in persisted.json()["metadata"]


@pytest.mark.parametrize("mode,color", [("LA", (10, 20)), ("CMYK", (1, 2, 3, 4))])
def test_upload_and_volume_decode_reject_unsupported_multiband_tiff_modes(
    client, mode, color
):
    pid = _create_project(client, name=f"unsupported-{mode}-tiff")
    payload = io.BytesIO()
    frames = [Image.new(mode, (4, 3), color=color) for _ in range(2)]
    frames[0].save(
        payload,
        format="TIFF",
        save_all=True,
        append_images=frames[1:],
    )
    raw_payload = payload.getvalue()
    payload.seek(0)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": (f"unsupported-{mode}.tiff", payload, "image/tiff")},
    )

    assert response.status_code == 400
    assert f"Unsupported volume image pixel mode '{mode}'" in response.json()["detail"]
    with pytest.raises(ValueError, match=rf"pixel mode '{mode}'.*scalar, RGB, or RGBA"):
        image_volume_service.load_tiff_volume(raw_payload)


def test_convert_uint16_tiff_to_web_format_preserves_relative_contrast():
    from services.images.thumbnails import convert_to_web_format

    payload = _make_uint16_tiff_bytes([[1024, 2048], [4096, 12000]])
    converted, content_type = convert_to_web_format(payload.getvalue(), "image/tiff")

    assert content_type == "image/png"
    with Image.open(io.BytesIO(converted)) as image:
        assert image.mode == "L"
        pixels = list(image.getdata())

    assert min(pixels) == 0
    assert max(pixels) == 255
    assert len(set(pixels)) > 2


def test_upload_uint16_tiff_records_actual_intensity_range_for_pt3_window(client):
    pr = client.post(
        "/api/projects/",
        json={
            "name": "Tiff16PT3",
            "description": None,
            "meta_group_id": "g",
            "project_type": "PT3",
        },
    )
    pid = pr.json()["id"]

    payload = _make_uint16_tiff_bytes([[1024, 2048], [4096, 12000]])
    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("slice16.tif", payload, "image/tiff")},
    )
    assert r.status_code == 201
    metadata = r.json().get("metadata") or {}
    assert metadata.get("tiff_dimensionality") == "2d"
    assert metadata.get("load_mode") == "single_image"
    assert metadata.get("pixel_dtype") == "uint16"
    assert metadata.get("voxel_dtype") == "uint16"
    assert metadata.get("bit_depth") == 16
    assert metadata.get("bits_per_sample") == 16
    assert metadata.get("pixel_value_range") == {"min": 1024, "max": 12000}
    assert metadata.get("value_range") == {"min": 1024, "max": 12000}
    assert metadata.get("intensity_range") == {"min": 1024, "max": 12000}


@pytest.mark.parametrize(
    "filename,content_type,pil_format,dtype,values,expected_dtype,expected_bit_depth,expected_range",
    [
        (
            "scalar8.png",
            "image/png",
            "PNG",
            np.uint8,
            [[0, 64], [128, 255]],
            "uint8",
            8,
            {"min": 0, "max": 255},
        ),
        (
            "scalar16.png",
            "image/png",
            "PNG",
            np.uint16,
            [[1024, 2048], [4096, 12000]],
            "uint16",
            16,
            {"min": 1024, "max": 12000},
        ),
        (
            "scalar8.tif",
            "image/tiff",
            "TIFF",
            np.uint8,
            [[0, 64], [128, 255]],
            "uint8",
            8,
            {"min": 0, "max": 255},
        ),
        (
            "scalar16.tif",
            "image/tiff",
            "TIFF",
            np.uint16,
            [[1024, 2048], [4096, 12000]],
            "uint16",
            16,
            {"min": 1024, "max": 12000},
        ),
    ],
)
def test_upload_variable_bit_depth_scalar_images_records_actual_display_window_metadata(
    client,
    filename,
    content_type,
    pil_format,
    dtype,
    values,
    expected_dtype,
    expected_bit_depth,
    expected_range,
):
    pid = _create_project(client, name=f"scalar-{pil_format}-{expected_bit_depth}")

    payload = _make_scalar_image_bytes(pil_format, dtype, values)
    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": (filename, payload, content_type)},
    )

    assert r.status_code == 201
    metadata = r.json().get("metadata") or {}
    assert metadata.get("pixel_dtype") == expected_dtype
    assert metadata.get("voxel_dtype") == expected_dtype
    assert metadata.get("bit_depth") == expected_bit_depth
    assert metadata.get("bits_per_sample") == expected_bit_depth
    assert metadata.get("pixel_value_range") == expected_range
    assert metadata.get("value_range") == expected_range
    assert metadata.get("intensity_range") == expected_range


def test_upload_image_serializes_after_expired_commit_state(client, monkeypatch):
    pid = _create_project(client, name="expired-upload-serialization")
    original_commit = image_upload_service.commit_database_transaction
    original_refresh = AsyncSession.refresh
    commit_finished = False
    deleted_objects = []

    async def commit_and_expire(session):
        nonlocal commit_finished
        await original_commit(session)
        session.expire_all()
        commit_finished = True

    async def reject_post_commit_refresh(session, *args, **kwargs):
        if commit_finished:
            raise AssertionError("upload response must not refresh after commit")
        return await original_refresh(session, *args, **kwargs)

    def track_delete(_bucket, object_storage_key):
        deleted_objects.append(object_storage_key)
        return True

    monkeypatch.setattr(
        image_upload_service, "commit_database_transaction", commit_and_expire
    )
    monkeypatch.setattr(AsyncSession, "refresh", reject_post_commit_refresh)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", track_delete)

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("expired-state.png", _make_png_bytes(), "image/png")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["filename"] == "expired-state.png"
    assert body["created_at"]
    assert deleted_objects == []


def test_upload_response_matches_sqlite_persisted_defaults_and_timestamp(client):
    pid = _create_project(client, name="persisted-upload-parity")
    uploaded = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("parity.png", _make_png_bytes(), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    upload_body = uploaded.json()

    listed = client.get(f"/api/projects/{pid}/images")
    assert listed.status_code == 200, listed.text
    persisted = next(item for item in listed.json() if item["id"] == upload_body["id"])

    assert upload_body["storage_deleted"] is False
    assert persisted["storage_deleted"] is False
    assert persisted["created_at"] == upload_body["created_at"]


def test_upload_image_cancelled_after_successful_commit_preserves_storage(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="cancelled-after-commit")
    original_commit = image_upload_service.commit_database_transaction
    uploaded_objects = []
    deleted_objects = []

    async def track_upload(*, object_name, **_kwargs):
        uploaded_objects.append(object_name)
        return True

    def track_delete(_bucket, object_storage_key):
        deleted_objects.append(object_storage_key)
        return True

    async def commit_then_cancel(session):
        await original_commit(session)
        cancelled = asyncio.CancelledError()
        cancelled.vista_commit_succeeded = True
        raise cancelled

    monkeypatch.setattr(image_upload_service, "upload_file_to_s3", track_upload)
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", track_delete)
    monkeypatch.setattr(
        image_upload_service, "commit_database_transaction", commit_then_cancel
    )

    # Starlette's BaseHTTPMiddleware translates the propagated cancellation
    # into this stable request-level error for TestClient callers.
    with pytest.raises(RuntimeError, match="No response returned"):
        client.post(
            f"/api/projects/{pid}/images",
            files={"file": ("committed.png", _make_png_bytes(), "image/png")},
        )

    assert len(uploaded_objects) == 1
    assert deleted_objects == []

    # The request was cancelled, but its explicitly successful commit remains
    # authoritative. Restore the helper before issuing a verification request.
    monkeypatch.setattr(
        image_upload_service, "commit_database_transaction", original_commit
    )
    listed = client.get(f"/api/projects/{pid}/images")
    assert listed.status_code == 200
    assert [item["filename"] for item in listed.json()] == ["committed.png"]


def test_upload_inspiro_voxel_data_accepts_3d_arrays(client):
    pr = client.post(
        "/api/projects/", json={"name": "P7", "description": None, "meta_group_id": "g"}
    )
    pid = pr.json()["id"]

    npy_bytes = io.BytesIO()
    np.save(npy_bytes, np.zeros((4, 8, 8), dtype=np.uint16))
    npy_bytes.seek(0)

    payload = io.BytesIO()
    with zipfile.ZipFile(
        payload, mode="w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        archive.writestr("voxels.npy", npy_bytes.getvalue())
    payload.seek(0)

    r = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("scan.inspiro", payload, "application/octet-stream")},
    )
    assert r.status_code == 201
    assert r.json()["filename"] == "scan.inspiro"


@pytest.mark.parametrize(
    ("members", "limits", "expected_detail"),
    [
        (
            [("first.npy", b"x"), ("second.bin", b"y")],
            {"max_container_members": 1, "max_decoded_bytes": 1024},
            "member limit",
        ),
        (
            [("voxels.npy", b"x" * 256)],
            {"max_container_members": 4, "max_decoded_bytes": 64},
            "uncompressed bytes",
        ),
    ],
)
def test_voxel_archive_preflight_rejects_declared_bombs_before_opening_members(
    client,
    monkeypatch,
    members,
    limits,
    expected_detail,
):
    from utils.volume_loader import VolumeReadLimits

    pid = _create_project(client, name=f"archive-preflight-{expected_detail}")
    payload = io.BytesIO()
    with zipfile.ZipFile(
        payload, mode="w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        for name, value in members:
            archive.writestr(name, value)
    payload.seek(0)
    monkeypatch.setattr(
        image_upload_service,
        "REFERENCE_VOLUME_READ_LIMITS",
        VolumeReadLimits(
            max_voxels=100,
            max_decoded_bytes=limits["max_decoded_bytes"],
            max_source_bytes=4096,
            max_container_members=limits["max_container_members"],
        ),
    )
    member_open_calls = 0

    def forbidden_member_open(*_args, **_kwargs):
        nonlocal member_open_calls
        member_open_calls += 1
        raise AssertionError("rejected archive members must never be inflated")

    monkeypatch.setattr(zipfile.ZipFile, "open", forbidden_member_open)
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("bomb.npz", payload, "application/octet-stream")},
    )

    assert response.status_code == 400
    assert expected_detail in response.json()["detail"]
    assert member_open_calls == 0


def test_voxel_upload_rejects_declared_member_bomb_before_zipfile_construction(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="archive-central-directory-preflight")
    payload = struct.pack(
        "<4s4H2LH",
        b"PK\x05\x06",
        0,
        0,
        image_upload_service.REFERENCE_VOLUME_READ_LIMITS.max_container_members + 1,
        image_upload_service.REFERENCE_VOLUME_READ_LIMITS.max_container_members + 1,
        0,
        0,
        0,
    )
    zipfile_constructor_calls = 0

    def forbidden_zipfile_constructor(*_args, **_kwargs):
        nonlocal zipfile_constructor_calls
        zipfile_constructor_calls += 1
        raise AssertionError(
            "unsafe archive must be rejected before ZipFile construction"
        )

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_zipfile_constructor)
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("bomb.npz", payload, "application/octet-stream")},
    )

    assert response.status_code == 400
    assert "configured/built-in" in response.json()["detail"]
    assert "member limit" in response.json()["detail"]
    assert zipfile_constructor_calls == 0


def test_voxel_archive_preflight_reads_only_bounded_npy_header_chunks(
    client, monkeypatch
):
    pid = _create_project(client, name="archive-bounded-header")
    array_bytes = io.BytesIO()
    np.save(array_bytes, np.zeros((2, 3, 4), dtype=np.uint16))
    payload = io.BytesIO()
    with zipfile.ZipFile(
        payload, mode="w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        archive.writestr("voxels.npy", array_bytes.getvalue())
    payload.seek(0)
    original_read = zipfile.ZipExtFile.read
    requested_sizes = []

    def bounded_read(member, size=-1):
        requested_sizes.append(size)
        assert 0 <= size <= volume_loader_module.MAX_NPY_HEADER_BYTES
        return original_read(member, size)

    monkeypatch.setattr(zipfile.ZipExtFile, "read", bounded_read)
    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("safe.npz", payload, "application/octet-stream")},
    )

    assert response.status_code == 201, response.text
    assert requested_sizes
    assert -1 not in requested_sizes


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
    with zipfile.ZipFile(
        inspiro_payload, mode="w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        array_buf = io.BytesIO()
        np.save(array_buf, volume)
        archive.writestr("voxels.npy", array_buf.getvalue())
    inspiro_payload.seek(0)
    inspiro_upload = client.post(
        f"/api/projects/{pid}/images",
        files={
            "file": ("synthetic.inspiro", inspiro_payload, "application/octet-stream")
        },
    )
    assert inspiro_upload.status_code == 201

    listed = client.get(f"/api/projects/{pid}/images")
    assert listed.status_code == 200
    filenames = {item["filename"] for item in listed.json()}
    assert {"synthetic.npy", "synthetic.npz", "synthetic.inspiro"}.issubset(filenames)


def test_npz_volume_decode_rejects_declared_expansion_before_member_read(monkeypatch):
    from utils.volume_loader import VolumeReadLimits

    npy_payload = io.BytesIO()
    np.save(npy_payload, np.zeros((1, 1, 64), dtype=np.uint8))
    archive_payload = io.BytesIO()
    with zipfile.ZipFile(
        archive_payload,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        archive.writestr("voxels.npy", npy_payload.getvalue())
    monkeypatch.setattr(
        image_volume_service,
        "REFERENCE_VOLUME_READ_LIMITS",
        VolumeReadLimits(
            max_voxels=100,
            max_decoded_bytes=64,
            max_source_bytes=4096,
            max_container_members=4,
        ),
    )
    member_open_calls = 0

    def forbidden_member_open(*_args, **_kwargs):
        nonlocal member_open_calls
        member_open_calls += 1
        raise AssertionError("oversized archive members must not be opened")

    monkeypatch.setattr(zipfile.ZipFile, "open", forbidden_member_open)

    with pytest.raises(ValueError, match="uncompressed bytes.*64-byte archive limit"):
        image_volume_service.load_numpy_volume(archive_payload.getvalue(), "bomb.npz")

    assert member_open_calls == 0


def test_tiff_volume_decode_rejects_voxel_limit_before_array_allocation(monkeypatch):
    from utils.volume_loader import VolumeReadLimits

    payload = _make_tiff_bytes(frame_count=3, size=(10, 10)).getvalue()
    monkeypatch.setattr(
        image_volume_service,
        "REFERENCE_VOLUME_READ_LIMITS",
        VolumeReadLimits(
            max_voxels=100,
            max_decoded_bytes=4096,
            max_source_bytes=4096,
            max_container_members=4,
        ),
    )
    allocation_calls = 0

    def forbidden_empty(*_args, **_kwargs):
        nonlocal allocation_calls
        allocation_calls += 1
        raise AssertionError("oversized TIFF must be rejected before volume allocation")

    monkeypatch.setattr(np, "empty", forbidden_empty)

    with pytest.raises(ValueError, match="300 voxels.*100-voxel limit"):
        image_volume_service.load_tiff_volume(payload)

    assert allocation_calls == 0


def test_tiff_volume_rejects_large_later_frame_before_array_allocation(monkeypatch):
    from utils.volume_loader import VolumeReadLimits

    first = Image.new("L", (1, 1), color=0)
    second = Image.new("L", (128, 128), color=1)
    payload = io.BytesIO()
    first.save(payload, format="TIFF", save_all=True, append_images=[second])
    monkeypatch.setattr(
        image_volume_service,
        "REFERENCE_VOLUME_READ_LIMITS",
        VolumeReadLimits(
            max_voxels=100,
            max_decoded_bytes=4096,
            max_source_bytes=1024 * 1024,
            max_container_members=4,
        ),
    )
    allocation_calls = 0

    def forbidden_empty(*_args, **_kwargs):
        nonlocal allocation_calls
        allocation_calls += 1
        raise AssertionError(
            "heterogeneous TIFF must be rejected before volume allocation"
        )

    monkeypatch.setattr(np, "empty", forbidden_empty)

    with pytest.raises(ValueError, match="same dimensions"):
        image_volume_service.load_tiff_volume(payload.getvalue())

    assert allocation_calls == 0


def test_get_download_url_and_content_and_thumbnail(client, monkeypatch):
    # Create project and upload image
    pr = client.post(
        "/api/projects/", json={"name": "P3", "description": None, "meta_group_id": "g"}
    )
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

    monkeypatch.setattr("services.images.thumbnails.httpx.AsyncClient", Client)

    # Proxy content
    cr = client.get(f"/api/images/{image_id}/content")
    assert cr.status_code == 200
    assert cr.headers["content-type"].startswith("image/")

    # Thumbnail
    tr = client.get(f"/api/images/{image_id}/thumbnail?width=8&height=8")
    assert tr.status_code == 200
    assert tr.headers["content-type"].startswith("image/")


def test_list_project_s3_files_filters_supported_objects(client, monkeypatch):
    pid = _create_project(client, name="S3 List")

    async def fake_list_s3_objects(bucket, prefix, max_keys=1000, **kwargs):
        assert bucket == "source-bucket"
        assert prefix == "incoming"
        assert kwargs["key_filter"]("incoming/a.png") is True
        assert kwargs["key_filter"]("incoming/readme.txt") is False
        return [
            {"key": "incoming/a.png", "size": 12},
            {"key": "incoming/readme.txt", "size": 4},
            {"key": "incoming/folder/", "size": 0},
            {"key": "incoming/volume.npy", "size": 20},
        ]

    monkeypatch.setattr("services.images.s3_imports.list_s3_objects", fake_list_s3_objects)
    response = client.post(
        f"/api/projects/{pid}/s3/list", json={"s3_url": "s3://source-bucket/incoming"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["bucket"] == "source-bucket"
    assert body["prefix"] == "incoming"
    assert [obj["key"] for obj in body["objects"]] == [
        "incoming/a.png",
        "incoming/volume.npy",
    ]


def test_import_project_s3_files_creates_image_records(client, monkeypatch):
    pid = _create_project(client, name="S3 Import")
    copied = []

    async def fake_get_s3_object_info(bucket, key):
        assert bucket == "source-bucket"
        return {
            "size": 12,
            "content_type": "image/png",
            "metadata": {},
            "etag": '"source-etag"',
        }

    async def fake_copy_s3_object_to_s3(
        source_bucket,
        source_key,
        destination_bucket,
        destination_key,
        *,
        source_etag=None,
    ):
        copied.append(
            (
                source_bucket,
                source_key,
                destination_bucket,
                destination_key,
                source_etag,
            )
        )
        return True

    monkeypatch.setattr(
        "services.images.s3_import_workflow.get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        "services.images.upload.copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": ["incoming/a.png"],
            "metadata": {
                "source": "hostile-shared",
                "source_s3_url": "s3://attacker/shared",
                "source_s3_bucket": "attacker-shared",
                "source_s3_key": "attacker/shared.png",
            },
            "per_file_metadata": {
                "incoming/a.png": {
                    "lot": "LOT1",
                    "source": "hostile-per-file",
                    "source_s3_url": "s3://attacker/per-file",
                    "source_s3_bucket": "attacker-per-file",
                    "source_s3_key": "attacker/per-file.png",
                }
            },
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
    assert imported["metadata"]["source_s3_url"] == "s3://source-bucket/incoming"
    assert imported["metadata"]["source_s3_bucket"] == "source-bucket"
    assert imported["metadata"]["source_s3_key"] == "incoming/a.png"
    assert imported["metadata"]["lot"] == "LOT1"
    assert copied[0][0] == "source-bucket"
    assert copied[0][1] == "incoming/a.png"
    assert copied[0][4] == '"source-etag"'

    listed = client.get(f"/api/projects/{pid}/images")
    assert listed.status_code == 200
    assert [item["filename"] for item in listed.json()] == ["a.png"]


def test_import_project_s3_files_never_serializes_expired_orm_state(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="S3 expired serialization")
    keys = [f"incoming/expired-{index:03d}.png" for index in range(100)]
    original_flush = AsyncSession.flush
    original_commit = s3_import_workflow.commit_database_transaction
    deleted_objects = []
    inspected_keys = []
    copied_keys = []
    flush_calls = 0
    commit_calls = 0

    async def fake_get_s3_object_info(_bucket, key):
        inspected_keys.append(key)
        return {
            "size": 12,
            "content_type": "image/png",
            "metadata": {},
            "etag": f'"source-etag-{key}"',
        }

    async def fake_copy_s3_object_to_s3(
        _source_bucket,
        source_key,
        _destination_bucket,
        _destination_key,
        *,
        source_etag=None,
    ):
        assert source_etag == f'"source-etag-{source_key}"'
        copied_keys.append(source_key)
        return True

    async def flush_and_expire(session, *args, **kwargs):
        nonlocal flush_calls
        flush_calls += 1
        result = await original_flush(session, *args, **kwargs)
        session.expire_all()
        return result

    async def commit_and_expire(session):
        nonlocal commit_calls
        commit_calls += 1
        await original_commit(session)
        session.expire_all()

    def reject_orm_serialization(_db_image):
        raise AssertionError("S3 import response must use pre-commit scalar values")

    def track_delete(_bucket, object_storage_key):
        deleted_objects.append(object_storage_key)
        return True

    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )
    monkeypatch.setattr(AsyncSession, "flush", flush_and_expire)
    monkeypatch.setattr(
        s3_import_workflow, "commit_database_transaction", commit_and_expire
    )
    monkeypatch.setattr(
        image_listing_service, "to_data_instance_schema", reject_orm_serialization
    )
    monkeypatch.setattr(image_upload_service, "delete_file_from_s3", track_delete)

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": keys,
            "metadata": {
                "source_marker": "known-values",
                "source": "hostile-shared",
                "source_s3_key": "hostile/shared.png",
            },
            "per_file_metadata": {
                key: {
                    "sequence": index,
                    "per_file_marker": f"marker-{index:03d}",
                    "source_s3_bucket": "hostile-per-file",
                }
                for index, key in enumerate(keys)
            },
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["failed"] == []
    imported = body["imported"]
    assert len(imported) == 100
    assert [item["filename"] for item in imported] == [
        f"expired-{index:03d}.png" for index in range(100)
    ]

    imported_schemas = [DataInstance.model_validate(item) for item in imported]
    assert len({item.id for item in imported_schemas}) == 100
    assert len({item.object_storage_key for item in imported_schemas}) == 100
    for index, (key, item) in enumerate(zip(keys, imported_schemas, strict=False)):
        assert str(item.project_id) == pid
        assert item.filename == f"expired-{index:03d}.png"
        assert item.object_storage_key == f"{pid}/{item.id}/{item.filename}"
        assert item.content_type == "image/png"
        assert item.size_bytes == 12
        assert item.metadata_ == {
            "source_marker": "known-values",
            "source": "s3_import",
            "source_s3_key": key,
            "sequence": index,
            "per_file_marker": f"marker-{index:03d}",
            "source_s3_bucket": "source-bucket",
            "source_s3_url": "s3://source-bucket/incoming",
        }
        assert item.created_at is not None
        assert item.created_at.tzinfo is not None
        assert item.created_at.utcoffset() is not None
        assert item.storage_deleted is False

    assert len(inspected_keys) == 100
    assert len(copied_keys) == 100
    assert set(inspected_keys) == set(keys)
    assert set(copied_keys) == set(keys)
    assert flush_calls == 1
    assert commit_calls == 1
    assert deleted_objects == []


def test_import_project_s3_files_rejects_more_than_100_keys_before_storage(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="S3 import count preflight")
    storage_calls = []

    async def unexpected_storage_call(*args, **kwargs):
        storage_calls.append((args, kwargs))
        raise AssertionError("oversized key batches must fail before HEAD or COPY")

    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", unexpected_storage_call
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", unexpected_storage_call
    )

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": [f"incoming/object-{index:03d}.png" for index in range(101)],
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Import at most 100 S3 files at a time"
    assert storage_calls == []


def test_import_project_s3_files_uses_etag_precondition_and_cleans_failed_copy(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="S3 conditional copy")
    copied_etags = []
    cleaned_targets = []

    async def fake_get_s3_object_info(_bucket, _key):
        return {
            "size": 12,
            "content_type": "image/png",
            "metadata": {},
            "etag": '"inspected-version"',
        }

    async def fake_copy_s3_object_to_s3(
        _source_bucket,
        _source_key,
        _destination_bucket,
        _destination_key,
        *,
        source_etag=None,
    ):
        copied_etags.append(source_etag)
        # Models S3 rejecting CopySourceIfMatch because the source changed
        # after HEAD and before COPY.
        return False

    def fake_delete_file_from_s3(_bucket, object_key):
        cleaned_targets.append(object_key)
        return True

    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )
    monkeypatch.setattr(
        image_upload_service, "delete_file_from_s3", fake_delete_file_from_s3
    )

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={"s3_url": "s3://source-bucket/incoming", "keys": ["incoming/a.png"]},
    )

    assert response.status_code == 201
    assert response.json()["imported"] == []
    assert response.json()["failed"][0]["key"] == "incoming/a.png"
    assert copied_etags == ['"inspected-version"']
    assert len(cleaned_targets) == 1


def test_s3_copy_helper_passes_source_etag_precondition(monkeypatch):
    copy_calls = []

    class Client:
        def copy_object(self, **kwargs):
            copy_calls.append(kwargs)
            return {}

    monkeypatch.setattr(boto3_client_module, "boto3_client", Client())

    copied = asyncio.run(
        boto3_client_module.copy_s3_object_to_s3(
            "source-bucket",
            "incoming/a.png",
            "destination-bucket",
            "project/a.png",
            source_etag='"inspected-version"',
        )
    )

    assert copied is True
    assert copy_calls == [
        {
            "Bucket": "destination-bucket",
            "Key": "project/a.png",
            "CopySource": {"Bucket": "source-bucket", "Key": "incoming/a.png"},
            "CopySourceIfMatch": '"inspected-version"',
        }
    ]


def test_import_project_s3_files_rejects_duplicate_keys_before_storage(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="S3 duplicate preflight")
    storage_calls = []

    async def unexpected_storage_call(*args, **kwargs):
        storage_calls.append((args, kwargs))
        raise AssertionError("duplicate keys must fail before object storage")

    monkeypatch.setattr(
        s3_import_workflow,
        "get_s3_object_info",
        unexpected_storage_call,
    )
    monkeypatch.setattr(
        image_upload_service,
        "copy_s3_object_to_s3",
        unexpected_storage_call,
    )

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": [
                "incoming/repeated.png",
                "incoming/other.png",
                "incoming/repeated.png",
                "incoming/other.png",
            ],
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == (
        "S3 import keys must be unique; duplicate keys: incoming/other.png, incoming/repeated.png"
    )
    assert storage_calls == []


def test_import_project_s3_files_rejects_key_outside_prefix(client):
    pid = _create_project(client, name="S3 Import Guard")
    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={"s3_url": "s3://source-bucket/incoming", "keys": ["other/a.png"]},
    )

    assert response.status_code == 400
    assert "outside the requested S3 URL prefix" in response.json()["detail"]


def test_upload_rejects_oversized_file_with_limit_detail(client, monkeypatch):
    pid = _create_project(client, name="Upload Size Limit")
    monkeypatch.setattr(images_router.settings, "MAX_UPLOAD_BYTES", 128)
    payload = _make_png_bytes(size=(50, 50))

    response = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("oversized.png", payload, "image/png")},
    )

    assert response.status_code == 413
    detail = response.json()["detail"]
    assert "oversized.png is too large" in detail
    assert "built-in upload size limit" in detail
    assert "128 bytes" in detail


def test_import_project_s3_files_reports_oversized_object_limit(client, monkeypatch):
    pid = _create_project(client, name="S3 Import Size Limit")
    monkeypatch.setattr(images_router.settings, "MAX_UPLOAD_BYTES", 128)

    async def fake_get_s3_object_info(bucket, key):
        return {"size": 129, "content_type": "application/octet-stream", "metadata": {}}

    async def fake_copy_s3_object_to_s3(*_args, **_kwargs):
        raise AssertionError("oversized files must not be copied")

    monkeypatch.setattr(
        "services.images.s3_import_workflow.get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        "services.images.upload.copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={"s3_url": "s3://source-bucket/incoming", "keys": ["incoming/volume.npy"]},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["imported"] == []
    assert body["failed"][0]["key"] == "incoming/volume.npy"
    assert "volume.npy is too large" in body["failed"][0]["error"]
    assert "built-in upload size limit" in body["failed"][0]["error"]


def test_import_project_s3_files_commits_once_preserving_order_failures_and_existing_group(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="S3 concurrent import")
    created_group = client.post(
        f"/api/projects/{pid}/groups",
        json={"identifier": "existing-part", "display_name": "Existing part"},
    )
    assert created_group.status_code == 201, created_group.text
    existing_group_id = created_group.json()["id"]

    commit_calls = 0
    flush_calls = 0
    invalidations = []
    copy_completion = []
    failed_copy_cleanup = []
    original_commit = AsyncSession.commit
    original_flush = AsyncSession.flush

    async def tracked_commit(session, *args, **kwargs):
        nonlocal commit_calls
        commit_calls += 1
        return await original_commit(session, *args, **kwargs)

    async def tracked_flush(session, *args, **kwargs):
        nonlocal flush_calls
        flush_calls += 1
        return await original_flush(session, *args, **kwargs)

    async def fake_get_s3_object_info(_bucket, key):
        await asyncio.sleep(0.001 if "fast" in key else 0.01)
        if key.endswith("missing.png"):
            return None
        return {
            "size": 12,
            "content_type": "image/png",
            "metadata": {},
            "etag": f'"etag-{key}"',
        }

    async def fake_copy_s3_object_to_s3(
        _source_bucket,
        source_key,
        _destination_bucket,
        _destination_key,
        *,
        source_etag=None,
    ):
        assert source_etag == f'"etag-{source_key}"'
        await asyncio.sleep(0.001 if "fast" in source_key else 0.01)
        copy_completion.append(source_key)
        return not source_key.endswith("copy-failure.png")

    def fake_delete_file_from_s3(_bucket, object_key):
        failed_copy_cleanup.append(object_key)
        return True

    class Cache:
        def clear_pattern(self, pattern):
            invalidations.append(pattern)

    monkeypatch.setattr(AsyncSession, "commit", tracked_commit)
    monkeypatch.setattr(AsyncSession, "flush", tracked_flush)
    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )
    monkeypatch.setattr(
        image_upload_service, "delete_file_from_s3", fake_delete_file_from_s3
    )
    monkeypatch.setattr(cache_manager, "get_cache", lambda: Cache())

    keys = [
        "incoming/slow-a.png",
        "incoming/missing.png",
        "incoming/copy-failure.png",
        "incoming/fast-b.png",
        "incoming/slow-c.png",
    ]
    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": keys,
            "metadata": {"shared": True},
            "per_file_metadata": {"incoming/fast-b.png": {"marker": "fast"}},
            "group_identifiers": {
                "incoming/slow-a.png": "existing-part",
                "incoming/slow-c.png": "existing-part",
            },
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert [item["filename"] for item in body["imported"]] == [
        "slow-a.png",
        "fast-b.png",
        "slow-c.png",
    ]
    assert [
        item["group_id"]
        for item in body["imported"]
        if item["filename"].startswith("slow-")
    ] == [
        existing_group_id,
        existing_group_id,
    ]
    assert body["imported"][1]["metadata"]["marker"] == "fast"
    assert [item["key"] for item in body["failed"]] == [
        "incoming/missing.png",
        "incoming/copy-failure.png",
    ]
    assert copy_completion[0] == "incoming/fast-b.png"
    assert len(failed_copy_cleanup) == 1
    assert failed_copy_cleanup[0].endswith("/copy-failure.png")
    assert flush_calls == 1
    assert commit_calls == 1
    assert invalidations == [f"project_images:{pid}:"]


@pytest.mark.parametrize(
    ("local_limit", "global_limit", "expected_maximum"),
    [(2, 6, 2), (6, 1, 1)],
)
def test_import_project_s3_files_honors_local_and_process_storage_limits(
    client,
    monkeypatch,
    local_limit,
    global_limit,
    expected_maximum,
):
    pid = _create_project(client, name=f"S3 concurrency {local_limit}-{global_limit}")
    active = 0
    maximum_active = 0
    limiter = image_storage_limit_service.ProcessWideStorageLimiter(global_limit)

    async def track_operation():
        nonlocal active, maximum_active
        active += 1
        maximum_active = max(maximum_active, active)
        await asyncio.sleep(0.01)
        active -= 1

    async def fake_get_s3_object_info(_bucket, _key):
        await track_operation()
        return {
            "size": 12,
            "content_type": "image/png",
            "metadata": {},
            "etag": '"stable-etag"',
        }

    async def fake_copy_s3_object_to_s3(*_args, **_kwargs):
        assert _kwargs["source_etag"] == '"stable-etag"'
        await track_operation()
        return True

    monkeypatch.setattr(
        images_router.settings, "MAX_S3_IMPORT_CONCURRENCY", local_limit
    )
    monkeypatch.setattr(image_storage_limit_service, "PROCESS_STORAGE_LIMITER", limiter)
    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )
    try:
        response = client.post(
            f"/api/projects/{pid}/s3/import",
            json={
                "s3_url": "s3://source-bucket/incoming",
                "keys": [f"incoming/{index}.png" for index in range(8)],
            },
        )
    finally:
        limiter.shutdown()

    assert response.status_code == 201, response.text
    assert len(response.json()["imported"]) == 8
    assert maximum_active == expected_maximum


def test_import_project_s3_files_rolls_back_and_removes_copies_on_database_failure(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="S3 DB cleanup")
    stored_objects = set()
    deleted_objects = []
    rollback_calls = 0
    original_rollback = AsyncSession.rollback

    async def fake_get_s3_object_info(_bucket, _key):
        return {
            "size": 12,
            "content_type": "image/png",
            "metadata": {},
            "etag": '"stable-etag"',
        }

    async def fake_copy_s3_object_to_s3(
        _source_bucket,
        _source_key,
        _destination_bucket,
        destination_key,
        *,
        source_etag=None,
    ):
        assert source_etag == '"stable-etag"'
        stored_objects.add(destination_key)
        return True

    async def fail_flush(_session, *_args, **_kwargs):
        raise RuntimeError("database unavailable")

    async def tracked_rollback(session, *args, **kwargs):
        nonlocal rollback_calls
        rollback_calls += 1
        return await original_rollback(session, *args, **kwargs)

    def fake_delete_file_from_s3(_bucket, object_key):
        deleted_objects.append(object_key)
        stored_objects.discard(object_key)
        return True

    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", fake_get_s3_object_info
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", fake_copy_s3_object_to_s3
    )
    monkeypatch.setattr(
        image_upload_service, "delete_file_from_s3", fake_delete_file_from_s3
    )
    monkeypatch.setattr(AsyncSession, "flush", fail_flush)
    monkeypatch.setattr(AsyncSession, "rollback", tracked_rollback)

    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": ["incoming/a.png", "incoming/b.png", "incoming/c.png"],
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to save imported image records"
    assert rollback_calls == 1
    assert len(deleted_objects) == 3
    assert stored_objects == set()
    listed = client.get(f"/api/projects/{pid}/images?limit=20")
    assert listed.status_code == 200
    assert listed.json() == []


def test_import_project_s3_files_validates_all_keys_and_metadata_before_storage(
    client, monkeypatch
):
    pid = _create_project(client, name="S3 preflight")
    storage_calls = 0

    async def unexpected_storage_call(*_args, **_kwargs):
        nonlocal storage_calls
        storage_calls += 1
        raise AssertionError("invalid requests must not reach object storage")

    monkeypatch.setattr(
        s3_import_workflow, "get_s3_object_info", unexpected_storage_call
    )
    monkeypatch.setattr(
        image_upload_service, "copy_s3_object_to_s3", unexpected_storage_call
    )
    response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": ["incoming/valid.png", "outside/invalid.png"],
        },
    )
    assert response.status_code == 400
    assert storage_calls == 0

    monkeypatch.setattr(images_router.settings, "MAX_BATCH_UPLOAD_MANIFEST_BYTES", 128)
    metadata_response = client.post(
        f"/api/projects/{pid}/s3/import",
        json={
            "s3_url": "s3://source-bucket/incoming",
            "keys": ["incoming/valid.png"],
            "metadata": {"padding": "x" * 256},
        },
    )
    assert metadata_response.status_code == 413
    assert "MAX_BATCH_UPLOAD_MANIFEST_BYTES" in metadata_response.text
    assert storage_calls == 0


def test_list_project_s3_files_returns_more_than_two_thousand_supported_objects(
    client, monkeypatch
):
    pid = _create_project(client, name="S3 large listing")
    objects = [
        {"key": f"incoming/image-{index:04d}.png", "size": index + 1}
        for index in range(2505)
    ]

    async def fake_list_s3_objects(bucket, prefix, max_keys=1000, **kwargs):
        assert bucket == "source-bucket"
        assert prefix == "incoming"
        assert max_keys == 5001
        assert kwargs["key_filter"]("incoming/image.png") is True
        return objects

    monkeypatch.setattr(image_s3_import_service, "list_s3_objects", fake_list_s3_objects)
    response = client.post(
        f"/api/projects/{pid}/s3/list",
        json={"s3_url": "s3://source-bucket/incoming"},
    )

    assert response.status_code == 200, response.text
    assert len(response.json()["objects"]) == 2505
    assert response.json()["truncated"] is False


def test_list_s3_objects_paginates_beyond_two_thousand(monkeypatch):
    raw_objects = [
        {"Key": f"incoming/image-{index:04d}.png", "Size": index + 1}
        for index in range(2505)
    ]

    class Paginator:
        def paginate(self, **kwargs):
            assert kwargs["PaginationConfig"] == {"MaxItems": 50000, "PageSize": 1000}
            return [
                {"Contents": raw_objects[:1000]},
                {"Contents": raw_objects[1000:2000]},
                {"Contents": raw_objects[2000:]},
            ]

    class Client:
        def get_paginator(self, operation):
            assert operation == "list_objects_v2"
            return Paginator()

    monkeypatch.setattr(boto3_client_module, "boto3_client", Client())
    listed = asyncio.run(
        boto3_client_module.list_s3_objects(
            "source-bucket",
            "incoming",
            max_keys=2505,
        )
    )
    assert len(listed) == 2505
    assert listed[-1]["key"] == "incoming/image-2504.png"


def test_list_s3_objects_skips_more_than_five_thousand_unsupported_keys_before_valid_files(
    monkeypatch,
):
    unsupported = [
        {"Key": f"incoming/readme-{index:04d}.txt", "Size": 1} for index in range(5_500)
    ]
    supported = [
        {"Key": "incoming/late-a.png", "Size": 12},
        {"Key": "incoming/late-b.npy", "Size": 24},
    ]
    raw_objects = unsupported + supported

    class Paginator:
        def paginate(self, **kwargs):
            assert kwargs["PaginationConfig"] == {"MaxItems": 50000, "PageSize": 1000}
            return [
                {"Contents": raw_objects[index : index + 1000]}
                for index in range(0, len(raw_objects), 1000)
            ]

    class Client:
        def get_paginator(self, operation):
            assert operation == "list_objects_v2"
            return Paginator()

    monkeypatch.setattr(boto3_client_module, "boto3_client", Client())
    listed = asyncio.run(
        boto3_client_module.list_s3_objects(
            "source-bucket",
            "incoming",
            max_keys=3,
            key_filter=lambda key: key.endswith((".png", ".npy")),
        )
    )

    assert [item["key"] for item in listed] == [
        "incoming/late-a.png",
        "incoming/late-b.npy",
    ]
    assert listed.scan_truncated is False


def test_list_s3_objects_reports_configured_raw_scan_truncation(monkeypatch):
    raw_objects = [
        {"Key": f"incoming/readme-{index:04d}.txt", "Size": 1} for index in range(12)
    ]

    class Paginator:
        def paginate(self, **_kwargs):
            return [{"Contents": raw_objects}]

    class Client:
        def get_paginator(self, _operation):
            return Paginator()

    monkeypatch.setattr(boto3_client_module, "boto3_client", Client())
    listed = asyncio.run(
        boto3_client_module.list_s3_objects(
            "source-bucket",
            "incoming",
            max_keys=2,
            max_scan_keys=5,
            key_filter=lambda key: key.endswith(".png"),
        )
    )

    assert listed == []
    assert listed.scan_truncated is True


@pytest.mark.parametrize("operation", ["upload", "head", "copy"])
def test_blocking_boto_operations_hold_cancellation_until_executor_work_settles(
    monkeypatch,
    operation,
):
    started = threading.Event()
    release = threading.Event()

    class Client:
        def _block(self):
            started.set()
            assert release.wait(timeout=5)

        def upload_fileobj(self, *_args, **_kwargs):
            self._block()

        def head_object(self, **_kwargs):
            self._block()
            return {"ContentLength": 4, "Metadata": {}}

        def copy_object(self, **_kwargs):
            self._block()
            return {}

    monkeypatch.setattr(boto3_client_module, "boto3_client", Client())

    async def exercise():
        if operation == "upload":
            coroutine = boto3_client_module.upload_file_to_s3(
                "bucket",
                "target",
                io.BytesIO(b"data"),
                length=4,
                content_type="application/octet-stream",
            )
        elif operation == "head":
            coroutine = boto3_client_module.get_s3_object_info("bucket", "source")
        else:
            coroutine = boto3_client_module.copy_s3_object_to_s3(
                "source-bucket",
                "source",
                "destination-bucket",
                "target",
            )

        task = asyncio.create_task(coroutine)
        assert await asyncio.to_thread(started.wait, 2)
        task.cancel()
        await asyncio.sleep(0.02)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())


def test_numpy_volume_metadata_and_axis_slice_endpoints(client, monkeypatch, tmp_path):
    pid = _create_project(client, name="volume-slice-endpoints")
    volume = np.arange(2 * 3 * 4, dtype=np.uint16).reshape((2, 3, 4))
    payload = io.BytesIO()
    np.save(payload, volume)
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    raw_payload = payload.getvalue()
    storage_reads = {"count": 0}

    async def stream_source(_db_image, _access):
        storage_reads["count"] += 1
        midpoint = len(raw_payload) // 2
        yield raw_payload[:midpoint]
        yield raw_payload[midpoint:]

    monkeypatch.setattr(
        images_router.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volume-cache")
    )
    monkeypatch.setattr("services.images.volume_sources.iter_authorized_npy_bytes", stream_source)
    meta = client.get(f"/api/images/{image_id}/volume-metadata")
    assert meta.status_code == 200
    assert meta.json()["dimensions"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert meta.json()["interpretation"] == "voxel_array"
    assert meta.json()["bit_depth"] == 16
    assert storage_reads["count"] == 0

    sliced = client.get(f"/api/images/{image_id}/volume-slice?axis=coronal&index=1")
    assert sliced.status_code == 200
    assert sliced.headers["content-type"].startswith("image/png")
    assert sliced.headers["cache-control"] == "private, max-age=3600"
    with Image.open(io.BytesIO(sliced.content)) as image:
        assert image.size == (4, 2)
        assert image.convert("L").getextrema()[1] > 0
    assert storage_reads["count"] == 1

    out_of_range = client.get(
        f"/api/images/{image_id}/volume-slice?axis=sagittal&index=99"
    )
    assert out_of_range.status_code == 400


def test_numpy_volume_connected_selection_is_true_3d_and_guarded(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="volume-connected-selection")
    volume = np.full((3, 4, 5), 220, dtype=np.uint8)
    for z, y, x in ((0, 1, 1), (0, 1, 2), (1, 1, 2), (1, 2, 2), (2, 2, 2)):
        volume[z, y, x] = 10
    volume[2, 3, 3] = 10  # diagonal-only contact must not join 6-connectivity.
    payload = io.BytesIO()
    np.save(payload, volume)
    raw_payload = payload.getvalue()
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("connected.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    async def stream_source(_db_image, _access):
        yield raw_payload

    monkeypatch.setattr(
        images_router.settings,
        "VOLUME_CACHE_DIR",
        str(tmp_path / "connected-volume-cache"),
    )
    monkeypatch.setattr("services.images.volume_sources.iter_authorized_npy_bytes", stream_source)
    selected = client.post(
        f"/api/images/{image_id}/volume-connected-selection",
        json={"seed": [1, 1, 0], "sensitivity": 0},
    )
    assert selected.status_code == 200, selected.text
    result = selected.json()
    assert result["dimensions"] == [5, 4, 3]
    assert result["voxel_count"] == 5
    assert result["volume_runs"] == [
        [0, 1, 1, 3],
        [1, 1, 2, 3],
        [1, 2, 2, 3],
        [2, 2, 2, 3],
    ]
    assert result["connectivity"] == 6
    assert result["truncated"] is False

    limited = client.post(
        f"/api/images/{image_id}/volume-connected-selection",
        json={"seed": [1, 1, 0], "sensitivity": 0, "max_voxels": 3},
    )
    assert limited.status_code == 200
    assert limited.json()["voxel_count"] == 3
    assert limited.json()["truncated"] is True
    assert limited.json()["truncation_reason"] == "max-voxels"

    out_of_bounds = client.post(
        f"/api/images/{image_id}/volume-connected-selection",
        json={"seed": [99, 1, 0], "sensitivity": 0},
    )
    assert out_of_bounds.status_code == 400

    source_loads = 0

    async def should_not_load_source(*_args, **_kwargs):
        nonlocal source_loads
        source_loads += 1
        raise AssertionError("a saturated request must not start source loading")

    saturated = threading.BoundedSemaphore(1)
    assert saturated.acquire(blocking=False)
    monkeypatch.setattr(
        image_volume_service,
        "process_volume_connected_selection_semaphore",
        saturated,
    )
    monkeypatch.setattr(
        image_volume_serving,
        "get_npy_volume_handle",
        should_not_load_source,
    )
    try:
        busy = client.post(
            f"/api/images/{image_id}/volume-connected-selection",
            json={"seed": [1, 1, 0], "sensitivity": 0},
        )
    finally:
        saturated.release()
    assert busy.status_code == 429
    assert busy.headers["retry-after"] == "1"
    assert source_loads == 0


def test_volume_connected_selection_request_has_safe_budgets_and_finite_ranges():
    request = VolumeConnectedSelectionRequest(seed=[0, 0, 0])
    assert request.max_voxels == 50_000
    assert request.max_examined == 150_000
    assert request.max_runs == 10_000

    invalid_payloads = (
        {"max_voxels": 100_001},
        {"max_examined": 300_001},
        {"max_runs": 20_001},
        {"sensitivity": float("nan")},
        {"display_min": float("-inf"), "display_max": 1.0},
        {"display_min": 0.0, "display_max": float("inf")},
    )
    for invalid in invalid_payloads:
        with pytest.raises(ValueError):
            VolumeConnectedSelectionRequest(seed=[0, 0, 0], **invalid)


def test_volume_connected_selection_marks_runs_partial_only_after_limit_is_exceeded():
    volume = np.asarray(
        [
            [
                [0, 255, 0],
                [0, 0, 0],
            ],
        ],
        dtype=np.uint8,
    )
    options = {
        "seed": [0, 1, 0],
        "sensitivity": 0.0,
        "display_min": None,
        "display_max": None,
        "max_voxels": 10,
        "max_examined": 10,
    }

    exact = image_volume_rendering_service.connected_volume_selection(
        volume,
        max_runs=3,
        **{**options, "max_voxels": 5},
    )
    limited = image_volume_rendering_service.connected_volume_selection(
        volume, max_runs=2, **options
    )

    assert len(exact["volume_runs"]) == 3
    assert exact["truncated"] is False
    assert len(limited["volume_runs"]) == 2
    assert limited["truncated"] is True
    assert limited["truncation_reason"] == "max-runs"


def test_volume_connected_selection_rejects_known_oversized_materialized_source_before_read(
    client,
    monkeypatch,
):
    pid = _create_project(client, name="volume-connected-source-budget")
    payload = _make_tiff_bytes(frame_count=2, size=(2, 2))
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.tiff", payload, "image/tiff")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    source_reads = 0

    async def forbidden_source_read(*_args, **_kwargs):
        nonlocal source_reads
        source_reads += 1
        raise AssertionError("known oversized sources must not be materialized")

    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_SOURCE_BYTES",
        1,
    )
    monkeypatch.setattr(
        image_volume_source_service,
        "read_authorized_image_bytes",
        forbidden_source_read,
    )

    response = client.post(
        f"/api/images/{image_id}/volume-connected-selection",
        json={"seed": [0, 0, 0]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Volume source exceeds the connected-selection 1-byte source limit"
    )
    assert source_reads == 0


def test_connected_selection_source_reader_stops_when_stream_crosses_budget(
    monkeypatch,
):
    class StoredVolume:
        metadata_json = {}
        object_storage_key = "opaque-volume-key"

    class Response:
        headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size):
            assert chunk_size == 8 * 1024 * 1024
            yield b"123"
            yield b"456"
            raise AssertionError(
                "reader must stop immediately after the budget is crossed"
            )

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, method, url):
            assert method == "GET"
            assert url == "https://storage.test/volume"
            return Response()

    monkeypatch.setattr(
        images_router,
        "get_presigned_download_url",
        lambda **_kwargs: "https://storage.test/volume",
    )
    monkeypatch.setattr(image_volume_source_service.httpx, "AsyncClient", Client)

    with pytest.raises(
        ValueError,
        match="connected-selection 5-byte source limit",
    ):
        asyncio.run(
            image_volume_source_service.read_authorized_image_bytes(
                StoredVolume(),
                images_router._volume_source_access(),
                max_bytes=5,
            )
        )


def test_volume_connected_selection_npz_budget_rejects_declared_voxels_before_decode(
    monkeypatch,
):
    npy_payload = io.BytesIO()
    np.save(npy_payload, np.zeros((2, 3, 4), dtype=np.uint8))
    archive_payload = io.BytesIO()
    with zipfile.ZipFile(
        archive_payload,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        archive.writestr("voxels.npy", npy_payload.getvalue())

    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_SOURCE_BYTES",
        4096,
    )
    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_VOXELS",
        10,
    )
    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_DECODED_BYTES",
        4096,
    )
    decode_calls = 0

    def forbidden_array_decode(*_args, **_kwargs):
        nonlocal decode_calls
        decode_calls += 1
        raise AssertionError("oversized NPZ arrays must not be decoded")

    monkeypatch.setattr(
        np.lib.format,
        "read_array",
        forbidden_array_decode,
    )

    with pytest.raises(ValueError, match="24 voxels.*10-voxel limit"):
        image_volume_serving.decode_and_select_connected_volume(
            kind="npz",
            source=archive_payload.getvalue(),
            filename="volume.npz",
            volume=None,
            seed=[0, 0, 0],
            sensitivity=0.0,
            display_min=None,
            display_max=None,
            max_voxels=10,
            max_examined=10,
            max_runs=10,
        )

    assert decode_calls == 0


def test_volume_connected_selection_rechecks_actual_decoded_bytes(monkeypatch):
    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_SOURCE_BYTES",
        4096,
    )
    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_VOXELS",
        100,
    )
    monkeypatch.setattr(
        image_volume_service,
        "VOLUME_CONNECTED_SELECTION_MAX_DECODED_BYTES",
        20,
    )
    monkeypatch.setattr(
        image_volume_service,
        "load_tiff_volume",
        lambda _source, *, limits: np.zeros((1, 2, 3), dtype=np.uint32),
    )

    with pytest.raises(ValueError, match="24 decoded bytes.*20-byte limit"):
        image_volume_serving.decode_and_select_connected_volume(
            kind="tiff",
            source=b"safe-sized-source",
            filename="volume.tiff",
            volume=None,
            seed=[0, 0, 0],
            sensitivity=0.0,
            display_min=None,
            display_max=None,
            max_voxels=10,
            max_examined=10,
            max_runs=10,
        )


def test_volume_connected_selection_materialized_decode_has_single_process_slot(
    monkeypatch,
):
    assert image_volume_service.VOLUME_CONNECTED_SELECTION_DECODE_CONCURRENCY == 1
    semaphore = threading.BoundedSemaphore(1)
    worker_future = Future()

    async def exercise():
        async with (
            image_volume_service.volume_connected_selection_decode_slot() as lease
        ):
            lease.release_when_done(worker_future)
        with pytest.raises(CapacityError) as exc_info:
            async with image_volume_service.volume_connected_selection_decode_slot():
                pass
        assert exc_info.value.status_code == 429
        assert exc_info.value.headers == {"Retry-After": "1"}
        worker_future.set_result(None)
        async with image_volume_service.volume_connected_selection_decode_slot():
            pass

    monkeypatch.setattr(
        image_volume_service,
        "process_volume_connected_selection_decode_semaphore",
        semaphore,
    )
    asyncio.run(exercise())


def test_volume_connected_selection_unexpected_failure_is_logged_and_sanitized(
    client,
    monkeypatch,
    caplog,
):
    pid = _create_project(client, name="volume-connected-unexpected-error")
    tiff_payload = _make_tiff_bytes(frame_count=2, size=(2, 2)).getvalue()
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("volume.tiff", io.BytesIO(tiff_payload), "image/tiff")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    async def source_read(*_args, **_kwargs):
        return tiff_payload

    def unexpected_failure(**_kwargs):
        raise RuntimeError("storage-secret-must-not-leak")

    monkeypatch.setattr(
        image_volume_source_service,
        "read_authorized_image_bytes",
        source_read,
    )
    monkeypatch.setattr(
        image_volume_serving,
        "decode_and_select_connected_volume",
        unexpected_failure,
    )
    caplog.set_level("ERROR", logger="services.images.volume_serving")

    response = client.post(
        f"/api/images/{image_id}/volume-connected-selection",
        json={"seed": [0, 0, 0]},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to select volume"
    assert "storage-secret-must-not-leak" not in response.text
    assert "Unexpected volume connected-selection failure" in caplog.text


def test_volume_connected_selection_jobs_keep_permits_after_request_cancellation(
    monkeypatch,
):
    assert image_volume_service.VOLUME_CONNECTED_SELECTION_CONCURRENCY == 2
    semaphore = threading.BoundedSemaphore(2)
    executor = ThreadPoolExecutor(
        max_workers=2,
        thread_name_prefix="test-volume-connected",
    )
    active_jobs = 0
    maximum_active_jobs = 0
    job_lock = threading.Lock()
    two_jobs_started = threading.Event()
    release_jobs = threading.Event()
    all_jobs_finished = threading.Event()

    def blocked_selection(volume, **_kwargs):
        nonlocal active_jobs, maximum_active_jobs
        with job_lock:
            active_jobs += 1
            maximum_active_jobs = max(maximum_active_jobs, active_jobs)
            if active_jobs == 2:
                two_jobs_started.set()
        try:
            assert release_jobs.wait(2), "connected-selection jobs were not released"
            return {"marker": int(volume[0, 0, 0])}
        finally:
            with job_lock:
                active_jobs -= 1
                if active_jobs == 0:
                    all_jobs_finished.set()

    async def guarded_job(index):
        async with image_volume_service.volume_connected_selection_slot() as lease:
            worker_future = executor.submit(
                blocked_selection,
                np.asarray([[[index]]], dtype=np.uint8),
                seed=[0, 0, 0],
                sensitivity=0.0,
                display_min=None,
                display_max=None,
                max_voxels=1,
                max_examined=1,
                max_runs=1,
            )
            lease.release_when_done(worker_future)
            return await asyncio.wrap_future(worker_future)

    async def exercise():
        tasks = [asyncio.create_task(guarded_job(index)) for index in range(2)]
        assert await asyncio.to_thread(two_jobs_started.wait, 2)
        with pytest.raises(CapacityError) as exc_info:
            await guarded_job(2)
        assert exc_info.value.status_code == 429
        assert exc_info.value.headers == {"Retry-After": "1"}
        for task in tasks:
            task.cancel()
        cancelled = await asyncio.gather(*tasks, return_exceptions=True)
        assert all(isinstance(result, asyncio.CancelledError) for result in cancelled)
        with pytest.raises(CapacityError) as cancelled_exc_info:
            await guarded_job(3)
        assert cancelled_exc_info.value.status_code == 429
        with job_lock:
            assert active_jobs == 2
            assert maximum_active_jobs == 2
        release_jobs.set()
        assert await asyncio.to_thread(all_jobs_finished.wait, 2)
        async with image_volume_service.volume_connected_selection_slot():
            pass

    monkeypatch.setattr(
        image_volume_service,
        "process_volume_connected_selection_semaphore",
        semaphore,
    )
    try:
        asyncio.run(exercise())
    finally:
        release_jobs.set()
        executor.shutdown(wait=True, cancel_futures=True)


@pytest.mark.parametrize(
    "channel_count,color_mode,pixel",
    [
        (3, "rgb", (11, 22, 33)),
        (4, "rgba", (11, 22, 33, 44)),
    ],
)
def test_color_numpy_volume_metadata_and_axis_slices_preserve_uint8_channels(
    client, monkeypatch, tmp_path, channel_count, color_mode, pixel
):
    pid = _create_project(client, name=f"volume-{color_mode}-slices")
    volume = np.empty((2, 3, 4, channel_count), dtype=np.uint8)
    volume[...] = pixel
    payload = io.BytesIO()
    np.save(payload, volume)
    raw_payload = payload.getvalue()
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={
            "file": (f"volume-{color_mode}.npy", payload, "application/octet-stream")
        },
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]
    storage_reads = 0

    async def stream_source(_db_image, _access):
        nonlocal storage_reads
        storage_reads += 1
        yield raw_payload

    monkeypatch.setattr(
        images_router.settings,
        "VOLUME_CACHE_DIR",
        str(tmp_path / f"volume-cache-{color_mode}"),
    )
    monkeypatch.setattr("services.images.volume_sources.iter_authorized_npy_bytes", stream_source)

    metadata = client.get(f"/api/images/{image_id}/volume-metadata")
    assert metadata.status_code == 200
    assert metadata.json()["dimensions"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert metadata.json()["channel_count"] == channel_count
    assert metadata.json()["color_mode"] == color_mode
    assert storage_reads == 0

    expected_sizes = {"axial": (4, 3), "coronal": (4, 2), "sagittal": (3, 2)}
    for axis in ("axial", "coronal", "sagittal"):
        response = client.get(
            f"/api/images/{image_id}/volume-slice?axis={axis}&index=0"
        )
        assert response.status_code == 200, response.text
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.mode == color_mode.upper()
            assert image.size == expected_sizes[axis]
            assert image.getpixel((0, 0)) == pixel
    assert storage_reads == 1


def test_binary_rgba_segment_volume_is_visible_on_every_axis(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="binary-rgba-segment-volume")
    volume = np.zeros((2, 3, 4, 4), dtype=np.uint8)
    volume[0, 0, 0, 0] = 1
    volume[0, 0, 1, 1] = 1
    volume[0, 1, 0, 2] = 1
    volume[0, 2, 3, 3] = 1
    volume[1, 0, 2, 3] = 1
    volume[1, 2, 0, 3] = 1
    payload = io.BytesIO()
    np.save(payload, volume)
    raw_payload = payload.getvalue()
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("segments-rgba.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]

    async def stream_source(_db_image, _access):
        yield raw_payload

    monkeypatch.setattr(
        images_router.settings,
        "VOLUME_CACHE_DIR",
        str(tmp_path / "segment-volume-cache"),
    )
    monkeypatch.setattr("services.images.volume_sources.iter_authorized_npy_bytes", stream_source)

    metadata = client.get(f"/api/images/{image_id}/volume-metadata")
    assert metadata.status_code == 200
    assert metadata.json()["channel_count"] == 4
    assert metadata.json()["color_mode"] == "rgba"

    expected = {
        "axial": ((4, 3), (3, 2)),
        "coronal": ((4, 2), (2, 1)),
        "sagittal": ((3, 2), (2, 1)),
    }
    for axis, (expected_size, fourth_channel_pixel) in expected.items():
        response = client.get(
            f"/api/images/{image_id}/volume-slice?axis={axis}&index=0"
        )
        assert response.status_code == 200, response.text
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.mode == "RGBA"
            assert image.size == expected_size
            assert image.getchannel("A").getextrema() == (0, 224)
            assert image.getpixel(fourth_channel_pixel) == (245, 158, 11, 224)


def test_sparse_rgba_render_summary_is_bounded_cached_and_channel_representative(
    client,
    monkeypatch,
    tmp_path,
):
    pid = _create_project(client, name="sparse-rgba-render-summary")
    volume = np.zeros((25, 3, 5, 4), dtype=np.uint8)
    volume[23, 1, 4, 0] = 1
    volume[7, 2, 0, 1] = 1
    volume[18, 0, 3, 2] = 1
    volume[23, 2, 2, 3] = 1
    payload = io.BytesIO()
    np.save(payload, volume)
    raw_payload = payload.getvalue()
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("sparse-segments.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]
    storage_reads = 0
    summary_calls = 0
    original_summarize = image_volume_rendering_service.summarize_rgba_volume_for_rendering

    async def stream_source(_db_image, _access):
        nonlocal storage_reads
        storage_reads += 1
        yield raw_payload

    def counted_summarize(array):
        nonlocal summary_calls
        summary_calls += 1
        return original_summarize(array)

    monkeypatch.setattr(
        images_router.settings,
        "VOLUME_CACHE_DIR",
        str(tmp_path / "sparse-summary-cache"),
    )
    monkeypatch.setattr(
        image_volume_rendering_service, "VOLUME_RENDER_SUMMARY_SCAN_MAX_PIXELS", 2
    )
    monkeypatch.setattr(
        image_volume_source_service, "iter_authorized_npy_bytes", stream_source
    )
    monkeypatch.setattr(
        image_volume_service, "summarize_rgba_volume_for_rendering", counted_summarize
    )

    first = client.get(f"/api/images/{image_id}/volume-render-summary")
    second = client.get(f"/api/images/{image_id}/volume-render-summary")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json() == second.json()
    assert first.json() == {
        "summary_version": 1,
        "kind": "rgba-channel-presence",
        "active_channels": [0, 1, 2, 3],
        "channel_representatives": [
            {"channel": 0, "axial_index": 23},
            {"channel": 1, "axial_index": 7},
            {"channel": 2, "axial_index": 18},
            {"channel": 3, "axial_index": 23},
        ],
        "representative_axial_indices": [7, 18, 23],
        "source_kind": "npy",
        "dimensions": {"axial": 25, "coronal": 3, "sagittal": 5},
    }
    assert len(first.json()["representative_axial_indices"]) <= 4
    assert storage_reads == 1
    assert summary_calls == 1


def test_volume_render_summary_scans_honor_process_concurrency_limit(monkeypatch):
    assert image_volume_service.process_volume_render_summary_scan_limiter.capacity == 2
    limiter = image_storage_limit_service.ProcessWideStorageLimiter(2)
    active_scans = 0
    maximum_active_scans = 0
    scan_lock = threading.Lock()
    two_scans_started = threading.Event()
    release_scans = threading.Event()
    cache_prefix = f"scan-limit-{uuid.uuid4()}"

    def blocked_summarize(array):
        nonlocal active_scans, maximum_active_scans
        with scan_lock:
            active_scans += 1
            maximum_active_scans = max(maximum_active_scans, active_scans)
            if active_scans == 2:
                two_scans_started.set()
        try:
            assert release_scans.wait(2), "summary scan was not released"
            return {"marker": int(array[0])}
        finally:
            with scan_lock:
                active_scans -= 1

    async def exercise():
        tasks = [
            asyncio.create_task(
                image_volume_service.get_or_compute_volume_render_summary(
                    (f"{cache_prefix}-{index}", "version", 1),
                    np.asarray([index], dtype=np.uint8),
                )
            )
            for index in range(4)
        ]
        assert await asyncio.to_thread(two_scans_started.wait, 2)
        await asyncio.sleep(0.05)
        with scan_lock:
            assert active_scans == 2
            assert maximum_active_scans == 2
        release_scans.set()
        return await asyncio.gather(*tasks)

    monkeypatch.setattr(
        image_volume_service,
        "process_volume_render_summary_scan_limiter",
        limiter,
    )
    monkeypatch.setattr(
        image_volume_service,
        "summarize_rgba_volume_for_rendering",
        blocked_summarize,
    )
    try:
        assert asyncio.run(exercise()) == [
            {"marker": 0},
            {"marker": 1},
            {"marker": 2},
            {"marker": 3},
        ]
    finally:
        release_scans.set()
        limiter.shutdown()
        with image_volume_service.volume_render_summary_cache_lock:
            for key in list(image_volume_service.volume_render_summary_cache):
                if key[0].startswith(cache_prefix):
                    image_volume_service.volume_render_summary_cache.pop(key, None)
            for key in list(image_volume_service.volume_render_summary_futures):
                if key[0].startswith(cache_prefix):
                    image_volume_service.volume_render_summary_futures.pop(key, None)


def test_numpy_volume_metadata_fallback_reads_only_bounded_header(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="volume-header-fallback")
    volume = np.arange(2 * 3 * 4, dtype=np.uint16).reshape((2, 3, 4))
    payload = io.BytesIO()
    np.save(payload, volume)
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("legacy-volume.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    raw_payload = payload.getvalue()
    deleted = client.delete(f"/api/images/{image_id}/metadata/volume_shape")
    assert deleted.status_code == 200
    requests = []

    class HeaderResponse:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size=None):
            yield raw_payload

    class HeaderClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, method, url, **kwargs):
            requests.append((method, url, kwargs))
            return HeaderResponse()

    monkeypatch.setattr(
        images_router.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volume-cache")
    )
    monkeypatch.setattr("services.images.volume_sources.httpx.AsyncClient", HeaderClient)

    response = client.get(f"/api/images/{image_id}/volume-metadata")

    assert response.status_code == 200
    assert response.json()["dimensions"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert response.json()["voxel_dtype"] == "uint16"
    assert len(requests) == 1
    assert requests[0][0] == "GET"
    assert requests[0][2]["headers"]["Range"].startswith("bytes=0-")


@pytest.mark.parametrize(
    "metadata",
    [
        {
            "volume_shape": {"axial": 0, "coronal": 3, "sagittal": 4},
            "voxel_dtype": "uint8",
        },
        {
            "volume_shape": {"axial": 10**40, "coronal": 3, "sagittal": 4},
            "voxel_dtype": "uint8",
        },
        {
            "volume_shape": {"axial": 2, "coronal": 3, "sagittal": 4},
            "voxel_dtype": "object",
        },
        {
            "volume_shape": {"axial": 2, "coronal": 3, "sagittal": 4},
            "voxel_dtype": "complex64",
        },
        {
            "volume_shape": {"axial": 2, "coronal": 3, "sagittal": 4},
            "voxel_dtype": "uint8",
            "channel_count": 3,
            "color_mode": "rgba",
        },
    ],
)
def test_persisted_npy_metadata_rejects_unsafe_fast_path(metadata):
    assert image_volume_service.persisted_npy_volume_meta(metadata) is None


def test_legacy_persisted_npy_metadata_without_layout_requires_header_probe():
    meta = image_volume_service.persisted_npy_volume_meta(
        {
            "volume_shape": {"axial": 2, "coronal": 3, "sagittal": 4},
            "voxel_dtype": "uint8",
        }
    )

    assert meta is None


def test_legacy_rgba_npy_metadata_uses_header_for_authoritative_layout(
    client, monkeypatch
):
    pid = _create_project(client, name="legacy-rgba-volume-metadata")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4, 4), dtype=np.uint8))
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("legacy-rgba.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]
    assert (
        client.delete(f"/api/images/{image_id}/metadata/channel_count").status_code
        == 200
    )
    assert (
        client.delete(f"/api/images/{image_id}/metadata/color_mode").status_code == 200
    )
    original_get_metadata = image_volume_service.persisted_npy_volume_meta
    assert (
        original_get_metadata(
            {
                "volume_shape": {"axial": 2, "coronal": 3, "sagittal": 4},
                "voxel_dtype": "uint8",
            }
        )
        is None
    )
    header_reads = 0

    async def read_header(_db_image, _access):
        nonlocal header_reads
        header_reads += 1
        return (2, 3, 4, 4), "|u1"

    monkeypatch.setattr("services.images.volume_sources.read_authorized_npy_header", read_header)

    response = client.get(f"/api/images/{image_id}/volume-metadata")

    assert response.status_code == 200, response.text
    assert response.json()["dimensions"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert response.json()["channel_count"] == 4
    assert response.json()["color_mode"] == "rgba"
    assert header_reads == 1


def test_invalid_persisted_npy_metadata_falls_back_to_header(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="invalid-volume-metadata-fallback")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint16))
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("invalid-fast-path.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    assert (
        client.put(
            f"/api/images/{image_id}/metadata",
            json={
                "key": "volume_shape",
                "value": {"axial": 0, "coronal": 3, "sagittal": 4},
            },
        ).status_code
        == 200
    )
    header_reads = 0

    async def read_header(_db_image, _access):
        nonlocal header_reads
        header_reads += 1
        return (2, 3, 4), "<u2"

    monkeypatch.setattr(
        images_router.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volume-cache")
    )
    monkeypatch.setattr("services.images.volume_sources.read_authorized_npy_header", read_header)

    response = client.get(f"/api/images/{image_id}/volume-metadata")

    assert response.status_code == 200
    assert response.json()["dimensions"] == {"axial": 2, "coronal": 3, "sagittal": 4}
    assert header_reads == 1


def test_legacy_tiff_volume_metadata_uses_persisted_shape_without_decoding(
    client, monkeypatch
):
    pid = _create_project(client, name="legacy-tiff-volume-metadata")
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={
            "file": ("legacy-stack.tif", _make_tiff_bytes(frame_count=3), "image/tiff")
        },
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]
    assert (
        client.delete(f"/api/images/{image_id}/metadata/channel_count").status_code
        == 200
    )
    assert (
        client.delete(f"/api/images/{image_id}/metadata/color_mode").status_code == 200
    )

    decoded = False

    async def should_not_read_source(_db_image, _access):
        nonlocal decoded
        decoded = True
        raise AssertionError(
            "persisted TIFF volume metadata should avoid source decode"
        )

    monkeypatch.setattr(
        "services.images.volume_sources.read_authorized_image_bytes", should_not_read_source
    )

    response = client.get(f"/api/images/{image_id}/volume-metadata")

    assert response.status_code == 200, response.text
    assert response.json()["dimensions"] == {"axial": 3, "coronal": 10, "sagittal": 10}
    assert response.json()["channel_count"] == 1
    assert response.json()["color_mode"] == "scalar"
    assert decoded is False


def test_missing_tiff_volume_metadata_is_rebuilt_from_source(client, monkeypatch):
    pid = _create_project(client, name="rebuild-tiff-volume-metadata")
    payload = _make_tiff_bytes(frame_count=2)
    raw_payload = payload.getvalue()
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("rebuild-stack.tif", payload, "image/tiff")},
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]
    for key in (
        "load_mode",
        "tiff_dimensionality",
        "frame_count",
        "volume_shape",
        "pixel_dtype",
        "voxel_dtype",
        "bit_depth",
        "channel_count",
        "color_mode",
    ):
        assert (
            client.delete(f"/api/images/{image_id}/metadata/{key}").status_code == 200
        )

    async def read_source(_db_image, _access):
        return raw_payload

    monkeypatch.setattr("services.images.volume_sources.read_authorized_image_bytes", read_source)

    response = client.get(f"/api/images/{image_id}/volume-metadata")

    assert response.status_code == 200, response.text
    assert response.json()["dimensions"] == {"axial": 2, "coronal": 10, "sagittal": 10}
    assert response.json()["channel_count"] == 1
    assert response.json()["color_mode"] == "scalar"

    image = client.get(f"/api/images/{image_id}")
    assert image.status_code == 200
    metadata = image.json()["metadata"]
    assert metadata["load_mode"] == "volume"
    assert metadata["tiff_dimensionality"] == "3d"
    assert metadata["frame_count"] == 2
    assert metadata["volume_shape"] == {"axial": 2, "coronal": 10, "sagittal": 10}
    assert metadata["channel_count"] == 1
    assert metadata["color_mode"] == "scalar"


def test_storage_http_error_does_not_expose_presigned_query(client, monkeypatch):
    pid = _create_project(client, name="storage-error-sanitization")
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("private.png", _make_png_bytes(), "image/png")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    secret_url = (
        "http://minio/private.png?X-Amz-Credential=SECRET&X-Amz-Signature=TOPSECRET"
    )

    class FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url):
            request = httpx.Request("GET", url)
            response = httpx.Response(503, request=request)
            raise httpx.HTTPStatusError(
                f"storage failed for {url}", request=request, response=response
            )

    monkeypatch.setattr(
        "routers.images.get_presigned_download_url", lambda **_kwargs: secret_url
    )
    monkeypatch.setattr("services.images.thumbnails.httpx.AsyncClient", FailingClient)

    response = client.get(f"/api/images/{image_id}/content")

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail == "Unable to retrieve image data from object storage"
    assert "X-Amz" not in detail
    assert "SECRET" not in detail


def test_npy_volume_slice_storage_error_keeps_safe_status_and_detail(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="volume-storage-error-sanitization")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint8))
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("private.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    secret_url = (
        "http://minio/private.npy?X-Amz-Credential=SECRET&X-Amz-Signature=TOPSECRET"
    )

    class FailingResponse:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def raise_for_status(self):
            request = httpx.Request("GET", secret_url)
            response = httpx.Response(503, request=request)
            raise httpx.HTTPStatusError(
                f"storage failed for {secret_url}",
                request=request,
                response=response,
            )

    class FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, method, url, **_kwargs):
            return FailingResponse()

    monkeypatch.setattr(
        images_router.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volume-cache")
    )
    monkeypatch.setattr(
        "routers.images.get_presigned_download_url", lambda **_kwargs: secret_url
    )
    monkeypatch.setattr("services.images.volume_sources.httpx.AsyncClient", FailingClient)

    response = client.get(f"/api/images/{image_id}/volume-slice?axis=axial&index=0")

    assert response.status_code == 502
    assert (
        response.json()["detail"] == "Unable to retrieve image data from object storage"
    )
    assert "X-Amz" not in response.text
    assert "SECRET" not in response.text


def test_volume_metadata_cache_failure_is_sanitized_server_error(client, monkeypatch):
    from routers import images as images_router

    pid = _create_project(client, name="volume-metadata-cache-error")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint8))
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("cache-error.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    assert (
        client.delete(f"/api/images/{image_id}/metadata/volume_shape").status_code
        == 200
    )

    def fail_cache_lookup(_identity):
        raise image_volume_serving.VolumeCacheError(
            "/private/cache/volume.npy: permission denied"
        )

    monkeypatch.setattr(image_volume_serving, "get_materialized_npy_path", fail_cache_lookup)

    response = client.get(f"/api/images/{image_id}/volume-metadata")

    assert response.status_code == 500
    assert response.json()["detail"] == "Volume cache is temporarily unavailable"
    assert "/private/cache" not in response.text


def test_volume_slice_cache_failure_is_sanitized_server_error(client, monkeypatch):
    from routers import images as images_router

    pid = _create_project(client, name="volume-slice-cache-error")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint8))
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("cache-error.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    async def fail_cache_open(*_args, **_kwargs):
        raise image_volume_serving.VolumeCacheError(
            "/private/cache/volume.npy: input/output error"
        )

    monkeypatch.setattr(image_volume_serving, "get_npy_volume_handle", fail_cache_open)

    response = client.get(f"/api/images/{image_id}/volume-slice?axis=axial&index=0")

    assert response.status_code == 500
    assert response.json()["detail"] == "Volume cache is temporarily unavailable"
    assert "/private/cache" not in response.text


def test_malformed_npy_volume_remains_client_error(client, monkeypatch):
    from routers import images as images_router

    pid = _create_project(client, name="malformed-volume-client-error")
    payload = io.BytesIO()
    np.save(payload, np.zeros((2, 3, 4), dtype=np.uint8))
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("malformed.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    async def reject_source(*_args, **_kwargs):
        raise image_volume_serving.InvalidVolumeSourceError(
            "Invalid NumPy volume: malformed header"
        )

    monkeypatch.setattr(image_volume_serving, "get_npy_volume_handle", reject_source)

    response = client.get(f"/api/images/{image_id}/volume-slice?axis=axial&index=0")

    assert response.status_code == 400
    assert "malformed header" in response.json()["detail"]


def test_uint16_constant_nonzero_volume_slice_renders_visible_pixels(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="uint16-constant-volume-slice")
    volume = np.full((2, 3, 4), 2048, dtype=np.uint16)
    payload = io.BytesIO()
    np.save(payload, volume)
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("constant-uint16.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    raw_payload = payload.getvalue()

    async def stream_source(_db_image, _access):
        yield raw_payload

    monkeypatch.setattr(
        images_router.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volume-cache")
    )
    monkeypatch.setattr("services.images.volume_sources.iter_authorized_npy_bytes", stream_source)

    sliced = client.get(f"/api/images/{image_id}/volume-slice?axis=axial&index=0")

    assert sliced.status_code == 200
    assert sliced.headers["cache-control"] == "private, max-age=3600"
    with Image.open(io.BytesIO(sliced.content)) as image:
        assert image.size == (4, 3)
        assert image.convert("L").getextrema() == (255, 255)


def test_volume_slice_cache_reuses_rendered_png_for_repeated_slice(
    client, monkeypatch, tmp_path
):
    pid = _create_project(client, name="volume-slice-cache")
    volume = np.arange(2 * 3 * 4, dtype=np.uint16).reshape((2, 3, 4))
    payload = io.BytesIO()
    np.save(payload, volume)
    payload.seek(0)
    upload = client.post(
        f"/api/projects/{pid}/images",
        files={"file": ("cache-uint16.npy", payload, "application/octet-stream")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    raw_payload = payload.getvalue()
    calls = {"count": 0}

    async def stream_source(_db_image, _access):
        calls["count"] += 1
        yield raw_payload

    from routers import images as images_router

    render_calls = {"count": 0}
    handle_calls = {"count": 0}
    original_render = image_volume_rendering_service.normalize_array_slice_to_png
    original_get_handle = image_volume_serving.get_npy_volume_handle

    def counted_render(array):
        render_calls["count"] += 1
        return original_render(array)

    async def counted_get_handle(*args, **kwargs):
        handle_calls["count"] += 1
        return await original_get_handle(*args, **kwargs)

    monkeypatch.setattr(
        images_router.settings, "VOLUME_CACHE_DIR", str(tmp_path / "volume-cache")
    )
    monkeypatch.setattr("services.images.volume_sources.iter_authorized_npy_bytes", stream_source)
    monkeypatch.setattr(
        image_volume_service, "normalize_array_slice_to_png", counted_render
    )
    monkeypatch.setattr(image_volume_serving, "get_npy_volume_handle", counted_get_handle)

    first = client.get(f"/api/images/{image_id}/volume-slice?axis=coronal&index=1")
    second = client.get(f"/api/images/{image_id}/volume-slice?axis=coronal&index=1")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.content == second.content
    assert calls["count"] == 1
    assert handle_calls["count"] == 1
    assert render_calls["count"] == 1


@pytest.mark.parametrize(
    "array,expected",
    [
        (
            np.array([[[0, 32768, 65535, 32768]]], dtype=np.uint16),
            (0, 128, 255, 128),
        ),
        (
            np.array([[[0.2, 0.4, 0.6, 0.25]]], dtype=np.float32),
            (51, 102, 153, 64),
        ),
        (
            np.array([[[10.0, 30.0, 50.0, 0.5]]], dtype=np.float32),
            (0, 127, 255, 128),
        ),
    ],
)
def test_non_uint8_rgba_slice_normalizes_rgb_and_alpha_independently(array, expected):
    png = image_volume_rendering_service.normalize_array_slice_to_png(array)

    with Image.open(io.BytesIO(png)) as image:
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0)) == expected


@pytest.mark.parametrize("dtype", [np.uint8, np.int16, np.float32, np.bool_])
def test_binary_rgba_segment_channels_render_as_visible_palette(dtype):
    values = np.array(
        [
            [
                [0, 0, 0, 0],
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [0, 0, 0, 1],
                [1, 0, 1, 0],
            ]
        ],
        dtype=dtype,
    )

    png = image_volume_rendering_service.normalize_array_slice_to_png(values)

    with Image.open(io.BytesIO(png)) as image:
        assert image.mode == "RGBA"
        assert list(image.getdata()) == [
            (0, 0, 0, 0),
            (239, 68, 68, 224),
            (34, 197, 94, 224),
            (59, 130, 246, 224),
            (245, 158, 11, 224),
            (149, 99, 157, 224),
        ]


def test_binary_rgba_segment_rendering_bounds_temporary_work_to_pixel_chunks(
    monkeypatch,
):
    height = 513
    width = 19
    pixel_limit = 11
    backing = np.zeros((height, width * 2, 4), dtype=np.float32)
    values = backing[:, ::2, :]
    assert not values.flags.c_contiguous

    row_indices, column_indices = np.indices((height, width))
    channels = (row_indices + column_indices) % 4
    active = (row_indices * 3 + column_indices) % 5 != 0
    for channel_index in range(4):
        values[..., channel_index] = active & (channels == channel_index)

    observed_chunk_pixels = []
    original_iter_chunks = image_volume_rendering_service.iter_rgba_pixel_chunks

    def tracked_iter_chunks(array, max_chunk_pixels=None):
        for rows, columns, chunk in original_iter_chunks(array, max_chunk_pixels):
            observed_chunk_pixels.append(int(chunk.shape[0] * chunk.shape[1]))
            yield rows, columns, chunk

    monkeypatch.setattr(
        image_volume_rendering_service,
        "RGBA_SEGMENT_SLICE_MAX_CHUNK_PIXELS",
        pixel_limit,
    )
    monkeypatch.setattr(
        image_volume_rendering_service, "iter_rgba_pixel_chunks", tracked_iter_chunks
    )

    png = image_volume_rendering_service.normalize_array_slice_to_png(values)

    expected = np.zeros((height, width, 4), dtype=np.uint8)
    for channel_index, color in enumerate(image_volume_rendering_service.SEGMENT_CHANNEL_PALETTE):
        channel_active = active & (channels == channel_index)
        expected[channel_active, :3] = color.astype(np.uint8)
        expected[channel_active, 3] = image_volume_rendering_service.SEGMENT_CHANNEL_ALPHA

    with Image.open(io.BytesIO(png)) as image:
        rendered = np.asarray(image)

    np.testing.assert_array_equal(rendered, expected)
    assert len(observed_chunk_pixels) > 2
    assert max(observed_chunk_pixels) <= pixel_limit


def test_clearly_one_hot_255_rgba_segment_channels_render_visibly():
    values = np.array(
        [[[255, 0, 0, 0], [0, 0, 0, 255], [0, 0, 0, 0]]],
        dtype=np.uint8,
    )

    png = image_volume_rendering_service.normalize_array_slice_to_png(values)

    with Image.open(io.BytesIO(png)) as image:
        assert list(image.getdata()) == [
            (239, 68, 68, 224),
            (245, 158, 11, 224),
            (0, 0, 0, 0),
        ]


def test_single_active_one_hot_255_rgba_channel_renders_as_segment():
    values = np.array(
        [[[0, 0, 0, 0], [0, 0, 255, 0], [0, 0, 255, 0]]],
        dtype=np.uint8,
    )

    png = image_volume_rendering_service.normalize_array_slice_to_png(values)

    with Image.open(io.BytesIO(png)) as image:
        assert list(image.getdata()) == [
            (0, 0, 0, 0),
            (59, 130, 246, 224),
            (59, 130, 246, 224),
        ]


def test_non_one_hot_literal_rgba_is_not_recolored_as_segments():
    values = np.array(
        [[[255, 0, 0, 255], [0, 255, 0, 255]]],
        dtype=np.uint8,
    )

    png = image_volume_rendering_service.normalize_array_slice_to_png(values)

    with Image.open(io.BytesIO(png)) as image:
        assert list(image.getdata()) == [(255, 0, 0, 255), (0, 255, 0, 255)]


def test_non_binary_literal_rgba_is_not_recolored_as_segments():
    values = np.array(
        [[[12, 34, 56, 78], [90, 120, 140, 160]]],
        dtype=np.uint8,
    )

    png = image_volume_rendering_service.normalize_array_slice_to_png(values)

    with Image.open(io.BytesIO(png)) as image:
        assert list(image.getdata()) == [(12, 34, 56, 78), (90, 120, 140, 160)]


def test_all_zero_non_uint8_rgba_segment_slice_stays_transparent():
    png = image_volume_rendering_service.normalize_array_slice_to_png(
        np.zeros((2, 3, 4), dtype=np.int64),
    )

    with Image.open(io.BytesIO(png)) as image:
        assert image.mode == "RGBA"
        assert image.getbbox() is None


def test_simultaneous_slice_renders_coalesce_per_key_without_blocking_other_keys(
    monkeypatch,
):
    blocked_started = threading.Event()
    blocked_release = threading.Event()
    render_values = []

    def controlled_render(array):
        value = int(np.asarray(array).flat[0])
        render_values.append(value)
        if value == 1:
            blocked_started.set()
            assert blocked_release.wait(2)
        return f"png-{value}".encode()

    monkeypatch.setattr(
        image_volume_service, "normalize_array_slice_to_png", controlled_render
    )
    unique = str(uuid.uuid4())
    blocked_key = (unique, "axial", 0, "same-version")
    unrelated_key = (unique, "axial", 1, "same-version")

    async def exercise():
        first = asyncio.create_task(
            image_volume_service.get_or_render_volume_slice_png(
                blocked_key, np.array([[1]])
            )
        )
        assert await asyncio.to_thread(blocked_started.wait, 2)
        duplicate = asyncio.create_task(
            image_volume_service.get_or_render_volume_slice_png(
                blocked_key, np.array([[1]])
            )
        )
        unrelated = await asyncio.wait_for(
            image_volume_service.get_or_render_volume_slice_png(
                unrelated_key, np.array([[2]])
            ),
            timeout=1,
        )
        assert unrelated == b"png-2"
        assert render_values.count(1) == 1
        blocked_release.set()
        return await asyncio.gather(first, duplicate)

    first_png, duplicate_png = asyncio.run(exercise())

    assert first_png == duplicate_png == b"png-1"
    assert render_values == [1, 2]


def test_float_volume_slice_ignores_nan_and_infinity_for_visible_pixels():
    scaled = image_volume_rendering_service.scale_array_to_uint8(
        np.array([[np.nan, -np.inf, 5.0], [5.0, np.inf, 9.0]], dtype=np.float32)
    )

    assert scaled.dtype == np.uint8
    assert scaled[0, 0] == 0
    assert scaled[0, 1] == 0
    assert scaled[1, 1] == 0
    assert scaled[0, 2] == 0
    assert scaled[1, 2] == 255
