import { useCallback, useMemo, useRef } from 'react';

import useRouteRequestOwnership from '../../utils/useRouteRequestOwnership';

// One route ownership instance shared by the Project page hooks. `routeOwner`
// identifies the project route that rendered a callback, so a callback still
// held by a child after React Router reuses Project for another id reports
// itself stale instead of updating the new project's state.
export default function useProjectRouteOwnership(projectId) {
  const {
    beginRequest,
    captureOwner,
    isCurrent,
    releaseRequest,
  } = useRouteRequestOwnership(projectId);
  const routeOwner = useMemo(() => ({ ...captureOwner(), projectId }), [captureOwner, projectId]);

  // useProjectDataCounts and useProjectCollections scope work by project id,
  // and useProjectCollections keeps its own generation counters so a reload
  // started before a mutation cannot clear that mutation's stale marker. Those
  // counters order requests within one project, which route ownership does
  // not, so the hooks keep them and only ask which project id is active.
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const isActiveProject = useCallback((requestProjectId) => (
    activeProjectIdRef.current === requestProjectId
  ), []);

  return useMemo(() => ({
    beginRequest,
    isActiveProject,
    isCurrent,
    releaseRequest,
    routeOwner,
  }), [beginRequest, isActiveProject, isCurrent, releaseRequest, routeOwner]);
}
