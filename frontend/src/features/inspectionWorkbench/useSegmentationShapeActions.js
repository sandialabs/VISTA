import { safeReleasePointerCapture } from '../../utils/annotationGeometry';
import { floodFillVolume3dAsync } from '../../components/pt3SegmentationVolume';
import { runImageVolumeConnectedSelection } from '../../api/images';
import { runPartSliceSegmentation } from '../../api/parts';
import { MPR_AXES } from './mprConstants';
import { isServerVolumeDescriptor } from './volumeDescriptors';
import { applyShapeToSegmentationSegment } from './segmentationVolumeGeometry';
import {
  CONNECTED_VOLUME_LIMITS,
  buildConnectedSliceSelection,
  makeConnectedVolumeSelection,
  makeShapeFromMlRegion,
  pickMlRegionAtPosition,
  readCachedVolumeVoxel,
} from './segmentationConnectedSelection';

/**
 * Segmentation helper selection actions: 2D and 3D connected selection, the
 * ML slice helper, committing shapes into the selected segment, and draft
 * completion or cancellation. Uses no React hooks; refs are read through
 * `.current` at call time.
 */
export function useSegmentationShapeActions({
  readOnly,
  projectId,
  selectedPart,
  slicePosition,
  displayWindow,
  mprDimensions,
  volumeCacheState,
  segmentationHelperAxis,
  segmentationTool,
  segmentationOperation,
  segmentationSensitivity,
  segmentationMlMethod,
  segmentationMlParameters,
  segmentationPendingSelection,
  selectedSegmentationSegment,
  segmentationHelperActions,
  segmentationDraftRef,
  segmentationPointerSessionRef,
  segmentationVolumeRequestRef,
  segmentationMlCacheRef,
  segmentationGeometry,
  persistSegmentationSegment,
  updateSegmentationSegment,
}) {
  const {
    getSegmentationVolumeDimensions,
    getSegmentationCanonicalSliceIndex,
    getSegmentationVolumeSpacing,
    getSegmentationVoxelPosition,
    makeSegmentationShapeBase,
    getSegmentationMlCacheKey,
    getSegmentationSliceDataUrl,
    getSegmentationSliceCanvasForSelection,
  } = segmentationGeometry;

  const buildConnectedSegmentationSelection = (stageElement, position) => buildConnectedSliceSelection({
    canvas: getSegmentationSliceCanvasForSelection(stageElement, segmentationHelperAxis),
    position,
    segmentationSensitivity,
    makeSegmentationShapeBase,
  });

  const requestConnectedVolume = async (seedVoxel, controller, generation) => {
    const volumeCache = volumeCacheState.cache;
    if (isServerVolumeDescriptor(volumeCache)) {
      return runImageVolumeConnectedSelection(
        volumeCache.imageId,
        {
          seed: seedVoxel,
          sensitivity: Math.max(0, Number(segmentationSensitivity) || 0),
          display_min: Number(displayWindow.min),
          display_max: Number(displayWindow.max),
          max_voxels: CONNECTED_VOLUME_LIMITS.maxVoxels,
          max_examined: CONNECTED_VOLUME_LIMITS.maxExamined,
          max_runs: CONNECTED_VOLUME_LIMITS.maxRuns,
        },
        { readOnly, signal: controller.signal, errorLabel: '3D connected selection failed' },
      );
    }
    if (!volumeCache?.slices?.length) {
      throw new Error('The volume is still loading; try again when all slices are ready.');
    }
    if (volumeCache.complete !== true) {
      throw new Error(
        `3D connected selection needs a complete volume (${Number(volumeCache.validSliceCount) || 0}/${volumeCache.slices.length} slices available).`,
      );
    }
    const dimensions = getSegmentationVolumeDimensions();
    return floodFillVolume3dAsync({
      dimensions,
      seed: seedVoxel,
      sensitivity: Math.max(0, Number(segmentationSensitivity) || 0),
      getVoxel: (x, y, z) => readCachedVolumeVoxel(volumeCache, dimensions, x, y, z),
      ...CONNECTED_VOLUME_LIMITS,
      isCancelled: () => (
        controller.signal.aborted
        || segmentationVolumeRequestRef.current.generation !== generation
      ),
    });
  };

  const showConnectedVolumePreview = (selection) => {
    segmentationHelperActions.setPendingSelection(selection);
    const count = Number(selection.voxelCount) || 0;
    const truncatedSuffix = selection.truncated
      ? ` Limit reached (${selection.truncationReason || 'guard'}); preview is partial.`
      : '';
    segmentationHelperActions.setVolumeStatus(
      `3D preview: ${count.toLocaleString()} voxels, 6-neighbor connectivity.${truncatedSuffix}`,
    );
  };

  const buildConnectedVolumeSegmentationSelection = async (position) => {
    if (readOnly) return;
    const sourceAxis = segmentationHelperAxis;
    const sourceSliceIndex = getSegmentationCanonicalSliceIndex(sourceAxis);
    const seedVoxel = getSegmentationVoxelPosition(position, sourceAxis);
    const segmentId = selectedSegmentationSegment?.id || '';
    if (!seedVoxel) {
      segmentationHelperActions.setVolumeStatus('Choose a valid voxel in an X, Y, or Z slice.');
      return;
    }
    segmentationVolumeRequestRef.current.controller?.abort();
    const generation = segmentationVolumeRequestRef.current.generation + 1;
    const controller = new AbortController();
    segmentationVolumeRequestRef.current = { generation, controller, segmentId };
    segmentationHelperActions.startVolumePreview('Growing a six-connected 3D preview…');
    try {
      const result = await requestConnectedVolume(seedVoxel, controller, generation);
      if (
        controller.signal.aborted
        || segmentationVolumeRequestRef.current.generation !== generation
      ) return;
      showConnectedVolumePreview(makeConnectedVolumeSelection({
        makeSegmentationShapeBase,
        getSegmentationVolumeDimensions,
        position,
        seedVoxel,
        result,
        segmentId,
        sourceAxis,
        sourceSliceIndex,
      }));
    } catch (error) {
      if (error?.name !== 'AbortError') {
        segmentationHelperActions.setVolumeStatus(error?.message || 'Unable to build the 3D connected preview.');
      }
    } finally {
      if (segmentationVolumeRequestRef.current.generation === generation) {
        segmentationVolumeRequestRef.current.controller = null;
        segmentationHelperActions.setVolumeLoading(false);
      }
    }
  };

  const selectRegionFromCachedMlResult = (cachedResult, position) => {
    const { regions, selectedRegion } = pickMlRegionAtPosition(cachedResult, position);
    const shape = makeShapeFromMlRegion({
      region: selectedRegion,
      position,
      cachedResult,
      segmentationHelperAxis,
      segmentationMlMethod,
      mprDimensions,
      volumeCache: volumeCacheState.cache,
      makeSegmentationShapeBase,
    });
    if (shape) {
      segmentationHelperActions.setMlSelection(shape, `Selected ML region ${selectedRegion.label} from ${regions.length} cached regions.`);
    } else {
      segmentationHelperActions.setMlSelection(null, regions.length > 0 ? 'No ML segment contains that click.' : 'No ML segments were returned for this slice.');
    }
  };

  const runSegmentationMlHelper = async (event, position) => {
    if (readOnly) return;
    if (!selectedPart?.id || !position) return;
    const cacheKey = getSegmentationMlCacheKey(segmentationHelperAxis);
    const cached = segmentationMlCacheRef.current.get(cacheKey);
    if (cached) {
      selectRegionFromCachedMlResult(cached, position);
      return;
    }
    const imageData = getSegmentationSliceDataUrl(event.currentTarget, segmentationHelperAxis);
    if (!imageData) {
      segmentationHelperActions.setMlStatus('Current slice image is still loading.');
      return;
    }
    segmentationHelperActions.setMlLoading(true);
    segmentationHelperActions.setMlStatus('Running ML helper on this slice...');
    try {
      const result = await runPartSliceSegmentation(projectId, selectedPart.id, {
        axis: segmentationHelperAxis,
        slice_index: Number(slicePosition[segmentationHelperAxis] || 0),
        method_id: segmentationMlMethod,
        parameters: segmentationMlParameters,
        image_data_base64: imageData,
        filename: `${selectedPart.serial_number || selectedPart.id}-${segmentationHelperAxis}-${slicePosition[segmentationHelperAxis] || 0}.png`,
        click_x: position.x,
        click_y: position.y,
      }, { readOnly, errorLabel: 'ML helper failed' });
      segmentationMlCacheRef.current.set(cacheKey, result);
      selectRegionFromCachedMlResult(result, position);
    } catch (err) {
      segmentationHelperActions.setMlStatus(err.message || 'ML helper failed.');
    } finally {
      segmentationHelperActions.setMlLoading(false);
    }
  };

  const commitSegmentationShape = (shape, explicitOperation = segmentationOperation) => {
    if (readOnly) return;
    if (!shape || !selectedSegmentationSegment) return;
    const nextShape = {
      ...shape,
      operation: explicitOperation,
      color: selectedSegmentationSegment.color,
      axis: MPR_AXES.includes(shape.axis) ? shape.axis : segmentationHelperAxis,
      id: shape.id || `shape-${Date.now()}`,
    };
    const { nextSegment, shouldCompact, compactionWasTruncated } = applyShapeToSegmentationSegment(
      selectedSegmentationSegment,
      nextShape,
      { getSegmentationVolumeDimensions, getSegmentationVolumeSpacing },
    );
    if (shouldCompact && compactionWasTruncated) {
      segmentationHelperActions.setVolumeStatus(
        'The segment reached its geometry limit; the saved mask is a bounded partial result.',
      );
    }
    updateSegmentationSegment(selectedSegmentationSegment.id, nextSegment);
    persistSegmentationSegment(nextSegment);
    segmentationHelperActions.setPendingSelection(null);
    segmentationHelperActions.setDraftShape(null);
    if (shape.mode === '3d' && !compactionWasTruncated) {
      segmentationHelperActions.setVolumeStatus(
        `${Number(
          nextSegment.areas?.[0]?.voxelCount ?? shape.voxelCount ?? 0,
        ).toLocaleString()} volumetric voxels applied.`,
      );
    }
    segmentationDraftRef.current = null;
  };

  const commitPendingSegmentationSelection = (operation = segmentationOperation) => {
    if (readOnly) return;
    if (!segmentationPendingSelection) return;
    commitSegmentationShape(segmentationPendingSelection, operation);
  };

  const completeSegmentationPolygon = (event) => {
    if (readOnly) return;
    if (segmentationTool !== 'polygon') return;
    const draft = segmentationDraftRef.current;
    if (!draft || draft.tool !== 'polygon' || (draft.points || []).length < 3) return;
    event.preventDefault();
    event.stopPropagation();
    const closed = { ...draft, closed: true };
    segmentationHelperActions.setPendingSelection(closed);
    segmentationHelperActions.setDraftShape(null);
    segmentationDraftRef.current = null;
  };

  const cancelSegmentationDraft = ({
    preservePendingSelection = false,
    preserveVolumeRequest = false,
  } = {}) => {
    const pointerSession = segmentationPointerSessionRef.current;
    if (pointerSession) {
      safeReleasePointerCapture(pointerSession.captureTarget, pointerSession.pointerId);
      segmentationPointerSessionRef.current = null;
    }
    if (!preserveVolumeRequest) {
      segmentationVolumeRequestRef.current.controller?.abort();
      segmentationVolumeRequestRef.current = {
        generation: segmentationVolumeRequestRef.current.generation + 1,
        controller: null,
        segmentId: '',
      };
    }
    segmentationHelperActions.cancelDraft({
      preservePendingSelection,
      stopVolumeLoading: !preserveVolumeRequest,
    });
    segmentationDraftRef.current = null;
  };

  return {
    buildConnectedSegmentationSelection,
    buildConnectedVolumeSegmentationSelection,
    runSegmentationMlHelper,
    commitSegmentationShape,
    commitPendingSegmentationSelection,
    completeSegmentationPolygon,
    cancelSegmentationDraft,
  };
}
