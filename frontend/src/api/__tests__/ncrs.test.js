import {
  approvePartNcr,
  createPartNcr,
  deletePartNcr,
  fetchPartNcr,
  fetchPartNcrs,
  fetchProjectNcrs,
  updatePartNcr,
} from '../ncrs';

function okJson(body, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body });
}

describe('NCR API helpers', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('builds encoded paths for each endpoint', async () => {
    global.fetch = jest.fn(() => okJson({ ncrs: [] }));
    await fetchProjectNcrs('proj 1');
    await fetchPartNcrs('proj 1', 'part/1');
    await fetchPartNcr('proj 1', 'part/1', 'ncr 1');
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/proj%201/ncrs',
      '/api/projects/proj%201/parts/part%2F1/ncrs',
      '/api/projects/proj%201/parts/part%2F1/ncrs/ncr%201',
    ]);
  });

  test('create, update, and approve send JSON bodies', async () => {
    global.fetch = jest.fn(() => okJson({ id: 'n1' }));
    await createPartNcr('p', 'part', { comment: 'c' });
    await updatePartNcr('p', 'part', 'n1', { comment: 'd', expected_version: 2 });
    await approvePartNcr('p', 'part', 'n1', 3);
    await approvePartNcr('p', 'part', 'n1');
    const calls = global.fetch.mock.calls;
    expect(calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', body: '{"comment":"c"}' }));
    expect(calls[1][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: '{"comment":"d","expected_version":2}' }));
    expect(calls[2][0]).toBe('/api/projects/p/parts/part/ncrs/n1/approve');
    expect(calls[2][1]).toEqual(expect.objectContaining({ method: 'POST', body: '{"expected_version":3}' }));
    expect(calls[3][1].body).toBe('{}');
    expect(calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  test('delete passes the expected version as a query parameter', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204, json: async () => null }));
    await expect(deletePartNcr('p', 'part', 'n1', 4)).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/p/parts/part/ncrs/n1?expected_version=4',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('read-only mode blocks writes without calling fetch', async () => {
    global.fetch = jest.fn();
    await expect(createPartNcr('p', 'part', {}, { readOnly: true })).rejects.toMatchObject({ name: 'ReadOnlyError' });
    await expect(approvePartNcr('p', 'part', 'n1', 1, { readOnly: true })).rejects.toMatchObject({ name: 'ReadOnlyError' });
    await expect(deletePartNcr('p', 'part', 'n1', 1, { readOnly: true })).rejects.toMatchObject({ name: 'ReadOnlyError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('HTTP errors carry status and server detail', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 422,
      json: async () => ({ detail: "Failure code 'X' is not configured" }),
    }));
    await expect(createPartNcr('p', 'part', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      payload: { detail: "Failure code 'X' is not configured" },
    });
  });
});
