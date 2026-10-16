import { useCallback, useEffect } from 'react';
import {
  safeReleasePointerCapture,
  safeSetPointerCapture,
} from '../../utils/annotationGeometry';

/**
 * MPR slice stepping, 3D volume orbit and zoom gestures, and the fullscreen 3D dialog focus trap.
 */
export default function useMprSliceNavigation({
  applyMprNavigationSession,
  mprDimensions,
  mprDragRef,
  mprFullscreenCloseRef,
  mprFullscreenOpen,
  mprFullscreenOpenerRef,
  mprFullscreenSceneRef,
  mprRotation,
  setMprFullscreenOpen,
  suppressNextMprSceneClickRef,
}) {
  const clearMprVolumeDrag = useCallback((suppressSceneClick = false) => {
    const drag = mprDragRef.current;
    mprDragRef.current = null;
    suppressNextMprSceneClickRef.current = Boolean(suppressSceneClick && drag?.moved);
    safeReleasePointerCapture(drag?.captureTarget, drag?.pointerId);
  }, [mprDragRef, suppressNextMprSceneClickRef]);

  useEffect(() => {
    if (!mprFullscreenOpen) {
      clearMprVolumeDrag(false);
      return undefined;
    }
    mprFullscreenCloseRef.current?.focus();
    const handleWindowBlur = () => clearMprVolumeDrag(false);
    const handleKeyDown = (event) => {
      if (event.key === 'Tab') {
        const dialog = mprFullscreenSceneRef.current?.closest('[role="dialog"]');
        const focusable = Array.from(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])
          .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0);
        if (focusable.length === 0) return;
        event.preventDefault();
        const activeIndex = focusable.indexOf(document.activeElement);
        const nextIndex = event.shiftKey
          ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
          : (activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
        focusable[nextIndex].focus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearMprVolumeDrag(false);
        setMprFullscreenOpen(false);
        window.requestAnimationFrame(() => mprFullscreenOpenerRef.current?.focus());
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    clearMprVolumeDrag,
    mprFullscreenOpen,
    mprFullscreenCloseRef,
    mprFullscreenOpenerRef,
    mprFullscreenSceneRef,
    setMprFullscreenOpen,
  ]);

  const updateSlicePosition = (axis, value, dimensions) => {
    const upper = Math.max(0, (dimensions?.[axis] || 1) - 1);
    const nextValue = Math.min(upper, Math.max(0, Number(value) || 0));
    applyMprNavigationSession((previous) => ({
      slicePosition: { ...previous.slicePosition, [axis]: nextValue },
    }));
  };

  const stepSlicePosition = (axis, delta, { activatePane = false } = {}) => {
    const upper = Math.max(0, (mprDimensions?.[axis] || 1) - 1);
    applyMprNavigationSession((previous) => ({
      slicePosition: {
        ...previous.slicePosition,
        [axis]: Math.min(
          upper,
          Math.max(0, Number(previous.slicePosition?.[axis] || 0) + delta),
        ),
      },
      ...(activatePane ? {
        activePane: axis,
        lastActiveAxis: axis,
      } : {}),
    }));
  };

  const handleMprPaneWheel = (axis, event) => {
    event.preventDefault();
    stepSlicePosition(axis, event.deltaY > 0 ? 1 : -1, { activatePane: true });
  };

  const handleMprVolumeWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    applyMprNavigationSession((previous) => ({
      activePane: 'volume',
      viewportTransform: {
        ...previous.viewportTransform,
        zoom: Math.min(
          4,
          Math.max(0.5, Number((previous.viewportTransform.zoom + delta).toFixed(2))),
        ),
      },
    }));
  };

  const handleMprVolumePointerDown = (event) => {
    event.preventDefault();
    if ((event.button !== undefined && event.button !== 0) || mprDragRef.current) return;
    applyMprNavigationSession({ activePane: 'volume' });
    mprDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotation: mprRotation,
      moved: false,
      captureTarget: event.currentTarget,
    };
    safeSetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handleMprVolumePointerMove = (event) => {
    const drag = mprDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    applyMprNavigationSession({
      rotation: {
        x: Math.min(72, Math.max(-72, drag.rotation.x + dy * 0.35)),
        y: drag.rotation.y + dx * 0.35,
      },
    });
  };

  const handleMprVolumePointerUp = (event) => {
    const drag = mprDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      clearMprVolumeDrag(drag.moved);
    }
  };

  const handleMprVolumePointerCancel = (event) => {
    const drag = mprDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    clearMprVolumeDrag(false);
  };

  const openMprFullscreen = (event) => {
    if (suppressNextMprSceneClickRef.current) {
      suppressNextMprSceneClickRef.current = false;
      return;
    }
    mprFullscreenOpenerRef.current = event.currentTarget.querySelector?.('[role="button"]') || event.currentTarget;
    applyMprNavigationSession({ activePane: 'volume' });
    setMprFullscreenOpen(true);
  };

  const closeMprFullscreen = () => {
    clearMprVolumeDrag(false);
    setMprFullscreenOpen(false);
    window.requestAnimationFrame(() => mprFullscreenOpenerRef.current?.focus());
  };

  const preventMprNativeDrag = (event) => {
    event.preventDefault();
  };

  return {
    closeMprFullscreen,
    handleMprPaneWheel,
    handleMprVolumePointerCancel,
    handleMprVolumePointerDown,
    handleMprVolumePointerMove,
    handleMprVolumePointerUp,
    handleMprVolumeWheel,
    openMprFullscreen,
    preventMprNativeDrag,
    stepSlicePosition,
    updateSlicePosition,
  };
}
