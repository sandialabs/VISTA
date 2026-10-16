import { createApiKey, deleteApiKey, fetchApiKeys } from '../apiKeys';

describe('API key helpers', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('fetches API keys', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [{ id: 'key-1' }],
    }));

    await expect(fetchApiKeys()).resolves.toEqual([{ id: 'key-1' }]);

    expect(global.fetch).toHaveBeenCalledWith('/api/api-keys', expect.any(Object));
  });

  test('creates an API key with a JSON name payload', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ key: 'secret', api_key: { id: 'key-1', name: 'automation' } }),
    }));

    await expect(createApiKey('automation')).resolves.toEqual({
      key: 'secret',
      api_key: { id: 'key-1', name: 'automation' },
    });

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/api-keys', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(init.body)).toEqual({ name: 'automation' });
  });

  test('deletes an API key with an encoded id', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 204,
    }));

    await expect(deleteApiKey('key/id')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith('/api/api-keys/key%2Fid', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});
