import { useCallback } from 'react';
import { getMprSliceKey } from './inspectionAnnotationDisplay';
import { MPR_AXES, MPR_AXIS_CONFIG } from './mprConstants';
import { getFallbackProjectionImage } from './mprGeometry';
import { getCachedMprSliceCanvas } from './mprSliceCache';
import {
  getMprAxisImageDimensions,
  getMprVolumeSourceEntries,
  hasMprVolumeSource,
  isServerVolumeDescriptor,
} from './volumeDescriptors';

/**
 * Resolves the backing image and slice context for MPR annotations and opens the fullscreen MPR annotation tool.
 */
export default function useMprAnnotationContext({
  mprDimensions,
  readOnly,
  selectedImageRef,
  openFullscreenTool,
  setAnnotationDraft,
  shellImageLayers,
  slicePosition,
  volumeCacheState,
  volumeImageStack,
}) {
  const getMprAnnotationImage = useCallback((axis) => {
    if (isServerVolumeDescriptor(volumeImageStack)) {
      return volumeImageStack.imageId || selectedImageRef || null;
    }
    if (axis === 'axial' && Array.isArray(volumeImageStack) && volumeImageStack.length > 0) {
      const target = slicePosition.axial;
      const match = volumeImageStack.find((entry) => Number(entry.sliceIndex) === Number(target)) || volumeImageStack[Math.min(target, volumeImageStack.length - 1)] || volumeImageStack[0];
      return match?.id || match?.imageId || selectedImageRef || null;
    }
    return getMprVolumeSourceEntries(volumeImageStack)[0]?.id || getMprVolumeSourceEntries(volumeImageStack)[0]?.imageId || selectedImageRef || null;
  }, [selectedImageRef, slicePosition.axial, volumeImageStack]);

  const getMprAnnotationSliceContext = useCallback((axis, explicitSliceIndex = slicePosition[axis]) => {
    const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
    const sliceIndex = Number(explicitSliceIndex ?? slicePosition[safeAxis] ?? 0) || 0;
    const slicePositionForCanvas = { ...slicePosition, [safeAxis]: sliceIndex };
    const cachedCanvas = getCachedMprSliceCanvas(safeAxis, slicePositionForCanvas, mprDimensions, volumeCacheState.cache);
    const fallbackDimensions = getMprAxisImageDimensions(safeAxis, mprDimensions, volumeCacheState.cache);
    return {
      axis: safeAxis,
      sliceIndex,
      sliceKey: getMprSliceKey(safeAxis, sliceIndex),
      imageId: getMprAnnotationImage(safeAxis),
      canvas: cachedCanvas,
      imageWidth: Number(cachedCanvas?.width) || fallbackDimensions.width,
      imageHeight: Number(cachedCanvas?.height) || fallbackDimensions.height,
    };
  }, [getMprAnnotationImage, mprDimensions, slicePosition, volumeCacheState.cache]);

  const openMprAnnotationTool = useCallback((axis, mode) => {
    // Opening a slice fullscreen is a viewing action. Archived projects may
    // still inspect slices; only the annotation modes are mutations.
    if (readOnly && mode) return;
    const sliceContext = getMprAnnotationSliceContext(axis);
    const hasVolumeStack = hasMprVolumeSource(volumeImageStack);
    const fallbackImage = !hasVolumeStack
      ? getFallbackProjectionImage(sliceContext.axis, shellImageLayers)
      : null;
    const imageId = fallbackImage?.id || sliceContext.imageId;
    if (!imageId) return;
    const sliceValue = sliceContext.sliceIndex;
    const axisLabel = (MPR_AXIS_CONFIG[axis]?.sliceLabel || axis).toUpperCase();
    const label = `${MPR_AXIS_CONFIG[axis]?.label || axis.toUpperCase()} slice ${sliceValue}`;
    openFullscreenTool(!hasVolumeStack ? {
      sourceKind: 'image',
      imageId: String(imageId),
      label,
    } : {
      sourceKind: 'mpr',
      axis: sliceContext.axis,
      sliceIndex: sliceContext.sliceIndex,
      sliceKey: sliceContext.sliceKey,
      backingImageId: String(imageId),
      imageId: String(imageId),
      label,
    }, mode);
    setAnnotationDraft((prev) => ({ ...prev, comment: `${mode === 'measure' ? 'Measurement' : 'Box'} on ${axisLabel} ${sliceValue}` }));
  }, [
    getMprAnnotationSliceContext,
    openFullscreenTool,
    readOnly,
    setAnnotationDraft,
    shellImageLayers,
    volumeImageStack,
  ]);

  return {
    getMprAnnotationImage,
    getMprAnnotationSliceContext,
    openMprAnnotationTool,
  };
}
