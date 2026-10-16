import { apiFetch, apiJson, encodePathSegment } from './client';

export function fetchImage(imageId, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}`, options);
}

export function fetchImageComments(imageId, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/comments`, options);
}

export function createImageComment(imageId, text, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/comments`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function updateImageComment(commentId, text, options = {}) {
  return apiJson(`/api/comments/${encodePathSegment(commentId)}`, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
}

export function deleteImageComment(commentId, options = {}) {
  return apiJson(`/api/comments/${encodePathSegment(commentId)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function fetchImageClassifications(imageId, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/classifications`, options);
}

export function createImageClassification(imageId, classId, options = {}) {
  const encodedImageId = encodePathSegment(imageId);
  return apiJson(`/api/images/${encodedImageId}/classifications`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      image_id: String(imageId),
      class_id: String(classId),
    }),
  });
}

export function deleteImageClassification(classificationId, options = {}) {
  return apiJson(`/api/classifications/${encodePathSegment(classificationId)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function fetchImageReviews(imageId, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/reviews`, options);
}

export function createImageReview(imageId, status, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/reviews`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function deleteImageReview(reviewId, options = {}) {
  return apiJson(`/api/reviews/${encodePathSegment(reviewId)}`, {
    ...options,
    method: 'DELETE',
  });
}

export function deleteProjectImage(projectId, imageId, { reason, force = false } = {}, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/images/${encodePathSegment(imageId)}`, {
    ...options,
    method: 'DELETE',
    body: JSON.stringify({ reason, force }),
  });
}

// Raw Response: callers read image bytes as a blob.
export function fetchImageContentResponse(imageId, options = {}) {
  const path = `/api/images/${encodePathSegment(imageId)}/content`;
  return apiFetch(path, options);
}

export function fetchImageDownloadResponse(imageId, options = {}) {
  const path = `/api/images/${encodePathSegment(imageId)}/download`;
  return apiFetch(path, options);
}

export function fetchImageVolumeMetadata(imageId, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/volume-metadata`, options);
}

export function fetchImageVolumeRenderSummary(imageId, summaryVersion, options = {}) {
  const query = new URLSearchParams({ summary: summaryVersion });
  return apiJson(`/api/images/${encodePathSegment(imageId)}/volume-render-summary?${query.toString()}`, options);
}

export function runImageVolumeConnectedSelection(imageId, payload, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/volume-connected-selection`, {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function restoreProjectImage(projectId, imageId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/images/${encodePathSegment(imageId)}/restore`, {
    ...options,
    method: 'POST',
  });
}

export function fetchProjectImageReviewStatuses(projectId, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/image-review-statuses`, options);
}

export function fetchProjectImages(projectId, params = {}, options = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const queryString = query.toString();
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/images${queryString ? `?${queryString}` : ''}`, options);
}

export function uploadProjectImage(projectId, formData, options = {}) {
  return apiJson(`/api/projects/${encodePathSegment(projectId)}/images`, {
    ...options,
    method: 'POST',
    body: formData,
  });
}

export function updateImageMetadata(imageId, key, value, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/metadata`, {
    ...options,
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });
}

// Raw Response: ImageView treats any 2xx as an acknowledged write even when the
// response body is missing or malformed, which apiJson would reject.
export function updateImageMetadataResponse(imageId, key, value, options = {}) {
  return apiFetch(`/api/images/${encodePathSegment(imageId)}/metadata`, {
    ...options,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify({ key, value }),
  });
}

export function deleteImageMetadata(imageId, key, options = {}) {
  return apiJson(`/api/images/${encodePathSegment(imageId)}/metadata/${encodePathSegment(key)}`, {
    ...options,
    method: 'DELETE',
  });
}
