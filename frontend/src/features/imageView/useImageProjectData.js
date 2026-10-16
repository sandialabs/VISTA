import { useEffect, useRef, useState } from 'react';

import { fetchProjectClasses } from '../../api/classes';
import { fetchProject } from '../../api/projects';
import useRouteRequestOwnership from '../../utils/useRouteRequestOwnership';

const EMPTY_LIST = Object.freeze([]);

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export default function useImageProjectData({ projectId, setError }) {
  const [classesState, setClassesState] = useState({
    classes: [],
    projectId: null,
  });
  const [projectArchivedState, setProjectArchivedState] = useState({
    archived: null,
    projectId: null,
  });
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const {
    beginRequest: beginProjectRequest,
    isCurrent: isCurrentProjectRequest,
    releaseRequest: releaseProjectRequest,
  } = useRouteRequestOwnership(projectId);

  const classes = classesState.projectId === projectId ? classesState.classes : EMPTY_LIST;
  const projectArchived = projectArchivedState.projectId === projectId
    ? projectArchivedState.archived
    : null;

  useEffect(() => {
    setClassesState({ classes: [], projectId: projectId || null });
    if (!projectId) return undefined;
    const request = beginProjectRequest();

    fetchProjectClasses(projectId, { signal: request.controller.signal })
      .then((classesData) => {
        if (isCurrentProjectRequest(request) && activeProjectIdRef.current === projectId) {
          setClassesState({
            classes: Array.isArray(classesData) ? classesData : [],
            projectId,
          });
        }
      })
      .catch((loadError) => {
        if (
          !isCurrentProjectRequest(request)
          || isAbortError(loadError)
          || activeProjectIdRef.current !== projectId
        ) return;
        console.error('Error loading classes:', loadError);
        setError('Failed to load classes. Please try again later.');
      })
      .finally(() => releaseProjectRequest(request));

    return () => {
      request.controller.abort();
      releaseProjectRequest(request);
    };
  }, [
    beginProjectRequest,
    isCurrentProjectRequest,
    projectId,
    releaseProjectRequest,
    setError,
  ]);

  useEffect(() => {
    setProjectArchivedState({ archived: null, projectId: projectId || null });
    if (!projectId) return undefined;
    const request = beginProjectRequest();
    fetchProject(projectId, { signal: request.controller.signal })
      .then((data) => {
        if (isCurrentProjectRequest(request) && data && activeProjectIdRef.current === projectId) {
          setProjectArchivedState({
            archived: !!data.is_archived,
            projectId,
          });
        }
      })
      .catch((archiveError) => {
        if (
          !isCurrentProjectRequest(request)
          || isAbortError(archiveError)
          || activeProjectIdRef.current !== projectId
        ) return;
      })
      .finally(() => releaseProjectRequest(request));
    return () => {
      request.controller.abort();
      releaseProjectRequest(request);
    };
  }, [
    beginProjectRequest,
    isCurrentProjectRequest,
    projectId,
    releaseProjectRequest,
  ]);

  return {
    classes,
    projectArchived,
  };
}
