import uuid

import pytest
from pydantic import ValidationError

from schemas.comments import ImageCommentCreate
from schemas.image_classes import ImageClassificationCreate
from schemas.images import DataInstance
from schemas.projects import ProjectCreate
from schemas.users import User


def test_user_schema_optional_groups():
    u = User(email="a@b.com")
    assert u.groups is None


def test_project_schema_validation():
    p = ProjectCreate(name="N", description=None, meta_group_id="g")
    assert p.meta_group_id == "g"
    assert p.project_type == "PT1"

    p2 = ProjectCreate(
        name="N2", description=None, meta_group_id="g", project_type="pt2"
    )
    assert p2.project_type == "PT2"


def test_data_instance_metadata_validator_handles_str_json():
    di = DataInstance(
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
        ImageClassificationCreate(image_id="not-a-uuid", class_id="also-bad")


def test_image_comment_min_length():
    with pytest.raises(ValidationError):
        ImageCommentCreate(text="", image_id=uuid.uuid4())
