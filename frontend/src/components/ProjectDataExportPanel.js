import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  estimateProjectExportBundle,
  exportProjectBundleToS3,
  fetchProjectExportBundleResponse,
  importProjectBundle,
  importProjectBundleFromS3,
} from '../api/exports';
import { readResponseBlobWithProgress } from '../api/progress';

const EXPORT_OPTIONS = [
  {
    key: 'include_images',
    label: 'Loaded images',
    detail: 'Original image and voxel artifacts',
  },
  {
    key: 'include_overlays',
    label: 'Loaded overlays',
    detail: 'Overlay files and overlay image artifacts',
  },
  {
    key: 'include_metadata',
    label: 'Metadata',
    detail: 'Project, image, batch, part, and import mapping TOML',
  },
  {
    key: 'include_created_overlays',
    label: 'Created overlays',
    detail: 'Annotations, overlay layers, segmentation, and measurement runs',
  },
  {
    key: 'include_project_configuration',
    label: 'Project configuration',
    detail: 'Inspection configuration and interface defaults',
  },
];


function formatProgressBytes(bytes) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (safeBytes >= gb) return `${(safeBytes / gb).toFixed(2)} GB`;
  return `${(safeBytes / mb).toFixed(2)} MB`;
}

function formatBundleSize(bytes) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  const kb = 1024;
  if (safeBytes >= gb) return `${(safeBytes / gb).toFixed(2)} GB`;
  if (safeBytes >= mb) return `${(safeBytes / mb).toFixed(2)} MB`;
  if (safeBytes >= kb) return `${(safeBytes / kb).toFixed(1)} KB`;
  return `${safeBytes} bytes`;
}

function buildExportParams(options) {
  const params = new URLSearchParams();
  EXPORT_OPTIONS.forEach((option) => {
    params.set(option.key, options[option.key] ? 'true' : 'false');
  });
  return params;
}

function progressLabel(progress) {
  if (!progress) return '';
  const loaded = Math.max(0, progress.loaded || 0);
  const total = Math.max(progress.total || 0, loaded);
  return `${formatProgressBytes(loaded)} of ${formatProgressBytes(total)}`;
}

function progressPercent(progress) {
  if (!progress) return 0;
  const loaded = Math.max(0, progress.loaded || 0);
  const total = Math.max(progress.total || 0, loaded, 1);
  return Math.max(0, Math.min(100, (loaded / total) * 100));
}

function readStreamingBlobWithProgress(response, onProgress) {
  return readResponseBlobWithProgress(response, onProgress, {
    totalHeader: 'X-VISTA-Backup-Estimated-Bytes',
  });
}

function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const match = disposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : fallback;
}

function ProjectDataExportPanel({ projectId, projectName, counts = {}, setError, onImportComplete }) {
  const [options, setOptions] = useState(() => (
    EXPORT_OPTIONS.reduce((acc, option) => ({ ...acc, [option.key]: true }), {})
  ));
  const [exportState, setExportState] = useState({ loading: false, detail: null, progress: null });
  const [estimateState, setEstimateState] = useState({ loading: false, bytes: null, error: null });
  const [s3Url, setS3Url] = useState('');
  const [s3ImportUrl, setS3ImportUrl] = useState('');
  const [importState, setImportState] = useState({ loading: false, detail: null, file: null, mode: null, modalOpen: false });
  const importInputRef = useRef(null);

  const selectedCount = useMemo(
    () => Object.values(options).filter(Boolean).length,
    [options]
  );

  const hasProjectData = (counts.rawImages || 0) > 0
    || (counts.overlayImages || 0) > 0
    || (counts.annotations || 0) > 0
    || (counts.partsLoaded || 0) > 0
    || (counts.imageMetadata || 0) > 0;

  const exportParams = useMemo(() => buildExportParams(options), [options]);

  useEffect(() => {
    if (!projectId) return undefined;
    const controller = new AbortController();
    setEstimateState((prev) => ({ ...prev, loading: true, error: null }));
    estimateProjectExportBundle(projectId, Object.fromEntries(exportParams), {
      signal: controller.signal,
    })
      .then((payload) => {
        setEstimateState({
          loading: false,
          bytes: Number(payload.estimated_bytes) || 0,
          error: null,
        });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setEstimateState({ loading: false, bytes: null, error: 'Unable to estimate bundle size' });
      });
    return () => controller.abort();
  }, [projectId, exportParams]);

  const updateOption = (key, checked) => {
    setOptions((prev) => ({ ...prev, [key]: checked }));
  };

  const resetImportSelection = () => {
    setImportState({ loading: false, detail: null, file: null, mode: null, modalOpen: false });
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const runImportProjectData = async (file, mode) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);
    formData.append('confirmation', 'IMPORT');

    try {
      setImportState((prev) => ({ ...prev, loading: true, detail: null, modalOpen: false, mode }));
      const payload = await importProjectBundle(projectId, formData);
      const projectResult = payload.project || {};
      setImportState({
        loading: false,
        detail: `${mode === 'overwrite_active' ? 'Overwrote' : 'Appended'} project bundle: ${projectResult.images_created || 0} images imported.`,
        file: null,
        mode,
        modalOpen: false,
      });
      if (importInputRef.current) importInputRef.current.value = '';
      if (setError) setError(null);
      await onImportComplete?.(payload);
    } catch (err) {
      setImportState((prev) => ({ ...prev, loading: false, detail: null, modalOpen: false }));
      if (setError) setError(err.message || 'Failed to import project data');
    }
  };

  const handleImportFileSelected = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (hasProjectData) {
      setImportState({ loading: false, detail: null, file, mode: null, modalOpen: true });
      return;
    }
    runImportProjectData(file, 'append_active');
  };

  const confirmImportMode = (mode) => {
    if (!importState.file) return;
    runImportProjectData(importState.file, mode);
  };

  const exportProjectData = async () => {
    try {
      setExportState({ loading: true, detail: null, progress: { loaded: 0, total: 0 } });
      const response = await fetchProjectExportBundleResponse(projectId, Object.fromEntries(exportParams));
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Export failed (${response.status})`);
      }
      const blob = await readStreamingBlobWithProgress(response, (progress) => {
        setExportState((prev) => ({ ...prev, progress }));
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFromDisposition(
        response.headers.get('Content-Disposition'),
        `${projectName || 'project'}_export_bundle.zip`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      setExportState({
        loading: false,
        detail: `${selectedCount} export sections packaged as TOML manifests and project artifacts.`,
        progress: null,
      });
      if (setError) setError(null);
    } catch (err) {
      setExportState({ loading: false, detail: null, progress: null });
      if (setError) setError(err.message || 'Failed to export project data');
    }
  };



  const exportProjectDataToS3 = async () => {
    const trimmed = s3Url.trim();
    if (!trimmed) {
      if (setError) setError('Enter an S3 URL before exporting.');
      return;
    }
    try {
      setExportState({ loading: true, detail: null, progress: null });
      const payload = await exportProjectBundleToS3(projectId, {
        s3_url: trimmed,
        ...options,
      });
      setExportState({ loading: false, detail: `Project bundle exported to ${payload.s3_url || trimmed}.`, progress: null });
      if (setError) setError(null);
    } catch (err) {
      setExportState({ loading: false, detail: null, progress: null });
      if (setError) setError(err.message || 'Failed to export project bundle to S3');
    }
  };

  const importProjectDataFromS3 = async (mode) => {
    const trimmed = s3ImportUrl.trim();
    if (!trimmed) {
      if (setError) setError('Enter an S3 URL before importing.');
      return;
    }
    try {
      setImportState((prev) => ({ ...prev, loading: true, detail: null, modalOpen: false, mode }));
      const payload = await importProjectBundleFromS3(projectId, { s3_url: trimmed, mode, confirmation: 'IMPORT' });
      const projectResult = payload.project || {};
      setImportState({ loading: false, detail: `${mode === 'overwrite_active' ? 'Overwrote' : 'Appended'} S3 project bundle: ${projectResult.images_created || 0} images imported.`, file: null, mode, modalOpen: false });
      if (setError) setError(null);
      await onImportComplete?.(payload);
    } catch (err) {
      setImportState((prev) => ({ ...prev, loading: false, detail: null, modalOpen: false }));
      if (setError) setError(err.message || 'Failed to import project bundle from S3');
    }
  };

  return (
    <div className="card project-data-export-card">
      <div className="card-header">
        <h2>Export Data</h2>
      </div>
      <div className="card-content">
        <div className="export-data-summary" aria-label="Export data summary">
          <div>
            <strong>{counts.rawImages || 0}</strong>
            <span>Images</span>
          </div>
          <div>
            <strong>{counts.overlayImages || 0}</strong>
            <span>Overlays</span>
          </div>
          <div>
            <strong>{counts.annotations || 0}</strong>
            <span>Annotations</span>
          </div>
        </div>

        <div className="export-option-list" role="group" aria-label="Project export options">
          {EXPORT_OPTIONS.map((option) => (
            <label key={option.key} className="export-option-row">
              <input
                type="checkbox"
                checked={Boolean(options[option.key])}
                onChange={(event) => updateOption(option.key, event.target.checked)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="export-size-estimate" aria-live="polite">
          <span>Estimated bundle size</span>
          <strong>
            {estimateState.loading && estimateState.bytes === null
              ? 'Calculating...'
              : estimateState.error || formatBundleSize(estimateState.bytes)}
          </strong>
          <small>Actual ZIP size may be smaller after compression.</small>
        </div>

        <button
          type="button"
          className="btn btn-primary export-data-button"
          disabled={exportState.loading}
          onClick={exportProjectData}
        >
          {exportState.loading ? 'Exporting Project...' : 'Export Project Bundle'}
        </button>

        <div className="form-group project-data-s3-section">
          <label htmlFor="project-export-s3-url">Export bundle to S3</label>
          <input
            id="project-export-s3-url"
            type="text"
            className="form-control"
            value={s3Url}
            onChange={(event) => setS3Url(event.target.value)}
            placeholder="s3://bucket/path/project.vistabundle"
          />
          <button type="button" className="btn btn-secondary" disabled={exportState.loading || !s3Url.trim()} onClick={exportProjectDataToS3}>
            Export to S3
          </button>
        </div>

        {exportState.loading && exportState.progress && (
          <div
            role="status"
            aria-label="Project bundle export progress"
            style={{
              position: 'relative',
              height: '28px',
              borderRadius: '999px',
              background: 'var(--gray-200)',
              overflow: 'hidden',
              marginTop: 'var(--space-4)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: `${progressPercent(exportState.progress)}%`,
                height: '100%',
                background: 'var(--primary-color)',
                transition: 'width 120ms ease-out',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                color: 'var(--gray-900)',
              }}
            >
              {progressLabel(exportState.progress)}
            </div>
          </div>
        )}

        {exportState.detail && (
          <div className="alert alert-success export-data-status" data-testid="project-data-export-result">
            {exportState.detail}
          </div>
        )}

        <div className="project-data-import-section" aria-label="Project data import">
          <h3>Import Data</h3>
          <p>Load a VISTA project bundle into this active project.</p>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,.vistabundle,application/zip"
            aria-label="Choose project bundle to import"
            onChange={handleImportFileSelected}
            disabled={importState.loading}
          />
          <small>Supported formats: project export .zip or VISTA .vistabundle with one project.</small>
          <div className="form-group project-data-s3-section">
            <label htmlFor="project-import-s3-url">Import project bundle from S3</label>
            <input
              id="project-import-s3-url"
              type="text"
              className="form-control"
              value={s3ImportUrl}
              onChange={(event) => setS3ImportUrl(event.target.value)}
              placeholder="s3://bucket/path/project.vistabundle"
            />
            <button type="button" className="btn btn-secondary" disabled={importState.loading || !s3ImportUrl.trim()} onClick={() => importProjectDataFromS3(hasProjectData ? 'append_active' : 'append_active')}>
              Import from S3
            </button>
          </div>
          {importState.loading && (
            <div role="status" className="export-data-status">Importing project bundle...</div>
          )}
          {importState.detail && (
            <div className="alert alert-success export-data-status" data-testid="project-data-import-result">
              {importState.detail}
            </div>
          )}
        </div>
      </div>

      {importState.modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="project-import-mode-title">
            <h2 id="project-import-mode-title">Import into non-blank project?</h2>
            <p>
              This project already has data. Choose whether the bundle should replace the current active project data
              or be appended alongside it. Appended duplicate filenames are tagged with “(duplicate)”.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-danger" onClick={() => confirmImportMode('overwrite_active')}>
                Overwrite Current Project
              </button>
              <button type="button" className="btn btn-primary" onClick={() => confirmImportMode('append_active')}>
                Append to Current Project
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetImportSelection}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectDataExportPanel;
