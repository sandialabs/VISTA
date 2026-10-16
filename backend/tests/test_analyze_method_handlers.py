"""Dispatch coverage for the Analyze workflow method handler registry."""

import io
import sys
import uuid

import pytest
from PIL import Image, ImageDraw

from analyze_toolbox import (
    WorkflowGraph,
    WorkflowImageInput,
    execute_image_workflow,
    method_handlers,
    validate_workflow,
)
from analyze_toolbox.registry import _method_map
from analyze_toolbox.workflow_state import ImageState, RunCallbacks
from core.config import settings

IMAGE_ID = uuid.UUID(int=1)
METHOD_IDS = sorted(_method_map())


def _png_bytes() -> bytes:
    image = Image.new("RGB", (24, 16), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle([3, 3, 9, 10], fill=(220, 120, 40))
    draw.rectangle([14, 5, 20, 12], fill=(30, 200, 90))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _workflow(method_id: str) -> WorkflowGraph:
    nodes = [
        {"id": "input", "method_id": "source.project_part_images", "parameters": {}}
    ]
    edges = []
    if method_id != "source.project_part_images":
        nodes.append({"id": "step", "method_id": method_id, "parameters": {}})
        edges.append({"source_node": "input", "target_node": "step"})
    return WorkflowGraph(
        name=f"Dispatch {method_id}",
        source={
            "kind": "manual_selection",
            "selected_image_ids": [IMAGE_ID],
            "image_count": 1,
        },
        nodes=nodes,
        edges=edges,
    )


@pytest.fixture
def no_native_runtime(monkeypatch):
    monkeypatch.setattr(settings, "VISTA_DISABLE_NATIVE_SEGMENTATION_RUNTIME", True)
    monkeypatch.setitem(sys.modules, "ultralytics", None)


def test_every_registered_method_has_a_runtime_handler():
    assert set(method_handlers.METHOD_HANDLERS) == set(METHOD_IDS)


@pytest.mark.parametrize("method_id", METHOD_IDS)
def test_every_registered_method_dispatches_to_its_handler(
    method_id, monkeypatch, no_native_runtime
):
    calls = []
    real_handler = method_handlers.METHOD_HANDLERS[method_id]

    def recording_handler(state, method, params, callbacks):
        calls.append(method.id)
        return real_handler(state, method, params, callbacks)

    monkeypatch.setitem(method_handlers.METHOD_HANDLERS, method_id, recording_handler)

    result = execute_image_workflow(
        _workflow(method_id),
        [
            WorkflowImageInput(
                image_id=IMAGE_ID,
                filename="dispatch.png",
                content_type="image/png",
                data=_png_bytes(),
            )
        ],
    )

    assert calls == [method_id]
    step = result.node_results[-1]
    assert step.method_id == method_id
    assert step.message != f"{method_handlers.NO_HANDLER_MESSAGE} (dispatch.png)"


def test_unknown_method_is_rejected_with_the_registry_error():
    workflow = _workflow("source.project_part_images").model_copy(
        update={
            "nodes": [
                {
                    "id": "input",
                    "method_id": "source.project_part_images",
                    "parameters": {},
                },
                {"id": "step", "method_id": "unknown.method", "parameters": {}},
            ],
            "edges": [{"source_node": "input", "target_node": "step"}],
        }
    )
    workflow = WorkflowGraph.model_validate(workflow.model_dump())

    with pytest.raises(ValueError, match=r"^Unknown toolbox method 'unknown\.method'$"):
        validate_workflow(workflow)
    with pytest.raises(ValueError, match=r"^Unknown toolbox method 'unknown\.method'$"):
        execute_image_workflow(workflow, [])


def test_method_without_handler_keeps_the_no_operation_result():
    image = Image.new("L", (2, 2), 0)
    state = ImageState(source_image=image, image=image)

    handler = method_handlers.handler_for("not.registered")
    returned_state, message, summary, artifacts = handler(
        state, None, {}, RunCallbacks()
    )

    assert returned_state is state
    assert message == "No runtime operation registered for this method."
    assert summary == {}
    assert artifacts == []
