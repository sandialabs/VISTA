import React, { memo, useRef, useState } from 'react';
import {
  exportDashboardBackupResponse,
  exportDashboardBackupToS3,
  importDashboardBackupFromS3,
  importDashboardBackup,
  previewDashboardImport,
} from '../../../api/dashboard';
import { rethrowWithServerDetail } from '../../../api/client';
import { readResponseBlobWithProgress } from '../../../api/progress';

function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const match = disposition.match(/filename="?([^";]+)"?/);
  return match ? match[1] : fallback;
}

function formatProgressBytes(bytes) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  if (safeBytes >= gb) return `${(safeBytes / gb).toFixed(2)} GB`;
  return `${(safeBytes / mb).toFixed(2)} MB`;
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

function collectDashboardState() {
  const galleryState = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('gallery_state_')) {
        galleryState[key] = JSON.parse(window.localStorage.getItem(key));
      }
    }
  } catch (error) {
  }
  return { gallery_state: galleryState, exported_at: new Date().toISOString() };
}

function restoreDashboardState(dashboardState) {
  if (!dashboardState || typeof dashboardState !== 'object') return 0;
  const galleryState = dashboardState.gallery_state || {};
  let restored = 0;
  Object.entries(galleryState).forEach(([key, value]) => {
    if (!key.startsWith('gallery_state_')) return;
    window.localStorage.setItem(key, JSON.stringify(value));
    restored += 1;
  });
  return restored;
}

const DashboardBackupPanel = memo(function DashboardBackupPanel({ onImportComplete, showToast, compact = false }) {
  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [exportProgress, setExportProgress] = useState(null);
  const [exportS3Url, setExportS3Url] = useState('');
  const [importS3Url, setImportS3Url] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  const resetImportSelection = () => {
    setSelectedFile(null);
    setPreview(null);
    setPreviewing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const closeImportModal = () => {
    if (importing) return;
    setShowImportModal(false);
    resetImportSelection();
  };

  const openImportModal = () => {
    resetImportSelection();
    setShowImportModal(true);
  };

  const downloadBlob = (blob, disposition) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filenameFromDisposition(disposition, 'vista-dashboard-backup.vistabundle');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  };

  const handleExportDashboard = async () => {
    setExporting(true);
    try {
      const response = await exportDashboardBackupResponse(collectDashboardState());
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Export failed (${response.status})`);
      }
      const blob = await readStreamingBlobWithProgress(response, setExportProgress);
      downloadBlob(blob, response.headers.get('Content-Disposition'));
      showToast('Dashboard backup exported successfully.', 'success');
    } catch (error) {
      showToast(error.message || 'Failed to export dashboard backup.', 'error');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  const handleExportDashboardToS3 = async () => {
    const trimmed = exportS3Url.trim();
    if (!trimmed) {
      showToast('Enter an S3 URL before exporting.', 'error');
      return;
    }
    setExporting(true);
    try {
      const payload = await exportDashboardBackupToS3(trimmed, collectDashboardState());
      showToast(`Dashboard backup exported to ${payload.s3_url || trimmed}.`, 'success');
    } catch (error) {
      showToast(error.message || 'Failed to export dashboard backup to S3.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImportDashboardFromS3 = async () => {
    const trimmed = importS3Url.trim();
    if (!trimmed) {
      showToast('Enter an S3 URL before importing.', 'error');
      return;
    }
    setImporting(true);
    try {
      const payload = await importDashboardBackupFromS3(trimmed);
      restoreDashboardState(payload.dashboard_state);
      showToast(`Imported ${payload.project_count || 0} project backup(s) from S3.`, 'success');
      onImportComplete?.();
    } catch (error) {
      showToast(error.message || 'Failed to import dashboard backup from S3.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files && event.target.files[0];
    setSelectedFile(file || null);
    setPreview(null);
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setPreviewing(true);
    try {
      const payload = await previewDashboardImport(formData).catch(rethrowWithServerDetail('Preview failed'));
      setPreview(payload);
    } catch (error) {
      showToast(error.message || 'Failed to inspect dashboard backup.', 'error');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setPreviewing(false);
    }
  };

  const handleImportDashboard = async () => {
    if (!selectedFile) {
      fileInputRef.current?.focus();
      showToast('Choose a dashboard backup file before importing.', 'error');
      return;
    }
    if (!preview) {
      showToast('Inspect the backup before importing.', 'error');
      return;
    }
    setImporting(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('mode', 'restore_as_new');
    formData.append('confirmation', 'IMPORT');
    try {
      const payload = await importDashboardBackup(formData).catch(rethrowWithServerDetail('Import failed'));
      // UI state is optional and restored from a best-effort sidecar if users re-select a compatible backup later.
      restoreDashboardState(payload.dashboard_state);
      showToast(`Imported ${payload.project_count || 0} project backup(s).`, 'success');
      setShowImportModal(false);
      resetImportSelection();
      onImportComplete?.();
    } catch (error) {
      showToast(error.message || 'Failed to import dashboard backup.', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={`card dashboard-backup-card${compact ? ' dashboard-backup-card-compact' : ''}`}>
      <div className="card-content">
        <div className="flex justify-between items-center gap-4">
          <div>
            <h2 id="dashboard-backup-settings-title" style={{ marginTop: 0 }}>Dashboard Backup</h2>
            <p style={{ color: 'var(--gray-600)', marginBottom: 0 }}>
              Save or restore VISTA projects, artifacts, metadata, and dashboard preferences with a portable .vistabundle file.
            </p>
          </div>
          <div className="flex gap-4">
            <button type="button" className="btn btn-secondary" onClick={handleExportDashboard} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export Dashboard'}
            </button>
            <button type="button" className="btn btn-primary" onClick={openImportModal} disabled={importing}>
              Import Dashboard
            </button>
          </div>
        </div>
        <div className="dashboard-s3-backup-section">
          <div className="form-group">
            <label htmlFor="dashboard-export-s3-url">Export dashboard to S3</label>
            <input id="dashboard-export-s3-url" className="form-control" type="text" value={exportS3Url} onChange={(event) => setExportS3Url(event.target.value)} placeholder="s3://bucket/path/dashboard.vistabundle" />
            <button type="button" className="btn btn-secondary" onClick={handleExportDashboardToS3} disabled={exporting || !exportS3Url.trim()}>Export to S3</button>
          </div>
          <div className="form-group">
            <label htmlFor="dashboard-import-s3-url">Import dashboard from S3</label>
            <input id="dashboard-import-s3-url" className="form-control" type="text" value={importS3Url} onChange={(event) => setImportS3Url(event.target.value)} placeholder="s3://bucket/path/dashboard.vistabundle" />
            <button type="button" className="btn btn-primary" onClick={handleImportDashboardFromS3} disabled={importing || !importS3Url.trim()}>Import from S3</button>
          </div>
        </div>
        {exporting && exportProgress && (
          <div
            role="status"
            aria-label="Dashboard backup export progress"
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
                width: `${progressPercent(exportProgress)}%`,
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
              {progressLabel(exportProgress)}
            </div>
          </div>
        )}
      </div>

      {showImportModal && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-dashboard-title">
          <div className="modal-content dashboard-import-modal">
            <div className="modal-header">
              <h3 id="import-dashboard-title">Import Dashboard</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeImportModal}
                disabled={importing}
                aria-label="Close import dashboard modal"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="dashboard-import-description">
                Choose a VISTA dashboard backup file to inspect before importing projects as new dashboard entries.
              </p>
              <div className="form-group">
                <label htmlFor="dashboard-import-file">Dashboard backup file</label>
                <input
                  ref={fileInputRef}
                  id="dashboard-import-file"
                  type="file"
                  accept=".vistabundle,.zip,application/zip"
                  onChange={handleFileSelected}
                  className="form-control"
                  disabled={importing || previewing}
                />
                <small className="form-text">Supported formats: .vistabundle or .zip dashboard backups.</small>
              </div>
              {previewing && (
                <div role="status" className="alert alert-info dashboard-import-status">
                  Inspecting dashboard backup…
                </div>
              )}
              {preview && (
                <div className="alert alert-success dashboard-import-status">
                  Backup ready: {preview.project_count} project(s), {preview.missing_artifacts?.length || 0} missing artifact(s).
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={closeImportModal} disabled={importing}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleImportDashboard}
                disabled={importing || previewing || !selectedFile || !preview}
              >
                {importing ? 'Importing…' : 'Import Dashboard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default DashboardBackupPanel;
