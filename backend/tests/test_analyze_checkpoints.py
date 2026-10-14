import io
import sys
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from core import models
from services.checkpoints import (
    DEFAULT_ANOMALIB_CHECKPOINT_FILENAME,
    DEFAULT_ANOMALIB_CHECKPOINT_PATH,
    DEFAULT_SAM_CHECKPOINT_FILENAME,
    DEFAULT_SAM_CHECKPOINT_PATH,
    DEFAULT_YOLO_CHECKPOINT_FILENAME,
    DEFAULT_YOLO_CHECKPOINT_PATH,
    checkpoint_diagnostics,
    checkpoint_diagnostics_from_file,
    default_anomalib_checkpoint_object_key,
    default_sam_checkpoint_object_key,
    default_yolo_checkpoint_object_key,
)
from services.model_introspection import inspect_checkpoint_file


def _headers(email="checkpoint-user@example.com", group="checkpoint-group"):
    return {"X-User-Id": email, "X-User-Groups": f'["{group}"]'}


@pytest.fixture
def _default_checkpoint_files():
    """Create stub files at the default checkpoint paths for the test's duration.

    These paths normally hold large pretrained model weights that are never
    committed to the repository (see .gitignore); tests that exercise the
    "default checkpoint is present" path only need the file to exist, not
    real weights.
    """
    paths = [
        DEFAULT_YOLO_CHECKPOINT_PATH,
        DEFAULT_SAM_CHECKPOINT_PATH,
        DEFAULT_ANOMALIB_CHECKPOINT_PATH,
    ]
    created = []
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(b"")
            created.append(path)
    try:
        yield
    finally:
        for path in created:
            path.unlink(missing_ok=True)


def _create_project(client, *, group="checkpoint-group", name="Checkpoint Project"):
    response = client.post(
        "/api/projects/",
        json={
            "name": name,
            "description": "",
            "meta_group_id": group,
            "project_type": "PT3",
        },
        headers=_headers(group=group),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_checkpoint_diagnostics_identifies_sam1_state_dict(monkeypatch):
    class FakeTensor:
        shape = (2, 3)

        def numel(self):
            return 6

    fake_state = {
        "image_encoder.pos_embed": FakeTensor(),
        "prompt_encoder.point_embeddings.0.weight": FakeTensor(),
        "mask_decoder.iou_token.weight": FakeTensor(),
    }
    monkeypatch.setattr(
        "services.checkpoints._load_checkpoint_payload", lambda *_args: fake_state
    )

    diagnostics = checkpoint_diagnostics("sam_vit_b_01ec64.pth", b"checkpoint-bytes")

    assert diagnostics["model_family"] == "sam"
    assert diagnostics["model_type"] == "SAM"
    assert diagnostics["model_version"] == "SAM1"
    assert diagnostics["parameter_count"] == 18


def test_checkpoint_diagnostics_from_file_limits_deep_inspection(monkeypatch):
    def fail_load(*_args):
        raise AssertionError(
            "deep inspection should be skipped for oversized checkpoint"
        )

    monkeypatch.setattr(
        "services.checkpoints.settings.CHECKPOINT_DEEP_INSPECTION_MAX_BYTES", 4
    )
    monkeypatch.setattr("services.checkpoints._load_checkpoint_payload", fail_load)
    stream = io.BytesIO(b"yolo-checkpoint-bytes")

    diagnostics = checkpoint_diagnostics_from_file("yolo11n.pt", stream)

    assert diagnostics["filesize_bytes"] == len(b"yolo-checkpoint-bytes")
    assert diagnostics["model_family"] == "yolo"
    assert diagnostics["warnings"]
    assert stream.tell() == 0


def test_checkpoint_diagnostics_handles_ultralytics_safe_load_failure_without_warning(
    monkeypatch,
):
    class FakeTorch:
        @staticmethod
        def load(*_args, **_kwargs):
            raise RuntimeError(
                "Weights only load failed. WeightsUnpickler error: Unsupported global: "
                "GLOBAL ultralytics.nn.tasks.SegmentationModel"
            )

    monkeypatch.setitem(sys.modules, "torch", FakeTorch)

    diagnostics = checkpoint_diagnostics(
        "yolo11n-seg.pt", b"metadata ultralytics checkpoint bytes"
    )

    assert diagnostics["model_family"] == "yolo"
    assert diagnostics["model_type"] == "YOLO"
    assert not any(
        "Safe PyTorch load failed" in warning for warning in diagnostics["warnings"]
    )
    assert any(
        "skipped full PyTorch object inspection" in signal
        for signal in diagnostics["signals"]
    )


def test_model_introspection_counts_state_dict_and_builds_graph(tmp_path):
    torch = pytest.importorskip("torch")

    checkpoint_path = tmp_path / "linear.pth"
    torch.save(
        {
            "state_dict": {
                "encoder.0.weight": torch.zeros(4, 3),
                "encoder.0.bias": torch.zeros(4),
                "head.weight": torch.zeros(2, 4),
            }
        },
        checkpoint_path,
    )

    details = inspect_checkpoint_file(checkpoint_path, "linear.pth")

    assert details["parameter_count"] == 24
    assert details["parameter_count_kind"] == "state_dict_tensor_elements"
    assert details["graph"]["source"] == "state_dict_hierarchy"
    assert any(node["path"] == "encoder.0" for node in details["graph"]["nodes"])


def test_checkpoint_diagnostics_uses_pytorch_introspection_for_uploaded_file(
    tmp_path, monkeypatch
):
    torch = pytest.importorskip("torch")

    monkeypatch.setattr(
        "services.checkpoints.settings.CHECKPOINT_DEEP_INSPECTION_MAX_BYTES",
        1024 * 1024,
    )
    checkpoint_path = tmp_path / "weights.pth"
    torch.save({"state_dict": {"layer.weight": torch.zeros(5, 2)}}, checkpoint_path)

    with checkpoint_path.open("rb") as stream:
        diagnostics = checkpoint_diagnostics_from_file("weights.pth", stream)

    assert diagnostics["parameter_count"] == 10
    assert diagnostics["parameter_count_kind"] == "state_dict_tensor_elements"
    assert diagnostics["model_graph"]["nodes"]


def test_checkpoint_upload_stores_record_and_tags_s3_object(client):
    project_id = _create_project(client)

    class FakeS3Client:
        def __init__(self):
            self.tags = None

        def put_object_tagging(self, **kwargs):
            self.tags = kwargs["Tagging"]["TagSet"]

    fake_s3 = FakeS3Client()

    async def fake_upload(**kwargs):
        assert kwargs["bucket_name"] == "test-bucket"
        assert kwargs["object_name"].startswith(f"{project_id}/checkpoints/")
        assert kwargs["file_data"].read() == b"fake-yolo"
        return True

    with (
        patch("utils.boto3_client.upload_file_to_s3", fake_upload),
        patch("utils.boto3_client.boto3_client", fake_s3),
    ):
        response = client.post(
            f"/api/projects/{project_id}/analyze/checkpoints",
            files={
                "file": (
                    "yolo11n.pt",
                    io.BytesIO(b"fake-yolo"),
                    "application/octet-stream",
                )
            },
            headers=_headers(),
        )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["model_family"] == "yolo"
    assert payload["object_storage_key"].startswith(f"{project_id}/checkpoints/")
    assert {tag["Key"]: tag["Value"] for tag in fake_s3.tags}["model-family"] == "yolo"


def test_checkpoint_graph_endpoint_returns_introspection_payload(client):
    project_id = _create_project(client)

    async def fake_upload(**_kwargs):
        return True

    graph_payload = {
        "source": "state_dict_hierarchy",
        "nodes": [
            {
                "id": "root",
                "label": "weights.pth",
                "path": "<state_dict>",
                "type": "state_dict",
                "kind": "StateDict",
                "depth": 0,
                "parent": None,
                "parameter_count": 10,
                "direct_parameter_count": 0,
            }
        ],
        "edges": [],
        "truncated": False,
    }

    with patch("utils.boto3_client.upload_file_to_s3", fake_upload):
        create_response = client.post(
            f"/api/projects/{project_id}/analyze/checkpoints",
            files={
                "file": (
                    "weights.pth",
                    io.BytesIO(b"fake-weights"),
                    "application/octet-stream",
                )
            },
            headers=_headers(),
        )
    assert create_response.status_code == 201, create_response.text
    checkpoint_id = create_response.json()["id"]

    async def fake_materialize(*_args, **_kwargs):
        return "/tmp/weights.pth"

    with (
        patch("services.checkpoints.materialize_checkpoint_file", fake_materialize),
        patch(
            "services.checkpoints.inspect_checkpoint_file",
            return_value={
                "parameter_count": 10,
                "parameter_count_kind": "state_dict_tensor_elements",
                "graph": graph_payload,
                "warnings": [],
            },
        ),
    ):
        response = client.get(
            f"/api/projects/{project_id}/analyze/checkpoints/{checkpoint_id}/graph",
            headers=_headers(),
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["parameter_count"] == 10
    assert payload["parameter_count_kind"] == "state_dict_tensor_elements"
    assert payload["graph"]["source"] == "state_dict_hierarchy"


def test_checkpoint_list_seeds_default_yolo_checkpoint(client, _default_checkpoint_files):
    project_id = _create_project(client)

    response = client.get(
        f"/api/projects/{project_id}/analyze/checkpoints?scope=project&model_family=yolo",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    diagnostics = response.json()["diagnostics"]
    checkpoints = response.json()["checkpoints"]
    assert len(checkpoints) == 1
    checkpoint = checkpoints[0]
    assert checkpoint["filename"] == DEFAULT_YOLO_CHECKPOINT_FILENAME
    assert checkpoint["model_family"] == "yolo"
    assert checkpoint["object_storage_key"] == default_yolo_checkpoint_object_key(
        uuid.UUID(project_id)
    )
    assert response.json()["diagnostics"] == {
        "endpoint": "/analyze/checkpoints",
        "scope": "project",
        "model_family_filter": "yolo",
        "default_yolo_filename": DEFAULT_YOLO_CHECKPOINT_FILENAME,
        "default_yolo_path": str(DEFAULT_YOLO_CHECKPOINT_PATH),
        "default_yolo_file_present": True,
        "default_yolo_registered": True,
        "default_yolo_checkpoint_id": checkpoint["id"],
        "default_sam_filename": DEFAULT_SAM_CHECKPOINT_FILENAME,
        "default_sam_path": str(DEFAULT_SAM_CHECKPOINT_PATH),
        "default_sam_file_present": True,
        "default_sam_registered": True,
        "default_sam_checkpoint_id": diagnostics["default_sam_checkpoint_id"],
        "default_anomalib_filename": DEFAULT_ANOMALIB_CHECKPOINT_FILENAME,
        "default_anomalib_path": str(DEFAULT_ANOMALIB_CHECKPOINT_PATH),
        "default_anomalib_file_present": True,
        "default_anomalib_registered": True,
        "default_anomalib_checkpoint_id": diagnostics["default_anomalib_checkpoint_id"],
    }


def test_checkpoint_list_seeds_default_anomalib_checkpoint(client, _default_checkpoint_files):
    project_id = _create_project(client)

    response = client.get(
        f"/api/projects/{project_id}/analyze/checkpoints?scope=project&model_family=anomalib",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    checkpoints = response.json()["checkpoints"]
    assert len(checkpoints) == 1
    checkpoint = checkpoints[0]
    assert checkpoint["filename"] == DEFAULT_ANOMALIB_CHECKPOINT_FILENAME
    assert checkpoint["model_family"] == "anomalib"
    assert checkpoint["model_version"] == "PatchCore"
    assert checkpoint["object_storage_key"] == default_anomalib_checkpoint_object_key(
        uuid.UUID(project_id)
    )
    diagnostics = response.json()["diagnostics"]
    assert diagnostics["default_anomalib_file_present"] is True
    assert diagnostics["default_anomalib_registered"] is True
    assert diagnostics["default_anomalib_checkpoint_id"] == checkpoint["id"]


def test_checkpoint_list_seeds_default_sam_checkpoint(client, _default_checkpoint_files):
    project_id = _create_project(client)

    response = client.get(
        f"/api/projects/{project_id}/analyze/checkpoints?scope=project&model_family=sam",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    checkpoints = response.json()["checkpoints"]
    assert len(checkpoints) == 1
    checkpoint = checkpoints[0]
    assert checkpoint["filename"] == DEFAULT_SAM_CHECKPOINT_FILENAME
    assert checkpoint["model_family"] == "sam"
    assert checkpoint["model_version"] == "SAM1"
    assert checkpoint["object_storage_key"] == default_sam_checkpoint_object_key(
        uuid.UUID(project_id)
    )
    diagnostics = response.json()["diagnostics"]
    assert diagnostics["default_sam_file_present"] is True
    assert diagnostics["default_sam_registered"] is True
    assert diagnostics["default_sam_checkpoint_id"] == checkpoint["id"]


@pytest.mark.asyncio
async def test_workflow_checkpoint_resolution_materializes_and_injects_path(
    db_session, monkeypatch
):
    from backend.analyze_toolbox.contracts import WorkflowGraph

    from schemas.users import User
    from services.checkpoints import workflow_with_checkpoint_paths

    project_id = uuid.uuid4()
    checkpoint_id = uuid.uuid4()
    db_session.add(
        models.Project(
            id=project_id, name="P", meta_group_id="checkpoint-group", created_by="u"
        )
    )
    db_session.add(
        models.ModelCheckpoint(
            id=checkpoint_id,
            project_id=project_id,
            meta_group_id="checkpoint-group",
            filename="sam2.pt",
            object_storage_key=f"{project_id}/checkpoints/{checkpoint_id}/sam2.pt",
            content_type="application/octet-stream",
            size_bytes=3,
            sha256="a" * 64,
            model_family="sam",
            model_version="SAM2",
            parameter_count=12,
            diagnostics={"model_type": "SAM"},
            uploaded_by_user_id="u",
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    async def fake_materialize(*_args, **_kwargs):
        return "/tmp/sam2.pt"

    monkeypatch.setattr(
        "services.checkpoints.materialize_checkpoint_file", fake_materialize
    )

    workflow = WorkflowGraph(
        nodes=[
            {
                "id": "sam",
                "method_id": "segmentation.sam.placeholder",
                "parameters": {"checkpoint_id": str(checkpoint_id)},
            }
        ],
        edges=[],
    )
    user = User(email="checkpoint-user@example.com", groups=["checkpoint-group"])

    updated = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db_session, current_user=user
    )

    params = updated.nodes[0].parameters
    assert params["checkpoint_id"] == str(checkpoint_id)
    assert params["options"]["model_checkpoint"] == "/tmp/sam2.pt"


@pytest.mark.asyncio
async def test_workflow_uses_default_yolo_checkpoint_when_none_selected(db_session, _default_checkpoint_files):
    from backend.analyze_toolbox.contracts import WorkflowGraph

    from schemas.users import User
    from services.checkpoints import workflow_with_checkpoint_paths

    project_id = uuid.uuid4()
    project = models.Project(
        id=project_id, name="P", meta_group_id="checkpoint-group", created_by="u"
    )
    db_session.add(project)
    await db_session.commit()
    workflow = WorkflowGraph(
        nodes=[
            {
                "id": "yolo",
                "method_id": "segmentation.yolo.placeholder",
                "parameters": {"options": {"confidence": 0.25}},
            }
        ],
        edges=[],
    )
    user = User(email="checkpoint-user@example.com", groups=["checkpoint-group"])

    updated = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db_session, current_user=user, project=project
    )

    params = updated.nodes[0].parameters
    assert params["checkpoint_id"]
    assert params["options"]["model"] == str(DEFAULT_YOLO_CHECKPOINT_PATH)
    assert params["options"]["pretrained_model"] == params["options"]["model"]


@pytest.mark.asyncio
async def test_workflow_uses_default_anomalib_checkpoint_when_none_selected(db_session, _default_checkpoint_files):
    from backend.analyze_toolbox.contracts import WorkflowGraph

    from schemas.users import User
    from services.checkpoints import workflow_with_checkpoint_paths

    project_id = uuid.uuid4()
    project = models.Project(
        id=project_id, name="P", meta_group_id="checkpoint-group", created_by="u"
    )
    db_session.add(project)
    await db_session.commit()
    workflow = WorkflowGraph(
        nodes=[
            {
                "id": "anomalib",
                "method_id": "segmentation.anomalib.placeholder",
                "parameters": {"options": {"model_name": "patchcore"}},
            }
        ],
        edges=[],
    )
    user = User(email="checkpoint-user@example.com", groups=["checkpoint-group"])

    updated = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db_session, current_user=user, project=project
    )

    params = updated.nodes[0].parameters
    assert params["checkpoint_id"]
    assert params["options"]["model"] == str(DEFAULT_ANOMALIB_CHECKPOINT_PATH)
    assert params["options"]["checkpoint_path"] == params["options"]["model"]


@pytest.mark.asyncio
async def test_workflow_uses_default_sam_checkpoint_when_none_selected(db_session, _default_checkpoint_files):
    from backend.analyze_toolbox.contracts import WorkflowGraph

    from schemas.users import User
    from services.checkpoints import workflow_with_checkpoint_paths

    project_id = uuid.uuid4()
    project = models.Project(
        id=project_id, name="P", meta_group_id="checkpoint-group", created_by="u"
    )
    db_session.add(project)
    await db_session.commit()
    workflow = WorkflowGraph(
        nodes=[
            {
                "id": "sam",
                "method_id": "segmentation.sam.placeholder",
                "parameters": {"mode": "default"},
            }
        ],
        edges=[],
    )
    user = User(email="checkpoint-user@example.com", groups=["checkpoint-group"])

    updated = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db_session, current_user=user, project=project
    )

    params = updated.nodes[0].parameters
    assert params["checkpoint_id"]
    assert params["options"]["model"] == str(DEFAULT_SAM_CHECKPOINT_PATH)
    assert params["options"]["model_checkpoint"] == params["options"]["model"]


@pytest.mark.asyncio
async def test_workflow_does_not_inject_default_yolo_into_hidden_legacy_method(
    db_session,
):
    from backend.analyze_toolbox.contracts import WorkflowGraph

    from schemas.users import User
    from services.checkpoints import workflow_with_checkpoint_paths

    project_id = uuid.uuid4()
    project = models.Project(
        id=project_id, name="P", meta_group_id="checkpoint-group", created_by="u"
    )
    db_session.add(project)
    await db_session.commit()
    workflow = WorkflowGraph(
        nodes=[
            {
                "id": "yolo",
                "method_id": "ml.yolov8.detect",
                "parameters": {"model": "yolov8n.pt", "confidence": 0.25},
            }
        ],
        edges=[],
    )
    user = User(email="checkpoint-user@example.com", groups=["checkpoint-group"])

    updated = await workflow_with_checkpoint_paths(
        workflow=workflow, db=db_session, current_user=user, project=project
    )

    assert updated.nodes[0].parameters == {"model": "yolov8n.pt", "confidence": 0.25}


@pytest.mark.asyncio
async def test_workflow_rejects_wrong_checkpoint_family(db_session):
    from backend.analyze_toolbox.contracts import WorkflowGraph

    from schemas.users import User
    from services.errors import ValidationFailedError
    from services.checkpoints import workflow_with_checkpoint_paths

    project_id = uuid.uuid4()
    checkpoint_id = uuid.uuid4()
    db_session.add(
        models.Project(
            id=project_id, name="P", meta_group_id="checkpoint-group", created_by="u"
        )
    )
    db_session.add(
        models.ModelCheckpoint(
            id=checkpoint_id,
            project_id=project_id,
            meta_group_id="checkpoint-group",
            filename="sam2.pt",
            object_storage_key=f"{project_id}/checkpoints/{checkpoint_id}/sam2.pt",
            content_type="application/octet-stream",
            size_bytes=3,
            sha256="a" * 64,
            model_family="sam",
            model_version="SAM2",
            parameter_count=12,
            diagnostics={"model_type": "SAM"},
            uploaded_by_user_id="u",
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    workflow = WorkflowGraph(
        nodes=[
            {
                "id": "yolo",
                "method_id": "segmentation.yolo.placeholder",
                "parameters": {"checkpoint_id": str(checkpoint_id)},
            }
        ],
        edges=[],
    )
    user = User(email="checkpoint-user@example.com", groups=["checkpoint-group"])

    with pytest.raises(ValidationFailedError) as exc_info:
        await workflow_with_checkpoint_paths(
            workflow=workflow, db=db_session, current_user=user
        )

    assert exc_info.value.status_code == 400
