import {
  BATCH_UPLOAD_MAX_BYTES,
  BATCH_UPLOAD_MAX_MANIFEST_BYTES,
  buildBatchUploadFormData,
  buildImageUploadPlan,
  estimateBatchManifestBytes,
  runImageUploadPlan,
} from '../imageUploadBatches';

jest.setTimeout(30000);

function makeItem(clientIndex, name = `image-${clientIndex}.png`, contents = 'x') {
  return {
    clientIndex,
    filename: name,
    file: new File([contents], name, { type: 'image/png' }),
    metadata: { marker: clientIndex },
    groupIdentifier: clientIndex % 2 ? 'odd' : null,
  };
}

function response(payload, status = 201) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

const readBlobText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(reader.result));
  reader.addEventListener('error', () => reject(reader.error));
  reader.readAsText(blob);
});

async function readBatchManifest(formData) {
  return JSON.parse(await readBlobText(formData.get('manifest')));
}

async function successfulBatchResponse(formData, { reverse = false } = {}) {
  const manifest = await readBatchManifest(formData);
  const entries = reverse ? [...manifest].reverse() : manifest;
  return response({
    uploaded: entries.map((entry) => ({
      client_index: entry.client_index,
      image: { id: `image-${entry.client_index}`, filename: entry.filename },
    })),
    failed: [],
  });
}

describe('image upload batching', () => {
  test('packs 2,000 tiny files into exactly 20 bounded batch requests', async () => {
    const items = Array.from({ length: 2000 }, (_, index) => makeItem(index));
    let active = 0;
    let maximumActive = 0;
    const fetchImpl = jest.fn(async (_url, options) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return successfulBatchResponse(options.body);
    });

    const result = await runImageUploadPlan({ items, projectId: 'project', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(maximumActive).toBeLessThanOrEqual(2);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).toBe('/api/projects/project/images/batch');
      expect(options.body.getAll('files')).toHaveLength(100);
      expect(await readBatchManifest(options.body)).toHaveLength(100);
    }
    expect(result.successes).toHaveLength(2000);
    expect(result.failures).toHaveLength(0);
  });

  test('enforces the count ceiling and isolates oversized legacy files', () => {
    const sizedItem = (index, size) => ({
      ...makeItem(index),
      file: { size },
    });
    const operations = buildImageUploadPlan([
      sizedItem(0, 6),
      sizedItem(1, 4),
      sizedItem(2, 1),
      sizedItem(3, 1001),
      sizedItem(4, 5),
    ], { maxFiles: 2, maxBytes: 1000 });

    expect(operations.map((operation) => ({
      type: operation.type,
      indexes: operation.items.map((item) => item.clientIndex),
      bytes: operation.sizeBytes,
    }))).toEqual([
      { type: 'batch', indexes: [0, 1], bytes: 10 },
      { type: 'batch', indexes: [2], bytes: 1 },
      { type: 'legacy', indexes: [3], bytes: 1001 },
      { type: 'batch', indexes: [4], bytes: 5 },
    ]);
  });

  test('counts exact manifest JSON bytes toward the aggregate batch byte limit', () => {
    const items = [
      { ...makeItem(0), file: { size: 6 } },
      { ...makeItem(1), file: { size: 4 } },
    ];
    const manifestBytes = estimateBatchManifestBytes(items);
    const exactBoundary = buildImageUploadPlan(items, {
      maxFiles: 100,
      maxBytes: 10 + manifestBytes,
    });
    const oneByteTooSmall = buildImageUploadPlan(items, {
      maxFiles: 100,
      maxBytes: 9 + manifestBytes,
    });

    expect(exactBoundary).toHaveLength(1);
    expect(exactBoundary[0]).toEqual(expect.objectContaining({
      type: 'batch',
      sizeBytes: 10,
      manifestSizeBytes: manifestBytes,
    }));
    expect(oneByteTooSmall.map((operation) => (
      operation.items.map((item) => item.clientIndex)
    ))).toEqual([[0], [1]]);
  });

  test('packs batches under the manifest JSON byte ceiling', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      ...makeItem(index),
      metadata: { marker: index, note: 'é'.repeat(20) },
    }));
    const twoItemBytes = estimateBatchManifestBytes(items.slice(0, 2));
    const operations = buildImageUploadPlan(items, {
      maxFiles: 100,
      maxBytes: 1024,
      maxManifestBytes: twoItemBytes,
    });

    expect(operations.map((operation) => operation.items.map((item) => item.clientIndex))).toEqual([
      [0, 1],
      [2, 3],
      [4],
    ]);
    operations.forEach((operation) => {
      expect(operation.type).toBe('batch');
      expect(operation.manifestSizeBytes).toBeLessThanOrEqual(twoItemBytes);
      expect(operation.manifestSizeBytes).toBe(estimateBatchManifestBytes(operation.items));
    });
  });

  test.each([1 * 1024 * 1024, 8 * 1024 * 1024])(
    'constructs and correlates an exact %i-byte JSON manifest file',
    async (targetBytes) => {
      const item = {
        ...makeItem(42, 'metadata-heavy.png'),
        metadata: { payload: '' },
      };
      const emptyPayloadBytes = estimateBatchManifestBytes([item]);
      item.metadata.payload = 'x'.repeat(targetBytes - emptyPayloadBytes);
      expect(estimateBatchManifestBytes([item])).toBe(targetBytes);

      const operations = buildImageUploadPlan([item]);
      expect(operations).toEqual([
        expect.objectContaining({
          type: 'batch',
          manifestSizeBytes: targetBytes,
        }),
      ]);

      const fetchImpl = jest.fn(async (_url, options) => {
        const manifestFile = options.body.get('manifest');
        expect(manifestFile.name).toBe('manifest.json');
        expect(manifestFile.type).toBe('application/json');
        expect(manifestFile.size).toBe(targetBytes);
        const manifest = await readBatchManifest(options.body);
        return response({
          uploaded: [{
            client_index: manifest[0].client_index,
            image: { id: 'large-manifest-image', filename: manifest[0].filename },
          }],
          failed: [],
        });
      });

      const result = await runImageUploadPlan({ items: [item], projectId: 'project', fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.successes).toEqual([
        expect.objectContaining({ clientIndex: 42, image: { id: 'large-manifest-image', filename: 'metadata-heavy.png' } }),
      ]);
    },
  );

  test('rejects one excessive manifest item locally without sending any request', async () => {
    const item = {
      ...makeItem(17, 'metadata-heavy.png'),
      metadata: { payload: 'x'.repeat(200) },
    };
    const fetchImpl = jest.fn();
    const settled = [];

    const result = await runImageUploadPlan({
      items: [item],
      projectId: 'project',
      fetchImpl,
      maxManifestBytes: 100,
      onItemSettled: (outcome) => settled.push(outcome),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.successes).toHaveLength(0);
    expect(result.failures).toEqual([
      expect.objectContaining({
        clientIndex: 17,
        code: 'manifest_item_too_large',
        detail: expect.stringContaining('100-byte batch manifest limit'),
      }),
    ]);
    expect(settled).toHaveLength(1);
    expect(BATCH_UPLOAD_MAX_MANIFEST_BYTES).toBe(8 * 1024 * 1024);
  });

  test('rejects non-serializable metadata locally', async () => {
    const item = makeItem(3);
    item.metadata.circular = item.metadata;
    const fetchImpl = jest.fn();

    const result = await runImageUploadPlan({ items: [item], projectId: 'project', fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      expect.objectContaining({ clientIndex: 3, code: 'invalid_manifest_metadata' }),
    ]);
  });

  test('preserves duplicate filenames and maps out-of-order results by global client index', async () => {
    const items = [makeItem(9, 'same.png'), makeItem(2, 'same.png'), makeItem(5, 'same.png')];
    const fetchImpl = jest.fn(async (_url, options) => successfulBatchResponse(options.body, { reverse: true }));

    const result = await runImageUploadPlan({ items, projectId: 'project', fetchImpl });
    const formData = fetchImpl.mock.calls[0][1].body;
    expect(formData.getAll('files').map((file) => file.name)).toEqual(['same.png', 'same.png', 'same.png']);
    expect(await readBatchManifest(formData)).toEqual([
      { client_index: 9, filename: 'same.png', metadata: { marker: 9 }, group_identifier: 'odd' },
      { client_index: 2, filename: 'same.png', metadata: { marker: 2 } },
      { client_index: 5, filename: 'same.png', metadata: { marker: 5 }, group_identifier: 'odd' },
    ]);
    expect(result.successes.map((item) => item.clientIndex)).toEqual([2, 5, 9]);
  });

  test('aggregates partial item failures while retaining every successful image', async () => {
    const items = [makeItem(0), makeItem(1), makeItem(2)];
    const settled = [];
    const fetchImpl = jest.fn(async () => response({
      uploaded: [
        { client_index: 2, image: { id: 'two' } },
        { client_index: 0, image: { id: 'zero' } },
      ],
      failed: [{ client_index: 1, code: 'validation_failed', detail: 'bad image' }],
    }));

    const result = await runImageUploadPlan({
      items,
      projectId: 'project',
      fetchImpl,
      onItemSettled: (outcome) => settled.push(outcome),
    });

    expect(result.successes.map((item) => item.image.id)).toEqual(['zero', 'two']);
    expect(result.failures).toEqual([
      expect.objectContaining({ clientIndex: 1, code: 'validation_failed', detail: 'bad image' }),
    ]);
    expect(settled).toHaveLength(3);
  });

  test('retries only a legacy_route_required PT3 item and sends oversized files directly', async () => {
    const ordinary = makeItem(0, 'slice.png');
    const volume = makeItem(1, 'volume.npy');
    const oversized = makeItem(2, 'large.npy');
    Object.defineProperty(oversized.file, 'size', { value: BATCH_UPLOAD_MAX_BYTES + 1 });
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.endsWith('/images/batch')) {
        return response({
          uploaded: [{ client_index: 0, image: { id: 'ordinary' } }],
          failed: [{
            client_index: 1,
            code: 'legacy_route_required',
            detail: 'PT3 volume needs atomic assignment',
          }],
        });
      }
      const filename = options.body.get('file').name;
      return response({ id: filename, filename });
    });

    const result = await runImageUploadPlan({
      items: [ordinary, volume, oversized],
      projectId: 'project',
      fetchImpl,
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/project/images/batch',
      '/api/projects/project/images',
      '/api/projects/project/images',
    ]);
    expect(fetchImpl.mock.calls.slice(1).map(([, options]) => (
      options.body.get('file').name
    )).sort()).toEqual(['large.npy', 'volume.npy']);
    expect(result.successes).toHaveLength(3);
  });

  test.each([404, 405])('falls back safely for a definitive batch endpoint HTTP %s', async (status) => {
    const items = [makeItem(0), makeItem(1)];
    const fetchImpl = jest.fn(async (url, options) => {
      if (url.endsWith('/batch')) return response({ detail: 'missing route' }, status);
      const filename = options.body.get('file').name;
      return response({ id: filename });
    });

    const result = await runImageUploadPlan({ items, projectId: 'project', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.successes).toHaveLength(2);
  });

  test('marks a batch HTTP 5xx as completion unknown and does not retry', async () => {
    const fetchImpl = jest.fn(async () => response({ detail: 'database response lost' }, 503));

    const result = await runImageUploadPlan({
      items: [makeItem(0), makeItem(1)],
      projectId: 'project',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.completionUnknown).toEqual([
      expect.objectContaining({ clientIndex: 0, code: 'completion_unknown' }),
      expect.objectContaining({ clientIndex: 1, code: 'completion_unknown' }),
    ]);
  });

  test('marks an item omitted from a successful batch response as completion unknown', async () => {
    const items = [makeItem(0), makeItem(1)];
    const fetchImpl = jest.fn(async () => response({
      uploaded: [{ client_index: 0, image: { id: 'image-0' } }],
      failed: [],
    }));

    const result = await runImageUploadPlan({ items, projectId: 'project', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.successes).toEqual([
      expect.objectContaining({ clientIndex: 0, image: { id: 'image-0' } }),
    ]);
    expect(result.completionUnknown).toEqual([
      expect.objectContaining({
        clientIndex: 1,
        code: 'completion_unknown',
        reason: 'missing_batch_result',
      }),
    ]);
  });

  test('marks a legacy HTTP 5xx as completion unknown and does not retry', async () => {
    const fetchImpl = jest.fn(async () => response({ detail: 'gateway timeout' }, 504));

    const result = await runImageUploadPlan({
      items: [makeItem(0, 'large.npy')],
      projectId: 'project',
      fetchImpl,
      maxBytes: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/projects/project/images');
    expect(result.completionUnknown).toEqual([
      expect.objectContaining({ clientIndex: 0, code: 'completion_unknown' }),
    ]);
  });

  test('keeps HTTP 4xx validation and size failures definite', async () => {
    const batchFetch = jest.fn(async () => response({ detail: 'batch is too large' }, 413));
    const legacyFetch = jest.fn(async () => response({ detail: 'invalid image' }, 422));

    const batchResult = await runImageUploadPlan({
      items: [makeItem(0)],
      projectId: 'project',
      fetchImpl: batchFetch,
    });
    const legacyResult = await runImageUploadPlan({
      items: [makeItem(1, 'large.npy')],
      projectId: 'project',
      fetchImpl: legacyFetch,
      maxBytes: 0,
    });

    expect(batchResult.completionUnknown).toHaveLength(0);
    expect(batchResult.failures).toEqual([
      expect.objectContaining({ clientIndex: 0, code: 'batch_upload_failed', detail: 'batch is too large' }),
    ]);
    expect(legacyResult.completionUnknown).toHaveLength(0);
    expect(legacyResult.failures).toEqual([
      expect.objectContaining({ clientIndex: 1, code: 'legacy_upload_failed', detail: 'invalid image' }),
    ]);
  });

  test('does not retry an ambiguous network failure', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('connection lost'));
    const result = await runImageUploadPlan({
      items: [makeItem(0), makeItem(1)],
      projectId: 'project',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.completionUnknown).toHaveLength(2);
    expect(result.failures).toEqual([
      expect.objectContaining({ clientIndex: 0, code: 'completion_unknown' }),
      expect.objectContaining({ clientIndex: 1, code: 'completion_unknown' }),
    ]);
  });

  test('does not retry an ambiguous legacy network failure and marks completion unknown', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('connection lost'));
    const result = await runImageUploadPlan({
      items: [makeItem(0, 'large.npy')],
      projectId: 'project',
      fetchImpl,
      maxBytes: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/projects/project/images');
    expect(result.successes).toHaveLength(0);
    expect(result.completionUnknown).toEqual([
      expect.objectContaining({ clientIndex: 0, code: 'completion_unknown' }),
    ]);
  });

  test('aborts in-flight requests and starts no new batches after cancellation', async () => {
    const items = Array.from({ length: 300 }, (_, index) => makeItem(index));
    const controller = new AbortController();
    let cancelled = false;
    const fetchImpl = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    const promise = runImageUploadPlan({
      items,
      projectId: 'project',
      fetchImpl,
      signal: controller.signal,
      shouldStop: () => cancelled,
    });

    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    cancelled = true;
    controller.abort();
    const result = await promise;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.cancelled).toBe(true);
    expect(result.failures).toHaveLength(300);
    expect(result.completionUnknown).toHaveLength(200);
    expect(result.failures.filter((failure) => failure.code === 'cancelled_before_start')).toHaveLength(100);
    expect(result.failures.filter((failure) => failure.code === 'completion_unknown')).toHaveLength(200);
  });

  test('treats AbortError while reading a successful response as completion unknown', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => response({}));
    fetchImpl.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => {
        controller.abort();
        const error = new Error('aborted while reading response');
        error.name = 'AbortError';
        throw error;
      },
    });

    const result = await runImageUploadPlan({
      items: [makeItem(0), makeItem(1)],
      projectId: 'project',
      fetchImpl,
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.completionUnknown).toHaveLength(2);
    expect(result.failures.every((failure) => failure.code === 'completion_unknown')).toBe(true);
  });

  test('batch FormData retains positional file-to-manifest metadata and grouping', async () => {
    const items = [makeItem(7, 'duplicate.png'), makeItem(8, 'duplicate (duplicate).png')];
    const formData = buildBatchUploadFormData(items);
    expect(formData.getAll('files').map((file) => file.name)).toEqual([
      'duplicate.png',
      'duplicate (duplicate).png',
    ]);
    const manifestFile = formData.get('manifest');
    expect(manifestFile.name).toBe('manifest.json');
    expect(manifestFile.type).toBe('application/json');
    expect((await readBatchManifest(formData)).map((entry) => entry.client_index)).toEqual([7, 8]);
  });
});
