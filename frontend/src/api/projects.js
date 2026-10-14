import { apiFetch, apiJson, encodePathSegment } from './client';

export function fetchProjects({ includeArchived = false } = {}, options = {}) {
  const query = includeArchived ? '?include_archived=true' : '';
  return apiJson(`/api/projects/${query}`, options);
}

// Raw Response: the dashboard builds debug diagnostics from response headers.
export function fetchProjectsResponse({ includeArchived = false } = {}, options = {}) {
  const query = includeArchived ? '?include_archived=true' : '';
  return apiFetch(`/api/projects/${query}`, options);
}

export function fetchProject(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}`, options);
}

export function fetchProjectDataSummary(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/data-summary`, options);
}

export function runProjectIngest(projectId, ingestPayload, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/ingest`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(ingestPayload),
  });
}

// Raw Response helpers below serve ImageUploader's S3 import, which derives
// completion-unknown state from HTTP status and unreadable 2xx bodies.
export function listProjectS3ObjectsResponse(projectId, s3Url, options = {}) {
  return apiFetch(`/api/projects/${encodePathSegment(projectId)}/s3/list`, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify({ s3_url: s3Url }),
  });
}

export function importProjectS3ObjectsResponse(projectId, payload, options = {}) {
  return apiFetch(`/api/projects/${encodePathSegment(projectId)}/s3/import`, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload),
  });
}

export function loadProjectTestData(projectId, { fixture } = {}, options = {}) {
  const query = fixture ? `?fixture=${encodeURIComponent(fixture)}` : '';
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/load-test-data${query}`, {
    ...options,
    method: 'POST',
  });
}

export function fetchProjectConfiguration(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/configuration`, options);
}

export function fetchProjectWorkspaceState(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/workspace-state`, options);
}

export function updateProjectConfiguration(projectId, config, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/configuration`, {
    ...options,
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

export function updateProjectWorkspaceState(projectId, state, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/workspace-state`, {
    ...options,
    method: 'PUT',
    body: JSON.stringify({ state }),
  });
}

export function saveProjectInterfaceLayoutDefault(projectId, layoutModel, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/configuration/interface-layout/default`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ layout_model: layoutModel }),
  });
}

export function saveProjectTypeInterfaceLayoutDefault(projectId, layoutModel, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/configuration/interface-layout/project-type-default`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ layout_model: layoutModel }),
  });
}

export function cloneProjectConfiguration(projectId, sourceProjectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/configuration/clone`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ source_project_id: sourceProjectId }),
  });
}

export function fetchProjectReviewStatus(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/review-status`, options);
}

export function fetchProjectMetadataDictionary(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/metadata-dict`, options);
}

export function updateProjectMetadataDictionary(projectId, metadata, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/metadata-dict`, {
    ...options,
    method: 'PUT',
    body: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
  });
}

export function updateProjectMetadata(projectId, key, value, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/metadata/${encodePathSegment(key)}`, {
    ...options,
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });
}

export function fetchProjectMetadata(projectId, key, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/metadata/${encodePathSegment(key)}`, options);
}

export function setProjectMetadata(projectId, key, value, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/metadata`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ key, value }),
  });
}

export function deleteProjectMetadata(projectId, key, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/metadata/${encodePathSegment(key)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function createProject(projectData, options = {}) {
  return apiJson('/api/projects/', {
    ...options,
    method: 'POST',
    body: JSON.stringify(projectData),
  });
}

export function updateProject(projectId, projectData, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}`, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(projectData),
  });
}

export function deleteProject(projectId, confirmationPhrase, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}`, {
    ...options,
    method: 'DELETE',
    body: JSON.stringify({ confirmation_phrase: confirmationPhrase }),
  });
}

export function archiveProject(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/archive`, {
    ...options,
    method: 'PATCH',
  });
}

export function unarchiveProject(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/unarchive`, {
    ...options,
    method: 'PATCH',
  });
}
