import { useCallback, useEffect, useState } from 'react';

import {
  fetchRecentlyDeletedAnalysisOverlays,
  restoreAnalysisOverlay,
} from '../../api/analyses';
import { refreshOwnedResource } from './projectDataUtils';

const NO_OVERLAYS = Object.freeze([]);

// Loads the Recently Deleted overlay list while its Project Data tab is open
// and restores overlays. The list read is a route-owned request aborted on
// navigation or when the tab closes.
export default function useRecentlyDeletedOverlays({
  activeMainTab,
  activeProjectDataTab,
  onProjectCollectionsChanged,
  projectId,
  routeOwnership,
  setError,
}) {
  const { beginRequest, isCurrent, releaseRequest, routeOwner } = routeOwnership;
  const [recentlyDeletedOverlays, setRecentlyDeletedOverlays] = useState(NO_OVERLAYS);
  const [recentlyDeletedLoading, setRecentlyDeletedLoading] = useState(false);

  useEffect(() => {
    setRecentlyDeletedOverlays(NO_OVERLAYS);
    setRecentlyDeletedLoading(false);
  }, [routeOwner]);

  const refreshRecentlyDeletedOverlays = useCallback(async ({ owner = routeOwner } = {}) => {
    if (!isCurrent(owner)) return 'stale';
    setRecentlyDeletedLoading(true);
    try {
      return await refreshOwnedResource({
        owner,
        isCurrent,
        load: (options) => fetchRecentlyDeletedAnalysisOverlays(projectId, options),
        apply: (payload) => setRecentlyDeletedOverlays(Array.isArray(payload) ? payload : []),
      });
    } catch (err) {
      setError(err.message || 'Failed to load recently deleted overlays');
      return 'error';
    } finally {
      if (isCurrent(owner)) setRecentlyDeletedLoading(false);
    }
  }, [isCurrent, projectId, routeOwner, setError]);

  useEffect(() => {
    if (activeMainTab !== 'project_data' || activeProjectDataTab !== 'recently_deleted') return undefined;
    const request = beginRequest();
    refreshRecentlyDeletedOverlays({ owner: request }).finally(() => releaseRequest(request));
    return () => {
      request.controller.abort();
      releaseRequest(request);
    };
  }, [activeMainTab, activeProjectDataTab, beginRequest, refreshRecentlyDeletedOverlays, releaseRequest]);

  const restoreRecentlyDeletedOverlay = useCallback(async (overlay) => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return 'stale';
    const overlayId = overlay?.image_id;
    if (!overlayId) return undefined;
    try {
      await restoreAnalysisOverlay(projectId, overlayId);
      if (!isCurrent(owner)) return 'stale';
      await refreshRecentlyDeletedOverlays({ owner });
      if (!isCurrent(owner)) return 'stale';
      await onProjectCollectionsChanged();
      return isCurrent(owner) ? 'fresh' : 'stale';
    } catch (err) {
      if (!isCurrent(owner)) return 'stale';
      setError(err.message || 'Failed to restore overlay');
      return 'error';
    }
  }, [isCurrent, onProjectCollectionsChanged, projectId, refreshRecentlyDeletedOverlays, routeOwner, setError]);

  return {
    recentlyDeletedLoading,
    recentlyDeletedOverlays,
    refreshRecentlyDeletedOverlays,
    restoreRecentlyDeletedOverlay,
  };
}
