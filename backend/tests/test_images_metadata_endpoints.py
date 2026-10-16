import io

from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from services.images import metadata as image_metadata_service
from utils import cache_manager


def _img():
    img = Image.new("RGB", (8, 8), (0, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_update_and_delete_metadata(client):
    # Create project and upload image
    pr = client.post(
        "/api/projects/", json={"name": "Px", "description": None, "meta_group_id": "g"}
    )
    pid = pr.json()["id"]
    ur = client.post(
        f"/api/projects/{pid}/images", files={"file": ("c.png", _img(), "image/png")}
    )
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


def test_metadata_mutations_materialize_before_commit_and_ignore_cache_failure(
    client,
    monkeypatch,
):
    project = client.post(
        "/api/projects/",
        json={
            "name": "Metadata commit boundary",
            "description": None,
            "meta_group_id": "g",
        },
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]
    upload = client.post(
        f"/api/projects/{project_id}/images",
        files={"file": ("boundary.png", _img(), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    image_id = upload.json()["id"]

    original_commit = image_metadata_service.commit_database_transaction
    original_refresh = AsyncSession.refresh
    refresh_count = 0

    async def commit_and_expire(session):
        await original_commit(session)
        session.expire_all()
        session.info["metadata_commit_finished"] = True

    async def reject_post_commit_refresh(session, *args, **kwargs):
        nonlocal refresh_count
        if session.info.get("metadata_commit_finished"):
            raise AssertionError("metadata response refreshed after commit")
        refresh_count += 1
        return await original_refresh(session, *args, **kwargs)

    class FailingCache:
        def clear_pattern(self, _pattern):
            raise RuntimeError("cache unavailable")

    monkeypatch.setattr(
        image_metadata_service,
        "commit_database_transaction",
        commit_and_expire,
    )
    monkeypatch.setattr(AsyncSession, "refresh", reject_post_commit_refresh)
    monkeypatch.setattr(cache_manager, "get_cache", lambda: FailingCache())

    updated = client.put(
        f"/api/images/{image_id}/metadata",
        json={"key": "boundary", "value": {"state": "updated"}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["project_id"] == project_id
    assert updated.json()["metadata"]["boundary"] == {"state": "updated"}

    removed = client.delete(f"/api/images/{image_id}/metadata/boundary")
    assert removed.status_code == 200, removed.text
    assert removed.json()["project_id"] == project_id
    assert "boundary" not in removed.json()["metadata"]
    assert refresh_count == 2
