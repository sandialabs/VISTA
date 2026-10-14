import {
  advanceNodeDrag,
  createMethodNode,
  layoutNodesForChains,
  moveDraggedNode,
  removeGraphNodes,
  SOURCE_METHOD_ID,
  startNodeDrag,
} from './workflowGraph';
import { nodesWithDefaultCheckpoints } from './workflowParameters';

// Workflow graph state: the node list, the selection, the active node drag, and the
// id of a node whose trailing click should be ignored because it just finished a drag.
export const initialWorkflowGraphState = {
  nodes: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  drag: null,
  suppressClickId: null,
};

function mapNodes(state, mapper) {
  return { ...state, nodes: state.nodes.map(mapper) };
}

function withParameter(node, name, value) {
  return { ...node, parameters: { ...node.parameters, [name]: value } };
}

function addNode(state, { method, dropPoint, parameters }) {
  const node = createMethodNode(state.nodes, method, dropPoint, parameters);
  return {
    ...state,
    nodes: layoutNodesForChains([...state.nodes, node]),
    selectedNodeId: node.id,
    selectedNodeIds: [node.id],
  };
}

function removeNodes(state, { ids }) {
  if (ids.length === 0) return state;
  const { nodes, nextSelectedId } = removeGraphNodes(state.nodes, ids, state.selectedNodeId);
  return {
    ...state,
    nodes,
    selectedNodeId: nextSelectedId,
    selectedNodeIds: nextSelectedId ? [nextSelectedId] : [],
  };
}

function clickNode(state, { id, toggle }) {
  if (state.suppressClickId === id) return { ...state, suppressClickId: null };
  const { selectedNodeIds } = state;
  const nextIds = toggle
    ? (selectedNodeIds.includes(id) ? selectedNodeIds.filter((item) => item !== id) : [...selectedNodeIds, id])
    : [id];
  return { ...state, selectedNodeId: id, selectedNodeIds: nextIds };
}

function moveDrag(state, { point }) {
  if (!state.drag) return state;
  const { drag, x, y } = advanceNodeDrag(state.drag, point);
  return { ...state, drag, nodes: moveDraggedNode(state.nodes, drag, x, y) };
}

function endDrag(state) {
  if (!state.drag) return state;
  if (!state.drag.moved) return { ...state, drag: null };
  return {
    ...state,
    drag: null,
    nodes: layoutNodesForChains(state.nodes),
    suppressClickId: state.drag.id,
  };
}

function applyDefaultCheckpoints(state, { checkpoints }) {
  const nodes = nodesWithDefaultCheckpoints(state.nodes, checkpoints);
  return nodes === state.nodes ? state : { ...state, nodes };
}

const handlers = {
  restore: (state, { nodes }) => ({ ...state, nodes, selectedNodeId: nodes[1]?.id || nodes[0]?.id || null }),
  addNode,
  removeNodes,
  updateParameter: (state, { nodeId, name, value }) => mapNodes(state, (node) => (
    node.id === nodeId ? withParameter(node, name, value) : node
  )),
  setSourceExample: (state, { value }) => mapNodes(state, (node) => (
    node.method_id === SOURCE_METHOD_ID ? withParameter(node, 'example_image_id', value) : node
  )),
  applyDefaultCheckpoints,
  clickNode,
  selectNodes: (state, { ids }) => ({ ...state, selectedNodeIds: ids, selectedNodeId: ids[ids.length - 1] || null }),
  clearSelection: (state) => ({ ...state, selectedNodeId: null, selectedNodeIds: [] }),
  startDrag: (state, { node, point }) => ({ ...state, drag: startNodeDrag(node, point), selectedNodeId: node.id }),
  moveDrag,
  endDrag,
};

export function workflowGraphReducer(state, action) {
  const handler = handlers[action.type];
  return handler ? handler(state, action) : state;
}
