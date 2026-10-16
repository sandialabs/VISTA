import { useCallback, useState } from 'react';

import { fetchProjectDataSummary } from '../../api/projects';
import { emptyProjectDataCounts } from './projectTabs';
import { isAbortError } from './projectDataUtils';

export default function useProjectDataCounts({
  isActiveProject,
  projectId,
  setError,
}) {
  const [dataCounts, setDataCounts] = useState(emptyProjectDataCounts);
  const [countsLoading, setCountsLoading] = useState(true);

  const resetProjectCounts = useCallback(() => {
    setDataCounts(emptyProjectDataCounts());
    setCountsLoading(true);
  }, []);

  const refreshProjectCounts = useCallback(async ({
    requestProjectId = projectId,
    signal,
  } = {}) => {
    if (signal?.aborted || !isActiveProject(requestProjectId)) return 'stale';
    setCountsLoading(true);
    try {
      const payload = await fetchProjectDataSummary(
        requestProjectId,
        signal ? { signal } : undefined,
      );
      if (signal?.aborted || !isActiveProject(requestProjectId)) return 'stale';
      setDataCounts({
        partsLoaded: Number(payload?.part_count) || 0,
        rawImages: Number(payload?.active_image_count) || 0,
        imageMetadata: Number(payload?.image_metadata_fields) || 0,
        overlayImages: Number(payload?.overlay_layer_count) || 0,
        annotations: Number(payload?.annotation_count) || 0,
      });
      return 'fresh';
    } catch (err) {
      if (signal?.aborted || isAbortError(err) || !isActiveProject(requestProjectId)) return 'stale';
      setError(err.message || 'Failed to load project summary counts');
      return 'error';
    } finally {
      if (!signal?.aborted && isActiveProject(requestProjectId)) setCountsLoading(false);
    }
  }, [isActiveProject, projectId, setError]);

  return {
    countsLoading,
    dataCounts,
    refreshProjectCounts,
    resetProjectCounts,
  };
}
