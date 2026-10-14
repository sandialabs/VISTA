"""Production-shaped database contracts that SQLite cannot validate."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from core import database as core_database
from core import models
from core.config import settings
from services import image_deletion as image_deletion_service

pytestmark = [pytest.mark.postgres]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_alembic_head_contains_current_inspection_part_schema(
    postgres_engine,
):
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)
    expected_heads = set(script.get_heads())
    head_ancestry = {
        revision.revision
        for revision in script.iterate_revisions(
            tuple(expected_heads),
            "base",
        )
    }

    async with postgres_engine.connect() as connection:
        database_heads = set(
            (
                await connection.execute(
                    text("SELECT version_num FROM alembic_version")
                )
            ).scalars()
        )
        schema = await connection.run_sync(
            lambda sync_connection: {
                "tables": set(inspect(sync_connection).get_table_names()),
                "part_columns": {
                    column["name"]: column
                    for column in inspect(sync_connection).get_columns(
                        "inspection_parts"
                    )
                },
                "metadata_columns": {
                    column["name"]: column
                    for column in inspect(sync_connection).get_columns(
                        "inspection_part_metadata_fields"
                    )
                },
                "metadata_indexes": {
                    index["name"]
                    for index in inspect(sync_connection).get_indexes(
                        "inspection_part_metadata_fields"
                    )
                },
                "metadata_uniques": {
                    constraint["name"]
                    for constraint in inspect(sync_connection).get_unique_constraints(
                        "inspection_part_metadata_fields"
                    )
                },
                "metadata_checks": {
                    constraint["name"]
                    for constraint in inspect(sync_connection).get_check_constraints(
                        "inspection_part_metadata_fields"
                    )
                },
                "metadata_foreign_keys": inspect(sync_connection).get_foreign_keys(
                    "inspection_part_metadata_fields"
                ),
            }
        )

    assert database_heads == expected_heads
    assert "20260723_0009" in head_ancestry
    assert {
        "id",
        "project_id",
        "batch_id",
        "serial_number",
        "display_name",
        "metadata",
        "review_state",
        "created_at",
        "updated_at",
    } <= set(schema["part_columns"])
    assert "inspection_part_metadata_fields" in schema["tables"]
    assert {
        "id",
        "project_id",
        "part_id",
        "source_ref",
        "source_filename",
        "field_path",
        "field_path_hash",
        "field_name",
        "ordinal",
        "value_type",
        "value_json",
        "value_text",
        "value_text_hash",
        "value_number",
        "value_boolean",
        "created_at",
    } == set(schema["metadata_columns"])
    assert schema["metadata_columns"]["created_at"]["type"].timezone is True
    assert {
        "ix_inspection_part_metadata_fields_project_path_text",
        "ix_inspection_part_metadata_fields_project_path_number",
        "ix_inspection_part_metadata_fields_project_path_boolean",
        "ix_inspection_part_metadata_fields_part_source",
    } <= schema["metadata_indexes"]
    assert (
        "uix_inspection_part_metadata_fields_part_source_path_hash"
        in schema["metadata_uniques"]
    )
    assert "ck_inspection_part_metadata_fields_value_type" in schema["metadata_checks"]
    assert {
        (
            tuple(foreign_key["constrained_columns"]),
            foreign_key["referred_table"],
            foreign_key["options"].get("ondelete"),
        )
        for foreign_key in schema["metadata_foreign_keys"]
    } == {
        (("part_id",), "inspection_parts", "CASCADE"),
        (("project_id",), "projects", "CASCADE"),
    }


@pytest.mark.asyncio
async def test_direct_session_consumers_share_the_postgres_lane_binding(
    postgres_engine,
    postgres_test_urls,
):
    assert core_database.engine is postgres_engine
    assert core_database.AsyncSessionLocal.kw["bind"] is postgres_engine
    assert postgres_test_urls.async_url == settings.DATABASE_URL

    async with core_database.AsyncSessionLocal() as session:
        database_name = await session.scalar(text("SELECT current_database()"))

    normalized_database_name = database_name.lower()
    assert normalized_database_name.startswith("test_") or (
        normalized_database_name.endswith("_test")
    )


@pytest.mark.asyncio
async def test_postgres_applies_server_defaults_and_timezone_aware_timestamps(
    postgres_engine,
):
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    part_id = uuid.uuid4()
    field_id = uuid.uuid4()
    before = datetime.now(UTC)

    async with postgres_engine.begin() as connection:
        await connection.execute(text("SET LOCAL TIME ZONE 'America/Denver'"))
        user_row = (
            await connection.execute(
                text(
                    """
                    INSERT INTO users (id, email)
                    VALUES (:id, :email)
                    RETURNING is_active, created_at
                    """
                ),
                {"id": user_id, "email": "defaults@example.com"},
            )
        ).one()
        project_row = (
            await connection.execute(
                text(
                    """
                    INSERT INTO projects (id, name, meta_group_id)
                    VALUES (:id, :name, :meta_group_id)
                    RETURNING project_type, is_archived, created_at
                    """
                ),
                {
                    "id": project_id,
                    "name": "PostgreSQL defaults",
                    "meta_group_id": "data-scientists",
                },
            )
        ).one()
        batch_row = (
            await connection.execute(
                text(
                    """
                    INSERT INTO inspection_batches (id, project_id, name)
                    VALUES (:id, :project_id, :name)
                    RETURNING status, created_at
                    """
                ),
                {
                    "id": batch_id,
                    "project_id": project_id,
                    "name": "Default batch",
                },
            )
        ).one()
        part_row = (
            await connection.execute(
                text(
                    """
                    INSERT INTO inspection_parts
                        (id, project_id, batch_id, serial_number)
                    VALUES (:id, :project_id, :batch_id, :serial_number)
                    RETURNING review_state, created_at
                    """
                ),
                {
                    "id": part_id,
                    "project_id": project_id,
                    "batch_id": batch_id,
                    "serial_number": "PG-DEFAULT-001",
                },
            )
        ).one()
        field_created_at = (
            await connection.execute(
                text(
                    """
                    INSERT INTO inspection_part_metadata_fields (
                        id, project_id, part_id, source_ref, field_path,
                        field_path_hash, field_name, ordinal, value_type
                    )
                    VALUES (
                        :id, :project_id, :part_id, :source_ref, :field_path,
                        :field_path_hash, :field_name, :ordinal, :value_type
                    )
                    RETURNING created_at
                    """
                ),
                {
                    "id": field_id,
                    "project_id": project_id,
                    "part_id": part_id,
                    "source_ref": "defaults-source",
                    "field_path": "$.defaults",
                    "field_path_hash": "a" * 64,
                    "field_name": "defaults",
                    "ordinal": 0,
                    "value_type": "null",
                },
            )
        ).scalar_one()
        configured_timezone = (
            await connection.execute(text("SHOW TIME ZONE"))
        ).scalar_one()

    after = datetime.now(UTC)
    timestamps = [
        user_row.created_at,
        project_row.created_at,
        batch_row.created_at,
        part_row.created_at,
        field_created_at,
    ]
    assert configured_timezone == "America/Denver"
    assert user_row.is_active is True
    assert project_row.project_type == "PT1"
    assert project_row.is_archived is False
    assert batch_row.status == "not_started"
    assert part_row.review_state == "unreviewed"
    assert all(timestamp.tzinfo is not None for timestamp in timestamps)
    assert all(before <= timestamp.astimezone(UTC) <= after for timestamp in timestamps)


@pytest.mark.asyncio
async def test_concurrent_unique_insert_rolls_back_loser_session_cleanly(
    postgres_session_factory,
):
    email = "postgres-race@example.com"

    async def create_once():
        async with postgres_session_factory() as session:
            session.add(models.User(email=email))
            try:
                await session.commit()
                return "committed"
            except IntegrityError:
                await session.rollback()
                assert await session.scalar(select(func.count(models.User.id))) == 1
                return "conflict"

    outcomes = await asyncio.gather(create_once(), create_once())

    assert sorted(outcomes) == ["committed", "conflict"]
    async with postgres_session_factory() as verification_session:
        assert (
            await verification_session.scalar(
                select(func.count(models.User.id)).where(models.User.email == email)
            )
            == 1
        )


@pytest.mark.asyncio
async def test_production_proxy_auth_requires_secret_and_persists_user(
    postgres_client,
    postgres_session_factory,
    production_proxy_headers,
):
    assert settings.DEBUG is False
    assert settings.SKIP_HEADER_CHECK is False
    assert settings.PROXY_SHARED_SECRET

    missing_secret = postgres_client.get(
        "/api/users/me",
        headers={"X-User-Email": production_proxy_headers["X-User-Email"]},
    )
    wrong_secret = postgres_client.get(
        "/api/users/me",
        headers={
            **production_proxy_headers,
            "X-Proxy-Secret": "incorrect-secret",
        },
    )
    accepted = postgres_client.get(
        "/api/users/me",
        headers=production_proxy_headers,
    )

    assert missing_secret.status_code == 401
    assert wrong_secret.status_code == 401
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["email"] == production_proxy_headers["X-User-Email"]
    async with postgres_session_factory() as session:
        user = await session.scalar(
            select(models.User).where(
                models.User.email == production_proxy_headers["X-User-Email"]
            )
        )
        assert user is not None
        assert user.created_at.tzinfo is not None


@pytest.mark.asyncio
async def test_soft_delete_restore_and_audit_use_postgres_timestamp_contracts(
    postgres_client,
    postgres_session_factory,
    production_proxy_headers,
):
    async with postgres_session_factory() as session:
        user = models.User(email=production_proxy_headers["X-User-Email"])
        project = models.Project(
            name="PostgreSQL deletion lifecycle",
            meta_group_id="data-scientists",
            created_by=user.email,
        )
        session.add_all([user, project])
        await session.flush()
        image = models.DataInstance(
            project_id=project.id,
            filename="postgres-delete.png",
            object_storage_key=f"postgres-tests/{uuid.uuid4()}.png",
            content_type="image/png",
            size_bytes=128,
            metadata_json={},
            uploaded_by_user_id=user.email,
            uploader_id=user.id,
        )
        session.add(image)
        await session.commit()
        project_id = project.id
        image_id = image.id

    deleted = postgres_client.request(
        "DELETE",
        f"/api/projects/{project_id}/images/{image_id}",
        json={"reason": "PostgreSQL retention verification"},
        headers=production_proxy_headers,
    )
    assert deleted.status_code == 200, deleted.text
    deleted_payload = deleted.json()
    deleted_at = datetime.fromisoformat(deleted_payload["deleted_at"])
    retention_deadline = datetime.fromisoformat(
        deleted_payload["pending_hard_delete_at"]
    )
    assert deleted_at.tzinfo is not None
    assert retention_deadline.tzinfo is not None
    assert retention_deadline > deleted_at
    assert deleted_payload["storage_deleted"] is False

    restored = postgres_client.post(
        f"/api/projects/{project_id}/images/{image_id}/restore",
        headers=production_proxy_headers,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["deleted_at"] is None
    assert restored.json()["pending_hard_delete_at"] is None
    assert restored.json()["storage_deleted"] is False

    audit = postgres_client.get(
        f"/api/projects/{project_id}/images/deletion-events",
        params={"image_id": str(image_id)},
        headers=production_proxy_headers,
    )
    assert audit.status_code == 200, audit.text
    assert audit.json()["total"] == 2
    assert [event["action"] for event in audit.json()["events"]] == [
        "restore",
        "soft_delete",
    ]
    assert all(
        datetime.fromisoformat(event["at"]).tzinfo is not None
        for event in audit.json()["events"]
    )

    async with postgres_session_factory() as session:
        persisted_image = await session.get(models.DataInstance, image_id)
        events = (
            (
                await session.execute(
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
        assert persisted_image.deleted_at is None
        assert persisted_image.pending_hard_delete_at is None
        assert persisted_image.storage_deleted is False
        assert [event.action for event in events] == [
            "soft_delete",
            "restore",
        ]
        assert all(event.at.tzinfo is not None for event in events)


@pytest.mark.asyncio
async def test_concurrent_soft_deletes_lock_image_and_emit_one_audit_event(
    postgres_session_factory,
):
    async with postgres_session_factory() as session:
        user = models.User(email="concurrent-delete@example.com")
        project = models.Project(
            name="Concurrent PostgreSQL deletion",
            meta_group_id="concurrent-delete-group",
            created_by=user.email,
        )
        session.add_all([user, project])
        await session.flush()
        image = models.DataInstance(
            project_id=project.id,
            filename="concurrent-delete.png",
            object_storage_key=f"postgres-tests/{uuid.uuid4()}.png",
            content_type="image/png",
            size_bytes=128,
            metadata_json={},
            uploaded_by_user_id=user.email,
            uploader_id=user.id,
            storage_deleted=False,
        )
        session.add(image)
        await session.commit()
        project_id = project.id
        image_id = image.id
        user_id = user.id
        user_email = user.email

    async def unused_storage_delete(_bucket, _key):
        raise AssertionError("soft deletion must not touch object storage")

    async def delete_once():
        async with postgres_session_factory() as session:
            return await image_deletion_service.delete_authorized_image(
                db=session,
                project_id=project_id,
                image_id=image_id,
                actor_user_id=user_id,
                actor_email=user_email,
                reason="concurrent PostgreSQL soft delete",
                retention_days=60,
                force=False,
                storage_bucket="unused",
                delete_storage=unused_storage_delete,
            )

    outcomes = await asyncio.gather(delete_once(), delete_once())
    assert sum(outcome.soft_deleted_now for outcome in outcomes) == 1

    async with postgres_session_factory() as session:
        persisted_image = await session.get(models.DataInstance, image_id)
        events = (
            (
                await session.execute(
                    select(models.ImageDeletionEvent).where(
                        models.ImageDeletionEvent.image_id == image_id
                    )
                )
            )
            .scalars()
            .all()
        )

    assert persisted_image.deleted_at is not None
    assert persisted_image.storage_deleted is False
    assert [event.action for event in events] == ["soft_delete"]


@pytest.mark.asyncio
async def test_concurrent_deletes_remove_metadata_shared_only_by_deleted_images(
    postgres_session_factory,
    monkeypatch,
):
    metadata_key = "associated:concurrent-shared.nsipro"
    async with postgres_session_factory() as session:
        user = models.User(email="concurrent-shared-metadata@example.com")
        project = models.Project(
            name="Concurrent shared metadata deletion",
            meta_group_id="concurrent-shared-metadata-group",
            created_by=user.email,
        )
        session.add_all([user, project])
        await session.flush()
        project_metadata = models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={"source_filename": "concurrent-shared.nsipro"},
        )
        images = [
            models.DataInstance(
                project_id=project.id,
                filename=f"concurrent-shared-{index}.png",
                object_storage_key=f"postgres-tests/{uuid.uuid4()}.png",
                content_type="image/png",
                size_bytes=128,
                metadata_json={"associated_metadata_ref": metadata_key},
                uploaded_by_user_id=user.email,
                uploader_id=user.id,
                storage_deleted=False,
            )
            for index in range(2)
        ]
        session.add_all([project_metadata, *images])
        await session.commit()
        project_id = project.id
        metadata_id = project_metadata.id
        image_ids = [image.id for image in images]
        user_id = user.id
        user_email = user.email

    original_get_locked_image = image_deletion_service._get_locked_image
    both_images_locked = asyncio.Event()
    lock_count_guard = asyncio.Lock()
    locked_count = 0

    async def synchronize_after_distinct_image_locks(**kwargs):
        nonlocal locked_count
        image = await original_get_locked_image(**kwargs)
        async with lock_count_guard:
            locked_count += 1
            if locked_count == 2:
                both_images_locked.set()
        await asyncio.wait_for(both_images_locked.wait(), timeout=5)
        return image

    monkeypatch.setattr(
        image_deletion_service,
        "_get_locked_image",
        synchronize_after_distinct_image_locks,
    )

    async def unused_storage_delete(_bucket, _key):
        raise AssertionError("soft deletion must not touch object storage")

    async def delete_once(image_id):
        async with postgres_session_factory() as session:
            return await image_deletion_service.delete_authorized_image(
                db=session,
                project_id=project_id,
                image_id=image_id,
                actor_user_id=user_id,
                actor_email=user_email,
                reason="concurrent shared metadata cleanup",
                retention_days=60,
                force=False,
                storage_bucket="unused",
                delete_storage=unused_storage_delete,
            )

    outcomes = await asyncio.gather(*(delete_once(image_id) for image_id in image_ids))
    assert all(outcome.soft_deleted_now for outcome in outcomes)

    async with postgres_session_factory() as session:
        persisted_images = (
            (
                await session.execute(
                    select(models.DataInstance).where(
                        models.DataInstance.id.in_(image_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        persisted_metadata = await session.get(
            models.ProjectMetadata,
            metadata_id,
        )

    assert all(image.deleted_at is not None for image in persisted_images)
    assert persisted_metadata is None
