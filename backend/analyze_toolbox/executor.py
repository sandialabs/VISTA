from collections.abc import Callable, Iterable
from typing import Any

from PIL import Image

from .contracts import (
    ToolboxExecutionResult,
    WorkflowGraph,
    WorkflowImageInput,
    WorkflowNodeResult,
)
from .image_decode import decode_workflow_image
from .method_handlers import handler_for
from .registry import _method_map, validate_workflow
from .segmentation import FastAPIAnalysisCancelled, FastAPIDiagnosticsError
from .workflow_state import ImageState, RunCallbacks


class AnalyzeExecutionCancelled(RuntimeError):
    """Raised when a user stops an Analyze workflow run."""


def _node_parameters(node, method) -> dict[str, Any]:
    params = {parameter.name: parameter.default for parameter in method.parameters}
    params.update(node.parameters or {})
    return params


def _chains(workflow: WorkflowGraph) -> list[list[Any]]:
    children: dict[str, list[str]] = {node.id: [] for node in workflow.nodes}
    nodes_by_id = {node.id: node for node in workflow.nodes}
    for edge in workflow.edges:
        children.setdefault(edge.source_node, []).append(edge.target_node)

    chains = []
    source_nodes = [
        node
        for node in workflow.nodes
        if node.method_id == "source.project_part_images"
    ]
    for source_node in source_nodes:
        chain = [source_node]
        current = source_node
        seen = {source_node.id}
        while children.get(current.id):
            next_id = children[current.id][0]
            if next_id in seen:
                break
            current = nodes_by_id[next_id]
            chain.append(current)
            seen.add(current.id)
        chains.append(chain)
    return chains


def _decode_image(image_input: WorkflowImageInput) -> Image.Image:
    return decode_workflow_image(image_input)


def _completed_node_result(
    state: ImageState,
    node,
    method,
    image_input: WorkflowImageInput,
    callbacks: RunCallbacks,
    warnings: list[str],
) -> tuple[ImageState, WorkflowNodeResult]:
    handler = handler_for(node.method_id)
    state, message, summary, artifacts = handler(
        state, method, _node_parameters(node, method), callbacks
    )
    runtime_warning = (
        summary.get("runtime_warning") if isinstance(summary, dict) else None
    )
    if runtime_warning and runtime_warning not in warnings:
        warnings.append(str(runtime_warning))
    node_status = (
        summary.pop("_node_status", "completed")
        if isinstance(summary, dict)
        else "completed"
    )
    state.artifacts.extend(artifacts)
    return state, WorkflowNodeResult(
        node_id=node.id,
        method_id=node.method_id,
        status=node_status,
        output_types=method.output_types,
        message=f"{message} ({image_input.filename})",
        summary={"image_id": str(image_input.image_id), **summary},
        artifacts=artifacts,
    )


def _failed_node_result(
    node, method, image_input: WorkflowImageInput, exc: Exception
) -> WorkflowNodeResult:
    summary: dict[str, Any] = {"image_id": str(image_input.image_id)}
    if isinstance(exc, FastAPIDiagnosticsError):
        summary["fastapi_diagnostics"] = dict(exc.diagnostics or {})
    return WorkflowNodeResult(
        node_id=node.id,
        method_id=node.method_id,
        status="failed",
        output_types=method.output_types,
        message=f"{exc} ({image_input.filename})",
        summary=summary,
    )


def _run_chain(
    chain: list[Any],
    image_input: WorkflowImageInput,
    methods: dict[str, Any],
    callbacks: RunCallbacks,
    node_results: list[WorkflowNodeResult],
    warnings: list[str],
) -> bool:
    """Run one chain on one image; return True if a node failed."""
    decoded = _decode_image(image_input).copy()
    state = ImageState(
        source_image=decoded.copy(),
        image=decoded.copy(),
        source_metadata=dict(image_input.metadata or {}),
    )
    for node in chain:
        if callbacks.cancel_check and callbacks.cancel_check():
            raise AnalyzeExecutionCancelled(
                "Analyze workflow execution was stopped by the user."
            )
        method = methods[node.method_id]
        try:
            state, node_result = _completed_node_result(
                state, node, method, image_input, callbacks, warnings
            )
        except (AnalyzeExecutionCancelled, FastAPIAnalysisCancelled):
            raise
        except Exception as exc:
            node_results.append(_failed_node_result(node, method, image_input, exc))
            return True
        node_results.append(node_result)
    return False


def execute_image_workflow(
    workflow: WorkflowGraph,
    images: Iterable[WorkflowImageInput],
    *,
    cancel_check: Callable[[], bool] | None = None,
    remote_job_callback: Callable[[str, str], None] | None = None,
) -> ToolboxExecutionResult:
    validation = validate_workflow(workflow)
    methods = _method_map()
    chains = _chains(workflow)
    image_inputs = list(images)
    callbacks = RunCallbacks(
        cancel_check=cancel_check, remote_job_callback=remote_job_callback
    )
    node_results: list[WorkflowNodeResult] = []
    warnings = list(validation.warnings)
    failed = False

    for image_input in image_inputs:
        for chain in chains:
            if _run_chain(
                chain, image_input, methods, callbacks, node_results, warnings
            ):
                failed = True

    if not image_inputs:
        warnings.append("No image bytes were provided for execution.")

    return ToolboxExecutionResult(
        workflow_name=workflow.name,
        status="failed" if failed else "completed",
        execution_mode="execution",
        image_count=len(image_inputs),
        node_results=node_results,
        warnings=warnings,
    )
