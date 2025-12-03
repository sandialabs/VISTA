import pytest
import uuid
import utils.crud as crud
from core import schemas


@pytest.mark.asyncio
async def test_image_classifications_crud(db_session):
    # Project
    proj = await crud.create_project(
        db_session,
        schemas.ProjectCreate(name="IProj", description=None, meta_group_id="g"),
        created_by="u@example.com",
    )
    # Create a user to associate as classifier
    user = await crud.create_user(
        db_session,
        schemas.UserCreate(email="u@example.com", username=None, is_active=True),
        created_by="system",
    )
    # Image
    di = await crud.create_data_instance(
        db_session,
        schemas.DataInstanceCreate(
            project_id=proj.id,
            filename="x.png",
            object_storage_key="k",
            uploaded_by_user_id="u@example.com",
            content_type="image/png",
        ),
        created_by="u@example.com",
    )
    # Class
    ic = await crud.create_image_class(
        db_session,
        schemas.ImageClassCreate(name="dog", description=None, project_id=proj.id),
        created_by="u@example.com",
    )
    # Classification
    cl = await crud.create_image_classification(
        db_session,
        schemas.ImageClassificationCreate(image_id=di.id, class_id=ic.id, created_by_id=user.id),
        created_by="u@example.com",
    )
    assert cl.image_id == di.id
    # Delete classification
    ok = await crud.delete_image_classification(db_session, cl.id, deleted_by="u@example.com")
    assert ok is True


@pytest.mark.asyncio
async def test_image_comments_crud(db_session):
    # Project
    proj = await crud.create_project(
        db_session,
        schemas.ProjectCreate(name="ComProj", description=None, meta_group_id="g"),
        created_by="u@example.com",
    )
    # Create a user to associate as comment author
    user = await crud.create_user(
        db_session,
        schemas.UserCreate(email="u@example.com", username=None, is_active=True),
        created_by="system",
    )
    # Image
    di = await crud.create_data_instance(
        db_session,
        schemas.DataInstanceCreate(
            project_id=proj.id,
            filename="x.png",
            object_storage_key="k2",
            uploaded_by_user_id="u@example.com",
            content_type="image/png",
        ),
        created_by="u@example.com",
    )
    # Create comment
    c = await crud.create_comment(
        db_session,
        schemas.ImageCommentCreate(text="nice", image_id=di.id, author_id=user.id),
        created_by="u@example.com",
    )
    assert c.text == "nice"
    # Update
    c2 = await crud.update_comment(db_session, c.id, {"text": "nicer"}, updated_by="u@example.com")
    assert c2.text == "nicer"
    # Delete
    ok = await crud.delete_comment(db_session, c.id, deleted_by="u@example.com")
    assert ok is True
