import { MPR_DISPLAY_AXES_BY_VIEW } from './mprConstants';
import {
  clientPointToSource,
  getContainedImageTransform,
  safeReleasePointerCapture,
  safeSetPointerCapture,
} from '../../utils/annotationGeometry';
import {
  computeDraggedGeometry,
  getLineLengthPx,
  hasDraggedGeometryChanged,
  scalePointToGeometrySpace,
} from './annotationPointerGeometry';
import { getDraftBox, getDraftLine, isCommittableDraftBox } from './annotationDraftReducer';
import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_FILL_OPACITY,
  MEASUREMENT_COLORS,
  getMprSliceKey,
} from './inspectionAnnotationDisplay';

export function useMprAnnotationPointer({
  getMprAnnotationSliceContext,
  mprProjectionMirror,
  readOnly,
  annotationToolMode,
  applyMprNavigationSession,
  slicePosition,
  requireCalibrationForAnnotation,
  annotationDraftsRef,
  startAnnotationDraft,
  storedMprMeasurementLinesBySlice,
  createMeasurementAnnotation,
  getMprAnnotationImage,
  nextMeasurementName,
  classifyMeasurementLine,
  finishAnnotationDraft,
  setAnnotationToolMode,
  moveAnnotationDraft,
  storedMprBoxAnnotationsBySlice,
  createBoxAnnotation,
  createCubeAnnotation,
  cancelAnnotationDraft,
  mprGeometryDragPreviewRef,
  setMprGeometryDragPreview,
  annotations,
  setSelectedAnnotationId,
  mprAnnotationGeometryDragRef,
  getLineDistanceMm,
  updateMeasurementAnnotationLine,
  updateBoxAnnotationGeometry,
}) {
  const getMprAnnotationPointerPosition = (
    event,
    axis,
    explicitSliceIndex,
    { clampToImage = false } = {},
  ) => {
    const context = getMprAnnotationSliceContext(axis, explicitSliceIndex);
    const eventTarget = event.currentTarget;
    const surface = eventTarget?.classList?.contains('mpr-crosshair-preview')
      ? eventTarget
      : eventTarget?.closest?.('.mpr-crosshair-preview') || eventTarget;
    if (!surface?.getBoundingClientRect) return null;
    const rect = surface.getBoundingClientRect();
    const displayAxes = MPR_DISPLAY_AXES_BY_VIEW[axis] || MPR_DISPLAY_AXES_BY_VIEW.axial;
    const transform = getContainedImageTransform({
      elementRect: rect,
      sourceWidth: context.imageWidth,
      sourceHeight: context.imageHeight,
      mirrorX: mprProjectionMirror[displayAxes.x] === true,
      mirrorY: mprProjectionMirror[displayAxes.y] === true,
    });
    const point = clientPointToSource(transform, event, {
      rejectOutside: !clampToImage,
      clamp: clampToImage,
    });
    if (!point) return null;
    return { x: point.x, y: point.y, imageWidth: context.imageWidth, imageHeight: context.imageHeight, axis: context.axis, sliceIndex: context.sliceIndex, sliceKey: context.sliceKey, imageId: context.imageId };
  };

  const handleMprAnnotationPointerDown = (event, axis) => {
    if (readOnly) return false;
    if (!['measure', 'box', 'cube'].includes(annotationToolMode)) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    applyMprNavigationSession({
      activePane: axis,
      lastActiveAxis: axis,
    });
    const sliceIndex = Number(slicePosition[axis] || 0);
    const position = getMprAnnotationPointerPosition(event, axis, sliceIndex);
    if (!position) return true;
    if (annotationToolMode === 'measure'
      && !requireCalibrationForAnnotation(position.imageId, { surface: 'tile', toolMode: annotationToolMode })) return true;
    if (annotationToolMode === 'measure') {
      const measurePoint = annotationDraftsRef.current.mpr.measure;
      const firstPoint = measurePoint?.axis === axis ? measurePoint : null;
      if (!firstPoint) {
        startAnnotationDraft('mpr', 'measure', { ...position, mode: 'measure', axis, sliceIndex });
        return true;
      }
      const line = getDraftLine(firstPoint, position, { axis, slice_index: firstPoint.sliceIndex });
      const key = firstPoint.sliceKey || getMprSliceKey(axis, firstPoint.sliceIndex);
      const existingLineCount = (storedMprMeasurementLinesBySlice[key] || []).length;
      createMeasurementAnnotation({
        imageId: firstPoint.imageId || getMprAnnotationImage(axis),
        line,
        name: nextMeasurementName(classifyMeasurementLine(line)),
        color: MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length],
        modality: 'volume',
        geometryPatch: { axis, slice_index: firstPoint.sliceIndex },
      });
      finishAnnotationDraft('mpr');
      setAnnotationToolMode('');
      return true;
    }
    startAnnotationDraft('mpr', 'drag', { ...position, mode: annotationToolMode, axis, sliceIndex }, {
      keepPending: annotationToolMode === 'cube',
    });
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    return true;
  };

  const handleMprAnnotationPointerMove = (event, axis) => {
    if (!['measure', 'box', 'cube'].includes(annotationToolMode)) return;
    const sliceIndex = Number(slicePosition[axis] || 0);
    const { measure: measurePoint, drag: firstPoint } = annotationDraftsRef.current.mpr;
    const position = getMprAnnotationPointerPosition(event, axis, annotationToolMode === 'measure' ? measurePoint?.sliceIndex : sliceIndex);
    if (!position) return;
    if (annotationToolMode === 'measure' && measurePoint?.axis === axis) {
      const line = getDraftLine(measurePoint, position, {
        id: 'mpr-measure-preview',
        imageId: measurePoint.sliceKey || getMprSliceKey(axis, measurePoint.sliceIndex),
        axis,
        sliceIndex: measurePoint.sliceIndex,
        color: DEFAULT_ANNOTATION_COLOR,
        distancePx: Math.hypot(position.x - measurePoint.x, position.y - measurePoint.y),
        distanceMm: null,
      });
      moveAnnotationDraft('mpr', { mode: 'measure', axis, sliceIndex: measurePoint.sliceIndex, line });
      return;
    }
    if (firstPoint && firstPoint.axis === axis && ['box', 'cube'].includes(annotationToolMode)) {
      const box = getDraftBox(firstPoint, position, {
        id: `mpr-${annotationToolMode}-preview`,
        imageId: position.sliceKey || getMprSliceKey(axis, sliceIndex),
        color: DEFAULT_ANNOTATION_COLOR,
        fillOpacity: DEFAULT_ANNOTATION_FILL_OPACITY,
        axis,
        sliceIndex,
      });
      moveAnnotationDraft('mpr', { mode: annotationToolMode, axis, sliceIndex, box });
    }
  };

  const handleMprAnnotationPointerUp = (event, axis) => {
    if (readOnly) return false;
    if (!['box', 'cube'].includes(annotationToolMode)) return false;
    event.preventDefault();
    event.stopPropagation();
    const { drag: firstPoint, pending: pendingCube } = annotationDraftsRef.current.mpr;
    const sliceIndex = Number(slicePosition[axis] || 0);
    const position = getMprAnnotationPointerPosition(event, axis, sliceIndex);
    // Box mode clears the pending cube face; cube mode keeps it unless a
    // finite box replaces or completes it.
    const finishOptions = annotationToolMode === 'cube' ? {} : { pending: null };
    if (firstPoint && position && firstPoint.axis === axis) {
      const box = getDraftBox(firstPoint, position, { axis, sliceIndex });
      if (isCommittableDraftBox(box)) {
        if (annotationToolMode === 'box') {
          const key = position.sliceKey || getMprSliceKey(axis, sliceIndex);
          const existingBoxCount = (storedMprBoxAnnotationsBySlice[key] || []).length;
          createBoxAnnotation({
            imageId: position.imageId || getMprAnnotationImage(axis),
            box,
            name: 'Drawn MPR bounding box',
            color: MEASUREMENT_COLORS[existingBoxCount % MEASUREMENT_COLORS.length],
            modality: 'volume',
            geometryPatch: { axis, slice_index: sliceIndex, box: { axis, slice_index: sliceIndex } },
          });
          setAnnotationToolMode('');
        } else {
          const firstCubeBox = pendingCube?.box || null;
          if (firstCubeBox && firstCubeBox.axis === axis && Number(firstCubeBox.sliceIndex) !== sliceIndex) {
            createCubeAnnotation({
              axis,
              firstBox: firstCubeBox,
              secondBox: box,
              color: DEFAULT_ANNOTATION_COLOR,
            });
            setAnnotationToolMode('');
            finishOptions.pending = null;
          } else {
            finishOptions.pending = { mode: 'cube-pending', axis, sliceIndex, box };
          }
        }
      }
    }
    finishAnnotationDraft('mpr', finishOptions);
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
    return true;
  };

  const handleMprAnnotationPointerCancel = (event) => {
    if (!annotationDraftsRef.current.mpr.drag) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAnnotationDraft('mpr', ['drag', 'preview']);
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
  };

  const setMprAnnotationGeometryDragPreview = (preview) => {
    mprGeometryDragPreviewRef.current = preview;
    setMprGeometryDragPreview(preview);
  };

  const getMprGeometryPointerPosition = (event, axis, sliceIndex, geometry, options = {}) => {
    const position = getMprAnnotationPointerPosition(event, axis, sliceIndex, options);
    return scalePointToGeometrySpace(position, position?.imageWidth, position?.imageHeight, geometry);
  };

  const startMprAnnotationGeometryDrag = (event, kind, operation, geometry, axis, sliceIndex) => {
    if (readOnly) return;
    if (
      annotationToolMode
      || !geometry?.id
      || (event.button !== undefined && event.button !== 0)
      || !annotations.some((annotation) => String(annotation.id) === String(geometry.id))
    ) return;
    const startPoint = getMprGeometryPointerPosition(event, axis, sliceIndex, geometry);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    applyMprNavigationSession({
      activePane: axis,
      lastActiveAxis: axis,
    });
    setSelectedAnnotationId(geometry.id);
    const source = { ...geometry };
    mprAnnotationGeometryDragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      kind,
      operation,
      axis,
      sliceIndex,
      source,
      startPoint,
    };
    setMprAnnotationGeometryDragPreview({ kind, geometry: source });
    safeSetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handleMprAnnotationGeometryDragMove = (event) => {
    const drag = mprAnnotationGeometryDragRef.current;
    if (!drag || (
      drag.pointerId !== undefined
      && event.pointerId !== undefined
      && drag.pointerId !== event.pointerId
    )) return;
    const position = getMprGeometryPointerPosition(
      event,
      drag.axis,
      drag.sliceIndex,
      drag.source,
      { clampToImage: true },
    );
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    let geometry = computeDraggedGeometry(drag, position);
    if (geometry && drag.kind === 'line') {
      geometry = {
        ...geometry,
        distancePx: getLineLengthPx(geometry),
        distanceMm: getLineDistanceMm(geometry, geometry.imageId),
      };
    }
    if (geometry) setMprAnnotationGeometryDragPreview({ kind: drag.kind, geometry });
  };

  const finishMprAnnotationGeometryDrag = async (event, { cancel = false } = {}) => {
    if (readOnly) return;
    const drag = mprAnnotationGeometryDragRef.current;
    if (!drag || (
      drag.pointerId !== undefined
      && event.pointerId !== undefined
      && drag.pointerId !== event.pointerId
    )) return;
    event.preventDefault();
    event.stopPropagation();
    safeReleasePointerCapture(drag.captureTarget, drag.pointerId);
    const preview = mprGeometryDragPreviewRef.current;
    mprAnnotationGeometryDragRef.current = null;
    setMprAnnotationGeometryDragPreview(null);
    if (cancel || !preview?.geometry) return;
    if (!hasDraggedGeometryChanged(preview, drag.source)) return;
    if (preview.kind === 'line') await updateMeasurementAnnotationLine(preview.geometry.id, preview.geometry);
    if (preview.kind === 'box') await updateBoxAnnotationGeometry(preview.geometry.id, preview.geometry);
  };

  const stopMprAnnotationGeometryClick = (event) => {
    if (annotationToolMode) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    handleMprAnnotationPointerDown,
    handleMprAnnotationPointerMove,
    handleMprAnnotationPointerUp,
    handleMprAnnotationPointerCancel,
    startMprAnnotationGeometryDrag,
    handleMprAnnotationGeometryDragMove,
    finishMprAnnotationGeometryDrag,
    stopMprAnnotationGeometryClick,
  };
}
