import {
  assignPartToBatch,
  createProjectBatch,
  deleteProjectBatch,
  fetchProjectBatches,
  updateProjectBatch,
} from '../batches';

describe('batch API helpers', () => {
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

  test('fetches project batches', async () => {
    await expect(fetchProjectBatches('project 1')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/batches', {});
  });

  test('encodes project ids and throws ApiError on failed batch fetches', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Not found' }),
    }));

    await expect(fetchProjectBatches('project/id')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      payload: { detail: 'Not found' },
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/batches', {});
  });

  test('supports project batch request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchProjectBatches('project/id', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/batches',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('rejects batch mutations when read-only', async () => {
    await expect(createProjectBatch('project 1', { name: 'Batch 1' }, { readOnly: true }))
      .rejects.toMatchObject({ name: 'ReadOnlyError' });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('creates project batches', async () => {
    await createProjectBatch('project 1', { name: 'Batch 1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/batches', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Batch 1' }),
    }));
  });

  test('updates project batches', async () => {
    await updateProjectBatch('project 1', 'batch 1', { status: 'complete' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/batches/batch%201', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'complete' }),
    }));
  });

  test('deletes project batches', async () => {
    await deleteProjectBatch('project 1', 'batch 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/batches/batch%201', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('assigns parts to batches', async () => {
    await assignPartToBatch('project 1', 'part 1', 'batch 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/parts/batch-assignments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ part_id: 'part 1', to_batch_id: 'batch 1' }),
    }));
  });
});
