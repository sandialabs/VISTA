import uuid
import pytest
from pydantic import ValidationError
from core import schemas


def test_user_schema_optional_groups():
    u = schemas.User(email="a@b.com")
    assert u.groups is None


def test_project_schema_validation():
    p = schemas.ProjectCreate(name="N", description=None, meta_group_id="g")
    assert p.meta_group_id == "g"


def test_data_instance_metadata_validator_handles_str_json():
    di = schemas.DataInstance(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        object_storage_key="k",
        filename="f",
        uploaded_by_user_id="u",
        content_type=None,
        size_bytes=None,
        metadata='{"x":1}',
        created_at="2020-01-01T00:00:00Z",
    )
    payload = di.model_dump(by_alias=True)
    assert payload["metadata"] == {"x": 1}


def test_image_classification_uuid_validation():
    with pytest.raises(ValidationError):
        schemas.ImageClassificationCreate(image_id="not-a-uuid", class_id="also-bad")


def test_image_comment_min_length():
    with pytest.raises(ValidationError):
        schemas.ImageCommentCreate(text="", image_id=uuid.uuid4())
