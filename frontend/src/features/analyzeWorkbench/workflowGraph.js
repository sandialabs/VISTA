import { parameterDefaults } from './workflowParameters';

export const SOURCE_METHOD_ID = 'source.project_part_images';
export const OUTPUT_METHOD_ID = 'output.versioned_image_artifact';
export const GRAPH_NODE_WIDTH = 168;
const GRAPH_START_X = 72;
const GRAPH_TOP_Y = 84;
const GRAPH_CHAIN_GAP = 152;
const GRAPH_ORDER_STEP = GRAPH_NODE_WIDTH + 56;
const GRAPH_CHAIN_SNAP_PROGRESS = 0.8;
export const GRAPH_NODE_HEIGHT = 76;

export function makeNode(method, index, overrides = {}) {
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

export function makeDefaultNodes(methods) {
  const preferred = [
    SOURCE_METHOD_ID,
    'preprocess.window_level_normalization',
    'segmentation.yolo.placeholder',
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

export function nodeChainId(node) {
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

export function chainsFromNodes(nodes) {
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

export function chainEdges(nodes) {
  return chainsFromNodes(nodes).flatMap((chain) => (
    chain.nodes.slice(1).map((node, index) => ({
      source_node: chain.nodes[index].id,
      target_node: node.id,
      source_port: 'output',
      target_port: 'input',
    }))
  ));
}

export function orderNodesByChains(nodes) {
  return chainsFromNodes(nodes).flatMap((chain) => chain.nodes);
}

export function layoutNodesForChains(nodes) {
  return chainsFromNodes(nodes).flatMap((chain, chainIndex) => (
    chain.nodes.map((node, nodeIndex) => ({
      ...node,
      chain_id: chain.id,
      x: GRAPH_START_X + (nodeIndex * GRAPH_ORDER_STEP),
      y: chainLaneY(chainIndex),
    }))
  ));
}

export function nextChainId(nodes) {
  const highest = nodes.reduce((value, node) => {
    const match = /^chain-(\d+)$/.exec(nodeChainId(node));
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `chain-${highest + 1}`;
}

export function appendPositionForChain(nodes, chainId) {
  const chains = chainsFromNodes(nodes);
  const existingIndex = chains.findIndex((chain) => chain.id === chainId);
  const chainIndex = existingIndex >= 0 ? existingIndex : chains.length;
  const chain = existingIndex >= 0 ? chains[existingIndex] : { nodes: [] };
  return {
    x: GRAPH_START_X + (chain.nodes.length * GRAPH_ORDER_STEP),
    y: chainLaneY(chainIndex),
  };
}

export function eventPoint(event) {
  const clientX = Number.isFinite(event.clientX) ? event.clientX : Number(event.pageX) || 0;
  const clientY = Number.isFinite(event.clientY) ? event.clientY : Number(event.pageY) || 0;
  return { clientX, clientY };
}

export function graphDropPoint(event, graphElement) {
  const rect = graphElement?.getBoundingClientRect?.();
  const { clientX, clientY } = eventPoint(event);
  if (!rect) return { x: GRAPH_START_X, y: GRAPH_TOP_Y };
  return {
    x: Math.max(0, Math.round(clientX - rect.left)),
    y: Math.max(0, Math.round(clientY - rect.top)),
  };
}

export function dropPlacementForMethod(nodes, method, dropPoint) {
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

export function maybeSnapChainId(nodes, dragState, nextY) {
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

// Creates the node a toolbox drop (or click, when dropPoint is absent) adds to the graph.
export function createMethodNode(nodes, method, dropPoint, parameters) {
  const fallbackChainId = nextChainId(nodes);
  const placement = dropPoint
    ? dropPlacementForMethod(nodes, method, dropPoint)
    : { chainId: fallbackChainId, ...appendPositionForChain(nodes, fallbackChainId) };
  const label = method.id === SOURCE_METHOD_ID
    ? `Loaded Part Images ${chainsFromNodes(nodes).length + 1}`
    : method.name;
  return makeNode(method, nodes.length, {
    chain_id: placement.chainId,
    label,
    x: placement.x,
    y: placement.y,
    parameters,
  });
}

export function startNodeDrag(node, point) {
  return {
    id: node.id,
    chainId: nodeChainId(node),
    startX: point.clientX,
    startY: point.clientY,
    nodeX: node.x,
    nodeY: node.y,
    moved: false,
  };
}

// Moves past a 2px threshold mark the drag as moved; positions never go above/left of 12px.
export function advanceNodeDrag(dragState, point) {
  const dx = point.clientX - dragState.startX;
  const dy = point.clientY - dragState.startY;
  return {
    drag: { ...dragState, moved: dragState.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2 },
    x: Math.max(12, Math.round(dragState.nodeX + dx)),
    y: Math.max(12, Math.round(dragState.nodeY + dy)),
  };
}

export function moveDraggedNode(nodes, dragState, x, y) {
  const chainId = dragState.moved ? maybeSnapChainId(nodes, dragState, y) : dragState.chainId;
  const movedNodes = nodes.map((node) => (
    node.id === dragState.id ? { ...node, chain_id: chainId, x, y } : node
  ));
  return dragState.moved ? orderNodesByChains(movedNodes) : movedNodes;
}

// Removes nodes and picks the node now at the previously selected index as the next selection.
export function removeGraphNodes(nodes, removeIds, selectedNodeId) {
  const removeSet = new Set(removeIds);
  const selectedIndex = nodes.findIndex((node) => node.id === selectedNodeId);
  const remaining = nodes.filter((node) => !removeSet.has(node.id));
  const nextSelected = remaining[Math.min(selectedIndex, remaining.length - 1)] || remaining[0] || null;
  return { nodes: layoutNodesForChains(remaining), nextSelectedId: nextSelected?.id || null };
}

export function nodeIdsWithinBounds(nodes, bounds) {
  return nodes.filter((node) => (
    node.x < bounds.right
    && node.x + GRAPH_NODE_WIDTH > bounds.left
    && node.y < bounds.bottom
    && node.y + GRAPH_NODE_HEIGHT > bounds.top
  )).map((node) => node.id);
}
