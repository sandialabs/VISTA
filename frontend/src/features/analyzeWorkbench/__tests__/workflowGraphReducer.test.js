import { initialWorkflowGraphState, workflowGraphReducer } from '../workflowGraphReducer';
import { makeDefaultNodes } from '../workflowGraph';
import { METHODS, SOURCE, YOLO } from '../__fixtures__/analyzeMethods';

function run(state, ...actions) {
  return actions.reduce(workflowGraphReducer, state);
}

const restored = run(initialWorkflowGraphState, { type: 'restore', nodes: makeDefaultNodes(METHODS) });

describe('workflowGraphReducer', () => {
  it('restores nodes and selects the second node', () => {
    expect(restored.nodes).toHaveLength(4);
    expect(restored.selectedNodeId).toBe('preprocess.window_level_normalization-2');
  });

  it('adds dropped nodes, lays out chains, and selects the new node', () => {
    const state = run(restored, { type: 'addNode', method: YOLO, dropPoint: { x: 400, y: 90 }, parameters: { checkpoint_id: 'c' } });
    const added = state.nodes.find((node) => node.id === state.selectedNodeId);
    expect(added).toMatchObject({ id: 'segmentation.yolo.placeholder-5', chain_id: 'chain-1', x: 520, parameters: { checkpoint_id: 'c' } });
    expect(state.selectedNodeIds).toEqual([added.id]);
    const sourced = run(restored, { type: 'addNode', method: SOURCE, parameters: {} });
    expect(sourced.nodes[sourced.nodes.length - 1]).toMatchObject({ label: 'Loaded Part Images 2', chain_id: 'chain-2', x: 72, y: 236 });
  });

  it('drags a node to another lane, re-lays out on drop, and suppresses the trailing click', () => {
    const twoChains = run(restored, { type: 'addNode', method: SOURCE, parameters: {} });
    const dragged = twoChains.nodes[1];
    const point = { clientX: 300, clientY: 100 };
    const moving = run(twoChains,
      { type: 'startDrag', node: dragged, point },
      { type: 'moveDrag', point: { clientX: 310, clientY: 100 + 150 } });
    expect(moving.drag.moved).toBe(true);
    expect(moving.nodes.find((node) => node.id === dragged.id)).toMatchObject({ chain_id: 'chain-2', y: 234 });
    const dropped = run(moving, { type: 'endDrag' });
    expect(dropped.drag).toBeNull();
    expect(dropped.nodes.find((node) => node.id === dragged.id)).toMatchObject({ chain_id: 'chain-2', x: 296, y: 236 });
    const clicked = run(dropped, { type: 'clickNode', id: dragged.id, toggle: false });
    expect(clicked.suppressClickId).toBeNull();
    expect(clicked.selectedNodeIds).toEqual(dropped.selectedNodeIds);
  });

  it('ignores sub-threshold moves and leaves layout untouched on release', () => {
    const node = restored.nodes[2];
    const state = run(restored,
      { type: 'startDrag', node, point: { clientX: 0, clientY: 0 } },
      { type: 'moveDrag', point: { clientX: 2, clientY: 1 } },
      { type: 'endDrag' });
    expect(state.nodes.find((item) => item.id === node.id)).toMatchObject({ x: node.x + 2, y: node.y + 1 });
    expect(state.suppressClickId).toBeNull();
  });

  it('toggles selection, removes nodes, and selects the node at the same index', () => {
    const [, second, third] = restored.nodes;
    const multi = run(restored,
      { type: 'clickNode', id: second.id, toggle: false },
      { type: 'clickNode', id: third.id, toggle: true });
    expect(multi.selectedNodeIds).toEqual([second.id, third.id]);
    expect(run(multi, { type: 'clickNode', id: third.id, toggle: true }).selectedNodeIds).toEqual([second.id]);
    const removed = run(multi, { type: 'removeNodes', ids: multi.selectedNodeIds });
    expect(removed.nodes.map((node) => node.x)).toEqual([72, 296]);
    expect(removed.selectedNodeIds).toEqual([removed.nodes[1].id]);
  });

  it('updates parameters and the source example image', () => {
    const state = run(restored,
      { type: 'updateParameter', nodeId: restored.nodes[1].id, name: 'level', value: 0.25 },
      { type: 'setSourceExample', value: 'img-9' });
    expect(state.nodes[1].parameters.level).toBe(0.25);
    expect(state.nodes[0].parameters.example_image_id).toBe('img-9');
    expect(run(state, { type: 'applyDefaultCheckpoints', checkpoints: [] })).toBe(state);
    expect(run(state, { type: 'unknown' })).toBe(state);
  });

  it('selects nodes by marquee ids and clears selection', () => {
    const state = run(restored, { type: 'selectNodes', ids: ['a', 'b'] });
    expect(state).toMatchObject({ selectedNodeIds: ['a', 'b'], selectedNodeId: 'b' });
    expect(run(state, { type: 'clearSelection' })).toMatchObject({ selectedNodeIds: [], selectedNodeId: null });
  });
});
