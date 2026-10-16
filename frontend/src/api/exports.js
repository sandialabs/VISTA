import { apiFetch, apiJson, encodePathSegment } from './client';

// Helpers with a Response suffix return the raw fetch Response because callers
// need binary bodies, download headers, or streamed progress.
function projectExportPath(projectId, suffix) {
  return `/api/projects/${encodePathSegment(projectId)}${suffix}`;
}

function buildExportOptionsQuery(options = {}) {
  const query = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value));
    }
  });
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

export function fetchProjectExportBundleSummary(projectId, options = {}) {
  return apiJson(projectExportPath(projectId, '/export-bundle-json'), options);
}

export function fetchProjectReport(projectId, { schemaVersion = 3 } = {}, options = {}) {
  const query = new URLSearchParams({ schema_version: String(schemaVersion) });
  return apiJson(projectExportPath(projectId, `/report-json?${query.toString()}`), options);
}

export function fetchProjectExportBundleArchiveResponse(projectId, options = {}) {
  const path = projectExportPath(projectId, '/export-bundle');
  return apiFetch(path, options);
}

export function estimateProjectExportBundle(projectId, exportOptions = {}, options = {}) {
  return apiJson(
    projectExportPath(projectId, `/export-bundle/estimate${buildExportOptionsQuery(exportOptions)}`),
    options
  );
}

export function fetchProjectExportBundleResponse(projectId, exportOptions = {}, options = {}) {
  const path = projectExportPath(projectId, `/export-bundle${buildExportOptionsQuery(exportOptions)}`);
  return apiFetch(path, options);
}

export function importProjectBundle(projectId, formData, options = {}) {
  return apiJson(projectExportPath(projectId, '/import'), {
    ...options,
    method: 'POST',
    body: formData,
  });
}

export function exportProjectBundleToS3(projectId, payload, options = {}) {
  return apiJson(projectExportPath(projectId, '/export-bundle/s3'), {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function importProjectBundleFromS3(projectId, payload, options = {}) {
  return apiJson(projectExportPath(projectId, '/import/s3'), {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchProjectReportPdfResponse(projectId, { schemaVersion = 3 } = {}, options = {}) {
  const query = new URLSearchParams({ schema_version: String(schemaVersion) });
  const path = projectExportPath(projectId, `/report-pdf?${query.toString()}`);
  return apiFetch(path, options);
}

export function fetchProjectReportWithImagesPdfResponse(projectId, options = {}) {
  const path = projectExportPath(projectId, '/report-with-images-pdf');
  return apiFetch(path, options);
}

export function fetchProjectExcelExportResponse(projectId, options = {}) {
  const path = projectExportPath(projectId, '/export-excel');
  return apiFetch(path, options);
}
