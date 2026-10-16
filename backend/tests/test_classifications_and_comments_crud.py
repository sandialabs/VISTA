import pytest

from repositories import comments as comment_repository
from repositories import image_classes as image_class_repository
from repositories import images as image_repository
from repositories import projects as project_repository
from repositories import users as user_repository
from schemas.comments import ImageCommentCreate
from schemas.image_classes import ImageClassCreate, ImageClassificationCreate
from schemas.images import DataInstanceCreate
from schemas.projects import ProjectCreate
from schemas.users import UserCreate


@pytest.mark.asyncio
async def test_image_classifications_crud(db_session):
    # Project
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(name="IProj", description=None, meta_group_id="g"),
        created_by="u@example.com",
    )
    # Create a user to associate as classifier
    user = await user_repository.create_user(
        db_session,
        UserCreate(email="u@example.com", username=None, is_active=True),
        created_by="system",
    )
    # Image
    di = await image_repository.create_data_instance(
        db_session,
        DataInstanceCreate(
            project_id=proj.id,
            filename="x.png",
            object_storage_key="k",
            uploaded_by_user_id="u@example.com",
            content_type="image/png",
        ),
        created_by="u@example.com",
    )
    # Class
    ic = await image_class_repository.create_image_class(
        db_session,
        ImageClassCreate(name="dog", description=None, project_id=proj.id),
        created_by="u@example.com",
    )
    # Classification
    cl = await image_class_repository.create_image_classification(
        db_session,
        ImageClassificationCreate(image_id=di.id, class_id=ic.id, created_by_id=user.id),
        created_by="u@example.com",
    )
    assert cl.image_id == di.id
    # Delete classification
    ok = await image_class_repository.delete_image_classification(
        db_session, cl.id, deleted_by="u@example.com"
    )
    assert ok is True


@pytest.mark.asyncio
async def test_image_comments_crud(db_session):
    # Project
    proj = await project_repository.create_project(
        db_session,
        ProjectCreate(name="ComProj", description=None, meta_group_id="g"),
        created_by="u@example.com",
    )
    # Create a user to associate as comment author
    user = await user_repository.create_user(
        db_session,
        UserCreate(email="u@example.com", username=None, is_active=True),
        created_by="system",
    )
    # Image
    di = await image_repository.create_data_instance(
        db_session,
        DataInstanceCreate(
            project_id=proj.id,
            filename="x.png",
            object_storage_key="k2",
            uploaded_by_user_id="u@example.com",
            content_type="image/png",
        ),
        created_by="u@example.com",
    )
    # Create comment
    c = await comment_repository.create_comment(
        db_session,
        ImageCommentCreate(text="nice", image_id=di.id, author_id=user.id),
        created_by="u@example.com",
    )
    assert c.text == "nice"
    # Update
    c2 = await comment_repository.update_comment(
        db_session, c.id, {"text": "nicer"}, updated_by="u@example.com"
    )
    assert c2.text == "nicer"
    # Delete
    ok = await comment_repository.delete_comment(
        db_session, c.id, deleted_by="u@example.com"
    )
    assert ok is True
