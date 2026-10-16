function getResponseHeader(response, name) {
  const headers = response?.headers;
  if (!headers || typeof headers.get !== 'function') return '';
  return headers.get(name) || '';
}

function stringifyDetail(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function formatAttemptedHttpCall(request = {}) {
  const method = String(request.method || '').trim().toUpperCase();
  const url = String(request.url || '').trim() || 'unknown';
  return [method, url].filter(Boolean).join(' ');
}

async function readErrorBody(response) {
  if (!response || typeof response.clone !== 'function') return {};
  try {
    const payload = await response.clone().json();
    return { payload };
  } catch (_) {
    // Try plain text below.
  }
  try {
    const text = (await response.clone().text()).trim();
    return { text };
  } catch (_) {
    return {};
  }
}

export async function buildHttpErrorMessage(response, fallbackLabel, request = {}) {
  const status = response?.status ?? 'unknown';
  const statusText = response?.statusText ? ` ${response.statusText}` : '';
  const attempted = formatAttemptedHttpCall({
    method: request.method,
    url: request.url || response?.url,
  });
  const { payload, text } = await readErrorBody(response);
  const errorContext = payload?.error_context && typeof payload.error_context === 'object'
    ? payload.error_context
    : null;
  const serverMethod = String(errorContext?.method || '').trim().toUpperCase();
  const serverPath = String(errorContext?.path || '').trim();
  const serverQuery = String(errorContext?.query || '').trim();
  const serverCall = serverPath
    ? [serverMethod, `${serverPath}${serverQuery ? `?${serverQuery}` : ''}`].filter(Boolean).join(' ')
    : '';
  const requestId = getResponseHeader(response, 'x-request-id')
    || getResponseHeader(response, 'x-correlation-id')
    || String(errorContext?.request_id || '').trim();
  const detail = stringifyDetail(payload?.detail || payload?.message || text).slice(0, 320);

  return [
    `${fallbackLabel} (${status}${statusText})`,
    `attempted=${attempted}`,
    serverCall && serverCall !== attempted ? `server_call=${serverCall}` : null,
    requestId ? `request_id=${requestId}` : null,
    detail ? `details=${detail}` : null,
  ].filter(Boolean).join(' | ');
}

export function appendHttpCallToErrorMessage(message, request = {}) {
  const attempted = formatAttemptedHttpCall(request);
  const baseMessage = message || 'Request failed';
  if (baseMessage.includes('attempted=')) return baseMessage;
  return `${baseMessage} | attempted=${attempted}`;
}
