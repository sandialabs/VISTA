import { apiJson, encodePathSegment } from './client';

function projectNcrsPath(projectId) {
  return `/api/projects/${encodePathSegment(projectId)}/ncrs`;
}

function partNcrsPath(projectId, partId, suffix = '') {
  return `/api/projects/${encodePathSegment(projectId)}/parts/${encodePathSegment(partId)}/ncrs${suffix}`;
}

function partNcrPath(projectId, partId, ncrId, suffix = '') {
  return partNcrsPath(projectId, partId, `/${encodePathSegment(ncrId)}${suffix}`);
}

export function fetchProjectNcrs(projectId, options = {}) {
  return apiJson(projectNcrsPath(projectId), {
    errorLabel: 'Failed to load NCRs',
    ...options,
  });
}

const INCLUDE_DELETED_QUERY = '?include_deleted=true';

export function fetchPartNcrs(projectId, partId, options = {}) {
  const { includeDeleted = false, ...requestOptions } = options;
  return apiJson(`${partNcrsPath(projectId, partId)}${includeDeleted ? INCLUDE_DELETED_QUERY : ''}`, {
    errorLabel: 'Failed to load NCRs',
    ...requestOptions,
  });
}

export function fetchPartNcr(projectId, partId, ncrId, options = {}) {
  const { includeDeleted = false, ...requestOptions } = options;
  return apiJson(`${partNcrPath(projectId, partId, ncrId)}${includeDeleted ? INCLUDE_DELETED_QUERY : ''}`, {
    errorLabel: 'Failed to load NCR',
    ...requestOptions,
  });
}

export function createPartNcr(projectId, partId, ncr, options = {}) {
  return apiJson(partNcrsPath(projectId, partId), {
    errorLabel: 'Failed to create NCR',
    ...options,
    method: 'POST',
    body: JSON.stringify(ncr),
  });
}

export function updatePartNcr(projectId, partId, ncrId, changes, options = {}) {
  return apiJson(partNcrPath(projectId, partId, ncrId), {
    errorLabel: 'Failed to save NCR',
    ...options,
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function approvePartNcr(projectId, partId, ncrId, expectedVersion, options = {}) {
  return apiJson(partNcrPath(projectId, partId, ncrId, '/approve'), {
    errorLabel: 'Failed to approve NCR',
    ...options,
    method: 'POST',
    body: JSON.stringify(expectedVersion ? { expected_version: expectedVersion } : {}),
  });
}

export function deletePartNcr(projectId, partId, ncrId, expectedVersion, options = {}) {
  const query = expectedVersion ? `?expected_version=${encodeURIComponent(expectedVersion)}` : '';
  return apiJson(partNcrPath(projectId, partId, ncrId, query), {
    errorLabel: 'Failed to delete NCR',
    ...options,
    method: 'DELETE',
  });
}
