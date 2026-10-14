import { useEffect } from 'react';

// Loads the project route: resets per-project counts and collections, then
// loads the project record under a route-owned request that is aborted when
// the route changes or the page unmounts.
export default function useProjectBootstrap({
  abortProjectCollectionRequests,
  loadProjectRecord,
  refreshProjectCounts,
  resetProjectCollections,
  resetProjectCounts,
  routeOwnership,
}) {
  const { beginRequest, releaseRequest } = routeOwnership;

  useEffect(() => {
    const request = beginRequest();
    resetProjectCounts();
    resetProjectCollections();
    loadProjectRecord(request, { refreshProjectCounts })
      .finally(() => releaseRequest(request));
    return () => {
      request.controller.abort();
      releaseRequest(request);
      abortProjectCollectionRequests();
    };
  }, [
    abortProjectCollectionRequests,
    beginRequest,
    loadProjectRecord,
    refreshProjectCounts,
    releaseRequest,
    resetProjectCollections,
    resetProjectCounts,
  ]);
}
