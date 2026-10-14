import { apiFetch, apiJson, encodePathSegment, fetchWithReadOnlyGuard } from '../client';

describe('api client', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('encodes path segments consistently', () => {
    expect(encodePathSegment('project id/with spaces')).toBe('project%20id%2Fwith%20spaces');
  });

  test('passes allowed read-only requests through to fetch', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchWithReadOnlyGuard(true, '/api/example', { method: 'GET' })).resolves.toBe(response);
    await expect(fetchWithReadOnlyGuard(true, '/api/example', { method: 'HEAD' })).resolves.toBe(response);

    expect(global.fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/example', 'GET'],
      ['/api/example', 'HEAD'],
    ]);
  });

  test('rejects write requests when read-only', async () => {
    global.fetch = jest.fn();

    await expect(fetchWithReadOnlyGuard(true, '/api/example', { method: 'POST' })).rejects.toMatchObject({
      name: 'ReadOnlyError',
      message: 'Inspection workbench is read-only.',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('passes write requests through when editable', async () => {
    const response = { ok: true, status: 204 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchWithReadOnlyGuard(false, '/api/example', { method: 'POST' })).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/example', { method: 'POST' });
  });

  test('applies timeout handling after read-only guard passes', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchWithReadOnlyGuard(false, '/api/example', { method: 'POST', timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith('/api/example', expect.objectContaining({ method: 'POST' }));
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('passes raw fetch responses through', async () => {
    const response = { ok: true, status: 202 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(apiFetch('/api/raw', { method: 'POST' })).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/raw', { method: 'POST' });
  });

  test('adds JSON content type when a body is provided', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    await expect(apiJson('/api/example', {
      method: 'POST',
      body: JSON.stringify({ name: 'example' }),
    })).resolves.toEqual({ ok: true });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  test('does not overwrite an explicit content type', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    await apiJson('/api/example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ name: 'example' }),
    });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/merge-patch+json' });
  });

  test('returns null for empty successful responses', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 204,
    }));

    await expect(apiJson('/api/no-content')).resolves.toBeNull();
  });

  test('formats failed HTTP responses with attempted URL and request id', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: (name) => (name.toLowerCase() === 'x-request-id' ? 'req-123' : '') },
      clone: () => ({
        json: async () => ({ detail: 'database unavailable' }),
      }),
    };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(apiJson('/api/projects/', { method: 'GET' })).rejects.toThrow(
      'Request failed (500 Internal Server Error) | attempted=GET /api/projects/ | request_id=req-123 | details=database unavailable'
    );
  });

  test('clears timeout after a fetch rejection', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(apiJson('/api/projects/', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('clears timeout after a raw fetch rejection', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(apiFetch('/api/projects/', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
