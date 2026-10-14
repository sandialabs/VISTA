import {
  assignImagesToGroup,
  deleteGroup,
  fetchGroup,
  fetchProjectGroups,
  fetchProjectUngroupedCount,
  removeImagesFromGroup,
} from '../groups';

describe('group API helpers', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('fetches group details', async () => {
    await fetchGroup('group 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/groups/group%201', expect.any(Object));
  });

  test('fetches project groups with query params', async () => {
    await fetchProjectGroups('project 1', {
      limit: 200,
      skip: 0,
      search: 'serial 1',
      empty: '',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%201/groups?limit=200&skip=0&search=serial+1',
      expect.any(Object)
    );
  });

  test('fetches project ungrouped count', async () => {
    await fetchProjectUngroupedCount('project 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/ungrouped-count', expect.any(Object));
  });

  test('deletes a group', async () => {
    await deleteGroup('group 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/groups/group%201', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('supports group delete request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(deleteGroup('group 1', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/groups/group%201',
      expect.objectContaining({ method: 'DELETE', signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('assigns images to a group', async () => {
    await assignImagesToGroup('group 1', ['image 1']);

    expect(global.fetch).toHaveBeenCalledWith('/api/groups/group%201/images', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(['image 1']),
    }));
  });

  test('removes images from a group', async () => {
    await removeImagesFromGroup('group 1', ['image 1']);

    expect(global.fetch).toHaveBeenCalledWith('/api/groups/group%201/images', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify(['image 1']),
    }));
  });
});
