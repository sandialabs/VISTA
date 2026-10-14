import pytest
from sqlalchemy import select

from core import models
from repositories import project_metadata as metadata_repository
from repositories import projects as project_repository
from schemas.project_metadata import ProjectMetadataCreate
from schemas.projects import ProjectCreate


@pytest.mark.asyncio
async def test_create_update_delete_project_metadata(db_session):
    # Create project first
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(name="MetaP", description=None, meta_group_id="gmeta"),
        created_by="t@example.com",
    )

    # Create metadata
    md = await metadata_repository.create_or_update_project_metadata(
        db_session,
        ProjectMetadataCreate(project_id=proj.id, key="k", value="v1"),
        created_by="t@example.com",
    )
    assert md.key == "k"
    assert md.value == "v1"

    # Update same key
    md2 = await metadata_repository.create_or_update_project_metadata(
        db_session,
        ProjectMetadataCreate(project_id=proj.id, key="k", value="v2"),
        created_by="t@example.com",
    )
    assert md2.value == "v2"

    # Get all
    all_md = await metadata_repository.get_all_project_metadata(db_session, proj.id)
    assert len(all_md) == 1

    # Delete by key
    ok = await metadata_repository.delete_project_metadata_by_key(
        db_session, proj.id, "k", deleted_by="t@example.com"
    )
    assert ok is True


@pytest.mark.asyncio
async def test_project_identifier_metadata_uses_reserved_key_without_overwriting_raw_keys(
    db_session,
):
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(name="Identifier metadata", description=None, meta_group_id="gid-meta"),
        created_by="t@example.com",
    )
    await metadata_repository.create_or_update_project_metadata(
        db_session,
        ProjectMetadataCreate(project_id=proj.id, key="part-num", value="user-owned"),
        created_by="t@example.com",
    )

    rows = await metadata_repository.store_project_identifier_metadata(
        db=db_session,
        project_id=proj.id,
        identifiers={"part-num": "PN_123456-78", "lot-num": "LOT_222"},
        created_by="t@example.com",
    )

    assert len(rows) == 1
    assert rows[0].key == metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY
    raw_key = await metadata_repository.get_project_metadata_by_key(
        db_session, proj.id, "part-num"
    )
    assert raw_key.value == "user-owned"
    reserved = await metadata_repository.get_project_metadata_by_key(
        db_session,
        proj.id,
        metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
    )
    assert reserved.value["identifiers"] == {
        "part-num": "PN_123456-78",
        "lot-num": "LOT_222",
    }
    all_rows = await metadata_repository.get_all_project_metadata(db_session, proj.id)
    assert {row.key for row in all_rows} == {
        "part-num",
        metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
    }


@pytest.mark.asyncio
async def test_project_identifier_metadata_is_idempotent_and_records_conflicts(
    db_session,
):
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(
            name="Identifier conflicts", description=None, meta_group_id="gid-conflicts"
        ),
        created_by="t@example.com",
    )

    await metadata_repository.store_project_identifier_metadata(
        db=db_session,
        project_id=proj.id,
        identifiers={"part-num": "PN_123456-78"},
        created_by="t@example.com",
    )
    await metadata_repository.store_project_identifier_metadata(
        db=db_session,
        project_id=proj.id,
        identifiers={"part-num": "PN_123456-78"},
        created_by="t@example.com",
    )
    await metadata_repository.store_project_identifier_metadata(
        db=db_session,
        project_id=proj.id,
        identifiers={"part-num": "PN_999999-99"},
        created_by="t@example.com",
    )

    reserved = await metadata_repository.get_project_metadata_by_key(
        db_session,
        proj.id,
        metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
    )
    assert reserved.value["identifiers"] == {"part-num": "PN_123456-78"}
    assert reserved.value["conflicts"] == {
        "part-num": {
            "kept": "PN_123456-78",
            "incoming": ["PN_999999-99"],
        }
    }


@pytest.mark.asyncio
async def test_project_identifier_metadata_commit_false_can_roll_back(db_session):
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(
            name="Identifier rollback", description=None, meta_group_id="gid-rollback"
        ),
        created_by="t@example.com",
    )
    project_id = proj.id

    with pytest.MonkeyPatch.context() as monkeypatch:

        async def fail_if_commit():
            raise AssertionError("commit=False must not commit")

        monkeypatch.setattr(db_session, "commit", fail_if_commit)
        await metadata_repository.store_project_identifier_metadata(
            db=db_session,
            project_id=project_id,
            identifiers={"part-num": "PN_ROLLBACK"},
            created_by="t@example.com",
            commit=False,
        )

    await db_session.flush()
    staged = (
        await db_session.execute(
            select(models.ProjectMetadata).where(
                models.ProjectMetadata.project_id == project_id,
                models.ProjectMetadata.key
                == metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
            )
        )
    ).scalar_one_or_none()
    assert staged is not None

    await db_session.rollback()

    missing = await metadata_repository.get_project_metadata_by_key(
        db_session,
        project_id,
        metadata_repository.PROJECT_IDENTIFIER_METADATA_KEY,
    )
    assert missing is None
