import { useCallback } from 'react';
import { MPR_DISPLAY_AXES_BY_VIEW } from './mprConstants';
import {
  clientPointToSource,
  getContainedImageTransform,
  safeReleasePointerCapture,
  safeSetPointerCapture,
} from '../../utils/annotationGeometry';
import {
  computeDraggedGeometry,
  scalePointToGeometrySpace,
} from './annotationPointerGeometry';
import useFullscreenImageViewport from './useFullscreenImageViewport';
import { isMiddleMousePanEvent, stopMiddleMouseDefault } from './inspectionUtils';
import { FULLSCREEN_IMAGE_ZOOM_MAX, FULLSCREEN_IMAGE_ZOOM_MIN, MIDDLE_MOUSE_BUTTON } from './inspectionConstants';
import { makeBoxFromPoints } from './inspectionAnnotationGeometry';

export function useFullscreenAnnotationPointer({
  fullscreenSession,
  mprProjectionMirror,
  annotationDraftsRef,
  moveAnnotationDraft,
  getLineDistanceMm,
  readOnly,
  setSelectedAnnotationId,
  updateMeasurementAnnotationLine,
  updateBoxAnnotationGeometry,
  cancelAnnotationDraft,
}) {
  const {
    beginFullscreenGeometryEdit,
    closeFullscreenSession,
    fullscreenAnnotationDragRef,
    fullscreenBackingImageId,
    fullscreenBoxActive,
    fullscreenCalibrationPromptVisible,
    fullscreenCropActive,
    fullscreenEditingBoxCorner,
    fullscreenEditingEndpoint,
    fullscreenGeometryDragPreviewRef,
    fullscreenImageModal,
    fullscreenImageRef,
    fullscreenMeasureActive,
    setFullscreenDragPreview,
  } = fullscreenSession;
  const getFullscreenImagePointerPosition = useCallback((event, { clampToImage = false } = {}) => {
    const surface = fullscreenImageRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const isCanvasSurface = surface.tagName === 'CANVAS';
    const naturalWidth = Number(isCanvasSurface ? surface.width : surface.naturalWidth);
    const naturalHeight = Number(isCanvasSurface ? surface.height : surface.naturalHeight);
    const isMprSurface = fullscreenImageModal?.sourceKind === 'mpr';
    const displayAxes = isMprSurface
      ? (MPR_DISPLAY_AXES_BY_VIEW[fullscreenImageModal.axis] || MPR_DISPLAY_AXES_BY_VIEW.axial)
      : null;
    const transform = getContainedImageTransform({
      elementRect: rect,
      sourceWidth: naturalWidth,
      sourceHeight: naturalHeight,
      mirrorX: Boolean(displayAxes && mprProjectionMirror[displayAxes.x] === true),
      mirrorY: Boolean(displayAxes && mprProjectionMirror[displayAxes.y] === true),
    });
    const point = clientPointToSource(transform, event, {
      rejectOutside: !clampToImage,
      clamp: clampToImage,
    });
    if (!point) return null;
    const rawDisplayX = event.clientX - rect.left;
    const rawDisplayY = event.clientY - rect.top;
    return {
      x: point.x,
      y: point.y,
      displayX: rawDisplayX,
      displayY: rawDisplayY,
      rawDisplayX,
      rawDisplayY,
      rect,
      naturalWidth,
      naturalHeight,
      contentRect: transform.contentRect,
    };
  }, [fullscreenImageModal?.axis, fullscreenImageModal?.sourceKind, fullscreenImageRef, mprProjectionMirror]);

  const {
    clearFullscreenPan,
    fullscreenImagePanning,
    fullscreenImageZoom,
    fullscreenPanDragRef,
    resetFullscreenImageZoom,
    startFullscreenPan,
    stopFullscreenPan,
    updateFullscreenImageZoomFromWheel,
    updateFullscreenPanFromPointerMove,
  } = useFullscreenImageViewport({
    getPointerPosition: getFullscreenImagePointerPosition,
    isMiddleMousePanEvent,
    maxScale: FULLSCREEN_IMAGE_ZOOM_MAX,
    middleMouseButton: MIDDLE_MOUSE_BUTTON,
    minScale: FULLSCREEN_IMAGE_ZOOM_MIN,
    stopMiddleMouseDefault,
  });

  const getFullscreenGeometryPointerPosition = (event, geometry, options = {}) => {
    const position = getFullscreenImagePointerPosition(event, options);
    const scaled = scalePointToGeometrySpace(position, position?.naturalWidth, position?.naturalHeight, geometry);
    return scaled ? { ...position, ...scaled } : null;
  };

  const handleFullscreenImageWheel = (event) => {
    updateFullscreenImageZoomFromWheel(event, {
      disabled: Boolean(
        fullscreenMeasureActive
        || fullscreenBoxActive
        || fullscreenCropActive
        || fullscreenEditingEndpoint
        || fullscreenEditingBoxCorner
      ),
    });
  };

  const canPanFullscreenImage = () => (
    !fullscreenEditingEndpoint?.lineId
    && !fullscreenEditingBoxCorner?.boxId
    && !fullscreenAnnotationDragRef.current
    && !fullscreenCalibrationPromptVisible
  );

  const handleFullscreenPanMouseDown = (event) => {
    startFullscreenPan(event, {
      canPan: canPanFullscreenImage(),
      toolActive: fullscreenMeasureActive || fullscreenBoxActive || fullscreenCropActive,
    });
  };

  const handleFullscreenPanMouseUp = (event = null) => {
    stopFullscreenPan(event);
  };

  const handleFullscreenImagePointerMove = (event, lines, boxes = []) => {
    if (updateFullscreenPanFromPointerMove(event)) {
      return;
    }
    const position = getFullscreenImagePointerPosition(event);
    if (fullscreenEditingEndpoint?.lineId || fullscreenEditingBoxCorner?.boxId) {
      return;
    }
    if (fullscreenBoxActive || fullscreenCropActive) {
      const firstPoint = annotationDraftsRef.current.fullscreen.drag;
      if (firstPoint && position) {
        const box = {
          ...makeBoxFromPoints(firstPoint, {
            x: position.x,
            y: position.y,
            imageWidth: position.naturalWidth,
            imageHeight: position.naturalHeight,
          }),
          id: 'fullscreen-box-preview',
          color: '#f97316',
        };
        moveAnnotationDraft('fullscreen', { mode: fullscreenCropActive ? 'crop' : 'box', box });
      }
      return;
    }
    const firstMeasurePoint = annotationDraftsRef.current.fullscreen.measure;
    if (fullscreenMeasureActive && firstMeasurePoint && position) {
      const line = {
        id: 'fullscreen-measure-preview',
        x1: firstMeasurePoint.x,
        y1: firstMeasurePoint.y,
        x2: position.x,
        y2: position.y,
        imageWidth: position.naturalWidth,
        imageHeight: position.naturalHeight,
        color: '#f97316',
        distancePx: Math.hypot(position.x - firstMeasurePoint.x, position.y - firstMeasurePoint.y),
        distanceMm: getLineDistanceMm(
          { x1: firstMeasurePoint.x, y1: firstMeasurePoint.y, x2: position.x, y2: position.y },
          fullscreenBackingImageId,
        ),
      };
      moveAnnotationDraft('fullscreen', { mode: 'measure', line });
      return;
    }
  };

  const startFullscreenAnnotationDrag = (event, kind, operation, geometry) => {
    if (readOnly) return;
    if (!geometry?.id || (event.button !== undefined && event.button !== 0)) return;
    const position = getFullscreenGeometryPointerPosition(event, geometry);
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAnnotationId(geometry.id);
    beginFullscreenGeometryEdit(geometry.id);
    clearFullscreenPan();
    const source = { ...geometry };
    fullscreenAnnotationDragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      kind,
      operation,
      source,
      startPoint: { x: position.x, y: position.y },
    };
    setFullscreenDragPreview({ kind, geometry: source });
    safeSetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handleFullscreenAnnotationDragMove = (event) => {
    const drag = fullscreenAnnotationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = getFullscreenGeometryPointerPosition(
      event,
      drag.source,
      { clampToImage: true },
    );
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    const geometry = computeDraggedGeometry(drag, position);
    if (geometry) setFullscreenDragPreview({ kind: drag.kind, geometry });
  };

  const finishFullscreenAnnotationDrag = async (event, { cancel = false } = {}) => {
    if (readOnly) return;
    const drag = fullscreenAnnotationDragRef.current;
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    safeReleasePointerCapture(drag.captureTarget, drag.pointerId);
    const preview = fullscreenGeometryDragPreviewRef.current;
    fullscreenAnnotationDragRef.current = null;
    setFullscreenDragPreview(null);
    if (cancel || !preview?.geometry) return;
    if (preview.kind === 'line') await updateMeasurementAnnotationLine(preview.geometry.id, preview.geometry);
    if (preview.kind === 'box') await updateBoxAnnotationGeometry(preview.geometry.id, preview.geometry);
  };

  const closeFullscreenImageModal = () => {
    const activeAnnotationDrag = fullscreenAnnotationDragRef.current;
    if (activeAnnotationDrag) safeReleasePointerCapture(activeAnnotationDrag.captureTarget, activeAnnotationDrag.pointerId);
    closeFullscreenSession();
    clearFullscreenPan();
    cancelAnnotationDraft('fullscreen', ['measure', 'drag']);
    resetFullscreenImageZoom();
    cancelAnnotationDraft('fullscreen', ['preview']);
  };

  return {
    getFullscreenImagePointerPosition,
    fullscreenImagePanning,
    fullscreenImageZoom,
    fullscreenPanDragRef,
    resetFullscreenImageZoom,
    handleFullscreenImageWheel,
    handleFullscreenPanMouseDown,
    handleFullscreenPanMouseUp,
    handleFullscreenImagePointerMove,
    startFullscreenAnnotationDrag,
    handleFullscreenAnnotationDragMove,
    finishFullscreenAnnotationDrag,
    closeFullscreenImageModal,
  };
}
