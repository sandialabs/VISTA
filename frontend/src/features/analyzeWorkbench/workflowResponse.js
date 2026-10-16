export async function parseWorkflowResponse(resp) {
  if (typeof resp.text !== 'function' && typeof resp.json === 'function') {
    const payload = await resp.json();
    return { payload, text: JSON.stringify(payload ?? '') };
  }
  const text = await resp.text();
  if (!text) return { payload: null, text: '' };
  try {
    return { payload: JSON.parse(text), text };
  } catch (_err) {
    return { payload: null, text };
  }
}

export function shortResponseExcerpt(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function workflowRequestError(mode, resp, payload, text) {
  const detail = payload?.detail || payload?.message;
  if (detail) return String(detail);
  const excerpt = shortResponseExcerpt(text);
  const status = resp.status ? `HTTP ${resp.status}` : 'request failed';
  const headers = typeof resp.headers?.get === 'function' ? resp.headers : null;
  const debugLocation = headers?.get('x-debug-location');
  const contentType = headers?.get('content-type');
  const context = [
    debugLocation ? `proxy location: ${debugLocation}` : null,
    contentType ? `content-type: ${contentType}` : null,
  ].filter(Boolean).join(', ');
  const contextText = context ? ` (${context})` : '';
  const uploadHint = mode.includes('checkpoint') && [413, 502, 503, 504].includes(Number(resp.status))
    ? ' This often means the deployment proxy rejected a large upload, the backend worker restarted while inspecting the checkpoint, or object storage is unavailable.'
    : '';
  return excerpt
    ? `Workflow ${mode} failed with ${status}${contextText}: ${excerpt}${uploadHint}`
    : `Workflow ${mode} failed with ${status}${contextText}.${uploadHint}`;
}
