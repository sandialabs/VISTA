import { buildHttpErrorMessage } from '../utils/httpErrorMessages';

const READ_ONLY_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function readOnlyRejection(readOnly, init = {}) {
  const method = String(init?.method || 'GET').toUpperCase();
  if (!readOnly || READ_ONLY_SAFE_METHODS.includes(method)) return null;
  const error = new Error('Inspection workbench is read-only.');
  error.name = 'ReadOnlyError';
  return error;
}

export function fetchWithReadOnlyGuard(readOnly, input, init = {}) {
  const rejection = readOnlyRejection(readOnly, init);
  if (rejection) return Promise.reject(rejection);
  return apiFetch(input, init);
}

export function apiFetch(path, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  if (!timeoutMs) {
    return Object.keys(fetchOptions).length > 0 ? fetch(path, fetchOptions) : fetch(path);
  }

  const controller = new AbortController();
  let timeoutId;
  const request = fetch(path, {
    ...fetchOptions,
    signal: fetchOptions.signal || controller.signal,
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      if (!fetchOptions.signal) {
        controller.abort();
      }
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([request, timeoutPromise]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

// Multipart and binary bodies must keep the browser-generated Content-Type
// (including the multipart boundary), so only string bodies default to JSON.
function isBinaryOrFormBody(body) {
  return (typeof FormData !== 'undefined' && body instanceof FormData)
    || (typeof Blob !== 'undefined' && body instanceof Blob)
    || (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
    || (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body)));
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function hasHeader(headers, name) {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

async function readErrorPayload(response) {
  const source = typeof response?.clone === 'function' ? response.clone() : response;
  if (typeof source?.json !== 'function') return null;
  try {
    return await source.json();
  } catch (_) {
    return null;
  }
}

export async function buildApiError(response, errorLabel = 'Request failed', request = {}) {
  const error = new Error(await buildHttpErrorMessage(response, errorLabel, request));
  error.name = 'ApiError';
  error.status = response?.status;
  error.statusText = response?.statusText || '';
  error.payload = await readErrorPayload(response);
  return error;
}

/**
 * Fetch a JSON endpoint and return its parsed body.
 *
 * Options beyond the standard fetch init:
 * - timeoutMs: abort the request after this many milliseconds.
 * - readOnly: reject non-GET/HEAD/OPTIONS requests with a ReadOnlyError.
 * - errorLabel: leading label for the thrown error message.
 *
 * Non-2xx responses throw an Error (name ApiError) whose message comes from
 * buildHttpErrorMessage and which carries `status` and the parsed JSON error
 * `payload` (or null). 204 responses resolve to null.
 */
export async function apiJson(path, options = {}) {
  const {
    timeoutMs,
    readOnly = false,
    errorLabel = 'Request failed',
    ...fetchOptions
  } = options;
  const rejection = readOnlyRejection(readOnly, fetchOptions);
  if (rejection) throw rejection;

  const controller = timeoutMs ? new AbortController() : null;
  let timeoutId;

  if (controller) {
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  }

  const headers = normalizeHeaders(fetchOptions.headers);
  if (
    fetchOptions.body !== undefined
    && fetchOptions.body !== null
    && !isBinaryOrFormBody(fetchOptions.body)
    && !hasHeader(headers, 'Content-Type')
  ) {
    headers['Content-Type'] = 'application/json';
  }

  const init = { ...fetchOptions };
  delete init.headers;
  delete init.signal;
  if (Object.keys(headers).length > 0) init.headers = headers;
  const signal = fetchOptions.signal || controller?.signal;
  if (signal) init.signal = signal;

  try {
    const response = await fetch(path, init);

    if (!response.ok) {
      throw await buildApiError(response, errorLabel, {
        method: fetchOptions.method || 'GET',
        url: path,
      });
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

/**
 * Resolve to `fallback` when `promise` rejects with an HTTP error from apiJson.
 * Network failures, aborts, and malformed 2xx bodies still reject, so optional
 * reads behave like the former `response.ok ? response.json() : fallback`.
 */
export function fallbackOnHttpError(promise, fallback) {
  return promise.catch((error) => {
    if (error?.name === 'ApiError') return fallback;
    throw error;
  });
}

/**
 * Rethrow an apiJson HTTP error as `payload.detail` (when it is a string) or
 * `${fallbackLabel} (${status})`, for forms that show server detail verbatim.
 * Non-HTTP errors are rethrown unchanged.
 */
export function rethrowWithServerDetail(fallbackLabel) {
  return (error) => {
    if (error?.name !== 'ApiError') throw error;
    const detail = error.payload?.detail;
    throw new Error(typeof detail === 'string' && detail ? detail : `${fallbackLabel} (${error.status})`);
  };
}
