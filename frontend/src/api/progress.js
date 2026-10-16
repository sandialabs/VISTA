function readHeader(response, name) {
  const headers = response?.headers;
  return headers && typeof headers.get === 'function' ? headers.get(name) || '' : '';
}

/**
 * Read a raw fetch Response body into a Blob while reporting byte progress.
 *
 * onProgress receives cumulative `{ loaded, total }`. `total` is the expected
 * byte count from `totalHeader` (0 when unknown); bodies without a readable
 * stream report a single final event with the blob size.
 */
export async function readResponseBlobWithProgress(response, onProgress, {
  totalHeader = 'content-length',
  defaultType = 'application/octet-stream',
} = {}) {
  const total = Number(readHeader(response, totalHeader)) || 0;
  onProgress?.({ loaded: 0, total });

  if (!response.body || typeof response.body.getReader !== 'function') {
    const blob = await response.blob();
    const loaded = blob.size || 0;
    onProgress?.({ loaded, total: total || loaded });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength || value.length || 0;
      onProgress?.({ loaded, total });
    }
  }
  const blob = new Blob(chunks, { type: readHeader(response, 'content-type') || defaultType });
  if (!total && blob.size > loaded) onProgress?.({ loaded: blob.size, total: blob.size });
  return blob;
}
