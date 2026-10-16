import { apiFetch, apiJson, encodePathSegment } from './client';

export function fetchImageAnalyses(imageId, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/analyses`, options);
}

export function fetchAnalysisDetails(analysisId, options = {}) {
  return apiJson(`/api/analyses/${encodePathSegment(analysisId)}`, options);
}

export function fetchRecentlyDeletedAnalysisOverlays(projectId, options = {}) {
  return apiJson(
    `/api/projects/${encodePathSegment(projectId)}/analyze/overlays/recently-deleted`,
    options,
  );
}

export function restoreAnalysisOverlay(projectId, overlayId, options = {}) {
  return apiJson(
    `/api/projects/${encodePathSegment(projectId)}/analyze/overlays/${encodePathSegment(overlayId)}/restore`,
    {
      ...options,
      method: 'POST',
    },
  );
}

export function deleteAnalysisOverlay(projectId, overlayId, options = {}) {
  return apiJson(
    `/api/projects/${encodePathSegment(projectId)}/analyze/overlays/${encodePathSegment(overlayId)}`,
    {
      ...options,
      method: 'DELETE',
    },
  );
}

// Raw Response: callers read Content-Disposition and the export blob.
export function fetchAnalysisExportResponse(analysisId, format = 'json', options = {}) {
  const query = new URLSearchParams({ format });
  const path = `/api/analyses/${encodePathSegment(analysisId)}/export?${query.toString()}`;
  return apiFetch(path, options);
}

function projectAnalyzePath(projectId, suffix) {
  return `/api/projects/${encodePathSegment(projectId)}/analyze${suffix}`;
}

export function fetchAnalyzeCheckpoints(projectId, scope = 'project', options = {}) {
  const query = new URLSearchParams({ scope });
  return apiJson(projectAnalyzePath(projectId, `/checkpoints?${query.toString()}`), options);
}

// The remaining raw Response helpers feed workflowRequestError in the Analyze
// workbench, which reports proxy headers and non-JSON body excerpts on failure.
export function fetchAnalyzeCheckpointGraphResponse(projectId, checkpointId, options = {}) {
  const path = projectAnalyzePath(projectId, `/checkpoints/${encodePathSegment(checkpointId)}/graph`);
  return apiFetch(path, options);
}

export function fetchAnalyzeToolbox(options = {}) {
  return apiJson('/api/analyze/toolbox', options);
}

export function fetchAnalyzeInputSource(projectId, options = {}) {
  return apiJson(projectAnalyzePath(projectId, '/input-source'), options);
}

export function diagnoseAnalyzeCheckpointResponse(projectId, formData, options = {}) {
  return apiFetch(projectAnalyzePath(projectId, '/checkpoints/diagnose'), {
    ...options,
    method: 'POST',
    body: formData,
  });
}

export function uploadAnalyzeCheckpointResponse(projectId, formData, options = {}) {
  return apiFetch(projectAnalyzePath(projectId, '/checkpoints'), {
    ...options,
    method: 'POST',
    body: formData,
  });
}

export function fetchAnalyzeRunResponse(projectId, runId, options = {}) {
  const path = projectAnalyzePath(projectId, `/runs/${encodePathSegment(runId)}`);
  return apiFetch(path, options);
}

export function stopAnalyzeRun(projectId, runId, options = {}) {
  return apiJson(projectAnalyzePath(projectId, `/runs/${encodePathSegment(runId)}/stop`), {
    ...options,
    method: 'POST',
  });
}

function workflowRequestOptions(workflow, runId, options = {}) {
  return {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Analyze-Run-Id': runId,
      ...(options.headers || {}),
    },
    body: JSON.stringify(workflow),
  };
}

export function runAnalyzeWorkflowResponse(projectId, mode, workflow, runId, options = {}) {
  return apiFetch(
    projectAnalyzePath(projectId, `/workflows/${encodePathSegment(mode)}`),
    workflowRequestOptions(workflow, runId, options),
  );
}

export function startAnalyzeWorkflowResponse(projectId, workflow, runId, options = {}) {
  return apiFetch(
    projectAnalyzePath(projectId, '/workflows/start'),
    workflowRequestOptions(workflow, runId, options),
  );
}
