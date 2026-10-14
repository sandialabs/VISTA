import { apiJson, encodePathSegment } from './client';

export function fetchProjectBatches(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/batches`, options);
}

export function createProjectBatch(projectId, batchData, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/batches`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(batchData),
  });
}

export function updateProjectBatch(projectId, batchId, patch, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/batches/${encodePathSegment(batchId)}`, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteProjectBatch(projectId, batchId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/batches/${encodePathSegment(batchId)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function assignPartToBatch(projectId, partId, toBatchId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/parts/batch-assignments`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ part_id: partId, to_batch_id: toBatchId || null }),
  });
}
