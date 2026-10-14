import {
  fastapiChecklistItems,
  nodeDiagnosticRows,
  remoteJobDetailNodes,
  statusDetailNodes,
  statusProgressResult,
  workflowHasRemoteFastapi,
} from '../runDiagnostics';

const REMOTE_JOB = {
  job_id: 'job-7',
  remote_status: 'completed',
  uploaded_outputs: ['mask.png'],
  status_probe_http_status: 200,
  return_code: 0,
  log_count: 2,
  log_tail: ['a', 'b'],
};

describe('run diagnostics', () => {
  it('builds diagnostic rows for local and FastAPI node summaries', () => {
    expect(nodeDiagnosticRows({ summary: { backend: 'opencv', detection_count: 0, detection_classes: ['a', 'b'], detections: [{ x: 1 }] } }))
      .toEqual([['Backend', 'opencv'], ['Detections', '0'], ['Classes', 'a | b'], ['First detection', '{"x":1}']]);
    const [remote] = remoteJobDetailNodes([REMOTE_JOB]);
    expect(nodeDiagnosticRows(remote)).toEqual([
      ['Connected', 'yes'], ['Attempted execution', 'yes'], ['Result returned', 'yes'], ['Overlay ready', 'yes'],
      ['Poll HTTP status', '200'], ['Job ID', 'job-7'], ['Job status', 'completed'], ['Return code', '0'],
      ['Remote log lines', '2'], ['Log tail', 'a | b'],
    ]);
    expect(remote).toMatchObject({ node_id: 'job-7', method_id: 'remote_fastapi_job', message: 'Remote FastAPI job job-7 is completed.' });
    expect(remoteJobDetailNodes(null)).toEqual([]);
  });

  it('selects failed, warning, or detecting nodes for status details', () => {
    const nodes = [{ status: 'ok' }, { status: 'failed' }, { summary: { runtime_warning: 'w' } }, { summary: { segment_count: 2 } }];
    expect(statusDetailNodes({ node_results: nodes })).toEqual(nodes.slice(1));
    expect(workflowHasRemoteFastapi([{ method_id: 'segmentation.fastapi.remote' }])).toBe(true);
    expect(workflowHasRemoteFastapi([{ method_id: 'x' }])).toBe(false);
  });

  it('derives the FastAPI checklist from the latest diagnostics', () => {
    const result = { node_results: remoteJobDetailNodes([REMOTE_JOB]) };
    expect(fastapiChecklistItems({ loading: false, result })).toEqual([
      { label: 'Sent', state: 'done', detail: 'Waiting' },
      { label: 'Received', state: 'done', detail: 'Job job-7' },
      { label: 'Responding', state: 'done', detail: 'HTTP 200' },
      { label: 'Processing', state: 'done', detail: 'completed, 2 logs' },
      { label: 'Files', state: 'done', detail: 'Uploaded' },
      { label: 'Overlay', state: 'done', detail: 'Check Inspection' },
    ]);
    expect(fastapiChecklistItems({ result: { node_results: [] } })).toEqual([]);
  });

  it('synthesizes a starting result while a remote run is pending', () => {
    expect(statusProgressResult({ loading: false, result: 'r' })).toBe('r');
    expect(statusProgressResult({ loading: true, message: 'Saving' })).toBeNull();
    const pending = statusProgressResult({ loading: true, message: 'VISTA received the request' });
    expect(pending.node_results[0].summary.fastapi_diagnostics.remote_job_status).toBe('starting');
    expect(fastapiChecklistItems({ loading: true, result: pending }).map((item) => item.state))
      .toEqual(['done', 'pending', 'pending', 'active', 'pending', 'pending']);
  });
});
