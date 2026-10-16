import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchProjectParts } from '../../api/parts';
import { fetchProjectImagePages } from '../../utils/projectImages';
import { isAbortError } from './projectDataUtils';

const initialCollectionState = Object.freeze({
  loaded: false,
  loading: false,
  stale: true,
  error: null,
});

export default function useProjectCollections({
  isActiveProject,
  projectId,
}) {
  const [projectParts, setProjectParts] = useState([]);
  const [projectImages, setProjectImages] = useState([]);
  const [projectPartsState, setProjectPartsState] = useState(initialCollectionState);
  const [projectImagesState, setProjectImagesState] = useState(initialCollectionState);
  const projectPartsRequestRef = useRef(null);
  const projectImagesRequestRef = useRef(null);
  const projectPartsAbortControllerRef = useRef(null);
  const projectImagesAbortControllerRef = useRef(null);
  const projectPartsGenerationRef = useRef(0);
  const projectImagesGenerationRef = useRef(0);
  const loadedProjectPartsGenerationRef = useRef(-1);
  const loadedProjectImagesGenerationRef = useRef(-1);

  const abortProjectCollectionRequests = useCallback(() => {
    projectPartsAbortControllerRef.current?.abort();
    projectImagesAbortControllerRef.current?.abort();
    projectPartsAbortControllerRef.current = null;
    projectImagesAbortControllerRef.current = null;
    projectPartsRequestRef.current = null;
    projectImagesRequestRef.current = null;
  }, []);

  const resetProjectCollections = useCallback(() => {
    abortProjectCollectionRequests();
    projectPartsGenerationRef.current += 1;
    projectImagesGenerationRef.current += 1;
    loadedProjectPartsGenerationRef.current = -1;
    loadedProjectImagesGenerationRef.current = -1;
    setProjectParts([]);
    setProjectImages([]);
    setProjectPartsState(initialCollectionState);
    setProjectImagesState(initialCollectionState);
  }, [abortProjectCollectionRequests]);

  useEffect(() => abortProjectCollectionRequests, [abortProjectCollectionRequests]);

  const loadProjectParts = useCallback(() => {
    const requestProjectId = projectId;
    if (!isActiveProject(requestProjectId)) return Promise.resolve('stale');
    if (projectPartsRequestRef.current) return projectPartsRequestRef.current;
    const requestGeneration = projectPartsGenerationRef.current;
    const controller = new AbortController();
    projectPartsAbortControllerRef.current = controller;
    const { signal } = controller;
    const operation = (async () => {
      setProjectPartsState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const payload = await fetchProjectParts(requestProjectId, { signal });
        if (signal.aborted || !isActiveProject(requestProjectId)) return 'stale';
        const stale = projectPartsGenerationRef.current !== requestGeneration;
        setProjectParts(Array.isArray(payload) ? payload : []);
        if (!stale) loadedProjectPartsGenerationRef.current = requestGeneration;
        setProjectPartsState({ loaded: true, loading: false, stale, error: null });
        return stale ? 'stale' : 'fresh';
      } catch (err) {
        if (signal.aborted || isAbortError(err) || !isActiveProject(requestProjectId)) {
          return 'stale';
        }
        setProjectPartsState((previous) => ({
          ...previous,
          loading: false,
          error: err?.message || 'Failed to load project parts',
        }));
        return 'error';
      }
    })();
    const request = operation.finally(() => {
      if (projectPartsRequestRef.current === request) projectPartsRequestRef.current = null;
      if (projectPartsAbortControllerRef.current === controller) {
        projectPartsAbortControllerRef.current = null;
      }
    });
    projectPartsRequestRef.current = request;
    return request;
  }, [isActiveProject, projectId]);

  const loadProjectImages = useCallback(() => {
    const requestProjectId = projectId;
    if (!isActiveProject(requestProjectId)) return Promise.resolve('stale');
    if (projectImagesRequestRef.current) return projectImagesRequestRef.current;
    const requestGeneration = projectImagesGenerationRef.current;
    const controller = new AbortController();
    projectImagesAbortControllerRef.current = controller;
    const { signal } = controller;
    const operation = (async () => {
      setProjectImagesState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const payload = await fetchProjectImagePages(requestProjectId, {
          includeDeleted: true,
          signal,
        });
        if (signal.aborted || !isActiveProject(requestProjectId)) return 'stale';
        const stale = projectImagesGenerationRef.current !== requestGeneration;
        setProjectImages(payload.items);
        if (!stale) loadedProjectImagesGenerationRef.current = requestGeneration;
        setProjectImagesState({ loaded: true, loading: false, stale, error: null });
        return stale ? 'stale' : 'fresh';
      } catch (err) {
        if (signal.aborted || isAbortError(err) || !isActiveProject(requestProjectId)) {
          return 'stale';
        }
        setProjectImagesState((previous) => ({
          ...previous,
          loading: false,
          error: err?.message || 'Failed to load project images',
        }));
        return 'error';
      }
    })();
    const request = operation.finally(() => {
      if (projectImagesRequestRef.current === request) projectImagesRequestRef.current = null;
      if (projectImagesAbortControllerRef.current === controller) {
        projectImagesAbortControllerRef.current = null;
      }
    });
    projectImagesRequestRef.current = request;
    return request;
  }, [isActiveProject, projectId]);

  const markProjectCollectionsStale = useCallback(({ images = true, parts = true } = {}) => {
    if (!isActiveProject(projectId)) return false;
    if (images) {
      projectImagesGenerationRef.current += 1;
      setProjectImagesState((previous) => ({ ...previous, stale: true, error: null }));
    }
    if (parts) {
      projectPartsGenerationRef.current += 1;
      setProjectPartsState((previous) => ({ ...previous, stale: true, error: null }));
    }
    return true;
  }, [isActiveProject, projectId]);

  const reconcileProjectImages = useCallback(async () => {
    if (!isActiveProject(projectId)) return false;
    while (loadedProjectImagesGenerationRef.current !== projectImagesGenerationRef.current) {
      if (!isActiveProject(projectId)) return false;
      const result = await loadProjectImages();
      if (result === 'error') return false;
      if (result === 'stale' && !isActiveProject(projectId)) return false;
    }
    return isActiveProject(projectId);
  }, [isActiveProject, loadProjectImages, projectId]);

  const reconcileProjectParts = useCallback(async () => {
    if (!isActiveProject(projectId)) return false;
    while (loadedProjectPartsGenerationRef.current !== projectPartsGenerationRef.current) {
      if (!isActiveProject(projectId)) return false;
      const result = await loadProjectParts();
      if (result === 'error') return false;
      if (result === 'stale' && !isActiveProject(projectId)) return false;
    }
    return isActiveProject(projectId);
  }, [isActiveProject, loadProjectParts, projectId]);

  return {
    abortProjectCollectionRequests,
    loadProjectImages,
    loadProjectParts,
    markProjectCollectionsStale,
    projectImages,
    projectImagesState,
    projectParts,
    projectPartsState,
    reconcileProjectImages,
    reconcileProjectParts,
    resetProjectCollections,
    setProjectImages,
  };
}
