import { apiJson, encodePathSegment } from './client';

export function fetchApiKeys(options = {}) {
  return apiJson('/api/api-keys', options);
}

export function createApiKey(name, options = {}) {
  return apiJson('/api/api-keys', {
    ...options,
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteApiKey(keyId, options = {}) {
  return apiJson(`/api/api-keys/${encodePathSegment(keyId)}`, {
    ...options,
    method: 'DELETE',
  });
}
