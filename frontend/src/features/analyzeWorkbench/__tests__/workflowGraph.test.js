import {
  appendPositionForChain,
  chainEdges,
  dropPlacementForMethod,
  graphDropPoint,
  layoutNodesForChains,
  makeDefaultNodes,
  makeNode,
  maybeSnapChainId,
  nextChainId,
  orderNodesByChains,
} from '../workflowGraph';
import { METHODS, OUTPUT, PREPROCESS, SOURCE, YOLO, node } from '../__fixtures__/analyzeMethods';

const MULTI_CHAIN = [
  node('b2', 'chain-2', 500, 260),
  node('a2', 'chain-1', 400, 90),
  { ...node('a1', 'chain-1', 900, 80, SOURCE.id) },
  node('b1', 'chain-2', 100, 240),
  node('c1', 'chain-7', 50, 20),
];

describe('workflow graph layout', () => {
  it('lays out chains ordered by top-most node, source first within each chain', () => {
    const positions = layoutNodesForChains(MULTI_CHAIN).map(({ id, chain_id: chainId, x, y }) => [id, chainId, x, y]);
    expect(positions).toEqual([
      ['c1', 'chain-7', 72, 84],
      ['a1', 'chain-1', 72, 236],
      ['a2', 'chain-1', 296, 236],
      ['b1', 'chain-2', 72, 388],
      ['b2', 'chain-2', 296, 388],
    ]);
  });

  it('orders nodes by chain without moving them and builds chain edges', () => {
    expect(orderNodesByChains(MULTI_CHAIN).map((item) => [item.id, item.x])).toEqual([
      ['c1', 50], ['a1', 900], ['a2', 400], ['b1', 100], ['b2', 500],
    ]);
    expect(chainEdges(MULTI_CHAIN)).toEqual([
      { source_node: 'a1', target_node: 'a2', source_port: 'output', target_port: 'input' },
      { source_node: 'b1', target_node: 'b2', source_port: 'output', target_port: 'input' },
    ]);
  });

  it('defaults a missing chain id to chain-1 and computes the next chain id', () => {
    const nodes = [{ ...node('x', undefined, 0, 0) }, node('y', 'chain-4', 0, 200), node('z', 'custom', 0, 300)];
    expect(layoutNodesForChains(nodes)[0].chain_id).toBe('chain-1');
    expect(nextChainId(nodes)).toBe('chain-5');
    expect(nextChainId([])).toBe('chain-1');
  });

  it('appends positions at the end of an existing chain or on a new lane', () => {
    const laid = layoutNodesForChains(MULTI_CHAIN);
    expect(appendPositionForChain(laid, 'chain-1')).toEqual({ x: 520, y: 236 });
    expect(appendPositionForChain(laid, 'chain-9')).toEqual({ x: 72, y: 540 });
  });
});

describe('drop placement', () => {
  const laid = layoutNodesForChains([node('a', 'chain-1', 0, 84), node('b', 'chain-2', 0, 236)]);

  it('starts a new chain for drops on an empty graph or below the last lane', () => {
    expect(dropPlacementForMethod([], PREPROCESS, { x: 300, y: 10 })).toEqual({ chainId: 'chain-1', x: 72, y: 84 });
    expect(dropPlacementForMethod(laid, PREPROCESS, { x: 300, y: 313 })).toEqual({ chainId: 'chain-3', x: 72, y: 388 });
  });

  it('always starts a new chain for source methods', () => {
    expect(dropPlacementForMethod(laid, SOURCE, { x: 300, y: 90 })).toEqual({ chainId: 'chain-3', x: 72, y: 388 });
  });

  it('joins the closest lane and centers the node on the drop point', () => {
    expect(dropPlacementForMethod(laid, PREPROCESS, { x: 300, y: 312 })).toEqual({ chainId: 'chain-2', x: 216, y: 236 });
    expect(dropPlacementForMethod(laid, YOLO, { x: 40, y: 150 })).toEqual({ chainId: 'chain-1', x: 12, y: 84 });
  });

  it('converts client coordinates into graph coordinates', () => {
    const element = { getBoundingClientRect: () => ({ left: 100, top: 50 }) };
    expect(graphDropPoint({ clientX: 250.4, clientY: 40 }, element)).toEqual({ x: 150, y: 0 });
    expect(graphDropPoint({ pageX: 130, pageY: 90 }, element)).toEqual({ x: 30, y: 40 });
    expect(graphDropPoint({ clientX: 1, clientY: 1 }, null)).toEqual({ x: 72, y: 84 });
  });
});

describe('chain snapping', () => {
  const laid = layoutNodesForChains([
    node('a', 'chain-1', 0, 84),
    node('b', 'chain-2', 0, 236),
    node('c', 'chain-3', 0, 388),
  ]);
  const drag = { id: 'a', chainId: 'chain-1', nodeY: 84 };

  it('keeps the origin chain until 80 percent of the lane distance is covered', () => {
    expect(maybeSnapChainId(laid, drag, 84 + 121)).toBe('chain-1');
    expect(maybeSnapChainId(laid, drag, 84 + 122)).toBe('chain-2');
  });

  it('picks the nearest qualifying lane', () => {
    expect(maybeSnapChainId(laid, drag, 380)).toBe('chain-3');
    expect(maybeSnapChainId(laid, drag, 300)).toBe('chain-2');
  });

  it('never re-chains source nodes or unknown nodes', () => {
    const withSource = laid.map((item) => (item.id === 'a' ? { ...item, method_id: SOURCE.id } : item));
    expect(maybeSnapChainId(withSource, drag, 380)).toBe('chain-1');
    expect(maybeSnapChainId(laid, { ...drag, id: 'missing' }, 380)).toBe('chain-1');
  });
});

describe('node creation', () => {
  it('builds nodes with sanitized ids and default parameters', () => {
    expect(makeNode(PREPROCESS, 2, { chain_id: 'chain-2' })).toEqual({
      id: 'preprocess.window_level_normalization-3',
      method_id: PREPROCESS.id,
      label: 'Window Level',
      chain_id: 'chain-2',
      parameters: { level: 0.5, iterations: 3 },
      x: 422,
      y: 84,
    });
    expect(makeNode({ ...OUTPUT, id: 'a b/c' }, 0).id).toBe('a-b-c-1');
  });

  it('creates the default pipeline from available methods', () => {
    const nodes = makeDefaultNodes(METHODS);
    expect(nodes.map(({ id, label, x, y }) => [id, label, x, y])).toEqual([
      ['input-source', 'Loaded Part Images', 72, 84],
      ['preprocess.window_level_normalization-2', 'Window Level', 296, 84],
      ['segmentation.yolo.placeholder-3', 'YOLO Segmentation', 520, 84],
      ['output.versioned_image_artifact-4', 'Versioned Output', 744, 84],
    ]);
    expect(nodes[2].parameters).toEqual({ integration_mode: 'local', checkpoint_id: '' });
  });
});
