import {
  fetchCurrentUser,
  fetchCurrentUserGroups,
  fetchOptionalCurrentUser,
} from '../users';

describe('user API helpers', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('fetches the current user', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ email: 'user@example.com' }),
    }));

    await expect(fetchCurrentUser()).resolves.toEqual({ email: 'user@example.com' });

    expect(global.fetch).toHaveBeenCalledWith('/api/users/me', expect.any(Object));
  });

  test('returns null for optional current user when unauthorized', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 401,
    }));

    await expect(fetchOptionalCurrentUser()).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith('/api/users/me', {});
  });

  test('rethrows non-401 optional current user failures as ApiError', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'boom' }),
    }));

    await expect(fetchOptionalCurrentUser()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      payload: { detail: 'boom' },
    });
  });

  test('fetches optional current user with request options', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ email: 'optional@example.com' }),
    }));

    await expect(fetchOptionalCurrentUser({ signal: controller.signal })).resolves.toEqual({ email: 'optional@example.com' });

    expect(global.fetch).toHaveBeenCalledWith('/api/users/me', { signal: controller.signal });
  });

  test('fetches current user groups', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ['group-a'],
    }));

    await expect(fetchCurrentUserGroups()).resolves.toEqual(['group-a']);

    expect(global.fetch).toHaveBeenCalledWith('/api/users/me/groups', expect.any(Object));
  });
});
