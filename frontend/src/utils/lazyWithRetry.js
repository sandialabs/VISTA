import { lazy } from 'react';

const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 3000];

export function isChunkLoadError(error) {
  const name = error?.name || '';
  const message = error?.message || '';

  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function retryChunkImport(importer, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  let lastError;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await importer();
    } catch (error) {
      lastError = error;

      if (!isChunkLoadError(error) || attempt === retryDelaysMs.length) {
        throw error;
      }

      await delay(retryDelaysMs[attempt]);
    }
  }

  throw lastError;
}

export default function lazyWithRetry(importer, retryDelaysMs) {
  return lazy(() => retryChunkImport(importer, retryDelaysMs));
}
