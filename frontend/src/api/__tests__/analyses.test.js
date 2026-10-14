import {
  deleteAnalysisOverlay,
  diagnoseAnalyzeCheckpointResponse,
  fetchAnalyzeInputSource,
  fetchAnalyzeCheckpointGraphResponse,
  fetchAnalyzeCheckpoints,
  fetchAnalyzeRunResponse,
  fetchAnalyzeToolbox,
  fetchAnalysisDetails,
  fetchAnalysisExportResponse,
  fetchImageAnalyses,
  fetchRecentlyDeletedAnalysisOverlays,
  restoreAnalysisOverlay,
  runAnalyzeWorkflowResponse,
  startAnalyzeWorkflowResponse,
  stopAnalyzeRun,
  uploadAnalyzeCheckpointResponse,
} from '../analyses';

describe('analysis API helpers', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('fetches image analyses', async () => {
    await expect(fetchImageAnalyses('image 1')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201/analyses', {});
  });

  test('fetches analysis details', async () => {
    await expect(fetchAnalysisDetails('analysis 1')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/analyses/analysis%201', {});
  });

  test('throws ApiError with status and payload when analysis details fail', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Analysis not found' }),
    }));

    await expect(fetchAnalysisDetails('analysis 1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      payload: { detail: 'Analysis not found' },
    });
  });

  test('fetches recently deleted analysis overlays', async () => {
    await fetchRecentlyDeletedAnalysisOverlays('project 1');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%201/analyze/overlays/recently-deleted',
      expect.any(Object),
    );
  });

  test('restores analysis overlays', async () => {
    await expect(restoreAnalysisOverlay('project 1', 'overlay/1')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%201/analyze/overlays/overlay%2F1/restore',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('deletes analysis overlays and returns null for no-content responses', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204 }));

    await expect(deleteAnalysisOverlay('project/id', 'overlay/id')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/analyze/overlays/overlay%2Fid',
      { method: 'DELETE' },
    );
  });

  test('guards analysis overlay deletion when read-only', async () => {
    global.fetch = jest.fn();

    await expect(deleteAnalysisOverlay('project/id', 'overlay/id', { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fetches analysis exports as a raw response', async () => {
    const response = { ok: true };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchAnalysisExportResponse('analysis 1', 'csv')).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/analyses/analysis%201/export?format=csv');
  });

  test('returns parsed checkpoints and a raw checkpoint graph response', async () => {
    const graphResponse = { ok: true, status: 200 };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'checkpoint/id' }] })
      .mockResolvedValueOnce(graphResponse);

    await expect(fetchAnalyzeCheckpoints('project/id', 'authorized')).resolves.toEqual([{ id: 'checkpoint/id' }]);
    await expect(fetchAnalyzeCheckpointGraphResponse('project/id', 'checkpoint/id')).resolves.toBe(graphResponse);

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/project%2Fid/analyze/checkpoints?scope=authorized',
      '/api/projects/project%2Fid/analyze/checkpoints/checkpoint%2Fid/graph',
    ]);
  });

  test('supports checkpoint request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchAnalyzeCheckpoints('project/id', 'authorized', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/analyze/checkpoints?scope=authorized',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('returns parsed analyze toolbox and input-source responses', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ methods: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ images: [] }) });

    await expect(fetchAnalyzeToolbox()).resolves.toEqual({ methods: [] });
    await expect(fetchAnalyzeInputSource('project/id')).resolves.toEqual({ images: [] });

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/analyze/toolbox',
      '/api/projects/project%2Fid/analyze/input-source',
    ]);
  });

  test('returns raw checkpoint form upload responses', async () => {
    const response = { ok: true, status: 200 };
    const formData = new FormData();
    formData.append('file', new File(['checkpoint'], 'model.pt'));
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(diagnoseAnalyzeCheckpointResponse('project/id', formData)).resolves.toBe(response);
    await expect(uploadAnalyzeCheckpointResponse('project/id', formData)).resolves.toBe(response);

    expect(global.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/projects/project%2Fid/analyze/checkpoints/diagnose', 'POST', formData],
      ['/api/projects/project%2Fid/analyze/checkpoints', 'POST', formData],
    ]);
  });

  test('returns a raw analyze run status response and a parsed stop response', async () => {
    const runResponse = { ok: true, status: 200 };
    global.fetch = jest.fn()
      .mockResolvedValueOnce(runResponse)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'stopping' }) });

    await expect(fetchAnalyzeRunResponse('project/id', 'run/id')).resolves.toBe(runResponse);
    await expect(stopAnalyzeRun('project/id', 'run/id')).resolves.toEqual({ status: 'stopping' });

    expect(global.fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/projects/project%2Fid/analyze/runs/run%2Fid', undefined],
      ['/api/projects/project%2Fid/analyze/runs/run%2Fid/stop', 'POST'],
    ]);
  });

  test('returns raw analyze workflow submission responses', async () => {
    const response = { ok: true, status: 200 };
    const workflow = { nodes: [{ id: 'node-1' }] };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(runAnalyzeWorkflowResponse('project/id', 'validate', workflow, 'run/id')).resolves.toBe(response);
    await expect(startAnalyzeWorkflowResponse('project/id', workflow, 'run/id')).resolves.toBe(response);

    expect(global.fetch.mock.calls.map(([url, init]) => [url, init.method, init.headers['X-Analyze-Run-Id'], init.body])).toEqual([
      ['/api/projects/project%2Fid/analyze/workflows/validate', 'POST', 'run/id', JSON.stringify(workflow)],
      ['/api/projects/project%2Fid/analyze/workflows/start', 'POST', 'run/id', JSON.stringify(workflow)],
    ]);
  });
});
