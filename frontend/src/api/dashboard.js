import { apiFetch, apiJson } from './client';

const DASHBOARD_BACKUP_DEFAULTS = {
  include_images: true,
  include_overlays: true,
  include_metadata: true,
  include_created_overlays: true,
  include_project_configuration: true,
  include_ui_state: true,
};

function buildDashboardBackupPayload(dashboardState, extra = {}) {
  return {
    ...DASHBOARD_BACKUP_DEFAULTS,
    ...extra,
    dashboard_state: dashboardState,
  };
}

function jsonPostOptions(payload, options = {}) {
  return {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload),
  };
}

// Raw Response: the caller streams the archive with download progress.
export function exportDashboardBackupResponse(dashboardState, options = {}) {
  return apiFetch('/api/dashboard/export', jsonPostOptions(
    buildDashboardBackupPayload(dashboardState),
    options,
  ));
}

export function exportDashboardBackupToS3(s3Url, dashboardState, options = {}) {
  return apiJson('/api/dashboard/export/s3', jsonPostOptions(
    buildDashboardBackupPayload(dashboardState, { s3_url: s3Url }),
    options,
  ));
}

export function importDashboardBackupFromS3(s3Url, options = {}) {
  return apiJson('/api/dashboard/import/s3', jsonPostOptions({
    s3_url: s3Url,
    mode: 'restore_as_new',
    confirmation: 'IMPORT',
  }, options));
}

export function previewDashboardImport(formData, options = {}) {
  return apiJson('/api/dashboard/import/preview', {
    ...options,
    method: 'POST',
    body: formData,
  });
}

export function importDashboardBackup(formData, options = {}) {
  return apiJson('/api/dashboard/import', {
    ...options,
    method: 'POST',
    body: formData,
  });
}

export function fetchDashboardVersion(options = {}) {
  return apiJson('/api/dashboard/settings/version', options);
}

export function fetchDashboardDatabaseUrl(options = {}) {
  return apiJson('/api/dashboard/settings/database-url', options);
}

export function previewDashboardDatabaseUrl(databaseUrl, options = {}) {
  return apiJson('/api/dashboard/settings/database-url/preview', jsonPostOptions({
    database_url: databaseUrl,
  }, options));
}

export function acceptDashboardDatabaseUrl(databaseUrl, options = {}) {
  return apiJson('/api/dashboard/settings/database-url/accept', jsonPostOptions({
    database_url: databaseUrl,
  }, options));
}
