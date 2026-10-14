import { apiFetch, encodePathSegment } from '../api/client';

const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 2500;

function getDiagnosticTimeoutMs() {
  if (typeof window !== 'undefined' && Number.isFinite(Number(window.__VISTA_SERVICE_DIAGNOSTIC_TIMEOUT_MS))) {
    return Number(window.__VISTA_SERVICE_DIAGNOSTIC_TIMEOUT_MS);
  }
  return DEFAULT_DIAGNOSTIC_TIMEOUT_MS;
}

export async function probeService(url, label, timeoutMs = getDiagnosticTimeoutMs()) {
  const startedAt = Date.now();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = window.setTimeout(() => {
    if (controller) controller.abort();
  }, timeoutMs);

  try {
    const response = await apiFetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller?.signal,
    });
    return {
      label,
      url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      label,
      url,
      ok: false,
      status: null,
      error: error.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : (error.message || 'Request failed'),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function diagnoseBackendServices(projectId) {
  const probes = [
    { label: 'API health', url: '/api/health' },
    { label: 'Projects list (Postgres)', url: '/api/projects/' },
  ];

  if (projectId) {
    probes.push({
      label: 'Project configuration (Postgres)',
      url: `/api/projects/${encodePathSegment(projectId)}/configuration`,
    });
  }

  return Promise.all(probes.map((probe) => probeService(probe.url, probe.label)));
}

export function formatServiceDiagnosticReport(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 'Backend service diagnostics: no probes were run.';
  }

  const lines = results.map((result) => {
    if (result.status !== null && result.status !== undefined) {
      const statusText = result.statusText ? ` ${result.statusText}` : '';
      return `${result.label}: ${result.ok ? 'responded' : 'error'} at ${result.url} (${result.status}${statusText}, ${result.elapsedMs}ms)`;
    }
    return `${result.label}: no response at ${result.url} (${result.error}, ${result.elapsedMs}ms)`;
  });
  return `Backend service diagnostics:\n${lines.join('\n')}`;
}

export async function buildErrorWithServiceDiagnostics(message, projectId) {
  const diagnostics = await diagnoseBackendServices(projectId);
  return `${message}\n\n${formatServiceDiagnosticReport(diagnostics)}`;
}

