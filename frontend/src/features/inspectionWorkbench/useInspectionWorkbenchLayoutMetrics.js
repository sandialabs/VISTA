import { useCallback, useEffect, useRef, useState } from 'react';

function getInitialViewportWidth() {
  return typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
}

function measureElementWidth(element) {
  if (!element) return 0;
  const bounds = element.getBoundingClientRect?.();
  const width = Math.max(0, Math.round(element.clientWidth || bounds?.width || 0));
  return Number.isFinite(width) && width > 0 ? width : 0;
}

export default function useInspectionWorkbenchLayoutMetrics() {
  const [viewportWidth, setViewportWidth] = useState(getInitialViewportWidth);
  const [workbenchWidth, setWorkbenchWidth] = useState(0);
  const inspectionResizeSaveTimerRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const workbenchDetailsRef = useCallback((node) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }

    if (!node) return;

    const updateWorkbenchWidth = () => {
      setWorkbenchWidth(measureElementWidth(node));
    };
    updateWorkbenchWidth();

    if (typeof ResizeObserver === 'undefined') return;
    resizeObserverRef.current = new ResizeObserver(updateWorkbenchWidth);
    resizeObserverRef.current.observe(node);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => () => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }
    if (inspectionResizeSaveTimerRef.current) {
      window.clearTimeout(inspectionResizeSaveTimerRef.current);
    }
  }, []);

  return {
    inspectionResizeSaveTimerRef,
    viewportWidth,
    workbenchDetailsRef,
    workbenchWidth,
  };
}

export {
  getInitialViewportWidth,
  measureElementWidth,
};
