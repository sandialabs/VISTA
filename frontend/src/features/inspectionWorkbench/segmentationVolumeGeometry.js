import { buildPt3SegmentVolumeRuns, mapVectorPlanePointToVoxel } from '../../components/pt3VectorAnnotations';
import { getMechanicalVolumeMetadata } from '../../components/pt3MechanicalVisualization';
import { MPR_AXES } from './mprConstants';
import { clampRange } from './inspectionUtils';
import { getCanonicalSegmentationSliceIndex } from './mprGeometry';
import { getMprAxisImageDimensions } from './volumeDescriptors';
import { getCachedMprSliceCanvas } from './mprSliceCache';
import { SEGMENTATION_HELPER_TOOLS } from './segmentationConfig';
import { segmentHasVolumeAreas } from './segmentationGeometry';

const SEGMENT_AREA_COMPACTION_LIMIT = 48;

/**
 * Builds the slice, voxel, and shape helpers the segmentation helper uses for
 * the current render. Each helper reads the render's values, so callers build
 * a fresh set per render instead of memoizing it.
 */
export function createSegmentationGeometry({
  segmentationHelperVolumeDimensions,
  segmentationHelperAxis,
  segmentationHelperView,
  segmentationTool,
  segmentationToolModes,
  segmentationOperation,
  segmentationBrushSize,
  segmentationSensitivity,
  segmentationMlMethod,
  segmentationMlParameters,
  slicePosition,
  mprDimensions,
  volumeCacheState,
  selectedPart,
  displayWindow,
}) {
  const getSegmentationVolumeDimensions = () => segmentationHelperVolumeDimensions;

  const getSegmentationCanonicalSliceIndex = (
    axis = segmentationHelperAxis,
    uiSliceIndex = slicePosition[axis],
  ) => {
    const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
    const volumeDimensions = getSegmentationVolumeDimensions();
    return getCanonicalSegmentationSliceIndex(
      safeAxis,
      uiSliceIndex,
      mprDimensions,
      volumeDimensions,
    );
  };

  const getSegmentationVolumeSpacing = () => {
    const spacing = getMechanicalVolumeMetadata(selectedPart)?.spacing;
    return Array.isArray(spacing) && spacing.length >= 3
      ? spacing.slice(0, 3).map((value) => Math.max(Number.EPSILON, Number(value) || 1))
      : [1, 1, 1];
  };

  const getActiveSegmentationToolMode = (toolId = segmentationTool) => {
    const tool = SEGMENTATION_HELPER_TOOLS.find((entry) => entry.id === toolId);
    if (!tool?.modes?.includes('3d')) return '2d';
    if (segmentationHelperView === '3d') return '3d';
    return segmentationToolModes[toolId] === '3d' ? '3d' : '2d';
  };

  const getSegmentationVoxelPosition = (position, axis = segmentationHelperAxis) => {
    if (!position || !MPR_AXES.includes(axis)) return null;
    const volumeDimensions = getSegmentationVolumeDimensions();
    const mapped = mapVectorPlanePointToVoxel({
      axis,
      point: position,
      sliceIndex: getSegmentationCanonicalSliceIndex(axis),
      imageWidth: position.imageWidth,
      imageHeight: position.imageHeight,
      dimensions: volumeDimensions,
    });
    if (!Array.isArray(mapped) || mapped.length < 3) return null;
    return mapped.map((value, index) => Math.max(
      0,
      Math.min(volumeDimensions[index] - 1, Math.round(Number(value) || 0)),
    ));
  };

  const makeSegmentationShapeBase = (tool, position, overrides = {}) => {
    const mode = overrides.mode || getActiveSegmentationToolMode(tool);
    const axis = segmentationHelperAxis;
    const dimensions = getMprAxisImageDimensions(axis, mprDimensions, volumeCacheState.cache);
    return {
      id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool,
      mode,
      operation: segmentationOperation,
      axis,
      sliceIndex: getSegmentationCanonicalSliceIndex(axis),
      imageWidth: position?.imageWidth || dimensions.width,
      imageHeight: position?.imageHeight || dimensions.height,
      volumeDimensions: getSegmentationVolumeDimensions(),
      brushSize: Number(segmentationBrushSize) || 18,
      sensitivity: Number(segmentationSensitivity) || 28,
      ...overrides,
    };
  };

  const getSegmentationMlCacheKey = (axis = segmentationHelperAxis) => JSON.stringify({
    partId: selectedPart?.id || '',
    axis,
    sliceIndex: Number(slicePosition[axis] || 0),
    methodId: segmentationMlMethod,
    parameters: segmentationMlParameters,
    displayWindow,
  });

  const getSegmentationSliceDataUrl = (stageElement, axis = segmentationHelperAxis) => {
    const renderedCanvas = stageElement?.querySelector?.('canvas.mpr-slice-canvas');
    if (renderedCanvas?.toDataURL) {
      return renderedCanvas.toDataURL('image/png');
    }
    const cachedCanvas = getCachedMprSliceCanvas(axis, slicePosition, mprDimensions, volumeCacheState.cache);
    if (cachedCanvas?.toDataURL) {
      return cachedCanvas.toDataURL('image/png');
    }
    return '';
  };

  const getSegmentationSliceCanvasForSelection = (stageElement, axis = segmentationHelperAxis) => {
    const renderedCanvas = stageElement?.querySelector?.('canvas.mpr-slice-canvas');
    if (renderedCanvas?.getContext) return renderedCanvas;
    return getCachedMprSliceCanvas(axis, slicePosition, mprDimensions, volumeCacheState.cache);
  };

  return {
    getSegmentationVolumeDimensions,
    getSegmentationCanonicalSliceIndex,
    getSegmentationVolumeSpacing,
    getActiveSegmentationToolMode,
    getSegmentationVoxelPosition,
    makeSegmentationShapeBase,
    getSegmentationMlCacheKey,
    getSegmentationSliceDataUrl,
    getSegmentationSliceCanvasForSelection,
  };
}

/** Clamps a segment slice-range patch to the volume's extent along the segment axis. */
export function clampSegmentationSlicePatch(segment, patch, volumeDimensions) {
  const maxSliceIndex = Math.max(0, (
    segment.axis === 'sagittal'
      ? volumeDimensions[0]
      : (segment.axis === 'coronal' ? volumeDimensions[1] : volumeDimensions[2])
  ) - 1);
  const next = {
    ...segment,
    ...patch,
    minSlice: clampRange(patch.minSlice ?? segment.minSlice, 0, maxSliceIndex, 0),
    maxSlice: clampRange(patch.maxSlice ?? segment.maxSlice, 0, maxSliceIndex, maxSliceIndex),
  };
  if (next.minSlice > next.maxSlice) {
    if (Object.prototype.hasOwnProperty.call(patch, 'minSlice')) next.maxSlice = next.minSlice;
    else next.minSlice = next.maxSlice;
  }
  return next;
}

export const makeCompactedVolumeArea = (compacted, spacing) => ({
  id: `volume-snapshot-${Date.now()}`,
  tool: 'volume-mask',
  mode: '3d',
  operation: 'add',
  volumeDimensions: compacted.dimensions,
  volumeRuns: compacted.runs,
  voxelCount: compacted.stats.voxelCount,
  spacing,
  truncated: compacted.stats.truncated,
  truncationReason: compacted.stats.truncated ? 'mask-compaction-limit' : '',
});

/**
 * Appends a committed shape to a segment, compacting the areas into one
 * volume mask when the segment holds volume areas or reaches the area limit.
 */
export function applyShapeToSegmentationSegment(segment, nextShape, {
  getSegmentationVolumeDimensions,
  getSegmentationVolumeSpacing,
}) {
  const volumeDimensions = nextShape.volumeDimensions
    || segment.volumeDimensions
    || getSegmentationVolumeDimensions();
  let existingAreas = [...(segment.areas || [])];
  let compactionWasTruncated = false;
  if (existingAreas.length >= SEGMENT_AREA_COMPACTION_LIMIT) {
    const existingCompacted = buildPt3SegmentVolumeRuns(
      { ...segment, volumeDimensions, areas: existingAreas },
      volumeDimensions,
      { includePlanar: true },
    );
    compactionWasTruncated = existingCompacted.stats.truncated;
    existingAreas = existingCompacted.runs.length > 0
      ? [makeCompactedVolumeArea(existingCompacted, getSegmentationVolumeSpacing())]
      : [];
  }
  let nextSegment = {
    ...segment,
    ...(nextShape.mode === '3d' ? { version: 2, volumeDimensions } : {}),
    areas: [...existingAreas, nextShape],
  };
  const shouldCompact = segmentHasVolumeAreas(nextSegment)
    || nextSegment.areas.length >= SEGMENT_AREA_COMPACTION_LIMIT;
  if (shouldCompact) {
    const compacted = buildPt3SegmentVolumeRuns(
      { ...nextSegment, volumeDimensions },
      volumeDimensions,
      { includePlanar: true },
    );
    nextSegment = {
      ...nextSegment,
      version: 2,
      volumeDimensions: compacted.dimensions,
      areas: compacted.runs.length > 0
        ? [makeCompactedVolumeArea(compacted, getSegmentationVolumeSpacing())]
        : [],
    };
    compactionWasTruncated = compactionWasTruncated || compacted.stats.truncated;
  }
  return { nextSegment, shouldCompact, compactionWasTruncated };
}
