import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CheckpointsTab from './analyzeWorkbench/CheckpointsTab';
import AnalyzeToolboxPalette from './analyzeWorkbench/AnalyzeToolboxPalette';
import AnalyzeGraphCanvas from './analyzeWorkbench/AnalyzeGraphCanvas';
import AnalyzeInspectorPanel from './analyzeWorkbench/AnalyzeInspectorPanel';
import InputSelectionModal from './analyzeWorkbench/InputSelectionModal';
import {
  fastapiChecklistItems,
  statusDetailNodes,
  statusProgressResult,
} from '../features/analyzeWorkbench/runDiagnostics';
import useWorkflowGraph from '../features/analyzeWorkbench/useWorkflowGraph';
import useAnalyzeWorkflowEditor from '../features/analyzeWorkbench/useAnalyzeWorkflowEditor';
import {
  chainEdges,
  graphDropPoint,
  SOURCE_METHOD_ID,
} from '../features/analyzeWorkbench/workflowGraph';
import {
  CHECKPOINT_METHOD_FAMILIES,
  parameterDefaults,
  parametersWithDefaultCheckpoint,
} from '../features/analyzeWorkbench/workflowParameters';
import { buildOutputConfig } from '../features/analyzeWorkbench/workflowSerialization';
import { useAnalyzeCheckpointState } from '../features/analyzeWorkbench/useAnalyzeCheckpointState';

function groupMethods(methods) {
  return methods.reduce((groups, method) => {
    const category = method.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(method);
    return groups;
  }, {});
}

function AnalyzeWorkbenchTab({ projectId, projectType, setError }) {
  const [activeAnalyzeSubtab, setActiveAnalyzeSubtab] = useState('pipeline');
  const {
    nodes,
    selectedNodeId,
    selectedNodeIds,
    drag: graphDrag,
    restore: restoreGraph,
    addNode,
    removeNodes,
    updateParameter,
    setSourceExample,
    applyDefaultCheckpoints,
    selectWithinBounds,
    clearSelection,
    clickNode,
    beginNodeDrag: beginGraphNodeDrag,
    moveNodeDrag,
    endNodeDrag,
  } = useWorkflowGraph();
  const {
    methods,
    methodById,
    inputSource,
    workflowStateLoaded,
    status,
    clearStatus,
    exampleImageId,
    setExampleImageId,
    loadedImages,
    processImageSet,
    stagedImages,
    availableImages,
    handleDragStart,
    handleDrop,
    moveImagesToProcess,
    removeImagesFromProcess,
    movePartToProcess,
    removePartFromProcess,
    submitWorkflow,
    stopWorkflow,
  } = useAnalyzeWorkflowEditor({ projectId, setError, nodes, restoreGraph });
  const [inputModalOpen, setInputModalOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [toolboxPreview, setToolboxPreview] = useState({ methodId: null, parameters: {} });
  const {
    checkpointScope,
    setActiveCheckpointScope,
    checkpointState,
    refreshCheckpoints,
    activeCheckpoints,
  } = useAnalyzeCheckpointState(projectId);
  const graphRef = useRef(null);
  const marqueeRef = useRef(null);
  const [marquee, setMarquee] = useState(null);

  const methodsByCategory = useMemo(() => groupMethods(methods), [methods]);
  const orderedCategories = useMemo(() => Object.entries(methodsByCategory), [methodsByCategory]);
  const selectedToolboxMethod = toolboxPreview.methodId ? methodById.get(toolboxPreview.methodId) : null;
  const selectedGraphNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const selectedNode = selectedToolboxMethod ? null : (selectedGraphNode || nodes[0] || null);
  const selectedMethod = selectedToolboxMethod || (selectedNode ? methodById.get(selectedNode.method_id) : null);
  const selectedParameterValues = selectedToolboxMethod ? toolboxPreview.parameters : (selectedNode?.parameters || {});
  const edges = useMemo(() => chainEdges(nodes), [nodes]);
  const graphBounds = useMemo(() => {
    const maxX = nodes.reduce((value, node) => Math.max(value, node.x + 220), 980);
    const maxY = nodes.reduce((value, node) => Math.max(value, node.y + 140), 540);
    return { width: maxX, height: maxY };
  }, [nodes]);
  const outputConfig = useMemo(() => buildOutputConfig(nodes), [nodes]);
  const progressStatus = useMemo(() => ({ ...status, result: statusProgressResult(status) }), [status]);
  const statusDetailItems = useMemo(() => statusDetailNodes(status.result), [status.result]);
  const checklistItems = useMemo(() => fastapiChecklistItems(progressStatus), [progressStatus]);

  const selectedCheckpointFamily = selectedMethod ? CHECKPOINT_METHOD_FAMILIES[selectedMethod.id] : null;
  const selectedMethodCheckpoints = useMemo(() => (
    selectedCheckpointFamily
      ? activeCheckpoints.filter((checkpoint) => checkpoint.model_family === selectedCheckpointFamily)
      : []
  ), [activeCheckpoints, selectedCheckpointFamily]);

  useEffect(() => {
    if (!workflowStateLoaded) return;
    const availableCheckpoints = checkpointState.project.length > 0 ? checkpointState.project : checkpointState.authorized;
    if (availableCheckpoints.length === 0) return;
    applyDefaultCheckpoints(availableCheckpoints);
  }, [applyDefaultCheckpoints, checkpointState.authorized, checkpointState.project, workflowStateLoaded]);

  const toggleCategoryCollapsed = useCallback((category) => {
    setCollapsedCategories((previous) => ({
      ...previous,
      [category]: !previous[category],
    }));
  }, []);

  const selectToolboxMethod = useCallback((method) => {
    const availableCheckpoints = checkpointState.project.length > 0 ? checkpointState.project : checkpointState.authorized;
    setToolboxPreview((previous) => ({
      methodId: method.id,
      parameters: parametersWithDefaultCheckpoint(
        previous.methodId === method.id ? previous.parameters : parameterDefaults(method),
        method.id,
        availableCheckpoints
      ),
    }));
    clearSelection();
  }, [checkpointState.authorized, checkpointState.project, clearSelection]);

  const clearToolboxPreview = useCallback(() => {
    setToolboxPreview({ methodId: null, parameters: {} });
  }, []);

  const addMethodNode = useCallback((method, dropPoint) => {
    const availableCheckpoints = checkpointState.project.length > 0 ? checkpointState.project : checkpointState.authorized;
    const previewParameters = parametersWithDefaultCheckpoint(
      toolboxPreview.methodId === method.id ? toolboxPreview.parameters : {},
      method.id,
      availableCheckpoints
    );
    addNode(method, dropPoint, previewParameters);
    setToolboxPreview({ methodId: null, parameters: {} });
  }, [addNode, checkpointState.authorized, checkpointState.project, toolboxPreview]);

  const updateSelectedParameter = useCallback((name, value) => {
    if (selectedToolboxMethod) {
      setToolboxPreview((previous) => ({
        ...previous,
        parameters: { ...previous.parameters, [name]: value },
      }));
      return;
    }
    if (!selectedNode) return;
    if (selectedNode.method_id === SOURCE_METHOD_ID && name === 'example_image_id') {
      setExampleImageId(value);
    }
    updateParameter(selectedNode.id, name, value);
  }, [selectedNode, selectedToolboxMethod, setExampleImageId, updateParameter]);

  const handleNodeClick = useCallback((node, event) => {
    if (clickNode(node, event)) clearToolboxPreview();
  }, [clearToolboxPreview, clickNode]);

  const beginNodeDrag = useCallback((event, node) => {
    if (beginGraphNodeDrag(event, node)) clearToolboxPreview();
  }, [beginGraphNodeDrag, clearToolboxPreview]);

  const removeSelectedNode = useCallback(() => {
    const removeIds = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNode ? [selectedNode.id] : []);
    if (removeIds.length === 0) return;
    removeNodes(removeIds);
    if (selectedNode && removeIds.includes(selectedNode.id) && selectedNode.method_id === SOURCE_METHOD_ID) {
      setInputModalOpen(false);
    }
  }, [removeNodes, selectedNode, selectedNodeIds]);

  const handleGraphDrop = useCallback((event) => {
    event.preventDefault();
    const methodId = event.dataTransfer?.getData('text/x-vista-method-id');
    if (!methodId) return;
    const method = methodById.get(methodId);
    if (!method) return;
    addMethodNode(method, graphDropPoint(event, graphRef.current));
  }, [addMethodNode, methodById]);

  const beginMarqueeSelect = useCallback((event) => {
    if (event.target !== event.currentTarget || event.button !== 0) return;
    clearToolboxPreview();
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect) return;
    marqueeRef.current = { startX: event.clientX - rect.left, startY: event.clientY - rect.top };
    setMarquee({ x: marqueeRef.current.startX, y: marqueeRef.current.startY, width: 0, height: 0 });
  }, [clearToolboxPreview]);

  const moveMarqueeSelect = useCallback((event) => {
    if (!marqueeRef.current) return;
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const sx = marqueeRef.current.startX;
    const sy = marqueeRef.current.startY;
    const bounds = { left: Math.min(sx, x), top: Math.min(sy, y), right: Math.max(sx, x), bottom: Math.max(sy, y) };
    setMarquee({ x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top });
    selectWithinBounds(bounds);
  }, [selectWithinBounds]);

  const endMarqueeSelect = useCallback(() => {
    marqueeRef.current = null;
    setMarquee(null);
  }, []);

  return (
    <section className="analyze-workbench" aria-label="Analyze Workbench">
      <div className="analyze-command-strip">
        <div>
          <p className="analyze-eyebrow">Analyze / {projectType || 'PT1'}</p>
          <h2>Pipeline Studio</h2>
        </div>
        <div className="analyze-source-stats" data-testid="analyze-source-summary">
          <span>{inputSource?.source?.part_count || 0} parts</span>
          <span>{inputSource?.source?.image_count || 0} images</span>
          <span>{stagedImages.length} process</span>
          <span>{methods.length} methods</span>
        </div>
      </div>

      <div className="project-tabs analyze-subtabs" role="tablist" aria-label="Analyze subtabs">
        <button
          type="button"
          className={`project-tab ${activeAnalyzeSubtab === 'pipeline' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeAnalyzeSubtab === 'pipeline'}
          onClick={() => setActiveAnalyzeSubtab('pipeline')}
        >
          Pipeline Studio
        </button>
        <button
          type="button"
          className={`project-tab ${activeAnalyzeSubtab === 'checkpoints' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeAnalyzeSubtab === 'checkpoints'}
          onClick={() => setActiveAnalyzeSubtab('checkpoints')}
        >
          Checkpoints
        </button>
      </div>

      {activeAnalyzeSubtab === 'checkpoints' && (
        <CheckpointsTab
          projectId={projectId}
          checkpointState={checkpointState}
          checkpointScope={checkpointScope}
          onCheckpointStored={refreshCheckpoints}
          setError={setError}
        />
      )}

      {activeAnalyzeSubtab === 'pipeline' && <div className="analyze-grid">
        <AnalyzeToolboxPalette
          orderedCategories={orderedCategories}
          collapsedCategories={collapsedCategories}
          onToggleCategory={toggleCategoryCollapsed}
          selectedToolboxMethodId={selectedToolboxMethod?.id || null}
          onSelectMethod={selectToolboxMethod}
        />

        <AnalyzeGraphCanvas
          status={status}
          exampleImageId={exampleImageId}
          nodes={nodes}
          onValidate={() => submitWorkflow('validate')}
          onRunExample={() => submitWorkflow('execute', 'example')}
          onRun={() => submitWorkflow('execute', 'all')}
          onStop={stopWorkflow}
          graphRef={graphRef}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleGraphDrop}
          onPointerDownMarquee={beginMarqueeSelect}
          onPointerMoveMarquee={moveMarqueeSelect}
          onPointerUpMarquee={endMarqueeSelect}
          graphBounds={graphBounds}
          edges={edges}
          methodById={methodById}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          graphDrag={graphDrag}
          onBeginNodeDrag={beginNodeDrag}
          onMoveNodeDrag={moveNodeDrag}
          onEndNodeDrag={endNodeDrag}
          onNodeClick={handleNodeClick}
          marquee={marquee}
        />

        <AnalyzeInspectorPanel
          selectedNode={selectedNode}
          selectedToolboxMethod={selectedToolboxMethod}
          selectedMethod={selectedMethod}
          selectedParameterValues={selectedParameterValues}
          selectedMethodCheckpoints={selectedMethodCheckpoints}
          checkpointScope={checkpointScope}
          setActiveCheckpointScope={setActiveCheckpointScope}
          stagedImages={stagedImages}
          loadedImages={loadedImages}
          exampleImageId={exampleImageId}
          updateSelectedParameter={updateSelectedParameter}
          onSelectImages={() => setInputModalOpen(true)}
          outputConfig={outputConfig}
          status={status}
          clearStatus={clearStatus}
          checklistItems={checklistItems}
          statusDetailItems={statusDetailItems}
          selectedNodeIds={selectedNodeIds}
          removeSelectedNode={removeSelectedNode}
        />
      </div>}
      {inputModalOpen && (
        <InputSelectionModal
          inputSource={inputSource}
          processImageSet={processImageSet}
          availableImages={availableImages}
          stagedImages={stagedImages}
          exampleImageId={exampleImageId}
          onChooseExample={(value) => {
            setExampleImageId(value);
            setSourceExample(value);
          }}
          onClose={() => setInputModalOpen(false)}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          onMoveImage={(id) => moveImagesToProcess([id])}
          onRemoveImage={(id) => removeImagesFromProcess([id])}
          onMovePart={movePartToProcess}
          onRemovePart={removePartFromProcess}
        />
      )}
    </section>
  );
}

export default AnalyzeWorkbenchTab;
