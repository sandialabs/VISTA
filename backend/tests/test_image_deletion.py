import asyncio
import io
import json
import threading
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import models
from services import image_deletion as image_deletion_service
from tests.conftest import TestingSessionLocal
from utils import cache_manager

# Helper to make png bytes


def _png():
    img = Image.new("RGB", (8, 8), (123, 45, 67))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _create_project(client):
    r = client.post(
        "/api/projects/",
        json={"name": "DelProj", "description": None, "meta_group_id": "g"},
    )
    assert r.status_code == 201
    return r.json()["id"]


def _upload_image(client, project_id, filename="d.png", metadata=None):
    files = {"file": (filename, _png(), "image/png")}
    data = {"metadata": json.dumps(metadata)} if metadata is not None else None
    r = client.post(f"/api/projects/{project_id}/images", files=files, data=data)
    assert r.status_code == 201
    image = r.json()

    async def normalize_sqlite_boolean_default():
        async with TestingSessionLocal() as session:
            await session.execute(
                update(models.DataInstance)
                .where(models.DataInstance.id == uuid.UUID(image["id"]))
                .values(storage_deleted=False)
            )
            await session.commit()

    asyncio.get_event_loop().run_until_complete(normalize_sqlite_boolean_default())
    image["storage_deleted"] = False
    return image


@pytest.mark.smoke
def test_soft_delete_list_and_audit_lifecycle(client):
    pid = _create_project(client)
    img = _upload_image(client, pid)
    image_id = img["id"]

    deleted = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "cleanup test data"},
    )
    assert deleted.status_code == 200, deleted.text
    deleted_body = deleted.json()
    assert deleted_body["deleted_at"] is not None
    assert deleted_body["pending_hard_delete_at"] is not None
    assert deleted_body["storage_deleted"] is False

    active = client.get(f"/api/projects/{pid}/images")
    assert active.status_code == 200
    assert image_id not in {item["id"] for item in active.json()}

    with_deleted = client.get(f"/api/projects/{pid}/images?include_deleted=true")
    assert with_deleted.status_code == 200
    assert image_id in {item["id"] for item in with_deleted.json()}

    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    )
    assert events.status_code == 200
    assert [
        (event["action"], event["reason"]) for event in events.json()["events"]
    ] == [
        ("soft_delete", "cleanup test data"),
    ]


def test_delete_requires_reason_min_length_and_leaves_image_active(client):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="r.png")
    image_id = img["id"]

    rejected = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "x"},
    )
    assert rejected.status_code == 400
    assert "Reason must be at least" in rejected.json()["detail"]

    active = client.get(f"/api/projects/{pid}/images")
    assert active.status_code == 200
    assert image_id in {item["id"] for item in active.json()}


def test_delete_rejects_reason_containing_only_whitespace(client):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="whitespace-reason.png")
    image_id = img["id"]

    rejected = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": " \t \n       "},
    )

    assert rejected.status_code == 400, rejected.text
    assert "Reason must be at least" in rejected.json()["detail"]
    active = client.get(f"/api/projects/{pid}/images")
    assert image_id in {item["id"] for item in active.json()}


def test_delete_normalizes_reason_before_persisting_image_and_audit(client):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="normalized-reason.png")
    image_id = img["id"]

    deleted = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "  remove duplicate scan  \n"},
    )

    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deletion_reason"] == "remove duplicate scan"
    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    )
    assert events.status_code == 200, events.text
    assert [event["reason"] for event in events.json()["events"]] == [
        "remove duplicate scan"
    ]


def test_restore_soft_deleted_image_clears_deletion_state(client):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="rest.png")
    image_id = img["id"]

    deleted = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "restore check"},
    )
    assert deleted.status_code == 200, deleted.text

    restored = client.post(f"/api/projects/{pid}/images/{image_id}/restore")
    assert restored.status_code == 200, restored.text
    restored_body = restored.json()
    assert restored_body["deleted_at"] is None
    assert restored_body["pending_hard_delete_at"] is None
    assert restored_body["storage_deleted"] is False

    active = client.get(f"/api/projects/{pid}/images")
    assert active.status_code == 200
    assert image_id in {item["id"] for item in active.json()}

    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    )
    assert events.status_code == 200
    assert {event["action"] for event in events.json()["events"]} == {
        "soft_delete",
        "restore",
    }


def test_delete_and_restore_materialize_responses_before_expiring_commit(
    client,
    monkeypatch,
):
    pid = _create_project(client)
    metadata_key = "associated:expire-boundary.nsipro"
    metadata_response = client.post(
        f"/api/projects/{pid}/metadata",
        json={
            "key": metadata_key,
            "value": {"source_filename": "expire-boundary.nsipro"},
        },
    )
    assert metadata_response.status_code == 201, metadata_response.text
    image = _upload_image(
        client,
        pid,
        filename="expire-boundary.png",
        metadata={"associated_metadata_ref": metadata_key},
    )
    part_response = client.post(
        f"/api/projects/{pid}/parts",
        json={
            "serial_number": "EXPIRING-DELETE",
            "display_name": "Expiring delete",
        },
    )
    assert part_response.status_code == 201, part_response.text
    assignment = client.post(
        f"/api/projects/{pid}/parts/image-assignments",
        json={
            "filename": image["filename"],
            "to_part_id": part_response.json()["id"],
        },
    )
    assert assignment.status_code == 200, assignment.text

    original_commit = AsyncSession.commit
    commit_count = 0

    async def commit_and_expire(session, *args, **kwargs):
        nonlocal commit_count
        result = await original_commit(session, *args, **kwargs)
        session.expire_all()
        commit_count += 1
        return result

    monkeypatch.setattr(AsyncSession, "commit", commit_and_expire)

    deleted = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image['id']}",
        json={"reason": "exercise expired delete boundary"},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_at"] is not None

    restored = client.post(f"/api/projects/{pid}/images/{image['id']}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["deleted_at"] is None

    # The no-op restore path also commits to release its row lock and must
    # return the snapshot created before that commit expires the ORM row.
    restored_again = client.post(f"/api/projects/{pid}/images/{image['id']}/restore")
    assert restored_again.status_code == 200, restored_again.text
    assert restored_again.json()["deleted_at"] is None
    assert commit_count == 3


def test_force_delete_confirmed_commit_cancellation_preserves_published_state(
    client,
    monkeypatch,
):
    pid = _create_project(client)
    image = _upload_image(client, pid, filename="cancelled-force.png")
    deleted_storage_keys = []
    commit_count = 0
    original_commit = image_deletion_service.commit_database_transaction

    def delete_storage_file(_bucket_name, object_name):
        deleted_storage_keys.append(object_name)
        return True

    async def cancel_after_second_successful_commit(session):
        nonlocal commit_count
        commit_count += 1
        await original_commit(session)
        if commit_count == 2:
            cancelled = asyncio.CancelledError()
            cancelled.vista_commit_succeeded = True
            raise cancelled

    monkeypatch.setattr(
        "routers.images.delete_file_from_s3",
        delete_storage_file,
    )
    monkeypatch.setattr(
        image_deletion_service,
        "commit_database_transaction",
        cancel_after_second_successful_commit,
    )

    with pytest.raises(RuntimeError, match="No response returned"):
        client.request(
            "DELETE",
            f"/api/projects/{pid}/images/{image['id']}",
            json={
                "reason": "publish force state despite cancellation",
                "force": True,
            },
        )

    assert commit_count == 2
    assert deleted_storage_keys == [image["object_storage_key"]]

    persisted = client.get(f"/api/projects/{pid}/images?include_deleted=true")
    assert persisted.status_code == 200, persisted.text
    persisted_image = next(
        item for item in persisted.json() if item["id"] == image["id"]
    )
    assert persisted_image["storage_deleted"] is True
    assert persisted_image["hard_deleted_at"] is not None

    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image["id"]},
    )
    assert events.status_code == 200, events.text
    assert {event["action"] for event in events.json()["events"]} == {
        "soft_delete",
        "force_delete",
    }


@pytest.mark.asyncio
async def test_force_delete_cancellation_waits_for_storage_thread_and_publishes(
    db_session,
):
    user = models.User(email="force-storage-cancel@example.com")
    project = models.Project(
        name="Force storage cancellation",
        meta_group_id="force-storage-cancel-group",
        created_by=user.email,
    )
    db_session.add_all([user, project])
    await db_session.flush()
    image = models.DataInstance(
        id=uuid.uuid4(),
        project_id=project.id,
        filename="force-storage-cancel.png",
        object_storage_key=f"force-storage-cancel/{uuid.uuid4()}.png",
        content_type="image/png",
        size_bytes=8,
        metadata_json={},
        uploaded_by_user_id=user.email,
        uploader_id=user.id,
        storage_deleted=False,
    )
    db_session.add(image)
    await db_session.commit()
    image_id = image.id
    project_id = project.id
    user_id = user.id
    actor_email = user.email

    storage_started = threading.Event()
    release_storage = threading.Event()
    storage_completed = threading.Event()

    def blocking_storage_delete():
        storage_started.set()
        assert release_storage.wait(timeout=2)
        storage_completed.set()
        return True

    async def threaded_storage_delete(_bucket, _key):
        return await asyncio.to_thread(blocking_storage_delete)

    delete_task = asyncio.create_task(
        image_deletion_service.delete_authorized_image(
            db=db_session,
            project_id=project_id,
            image_id=image_id,
            actor_user_id=user_id,
            actor_email=actor_email,
            reason="cancel while object storage is deleting",
            retention_days=60,
            force=True,
            storage_bucket="test-bucket",
            delete_storage=threaded_storage_delete,
        )
    )
    assert await asyncio.to_thread(storage_started.wait, 1)
    delete_task.cancel()
    release_storage.set()

    with pytest.raises(asyncio.CancelledError) as cancelled:
        await delete_task

    assert storage_completed.is_set()
    assert getattr(
        cancelled.value,
        "vista_storage_delete_succeeded",
        False,
    )
    assert getattr(
        cancelled.value,
        "vista_force_delete_published",
        False,
    )

    db_session.expire_all()
    persisted_image = await db_session.get(models.DataInstance, image_id)
    events = (
        (
            await db_session.execute(
                select(models.ImageDeletionEvent)
                .where(models.ImageDeletionEvent.image_id == image_id)
                .order_by(
                    models.ImageDeletionEvent.at.asc(),
                    models.ImageDeletionEvent.id.asc(),
                )
            )
        )
        .scalars()
        .all()
    )

    assert persisted_image.deleted_at is not None
    assert persisted_image.hard_deleted_at is not None
    assert persisted_image.storage_deleted is True
    assert [event.action for event in events] == [
        "soft_delete",
        "force_delete",
    ]


@pytest.mark.asyncio
async def test_shared_commit_helper_finishes_and_marks_cancelled_commit_success():
    commit_started = asyncio.Event()
    release_commit = asyncio.Event()

    class Session:
        committed = False

        async def commit(self):
            commit_started.set()
            await release_commit.wait()
            self.committed = True

    session = Session()
    task = asyncio.create_task(
        image_deletion_service.commit_database_transaction(session)
    )
    await commit_started.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()

    release_commit.set()
    with pytest.raises(asyncio.CancelledError) as cancelled:
        await task

    assert session.committed is True
    assert getattr(cancelled.value, "vista_commit_succeeded", False) is True


def test_repeated_delete_restore_and_force_requests_are_idempotent(
    client,
    monkeypatch,
):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="idempotent-delete.png")
    image_id = img["id"]

    for reason in ("first soft deletion", "duplicate soft deletion"):
        response = client.request(
            "DELETE",
            f"/api/projects/{pid}/images/{image_id}",
            json={"reason": reason},
        )
        assert response.status_code == 200, response.text
        assert response.json()["deletion_reason"] == "first soft deletion"

    for _ in range(2):
        response = client.post(f"/api/projects/{pid}/images/{image_id}/restore")
        assert response.status_code == 200, response.text
        assert response.json()["deleted_at"] is None

    storage_deletes = []

    def delete_storage_file(bucket_name, object_name):
        storage_deletes.append((bucket_name, object_name))
        return True

    monkeypatch.setattr(
        "routers.images.delete_file_from_s3",
        delete_storage_file,
    )
    for _ in range(2):
        response = client.request(
            "DELETE",
            f"/api/projects/{pid}/images/{image_id}",
            json={"reason": "permanent duplicate cleanup", "force": True},
        )
        assert response.status_code == 200, response.text
        assert response.json()["storage_deleted"] is True

    assert storage_deletes == [("test-bucket", img["object_storage_key"])]
    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    )
    assert events.status_code == 200, events.text
    assert sorted(event["action"] for event in events.json()["events"]) == [
        "force_delete",
        "restore",
        "soft_delete",
        "soft_delete",
    ]


def test_deletion_events_use_id_as_deterministic_timestamp_tiebreaker(client):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="audit-order.png")
    image_id = uuid.UUID(img["id"])
    project_id = uuid.UUID(pid)
    tied_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    # Include hexadecimal letters so SQLite's affinity cannot coerce the
    # UUID's compact representation into an integer.
    older_id = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
    newer_id = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")

    async def add_tied_events():
        async with TestingSessionLocal() as session:
            session.add_all(
                [
                    models.ImageDeletionEvent(
                        id=older_id,
                        image_id=image_id,
                        project_id=project_id,
                        action="soft_delete",
                        reason="first tied event",
                        storage_deleted=False,
                        previous_state={},
                        at=tied_at,
                    ),
                    models.ImageDeletionEvent(
                        id=newer_id,
                        image_id=image_id,
                        project_id=project_id,
                        action="restore",
                        reason=None,
                        storage_deleted=False,
                        previous_state={},
                        at=tied_at,
                    ),
                ]
            )
            await session.commit()

    asyncio.get_event_loop().run_until_complete(add_tied_events())

    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": str(image_id)},
    )
    assert events.status_code == 200, events.text
    assert [event["id"] for event in events.json()["events"]] == [
        str(newer_id),
        str(older_id),
    ]


def test_force_delete_is_permanent_and_audited(client, monkeypatch):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="f2.png")
    image_id = img["id"]
    deleted_storage_keys = []

    def delete_storage_file(bucket_name, object_name):
        deleted_storage_keys.append((bucket_name, object_name))
        return True

    monkeypatch.setattr("routers.images.delete_file_from_s3", delete_storage_file)
    deleted = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "force rm2", "force": True},
    )
    assert deleted.status_code == 200, deleted.text
    deleted_body = deleted.json()
    assert deleted_body["storage_deleted"] is True
    assert deleted_body["hard_deleted_at"] is not None
    assert deleted_storage_keys == [("test-bucket", img["object_storage_key"])]

    restore = client.post(f"/api/projects/{pid}/images/{image_id}/restore")
    assert restore.status_code == 409
    assert restore.json()["detail"] == "Image permanently deleted"

    events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    )
    assert events.status_code == 200
    assert {
        (event["action"], event["storage_deleted"]) for event in events.json()["events"]
    } == {
        ("force_delete", True),
        ("soft_delete", False),
    }


def test_soft_delete_image_removes_inspection_part_references(client):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="part-ref.png")
    part_r = client.post(
        f"/api/projects/{pid}/parts",
        json={"serial_number": "SN-IMG-DEL", "display_name": "Image delete part"},
    )
    assert part_r.status_code == 201, part_r.text
    part_id = part_r.json()["id"]
    assign_r = client.post(
        f"/api/projects/{pid}/parts/image-assignments",
        json={"filename": img["filename"], "to_part_id": part_id},
    )
    assert assign_r.status_code == 200, assign_r.text

    del_r = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{img['id']}",
        json={"reason": "unload removes references"},
    )
    assert del_r.status_code == 200, del_r.text

    parts_r = client.get(f"/api/projects/{pid}/parts")
    assert parts_r.status_code == 200
    metadata = parts_r.json()[0]["metadata"]
    assert metadata["source_images"] == []
    assert metadata["view_images"] == {}
    assert metadata["overlay_images"] == {}


def test_reference_cleanup_preserves_different_image_with_duplicate_filename():
    deleted_image_id = uuid.uuid4()
    retained_image_id = uuid.uuid4()

    updated = image_deletion_service._metadata_without_image_reference(
        {
            "source_images": [
                {
                    "image_id": str(deleted_image_id),
                    "filename": "duplicate.png",
                    "side": "front",
                    "modality": "visible",
                    "overlay": False,
                },
                {
                    "image_id": str(retained_image_id),
                    "filename": "duplicate.png",
                    "side": "back",
                    "modality": "visible",
                    "overlay": False,
                },
                {
                    # Legacy references have no stable identity, so filename
                    # remains their only safe deletion key.
                    "filename": "duplicate.png",
                    "side": "top",
                    "modality": "visible",
                    "overlay": False,
                },
            ],
        },
        filename="duplicate.png",
        image_id=deleted_image_id,
    )

    assert updated is not None
    assert updated["source_images"] == [
        {
            "image_id": str(retained_image_id),
            "filename": "duplicate.png",
            "side": "back",
            "modality": "visible",
            "overlay": False,
        }
    ]
    assert updated["configured_views"] == ["back"]
    assert updated["view_images"] == {"back": "duplicate.png"}


def test_soft_delete_image_removes_unreferenced_associated_project_metadata(client):
    pid = _create_project(client)
    metadata_key = "associated:file-one.nsipro"
    meta_r = client.post(
        f"/api/projects/{pid}/metadata",
        json={"key": metadata_key, "value": {"source_filename": "file-one.nsipro"}},
    )
    assert meta_r.status_code == 201, meta_r.text
    img = _upload_image(
        client,
        pid,
        filename="with-associated.png",
        metadata={
            "associated_metadata_ref": metadata_key,
            "associated_metadata": {"project_metadata_key": metadata_key},
        },
    )

    del_r = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{img['id']}",
        json={"reason": "unload associated metadata"},
    )
    assert del_r.status_code == 200, del_r.text

    meta_after = client.get(f"/api/projects/{pid}/metadata/{metadata_key}")
    assert meta_after.status_code == 404


def test_soft_delete_image_keeps_project_metadata_still_used_by_another_image(client):
    pid = _create_project(client)
    metadata_key = "associated:shared.nsipro"
    meta_r = client.post(
        f"/api/projects/{pid}/metadata",
        json={"key": metadata_key, "value": {"source_filename": "shared.nsipro"}},
    )
    assert meta_r.status_code == 201, meta_r.text
    shared_metadata = {"associated_metadata_refs": [metadata_key]}
    first = _upload_image(
        client, pid, filename="shared-one.png", metadata=shared_metadata
    )
    _upload_image(client, pid, filename="shared-two.png", metadata=shared_metadata)

    del_r = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{first['id']}",
        json={"reason": "unload one shared metadata"},
    )
    assert del_r.status_code == 200, del_r.text

    meta_after = client.get(f"/api/projects/{pid}/metadata/{metadata_key}")
    assert meta_after.status_code == 200, meta_after.text


@pytest.mark.asyncio
async def test_sqlite_storage_deleted_server_defaults_are_boolean_false(
    db_session,
):
    user = models.User(email="sqlite-defaults@example.com")
    project = models.Project(
        name="SQLite boolean defaults",
        meta_group_id="sqlite-defaults",
        created_by=user.email,
    )
    db_session.add_all([user, project])
    await db_session.flush()
    image = models.DataInstance(
        id=uuid.uuid4(),
        project_id=project.id,
        filename="sqlite-default.png",
        object_storage_key=f"sqlite-default/{uuid.uuid4()}.png",
        content_type="image/png",
        size_bytes=8,
        metadata_json={},
        uploaded_by_user_id=user.email,
    )
    event = models.ImageDeletionEvent(
        image_id=image.id,
        project_id=project.id,
        action="soft_delete",
        reason="default parity",
        previous_state={},
    )
    db_session.add_all([image, event])
    await db_session.commit()
    await db_session.refresh(image)
    await db_session.refresh(event)

    assert image.storage_deleted is False
    assert event.storage_deleted is False


@pytest.mark.asyncio
async def test_soft_delete_service_commits_database_side_effects_once(
    db_session,
):
    user = models.User(email="single-commit@example.com")
    project = models.Project(
        name="Single commit deletion",
        meta_group_id="single-commit-group",
        created_by=user.email,
    )
    db_session.add_all([user, project])
    await db_session.flush()
    image = models.DataInstance(
        id=uuid.uuid4(),
        project_id=project.id,
        filename="single-commit.png",
        object_storage_key=f"single-commit/{uuid.uuid4()}.png",
        content_type="image/png",
        size_bytes=8,
        metadata_json={},
        uploaded_by_user_id=user.email,
        uploader_id=user.id,
        storage_deleted=False,
    )
    db_session.add(image)
    await db_session.commit()

    async def unused_storage_delete(_bucket, _key):
        raise AssertionError("soft deletion must not touch object storage")

    with patch.object(
        db_session,
        "commit",
        wraps=db_session.commit,
    ) as commit_spy:
        outcome = await image_deletion_service.delete_authorized_image(
            db=db_session,
            project_id=project.id,
            image_id=image.id,
            actor_user_id=user.id,
            actor_email=user.email,
            reason="single atomic transaction",
            retention_days=60,
            force=False,
            storage_bucket="test-bucket",
            delete_storage=unused_storage_delete,
        )

    assert commit_spy.await_count == 1
    assert outcome.soft_deleted_now is True
    assert outcome.storage_deleted_now is False
    events = (
        (
            await db_session.execute(
                select(models.ImageDeletionEvent).where(
                    models.ImageDeletionEvent.image_id == image.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert [event.action for event in events] == ["soft_delete"]


@pytest.mark.asyncio
async def test_soft_delete_service_rolls_back_all_late_side_effects(
    db_session,
    monkeypatch,
):
    metadata_key = "associated:atomic-delete.nsipro"
    user = models.User(email="rollback-delete@example.com")
    project = models.Project(
        name="Rollback deletion",
        meta_group_id="rollback-delete-group",
        created_by=user.email,
    )
    db_session.add_all([user, project])
    await db_session.flush()
    image = models.DataInstance(
        id=uuid.uuid4(),
        project_id=project.id,
        filename="rollback-delete.png",
        object_storage_key=f"rollback-delete/{uuid.uuid4()}.png",
        content_type="image/png",
        size_bytes=8,
        metadata_json={"associated_metadata_ref": metadata_key},
        uploaded_by_user_id=user.email,
        uploader_id=user.id,
        storage_deleted=False,
    )
    project_metadata = models.ProjectMetadata(
        project_id=project.id,
        key=metadata_key,
        value={"source_filename": "atomic-delete.nsipro"},
    )
    part = models.InspectionPart(
        project_id=project.id,
        serial_number="ROLLBACK-PART",
        metadata_json={
            "source_images": [
                {
                    "image_id": str(image.id),
                    "filename": image.filename,
                    "side": "front",
                    "modality": "visible",
                    "overlay": False,
                }
            ],
            "configured_views": ["front"],
            "modalities": ["visible"],
            "view_images": {"front": image.filename},
            "overlay_images": {},
        },
    )
    db_session.add_all([image, project_metadata, part])
    await db_session.commit()
    image_id = image.id
    part_id = part.id
    project_metadata_id = project_metadata.id

    def fail_late_audit_write(**_kwargs):
        raise RuntimeError("forced late deletion failure")

    monkeypatch.setattr(
        image_deletion_service,
        "_add_deletion_event",
        fail_late_audit_write,
    )

    async def unused_storage_delete(_bucket, _key):
        raise AssertionError("failed soft deletion must not touch storage")

    with pytest.raises(RuntimeError, match="forced late deletion failure"):
        await image_deletion_service.delete_authorized_image(
            db=db_session,
            project_id=project.id,
            image_id=image_id,
            actor_user_id=user.id,
            actor_email=user.email,
            reason="must roll back every side effect",
            retention_days=60,
            force=False,
            storage_bucket="test-bucket",
            delete_storage=unused_storage_delete,
        )

    db_session.expire_all()
    persisted_image = await db_session.get(models.DataInstance, image_id)
    persisted_part = await db_session.get(models.InspectionPart, part_id)
    persisted_metadata = await db_session.get(
        models.ProjectMetadata,
        project_metadata_id,
    )
    events = (
        (
            await db_session.execute(
                select(models.ImageDeletionEvent).where(
                    models.ImageDeletionEvent.image_id == image_id
                )
            )
        )
        .scalars()
        .all()
    )

    assert persisted_image.deleted_at is None
    assert persisted_metadata is not None
    assert persisted_part.metadata_json["source_images"][0]["image_id"] == str(image_id)
    assert events == []


@pytest.mark.asyncio
async def test_force_delete_reconciles_after_storage_success_and_db_failure(
    db_session,
):
    user = models.User(email="force-reconcile@example.com")
    project = models.Project(
        name="Force delete reconciliation",
        meta_group_id="force-reconcile-group",
        created_by=user.email,
    )
    db_session.add_all([user, project])
    await db_session.flush()
    image = models.DataInstance(
        id=uuid.uuid4(),
        project_id=project.id,
        filename="force-reconcile.png",
        object_storage_key=f"force-reconcile/{uuid.uuid4()}.png",
        content_type="image/png",
        size_bytes=8,
        metadata_json={},
        uploaded_by_user_id=user.email,
        uploader_id=user.id,
        storage_deleted=False,
    )
    db_session.add(image)
    await db_session.commit()
    image_id = image.id
    project_id = project.id
    user_id = user.id
    actor_email = user.email

    storage_delete_calls = 0

    async def idempotent_storage_delete(_bucket, _key):
        nonlocal storage_delete_calls
        storage_delete_calls += 1
        return True

    real_commit = db_session.commit
    commit_count = 0

    async def fail_force_publication_commit():
        nonlocal commit_count
        commit_count += 1
        if commit_count == 2:
            raise RuntimeError("forced publication commit failure")
        await real_commit()

    with (
        patch.object(
            db_session,
            "commit",
            side_effect=fail_force_publication_commit,
        ),
        pytest.raises(
            RuntimeError,
            match="forced publication commit failure",
        ),
    ):
        await image_deletion_service.delete_authorized_image(
            db=db_session,
            project_id=project_id,
            image_id=image_id,
            actor_user_id=user_id,
            actor_email=actor_email,
            reason="reconcile permanent deletion",
            retention_days=60,
            force=True,
            storage_bucket="test-bucket",
            delete_storage=idempotent_storage_delete,
        )

    db_session.expire_all()
    after_failure = await db_session.get(models.DataInstance, image_id)
    failure_events = (
        (
            await db_session.execute(
                select(models.ImageDeletionEvent).where(
                    models.ImageDeletionEvent.image_id == image_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert after_failure.deleted_at is not None
    assert after_failure.hard_deleted_at is None
    assert after_failure.storage_deleted is False
    assert {event.action for event in failure_events} == {
        "soft_delete",
        image_deletion_service.FORCE_DELETE_PENDING_ACTION,
    }

    with pytest.raises(
        image_deletion_service.ImageStorageDeletionPending,
    ):
        await image_deletion_service.restore_authorized_image(
            db=db_session,
            project_id=project_id,
            image_id=image_id,
            actor_user_id=user_id,
        )

    db_session.expire_all()
    after_rejected_restore = await db_session.get(
        models.DataInstance,
        image_id,
    )
    assert after_rejected_restore.deleted_at is not None
    assert after_rejected_restore.hard_deleted_at is None
    assert after_rejected_restore.storage_deleted is False

    outcome = await image_deletion_service.delete_authorized_image(
        db=db_session,
        project_id=project_id,
        image_id=image_id,
        actor_user_id=user_id,
        actor_email=actor_email,
        reason="reconcile permanent deletion",
        retention_days=60,
        force=True,
        storage_bucket="test-bucket",
        delete_storage=idempotent_storage_delete,
    )
    assert outcome.storage_deleted_now is True
    assert outcome.image.storage_deleted is True
    assert storage_delete_calls == 2

    events = (
        (
            await db_session.execute(
                select(models.ImageDeletionEvent)
                .where(models.ImageDeletionEvent.image_id == image_id)
                .order_by(
                    models.ImageDeletionEvent.at.asc(),
                    models.ImageDeletionEvent.id.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    assert [event.action for event in events] == [
        "soft_delete",
        "force_delete",
    ]


def test_force_delete_storage_failure_is_retryable(client, monkeypatch):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="retry-force.png")
    image_id = img["id"]

    monkeypatch.setattr(
        "routers.images.delete_file_from_s3",
        lambda _bucket, _key: False,
    )
    failed = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "retry failed storage delete", "force": True},
    )
    assert failed.status_code == 502, failed.text
    assert "requires reconciliation" in failed.json()["detail"]

    after_failure = client.get(
        f"/api/projects/{pid}/images",
        params={"include_deleted": True},
    )
    failed_image = next(
        image for image in after_failure.json() if image["id"] == image_id
    )
    assert failed_image["deleted_at"] is not None
    assert failed_image["hard_deleted_at"] is None
    assert failed_image["storage_deleted"] is False

    rejected_restore = client.post(f"/api/projects/{pid}/images/{image_id}/restore")
    assert rejected_restore.status_code == 409, rejected_restore.text
    assert (
        rejected_restore.json()["detail"]
        == "Image storage deletion is pending reconciliation"
    )

    failed_events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    ).json()["events"]
    assert {event["action"] for event in failed_events} == {
        "soft_delete",
        image_deletion_service.FORCE_DELETE_PENDING_ACTION,
    }

    monkeypatch.setattr(
        "routers.images.delete_file_from_s3",
        lambda _bucket, _key: True,
    )
    retried = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{image_id}",
        json={"reason": "retry failed storage delete", "force": True},
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["storage_deleted"] is True

    retried_events = client.get(
        f"/api/projects/{pid}/images/deletion-events",
        params={"image_id": image_id},
    ).json()["events"]
    assert sorted(event["action"] for event in retried_events) == [
        "force_delete",
        "soft_delete",
    ]


def test_delete_cache_failure_does_not_mask_committed_success(
    client,
    monkeypatch,
):
    pid = _create_project(client)
    img = _upload_image(client, pid, filename="cache-failure.png")

    class BrokenCache:
        def clear_pattern(self, _pattern):
            raise RuntimeError("cache unavailable")

    monkeypatch.setattr(cache_manager, "get_cache", lambda: BrokenCache())
    deleted = client.request(
        "DELETE",
        f"/api/projects/{pid}/images/{img['id']}",
        json={"reason": "cache failure remains successful"},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_at"] is not None
