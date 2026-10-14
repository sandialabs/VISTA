import { useEffect } from 'react';
import { fetchImageVolumeMetadata } from '../../api/images';
import { getProjectImageRecord, upsertProjectImageRecord } from './imageLookup';
import { getVolumeMetadataProbeCandidates, normalizeProbedVolumeMetadata } from './volumeDescriptors';

/**
 * Probes volume metadata for the selected part's volume candidates and merges the results into the project image lookup.
 */
export default function useInspectionVolumeMetadataProbe({
  projectId,
  projectImageLookup,
  selectedPart,
  setProjectImageLookup,
  setVolumeMetadataProbeState,
  volumeMetadataProbeCacheRef,
}) {
  useEffect(() => {
    const candidates = getVolumeMetadataProbeCandidates(selectedPart, projectImageLookup);
    if (candidates.length === 0) {
      setVolumeMetadataProbeState((previous) => (
        previous.pending || previous.warning ? { pending: false, warning: '' } : previous
      ));
      return undefined;
    }

    const unresolved = candidates.filter((candidate) => !candidate.imageId);
    const probeableById = new Map();
    candidates.forEach((candidate) => {
      if (candidate.imageId && !probeableById.has(candidate.imageId)) {
        probeableById.set(candidate.imageId, candidate);
      }
    });
    const probeable = Array.from(probeableById.values());
    if (probeable.length === 0) {
      const labels = unresolved.map((candidate) => candidate.filename || 'unnamed volume').join(', ');
      setVolumeMetadataProbeState({
        pending: false,
        warning: `Unable to inspect volume metadata because the image record is unavailable: ${labels}`,
      });
      return undefined;
    }

    let cancelled = false;
    setVolumeMetadataProbeState({ pending: true, warning: '' });
    const probes = probeable.map((candidate) => {
      const cacheKey = `${String(projectId)}:${candidate.imageId}`;
      let probe = volumeMetadataProbeCacheRef.current.get(cacheKey);
      if (!probe) {
        probe = fetchImageVolumeMetadata(candidate.imageId, { errorLabel: 'metadata request failed' })
          .then(normalizeProbedVolumeMetadata);
        volumeMetadataProbeCacheRef.current.set(cacheKey, probe);
        probe.catch(() => {
          if (volumeMetadataProbeCacheRef.current.get(cacheKey) === probe) {
            volumeMetadataProbeCacheRef.current.delete(cacheKey);
          }
        });
      }
      return probe.then((metadata) => ({ candidate, metadata }));
    });

    Promise.allSettled(probes).then((results) => {
      if (cancelled) return;
      const successful = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      if (successful.length > 0) {
        setProjectImageLookup((previous) => {
          let next = previous;
          successful.forEach(({ candidate, metadata }) => {
            const existing = getProjectImageRecord(next, { image_id: candidate.imageId }) || {};
            const filename = String(existing.filename || candidate.filename || '');
            const updated = {
              ...existing,
              id: candidate.imageId,
              filename,
              ...metadata,
              metadata: {
                ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
                ...metadata,
              },
            };
            next = upsertProjectImageRecord(next, updated);
          });
          return next;
        });
      }
      const failedLabels = results
        .map((result, index) => (result.status === 'rejected'
          ? (probeable[index]?.filename || probeable[index]?.imageId || 'volume')
          : null))
        .filter(Boolean);
      const unresolvedLabels = unresolved.map((candidate) => candidate.filename || 'unnamed volume');
      const warningLabels = [...failedLabels, ...unresolvedLabels];
      setVolumeMetadataProbeState({
        pending: false,
        warning: warningLabels.length > 0
          ? `Unable to inspect volume metadata for ${warningLabels.join(', ')}. The volume was not rendered as a regular image.`
          : '',
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    projectImageLookup,
    selectedPart,
    setProjectImageLookup,
    setVolumeMetadataProbeState,
    volumeMetadataProbeCacheRef,
  ]);
}
