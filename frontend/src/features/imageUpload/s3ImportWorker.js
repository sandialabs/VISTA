// Bounded-concurrency chunked S3 import worker. Splits the selected S3
// objects into fixed-size key batches and imports them over `/s3-import`
// using a small pool of concurrent workers, correlating each response back
// to the requested keys so completion-unknown files are never silently
// treated as failed or succeeded.
import { importProjectS3ObjectsResponse } from '../../api/projects';
import { formatApiErrorDetail, readFailedResponseDetail } from './errorFormatting';
import { getTotalUploadSizeBytes } from './uploadFormatting';

export const S3_IMPORT_BATCH_SIZE = 100;
export const S3_IMPORT_CONCURRENCY = 2;

function buildImportChunks(selectedObjects, batchSize) {
  const chunks = [];
  for (let index = 0; index < selectedObjects.length; index += batchSize) {
    chunks.push(selectedObjects.slice(index, index + batchSize));
  }
  return chunks;
}

function explicitValues(candidates) {
  const values = [];
  let present = false;
  candidates.forEach(([record, field]) => {
    if (record && Object.prototype.hasOwnProperty.call(record, field)) {
      present = true;
      values.push(record[field]);
    }
  });
  return { present, values };
}

// Correlates a single response record (imported image or failure) to request
// keys using an explicit source-key field, when the server provided one.
// Returns true once an explicit key was present, even if it was ambiguous or
// foreign, so the caller never falls back to filename correlation for it.
function correlateExplicitRecord(candidates, outcome, chunkKeys, addResponseRecord, markAmbiguous) {
  const explicit = explicitValues(candidates);
  if (!explicit.present) return false;

  const requestedKeys = Array.from(new Set(
    explicit.values.filter((value) => chunkKeys.has(value)),
  ));
  const hasOneUnambiguousRequestedKey = requestedKeys.length === 1
    && explicit.values.length > 0
    && explicit.values.every((value) => value === requestedKeys[0]);
  if (hasOneUnambiguousRequestedKey) {
    addResponseRecord(requestedKeys[0], outcome);
  } else if (requestedKeys.length > 0) {
    markAmbiguous(
      requestedKeys,
      'S3 import response contained conflicting explicit source keys for this file',
    );
  }
  return true;
}

/**
 * Correlates one chunk's import response (or request/parse failure) back to
 * the chunk's requested keys, updating the shared result maps and reporting
 * progress. Mutates `state.importedByKey`, `state.failedByKey`, and
 * `state.completionUnknownByKey`, and calls `onProgress` with running totals.
 */
function settleChunk(chunk, state, payload, {
  requestError = null,
  completionUnknown = false,
  acceptedResponse = false,
} = {}) {
  const chunkKeys = new Set(chunk.map((object) => object.key));
  const responseRecordsByKey = new Map();
  const ambiguityReasonsByKey = new Map();
  const importedItems = Array.isArray(payload?.imported) ? payload.imported : [];
  const failedItems = Array.isArray(payload?.failed) ? payload.failed : [];

  const addResponseRecord = (key, record) => {
    const records = responseRecordsByKey.get(key) || [];
    responseRecordsByKey.set(key, [...records, record]);
  };
  const markAmbiguous = (keys, reason) => {
    keys.forEach((key) => {
      if (chunkKeys.has(key) && !ambiguityReasonsByKey.has(key)) {
        ambiguityReasonsByKey.set(key, reason);
      }
    });
  };

  const importedWithoutSourceKey = [];
  importedItems.forEach((image) => {
    const explicitlyCorrelated = correlateExplicitRecord(
      [
        [image?.metadata, 'source_s3_key'],
        [image, 'source_s3_key'],
      ],
      { type: 'imported', image },
      chunkKeys,
      addResponseRecord,
      markAmbiguous,
    );
    if (!explicitlyCorrelated) importedWithoutSourceKey.push(image);
  });

  importedWithoutSourceKey.forEach((image) => {
    const filenameMatches = chunk.filter((object) => (
      object.filename === image?.filename
    ));
    if (filenameMatches.length === 1) {
      const key = filenameMatches[0].key;
      addResponseRecord(key, { type: 'imported', image });
    } else if (filenameMatches.length > 1) {
      markAmbiguous(
        filenameMatches.map((object) => object.key),
        'S3 import response could not be correlated because duplicate filenames lacked source keys',
      );
    }
  });

  failedItems.forEach((failure) => {
    const error = formatApiErrorDetail(failure?.error ?? failure?.detail)
      || 'S3 file could not be imported';
    correlateExplicitRecord(
      [
        [failure, 'key'],
        [failure, 'source_s3_key'],
      ],
      { type: 'failed', error },
      chunkKeys,
      addResponseRecord,
      markAmbiguous,
    );
  });

  chunk.forEach((object) => {
    const { key } = object;
    const records = responseRecordsByKey.get(key) || [];
    const ambiguityReason = ambiguityReasonsByKey.get(key);
    if (ambiguityReason || records.length > 1) {
      state.completionUnknownByKey.set(key, {
        key,
        error: ambiguityReason
          || 'S3 import response contained duplicate or conflicting results for this file',
      });
      return;
    }
    if (records.length === 1) {
      const [record] = records;
      if (record.type === 'imported') {
        state.importedByKey.set(key, record.image);
      } else {
        state.failedByKey.set(key, { key, error: record.error });
      }
      return;
    }

    const omittedFromAcceptedResponse = acceptedResponse && !requestError;
    const outcome = {
      key,
      error: requestError
        || (omittedFromAcceptedResponse
          ? 'S3 import success response omitted this file; server completion is unknown'
          : 'S3 import response did not include a result for this file'),
    };
    if (completionUnknown || omittedFromAcceptedResponse) {
      state.completionUnknownByKey.set(key, outcome);
    } else {
      state.failedByKey.set(key, outcome);
    }
  });

  state.completed += chunk.length;
  state.failedCount += chunk.filter((object) => (
    state.failedByKey.has(object.key) || state.completionUnknownByKey.has(object.key)
  )).length;
  state.loadedBytes += getTotalUploadSizeBytes(chunk);
}

async function importChunk(chunk, { projectId, selectedS3Url, perFileMetadata, groupIdentifiers, signal }) {
  const keys = chunk.map((object) => object.key);
  const response = await importProjectS3ObjectsResponse(projectId, {
    s3_url: selectedS3Url,
    keys,
    per_file_metadata: Object.fromEntries(
      keys.filter((key) => perFileMetadata[key]).map((key) => [key, perFileMetadata[key]]),
    ),
    group_identifiers: Object.fromEntries(
      keys.filter((key) => groupIdentifiers[key]).map((key) => [key, groupIdentifiers[key]]),
    ),
  }, { signal });

  if (!response.ok) {
    const detail = await readFailedResponseDetail(response);
    const status = Number(response.status);
    const definiteRejection = status >= 400 && status < 500;
    return {
      payload: null,
      options: {
        requestError: definiteRejection ? detail : `${detail}; server completion is unknown`,
        completionUnknown: !definiteRejection,
      },
    };
  }

  try {
    const payload = await response.json();
    return { payload, options: { acceptedResponse: true } };
  } catch {
    return {
      payload: null,
      options: {
        requestError: 'S3 import response was not valid JSON; server completion is unknown',
        completionUnknown: true,
      },
    };
  }
}

/**
 * Runs the chunked S3 import plan with bounded concurrency, calling
 * `onProgress` after each chunk settles and returning imported/failed/
 * completion-unknown arrays ordered like `selectedObjects`.
 */
export async function runS3ImportPlan({
  projectId,
  selectedS3Url,
  selectedObjects,
  perFileMetadata = {},
  groupIdentifiers = {},
  signal,
  isCurrent = () => true,
  onProgress = () => {},
  batchSize = S3_IMPORT_BATCH_SIZE,
  concurrency = S3_IMPORT_CONCURRENCY,
}) {
  const importChunks = buildImportChunks(selectedObjects, batchSize);
  const totalBytes = getTotalUploadSizeBytes(selectedObjects);
  const state = {
    importedByKey: new Map(),
    failedByKey: new Map(),
    completionUnknownByKey: new Map(),
    completed: 0,
    failedCount: 0,
    loadedBytes: 0,
  };

  let nextChunkIndex = 0;
  const importWorker = async () => {
    while (isCurrent()) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      if (chunkIndex >= importChunks.length) return;
      const chunk = importChunks[chunkIndex];
      try {
        const { payload, options } = await importChunk(chunk, {
          projectId, selectedS3Url, perFileMetadata, groupIdentifiers, signal,
        });
        if (!isCurrent()) return;
        settleChunk(chunk, state, payload, options);
      } catch (err) {
        if (!isCurrent() || err?.name === 'AbortError') return;
        const requestDetail = err?.message || 'S3 import request failed';
        settleChunk(chunk, state, null, {
          requestError: `${requestDetail}; server completion is unknown`,
          completionUnknown: true,
        });
      }
      if (isCurrent()) {
        onProgress({
          completed: state.completed,
          failed: state.failedCount,
          total: selectedObjects.length,
          loadedBytes: state.loadedBytes,
          totalBytes,
        });
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(concurrency, importChunks.length) },
    () => importWorker(),
  ));

  const imported = selectedObjects
    .map((object) => state.importedByKey.get(object.key))
    .filter(Boolean);
  const failed = selectedObjects
    .map((object) => state.failedByKey.get(object.key))
    .filter(Boolean);
  const completionUnknown = selectedObjects
    .map((object) => state.completionUnknownByKey.get(object.key))
    .filter(Boolean);

  return {
    imported,
    failed,
    completionUnknown,
    importedByKey: state.importedByKey,
    totalBytes,
  };
}
