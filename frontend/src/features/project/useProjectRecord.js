import { useCallback, useState } from 'react';

import {
  fetchProject,
  fetchProjectConfiguration,
  fetchProjectMetadataDictionary,
} from '../../api/projects';
import { isAbortError, refreshOwnedResource } from './projectDataUtils';

// Owns the project record, metadata dictionary, configuration, and page-level
// loading/error state. Every read is owned by the current project route.
export default function useProjectRecord({ projectId, routeOwnership }) {
  const { isCurrent, routeOwner } = routeOwnership;
  const [project, setProject] = useState(null);
  const [metadata, setMetadata] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectConfiguration, setProjectConfiguration] = useState(null);

  // Child components can finish asynchronous work after React Router has
  // reused this Project instance for another id. Keep their state setters
  // scoped to the project route that created the callback.
  const setActiveProjectError = useCallback((value) => {
    if (isCurrent(routeOwner)) setError(value);
  }, [isCurrent, routeOwner]);
  const setActiveProjectValue = useCallback((value) => {
    if (isCurrent(routeOwner) && value?.id === projectId) setProject(value);
  }, [isCurrent, projectId, routeOwner]);
  const setActiveProjectConfigurationValue = useCallback((value) => {
    if (isCurrent(routeOwner)) setProjectConfiguration(value);
  }, [isCurrent, routeOwner]);

  const refreshProjectConfiguration = useCallback(({ owner = routeOwner } = {}) => (
    refreshOwnedResource({
      owner,
      isCurrent,
      load: (options) => fetchProjectConfiguration(projectId, options),
      apply: (payload) => setProjectConfiguration(payload?.config || null),
    })
  ), [isCurrent, projectId, routeOwner]);

  const refreshProjectMetadata = useCallback(({ owner = routeOwner } = {}) => (
    refreshOwnedResource({
      owner,
      isCurrent,
      load: (options) => fetchProjectMetadataDictionary(projectId, options),
      apply: setMetadata,
    })
  ), [isCurrent, projectId, routeOwner]);

  const handleProjectMetadataLoaded = useCallback(() => (
    refreshProjectMetadata()
  ), [refreshProjectMetadata]);

  // Resets the record for a new route and loads it under `request`.
  const loadProjectRecord = useCallback(async (request, { refreshProjectCounts }) => {
    const { signal } = request.controller;
    setLoading(true);
    setError(null);
    setProject(null);
    setMetadata({});
    setProjectConfiguration(null);
    try {
      const projectData = await fetchProject(projectId, { signal });
      if (!isCurrent(request)) return;
      setProject(projectData);
      await Promise.all([
        refreshProjectMetadata({ owner: request }),
        refreshProjectCounts({ requestProjectId: projectId, signal }),
        refreshProjectConfiguration({ owner: request }),
      ]);
      if (isCurrent(request)) setLoading(false);
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err)) return;
      setError(err.message);
      setLoading(false);
    }
  }, [isCurrent, projectId, refreshProjectConfiguration, refreshProjectMetadata]);

  return {
    error,
    handleProjectMetadataLoaded,
    loading,
    loadProjectRecord,
    metadata,
    project,
    projectConfiguration,
    refreshProjectConfiguration,
    refreshProjectMetadata,
    setActiveProjectConfigurationValue,
    setActiveProjectError,
    setActiveProjectValue,
  };
}
