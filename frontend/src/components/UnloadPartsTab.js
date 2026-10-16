import React, { useEffect, useMemo, useRef, useState } from 'react';
import { unloadProjectParts } from '../api/parts';
import { appendHttpCallToErrorMessage } from '../utils/httpErrorMessages';

function UnloadPartsTab({
  projectId,
  parts = [],
  onPartsUnloaded,
  setError,
}) {
  const [isUnloading, setIsUnloading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [completedSignature, setCompletedSignature] = useState(null);
  const submissionInFlightRef = useRef(false);
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;

  const partCount = parts.length;
  const partSignature = useMemo(
    () => parts.map((part) => String(part?.id ?? '')).sort().join('|'),
    [parts],
  );

  useEffect(() => {
    if (
      completedSignature !== null
      && partCount > 0
      && partSignature !== completedSignature
    ) {
      setCompletedSignature(null);
      setSuccessMessage('');
      setRefreshWarning('');
    }
  }, [completedSignature, partCount, partSignature]);

  useEffect(() => {
    submissionInFlightRef.current = false;
    setIsUnloading(false);
    setLocalError('');
    setRefreshWarning('');
    setSuccessMessage('');
    setCompletedSignature(null);
  }, [projectId]);

  const unloadAllParts = async () => {
    if (
      partCount === 0
      || submissionInFlightRef.current
      || completedSignature === partSignature
    ) {
      return;
    }

    const partLabel = `${partCount} ${partCount === 1 ? 'part' : 'parts'}`;
    const confirmed = window.confirm(
      `Unload all ${partLabel} from this project?\n\nImages and batches will be preserved. This cannot be undone.`,
    );
    if (!confirmed) return;

    const requestProjectId = projectId;
    submissionInFlightRef.current = true;
    setIsUnloading(true);
    setLocalError('');
    setRefreshWarning('');
    setSuccessMessage('');
    setError?.(null);

    const deleteRequest = {
      method: 'DELETE',
      url: `/api/projects/${requestProjectId}/parts`,
    };
    let deleteSucceeded = false;
    try {
      await unloadProjectParts(requestProjectId);
      if (activeProjectIdRef.current !== requestProjectId) return;

      deleteSucceeded = true;
      setCompletedSignature(partSignature);
      const refreshResult = await onPartsUnloaded?.();
      if (activeProjectIdRef.current !== requestProjectId) return;

      if (
        refreshResult === false
        || refreshResult === 'error'
        || refreshResult === 'stale'
      ) {
        const message = `Unloaded ${partLabel}, but project data could not be refreshed. Reload the project to verify its current parts before trying again.`;
        setRefreshWarning(message);
        setError?.(message);
        return;
      }

      setSuccessMessage(
        `Unloaded ${partLabel}. Project images and batches were preserved.`,
      );
      setError?.(null);
    } catch (error) {
      if (activeProjectIdRef.current !== requestProjectId) return;
      const message = deleteSucceeded
        ? `Unloaded ${partLabel}, but project data could not be refreshed. Reload the project to verify its current parts before trying again.`
        : appendHttpCallToErrorMessage(error?.message || 'Failed to unload all parts', deleteRequest);
      if (deleteSucceeded) {
        setRefreshWarning(message);
      } else {
        setLocalError(message);
      }
      setError?.(message);
    } finally {
      submissionInFlightRef.current = false;
      if (activeProjectIdRef.current === requestProjectId) {
        setIsUnloading(false);
      }
    }
  };

  const submissionCompleted = completedSignature === partSignature;

  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label="Unload Parts">
      <section className="workbench-panel project-data-action-panel">
        <header className="workbench-header">
          <div>
            <h2>Unload Parts</h2>
            <p>
              Remove every part record from this project in one operation.
              Images and batch definitions remain available.
            </p>
          </div>
          <div className="workbench-detail-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={partCount === 0 || isUnloading || submissionCompleted}
              onClick={unloadAllParts}
            >
              {isUnloading ? 'Unloading All Parts...' : `Unload All Parts (${partCount})`}
            </button>
          </div>
        </header>

        <p className="muted">
          {partCount === 0
            ? 'There are no parts to unload.'
            : `${partCount} ${partCount === 1 ? 'part is' : 'parts are'} currently loaded.`}
        </p>

        {localError && <div className="alert alert-error" role="alert">{localError}</div>}
        {refreshWarning && <div className="alert alert-warning" role="alert">{refreshWarning}</div>}
        {successMessage && <div className="alert alert-success" role="status">{successMessage}</div>}
      </section>
    </div>
  );
}

export default UnloadPartsTab;
