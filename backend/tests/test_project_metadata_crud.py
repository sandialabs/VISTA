import pytest
import uuid
import utils.crud as crud
from core import schemas


@pytest.mark.asyncio
async def test_create_update_delete_project_metadata(db_session):
    # Create project first
    proj = await crud.create_project(
        db_session,
        schemas.ProjectCreate(name="MetaP", description=None, meta_group_id="gmeta"),
        created_by="t@example.com",
    )

    # Create metadata
    md = await crud.create_or_update_project_metadata(
        db_session,
        schemas.ProjectMetadataCreate(project_id=proj.id, key="k", value="v1"),
        created_by="t@example.com",
    )
    assert md.key == "k"
    assert md.value == "v1"

    # Update same key
    md2 = await crud.create_or_update_project_metadata(
        db_session,
        schemas.ProjectMetadataCreate(project_id=proj.id, key="k", value="v2"),
        created_by="t@example.com",
    )
    assert md2.value == "v2"

    # Get all
    all_md = await crud.get_all_project_metadata(db_session, proj.id)
    assert len(all_md) == 1

    # Delete by key
    ok = await crud.delete_project_metadata_by_key(db_session, proj.id, "k", deleted_by="t@example.com")
    assert ok is True
