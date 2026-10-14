import pytest

from repositories import image_classes as image_class_repository
from repositories import projects as project_repository
from schemas.image_classes import ImageClassCreate
from schemas.projects import ProjectCreate


@pytest.mark.asyncio
async def test_image_class_crud(db_session):
    # Create project
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(name="CProj", description=None, meta_group_id="g"),
        created_by="u@example.com",
    )

    # Create class
    ic = await image_class_repository.create_image_class(
        db_session,
        ImageClassCreate(name="cat", description=None, project_id=proj.id),
        created_by="u@example.com",
    )
    assert ic.name == "cat"

    # Update class
    upd = await image_class_repository.update_image_class(
        db_session, ic.id, {"description": "feline"}, updated_by="u@example.com"
    )
    assert upd.description == "feline"

    # Delete class
    ok = await image_class_repository.delete_image_class(
        db_session, ic.id, deleted_by="u@example.com"
    )
    assert ok is True
