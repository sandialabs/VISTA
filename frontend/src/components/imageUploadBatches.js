export const BATCH_UPLOAD_MAX_FILES = 100;
export const BATCH_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
export const BATCH_UPLOAD_MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const BATCH_UPLOAD_CONCURRENCY = 2;

function itemSizeBytes(item) {
  return Math.max(0, Number(item?.file?.size) || 0);
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function buildBatchManifestEntry(item) {
  const entry = {
    client_index: item.clientIndex,
    filename: item.filename,
    metadata: item.metadata || {},
  };
  if (item.groupIdentifier) entry.group_identifier = item.groupIdentifier;
  return entry;
}

function estimateManifestEntryBytes(item) {
  try {
    return {
      bytes: utf8ByteLength(JSON.stringify(buildBatchManifestEntry(item))),
      error: null,
    };
  } catch (error) {
    return { bytes: 0, error };
  }
}

export function estimateBatchManifestBytes(items) {
  if (!items.length) return 2;
  return 2 + items.reduce((total, item, index) => {
    const estimate = estimateManifestEntryBytes(item);
    if (estimate.error) throw estimate.error;
    return total + estimate.bytes + (index > 0 ? 1 : 0);
  }, 0);
}

/**
 * Build an ordered upload plan without copying or removing files from the input
 * array. Files larger than the aggregate batch limit stay on the legacy route,
 * while all other files are packed up to the count, file-byte, and manifest
 * JSON byte ceilings.
 */
export function buildImageUploadPlan(
  items,
  {
    maxFiles = BATCH_UPLOAD_MAX_FILES,
    maxBytes = BATCH_UPLOAD_MAX_BYTES,
    maxManifestBytes = BATCH_UPLOAD_MAX_MANIFEST_BYTES,
  } = {},
) {
  const operations = [];
  let currentItems = [];
  let currentBytes = 0;
  let currentManifestBytes = 2;

  const flushBatch = () => {
    if (currentItems.length === 0) return;
    operations.push({
      type: 'batch',
      items: currentItems,
      sizeBytes: currentBytes,
      manifestSizeBytes: currentManifestBytes,
    });
    currentItems = [];
    currentBytes = 0;
    currentManifestBytes = 2;
  };

  items.forEach((item) => {
    const sizeBytes = itemSizeBytes(item);
    const manifestEstimate = estimateManifestEntryBytes(item);
    if (manifestEstimate.error || manifestEstimate.bytes + 2 > maxManifestBytes) {
      flushBatch();
      operations.push({
        type: 'rejected',
        items: [item],
        sizeBytes,
        code: manifestEstimate.error ? 'invalid_manifest_metadata' : 'manifest_item_too_large',
        detail: manifestEstimate.error
          ? 'Upload metadata could not be serialized as JSON'
          : `Upload metadata exceeds the ${maxManifestBytes}-byte batch manifest limit`,
      });
      return;
    }
    if (sizeBytes > maxBytes) {
      flushBatch();
      operations.push({ type: 'legacy', items: [item], sizeBytes });
      return;
    }

    const nextManifestBytes = currentManifestBytes
      + manifestEstimate.bytes
      + (currentItems.length > 0 ? 1 : 0);
    const singleItemManifestBytes = manifestEstimate.bytes + 2;
    if (sizeBytes + singleItemManifestBytes > maxBytes) {
      flushBatch();
      operations.push({
        type: 'legacy',
        items: [item],
        sizeBytes,
        manifestSizeBytes: singleItemManifestBytes,
      });
      return;
    }
    if (
      currentItems.length >= maxFiles
      || (currentItems.length > 0 && currentBytes + sizeBytes + nextManifestBytes > maxBytes)
      || (currentItems.length > 0 && nextManifestBytes > maxManifestBytes)
    ) {
      flushBatch();
    }
    currentItems.push(item);
    currentBytes += sizeBytes;
    currentManifestBytes += manifestEstimate.bytes + (currentItems.length > 1 ? 1 : 0);
  });
  flushBatch();
  return operations;
}

export function buildBatchUploadFormData(items) {
  const formData = new FormData();
  const manifest = items.map((item) => {
    formData.append('files', item.file, item.filename);
    return buildBatchManifestEntry(item);
  });
  const manifestJson = JSON.stringify(manifest);
  formData.append(
    'manifest',
    new Blob([manifestJson], { type: 'application/json' }),
    'manifest.json',
  );
  return formData;
}

export function buildLegacyUploadFormData(item) {
  const formData = new FormData();
  formData.append('file', item.file, item.filename);
  if (item.metadata && Object.keys(item.metadata).length > 0) {
    formData.append('metadata', JSON.stringify(item.metadata));
  }
  if (item.groupIdentifier) formData.append('group_identifier', item.groupIdentifier);
  return formData;
}

async function responseDetail(response) {
  try {
    const payload = await response.json();
    return String(payload?.detail || `HTTP ${response.status}`);
  } catch (error) {
    return `HTTP ${response.status}`;
  }
}

function isAbort(error, signal) {
  return Boolean(signal?.aborted || error?.name === 'AbortError');
}

/**
 * Run upload operations with an indexed cursor. The cursor makes claiming work
 * O(1) for very large selections (Array.shift() is O(n)) and checking the stop
 * predicate before each claim guarantees cancellation starts no new requests.
 */
export async function runImageUploadPlan({
  items,
  projectId,
  fetchImpl = fetch,
  signal,
  shouldStop = () => false,
  onItemSettled = () => {},
  concurrency = BATCH_UPLOAD_CONCURRENCY,
  maxFiles = BATCH_UPLOAD_MAX_FILES,
  maxBytes = BATCH_UPLOAD_MAX_BYTES,
  maxManifestBytes = BATCH_UPLOAD_MAX_MANIFEST_BYTES,
}) {
  const operations = buildImageUploadPlan(items, { maxFiles, maxBytes, maxManifestBytes });
  const outcomes = new Map();

  const settle = (item, outcome) => {
    if (outcomes.has(item.clientIndex)) return;
    const settled = { clientIndex: item.clientIndex, item, ...outcome };
    outcomes.set(item.clientIndex, settled);
    onItemSettled(settled);
  };

  const uploadLegacy = async (item) => {
    if (shouldStop() || signal?.aborted) return;
    let body;
    try {
      body = buildLegacyUploadFormData(item);
    } catch (error) {
      settle(item, {
        ok: false,
        code: 'legacy_request_invalid',
        detail: 'Upload request could not be constructed',
      });
      return;
    }
    try {
      const response = await fetchImpl(`/api/projects/${projectId}/images`, {
        method: 'POST',
        body,
        signal,
      });
      if (!response.ok) {
        const detail = await responseDetail(response);
        settle(item, {
          ok: false,
          code: response.status >= 500 ? 'completion_unknown' : 'legacy_upload_failed',
          detail: response.status >= 500
            ? `${detail}; server completion is unknown and the upload was not retried to avoid duplicates`
            : detail,
        });
        return;
      }
      settle(item, { ok: true, image: await response.json() });
    } catch (error) {
      const aborted = isAbort(error, signal);
      settle(item, {
        ok: false,
        code: 'completion_unknown',
        detail: aborted
          ? 'Request was cancelled; server completion is unknown'
          : 'Upload request failed after dispatch; server completion is unknown',
      });
    }
  };

  const uploadBatch = async (batchItems) => {
    if (shouldStop() || signal?.aborted) return;
    let body;
    try {
      body = buildBatchUploadFormData(batchItems);
    } catch (error) {
      batchItems.forEach((item) => settle(item, {
        ok: false,
        code: 'batch_request_invalid',
        detail: 'Batch upload request could not be constructed',
      }));
      return;
    }
    let response;
    try {
      response = await fetchImpl(`/api/projects/${projectId}/images/batch`, {
        method: 'POST',
        body,
        signal,
      });
    } catch (error) {
      const aborted = isAbort(error, signal);
      batchItems.forEach((item) => settle(item, {
        ok: false,
        code: 'completion_unknown',
        detail: aborted
          ? 'Request was cancelled; server completion is unknown'
          : 'Batch request failed after dispatch; server completion is unknown and it was not retried to avoid duplicate uploads',
      }));
      return;
    }

    // A definitive route/method miss means the batch handler could not have
    // accepted files, so falling back is safe. Other HTTP/network failures are
    // deliberately not retried because server completion may be ambiguous.
    if (response.status === 404 || response.status === 405) {
      for (let index = 0; index < batchItems.length; index += 1) {
        if (shouldStop() || signal?.aborted) return;
        await uploadLegacy(batchItems[index]);
      }
      return;
    }
    if (!response.ok) {
      const detail = await responseDetail(response);
      batchItems.forEach((item) => settle(item, {
        ok: false,
        code: response.status >= 500 ? 'completion_unknown' : 'batch_upload_failed',
        detail: response.status >= 500
          ? `${detail}; server completion is unknown and the batch was not retried to avoid duplicate uploads`
          : detail,
      }));
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      const aborted = isAbort(error, signal);
      batchItems.forEach((item) => settle(item, {
        ok: false,
        code: 'completion_unknown',
        detail: aborted
          ? 'Response reading was cancelled; server completion is unknown'
          : 'Batch response could not be read; server completion is unknown',
      }));
      return;
    }

    const itemByIndex = new Map(batchItems.map((item) => [item.clientIndex, item]));
    const uploadedByIndex = new Map();
    const failedByIndex = new Map();
    (Array.isArray(payload?.uploaded) ? payload.uploaded : []).forEach((entry) => {
      if (itemByIndex.has(entry?.client_index) && entry?.image) {
        uploadedByIndex.set(entry.client_index, entry.image);
      }
    });
    (Array.isArray(payload?.failed) ? payload.failed : []).forEach((entry) => {
      if (itemByIndex.has(entry?.client_index)) failedByIndex.set(entry.client_index, entry);
    });

    for (let index = 0; index < batchItems.length; index += 1) {
      const item = batchItems[index];
      if (uploadedByIndex.has(item.clientIndex)) {
        settle(item, { ok: true, image: uploadedByIndex.get(item.clientIndex) });
        continue;
      }
      const failure = failedByIndex.get(item.clientIndex);
      if (failure?.code === 'legacy_route_required') {
        await uploadLegacy(item);
      } else if (failure) {
        settle(item, {
          ok: false,
          code: failure.code || 'batch_item_failed',
          detail: failure.detail || 'File could not be uploaded',
        });
      } else {
        settle(item, {
          ok: false,
          code: 'completion_unknown',
          reason: 'missing_batch_result',
          detail: 'Batch success response did not include a result for this file; server completion is unknown',
        });
      }
    }
  };

  let nextOperationIndex = 0;
  const runWorker = async () => {
    while (!shouldStop() && !signal?.aborted) {
      const operationIndex = nextOperationIndex;
      nextOperationIndex += 1;
      if (operationIndex >= operations.length) return;
      const operation = operations[operationIndex];
      if (operation.type === 'rejected') {
        settle(operation.items[0], {
          ok: false,
          code: operation.code,
          detail: operation.detail,
        });
      } else if (operation.type === 'legacy') {
        await uploadLegacy(operation.items[0]);
      } else {
        await uploadBatch(operation.items);
      }
    }
  };

  const workerCount = Math.min(
    Math.max(1, Number(concurrency) || 1),
    operations.length,
  );
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (shouldStop() || signal?.aborted) {
    items.forEach((item) => settle(item, {
      ok: false,
      code: 'cancelled_before_start',
      detail: 'Upload cancelled before this file was sent',
    }));
  }

  const ordered = Array.from(outcomes.values()).sort((left, right) => (
    left.clientIndex - right.clientIndex
  ));
  return {
    successes: ordered.filter((outcome) => outcome.ok),
    failures: ordered.filter((outcome) => !outcome.ok),
    completionUnknown: ordered.filter((outcome) => outcome.code === 'completion_unknown'),
    cancelled: Boolean(shouldStop() || signal?.aborted),
  };
}
