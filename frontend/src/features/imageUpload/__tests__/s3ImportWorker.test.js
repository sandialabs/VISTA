import { runS3ImportPlan, S3_IMPORT_BATCH_SIZE, S3_IMPORT_CONCURRENCY } from '../s3ImportWorker';
import { importProjectS3ObjectsResponse } from '../../../api/projects';

jest.mock('../../../api/projects', () => ({
  importProjectS3ObjectsResponse: jest.fn(),
}));

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function makeObjects(count, prefix = 'in') {
  return Array.from({ length: count }, (_, index) => ({
    key: `${prefix}/${index}`,
    filename: `${prefix}-${index}.png`,
    size: 10,
  }));
}

describe('runS3ImportPlan', () => {
  beforeEach(() => {
    importProjectS3ObjectsResponse.mockReset();
  });

  test('pins batch size and concurrency constants', () => {
    expect(S3_IMPORT_BATCH_SIZE).toBe(100);
    expect(S3_IMPORT_CONCURRENCY).toBe(2);
  });

  test('splits requests into batches of 100 keys', async () => {
    const selectedObjects = makeObjects(250);
    importProjectS3ObjectsResponse.mockImplementation(async (_projectId, payload) => (
      jsonResponse({
        imported: payload.keys.map((key) => ({ metadata: { source_s3_key: key }, filename: key })),
        failed: [],
      })
    ));

    const result = await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects,
    });

    expect(importProjectS3ObjectsResponse).toHaveBeenCalledTimes(3);
    const callSizes = importProjectS3ObjectsResponse.mock.calls.map(([, payload]) => payload.keys.length);
    expect(callSizes.sort((a, b) => b - a)).toEqual([100, 100, 50]);
    expect(result.imported).toHaveLength(250);
  });

  test('bounds concurrency at 2 concurrent in-flight requests', async () => {
    const selectedObjects = makeObjects(500);
    let inFlight = 0;
    let maxInFlight = 0;
    importProjectS3ObjectsResponse.mockImplementation(async (_projectId, payload) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return jsonResponse({
        imported: payload.keys.map((key) => ({ metadata: { source_s3_key: key }, filename: key })),
        failed: [],
      });
    });

    await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test('correlates imported and failed records back to requested keys via source key', async () => {
    const selectedObjects = makeObjects(3);
    importProjectS3ObjectsResponse.mockResolvedValue(jsonResponse({
      imported: [
        { metadata: { source_s3_key: 'in/0' }, filename: 'renamed.png', id: 'img-0' },
      ],
      failed: [
        { key: 'in/1', error: 'bad file' },
      ],
    }));

    const result = await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects,
    });

    expect(result.imported).toEqual([{ metadata: { source_s3_key: 'in/0' }, filename: 'renamed.png', id: 'img-0' }]);
    expect(result.importedByKey.get('in/0')).toEqual(result.imported[0]);
    expect(result.failed).toEqual([{ key: 'in/1', error: 'bad file' }]);
    expect(result.completionUnknown).toEqual([
      { key: 'in/2', error: 'S3 import success response omitted this file; server completion is unknown' },
    ]);
  });

  test('falls back to filename correlation when no explicit source key is present', async () => {
    const selectedObjects = makeObjects(2);
    importProjectS3ObjectsResponse.mockResolvedValue(jsonResponse({
      imported: [
        { filename: 'in-0.png', id: 'img-0' },
        { filename: 'in-1.png', id: 'img-1' },
      ],
      failed: [],
    }));

    const result = await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects,
    });

    expect(result.importedByKey.get('in/0')).toEqual({ filename: 'in-0.png', id: 'img-0' });
    expect(result.importedByKey.get('in/1')).toEqual({ filename: 'in-1.png', id: 'img-1' });
  });

  test('marks a definite 4xx rejection as failed, not completion-unknown', async () => {
    const selectedObjects = makeObjects(1);
    importProjectS3ObjectsResponse.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'invalid request' }),
    });

    const result = await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects,
    });

    expect(result.completionUnknown).toEqual([]);
    expect(result.failed).toEqual([{ key: 'in/0', error: 'invalid request' }]);
  });

  test('marks a 5xx rejection, a thrown request error, and invalid JSON as completion-unknown', async () => {
    const [obj500, objThrow, objBadJson] = makeObjects(3);
    importProjectS3ObjectsResponse.mockImplementation(async (_projectId, payload) => {
      const [key] = payload.keys;
      if (key === obj500.key) {
        return { ok: false, status: 503, json: async () => ({ detail: 'server down' }) };
      }
      if (key === objThrow.key) {
        throw new Error('network error');
      }
      return {
        ok: true,
        status: 200,
        json: async () => { throw new Error('not json'); },
      };
    });

    const result = await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects: [obj500, objThrow, objBadJson],
      batchSize: 1,
      concurrency: 1,
    });

    expect(result.failed).toEqual([]);
    const errorsByKey = new Map(result.completionUnknown.map((entry) => [entry.key, entry.error]));
    expect(errorsByKey.get(obj500.key)).toContain('server down');
    expect(errorsByKey.get(objThrow.key)).toContain('network error');
    expect(errorsByKey.get(objBadJson.key)).toContain('not valid JSON');
  });

  test('calls onProgress once per settled chunk with running totals', async () => {
    const selectedObjects = makeObjects(5);
    importProjectS3ObjectsResponse.mockResolvedValue(jsonResponse({
      imported: selectedObjects.map((object) => ({ metadata: { source_s3_key: object.key }, filename: object.filename })),
      failed: [],
    }));
    const onProgress = jest.fn();

    await runS3ImportPlan({
      projectId: 'p1',
      selectedS3Url: 's3://bucket/prefix',
      selectedObjects,
      batchSize: 1,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 5, total: 5 }));
  });
});
