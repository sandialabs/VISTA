import { useCallback } from 'react';

import { mergeImagesByIdentity } from './projectDataUtils';

// Completion handlers that child tabs call after they mutate project data.
// Each handler belongs to the project route that rendered it; a handler
// invoked after navigation reports 'stale' and refreshes nothing.
export default function useProjectUploadHandlers({
  collections,
  projectId,
  refreshProjectConfiguration,
  refreshProjectCounts,
  refreshProjectMetadata,
  routeOwnership,
}) {
  const { isCurrent, routeOwner } = routeOwnership;
  const {
    markProjectCollectionsStale,
    reconcileProjectImages,
    reconcileProjectParts,
    setProjectImages,
  } = collections;

  const handleUploadComplete = useCallback(async (confirmedImages = [], completion = {}) => {
    const owner = routeOwner;
    const authoritative = Boolean(completion?.requiresAuthoritativeReconciliation);
    if (!isCurrent(owner)) return { reconciled: false, authoritative, stale: true };
    if (Array.isArray(confirmedImages) && confirmedImages.length > 0) {
      setProjectImages((previous) => mergeImagesByIdentity(previous, confirmedImages));
    }
    markProjectCollectionsStale({
      images: true,
      parts: completion?.partsMayHaveChanged !== false,
    });
    const summaryRefresh = refreshProjectCounts({ requestProjectId: projectId });
    if (!authoritative) {
      const summaryResult = await summaryRefresh;
      if (summaryResult === 'stale' || !isCurrent(owner)) {
        return { reconciled: false, authoritative: false, stale: true };
      }
      return { reconciled: true, authoritative: false };
    }

    const [imagesReconciled, partsReconciled] = await Promise.all([
      reconcileProjectImages(),
      completion?.partsMayHaveChanged === false ? Promise.resolve(true) : reconcileProjectParts(),
      summaryRefresh,
    ]);
    if (!isCurrent(owner)) return { reconciled: false, authoritative: true, stale: true };
    return {
      reconciled: imagesReconciled === true && partsReconciled === true,
      authoritative: true,
    };
  }, [
    isCurrent,
    markProjectCollectionsStale,
    projectId,
    reconcileProjectImages,
    reconcileProjectParts,
    refreshProjectCounts,
    routeOwner,
    setProjectImages,
  ]);

  const handleProjectCollectionsChanged = useCallback(async () => {
    if (!isCurrent(routeOwner)) return 'stale';
    markProjectCollectionsStale();
    return refreshProjectCounts({ requestProjectId: projectId });
  }, [isCurrent, markProjectCollectionsStale, projectId, refreshProjectCounts, routeOwner]);

  const handlePartsUnloaded = useCallback(async () => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return 'stale';
    markProjectCollectionsStale({ images: false, parts: true });
    const [partsResult, countsResult] = await Promise.all([
      reconcileProjectParts(),
      refreshProjectCounts({ requestProjectId: projectId }),
    ]);
    if (!isCurrent(owner)) return 'stale';
    return partsResult === true && countsResult === 'fresh' ? 'fresh' : 'error';
  }, [isCurrent, markProjectCollectionsStale, projectId, reconcileProjectParts, refreshProjectCounts, routeOwner]);

  const handleMetadataAssociationsChanged = useCallback(async () => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return 'stale';
    markProjectCollectionsStale({ images: false, parts: true });
    await Promise.all([
      refreshProjectCounts({ requestProjectId: projectId }),
      refreshProjectMetadata({ owner }),
    ]);
    return isCurrent(owner) ? 'fresh' : 'stale';
  }, [isCurrent, markProjectCollectionsStale, projectId, refreshProjectCounts, refreshProjectMetadata, routeOwner]);

  const handleBundleImportComplete = useCallback(async () => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return 'stale';
    markProjectCollectionsStale();
    await Promise.allSettled([
      refreshProjectCounts({ requestProjectId: projectId }),
      refreshProjectMetadata({ owner }),
      refreshProjectConfiguration({ owner }),
    ]);
    return isCurrent(owner) ? 'fresh' : 'stale';
  }, [
    isCurrent,
    markProjectCollectionsStale,
    projectId,
    refreshProjectConfiguration,
    refreshProjectCounts,
    refreshProjectMetadata,
    routeOwner,
  ]);

  return {
    handleBundleImportComplete,
    handleMetadataAssociationsChanged,
    handlePartsUnloaded,
    handleProjectCollectionsChanged,
    handleUploadComplete,
  };
}
