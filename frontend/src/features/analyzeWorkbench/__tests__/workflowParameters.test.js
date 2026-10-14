import {
  clampParameterValue,
  nodesWithDefaultCheckpoints,
  normalizeWorkflowNodes,
  parametersWithDefaultCheckpoint,
} from '../workflowParameters';
import { METHODS, PREPROCESS, YOLO } from '../__fixtures__/analyzeMethods';

const methodById = new Map(METHODS.map((method) => [method.id, method]));
const CHECKPOINTS = [
  { id: 'other', model_family: 'yolo', filename: 'custom.pt' },
  { id: 'named', model_family: 'yolo', filename: 'yolo11n-seg.pt' },
  { id: 'ots-yolo11n-seg', model_family: 'yolo', filename: 'yolo11n-seg.pt' },
];

describe('parameter normalization', () => {
  it('drops hidden parameters and leaves unknown methods untouched', () => {
    const nodes = [{ id: 'n', method_id: 'unknown', parameters: { keep: 1 } }];
    expect(normalizeWorkflowNodes(nodes, methodById)[0].parameters).toEqual({ keep: 1 });
  });

  it('injects the preferred default checkpoint for checkpoint-backed methods', () => {
    const checkpoints = CHECKPOINTS;
    expect(parametersWithDefaultCheckpoint({}, YOLO.id, checkpoints)).toEqual({ checkpoint_id: 'ots-yolo11n-seg' });
    expect(parametersWithDefaultCheckpoint({}, YOLO.id, checkpoints.slice(0, 2))).toEqual({ checkpoint_id: 'named' });
    expect(parametersWithDefaultCheckpoint({ checkpoint_id: 'x' }, YOLO.id, checkpoints)).toEqual({ checkpoint_id: 'x' });
    expect(parametersWithDefaultCheckpoint({}, PREPROCESS.id, checkpoints)).toEqual({});
  });

  it('fills missing checkpoints on nodes and keeps identity when nothing changes', () => {
    const nodes = [{ id: 'y', method_id: YOLO.id, parameters: {} }, { id: 'p', method_id: PREPROCESS.id, parameters: {} }];
    const filled = nodesWithDefaultCheckpoints(nodes, CHECKPOINTS);
    expect(filled[0].parameters).toEqual({ checkpoint_id: 'ots-yolo11n-seg' });
    expect(filled[1]).toBe(nodes[1]);
    expect(nodesWithDefaultCheckpoints(filled, CHECKPOINTS)).toBe(filled);
    expect(nodesWithDefaultCheckpoints(nodes, [])).toBe(nodes);
  });

  it('clamps numeric values only against finite bounds', () => {
    expect(clampParameterValue(5, { min_value: 0, max_value: 1 })).toBe(1);
    expect(clampParameterValue(-5, { min_value: 0 })).toBe(0);
    expect(clampParameterValue(42, {})).toBe(42);
  });
});
