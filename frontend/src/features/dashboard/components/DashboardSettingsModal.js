import React, { memo, useEffect, useRef, useState } from 'react';
import DashboardBackupPanel from './DashboardBackupPanel';
import {
  acceptDashboardDatabaseUrl,
  fetchDashboardDatabaseUrl,
  fetchDashboardVersion,
  previewDashboardDatabaseUrl,
} from '../../../api/dashboard';
import { getProjectTypeLabel } from '../../../projectTypes';

const DashboardSettingsModal = memo(function DashboardSettingsModal({ onClose, showToast, onImportComplete, onDatabaseAccepted, debugMode, onDebugModeChange }) {
  const [currentDatabaseUrl, setCurrentDatabaseUrl] = useState('');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [loadingCurrentUrl, setLoadingCurrentUrl] = useState(true);
  const [previewingDatabase, setPreviewingDatabase] = useState(false);
  const [acceptingDatabase, setAcceptingDatabase] = useState(false);
  const [databasePreview, setDatabasePreview] = useState(null);
  const [databaseError, setDatabaseError] = useState('');
  const [gitlabCommitSha, setGitlabCommitSha] = useState('');
  const [loadingVersionInfo, setLoadingVersionInfo] = useState(true);
  const [versionError, setVersionError] = useState('');
  const mountedRef = useRef(true);
  const databaseUrlRef = useRef('');
  const previewRequestRef = useRef({ generation: 0, controller: null, pending: false });
  const acceptPendingRef = useRef(false);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    setLoadingCurrentUrl(true);
    setLoadingVersionInfo(true);
    fetchDashboardVersion()
      .then((payload) => {
        if (!active) return;
        if (typeof payload.gitlab_commit_sha === 'string') {
          setGitlabCommitSha(payload.gitlab_commit_sha.trim());
          setVersionError('');
        } else if (payload.gitlab_commit_sha === undefined) {
          setGitlabCommitSha('');
          setVersionError('');
        } else {
          setGitlabCommitSha('');
          setVersionError('The version information response was invalid.');
        }
      })
      .catch((error) => {
        if (!active) return;
        setGitlabCommitSha('');
        setVersionError(error.message || 'Unable to load version information.');
      })
      .finally(() => {
        if (active) setLoadingVersionInfo(false);
      });
    fetchDashboardDatabaseUrl()
      .then((payload) => {
        if (!active) return;
        const loadedUrl = typeof payload.database_url === 'string'
          ? payload.database_url
          : '';
        setCurrentDatabaseUrl(loadedUrl);
        setDatabaseUrl(loadedUrl);
        databaseUrlRef.current = loadedUrl;
        if (payload.database_url !== undefined && typeof payload.database_url !== 'string') {
          setDatabaseError('The current database URL response was invalid.');
        }
      })
      .catch((error) => {
        if (!active) return;
        setDatabaseError(error.message || 'Unable to load the current Postgres URL.');
      })
      .finally(() => {
        if (active) setLoadingCurrentUrl(false);
      });
    return () => {
      active = false;
      mountedRef.current = false;
      previewRequestRef.current.generation += 1;
      previewRequestRef.current.pending = false;
      previewRequestRef.current.controller?.abort();
      previewRequestRef.current.controller = null;
    };
  }, []);

  const trimmedDatabaseUrl = databaseUrl.trim();
  const hasDatabaseUrlChange = trimmedDatabaseUrl && trimmedDatabaseUrl !== currentDatabaseUrl;

  const cancelPreviewRequest = () => {
    previewRequestRef.current.generation += 1;
    previewRequestRef.current.pending = false;
    previewRequestRef.current.controller?.abort();
    previewRequestRef.current.controller = null;
    setPreviewingDatabase(false);
  };

  const handlePreviewDatabase = async () => {
    const requestedDatabaseUrl = databaseUrlRef.current.trim();
    if (!requestedDatabaseUrl || requestedDatabaseUrl === currentDatabaseUrl) {
      setDatabaseError('Enter a new Postgres URL before previewing.');
      return;
    }
    if (previewRequestRef.current.pending || acceptPendingRef.current) return;

    const controller = new AbortController();
    const generation = previewRequestRef.current.generation + 1;
    previewRequestRef.current = { generation, controller, pending: true };
    setDatabaseError('');
    setDatabasePreview(null);
    setPreviewingDatabase(true);
    try {
      const previewPayload = await previewDashboardDatabaseUrl(requestedDatabaseUrl, {
        signal: controller.signal,
      });
      if (
        !previewPayload
        || typeof previewPayload.database_url !== 'string'
        || !Array.isArray(previewPayload.projects)
      ) {
        throw new Error('The dashboard preview response was invalid.');
      }
      if (
        mountedRef.current
        && previewRequestRef.current.generation === generation
        && databaseUrlRef.current.trim() === requestedDatabaseUrl
      ) {
        setDatabasePreview({
          ...previewPayload,
          project_count: Number.isFinite(previewPayload.project_count)
            ? previewPayload.project_count
            : previewPayload.projects.length,
        });
      }
    } catch (error) {
      if (
        error?.name !== 'AbortError'
        && mountedRef.current
        && previewRequestRef.current.generation === generation
      ) {
        setDatabaseError(error.message || 'Unable to preview the dashboard from that URL.');
      }
    } finally {
      if (previewRequestRef.current.generation === generation) {
        previewRequestRef.current.pending = false;
        previewRequestRef.current.controller = null;
        if (mountedRef.current) setPreviewingDatabase(false);
      }
    }
  };

  const handleAcceptDatabase = async (requestedDatabaseUrl) => {
    if (typeof requestedDatabaseUrl !== 'string') {
      setDatabaseError('The database URL must be a string.');
      return;
    }
    const capturedDatabaseUrl = requestedDatabaseUrl.trim();
    if (!capturedDatabaseUrl || capturedDatabaseUrl === currentDatabaseUrl) {
      setDatabaseError('Enter a new Postgres URL before accepting.');
      return;
    }
    if (acceptPendingRef.current) return;

    acceptPendingRef.current = true;
    cancelPreviewRequest();
    setDatabaseError('');
    setAcceptingDatabase(true);
    try {
      let acceptedPayload;
      try {
        acceptedPayload = await acceptDashboardDatabaseUrl(capturedDatabaseUrl);
      } catch (acceptError) {
        if (mountedRef.current) {
          setDatabaseError(acceptError.message || 'Unable to switch to that Postgres URL.');
        }
        return;
      }
      if (!mountedRef.current) return;
      const acceptedPayloadUrl = acceptedPayload?.database_url;
      const hasValidAcceptedPayloadUrl = (
        typeof acceptedPayloadUrl === 'string'
        && acceptedPayloadUrl.trim().length > 0
      );
      const acceptedUrl = hasValidAcceptedPayloadUrl
        ? acceptedPayloadUrl.trim()
        : capturedDatabaseUrl;
      setCurrentDatabaseUrl(acceptedUrl);
      setDatabaseUrl(acceptedUrl);
      databaseUrlRef.current = acceptedUrl;
      setDatabasePreview(null);
      showToast('Postgres database URL updated for this backend session.', 'success');
      if (!hasValidAcceptedPayloadUrl) {
        setDatabaseError(
          'Database switched successfully, but the backend returned an invalid database URL. The submitted URL is shown.',
        );
      }
      try {
        await onDatabaseAccepted?.();
      } catch (_refreshError) {
        if (mountedRef.current) {
          setDatabaseError(
            'Database switched successfully, but dashboard projects could not be refreshed. Reload the page to retry.',
          );
        }
      }
    } finally {
      acceptPendingRef.current = false;
      if (mountedRef.current) setAcceptingDatabase(false);
    }
  };

  const handleCopyCommitSha = async () => {
    if (!gitlabCommitSha) return;
    try {
      await navigator.clipboard.writeText(gitlabCommitSha);
      showToast('GitLab commit SHA copied to clipboard.', 'success');
    } catch (_error) {
      showToast('Unable to copy GitLab commit SHA.', 'error');
    }
  };

  const handleClose = () => {
    if (acceptPendingRef.current) return;
    cancelPreviewRequest();
    onClose();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-settings-title">
      <div className="modal-content dashboard-settings-modal">
        <div className="modal-header">
          <h3 id="dashboard-settings-title">Dashboard Settings</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Close dashboard settings"
            disabled={acceptingDatabase}
          >
            &times;
          </button>
        </div>
        <div className="modal-body dashboard-settings-body" role="region" aria-label="Dashboard settings options" tabIndex="0">
          <section className="settings-section version-info-section" aria-labelledby="dashboard-version-title">
            <div className="settings-section-header">
              <h2 id="dashboard-version-title">Version Information</h2>
              <p>Confirm which GitLab commit produced the VISTA codebase currently served by this backend.</p>
            </div>
            {loadingVersionInfo ? (
              <div role="status" className="alert alert-info">Loading version information…</div>
            ) : (
              <>
                <div className="dashboard-version-field">
                  <span>GitLab Commit SHA</span>
                  <code>{gitlabCommitSha || 'Not configured'}</code>
                </div>
                {versionError && <div role="alert" className="alert alert-error">{versionError}</div>}
                <div className="dashboard-version-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCopyCommitSha}
                    disabled={!gitlabCommitSha}
                  >
                    Copy SHA
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="settings-section" aria-labelledby="dashboard-backup-settings-title">
            <DashboardBackupPanel showToast={showToast} onImportComplete={onImportComplete} compact />
          </section>

          <section className="settings-section" aria-labelledby="dashboard-debug-title">
            <div className="settings-section-header">
              <h2 id="dashboard-debug-title">Debug Mode</h2>
              <p>Show detailed request diagnostics in dashboard errors and keep error popups visible until closed.</p>
            </div>
            <label className="dashboard-debug-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={debugMode}
                onChange={(event) => onDebugModeChange(event.target.checked)}
              />
              <span className="dashboard-debug-switch" aria-hidden="true">
                <span className="dashboard-debug-switch-thumb" />
              </span>
              <span>Enable dashboard debug mode</span>
            </label>
          </section>

          <section className="settings-section change-postgres-section" aria-labelledby="change-postgres-title">
            <div className="settings-section-header">
              <h2 id="change-postgres-title">Change Postgres</h2>
              <p>
                Preview another VISTA database before switching this running backend session to use it.
              </p>
            </div>
            {loadingCurrentUrl ? (
              <div role="status" className="alert alert-info">Loading current Postgres URL…</div>
            ) : (
              <>
                <div className="current-database-url">
                  <span>Current URL</span>
                  <code>{currentDatabaseUrl || 'Not configured'}</code>
                </div>
                <div className="form-group">
                  <label htmlFor="dashboard-postgres-url">New Postgres URL</label>
                  <input
                    id="dashboard-postgres-url"
                    type="text"
                    className="form-control"
                    value={databaseUrl}
                    disabled={acceptingDatabase}
                    onChange={(event) => {
                      const nextDatabaseUrl = event.target.value;
                      databaseUrlRef.current = nextDatabaseUrl;
                      cancelPreviewRequest();
                      setDatabaseUrl(nextDatabaseUrl);
                      setDatabasePreview(null);
                      setDatabaseError('');
                    }}
                    placeholder="postgresql+asyncpg://user:password@host:5432/database"
                    autoComplete="off"
                  />
                  <small className="form-text">
                    This session-only change affects the running backend process and is not written to environment files.
                  </small>
                </div>
                {databaseError && <div role="alert" className="alert alert-error">{databaseError}</div>}
                <div className="database-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handlePreviewDatabase}
                    disabled={previewingDatabase || acceptingDatabase || !hasDatabaseUrlChange}
                  >
                    {previewingDatabase ? 'Previewing…' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => handleAcceptDatabase(databaseUrlRef.current)}
                    disabled={previewingDatabase || acceptingDatabase || !hasDatabaseUrlChange}
                  >
                    {acceptingDatabase ? 'Submitting…' : 'Submit Postgres URL'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={acceptingDatabase}>Close</button>
        </div>
      </div>

      {databasePreview && (
        <div className="modal nested-modal" role="dialog" aria-modal="true" aria-labelledby="database-preview-title">
          <div className="modal-content database-preview-modal">
            <div className="modal-header">
              <h3 id="database-preview-title">Dashboard Preview</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDatabasePreview(null)}
                aria-label="Close dashboard preview"
                disabled={acceptingDatabase}
              >
                &times;
              </button>
            </div>
            <div className="modal-body database-preview-body">
              <p className="database-preview-summary">
                Preview from <code>{databasePreview.database_url}</code>: {databasePreview.project_count} project(s).
              </p>
              {databasePreview.projects.length === 0 ? (
                <div className="card text-center">
                  <div className="card-content">
                    <h3>No projects yet</h3>
                    <p>This database is reachable but does not currently show dashboard projects.</p>
                  </div>
                </div>
              ) : (
                <div className="preview-projects-grid">
                  {databasePreview.projects.map((project) => (
                    <div key={project.id} className="project-card preview-project-card">
                      <div className="project-card-header">
                        <h3 className="project-card-title">{project.name}</h3>
                        <div className="project-card-meta">
                          <span>ID: {project.id}</span>
                          <span>Group: {project.meta_group_id}</span>
                          <span>Type: {getProjectTypeLabel(project.project_type, { short: true })}</span>
                        </div>
                        <div className="project-card-meta">
                          <span>Images: {project.image_count ?? 0}</span>
                          <span>Parts: {project.part_count ?? 0}</span>
                        </div>
                      </div>
                      <div className="project-card-body">
                        <p className="project-card-description">{project.description || 'No description provided'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDatabasePreview(null)} disabled={acceptingDatabase}>
                Keep Editing
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => handleAcceptDatabase(databasePreview.database_url)}
                disabled={acceptingDatabase}
              >
                {acceptingDatabase ? 'Submitting…' : 'Submit This URL'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default DashboardSettingsModal;
