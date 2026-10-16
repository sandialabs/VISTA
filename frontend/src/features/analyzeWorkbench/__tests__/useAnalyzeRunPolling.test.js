import { act, renderHook } from '@testing-library/react';

import { fetchAnalyzeRunResponse, stopAnalyzeRun } from '../../../api/analyses';
import useAnalyzeRunPolling from '../useAnalyzeRunPolling';

jest.mock('../../../api/analyses', () => ({
  fetchAnalyzeRunResponse: jest.fn(),
  stopAnalyzeRun: jest.fn(),
}));

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(payload),
  };
}

describe('useAnalyzeRunPolling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports the completed result and stops polling', async () => {
    fetchAnalyzeRunResponse.mockResolvedValueOnce(jsonResponse({
      status: 'completed',
      result: { status: 'completed', node_results: [] },
    }));
    const setStatus = jest.fn();
    const { result } = renderHook(() => useAnalyzeRunPolling('project-1', setStatus));

    await act(async () => {
      await result.current.pollAnalyzeRun('run-1', new AbortController());
    });

    expect(fetchAnalyzeRunResponse).toHaveBeenCalledTimes(1);
    expect(fetchAnalyzeRunResponse).toHaveBeenCalledWith('project-1', 'run-1', expect.objectContaining({ signal: expect.anything() }));
    expect(setStatus).toHaveBeenLastCalledWith({
      loading: false,
      message: 'Workflow execution completed for the example image.',
      result: { status: 'completed', node_results: [] },
    });
  });

  it('does not poll when the controller is already aborted', async () => {
    const setStatus = jest.fn();
    const { result } = renderHook(() => useAnalyzeRunPolling('project-1', setStatus));
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await result.current.pollAnalyzeRun('run-1', controller);
    });

    expect(fetchAnalyzeRunResponse).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('aborts the active run, requests a stop, and clears the active run', async () => {
    stopAnalyzeRun.mockResolvedValueOnce({ ok: true });
    const setStatus = jest.fn();
    const { result } = renderHook(() => useAnalyzeRunPolling('project-1', setStatus));
    const controller = new AbortController();
    result.current.activeRunRef.current = { runId: 'run-7', controller };

    await act(async () => {
      await result.current.stopWorkflow();
    });

    expect(controller.signal.aborted).toBe(true);
    expect(stopAnalyzeRun).toHaveBeenCalledWith('project-1', 'run-7');
    expect(setStatus.mock.calls.map(([status]) => status.message)).toEqual([
      'Stopping Analyze run...',
      'Analyze run stopped.',
    ]);
    expect(result.current.activeRunRef.current).toBeNull();
  });

  it('does nothing when no run is active', async () => {
    const setStatus = jest.fn();
    const { result } = renderHook(() => useAnalyzeRunPolling('project-1', setStatus));

    await act(async () => {
      await result.current.stopWorkflow();
    });

    expect(stopAnalyzeRun).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
