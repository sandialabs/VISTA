import { useMemo } from 'react';
import { getMechanicalVolumeMetadata } from '../../components/pt3MechanicalVisualization';
import { buildPt3VectorAnnotationFaces } from '../../components/pt3VectorAnnotations';
import { MPR_AXES } from './mprConstants';
import { getCanonicalSegmentationSliceIndex } from './mprGeometry';
import { getMprAxisImageDimensions } from './volumeDescriptors';

/**
 * Derived 3D volume dimensions, metadata, canonical slices, and preview annotations for the segmentation helper.
 */
export default function useSegmentationHelper3dDerived({
  mprDimensions,
  segmentationHelperAxis,
  segmentationHelperOpen,
  segmentationHelperView,
  segmentationPendingSelection,
  segmentationSegments,
  selectedPart,
  selectedSegmentationSegment,
  slicePosition,
  volumeCacheState,
}) {
  const segmentationHelperVolumeDimensions = useMemo(() => ([
    Math.max(1, Number(volumeCacheState.cache?.width) || Number(mprDimensions.sagittal) || 1),
    Math.max(1, Number(volumeCacheState.cache?.height) || Number(mprDimensions.coronal) || 1),
    Math.max(1, Number(volumeCacheState.cache?.depth) || Number(mprDimensions.axial) || 1),
  ]), [
    mprDimensions.axial,
    mprDimensions.coronal,
    mprDimensions.sagittal,
    volumeCacheState.cache?.depth,
    volumeCacheState.cache?.height,
    volumeCacheState.cache?.width,
  ]);
  const segmentationHelper3dVolumeMetadata = useMemo(() => ({
    ...getMechanicalVolumeMetadata(selectedPart),
    dimensions: segmentationHelperVolumeDimensions,
  }), [segmentationHelperVolumeDimensions, selectedPart]);
  const segmentationHelperCanonicalSlicePosition = useMemo(
    () => Object.fromEntries(MPR_AXES.map((axis) => [
      axis,
      getCanonicalSegmentationSliceIndex(
        axis,
        slicePosition[axis],
        mprDimensions,
        segmentationHelperVolumeDimensions,
      ),
    ])),
    [mprDimensions, segmentationHelperVolumeDimensions, slicePosition],
  );
  const segmentationHelperPending3dPreviewSegment = useMemo(() => {
    if (segmentationPendingSelection?.mode !== '3d') return null;
    const axis = MPR_AXES.includes(segmentationHelperAxis) ? segmentationHelperAxis : 'axial';
    const axisDimensions = getMprAxisImageDimensions(
      axis,
      mprDimensions,
      volumeCacheState.cache,
    );
    return {
      ...(selectedSegmentationSegment || {}),
      id: 'pending-volume-selection',
      visible: true,
      color: '#fde047',
      opacity: 0.34,
      imageWidth: selectedSegmentationSegment?.imageWidth || axisDimensions.width,
      imageHeight: selectedSegmentationSegment?.imageHeight || axisDimensions.height,
      volumeDimensions: segmentationHelperVolumeDimensions,
      areas: [{ ...segmentationPendingSelection, operation: 'add' }],
    };
  }, [
    mprDimensions,
    segmentationHelperAxis,
    segmentationHelperVolumeDimensions,
    segmentationPendingSelection,
    selectedSegmentationSegment,
    volumeCacheState.cache,
  ]);
  const segmentationHelper3dAnnotations = useMemo(() => {
    const selectedId = String(selectedSegmentationSegment?.id || '');
    const selectedFirst = selectedId
      ? [
        selectedSegmentationSegment,
        ...segmentationSegments.filter((segment) => String(segment?.id || '') !== selectedId),
      ]
      : segmentationSegments;
    return segmentationHelperPending3dPreviewSegment
      ? [segmentationHelperPending3dPreviewSegment, ...selectedFirst]
      : selectedFirst;
  }, [
    segmentationHelperPending3dPreviewSegment,
    segmentationSegments,
    selectedSegmentationSegment,
  ]);
  const segmentation3dSurfacePreviewTruncated = useMemo(() => {
    if (!segmentationHelperOpen || segmentationHelperView !== '3d') return false;
    return buildPt3VectorAnnotationFaces(segmentationHelper3dAnnotations, {
      dimensions: segmentationHelperVolumeDimensions,
    }).stats.volumeSurfaceTruncated === true;
  }, [
    segmentationHelper3dAnnotations,
    segmentationHelperOpen,
    segmentationHelperView,
    segmentationHelperVolumeDimensions,
  ]);

  return {
    segmentation3dSurfacePreviewTruncated,
    segmentationHelper3dAnnotations,
    segmentationHelper3dVolumeMetadata,
    segmentationHelperCanonicalSlicePosition,
    segmentationHelperPending3dPreviewSegment,
    segmentationHelperVolumeDimensions,
  };
}
