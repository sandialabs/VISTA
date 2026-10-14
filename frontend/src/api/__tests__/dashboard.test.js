import {
  acceptDashboardDatabaseUrl,
  exportDashboardBackupResponse,
  exportDashboardBackupToS3,
  fetchDashboardDatabaseUrl,
  fetchDashboardVersion,
  importDashboardBackupFromS3,
  importDashboardBackup,
  previewDashboardDatabaseUrl,
  previewDashboardImport,
} from '../dashboard';

describe('dashboard API helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('exports a raw dashboard backup response with default content options', async () => {
    const response = { ok: true, status: 200 };
    const dashboardState = { gallery_state: {} };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(exportDashboardBackupResponse(dashboardState)).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/dashboard/export', expect.objectContaining({
      method: 'POST',
    }));
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload).toEqual(expect.objectContaining({
      include_images: true,
      include_overlays: true,
      include_metadata: true,
      include_created_overlays: true,
      include_project_configuration: true,
      include_ui_state: true,
      dashboard_state: dashboardState,
    }));
  });

  test('exports a dashboard backup to S3', async () => {
    const dashboardState = { gallery_state: { one: { page: 2 } } };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ s3_url: 's3://bucket/dashboard.vistabundle' }),
    }));

    await expect(exportDashboardBackupToS3('s3://bucket/dashboard.vistabundle', dashboardState))
      .resolves.toEqual({ s3_url: 's3://bucket/dashboard.vistabundle' });

    expect(global.fetch).toHaveBeenCalledWith('/api/dashboard/export/s3', expect.any(Object));
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.s3_url).toBe('s3://bucket/dashboard.vistabundle');
    expect(payload.dashboard_state).toEqual(dashboardState);
  });

  test('imports a dashboard backup from S3 using restore-as-new defaults', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ project_count: 2 }),
    }));

    await expect(importDashboardBackupFromS3('s3://bucket/dashboard.vistabundle'))
      .resolves.toEqual({ project_count: 2 });

    expect(global.fetch).toHaveBeenCalledWith('/api/dashboard/import/s3', expect.any(Object));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      s3_url: 's3://bucket/dashboard.vistabundle',
      mode: 'restore_as_new',
      confirmation: 'IMPORT',
    });
  });

  test('returns parsed file import preview and import responses', async () => {
    const formData = new FormData();
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ projects: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ project_count: 1 }) });

    await expect(previewDashboardImport(formData)).resolves.toEqual({ projects: [] });
    await expect(importDashboardBackup(formData)).resolves.toEqual({ project_count: 1 });

    // FormData bodies keep the browser-generated multipart Content-Type.
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/dashboard/import/preview', {
      method: 'POST',
      body: formData,
    });
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/dashboard/import', {
      method: 'POST',
      body: formData,
    });
  });

  test('throws ApiError with status and payload when a dashboard import fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'Invalid bundle' }),
    }));

    await expect(importDashboardBackup(new FormData())).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      payload: { detail: 'Invalid bundle' },
    });
  });

  test('supports dashboard import preview timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    const formData = new FormData();
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(previewDashboardImport(formData, { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dashboard/import/preview',
      expect.objectContaining({
        method: 'POST',
        body: formData,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('loads dashboard settings values', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ gitlab_commit_sha: 'abc123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ database_url: 'postgresql://db' }),
      });

    await expect(fetchDashboardVersion()).resolves.toEqual({ gitlab_commit_sha: 'abc123' });
    await expect(fetchDashboardDatabaseUrl()).resolves.toEqual({ database_url: 'postgresql://db' });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/dashboard/settings/version', {});
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/dashboard/settings/database-url', {});
  });

  test('posts dashboard database preview and accept payloads', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ database_url: 'postgresql://next' }),
    }));

    await expect(previewDashboardDatabaseUrl('postgresql://next')).resolves.toEqual({ database_url: 'postgresql://next' });
    await expect(acceptDashboardDatabaseUrl('postgresql://next')).resolves.toEqual({ database_url: 'postgresql://next' });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/dashboard/settings/database-url/preview',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/dashboard/settings/database-url/accept',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ database_url: 'postgresql://next' });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ database_url: 'postgresql://next' });
  });
});
