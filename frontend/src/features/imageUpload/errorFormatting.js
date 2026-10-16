// Shared error-detail formatting for upload and S3 import HTTP responses.

const API_ERROR_DETAIL_MAX_LENGTH = 300;

export function boundApiErrorDetail(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= API_ERROR_DETAIL_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, API_ERROR_DETAIL_MAX_LENGTH - 3)}...`;
}

export function formatApiErrorDetail(detail) {
  if (detail === null || detail === undefined) return '';
  if (typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean') {
    return boundApiErrorDetail(detail);
  }
  if (Array.isArray(detail)) {
    return boundApiErrorDetail(detail.map(formatApiErrorDetail).filter(Boolean).join('; '));
  }
  if (typeof detail === 'object') {
    const message = formatApiErrorDetail(
      detail.msg ?? detail.message ?? detail.error ?? detail.reason ?? detail.detail,
    );
    const location = Array.isArray(detail.loc)
      ? detail.loc.filter((part) => part !== null && part !== undefined).join('.')
      : boundApiErrorDetail(detail.loc);
    if (message) return boundApiErrorDetail(location ? `${location}: ${message}` : message);
    try {
      return boundApiErrorDetail(JSON.stringify(detail));
    } catch {
      return '';
    }
  }
  return '';
}

export async function readFailedResponseDetail(response) {
  let jsonDetail = '';
  try {
    const payload = await response.json();
    jsonDetail = formatApiErrorDetail(payload?.detail);
  } catch {
    // Fall through to the HTTP response metadata.
  }
  return jsonDetail
    || boundApiErrorDetail(response.statusText)
    || `HTTP ${response.status}`;
}

// Same detail precedence as readFailedResponseDetail, for apiJson HTTP errors.
export function readApiErrorDetail(error) {
  return formatApiErrorDetail(error?.payload?.detail)
    || boundApiErrorDetail(error?.statusText)
    || `HTTP ${error?.status}`;
}

// Plain detail text for forms that show `payload.detail`, else the status text.
export function readApiErrorPlainDetail(error) {
  if (error?.name !== 'ApiError') return null;
  const fallback = `HTTP ${error.status}`;
  if (error.payload === null || error.payload === undefined) return error.statusText || fallback;
  return error.payload?.detail || fallback;
}

export function rethrowPlainApiErrorDetail(error) {
  const detail = readApiErrorPlainDetail(error);
  throw detail === null ? error : new Error(detail);
}
