import { apiJson, encodePathSegment } from './client';

export function fetchProjectParts(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/parts`, options);
}

function projectPartsPath(projectId, suffix = '') {
  return `/api/projects/${encodePathSegment(projectId)}/parts${suffix}`;
}

function projectPartPath(projectId, partId, suffix = '') {
  return projectPartsPath(projectId, `/${encodePathSegment(partId)}${suffix}`);
}

export function fetchPartAnnotations(projectId, partId, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/annotations'), options);
}

export function savePartAnnotation(projectId, partId, annotation, annotationId = '', options = {}) {
  const suffix = annotationId
    ? `/annotations/${encodePathSegment(annotationId)}`
    : '/annotations';
  return apiJson(projectPartPath(projectId, partId, suffix), {
    ...options,
    method: annotationId ? 'PATCH' : 'POST',
    body: JSON.stringify(annotation),
  });
}

export function deletePartAnnotation(projectId, partId, annotationId, options = {}) {
  return apiJson(projectPartPath(projectId, partId, `/annotations/${encodePathSegment(annotationId)}`), {
    ...options,
    method: 'DELETE',
  });
}

export function runPartSliceSegmentation(projectId, partId, payload, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/slice-segmentation'), {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createProjectPart(projectId, part, options = {}) {
  return apiJson(projectPartsPath(projectId), {
    ...options,
    method: 'POST',
    body: JSON.stringify(part),
  });
}

export function updateProjectPart(projectId, partId, patch, options = {}) {
  return apiJson(projectPartPath(projectId, partId), {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function updatePartImageDisplayOrder(projectId, partId, imageRefs, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/image-display-order'), {
    ...options,
    method: 'PUT',
    body: JSON.stringify({ image_refs: imageRefs }),
  });
}

export function updatePartSourceImage(projectId, partId, imageKey, patch, options = {}) {
  return apiJson(projectPartPath(projectId, partId, `/source-images/${encodePathSegment(imageKey)}`), {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function assignImageToPart(projectId, assignment, options = {}) {
  return apiJson(projectPartsPath(projectId, '/image-assignments'), {
    ...options,
    method: 'POST',
    body: JSON.stringify(assignment),
  });
}

export function deleteProjectPart(projectId, partId, options = {}) {
  return apiJson(projectPartPath(projectId, partId), {
    errorLabel: 'Failed to delete part',
    ...options,
    method: 'DELETE',
  });
}

export function fetchPartVolumeSplatAssetStatus(projectId, partId, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/volume-splat-assets/status'), options);
}

export function createPartVolumeSplatAsset(projectId, partId, payload, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/volume-splat-assets'), {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchPartRealGaussianSplatAssetStatus(projectId, partId, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/real-gaussian-splat-assets/status'), options);
}

export function createPartRealGaussianSplatAsset(projectId, partId, payload, options = {}) {
  return apiJson(projectPartPath(projectId, partId, '/real-gaussian-splat-assets'), {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function unloadProjectParts(projectId, options = {}) {
  return apiJson(projectPartsPath(projectId), {
    errorLabel: 'Failed to unload all parts',
    ...options,
    method: 'DELETE',
  });
}

export function updatePartMetadataSources(projectId, partId, metadataSourceKeys, options = {}) {
  return apiJson(
    `/api/projects/${encodePathSegment(projectId)}/parts/${encodePathSegment(partId)}/metadata-sources`,
    {
      ...options,
      method: 'PUT',
      body: JSON.stringify({ metadata_source_keys: metadataSourceKeys }),
    }
  );
}

export function updateOverlayAssignment(projectId, assignment, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/parts/overlay-assignments`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(assignment),
  });
}
