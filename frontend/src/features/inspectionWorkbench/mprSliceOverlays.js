import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_FILL_OPACITY,
  getMprCubeBoxesForSlice,
  getMprSliceKey,
} from './inspectionAnnotationDisplay';
import { isFiniteAnnotationBox, isFiniteMeasurementLine } from './inspectionAnnotationGeometry';
import { segmentVisibleOnSlice } from './segmentationGeometry';

function isDraftOnSlice(draft, axis, sliceIndex) {
  return draft.axis === axis && Number(draft.sliceIndex) === sliceIndex;
}

function applyDragPreview(items, kind, dragPreview) {
  return items.map((item) => (
    dragPreview?.kind === kind
    && String(dragPreview.geometry?.id) === String(item.id)
      ? dragPreview.geometry
      : item
  ));
}

export function getMprDraftOverlays({ axis, sliceIndex, mprAnnotationPreview, mprPendingCubeDraft }) {
  const previewOnSlice = Boolean(mprAnnotationPreview) && isDraftOnSlice(mprAnnotationPreview, axis, sliceIndex);
  return {
    mprPreviewLines: previewOnSlice && mprAnnotationPreview.mode === 'measure' ? [mprAnnotationPreview.line] : [],
    mprPreviewBoxes: previewOnSlice && mprAnnotationPreview.box ? [mprAnnotationPreview.box] : [],
    pendingCubeBoxes: mprPendingCubeDraft && isDraftOnSlice(mprPendingCubeDraft, axis, sliceIndex)
      ? [{
        ...mprPendingCubeDraft.box,
        id: 'mpr-cube-pending',
        color: DEFAULT_ANNOTATION_COLOR,
        fillOpacity: DEFAULT_ANNOTATION_FILL_OPACITY,
      }]
      : [],
  };
}

export function getMprPersistedSliceOverlays({ axis, sliceIndex, annotations, mprGeometryDragPreview }) {
  const sliceKey = getMprSliceKey(axis, sliceIndex);
  const mprSliceLines = applyDragPreview(
    (annotations.mprMeasurementLinesBySlice[sliceKey] || []).filter(isFiniteMeasurementLine),
    'line',
    mprGeometryDragPreview,
  );
  const mprEditableSliceBoxes = applyDragPreview(
    (annotations.mprBoxAnnotationsBySlice[sliceKey] || []).filter(isFiniteAnnotationBox),
    'box',
    mprGeometryDragPreview,
  );
  const mprSliceBoxes = [
    ...mprEditableSliceBoxes,
    ...getMprCubeBoxesForSlice(annotations.mprCubeAnnotations, axis, sliceIndex),
  ].filter(isFiniteAnnotationBox);
  return { mprSliceLines, mprEditableSliceBoxes, mprSliceBoxes };
}

export function getMprSliceSegments({ axis, canonicalSliceIndex, annotationLayerVisible, vectorSegmentAnnotations }) {
  if (!annotationLayerVisible) return [];
  return vectorSegmentAnnotations.filter((segment) => (
    segmentVisibleOnSlice(segment, axis, canonicalSliceIndex)
  ));
}

export function buildMprSliceOverlays({
  axis,
  sliceIndex,
  canonicalSliceIndex,
  annotationLayerVisible,
  annotations,
  drafts,
}) {
  return {
    ...getMprDraftOverlays({ axis, sliceIndex, ...drafts }),
    ...getMprPersistedSliceOverlays({
      axis,
      sliceIndex,
      annotations,
      mprGeometryDragPreview: drafts.mprGeometryDragPreview,
    }),
    mprSliceSegments: getMprSliceSegments({
      axis,
      canonicalSliceIndex,
      annotationLayerVisible,
      vectorSegmentAnnotations: annotations.vectorSegmentAnnotations,
    }),
  };
}
