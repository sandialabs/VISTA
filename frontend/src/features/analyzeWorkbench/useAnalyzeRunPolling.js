import { useCallback, useRef } from 'react';
import { fetchAnalyzeRunResponse, stopAnalyzeRun } from '../../api/analyses';
import { remoteJobDetailNodes } from './runDiagnostics';
import { parseWorkflowResponse, shortResponseExcerpt, workflowRequestError } from './workflowResponse';

// Polls an Analyze run until it completes, fails, or is aborted, reporting
// progress through setStatus using the same shape the workflow submit flow uses.
export default function useAnalyzeRunPolling(projectId, setStatus) {
  const activeRunRef = useRef(null);

  const pollAnalyzeRun = useCallback(async (runId, controller) => {
    while (!controller.signal.aborted) {
      const resp = await fetchAnalyzeRunResponse(projectId, runId, { signal: controller.signal });
      const { payload, text } = await parseWorkflowResponse(resp);
      if (!resp.ok) throw new Error(workflowRequestError('status', resp, payload, text));
      if (!payload) throw new Error(`Analyze run status returned invalid JSON: ${shortResponseExcerpt(text) || 'empty response'}`);
      const remoteDetails = remoteJobDetailNodes(payload.remote_jobs);
      if (payload.status === 'running' || payload.status === 'stopping') {
        const latestJob = Array.isArray(payload.remote_jobs) ? payload.remote_jobs[payload.remote_jobs.length - 1] : null;
        const latestTail = Array.isArray(latestJob?.log_tail) && latestJob.log_tail.length > 0
          ? ` Latest remote log: ${latestJob.log_tail[latestJob.log_tail.length - 1]}`
          : '';
        setStatus({
          loading: true,
          message: `Analyze run ${payload.status}.${latestTail}`,
          result: remoteDetails.length > 0
            ? { status: payload.status, image_count: 0, node_results: remoteDetails }
            : null,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      if (payload.result) {
        const mergedResult = remoteDetails.length > 0 && !payload.result.node_results?.some((node) => node.summary?.fastapi_diagnostics)
          ? { ...payload.result, node_results: [...(payload.result.node_results || []), ...remoteDetails] }
          : payload.result;
        setStatus({
          loading: false,
          message: `Workflow execution ${payload.result.status || payload.status || 'completed'} for the example image.`,
          result: mergedResult,
        });
        return;
      }
      throw new Error(payload.error || `Analyze run ${payload.status || 'failed'}`);
    }
  }, [projectId, setStatus]);

  const stopWorkflow = useCallback(async () => {
    const activeRun = activeRunRef.current;
    if (!activeRun) return;
    activeRun.controller.abort();
    setStatus({ loading: false, message: 'Stopping Analyze run...', result: null });
    try {
      await stopAnalyzeRun(projectId, activeRun.runId);
      setStatus({ loading: false, message: 'Analyze run stopped.', result: null });
    } catch (err) {
      setStatus({ loading: false, message: err.message || 'Analyze stop request failed', result: null });
    } finally {
      activeRunRef.current = null;
    }
  }, [projectId, setStatus]);

  return { activeRunRef, pollAnalyzeRun, stopWorkflow };
}
