import { apiJson, encodePathSegment } from './client';

function jsonBody(method, payload, options = {}) {
  return {
    ...options,
    method,
    body: JSON.stringify(payload ?? {}),
  };
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, String(item)));
      return;
    }
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function fetchAccessGroups(options = {}) {
  return apiJson('/api/users/me/access-groups', options);
}

export function fetchFolderTree(metaGroupId, { includeArchived = false } = {}, options = {}) {
  return apiJson(
    `/api/folders/tree${buildQuery({ meta_group_id: metaGroupId, include_archived: includeArchived })}`,
    options,
  );
}

export function fetchDashboardItems(params = {}, options = {}) {
  return apiJson(`/api/dashboard/items${buildQuery(params)}`, options);
}

export function createFolder(payload, options = {}) {
  return apiJson('/api/folders', jsonBody('POST', payload, options));
}

export function updateFolder(folderId, payload, options = {}) {
  return apiJson(`/api/folders/${encodePathSegment(folderId)}`, jsonBody('PATCH', payload, options));
}

export function moveFolder(folderId, parentId, options = {}) {
  return apiJson(
    `/api/folders/${encodePathSegment(folderId)}/move`,
    jsonBody('POST', { parent_id: parentId || null }, options),
  );
}

export function archiveFolder(folderId, options = {}) {
  return apiJson(`/api/folders/${encodePathSegment(folderId)}/archive`, { ...options, method: 'POST' });
}

export function unarchiveFolder(folderId, options = {}) {
  return apiJson(`/api/folders/${encodePathSegment(folderId)}/unarchive`, { ...options, method: 'POST' });
}

export function fetchFolderDeletePreview(folderId, options = {}) {
  return apiJson(`/api/folders/${encodePathSegment(folderId)}/delete-preview`, options);
}

export function deleteFolder(folderId, confirmationPhrase, options = {}) {
  return apiJson(
    `/api/folders/${encodePathSegment(folderId)}`,
    jsonBody('DELETE', { confirmation_phrase: confirmationPhrase }, options),
  );
}

export function moveProject(projectId, folderId, options = {}) {
  return apiJson(
    `/api/projects/${encodePathSegment(projectId)}/move`,
    jsonBody('POST', { folder_id: folderId || null }, options),
  );
}

export function bulkMove(items, targetFolderId, options = {}) {
  return apiJson(
    '/api/dashboard/bulk/move',
    jsonBody('POST', { items, target_folder_id: targetFolderId || null }, options),
  );
}

export function bulkArchive(items, archived, options = {}) {
  return apiJson('/api/dashboard/bulk/archive', jsonBody('POST', { items, archived }, options));
}
