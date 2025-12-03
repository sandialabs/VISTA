import pytest
import uuid
import utils.crud as crud
from core import schemas


@pytest.mark.asyncio
async def test_image_class_crud(db_session):
    # Create project
    proj = await crud.create_project(
        db_session,
        schemas.ProjectCreate(name="CProj", description=None, meta_group_id="g"),
        created_by="u@example.com",
    )

    # Create class
    ic = await crud.create_image_class(
        db_session,
        schemas.ImageClassCreate(name="cat", description=None, project_id=proj.id),
        created_by="u@example.com",
    )
    assert ic.name == "cat"

    # Update class
    upd = await crud.update_image_class(db_session, ic.id, {"description": "feline"}, updated_by="u@example.com")
    assert upd.description == "feline"

    # Delete class
    ok = await crud.delete_image_class(db_session, ic.id, deleted_by="u@example.com")
    assert ok is True
