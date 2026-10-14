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
import { isMiddleMousePanEvent, normalizeTileViewportTransform, stopMiddleMouseDefault } from './inspectionUtils';
import { getDraftBox, getDraftLine, isCommittableDraftBox } from './annotationDraftReducer';
import { MEASUREMENT_COLORS } from './inspectionAnnotationDisplay';

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
  tilePanDragRef,
  normalizedInspectorViewport,
  setInspectorViewport,
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
    const preview = tileGeometryDragPreviewRef.current;
    tileAnnotationGeometryDragRef.current = null;
    setTileAnnotationGeometryDragPreview(null);
    suppressNextTileClickRef.current = true;
    if (cancel || !preview?.geometry) return;
    if (!hasDraggedGeometryChanged(preview, drag.source)) return;
    if (preview.kind === 'line') {
      await updateMeasurementAnnotationLine(preview.geometry.id, preview.geometry);
    } else if (preview.kind === 'box') {
      await updateBoxAnnotationGeometry(preview.geometry.id, preview.geometry);
    }
  };

  const startTileViewportPan = (event) => {
    if (!isMiddleMousePanEvent(event)) return false;
    stopMiddleMouseDefault(event);
    suppressNextTileClickRef.current = true;
    tilePanDragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: normalizedInspectorViewport.panX,
      startPanY: normalizedInspectorViewport.panY,
    };
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    return true;
  };

  const handleTileViewportPointerMove = (event) => {
    const panDrag = tilePanDragRef.current;
    if (!panDrag || (
      panDrag.pointerId !== undefined
      && event.pointerId !== undefined
      && panDrag.pointerId !== event.pointerId
    )) return false;
    stopMiddleMouseDefault(event);
    setInspectorViewport((previous) => normalizeTileViewportTransform({
      ...previous,
      panX: panDrag.startPanX + (event.clientX - panDrag.startClientX),
      panY: panDrag.startPanY + (event.clientY - panDrag.startClientY),
    }));
    return true;
  };

  const finishTileViewportPan = (event) => {
    const panDrag = tilePanDragRef.current;
    if (!panDrag || (
      panDrag.pointerId !== undefined
      && event.pointerId !== undefined
      && panDrag.pointerId !== event.pointerId
    )) return false;
    stopMiddleMouseDefault(event);
    safeReleasePointerCapture(panDrag.captureTarget || event.currentTarget, panDrag.pointerId ?? event.pointerId);
    tilePanDragRef.current = null;
    suppressNextTileClickRef.current = true;
    return true;
  };

  const handleTileAnnotationPointerDown = (event, imageId) => {
    if (startTileViewportPan(event)) return true;
    if (readOnly) return false;
    if (!annotationToolMode) return false;
    event.preventDefault();
    event.stopPropagation();
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return true;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    if (!requireCalibrationForAnnotation(annotationImageId, { surface: 'tile', toolMode: annotationToolMode })) return true;
    if (annotationToolMode === 'measure') {
      const firstPoint = annotationDraftsRef.current.tile.measure;
      if (!firstPoint) {
        startAnnotationDraft('tile', 'measure', { ...position, mode: 'measure', imageId: annotationImageId });
        return true;
      }
      const line = getDraftLine(firstPoint, position);
      const existingLineCount = (storedMeasurementLinesByImageId[String(annotationImageId || '')] || []).length;
      const color = MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length];
      createMeasurementAnnotation({
        imageId: annotationImageId,
        line,
        name: nextMeasurementName(classifyMeasurementLine(line)),
        color,
        distanceMm: getLineDistanceMm(line, annotationImageId),
      });
      finishAnnotationDraft('tile');
      setAnnotationToolMode('');
      return true;
    }
    return true;
  };

  const handleTileBoxPointerDown = (event, imageId) => {
    if (startTileViewportPan(event)) return true;
    if (readOnly) return false;
    if (!['box', 'crop'].includes(annotationToolMode)) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return true;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    if (!requireCalibrationForAnnotation(annotationImageId, { surface: 'tile', toolMode: annotationToolMode })) return true;
    startAnnotationDraft('tile', 'drag', { ...position, mode: 'box', imageId: annotationImageId });
    suppressNextTileClickRef.current = true;
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    return true;
  };

  const handleTileBoxPointerUp = (event, imageId) => {
    if (finishTileViewportPan(event)) return true;
    if (readOnly) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    if (!['box', 'crop'].includes(annotationToolMode)) return false;
    event.preventDefault();
    event.stopPropagation();
    suppressNextTileClickRef.current = true;
    const firstPoint = annotationDraftsRef.current.tile.drag;
    const position = getAnnotationSurfacePointerPosition(event);
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
    if (!annotationDraftsRef.current.tile.drag) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAnnotationDraft('tile');
    setAnnotationToolMode('');
    suppressNextTileClickRef.current = true;
    deactivateFullscreenBoxTools();
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
  };

  const handleTileAnnotationPointerMove = (event, imageId) => {
    if (handleTileViewportPointerMove(event)) return;
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
    finishTileViewportPan,
    handleTileAnnotationPointerDown,
    handleTileBoxPointerDown,
    handleTileBoxPointerUp,
    handleTileBoxPointerCancel,
    handleTileAnnotationPointerMove,
  };
}
