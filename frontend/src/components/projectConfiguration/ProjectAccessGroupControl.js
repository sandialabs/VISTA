import React, { useEffect, useId, useRef, useState } from 'react';
import { rethrowWithServerDetail } from '../../api/client';
import { updateProject } from '../../api/projects';

function getProjectAccessGroup(project) {
  return typeof project?.meta_group_id === 'string' ? project.meta_group_id : '';
}

function getValidatedAccessGroupProject(payload, expectedProjectId, expectedAccessGroup) {
  const hasValidShape = (
    payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && String(payload.id) === String(expectedProjectId)
    && payload.meta_group_id === expectedAccessGroup
    && typeof payload.name === 'string'
    && typeof payload.project_type === 'string'
    && typeof payload.is_archived === 'boolean'
  );
  if (!hasValidShape) {
    throw new Error('Failed to update Access Group (invalid project response).');
  }
  return payload;
}

export default function ProjectAccessGroupControl({
  project,
  projectId,
  onProjectUpdated,
}) {
  const idPrefix = useId();
  const initialAccessGroup = getProjectAccessGroup(project);
  const [draftAccessGroup, setDraftAccessGroup] = useState(initialAccessGroup);
  const [savedAccessGroup, setSavedAccessGroup] = useState(initialAccessGroup);
  const [savingAccessGroup, setSavingAccessGroup] = useState(false);
  const [accessGroupError, setAccessGroupError] = useState('');
  const [accessGroupStatus, setAccessGroupStatus] = useState('');
  const requestTokenRef = useRef(0);
  const savedAccessGroupRef = useRef(initialAccessGroup);
  const currentProjectId = project?.id || projectId || '';
  const currentAccessGroup = getProjectAccessGroup(project);
  const syncedProjectRef = useRef({
    id: currentProjectId,
    accessGroup: initialAccessGroup,
  });

  useEffect(() => {
    const previousSync = syncedProjectRef.current;
    const identityChanged = previousSync.id !== currentProjectId;
    const acknowledgesLocalSave = !identityChanged
      && currentAccessGroup === savedAccessGroupRef.current;

    requestTokenRef.current += 1;
    syncedProjectRef.current = {
      id: currentProjectId,
      accessGroup: currentAccessGroup,
    };
    savedAccessGroupRef.current = currentAccessGroup;
    setDraftAccessGroup(currentAccessGroup);
    setSavedAccessGroup(currentAccessGroup);
    setSavingAccessGroup(false);
    setAccessGroupError('');
    if (!acknowledgesLocalSave) {
      setAccessGroupStatus('');
    }
  }, [currentProjectId, currentAccessGroup, project?.is_archived]);

  const trimmedAccessGroup = draftAccessGroup.trim();
  const accessGroupUnchanged = trimmedAccessGroup === savedAccessGroup;
  const readOnly = project?.is_archived === true;

  const updateAccessGroup = async () => {
    if (!trimmedAccessGroup) {
      setAccessGroupError('Access Group is required.');
      setAccessGroupStatus('');
      return;
    }
    if (trimmedAccessGroup.length > 255) {
      setAccessGroupError('Access Group must be 255 characters or fewer.');
      setAccessGroupStatus('');
      return;
    }
    if (readOnly || savingAccessGroup || accessGroupUnchanged) return;

    const targetProjectId = project?.id || projectId;
    if (!targetProjectId) {
      setAccessGroupError('Project details are unavailable. Reload the project and try again.');
      setAccessGroupStatus('');
      return;
    }

    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    setSavingAccessGroup(true);
    setAccessGroupError('');
    setAccessGroupStatus('');

    try {
      // A malformed 2xx body falls through to the project shape validation below.
      const payload = await updateProject(targetProjectId, { meta_group_id: trimmedAccessGroup })
        .catch(rethrowWithServerDetail('Failed to update Access Group'))
        .catch((error) => {
          if (error instanceof SyntaxError) return null;
          throw error;
        });
      if (requestToken !== requestTokenRef.current) return;

      const updatedProject = getValidatedAccessGroupProject(
        payload,
        targetProjectId,
        trimmedAccessGroup,
      );
      const nextSavedAccessGroup = updatedProject.meta_group_id;
      savedAccessGroupRef.current = nextSavedAccessGroup;
      setSavedAccessGroup(nextSavedAccessGroup);
      setDraftAccessGroup(nextSavedAccessGroup);
      setAccessGroupError('');
      setAccessGroupStatus('Access Group updated.');
      if (typeof onProjectUpdated === 'function') {
        onProjectUpdated(updatedProject);
      }
    } catch (err) {
      if (requestToken !== requestTokenRef.current) return;
      setAccessGroupError(err.message || 'Failed to update Access Group.');
      setAccessGroupStatus('');
    } finally {
      if (requestToken === requestTokenRef.current) {
        setSavingAccessGroup(false);
      }
    }
  };

  const headingId = `${idPrefix}-project-access-group-heading`;
  const inputId = `${idPrefix}-project-access-group`;
  const errorId = `${idPrefix}-project-access-group-error`;
  const statusId = `${idPrefix}-project-access-group-status`;
  const warningId = `${idPrefix}-project-access-group-warning`;

  return (
    <section className="part-detail-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>Access Group</h3>
      <p>
        Set the identity group that can open and manage this project.
      </p>
      <div id={warningId} className="alert alert-warning" role="note">
        <strong>Security boundary:</strong>
        {' '}
        changing this value immediately changes project access. You must belong to the destination group.
      </div>
      <label htmlFor={inputId}>Access Group</label>
      <div className="workbench-controls-row">
        <input
          id={inputId}
          className="form-control"
          type="text"
          maxLength={255}
          value={draftAccessGroup}
          disabled={readOnly || savingAccessGroup}
          aria-invalid={Boolean(accessGroupError)}
          aria-describedby={[
            warningId,
            accessGroupError ? errorId : '',
            accessGroupStatus ? statusId : '',
          ].filter(Boolean).join(' ')}
          onChange={(event) => {
            setDraftAccessGroup(event.target.value);
            setAccessGroupError('');
            setAccessGroupStatus('');
          }}
        />
        <button
          className="btn btn-primary"
          type="button"
          disabled={readOnly || savingAccessGroup || accessGroupUnchanged}
          onClick={updateAccessGroup}
        >
          {savingAccessGroup ? 'Updating Access Group...' : 'Update Access Group'}
        </button>
      </div>
      {readOnly && <p className="muted">Archived projects are read-only.</p>}
      {accessGroupError && (
        <div id={errorId} className="alert alert-error" role="alert">
          {accessGroupError}
        </div>
      )}
      {accessGroupStatus && (
        <div id={statusId} className="alert alert-success" role="status">
          {accessGroupStatus}
        </div>
      )}
    </section>
  );
}
