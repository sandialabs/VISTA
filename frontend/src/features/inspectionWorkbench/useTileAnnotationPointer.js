import {
  clientPointToSource,
  getContainedImageTransform,
  safeReleasePointerCapture,
  safeSetPointerCapture,
} from '../../utils/annotationGeometry';
import {
  computeDraggedGeometry,
  getLineLengthPx,
  scalePointToGeometrySpace,
} from './annotationPointerGeometry';
import {
  FULLSCREEN_MIN_MEASURE_LENGTH_PX,
  getDraftBox,
  getDraftLine,
  isCommittableDraftBox,
  isCommittableDraftLine,
} from './annotationDraftReducer';
import { MEASUREMENT_COLORS } from './inspectionAnnotationDisplay';
import { commitDraggedGeometry } from './annotationDragCommit';

export function useTileAnnotationPointer({
  tileGeometryDragPreviewRef,
  setTileGeometryDragPreview,
  readOnly,
  annotations,
  suppressNextTileClickRef,
  setSelectedAnnotationId,
  setAnnotationToolMode,
  cancelAnnotationDraft,
  tileAnnotationGeometryDragRef,
  getLineDistanceMm,
  updateMeasurementAnnotationLine,
  updateBoxAnnotationGeometry,
  annotationToolMode,
  getAnnotationSourceImageIdForImage,
  requireCalibrationForAnnotation,
  annotationDraftsRef,
  startAnnotationDraft,
  storedMeasurementLinesByImageId,
  createMeasurementAnnotation,
  nextMeasurementName,
  classifyMeasurementLine,
  finishAnnotationDraft,
  createCropChildImage,
  storedBoxAnnotationsByImageId,
  createBoxAnnotation,
  deactivateFullscreenBoxTools,
  moveAnnotationDraft,
}) {
  const getAnnotationSurfacePointerPosition = (event) => {
    const surface = event.currentTarget;
    const image = surface.tagName === 'IMG'
      ? surface
      : surface.querySelector('img.inspection-view-image:not(.analysis-overlay-image)') || surface.querySelector('img');
    const rect = image?.getBoundingClientRect?.() || surface.getBoundingClientRect();
    const naturalWidth = Number(image?.naturalWidth || rect.width);
    const naturalHeight = Number(image?.naturalHeight || rect.height);
    const transform = getContainedImageTransform({
      elementRect: rect,
      sourceWidth: naturalWidth,
      sourceHeight: naturalHeight,
    });
    const point = clientPointToSource(transform, event, { rejectOutside: true });
    if (!point) return null;
    return { x: point.x, y: point.y, imageWidth: naturalWidth, imageHeight: naturalHeight };
  };

  const getTileGeometryPointerPosition = (event, geometry, { clampToImage = false } = {}) => {
    const surface = event.currentTarget?.closest?.('.inspection-image-annotation-surface')
      || event.currentTarget;
    const image = surface?.querySelector?.('img.inspection-view-image:not(.analysis-overlay-image)')
      || surface?.querySelector?.('img');
    const rect = image?.getBoundingClientRect?.() || surface?.getBoundingClientRect?.();
    const naturalWidth = Number(image?.naturalWidth || rect?.width);
    const naturalHeight = Number(image?.naturalHeight || rect?.height);
    const transform = getContainedImageTransform({
      elementRect: rect,
      sourceWidth: naturalWidth,
      sourceHeight: naturalHeight,
    });
    const point = clientPointToSource(transform, event, {
      rejectOutside: !clampToImage,
      clamp: clampToImage,
    });
    return scalePointToGeometrySpace(point, naturalWidth, naturalHeight, geometry);
  };

  const setTileAnnotationGeometryDragPreview = (preview) => {
    tileGeometryDragPreviewRef.current = preview;
    setTileGeometryDragPreview(preview);
  };

  const startTileAnnotationGeometryDrag = (event, kind, operation, geometry, imageId) => {
    if (readOnly) return;
    if (
      !geometry?.id
      || (event.button !== undefined && event.button !== 0)
      || !annotations.some((annotation) => String(annotation.id) === String(geometry.id))
    ) return;
    const startPoint = getTileGeometryPointerPosition(event, geometry);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextTileClickRef.current = true;
    setSelectedAnnotationId(geometry.id);
    setAnnotationToolMode('');
    cancelAnnotationDraft('tile');
    const source = { ...geometry };
    tileAnnotationGeometryDragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      kind,
      operation,
      imageId: String(imageId || geometry.imageId || ''),
      source,
      startPoint,
    };
    setTileAnnotationGeometryDragPreview({
      kind,
      imageId: String(imageId || geometry.imageId || ''),
      geometry: source,
    });
    safeSetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handleTileAnnotationGeometryDragMove = (event) => {
    const drag = tileAnnotationGeometryDragRef.current;
    if (!drag || (
      drag.pointerId !== undefined
      && event.pointerId !== undefined
      && drag.pointerId !== event.pointerId
    )) return;
    const position = getTileGeometryPointerPosition(event, drag.source, { clampToImage: true });
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    let geometry = computeDraggedGeometry(drag, position);
    if (geometry && drag.kind === 'line') {
      geometry = {
        ...geometry,
        distancePx: getLineLengthPx(geometry),
        distanceMm: getLineDistanceMm(geometry, drag.imageId),
      };
    }
    if (geometry) {
      setTileAnnotationGeometryDragPreview({
        kind: drag.kind,
        imageId: drag.imageId,
        geometry,
      });
    }
  };

  const finishTileAnnotationGeometryDrag = async (event, { cancel = false } = {}) => {
    if (readOnly) return;
    const drag = tileAnnotationGeometryDragRef.current;
    if (!drag || (
      drag.pointerId !== undefined
      && event.pointerId !== undefined
      && drag.pointerId !== event.pointerId
    )) return;
    event.preventDefault();
    event.stopPropagation();
    safeReleasePointerCapture(drag.captureTarget, drag.pointerId);
    tileAnnotationGeometryDragRef.current = null;
    suppressNextTileClickRef.current = true;
    await commitDraggedGeometry({
      preview: tileGeometryDragPreviewRef.current,
      source: drag.source,
      cancel,
      previewRef: tileGeometryDragPreviewRef,
      setPreview: setTileAnnotationGeometryDragPreview,
      updateMeasurementAnnotationLine,
      updateBoxAnnotationGeometry,
    });
  };

  // Tile click handler. Measure, box, and crop are all drawn by press-drag-release
  // in the pointer handlers below, so a click while a tool is active is consumed
  // (it must not open the fullscreen viewer) and draws nothing.
  const handleTileAnnotationPointerDown = (event) => {
    if (readOnly) return false;
    if (!annotationToolMode) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const commitTileMeasureLine = (firstPoint, position, annotationImageId) => {
    const line = getDraftLine(firstPoint, position);
    if (!isCommittableDraftLine(line, { minLength: FULLSCREEN_MIN_MEASURE_LENGTH_PX })) return false;
    const existingLineCount = (storedMeasurementLinesByImageId[String(annotationImageId || '')] || []).length;
    createMeasurementAnnotation({
      imageId: annotationImageId,
      line,
      name: nextMeasurementName(classifyMeasurementLine(line)),
      color: MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length],
      distanceMm: getLineDistanceMm(line, annotationImageId),
    });
    return true;
  };

  const handleTileBoxPointerDown = (event, imageId) => {
    if (readOnly) return false;
    if (!['measure', 'box', 'crop'].includes(annotationToolMode)) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return true;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    if (!requireCalibrationForAnnotation(annotationImageId, { surface: 'tile', toolMode: annotationToolMode })) return true;
    if (annotationToolMode === 'measure') {
      startAnnotationDraft('tile', 'measure', { ...position, mode: 'measure', imageId: annotationImageId });
    } else {
      startAnnotationDraft('tile', 'drag', { ...position, mode: 'box', imageId: annotationImageId });
    }
    suppressNextTileClickRef.current = true;
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    return true;
  };

  const handleTileBoxPointerUp = (event, imageId) => {
    if (readOnly) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    if (!['measure', 'box', 'crop'].includes(annotationToolMode)) return false;
    event.preventDefault();
    event.stopPropagation();
    suppressNextTileClickRef.current = true;
    const position = getAnnotationSurfacePointerPosition(event);
    if (annotationToolMode === 'measure') {
      const measurePoint = annotationDraftsRef.current.tile.measure;
      if (!measurePoint) return true;
      // Clear the draft first so a repeated pointerup cannot commit a second line.
      finishAnnotationDraft('tile');
      safeReleasePointerCapture(event.currentTarget, event.pointerId);
      const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
      const sameImage = String(measurePoint.imageId || '') === String(annotationImageId || '');
      // A press-release without a drag keeps the tool armed so the user can retry.
      if (position && sameImage && commitTileMeasureLine(measurePoint, position, annotationImageId)) {
        setAnnotationToolMode('');
      }
      return true;
    }
    const firstPoint = annotationDraftsRef.current.tile.drag;
    if (firstPoint && position) {
      const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
      const box = getDraftBox(firstPoint, position);
      if (isCommittableDraftBox(box)) {
        if (annotationToolMode === 'crop') {
          createCropChildImage({ parentImageId: annotationImageId, cropBox: box });
        } else {
        const existingBoxCount = (storedBoxAnnotationsByImageId[String(annotationImageId || '')] || []).length;
        createBoxAnnotation({
          imageId: annotationImageId,
          box,
          name: 'Drawn bounding box',
          color: MEASUREMENT_COLORS[existingBoxCount % MEASUREMENT_COLORS.length],
        });
        }
      }
    }
    finishAnnotationDraft('tile');
    setAnnotationToolMode('');
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
    return true;
  };

  const handleTileBoxPointerCancel = (event) => {
    const { drag, measure } = annotationDraftsRef.current.tile;
    if (!drag && !measure) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAnnotationDraft('tile');
    setAnnotationToolMode('');
    suppressNextTileClickRef.current = true;
    deactivateFullscreenBoxTools();
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
  };

  const handleTileAnnotationPointerMove = (event, imageId) => {
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return;
    const { measure: measurePoint, drag: firstPoint } = annotationDraftsRef.current.tile;
    if (annotationToolMode === 'measure' && measurePoint && String(measurePoint.imageId || '') === String(annotationImageId || '')) {
      const line = getDraftLine(measurePoint, position, {
        id: 'tile-measure-preview',
        imageId: String(annotationImageId || ''),
        color: '#f97316',
        distancePx: Math.hypot(position.x - measurePoint.x, position.y - measurePoint.y),
        distanceMm: getLineDistanceMm(
          { x1: measurePoint.x, y1: measurePoint.y, x2: position.x, y2: position.y },
          annotationImageId,
        ),
      });
      moveAnnotationDraft('tile', { mode: 'measure', imageId: String(annotationImageId || ''), line });
      return;
    }
    if (['box', 'crop'].includes(annotationToolMode) && firstPoint && String(firstPoint.imageId || '') === String(annotationImageId || '')) {
      const box = getDraftBox(firstPoint, position, {
        id: 'tile-box-preview',
        imageId: String(annotationImageId || ''),
        color: '#f97316',
      });
      moveAnnotationDraft('tile', { mode: annotationToolMode, imageId: String(annotationImageId || ''), box });
    }
  };

  return {
    startTileAnnotationGeometryDrag,
    handleTileAnnotationGeometryDragMove,
    finishTileAnnotationGeometryDrag,
    handleTileAnnotationPointerDown,
    handleTileBoxPointerDown,
    handleTileBoxPointerUp,
    handleTileBoxPointerCancel,
    handleTileAnnotationPointerMove,
  };
}
