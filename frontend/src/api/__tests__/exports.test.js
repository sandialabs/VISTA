import {
  fetchProjectExportBundleArchiveResponse,
  fetchProjectExportBundleSummary,
  estimateProjectExportBundle,
  exportProjectBundleToS3,
  fetchProjectExcelExportResponse,
  fetchProjectReport,
  fetchProjectReportPdfResponse,
  fetchProjectReportWithImagesPdfResponse,
  fetchProjectExportBundleResponse,
  importProjectBundle,
  importProjectBundleFromS3,
} from '../exports';

describe('export API helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('fetches a project export bundle summary with an encoded project id', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ bundle_summary: { images: 1 } }),
    }));

    await expect(fetchProjectExportBundleSummary('project 1')).resolves.toEqual({ bundle_summary: { images: 1 } });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/export-bundle-json', {});
  });

  test('fetches a v3 project report by default', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ schema_version: 3 }),
    }));

    await expect(fetchProjectReport('project 1')).resolves.toEqual({ schema_version: 3 });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/report-json?schema_version=3', {});
  });

  test('throws ApiError with status and payload when a report fetch fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Project not found' }),
    }));

    await expect(fetchProjectReport('project 1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      payload: { detail: 'Project not found' },
    });
  });

  test('fetches a raw export bundle archive response', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectExportBundleArchiveResponse('project 1')).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/export-bundle');
  });

  test('estimates and downloads export bundles with option query parameters', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve({
      ...response,
      json: async () => ({ estimated_bytes: 12 }),
    }));

    await expect(estimateProjectExportBundle('project 1', { include_images: true, include_overlays: false }))
      .resolves.toEqual({ estimated_bytes: 12 });
    await fetchProjectExportBundleResponse('project 1', { include_images: true, include_overlays: false });

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/project%201/export-bundle/estimate?include_images=true&include_overlays=false',
      '/api/projects/project%201/export-bundle?include_images=true&include_overlays=false',
    ]);
  });

  test('imports project bundles with form data', async () => {
    const formData = new FormData();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ project: { images_created: 1 } }),
    }));

    await expect(importProjectBundle('project 1', formData)).resolves.toEqual({ project: { images_created: 1 } });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/import', {
      method: 'POST',
      body: formData,
    });
  });

  test('exports and imports project bundles through S3', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ s3_url: 's3://bucket/project.vistabundle' }),
    }));

    await exportProjectBundleToS3('project 1', { s3_url: 's3://bucket/project.vistabundle' });
    await importProjectBundleFromS3('project 1', { s3_url: 's3://bucket/project.vistabundle' });

    expect(global.fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(global.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [
        '/api/projects/project%201/export-bundle/s3',
        'POST',
        JSON.stringify({ s3_url: 's3://bucket/project.vistabundle' }),
      ],
      [
        '/api/projects/project%201/import/s3',
        'POST',
        JSON.stringify({ s3_url: 's3://bucket/project.vistabundle' }),
      ],
    ]);
  });

  test('fetches raw PDF report responses', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectReportPdfResponse('project 1')).resolves.toBe(response);
    await expect(fetchProjectReportWithImagesPdfResponse('project 1')).resolves.toBe(response);

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/project%201/report-pdf?schema_version=3',
      '/api/projects/project%201/report-with-images-pdf',
    ]);
  });

  test('fetches a raw Excel export response', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectExcelExportResponse('project 1')).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/export-excel');
  });

  test('supports raw Excel export request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchProjectExcelExportResponse('project/id', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/export-excel',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
