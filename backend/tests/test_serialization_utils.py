import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from utils.serialization import normalize_metadata_dict, to_data_instance_schema


class FakeImage:
    def __init__(self, metadata_json):
        self.id = uuid.uuid4()
        self.project_id = uuid.uuid4()
        self.group_id = uuid.uuid4()
        self.filename = "f.png"
        self.object_storage_key = "k"
        self.content_type = "image/png"
        self.size_bytes = 10
        self.metadata_json = metadata_json
        self.uploaded_by_user_id = "u1"
        self.uploader_id = None
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = None


def test_normalize_metadata_dict_handles_supported_types():
    assert normalize_metadata_dict(None) == {}
    assert normalize_metadata_dict({"a": 1}) == {"a": 1}
    assert normalize_metadata_dict('{"x": 2}') == {"x": 2}
    assert normalize_metadata_dict("not-json") == {}

    obj = SimpleNamespace(alpha=1, _private=2)
    assert normalize_metadata_dict(obj) == {"alpha": 1}


def test_to_data_instance_schema_parses_string_metadata():
    db_image = FakeImage(json.dumps({"foo": "bar"}))
    schema = to_data_instance_schema(db_image)

    assert schema.id == db_image.id
    assert schema.metadata_ == {"foo": "bar"}


def test_to_data_instance_schema_ignores_invalid_metadata_string():
    db_image = FakeImage("{oops")
    schema = to_data_instance_schema(db_image)
    assert schema.metadata_ == {}
