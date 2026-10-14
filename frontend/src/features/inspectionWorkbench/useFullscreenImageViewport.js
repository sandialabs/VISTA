import { useCallback, useRef, useState } from 'react';

export const DEFAULT_FULLSCREEN_IMAGE_ZOOM = {
  scale: 1,
  originX: 50,
  originY: 50,
  panX: 0,
  panY: 0,
};

export function clampFullscreenZoomScale(value, minScale, maxScale) {
  const numeric = Number(value);
  const fallback = Number(minScale) || 1;
  const min = Number(minScale) || fallback;
  const max = Math.max(min, Number(maxScale) || min);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function getNextFullscreenZoom({ currentZoom, direction, position, minScale, maxScale }) {
  const currentScale = Number(currentZoom?.scale) || 1;
  const nextScale = clampFullscreenZoomScale(
    currentScale * (direction > 0 ? 1.15 : 1 / 1.15),
    minScale,
    maxScale,
  );
  return {
    scale: nextScale,
    originX: (position.displayX / position.rect.width) * 100,
    originY: (position.displayY / position.rect.height) * 100,
    panX: currentZoom?.panX || 0,
    panY: currentZoom?.panY || 0,
  };
}

export function getNextFullscreenPanZoom(currentZoom, panDrag, event) {
  return {
    ...currentZoom,
    panX: panDrag.startPanX + (event.clientX - panDrag.startClientX),
    panY: panDrag.startPanY + (event.clientY - panDrag.startClientY),
  };
}

export default function useFullscreenImageViewport({
  getPointerPosition,
  isMiddleMousePanEvent,
  maxScale,
  middleMouseButton,
  minScale,
  stopMiddleMouseDefault,
}) {
  const [fullscreenImageZoom, setFullscreenImageZoom] = useState(DEFAULT_FULLSCREEN_IMAGE_ZOOM);
  const [fullscreenImagePanning, setFullscreenImagePanning] = useState(false);
  const fullscreenPanDragRef = useRef(null);

  const resetFullscreenImageZoom = useCallback(() => {
    setFullscreenImageZoom(DEFAULT_FULLSCREEN_IMAGE_ZOOM);
  }, []);

  const clearFullscreenPan = useCallback(() => {
    fullscreenPanDragRef.current = null;
    setFullscreenImagePanning(false);
  }, []);

  const updateFullscreenImageZoomFromWheel = useCallback((event, { disabled = false } = {}) => {
    if (disabled) return;
    const position = getPointerPosition(event);
    if (!position) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setFullscreenImageZoom((currentZoom) => getNextFullscreenZoom({
      currentZoom,
      direction,
      position,
      minScale,
      maxScale,
    }));
  }, [getPointerPosition, maxScale, minScale]);

  const startFullscreenPan = useCallback((event, { canPan, toolActive = false } = {}) => {
    if (!canPan) return false;
    const middlePan = isMiddleMousePanEvent(event);
    const leftPan = event.button === 0 && !toolActive;
    if (!middlePan && !leftPan) return false;
    if (event.target?.classList?.contains('inspection-measurement-endpoint-dot')) return false;
    if (event.target?.classList?.contains('inspection-box-corner-dot')) return false;
    if (event.target?.classList?.contains('inspection-annotation-drag-target')) return false;
    if (middlePan) stopMiddleMouseDefault(event);
    else event.preventDefault();
    fullscreenPanDragRef.current = {
      button: middlePan ? middleMouseButton : 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: Number(fullscreenImageZoom.panX || 0),
      startPanY: Number(fullscreenImageZoom.panY || 0),
    };
    setFullscreenImagePanning(true);
    return true;
  }, [fullscreenImageZoom.panX, fullscreenImageZoom.panY, isMiddleMousePanEvent, middleMouseButton, stopMiddleMouseDefault]);

  const stopFullscreenPan = useCallback((event = null) => {
    const panDrag = fullscreenPanDragRef.current;
    if (!panDrag) return false;
    if (event && event.button !== undefined && event.button !== panDrag.button) return false;
    if (event && panDrag.button === middleMouseButton) stopMiddleMouseDefault(event);
    clearFullscreenPan();
    return true;
  }, [clearFullscreenPan, middleMouseButton, stopMiddleMouseDefault]);

  const updateFullscreenPanFromPointerMove = useCallback((event) => {
    const panDrag = fullscreenPanDragRef.current;
    if (!panDrag) return false;
    if (panDrag.button === middleMouseButton) stopMiddleMouseDefault(event);
    else event.preventDefault();
    setFullscreenImageZoom((currentZoom) => getNextFullscreenPanZoom(currentZoom, panDrag, event));
    return true;
  }, [middleMouseButton, stopMiddleMouseDefault]);

  return {
    clearFullscreenPan,
    fullscreenImagePanning,
    fullscreenImageZoom,
    fullscreenPanDragRef,
    resetFullscreenImageZoom,
    setFullscreenImageZoom,
    setFullscreenImagePanning,
    startFullscreenPan,
    stopFullscreenPan,
    updateFullscreenImageZoomFromWheel,
    updateFullscreenPanFromPointerMove,
  };
}
