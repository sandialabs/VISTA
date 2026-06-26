import uuid
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


ParameterType = Literal["boolean", "integer", "float", "string", "select", "range", "json"]
PortType = Literal["image", "mask", "labels", "detections", "measurements", "table", "metadata", "any"]


class MethodParameter(BaseModel):
    name: str = Field(..., min_length=1, max_length=96)
    label: str = Field(..., min_length=1, max_length=128)
    type: ParameterType
    default: Any = None
    required: bool = False
    description: Optional[str] = Field(default=None, max_length=1200)
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    options: List[str] = Field(default_factory=list)


class MethodSpec(BaseModel):
    id: str = Field(..., min_length=1, max_length=128, pattern=r"^[a-z0-9_.-]+$")
    name: str = Field(..., min_length=1, max_length=160)
    category: str = Field(..., min_length=1, max_length=96)
    description: str = Field(..., min_length=1, max_length=1600)
    input_types: List[PortType] = Field(default_factory=lambda: ["image"])
    output_types: List[PortType] = Field(default_factory=lambda: ["image"])
    parameters: List[MethodParameter] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    jipipe_origin: Optional[str] = Field(default=None, max_length=256)

    @field_validator("input_types", "output_types")
    @classmethod
    def require_ports(cls, value: List[PortType]) -> List[PortType]:
        if not value:
            raise ValueError("method ports cannot be empty")
        return value


class ToolboxManifest(BaseModel):
    name: str = "backend_analyze_toolbox"
    version: str = "0.1.0"
    contract_version: str = "vista-analyze.v1"
    methods: List[MethodSpec]


class WorkflowInputSource(BaseModel):
    id: str = Field(default="all-loaded-part-images", min_length=1, max_length=128)
    label: str = Field(default="All images from loaded parts", min_length=1, max_length=160)
    kind: Literal["project_parts", "manual_selection"] = "project_parts"
    project_id: Optional[uuid.UUID] = None
    image_count: int = Field(default=0, ge=0)
    part_count: int = Field(default=0, ge=0)
    selected_image_ids: List[uuid.UUID] = Field(default_factory=list)
    selected_part_ids: List[uuid.UUID] = Field(default_factory=list)
    example_image_id: Optional[uuid.UUID] = None


class WorkflowOutputConfig(BaseModel):
    mode: Literal[
        "processing_sequence",
        "metadata_only",
        "overlay_artifact",
        "materialized_image",
        "review_only",
        "versioned_image",
        "overlay_metadata",
        "measurements_table",
    ] = "processing_sequence"
    version_strategy: Literal["recipe_metadata", "append_vn", "materialized_file"] = "recipe_metadata"
    artifact_policy: Literal["automatic_by_output_type", "metadata_only", "overlay_for_spatial_outputs", "materialize_all"] = "automatic_by_output_type"
    cache_policy: Literal["local_on_demand", "server_on_demand", "no_cache"] = "local_on_demand"
    invalidation_policy: Literal["source_workflow_toolbox_model", "source_and_parameters", "manual"] = "source_workflow_toolbox_model"
    provenance_level: Literal["full", "minimal"] = "full"
    export_policy: Literal["materialize_on_export", "recipe_plus_artifacts", "metadata_only"] = "materialize_on_export"
    volume_policy: Literal["recipe_volume_sparse_artifacts", "materialize_selected_slices", "materialize_all_slices"] = "recipe_volume_sparse_artifacts"
    destination: Literal["analysis_artifacts", "project_images"] = "analysis_artifacts"
    preserve_original: bool = True
    write_detection_metadata: bool = True
    write_segmentation_overlays: bool = True
    write_measurement_tables: bool = True
    materialize_processed_images: bool = False


class WorkflowNodeSpec(BaseModel):
    id: str = Field(..., min_length=1, max_length=96, pattern=r"^[A-Za-z0-9_.-]+$")
    method_id: str = Field(..., min_length=1, max_length=128)
    label: Optional[str] = Field(default=None, max_length=160)
    chain_id: Optional[str] = Field(default=None, max_length=96)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    x: float = 0
    y: float = 0


class EdgeSpec(BaseModel):
    source_node: str = Field(..., min_length=1, max_length=96)
    target_node: str = Field(..., min_length=1, max_length=96)
    source_port: str = Field(default="output", min_length=1, max_length=64)
    target_port: str = Field(default="input", min_length=1, max_length=64)

    @model_validator(mode="after")
    def reject_self_edges(self) -> "EdgeSpec":
        if self.source_node == self.target_node:
            raise ValueError("workflow edges cannot connect a node to itself")
        return self


class WorkflowGraph(BaseModel):
    name: str = Field(default="Untitled analysis workflow", min_length=1, max_length=160)
    source: WorkflowInputSource = Field(default_factory=WorkflowInputSource)
    output: WorkflowOutputConfig = Field(default_factory=WorkflowOutputConfig)
    nodes: List[WorkflowNodeSpec] = Field(default_factory=list)
    edges: List[EdgeSpec] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_graph_shape(self) -> "WorkflowGraph":
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("workflow node ids must be unique")
        node_id_set = set(node_ids)
        for edge in self.edges:
            if edge.source_node not in node_id_set:
                raise ValueError(f"edge source node '{edge.source_node}' does not exist")
            if edge.target_node not in node_id_set:
                raise ValueError(f"edge target node '{edge.target_node}' does not exist")
        return self


class WorkflowNodeResult(BaseModel):
    node_id: str
    method_id: str
    status: Literal["completed", "skipped", "failed"] = "completed"
    output_types: List[PortType] = Field(default_factory=list)
    message: str = ""
    summary: Dict[str, Any] = Field(default_factory=dict)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)


class WorkflowImageInput(BaseModel):
    image_id: uuid.UUID
    filename: str
    content_type: Optional[str] = None
    data: bytes
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ToolboxExecutionResult(BaseModel):
    run_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    workflow_name: str
    status: Literal["validated", "simulated", "completed", "failed"]
    execution_mode: Literal["validation", "simulation", "execution"] = "validation"
    image_count: int = Field(default=0, ge=0)
    node_results: List[WorkflowNodeResult] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
