import {
  createImageClass,
  deleteImageClass,
  fetchProjectClasses,
  updateImageClass,
} from '../classes';

describe('class API helpers', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('fetches project classes', async () => {
    await expect(fetchProjectClasses('project 1')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/classes', {});
  });

  test('throws ApiError with status and payload when class fetch fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ detail: 'Forbidden' }),
    }));

    await expect(fetchProjectClasses('project 1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      payload: { detail: 'Forbidden' },
    });
  });

  test('creates image classes with project id and details', async () => {
    await expect(createImageClass('project 1', {
      name: 'Defect',
      description: 'Surface defect',
    })).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/classes', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project 1',
        name: 'Defect',
        description: 'Surface defect',
      }),
    }));
  });

  test('updates image classes', async () => {
    await updateImageClass('class 1', {
      name: 'Updated',
      description: 'New description',
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/classes/class%201', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Updated',
        description: 'New description',
      }),
    }));
  });

  test('deletes image classes', async () => {
    await deleteImageClass('class 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/classes/class%201', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});
