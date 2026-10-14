"""Cached image reads must reflect every mutation that changes their data.

``GET /api/projects/{id}/images`` and ``GET /api/images/{id}`` are cached per
user through ``utils.cache_manager``. Each test warms both caches, performs one
mutation through the API, and asserts the next read shows the change.
"""

import io

import pytest
from PIL import Image

import utils.cache_manager as cache_manager


@pytest.fixture(autouse=True)
def fresh_cache():
    cache_manager._cache_manager = None
    cache_manager.get_cache().clear()
    yield
    cache_manager.get_cache().clear()
    cache_manager._cache_manager = None


def _png():
    buffer = io.BytesIO()
    Image.new("RGB", (6, 6), color=(4, 5, 6)).save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def _project_with_images(client, count=2):
    resp = client.post(
        "/api/projects/",
        json={"name": "Cache Invalidation", "meta_group_id": "data-scientists"},
    )
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["id"]
    image_ids = []
    for index in range(count):
        upload = client.post(
            f"/api/projects/{project_id}/images",
            files={"file": (f"img{index}.png", _png(), "image/png")},
        )
        assert upload.status_code == 201, upload.text
        image_ids.append(upload.json()["id"])
    return project_id, image_ids


def _create_group(client, project_id, identifier="SN-CACHE"):
    resp = client.post(
        f"/api/projects/{project_id}/groups", json={"identifier": identifier}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _warm(client, project_id, image_id):
    listed = client.get(f"/api/projects/{project_id}/images")
    single = client.get(f"/api/images/{image_id}")
    assert listed.status_code == 200 and single.status_code == 200
    return listed.json(), single.json()


def _group_ids(listed):
    return {item["id"]: item["group_id"] for item in listed}


def test_key_builders_match_cached_response_keys():
    assert cache_manager.image_metadata_key("i", "u@x") == "image:i:user:u@x:metadata"
    assert cache_manager.thumbnail_key("i", 3, 4) == "thumbnail:i:w:3:h:4"
    assert cache_manager.project_images_key(
        "p",
        "u@x",
        skip=0,
        limit=100,
        include_deleted=False,
        deleted_only=False,
        search_field=None,
        search_value=None,
        group_id=None,
        ungrouped=False,
    ) == (
        "project_images:p:user:u@x:skip:0:limit:100:include_deleted:False"
        ":deleted_only:False:search_field:None:search_value:None"
        ":group_id:None:ungrouped:False"
    )


def test_group_assignment_refreshes_list_and_image(client):
    project_id, (image_id, _) = _project_with_images(client)
    group_id = _create_group(client, project_id)
    _warm(client, project_id, image_id)

    assert (
        client.post(f"/api/groups/{group_id}/images", json=[image_id]).status_code
        == 200
    )

    listed, single = _warm(client, project_id, image_id)
    assert _group_ids(listed)[image_id] == group_id
    assert single["group_id"] == group_id


def test_group_removal_refreshes_list_and_image(client):
    project_id, (image_id, _) = _project_with_images(client)
    group_id = _create_group(client, project_id)
    client.post(f"/api/groups/{group_id}/images", json=[image_id])
    _warm(client, project_id, image_id)

    removed = client.request(
        "DELETE", f"/api/groups/{group_id}/images", json=[image_id]
    )
    assert removed.status_code == 200

    listed, single = _warm(client, project_id, image_id)
    assert _group_ids(listed)[image_id] is None
    assert single["group_id"] is None


def test_group_delete_ungroups_cached_images(client):
    project_id, (image_id, _) = _project_with_images(client)
    group_id = _create_group(client, project_id)
    client.post(f"/api/groups/{group_id}/images", json=[image_id])
    _warm(client, project_id, image_id)

    assert client.delete(f"/api/groups/{group_id}").status_code == 204

    listed, single = _warm(client, project_id, image_id)
    assert _group_ids(listed)[image_id] is None
    assert single["group_id"] is None


def test_group_delete_with_images_drops_them_from_cached_reads(client):
    project_id, (image_id, other_id) = _project_with_images(client)
    group_id = _create_group(client, project_id)
    client.post(f"/api/groups/{group_id}/images", json=[image_id])
    _warm(client, project_id, image_id)

    resp = client.delete(f"/api/groups/{group_id}", params={"delete_images": "true"})
    assert resp.status_code == 204

    listed = client.get(f"/api/projects/{project_id}/images").json()
    assert [item["id"] for item in listed] == [other_id]
    assert client.get(f"/api/images/{image_id}").status_code == 404


def test_metadata_update_refreshes_list_and_image(client):
    project_id, (image_id, _) = _project_with_images(client)
    _warm(client, project_id, image_id)

    updated = client.put(
        f"/api/images/{image_id}/metadata", json={"key": "lot", "value": "A1"}
    )
    assert updated.status_code == 200, updated.text

    listed, single = _warm(client, project_id, image_id)
    by_id = {item["id"]: item for item in listed}
    assert by_id[image_id]["metadata"]["lot"] == "A1"
    assert single["metadata"]["lot"] == "A1"


def test_image_delete_and_restore_refresh_cached_reads(client):
    project_id, (image_id, other_id) = _project_with_images(client)
    _warm(client, project_id, image_id)

    deleted = client.request(
        "DELETE",
        f"/api/projects/{project_id}/images/{image_id}",
        json={"reason": "cache test"},
    )
    assert deleted.status_code == 200, deleted.text
    listed = client.get(f"/api/projects/{project_id}/images").json()
    assert [item["id"] for item in listed] == [other_id]

    restored = client.post(f"/api/projects/{project_id}/images/{image_id}/restore")
    assert restored.status_code == 200, restored.text
    listed, single = _warm(client, project_id, image_id)
    assert {item["id"] for item in listed} == {image_id, other_id}
    assert single["deleted_at"] is None


def test_upload_refreshes_cached_list(client):
    project_id, (image_id,) = _project_with_images(client, count=1)
    _warm(client, project_id, image_id)

    upload = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("late.png", _png(), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    new_id = upload.json()["id"]

    listed = client.get(f"/api/projects/{project_id}/images").json()
    assert {item["id"] for item in listed} == {image_id, new_id}
