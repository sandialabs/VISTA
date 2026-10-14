import { apiJson, encodePathSegment } from './client';

export function fetchProjectClasses(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/classes`, options);
}

export function createImageClass(projectId, classData, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/classes`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      name: classData.name,
      description: classData.description,
    }),
  });
}

export function updateImageClass(classId, classData, options = {}) {
  return apiJson(`/api/classes/${encodePathSegment(classId)}`, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify({
      name: classData.name,
      description: classData.description,
    }),
  });
}

export function deleteImageClass(classId, options = {}) {
  return apiJson(`/api/classes/${encodePathSegment(classId)}`, {
    ...options,
    method: 'DELETE',
  });
}
