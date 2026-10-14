import {
  createImageReview,
  deleteProjectImage,
  deleteImageReview,
  deleteImageMetadata,
  fetchProjectImages,
  fetchProjectImageReviewStatuses,
  fetchImage,
  fetchImageContentResponse,
  fetchImageDownloadResponse,
  fetchImageVolumeMetadata,
  fetchImageVolumeRenderSummary,
  fetchImageReviews,
  restoreProjectImage,
  runImageVolumeConnectedSelection,
  uploadProjectImage,
  updateImageMetadata,
  updateImageMetadataResponse,
} from '../images';

describe('image API helpers', () => {
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

  test('fetches image details', async () => {
    await expect(fetchImage('image 1')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201', {});
  });

  test('fetches image reviews', async () => {
    await fetchImageReviews('image 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201/reviews', expect.any(Object));
  });

  test('creates image reviews with a status payload', async () => {
    await expect(createImageReview('image 1', 'pass')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201/reviews', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pass' }),
    }));
  });

  test('deletes image reviews', async () => {
    await deleteImageReview('review 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/reviews/review%201', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('deletes project images with audit details', async () => {
    await deleteProjectImage('project 1', 'image 1', {
      reason: 'duplicate image',
      force: true,
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/images/image%201', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ reason: 'duplicate image', force: true }),
    }));
  });

  test('encodes project image delete ids and throws ApiError on failure', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'Image has dependents' }),
    }));

    await expect(deleteProjectImage('project/id', 'image/id', {
      reason: 'duplicate image',
      force: true,
    })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      payload: { detail: 'Image has dependents' },
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/images/image%2Fid', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ reason: 'duplicate image', force: true }),
    }));
  });

  test('returns raw image content and download responses', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchImageContentResponse('image/id')).resolves.toBe(response);
    await expect(fetchImageDownloadResponse('image/id')).resolves.toBe(response);

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/images/image%2Fid/content',
      '/api/images/image%2Fid/download',
    ]);
  });

  test('supports raw image content request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchImageContentResponse('image/id', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/images/image%2Fid/content',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('fetches image volume metadata with an encoded image id', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ width: 32, height: 16, image_count: 4 }),
    }));

    await expect(fetchImageVolumeMetadata('image/id')).resolves.toEqual({ width: 32, height: 16, image_count: 4 });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%2Fid/volume-metadata', {});
  });

  test('supports image volume metadata request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchImageVolumeMetadata('image/id', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/images/image%2Fid/volume-metadata',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('returns a parsed image volume render summary', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ summary: 'v1', bins: [] }),
    }));

    await expect(fetchImageVolumeRenderSummary('image/id', 'v1')).resolves.toEqual({ summary: 'v1', bins: [] });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%2Fid/volume-render-summary?summary=v1', {});
  });

  test('returns a parsed image volume connected selection', async () => {
    const payload = { seed: { x: 1, y: 2, z: 3 }, sensitivity: 4 };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ voxel_count: 12 }),
    }));

    await expect(runImageVolumeConnectedSelection('image/id', payload)).resolves.toEqual({ voxel_count: 12 });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%2Fid/volume-connected-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  test('guards image volume connected selection when read-only', async () => {
    global.fetch = jest.fn();

    await expect(runImageVolumeConnectedSelection('image/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('restores project images', async () => {
    await restoreProjectImage('project 1', 'image 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/images/image%201/restore', expect.objectContaining({
      method: 'POST',
    }));
  });

  test('fetches project image review statuses', async () => {
    await fetchProjectImageReviewStatuses('project 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/image-review-statuses', {});
  });

  test('fetches project images with query params', async () => {
    await fetchProjectImages('project 1', {
      group_id: 'group 1',
      skip: 20,
      limit: 10,
      empty: '',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%201/images?group_id=group+1&skip=20&limit=10',
      {}
    );
  });

  test('uploads project images as form data and returns the parsed image', async () => {
    const formData = new FormData();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ id: 'image-1' }),
    }));

    await expect(uploadProjectImage('project/id', formData)).resolves.toEqual({ id: 'image-1' });

    // FormData bodies keep the browser-generated multipart Content-Type.
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/images', {
      method: 'POST',
      body: formData,
    });
  });

  test('guards project image uploads when read-only', async () => {
    global.fetch = jest.fn();

    await expect(uploadProjectImage('project/id', new FormData(), { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('updates image metadata', async () => {
    await expect(updateImageMetadata('image 1', 'sample key', { value: 1 })).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201/metadata', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ key: 'sample key', value: { value: 1 } }),
    }));
  });

  test('returns a raw image metadata update response', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updateImageMetadataResponse('image 1', 'sample key', { value: 1 })).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201/metadata', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ key: 'sample key', value: { value: 1 } }),
    }));
  });

  test('deletes image metadata keys', async () => {
    await deleteImageMetadata('image 1', 'sample key');

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%201/metadata/sample%20key', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('returns null for no-content image metadata deletes', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204 }));

    await expect(deleteImageMetadata('image/id', 'sample key')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith('/api/images/image%2Fid/metadata/sample%20key', {
      method: 'DELETE',
    });
  });
});
