import { useCallback, useEffect, useState } from 'react';

import { fetchProjectBatches } from '../../api/batches';
import { fetchProjectParts } from '../../api/parts';
import { runProjectIngest } from '../../api/projects';
import { buildIngestValidationPayload } from './ingestValidationPayload';

const IDLE_INGEST_RESULT = Object.freeze({ loading: false, error: null, payload: null });

// Runs the Project Data synthetic ingest validation for the current project
// route. A run that resumes after navigation neither submits nor reports.
export default function useIngestValidation({
  onProjectCollectionsChanged,
  projectId,
  routeOwnership,
}) {
  const { isCurrent, routeOwner } = routeOwnership;
  const [ingestResult, setIngestResult] = useState(IDLE_INGEST_RESULT);

  useEffect(() => {
    setIngestResult(IDLE_INGEST_RESULT);
  }, [routeOwner]);

  const requestIngestValidation = useCallback(async () => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return 'stale';
    try {
      setIngestResult({ loading: true, error: null, payload: null });
      const [batchData, partData] = await Promise.all([
        fetchProjectBatches(projectId),
        fetchProjectParts(projectId),
      ]);
      if (!isCurrent(owner)) return 'stale';
      const payload = await runProjectIngest(projectId, buildIngestValidationPayload(batchData, partData), {
        errorLabel: 'Failed to run ingest validation',
      });
      if (!isCurrent(owner)) return 'stale';
      setIngestResult({ loading: false, error: null, payload });
      await onProjectCollectionsChanged();
      return isCurrent(owner) ? 'fresh' : 'stale';
    } catch (err) {
      if (!isCurrent(owner)) return 'stale';
      setIngestResult({ loading: false, error: err.message || 'Failed to run ingest validation', payload: null });
      return 'error';
    }
  }, [isCurrent, onProjectCollectionsChanged, projectId, routeOwner]);

  return { ingestResult, requestIngestValidation };
}
