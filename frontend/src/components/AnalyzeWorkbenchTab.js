import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_WORKFLOW_NAME = 'Part image analysis workflow';
const ANALYZE_WORKFLOW_METADATA_KEY = 'vista.analyze.workflow';
const SOURCE_METHOD_ID = 'source.project_part_images';
const OUTPUT_METHOD_ID = 'output.versioned_image_artifact';
const GRAPH_NODE_WIDTH = 168;
const GRAPH_START_X = 72;
const GRAPH_TOP_Y = 84;
const GRAPH_CHAIN_GAP = 152;
const GRAPH_ORDER_STEP = GRAPH_NODE_WIDTH + 56;
const GRAPH_CHAIN_SNAP_PROGRESS = 0.8;
const GRAPH_NODE_HEIGHT = 76;

function groupMethods(methods) {
  return methods.reduce((groups, method) => {
    const category = method.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(method);
    return groups;
  }, {});
}

function parameterDefaults(method) {
  return (method?.parameters || []).reduce((acc, parameter) => {
    acc[parameter.name] = parameter.default;
    return acc;
  }, {});
}

function makeNode(method, index, overrides = {}) {
  const chainId = overrides.chain_id || 'chain-1';
  return {
    id: overrides.id || `${method.id.replace(/[^A-Za-z0-9_.-]/g, '-')}-${index + 1}`,
    method_id: method.id,
    label: overrides.label || method.name,
    chain_id: chainId,
    parameters: { ...parameterDefaults(method), ...(overrides.parameters || {}) },
    x: overrides.x ?? GRAPH_START_X + (index * 175),
    y: overrides.y ?? GRAPH_TOP_Y,
  };
}

function makeDefaultNodes(methods) {
  const preferred = [
    'source.project_part_images',
    'preprocess.window_level_normalization',
    'segmentation.opencv.placeholder',
    OUTPUT_METHOD_ID,
  ];
  return preferred
    .map((methodId) => methods.find((method) => method.id === methodId))
    .filter(Boolean)
    .map((method, index) => makeNode(method, index, {
      id: index === 0 ? 'input-source' : undefined,
      label: index === 0 ? 'Loaded Part Images' : method.name,
      x: GRAPH_START_X + (index * GRAPH_ORDER_STEP),
      y: GRAPH_TOP_Y,
    }));
}

function nodeChainId(node) {
  return node.chain_id || 'chain-1';
}

function chainLaneY(index) {
  return GRAPH_TOP_Y + (index * GRAPH_CHAIN_GAP);
}

function compareNodesInChain(a, b) {
  if (a.node.method_id === SOURCE_METHOD_ID && b.node.method_id !== SOURCE_METHOD_ID) return -1;
  if (b.node.method_id === SOURCE_METHOD_ID && a.node.method_id !== SOURCE_METHOD_ID) return 1;
  const aCenter = a.node.x + (GRAPH_NODE_WIDTH / 2);
  const bCenter = b.node.x + (GRAPH_NODE_WIDTH / 2);
  if (aCenter !== bCenter) return aCenter - bCenter;
  if (a.node.y !== b.node.y) return a.node.y - b.node.y;
  return a.index - b.index;
}

function chainsFromNodes(nodes) {
  const chains = [];
  const chainById = new Map();
  nodes.forEach((node, index) => {
    const id = nodeChainId(node);
    if (!chainById.has(id)) {
      const chain = { id, firstIndex: index, minY: node.y, nodes: [] };
      chainById.set(id, chain);
      chains.push(chain);
    }
    const chain = chainById.get(id);
    chain.minY = Math.min(chain.minY, node.y);
    chain.nodes.push({ node: { ...node, chain_id: id }, index });
  });
  return chains
    .sort((a, b) => {
      if (a.minY !== b.minY) return a.minY - b.minY;
      return a.firstIndex - b.firstIndex;
    })
    .map((chain) => ({
      id: chain.id,
      nodes: chain.nodes.sort(compareNodesInChain).map((item) => item.node),
    }));
}

function chainEdges(nodes) {
  return chainsFromNodes(nodes).flatMap((chain) => (
    chain.nodes.slice(1).map((node, index) => ({
      source_node: chain.nodes[index].id,
      target_node: node.id,
      source_port: 'output',
      target_port: 'input',
    }))
  ));
}

function orderNodesByChains(nodes) {
  return chainsFromNodes(nodes).flatMap((chain) => chain.nodes);
}

function layoutNodesForChains(nodes) {
  return chainsFromNodes(nodes).flatMap((chain, chainIndex) => (
    chain.nodes.map((node, nodeIndex) => ({
      ...node,
      chain_id: chain.id,
      x: GRAPH_START_X + (nodeIndex * GRAPH_ORDER_STEP),
      y: chainLaneY(chainIndex),
    }))
  ));
}

function nextChainId(nodes) {
  const highest = nodes.reduce((value, node) => {
    const match = /^chain-(\d+)$/.exec(nodeChainId(node));
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `chain-${highest + 1}`;
}

function appendPositionForChain(nodes, chainId) {
  const chains = chainsFromNodes(nodes);
  const existingIndex = chains.findIndex((chain) => chain.id === chainId);
  const chainIndex = existingIndex >= 0 ? existingIndex : chains.length;
  const chain = existingIndex >= 0 ? chains[existingIndex] : { nodes: [] };
  return {
    x: GRAPH_START_X + (chain.nodes.length * GRAPH_ORDER_STEP),
    y: chainLaneY(chainIndex),
  };
}

function graphDropPoint(event, graphElement) {
  const rect = graphElement?.getBoundingClientRect?.();
  const { clientX, clientY } = eventPoint(event);
  if (!rect) return { x: GRAPH_START_X, y: GRAPH_TOP_Y };
  return {
    x: Math.max(0, Math.round(clientX - rect.left)),
    y: Math.max(0, Math.round(clientY - rect.top)),
  };
}

function dropPlacementForMethod(nodes, method, dropPoint) {
  const chains = chainsFromNodes(nodes);
  const lastLaneY = chains.length > 0 ? chainLaneY(chains.length - 1) : GRAPH_TOP_Y;
  const belowExistingChains = chains.length === 0 || dropPoint.y > lastLaneY + (GRAPH_CHAIN_GAP / 2);
  if (method.id === SOURCE_METHOD_ID || belowExistingChains) {
    return {
      chainId: nextChainId(nodes),
      x: GRAPH_START_X,
      y: chainLaneY(chains.length),
    };
  }

  const closestChain = chains.reduce((best, chain, index) => {
    const laneY = chainLaneY(index);
    const distance = Math.abs(dropPoint.y - laneY);
    return !best || distance < best.distance ? { chain, index, distance } : best;
  }, null);

  return {
    chainId: closestChain?.chain.id || 'chain-1',
    x: Math.max(12, Math.round(dropPoint.x - (GRAPH_NODE_WIDTH / 2))),
    y: chainLaneY(closestChain?.index || 0),
  };
}

function maybeSnapChainId(nodes, dragState, nextY) {
  const draggedNode = nodes.find((node) => node.id === dragState.id);
  if (!draggedNode || draggedNode.method_id === SOURCE_METHOD_ID) return nodeChainId(draggedNode || {});
  const originChainId = dragState.chainId || nodeChainId(draggedNode);
  const chains = chainsFromNodes(nodes);
  let best = null;
  chains.forEach((chain, index) => {
    if (chain.id === originChainId) return;
    const candidateY = chainLaneY(index);
    const distance = Math.abs(candidateY - dragState.nodeY);
    if (distance <= 0) return;
    const progress = Math.abs(nextY - dragState.nodeY) / distance;
    if (progress < GRAPH_CHAIN_SNAP_PROGRESS) return;
    const proximity = Math.abs(nextY - candidateY);
    if (!best || proximity < best.proximity) {
      best = { id: chain.id, proximity };
    }
  });
  return best?.id || originChainId;
}

function imageIdFor(image) {
  return image?.image_id || image?.id || '';
}

function methodAcademicDescription(method) {
  if (!method) return '';
  const base = method.description || method.name || 'This method';
  return `${base}. In the workflow graph, this operator transforms typed image artifacts according to its parameterized contract, enabling reproducible and composable analysis pipelines. Its outputs are explicitly structured for downstream stages, supporting auditability, provenance tracking, and cross-method interoperability.`;
}

function imageLabel(image) {
  const filename = image?.filename || 'Image';
  const side = image?.side ? ` / ${image.side}` : '';
  const slice = image?.slice_index !== null && image?.slice_index !== undefined ? ` / slice ${image.slice_index}` : '';
  return `${filename}${side}${slice}`;
}

function partIdFor(part) {
  return part?.part_id || part?.id || '';
}

function partLabel(part) {
  return part?.display_name || part?.serial_number || 'Part';
}

function imageIdsForPart(inputSource, partId) {
  return (inputSource?.images || [])
    .filter((image) => String(image.part_id || '') === String(partId))
    .map(imageIdFor)
    .filter(Boolean);
}

function eventPoint(event) {
  const clientX = Number.isFinite(event.clientX) ? event.clientX : Number(event.pageX) || 0;
  const clientY = Number.isFinite(event.clientY) ? event.clientY : Number(event.pageY) || 0;
  return { clientX, clientY };
}

function shouldIgnoreMouseFallback(event) {
  return event.type?.startsWith('mouse') && typeof window !== 'undefined' && Boolean(window.PointerEvent);
}

function buildOutputConfig(nodes) {
  const outputNode = nodes.find((node) => node.method_id === OUTPUT_METHOD_ID);
  const params = outputNode?.parameters || {};
  return {
    mode: params.mode || 'processing_sequence',
    version_strategy: params.version_strategy || 'recipe_metadata',
    artifact_policy: params.artifact_policy || 'automatic_by_output_type',
    cache_policy: params.cache_policy || 'local_on_demand',
    invalidation_policy: params.invalidation_policy || 'source_workflow_toolbox_model',
    provenance_level: params.provenance_level || 'full',
    export_policy: params.export_policy || 'materialize_on_export',
    volume_policy: params.volume_policy || 'recipe_volume_sparse_artifacts',
    destination: 'analysis_artifacts',
    preserve_original: params.preserve_original !== false,
    write_detection_metadata: params.write_detection_metadata !== false,
    write_segmentation_overlays: params.write_segmentation_overlays !== false,
    write_measurement_tables: params.write_measurement_tables !== false,
    materialize_processed_images: params.materialize_processed_images === true,
  };
}

function buildRunSource({ inputSource, selectedImageIds, exampleImageId, runScope }) {
  const images = inputSource?.images || [];
  const runImageIds = runScope === 'example'
    ? [exampleImageId].filter(Boolean)
    : selectedImageIds;
  const selectedSet = new Set(runImageIds.map(String));
  const selectedImages = images.filter((image) => selectedSet.has(String(imageIdFor(image))));
  const selectedPartIds = [...new Set(selectedImages.map((image) => image.part_id).filter(Boolean))];
  const allLoaded = images.length > 0 && selectedImages.length === images.length && runScope !== 'example';

  return {
    ...(inputSource?.source || {}),
    id: runScope === 'example' ? 'example-image-selection' : allLoaded ? 'all-loaded-part-images' : 'configured-process-selection',
    label: runScope === 'example' ? 'Chosen example image' : allLoaded ? 'All images from loaded parts' : 'Configured process image set',
    kind: allLoaded ? 'project_parts' : 'manual_selection',
    image_count: selectedImages.length,
    part_count: allLoaded ? (inputSource?.source?.part_count || 0) : selectedPartIds.length,
    selected_image_ids: allLoaded ? [] : runImageIds,
    selected_part_ids: allLoaded ? [] : selectedPartIds,
    example_image_id: exampleImageId || null,
  };
}

function buildWorkflow({ nodes, inputSource, selectedImageIds, exampleImageId, runScope }) {
  return {
    name: DEFAULT_WORKFLOW_NAME,
    source: buildRunSource({ inputSource, selectedImageIds, exampleImageId, runScope }),
    output: buildOutputConfig(nodes),
    nodes,
    edges: chainEdges(nodes),
  };
}

function restoreSavedWorkflow(savedValue, methods, fallbackNodes, inputSource) {
  const loadedImageIds = (inputSource?.images || []).map(imageIdFor).filter(Boolean).map(String);
  const loadedImageSet = new Set(loadedImageIds);
  if (!savedValue || typeof savedValue !== 'object' || !Array.isArray(savedValue.nodes)) {
    return {
      nodes: fallbackNodes,
      processImageIds: loadedImageIds,
      exampleImageId: loadedImageIds[0] || '',
    };
  }
  const methodById = new Map(methods.map((method) => [method.id, method]));
  const restoredNodes = savedValue.nodes
    .filter((node) => node && methodById.has(node.method_id) && node.id)
    .map((node, index) => {
      const method = methodById.get(node.method_id);
      return makeNode(method, index, {
        id: String(node.id),
        label: node.label || method.name,
        chain_id: node.chain_id || 'chain-1',
        parameters: node.parameters && typeof node.parameters === 'object' ? node.parameters : {},
        x: Number.isFinite(node.x) ? node.x : undefined,
        y: Number.isFinite(node.y) ? node.y : undefined,
      });
    });
  const safeNodes = restoredNodes.some((node) => node.method_id === SOURCE_METHOD_ID)
    ? restoredNodes
    : fallbackNodes;
  const savedProcessIds = Array.isArray(savedValue.process_image_ids)
    ? savedValue.process_image_ids.map(String).filter((id) => loadedImageSet.has(id))
    : [];
  const processImageIds = savedProcessIds.length > 0 ? savedProcessIds : loadedImageIds;
  const savedExample = String(savedValue.example_image_id || '');
  return {
    nodes: safeNodes,
    processImageIds,
    exampleImageId: loadedImageSet.has(savedExample) ? savedExample : processImageIds[0] || '',
  };
}

function workflowMetadataValue({ nodes, processImageIds, exampleImageId }) {
  return {
    version: 1,
    name: DEFAULT_WORKFLOW_NAME,
    nodes: nodes.map((node) => ({
      id: node.id,
      method_id: node.method_id,
      label: node.label,
      chain_id: nodeChainId(node),
      parameters: node.parameters || {},
      x: node.x,
      y: node.y,
    })),
    process_image_ids: processImageIds,
    example_image_id: exampleImageId || '',
    updated_at: new Date().toISOString(),
  };
}

function numericParameterStep(parameter) {
  if (parameter?.type === 'integer') return 1;
  if (parameter?.type === 'float' || parameter?.type === 'range') return 0.05;
  return undefined;
}

function clampParameterValue(value, parameter) {
  const min = Number(parameter?.min_value);
  const max = Number(parameter?.max_value);
  let nextValue = value;
  if (Number.isFinite(min)) nextValue = Math.max(min, nextValue);
  if (Number.isFinite(max)) nextValue = Math.min(max, nextValue);
  return nextValue;
}

function roundParameterValue(value) {
  return Number(value.toFixed(4));
}

function wheelIncrementForEvent(event) {
  const magnitude = Math.abs(Number(event.deltaY) || 0);
  return magnitude >= 40 ? 0.05 : 0.01;
}

function ParameterInput({ parameter, value, onChange }) {
  const id = `analyze-param-${parameter.name}`;
  if (parameter.type === 'boolean') {
    return (
      <label className="analyze-switch" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{parameter.label}</span>
      </label>
    );
  }

  if (parameter.type === 'select' && Array.isArray(parameter.options) && parameter.options.length > 0) {
    return (
      <label className="analyze-field" htmlFor={id}>
        <span>{parameter.label}</span>
        <select id={id} value={value || parameter.default || ''} onChange={(event) => onChange(event.target.value)}>
          {parameter.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  const numeric = parameter.type === 'integer' || parameter.type === 'float' || parameter.type === 'range';
  const step = numericParameterStep(parameter);
  const handleWheel = numeric && parameter.type !== 'integer'
    ? (event) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const currentValue = Number.isFinite(Number(value))
        ? Number(value)
        : Number.isFinite(Number(parameter.default))
          ? Number(parameter.default)
          : 0;
      const direction = event.deltaY < 0 ? 1 : -1;
      const increment = wheelIncrementForEvent(event);
      onChange(roundParameterValue(clampParameterValue(currentValue + (direction * increment), parameter)));
    }
    : undefined;
  return (
    <label className="analyze-field" htmlFor={id} onWheel={handleWheel}>
      <span>{parameter.label}</span>
      <input
        id={id}
        type={numeric ? 'number' : 'text'}
        step={step}
        min={parameter.min_value ?? undefined}
        max={parameter.max_value ?? undefined}
        value={value ?? ''}
        onChange={(event) => {
          if (!numeric) {
            onChange(event.target.value);
            return;
          }
          const nextValue = event.target.value === '' ? '' : Number(event.target.value);
          onChange(nextValue);
        }}
      />
    </label>
  );
}

function ExampleImageParameter({ images, value, onChange, inputId = 'analyze-param-example-image' }) {
  return (
    <label className="analyze-field" htmlFor={inputId}>
      <span>Choose Example</span>
      <select
        id={inputId}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">No example selected</option>
        {images.map((image) => {
          const id = imageIdFor(image);
          return <option key={id} value={id}>{imageLabel(image)}</option>;
        })}
      </select>
    </label>
  );
}

function InputSelectionModal({
  inputSource,
  processImageSet,
  availableImages,
  stagedImages,
  exampleImageId,
  onChooseExample,
  onClose,
  onDragStart,
  onDrop,
  onMoveImage,
  onRemoveImage,
  onMovePart,
  onRemovePart,
}) {
  const parts = inputSource?.parts || [];

  const renderImageButton = (image, mode) => {
    const id = imageIdFor(image);
    const inProcess = processImageSet.has(String(id));
    return (
      <div key={`${mode}-${id}`} className="analyze-source-image-row">
        <button
          type="button"
          className="analyze-source-image-name"
          draggable
          onDragStart={(event) => {
            event.dataTransfer?.setData('text/plain', id);
            onDragStart({ type: 'image', id });
          }}
          onClick={() => onChooseExample(id)}
          title="Click to use as the example image, or drag between columns."
        >
          {imageLabel(image)}
        </button>
        <button
          type="button"
          className="btn btn-small btn-secondary"
          onClick={() => (inProcess ? onRemoveImage(id) : onMoveImage(id))}
        >
          {inProcess ? 'Remove' : 'Process'}
        </button>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-content analyze-input-modal" role="dialog" aria-modal="true" aria-labelledby="analyze-input-title">
        <div className="modal-header">
          <div>
            <p className="analyze-eyebrow">Input Source</p>
            <h3 id="analyze-input-title">Loaded Images to Process</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close input source chooser">&times;</button>
        </div>

        <div className="analyze-example-select">
          <ExampleImageParameter
            images={stagedImages.length > 0 ? stagedImages : (inputSource?.images || [])}
            value={exampleImageId}
            onChange={onChooseExample}
            inputId="analyze-param-example-image-modal"
          />
        </div>

        <div className="analyze-source-modal-grid">
          <section
            className="analyze-source-column"
            data-testid="analyze-loaded-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop('loaded')}
          >
            <h4>Loaded</h4>
            <p className="muted">Images available in loaded parts but not currently in the processing set.</p>
            {parts.map((part) => {
              const id = partIdFor(part);
              const partImages = (inputSource?.images || []).filter((image) => String(image.part_id || '') === String(id));
              const availablePartImages = partImages.filter((image) => !processImageSet.has(String(imageIdFor(image))));
              if (availablePartImages.length === 0) return null;
              return (
                <article className="analyze-source-part" key={`loaded-${id}`}>
                  <button
                    type="button"
                    className="analyze-source-part-name"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer?.setData('text/plain', id);
                      onDragStart({ type: 'part', id });
                    }}
                    onClick={() => onMovePart(id)}
                  >
                    {partLabel(part)}
                  </button>
                  <div>{availablePartImages.map((image) => renderImageButton(image, 'loaded'))}</div>
                </article>
              );
            })}
            {availableImages.length === 0 && <p className="muted">All loaded images are in Process.</p>}
          </section>

          <section
            className="analyze-source-column process"
            data-testid="analyze-process-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop('process')}
          >
            <h4>Process</h4>
            <p className="muted">Run Example uses the chosen example. Run uses this full processing set.</p>
            {parts.map((part) => {
              const id = partIdFor(part);
              const partImages = (inputSource?.images || []).filter((image) => String(image.part_id || '') === String(id));
              const processPartImages = partImages.filter((image) => processImageSet.has(String(imageIdFor(image))));
              if (processPartImages.length === 0) return null;
              return (
                <article className="analyze-source-part" key={`process-${id}`}>
                  <button
                    type="button"
                    className="analyze-source-part-name"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer?.setData('text/plain', id);
                      onDragStart({ type: 'part', id });
                    }}
                    onClick={() => onRemovePart(id)}
                  >
                    {partLabel(part)}
                  </button>
                  <div>{processPartImages.map((image) => renderImageButton(image, 'process'))}</div>
                </article>
              );
            })}
            {stagedImages.length === 0 && <p className="muted">Drop loaded images or part names here.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function AnalyzeWorkbenchTab({ projectId, projectType, setError }) {
  const [methods, setMethods] = useState([]);
  const [inputSource, setInputSource] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [processImageIds, setProcessImageIds] = useState([]);
  const [exampleImageId, setExampleImageId] = useState('');
  const [inputModalOpen, setInputModalOpen] = useState(false);
  const [dragPayload, setDragPayload] = useState(null);
  const [graphDrag, setGraphDrag] = useState(null);
  const [workflowStateLoaded, setWorkflowStateLoaded] = useState(false);
  const [status, setStatus] = useState({ loading: true, message: 'Loading analyze workspace...', result: null });
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [toolboxPreview, setToolboxPreview] = useState({ methodId: null, parameters: {} });
  const graphDragRef = useRef(null);
  const graphRef = useRef(null);
  const marqueeRef = useRef(null);
  const suppressNodeClickRef = useRef(null);
  const [marquee, setMarquee] = useState(null);

  const methodById = useMemo(() => new Map(methods.map((method) => [method.id, method])), [methods]);
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
  const loadedImages = useMemo(() => inputSource?.images || [], [inputSource]);
  const processImageSet = useMemo(() => new Set(processImageIds.map(String)), [processImageIds]);
  const stagedImages = useMemo(
    () => loadedImages.filter((image) => processImageSet.has(String(imageIdFor(image)))),
    [loadedImages, processImageSet]
  );
  const availableImages = useMemo(
    () => loadedImages.filter((image) => !processImageSet.has(String(imageIdFor(image)))),
    [loadedImages, processImageSet]
  );
  const outputConfig = useMemo(() => buildOutputConfig(nodes), [nodes]);

  useEffect(() => {
    setCollapsedCategories((previous) => {
      const next = {};
      orderedCategories.forEach(([category]) => {
        next[category] = previous[category] ?? false;
      });
      return next;
    });
  }, [orderedCategories]);

  const toggleCategoryCollapsed = useCallback((category) => {
    setCollapsedCategories((previous) => ({
      ...previous,
      [category]: !previous[category],
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAnalyzeWorkspace() {
      try {
        setStatus({ loading: true, message: 'Loading analyze workspace...', result: null });
        setWorkflowStateLoaded(false);
        const [toolboxResp, inputResp, savedWorkflowResp] = await Promise.all([
          fetch('/api/analyze/toolbox'),
          fetch(`/api/projects/${projectId}/analyze/input-source`),
          fetch(`/api/projects/${projectId}/metadata/${encodeURIComponent(ANALYZE_WORKFLOW_METADATA_KEY)}`),
        ]);
        if (!toolboxResp.ok) throw new Error(`Failed to load toolbox (${toolboxResp.status})`);
        if (!inputResp.ok) throw new Error(`Failed to load analyze inputs (${inputResp.status})`);
        const [toolboxPayload, inputPayload, savedWorkflowPayload] = await Promise.all([
          toolboxResp.json(),
          inputResp.json(),
          savedWorkflowResp.ok ? savedWorkflowResp.json() : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const loadedMethods = Array.isArray(toolboxPayload.methods) ? toolboxPayload.methods : [];
        const defaultNodes = makeDefaultNodes(loadedMethods);
        const restored = restoreSavedWorkflow(savedWorkflowPayload?.value, loadedMethods, defaultNodes, inputPayload);
        setMethods(loadedMethods);
        setInputSource(inputPayload);
        setNodes(restored.nodes);
        setProcessImageIds(restored.processImageIds);
        setExampleImageId(restored.exampleImageId);
        setSelectedNodeId(restored.nodes[1]?.id || restored.nodes[0]?.id || null);
        setWorkflowStateLoaded(true);
        setStatus({
          loading: false,
          message: `${loadedMethods.length} methods ready for ${inputPayload?.source?.image_count || 0} images`,
          result: null,
        });
      } catch (err) {
        const message = err.message || 'Failed to load analyze workspace';
        if (!cancelled) {
          setStatus({ loading: false, message, result: null });
          setWorkflowStateLoaded(true);
          if (setError) setError(message);
        }
      }
    }
    loadAnalyzeWorkspace();
    return () => {
      cancelled = true;
    };
  }, [projectId, setError]);

  useEffect(() => {
    if (!workflowStateLoaded || status.loading || nodes.length === 0) return undefined;
    const saveHandle = setTimeout(async () => {
      try {
        await fetch(`/api/projects/${projectId}/metadata/${encodeURIComponent(ANALYZE_WORKFLOW_METADATA_KEY)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: ANALYZE_WORKFLOW_METADATA_KEY,
            value: workflowMetadataValue({ nodes, processImageIds, exampleImageId }),
          }),
        });
      } catch (_err) {
        // Analyze workflow persistence is best-effort; users can keep editing if the save fails.
      }
    }, 350);
    return () => clearTimeout(saveHandle);
  }, [exampleImageId, nodes, processImageIds, projectId, status.loading, workflowStateLoaded]);

  const selectToolboxMethod = useCallback((method) => {
    setToolboxPreview((previous) => ({
      methodId: method.id,
      parameters: previous.methodId === method.id ? previous.parameters : parameterDefaults(method),
    }));
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
  }, []);

  const clearToolboxPreview = useCallback(() => {
    setToolboxPreview({ methodId: null, parameters: {} });
  }, []);

  const addMethodNode = useCallback((method, dropPoint) => {
    setNodes((prevNodes) => {
      const fallbackChainId = nextChainId(prevNodes);
      const placement = dropPoint
        ? dropPlacementForMethod(prevNodes, method, dropPoint)
        : { chainId: fallbackChainId, ...appendPositionForChain(prevNodes, fallbackChainId) };
      const chainLabel = method.id === SOURCE_METHOD_ID
        ? `Loaded Part Images ${chainsFromNodes(prevNodes).length + 1}`
        : method.name;
      const previewParameters = toolboxPreview.methodId === method.id ? toolboxPreview.parameters : {};
      const nextNode = makeNode(method, prevNodes.length, {
        chain_id: placement.chainId,
        label: chainLabel,
        x: placement.x,
        y: placement.y,
        parameters: previewParameters,
      });
      setSelectedNodeId(nextNode.id);
      setSelectedNodeIds([nextNode.id]);
      setToolboxPreview({ methodId: null, parameters: {} });
      return layoutNodesForChains([...prevNodes, nextNode]);
    });
  }, [toolboxPreview]);

  const updateSelectedParameter = useCallback((name, value) => {
    if (selectedToolboxMethod) {
      setToolboxPreview((previous) => ({
        ...previous,
        parameters: { ...previous.parameters, [name]: value },
      }));
      return;
    }
    if (!selectedNode) return;
    if (selectedNode.method_id === 'source.project_part_images' && name === 'example_image_id') {
      setExampleImageId(value);
    }
    setNodes((prevNodes) => prevNodes.map((node) => (
      node.id === selectedNode.id
        ? { ...node, parameters: { ...node.parameters, [name]: value } }
        : node
    )));
  }, [selectedNode, selectedToolboxMethod]);

  const moveImagesToProcess = useCallback((imageIds) => {
    const ids = imageIds.filter(Boolean).map(String);
    if (ids.length === 0) return;
    setProcessImageIds((prevIds) => [...new Set([...prevIds.map(String), ...ids])]);
    setExampleImageId((prevExample) => prevExample || ids[0] || '');
  }, []);

  const removeImagesFromProcess = useCallback((imageIds) => {
    const removeSet = new Set(imageIds.filter(Boolean).map(String));
    setProcessImageIds((prevIds) => {
      const nextIds = prevIds.filter((id) => !removeSet.has(String(id)));
      setExampleImageId((prevExample) => (
        prevExample && !removeSet.has(String(prevExample)) ? prevExample : nextIds[0] || ''
      ));
      return nextIds;
    });
  }, []);

  const movePartToProcess = useCallback((partId) => {
    moveImagesToProcess(imageIdsForPart(inputSource, partId));
  }, [inputSource, moveImagesToProcess]);

  const removePartFromProcess = useCallback((partId) => {
    removeImagesFromProcess(imageIdsForPart(inputSource, partId));
  }, [inputSource, removeImagesFromProcess]);

  const handleDragStart = useCallback((payload) => {
    setDragPayload(payload);
  }, []);

  const handleDrop = useCallback((target) => {
    if (!dragPayload) return;
    const ids = dragPayload.type === 'part'
      ? imageIdsForPart(inputSource, dragPayload.id)
      : [dragPayload.id];
    if (target === 'process') {
      moveImagesToProcess(ids);
    } else {
      removeImagesFromProcess(ids);
    }
    setDragPayload(null);
  }, [dragPayload, inputSource, moveImagesToProcess, removeImagesFromProcess]);

  const handleNodeClick = useCallback((node, event) => {
    if (suppressNodeClickRef.current === node.id) {
      suppressNodeClickRef.current = null;
      return;
    }
    clearToolboxPreview();
    setSelectedNodeId(node.id);
    setSelectedNodeIds((prev) => (event.ctrlKey || event.metaKey
      ? (prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id])
      : [node.id]));
  }, [clearToolboxPreview]);

  const beginNodeDrag = useCallback((event, node) => {
    if (shouldIgnoreMouseFallback(event)) return;
    if (event.button !== undefined && event.button !== 0) return;
    clearToolboxPreview();
    const { clientX, clientY } = eventPoint(event);
    const dragState = {
      id: node.id,
      chainId: nodeChainId(node),
      startX: clientX,
      startY: clientY,
      nodeX: node.x,
      nodeY: node.y,
      moved: false,
    };
    graphDragRef.current = dragState;
    setGraphDrag(dragState);
    setSelectedNodeId(node.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [clearToolboxPreview]);

  const moveNodeDrag = useCallback((event) => {
    if (shouldIgnoreMouseFallback(event)) return;
    const dragState = graphDragRef.current;
    if (!dragState) return;
    const { clientX, clientY } = eventPoint(event);
    const dx = clientX - dragState.startX;
    const dy = clientY - dragState.startY;
    const moved = dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
    const nextX = Math.max(12, Math.round(dragState.nodeX + dx));
    const nextY = Math.max(12, Math.round(dragState.nodeY + dy));
    const nextDrag = { ...dragState, moved };
    graphDragRef.current = nextDrag;
    setGraphDrag(nextDrag);
    setNodes((prevNodes) => {
      const nextChainIdForNode = moved ? maybeSnapChainId(prevNodes, dragState, nextY) : dragState.chainId;
      const movedNodes = prevNodes.map((node) => (
        node.id === dragState.id ? { ...node, chain_id: nextChainIdForNode, x: nextX, y: nextY } : node
      ));
      return moved ? orderNodesByChains(movedNodes) : movedNodes;
    });
  }, []);

  const endNodeDrag = useCallback((event) => {
    if (shouldIgnoreMouseFallback(event)) return;
    const dragState = graphDragRef.current;
    if (!dragState) return;
    if (dragState.moved) {
      suppressNodeClickRef.current = dragState.id;
      setNodes((prevNodes) => layoutNodesForChains(prevNodes));
    }
    graphDragRef.current = null;
    setGraphDrag(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const removeSelectedNode = useCallback(() => {
    const removeIds = selectedNodeIds.length > 0 ? selectedNodeIds : (selectedNode ? [selectedNode.id] : []);
    if (removeIds.length === 0) return;
    const removeSet = new Set(removeIds);
    setNodes((prevNodes) => {
      const selectedIndex = prevNodes.findIndex((node) => node.id === selectedNodeId);
      const nextNodes = prevNodes.filter((node) => !removeSet.has(node.id));
      const nextSelectedNode = nextNodes[Math.min(selectedIndex, nextNodes.length - 1)] || nextNodes[0] || null;
      setSelectedNodeId(nextSelectedNode?.id || null);
      setSelectedNodeIds(nextSelectedNode ? [nextSelectedNode.id] : []);
      return layoutNodesForChains(nextNodes);
    });
    if (selectedNode && removeSet.has(selectedNode.id) && selectedNode.method_id === 'source.project_part_images') {
      setInputModalOpen(false);
    }
  }, [selectedNode, selectedNodeId, selectedNodeIds]);

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
    const selectedIds = nodes.filter((node) => (
      node.x < bounds.right && node.x + GRAPH_NODE_WIDTH > bounds.left && node.y < bounds.bottom && node.y + GRAPH_NODE_HEIGHT > bounds.top
    )).map((node) => node.id);
    setSelectedNodeIds(selectedIds);
    setSelectedNodeId(selectedIds[selectedIds.length - 1] || null);
  }, [nodes]);

  const endMarqueeSelect = useCallback(() => {
    marqueeRef.current = null;
    setMarquee(null);
  }, []);

  const submitWorkflow = useCallback(async (mode, runScope = 'all') => {
    try {
      const selectedIds = processImageIds.length > 0 ? processImageIds : loadedImages.map(imageIdFor).filter(Boolean);
      const runLabel = runScope === 'example' ? 'example image' : `${selectedIds.length || 0} configured images`;
      setStatus({ loading: true, message: mode === 'execute' ? `Running ${runLabel}...` : 'Validating workflow...', result: null });
      const workflow = buildWorkflow({
        nodes,
        inputSource,
        selectedImageIds: selectedIds,
        exampleImageId,
        runScope,
      });
      const resp = await fetch(`/api/projects/${projectId}/analyze/workflows/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.detail || `Workflow ${mode} failed`);
      setStatus({
        loading: false,
        message: mode === 'execute'
          ? `Workflow execution ${payload.status || 'completed'} for ${runScope === 'example' ? 'the example image' : 'the configured image set'}.`
          : 'Workflow contract validated',
        result: payload,
      });
    } catch (err) {
      const message = err.message || 'Workflow request failed';
      setStatus({ loading: false, message, result: null });
      if (setError) setError(message);
    }
  }, [exampleImageId, inputSource, loadedImages, nodes, processImageIds, projectId, setError]);

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

      <div className="analyze-grid">
        <aside className="analyze-toolbox" aria-label="Analyze toolbox">
          {orderedCategories.map(([category, categoryMethods]) => (
            <section key={category} className="analyze-toolbox-group">
              <button
                type="button"
                className="analyze-toolbox-group-toggle"
                onClick={() => toggleCategoryCollapsed(category)}
                aria-expanded={!collapsedCategories[category]}
              >
                <h3>{category}</h3>
                <span aria-hidden="true">{collapsedCategories[category] ? '+' : '−'}</span>
              </button>
              <div className={`analyze-method-list ${collapsedCategories[category] ? 'collapsed' : ''}`}>
                {categoryMethods.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    className={`analyze-method-button ${selectedToolboxMethod?.id === method.id ? 'selected' : ''}`}
                    aria-pressed={selectedToolboxMethod?.id === method.id}
                    draggable
                    onClick={() => selectToolboxMethod(method)}
                    onDragStart={(event) => {
                      selectToolboxMethod(method);
                      event.dataTransfer.setData('text/x-vista-method-id', method.id);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    title={method.description}
                  >
                    <span>{method.name}</span>
                    <small>{method.output_types.join(' + ')}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <main className="analyze-canvas-panel">
          <div className="analyze-canvas-toolbar">
            <div className="workbench-detail-actions">
              <button type="button" className="btn btn-secondary" disabled={status.loading} onClick={() => submitWorkflow('validate')}>
                Validate
              </button>
              <button type="button" className="btn btn-secondary" disabled={status.loading || !exampleImageId || nodes.length === 0} onClick={() => submitWorkflow('execute', 'example')}>
                Run Example
              </button>
              <button type="button" className="btn btn-primary" disabled={status.loading || nodes.length === 0} onClick={() => submitWorkflow('execute', 'all')}>
                Run
              </button>
            </div>
          </div>

          <div
            className="analyze-graph"
            data-testid="analyze-graph"
            ref={graphRef}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleGraphDrop}
            onPointerDown={beginMarqueeSelect}
            onPointerMove={moveMarqueeSelect}
            onPointerUp={endMarqueeSelect}
            style={{
              '--analyze-graph-width': `${graphBounds.width}px`,
              '--analyze-graph-height': `${graphBounds.height}px`,
            }}
          >
            <div className="analyze-graph-surface">
            <svg
              className="analyze-edges"
              aria-hidden="true"
              width={graphBounds.width}
              height={graphBounds.height}
              viewBox={`0 0 ${graphBounds.width} ${graphBounds.height}`}
            >
              {edges.map((edge, index) => {
                const source = nodes.find((node) => node.id === edge.source_node);
                const target = nodes.find((node) => node.id === edge.target_node);
                if (!source || !target) return null;
                const x1 = source.x + 168;
                const y1 = source.y + 38;
                const x2 = target.x;
                const y2 = target.y + 38;
                const midX = (x1 + x2) / 2;
                return (
                  <path
                    key={`${edge.source_node}-${edge.target_node}-${index}`}
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  />
                );
              })}
            </svg>
            {nodes.map((node, index) => {
              const method = methodById.get(node.method_id);
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`analyze-node ${(selectedNodeIds.includes(node.id) || selectedNodeId === node.id) ? 'selected' : ''} ${graphDrag?.id === node.id ? 'dragging' : ''}`}
                  style={{ left: node.x, top: node.y }}
                  onPointerDown={(event) => beginNodeDrag(event, node)}
                  onPointerMove={moveNodeDrag}
                  onPointerUp={endNodeDrag}
                  onPointerCancel={endNodeDrag}
                  onMouseDown={(event) => beginNodeDrag(event, node)}
                  onMouseMove={moveNodeDrag}
                  onMouseUp={endNodeDrag}
                  onMouseLeave={endNodeDrag}
                  onClick={(event) => handleNodeClick(node, event)}
                  aria-label={`Workflow block ${node.label}`}
                  title="Drag to reposition this workflow block"
                >
                  <span className="analyze-node-index">{index + 1}</span>
                  <strong>{node.label}</strong>
                  <small>{method?.category || 'Method'}</small>
                </button>
              );
            })}
            {marquee && <div className="analyze-selection-box" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
            </div>
          </div>
        </main>

        <aside className="analyze-inspector" aria-label="Workflow block settings">
          <div className="analyze-inspector-header">
            <h3>{selectedNode?.label || selectedToolboxMethod?.name || 'No block selected'}</h3>
            <p>{selectedMethod?.id || 'Select a workflow block'}</p>
            {selectedMethod && <p className="muted">{methodAcademicDescription(selectedMethod)}</p>}
          </div>
          {selectedMethod && (
            <div className="analyze-parameters">
              {selectedNode && selectedMethod.id === 'source.project_part_images' && (
                <div className="analyze-input-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setInputModalOpen(true)}>
                    Select Images
                  </button>
                  <span>{stagedImages.length} images in Process</span>
                </div>
              )}
              {(selectedMethod.parameters || []).length === 0 && <p className="muted">No parameters</p>}
              {(selectedMethod.parameters || []).map((parameter) => {
                if (selectedNode && selectedMethod.id === 'source.project_part_images' && parameter.name === 'example_image_id') {
                  return (
                    <ExampleImageParameter
                      key={parameter.name}
                      images={stagedImages.length > 0 ? stagedImages : loadedImages}
                      value={exampleImageId}
                      onChange={(value) => updateSelectedParameter(parameter.name, value)}
                      inputId="analyze-param-example-image-inspector"
                    />
                  );
                }
                return (
                  <ParameterInput
                    key={parameter.name}
                    parameter={parameter}
                    value={selectedParameterValues?.[parameter.name]}
                    onChange={(value) => updateSelectedParameter(parameter.name, value)}
                  />
                );
              })}
            </div>
          )}
          {selectedMethod?.id === OUTPUT_METHOD_ID && (
            <div className="analyze-output-note">
              <strong>Recipe-first output</strong>
              <p>
                Originals are preserved. Detection boxes are stored as metadata, segmentation outputs as overlay artifacts,
                and processed image versions as reproducible sequences with an on-demand cache.
                {' '}
                <code>{outputConfig.version_strategy}</code>
              </p>
              <span>{outputConfig.mode}</span>
            </div>
          )}
          <div className="analyze-status-panel">
            <strong>{status.loading ? 'Working' : 'Status'}</strong>
            <p>{status.message}</p>
            {status.result && (
              <div className="analyze-run-summary" data-testid="analyze-run-summary">
                <span>{status.result.status}</span>
                <span>{status.result.node_results?.length || 0} blocks</span>
                <span>{status.result.image_count || 0} images</span>
              </div>
            )}
          </div>
          {selectedNode && (
            <div className="analyze-block-actions">
              <button type="button" className="btn btn-danger" onClick={removeSelectedNode}>
                Remove {selectedNodeIds.length > 1 ? `(${selectedNodeIds.length})` : ''}
              </button>
            </div>
          )}
        </aside>
      </div>
      {inputModalOpen && (
        <InputSelectionModal
          inputSource={inputSource}
          processImageSet={processImageSet}
          availableImages={availableImages}
          stagedImages={stagedImages}
          exampleImageId={exampleImageId}
          onChooseExample={(value) => {
            setExampleImageId(value);
            setNodes((prevNodes) => prevNodes.map((node) => (
              node.method_id === 'source.project_part_images'
                ? { ...node, parameters: { ...node.parameters, example_image_id: value } }
                : node
            )));
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
