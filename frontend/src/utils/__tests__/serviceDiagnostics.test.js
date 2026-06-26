import {
  diagnoseBackendServices,
  formatServiceDiagnosticReport,
  probeService,
} from '../serviceDiagnostics';

describe('serviceDiagnostics', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test('probeService returns success payload', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });
    const result = await probeService('/api/health', 'API health', 1000);
    expect(result).toMatchObject({
      label: 'API health',
      url: '/api/health',
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  test('probeService reports timeout for abort errors', async () => {
    fetch.mockRejectedValueOnce({ name: 'AbortError' });
    const result = await probeService('/api/slow', 'Slow service', 12);
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain('Timed out after 12ms');
  });

  test('diagnoseBackendServices includes project probe when projectId exists', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const results = await diagnoseBackendServices('proj-7');
    expect(results).toHaveLength(3);
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj-7/configuration', expect.any(Object));
  });

  test('formatServiceDiagnosticReport handles empty and populated diagnostics', () => {
    expect(formatServiceDiagnosticReport([])).toContain('no probes were run');
    const output = formatServiceDiagnosticReport([
      { label: 'API health', ok: true, url: '/api/health', status: 200, statusText: 'OK', elapsedMs: 14 },
      { label: 'Projects list', ok: false, url: '/api/projects/', status: null, error: 'Request failed', elapsedMs: 44 },
    ]);
    expect(output).toContain('API health: responded at /api/health (200 OK, 14ms)');
    expect(output).toContain('Projects list: no response at /api/projects/ (Request failed, 44ms)');
  });
});
