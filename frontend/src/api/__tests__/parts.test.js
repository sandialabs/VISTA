import {
  assignImageToPart,
  createPartRealGaussianSplatAsset,
  createPartVolumeSplatAsset,
  createProjectPart,
  deletePartAnnotation,
  deleteProjectPart,
  fetchPartAnnotations,
  fetchPartRealGaussianSplatAssetStatus,
  fetchPartVolumeSplatAssetStatus,
  fetchProjectParts,
  runPartSliceSegmentation,
  savePartAnnotation,
  unloadProjectParts,
  updatePartImageDisplayOrder,
  updatePartSourceImage,
  updateProjectPart,
  updateOverlayAssignment,
  updatePartMetadataSources,
} from '../parts';

describe('part API helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('fetches project parts', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    await expect(fetchProjectParts('project 1')).resolves.toEqual([]);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/parts', {});
  });

  test('throws ApiError with status and payload when fetching project parts fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Forbidden' }),
    }));

    await expect(fetchProjectParts('project/id')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      payload: { detail: 'Forbidden' },
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/parts', {});
  });

  test('returns a parsed part annotations response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchPartAnnotations('project/id', 'part/id')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/parts/part%2Fid/annotations', {});
  });

  test('returns parsed part annotation create and update responses', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const payload = { defect_class: 'Scratch', hidden: false };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(savePartAnnotation('project/id', 'part/id', payload)).resolves.toEqual({ id: 'result-1' });
    await expect(savePartAnnotation('project/id', 'part/id', payload, 'annotation/id')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(global.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/projects/project%2Fid/parts/part%2Fid/annotations', 'POST', JSON.stringify(payload)],
      ['/api/projects/project%2Fid/parts/part%2Fid/annotations/annotation%2Fid', 'PATCH', JSON.stringify(payload)],
    ]);
  });

  test('returns a parsed part annotation delete response', async () => {
    const response = { ok: true, status: 204 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(deletePartAnnotation('project/id', 'part/id', 'annotation/id')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/parts/part%2Fid/annotations/annotation%2Fid',
      { method: 'DELETE' },
    );
  });

  test('guards part annotation write responses when read-only', async () => {
    global.fetch = jest.fn();

    await expect(savePartAnnotation('project/id', 'part/id', {}, '', { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });
    await expect(deletePartAnnotation('project/id', 'part/id', 'annotation/id', { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns a parsed part slice segmentation response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const payload = { axis: 'axial', slice_index: 2, click_x: 10, click_y: 12 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(runPartSliceSegmentation('project/id', 'part/id', payload)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/parts/part%2Fid/slice-segmentation', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(payload);
  });

  test('guards part slice segmentation when read-only', async () => {
    global.fetch = jest.fn();

    await expect(runPartSliceSegmentation('project/id', 'part/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns a parsed create part response', async () => {
    const response = { ok: true, status: 201, json: async () => ({ id: 'result-1' }) };
    const part = { serial_number: 'part 1', display_name: 'Part 1' };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(createProjectPart('project/id', part)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/parts', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(part);
  });

  test('returns a parsed update project part response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const patch = { review_state: 'pass' };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updateProjectPart('project/id', 'part/id', patch)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/parts/part%2Fid', expect.objectContaining({
      method: 'PATCH',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(patch);
  });

  test('guards project part updates when read-only', async () => {
    global.fetch = jest.fn();

    await expect(updateProjectPart('project/id', 'part/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns a parsed part image display order response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const imageRefs = ['front.png', 'image/id'];
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updatePartImageDisplayOrder('project/id', 'part/id', imageRefs)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/parts/part%2Fid/image-display-order',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ image_refs: imageRefs });
  });

  test('guards part image display order updates when read-only', async () => {
    global.fetch = jest.fn();

    await expect(updatePartImageDisplayOrder('project/id', 'part/id', [], { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns a parsed part source image update response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const patch = { crop_subtitle: 'detail crop' };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updatePartSourceImage('project/id', 'part/id', 'image/id', patch)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/parts/part%2Fid/source-images/image%2Fid',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(patch);
  });

  test('guards part source image updates when read-only', async () => {
    global.fetch = jest.fn();

    await expect(updatePartSourceImage('project/id', 'part/id', 'image/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns a parsed image assignment response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const assignment = { filename: 'front.png', image_id: 'image 1', to_part_id: 'part 1' };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(assignImageToPart('project/id', assignment)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/parts/image-assignments',
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(assignment);
  });

  test('guards image assignment responses when read-only', async () => {
    global.fetch = jest.fn();

    await expect(assignImageToPart('project/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('deletes one project part with an encoded part id', async () => {
    const response = { ok: true, status: 204 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(deleteProjectPart('project/id', 'part/id')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/parts/part%2Fid', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('returns parsed part splat asset status responses', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchPartVolumeSplatAssetStatus('project/id', 'part/id')).resolves.toEqual({ id: 'result-1' });
    await expect(fetchPartRealGaussianSplatAssetStatus('project/id', 'part/id')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/project%2Fid/parts/part%2Fid/volume-splat-assets/status',
      '/api/projects/project%2Fid/parts/part%2Fid/real-gaussian-splat-assets/status',
    ]);
  });

  test('supports part splat status request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchPartVolumeSplatAssetStatus('project/id', 'part/id', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/parts/part%2Fid/volume-splat-assets/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('returns parsed part splat asset creation responses', async () => {
    const response = { ok: true, status: 202, json: async () => ({ id: 'result-1' }) };
    const payload = { source_image_ids: [], max_splats: 1000 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(createPartVolumeSplatAsset('project/id', 'part/id', payload)).resolves.toEqual({ id: 'result-1' });
    await expect(createPartRealGaussianSplatAsset('project/id', 'part/id', payload)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/projects/project%2Fid/parts/part%2Fid/volume-splat-assets', 'POST', JSON.stringify(payload)],
      ['/api/projects/project%2Fid/parts/part%2Fid/real-gaussian-splat-assets', 'POST', JSON.stringify(payload)],
    ]);
  });

  test('throws a detailed error when deleting one project part fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 409,
      statusText: 'Conflict',
    }));

    await expect(deleteProjectPart('project/id', 'part/id')).rejects.toThrow(
      'Failed to delete part (409 Conflict) | attempted=DELETE /api/projects/project%2Fid/parts/part%2Fid'
    );
  });

  test('unloads all project parts', async () => {
    const response = { ok: true, status: 204 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(unloadProjectParts('project 1')).resolves.toBeNull();

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/parts', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('throws a detailed error when unloading fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 503,
    }));

    await expect(unloadProjectParts('project 1')).rejects.toThrow(
      'Failed to unload all parts (503) | attempted=DELETE /api/projects/project%201/parts'
    );
  });

  test('updates part metadata source associations', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'part 1' }),
    }));

    await expect(updatePartMetadataSources('project 1', 'part 1', ['source 1'])).resolves.toEqual({ id: 'part 1' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%201/parts/part%201/metadata-sources',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ metadata_source_keys: ['source 1'] }),
      })
    );
  });

  test('updates overlay assignments', async () => {
    const assignment = {
      overlay_filename: 'overlay.png',
      overlay_image_id: 'overlay 1',
      base_filename: 'base.png',
      base_image_id: 'base 1',
    };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));

    await expect(updateOverlayAssignment('project 1', assignment)).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%201/parts/overlay-assignments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(assignment),
      })
    );
  });
});
