import { useEffect, useMemo } from 'react';
import { fetchImageVolumeRenderSummary } from '../../api/images';
import { MPR_RECONSTRUCTION_MODES, MPR_VOLUME_RENDER_SUMMARY_VERSION } from './mprConstants';
import { useMprVolumeCache } from './useMprVolumeCache';
import {
  getSemantic3dVolumeOverlayStacks,
  getVolumeOverlayStacks,
  getVolumeSourceImages,
  isServerVolumeDescriptor,
  mapWithConcurrency,
} from './volumeDescriptors';

/**
 * Volume and overlay source stacks for the selected PT3 part, server render summaries, and the primary volume cache.
 */
export default function useInspectionVolumeSources({
  mprDimensions,
  mprReconstructionMode,
  projectId,
  projectImageLookup,
  selectedPart,
  setVolumeRenderSummariesByImageId,
  volumeRenderSummaryCacheRef,
}) {
  const volumeImageStack = useMemo(
    () => getVolumeSourceImages(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );
  const volumeOverlayStacks = useMemo(
    () => getVolumeOverlayStacks(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );
  // Global annotation visibility is a render-time concern. Keeping confirmed
  // stacks loaded avoids tearing down and decoding the 3D overlay texture on
  // every hide/show cycle; individually hidden resources remain unloaded.
  const loadedVolumeOverlayStacks = useMemo(
    () => volumeOverlayStacks.filter((entry) => entry?.hidden !== true),
    [volumeOverlayStacks],
  );
  const visibleSemantic3dVolumeOverlayStacks = useMemo(
    () => getSemantic3dVolumeOverlayStacks(loadedVolumeOverlayStacks),
    [loadedVolumeOverlayStacks],
  );
  const volumeRenderSummaryCandidates = useMemo(() => {
    if (mprReconstructionMode === MPR_RECONSTRUCTION_MODES.orientation) return [];
    const byImageId = new Map();
    visibleSemantic3dVolumeOverlayStacks.forEach((volume) => {
      if (
        !isServerVolumeDescriptor(volume)
        || !String(volume.filename || '').toLowerCase().endsWith('.npy')
      ) return;
      byImageId.set(String(volume.imageId), volume);
    });
    return Array.from(byImageId.values()).slice(0, 4);
  }, [mprReconstructionMode, visibleSemantic3dVolumeOverlayStacks]);
  useEffect(() => {
    if (volumeRenderSummaryCandidates.length === 0) {
      setVolumeRenderSummariesByImageId((previous) => (
        Object.keys(previous).length > 0 ? {} : previous
      ));
      return undefined;
    }
    let cancelled = false;
    mapWithConcurrency(volumeRenderSummaryCandidates, 2, async (volume) => {
      const imageId = String(volume.imageId);
      const cacheKey = `${String(projectId)}:${imageId}:${MPR_VOLUME_RENDER_SUMMARY_VERSION}`;
      let request = volumeRenderSummaryCacheRef.current.get(cacheKey);
      if (!request) {
        request = fetchImageVolumeRenderSummary(imageId, MPR_VOLUME_RENDER_SUMMARY_VERSION, {
          errorLabel: 'render summary request failed',
        });
        volumeRenderSummaryCacheRef.current.set(cacheKey, request);
        request.catch(() => {
          if (volumeRenderSummaryCacheRef.current.get(cacheKey) === request) {
            volumeRenderSummaryCacheRef.current.delete(cacheKey);
          }
        });
      }
      try {
        return [imageId, await request];
      } catch (_error) {
        return [imageId, null];
      }
    }).then((entries) => {
      if (cancelled) return;
      setVolumeRenderSummariesByImageId(Object.fromEntries(
        entries.filter(([, summary]) => summary && typeof summary === 'object'),
      ));
    });
    return () => { cancelled = true; };
  }, [
    projectId,
    volumeRenderSummaryCandidates,
    setVolumeRenderSummariesByImageId,
    volumeRenderSummaryCacheRef,
  ]);
  const volumeCacheState = useMprVolumeCache(volumeImageStack, mprDimensions);

  return {
    loadedVolumeOverlayStacks,
    visibleSemantic3dVolumeOverlayStacks,
    volumeCacheState,
    volumeImageStack,
  };
}
