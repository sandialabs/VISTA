import { useCallback, useEffect, useState } from 'react';
import { fetchAnalyzeCheckpoints } from '../../api/analyses';

const INITIAL_CHECKPOINT_STATE = {
  loading: false,
  requested: false,
  project: [],
  authorized: [],
  projectDiagnostics: null,
  authorizedDiagnostics: null,
  error: null,
};

// Owns Analyze checkpoint scope selection and the project/authorized checkpoint lists.
export function useAnalyzeCheckpointState(projectId) {
  const [checkpointScope, setCheckpointScope] = useState('project');
  const [checkpointState, setCheckpointState] = useState(INITIAL_CHECKPOINT_STATE);

  const setActiveCheckpointScope = useCallback((scope) => {
    setCheckpointScope(scope);
  }, []);

  const refreshCheckpoints = useCallback(async () => {
    if (!projectId) return;
    setCheckpointState((previous) => ({ ...previous, loading: true, requested: true, error: null }));
    try {
      const [projectPayload, authorizedPayload] = await Promise.all([
        fetchAnalyzeCheckpoints(projectId, 'project', { errorLabel: 'Failed to load project checkpoints' }),
        fetchAnalyzeCheckpoints(projectId, 'authorized', { errorLabel: 'Failed to load authorized checkpoints' }),
      ]);
      setCheckpointState({
        loading: false,
        requested: true,
        project: Array.isArray(projectPayload.checkpoints) ? projectPayload.checkpoints : [],
        authorized: Array.isArray(authorizedPayload.checkpoints) ? authorizedPayload.checkpoints : [],
        projectDiagnostics: projectPayload.diagnostics || null,
        authorizedDiagnostics: authorizedPayload.diagnostics || null,
        error: null,
      });
    } catch (err) {
      const message = err.message || 'Failed to load checkpoints';
      setCheckpointState((previous) => ({ ...previous, loading: false, error: message }));
    }
  }, [projectId]);

  useEffect(() => {
    refreshCheckpoints();
  }, [refreshCheckpoints]);

  const activeCheckpoints = checkpointScope === 'authorized' ? checkpointState.authorized : checkpointState.project;

  return {
    checkpointScope,
    setActiveCheckpointScope,
    checkpointState,
    refreshCheckpoints,
    activeCheckpoints,
  };
}
