import { apiJson, encodePathSegment } from './client';

export function fetchProjectGroups(projectId, params = {}, options = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const queryString = query.toString();
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/groups${queryString ? `?${queryString}` : ''}`, options);
}

export function fetchProjectUngroupedCount(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/ungrouped-count`, options);
}

export function fetchGroup(groupId, options = {}) {
  return apiJson(`/api/groups/${encodePathSegment(groupId)}`, options);
}

export function deleteGroup(groupId, options = {}) {
  return apiJson(`/api/groups/${encodePathSegment(groupId)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function assignImagesToGroup(groupId, imageIds, options = {}) {
  return apiJson(`/api/groups/${encodePathSegment(groupId)}/images`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(imageIds),
  });
}

export function removeImagesFromGroup(groupId, imageIds, options = {}) {
  return apiJson(`/api/groups/${encodePathSegment(groupId)}/images`, {
    ...options,
    method: 'DELETE',
    body: JSON.stringify(imageIds),
  });
}
