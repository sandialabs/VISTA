import { useMemo } from 'react';
import { MPR_FALLBACK_MODEL_SIZE, MPR_VOLUME_RENDERER_MAX_SLICES } from './mprConstants';
import { getMprFallbackModelCoordinate } from './mprGeometry';
import { getOverlayStackResourceId, getShellImageLayers } from './partImageRefs';
import { useMprVolumeCaches } from './useMprVolumeCache';
import {
  getAlignedVolumeOverlayRendererStacks,
  getServerVolumeSliceUrl,
  getVolumeRendererSliceIndices,
  hasMprVolumeSource,
  isServerVolumeDescriptor,
} from './volumeDescriptors';

/**
 * Overlay volume caches plus shell and volume renderer layer stacks for the PT3 3D view.
 */
export default function useInspectionVolumeRendererLayers({
  loadedVolumeOverlayStacks,
  mprDimensions,
  projectImageLookup,
  selectedExternalOverlayResourceId,
  selectedPart,
  visibleSemantic3dVolumeOverlayStacks,
  volumeImageStack,
  volumeOverlayLayersVisible,
  volumeRenderSummariesByImageId,
}) {
  const volumeOverlayCacheStates = useMprVolumeCaches(loadedVolumeOverlayStacks, mprDimensions);
  const activeVolumeOverlayCaches = useMemo(
    () => (volumeOverlayLayersVisible ? volumeOverlayCacheStates.map((state) => state.cache).filter(Boolean) : []),
    [volumeOverlayLayersVisible, volumeOverlayCacheStates],
  );
  const hasVolumeImageSource = hasMprVolumeSource(volumeImageStack);
  const shellImageLayers = useMemo(
    () => getShellImageLayers(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );
  const volumePreviewLayers = useMemo(() => {
    const maxLayers = MPR_VOLUME_RENDERER_MAX_SLICES;
    if (isServerVolumeDescriptor(volumeImageStack)) {
      const axialCount = Math.max(1, Number(volumeImageStack.dimensions?.axial) || 1);
      return getVolumeRendererSliceIndices(
        axialCount,
        maxLayers,
      )
        .map((sliceIndex, index, entries) => ({
          ...volumeImageStack,
          id: `${volumeImageStack.imageId}:axial:${sliceIndex}`,
          sliceIndex,
          url: getServerVolumeSliceUrl(volumeImageStack, 'axial', sliceIndex),
          depth: getMprFallbackModelCoordinate(sliceIndex, axialCount, MPR_FALLBACK_MODEL_SIZE.depth),
          opacity: entries.length <= 1 ? 0.86 : 0.18 + (index / (entries.length - 1)) * 0.26,
        }));
    }
    if (!Array.isArray(volumeImageStack) || volumeImageStack.length === 0) return [];
    return getVolumeRendererSliceIndices(volumeImageStack.length, maxLayers)
      .map((sourceIndex) => ({ entry: volumeImageStack[sourceIndex], sourceIndex }))
      .map(({ entry, sourceIndex }, index, entries) => ({
        ...entry,
        depth: getMprFallbackModelCoordinate(
          Number.isFinite(Number(entry.sliceIndex)) ? Number(entry.sliceIndex) : sourceIndex,
          Math.max(1, Number(mprDimensions.axial) || volumeImageStack.length),
          MPR_FALLBACK_MODEL_SIZE.depth,
        ),
        opacity: entries.length <= 1 ? 0.86 : 0.18 + (index / (entries.length - 1)) * 0.26,
      }));
  }, [mprDimensions.axial, volumeImageStack]);
  const volumeRendererImageStack = volumePreviewLayers;
  const volumeRendererDescriptor = isServerVolumeDescriptor(volumeImageStack)
    ? volumeImageStack.volumeDescriptor
    : null;
  const volumeRendererOverlayImageStacks = useMemo(
    () => getAlignedVolumeOverlayRendererStacks(
      visibleSemantic3dVolumeOverlayStacks,
      volumeRendererImageStack,
      mprDimensions,
      volumeRenderSummariesByImageId,
    ),
    [mprDimensions, visibleSemantic3dVolumeOverlayStacks, volumeRendererImageStack, volumeRenderSummariesByImageId],
  );
  const highlightedVolumeRendererOverlayImageStacks = useMemo(() => (
    selectedExternalOverlayResourceId
      ? volumeRendererOverlayImageStacks.filter((stack) => (
        String(getOverlayStackResourceId(stack)) === selectedExternalOverlayResourceId
      )).map((stack) => stack.map((layer) => ({ ...layer, highlighted: true })))
      : []
  ), [selectedExternalOverlayResourceId, volumeRendererOverlayImageStacks]);
  const displayVolumeRendererOverlayImageStacks = useMemo(
    () => [
      ...volumeRendererOverlayImageStacks,
      ...highlightedVolumeRendererOverlayImageStacks,
    ],
    [highlightedVolumeRendererOverlayImageStacks, volumeRendererOverlayImageStacks],
  );

  return {
    activeVolumeOverlayCaches,
    displayVolumeRendererOverlayImageStacks,
    hasVolumeImageSource,
    shellImageLayers,
    volumePreviewLayers,
    volumeRendererDescriptor,
    volumeRendererImageStack,
  };
}
