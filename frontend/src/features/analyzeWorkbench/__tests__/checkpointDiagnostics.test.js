import {
  checkpointLabel,
  checkpointStatusText,
  formatParameterCount,
  graphRows,
} from '../checkpointDiagnostics';

describe('checkpoint diagnostics helpers', () => {
  it('formats parameter counts', () => {
    expect([0, 'x', 999, 1500, 2_500_000, 3_210_000_000].map(formatParameterCount))
      .toEqual(['Unknown', 'Unknown', '999', '1.5K', '2.50M', '3.21B']);
  });

  it('labels checkpoints with type, version, and size', () => {
    expect(checkpointLabel(null)).toBe('');
    expect(checkpointLabel({ filename: 'm.pt', model_family: 'yolo', size_bytes: 2048 }))
      .toMatch(/^m\.pt \(yolo, .+\)$/);
    expect(checkpointLabel({ filename: 'm.pt', model_type: 'YOLO11', model_version: 'v2', size_bytes: 0 }))
      .toMatch(/^m\.pt \(YOLO11, v2, .+\)$/);
  });

  it('summarizes checkpoint call status, defaults, and family counts', () => {
    const state = {
      requested: true,
      project: [{ model_family: 'yolo' }, { model_family: 'sam' }, {}],
      authorized: [],
      projectDiagnostics: { default_yolo_file_present: true, default_yolo_registered: false, default_anomalib_file_present: false },
    };
    expect(checkpointStatusText(state, 'project')).toBe(
      'Checkpoint status: /analyze/checkpoints ok; default YOLO file present, not registered; '
      + 'default Anomalib file missing, registration unknown; project 3 total, yolo 1, sam 1, anomalib 0, other 1; '
      + 'authorized 0 total, yolo 0, sam 0, anomalib 0, other 0; active project.'
    );
    expect(checkpointStatusText({ loading: true }, 'authorized')).toContain('/analyze/checkpoints loading;');
    expect(checkpointStatusText({ error: 'boom' }, 'authorized')).toContain('/analyze/checkpoints error: boom;');
  });

  it('keeps graph rows in source order', () => {
    const graph = { nodes: [{ id: 'b', path: 'b', depth: 1, parent: 'a' }, { id: 'a', path: 'a', depth: 0 }] };
    expect(graphRows(graph).map((row) => [row.id, row.order])).toEqual([['b', 0], ['a', 1]]);
    expect(graphRows(null)).toEqual([]);
  });
});
