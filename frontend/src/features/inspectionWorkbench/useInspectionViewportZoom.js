/**
 * MPR zoom, viewport reset, and projection mirror toggles. Uses no React hooks.
 * Multi-image tiles intentionally have no zoom or pan: the mouse wheel scrolls
 * the page, and zoom lives in the single-image fullscreen view.
 */
export function useInspectionViewportZoom({
  applyMprNavigationSession,
  setMprProjectionMirror,
}) {
  const adjustZoom = (delta) => {
    applyMprNavigationSession((previous) => ({
      viewportTransform: {
        ...previous.viewportTransform,
        zoom: Math.min(
          4,
          Math.max(0.5, Number((previous.viewportTransform.zoom + delta).toFixed(2))),
        ),
      },
    }));
  };

  const resetViewport = () => {
    applyMprNavigationSession({
      viewportTransform: { zoom: 1, panX: 0, panY: 0 },
      rotation: { x: -22, y: 32 },
    });
  };

  const toggleMprProjectionMirror = (axis) => {
    setMprProjectionMirror((prev) => ({
      ...prev,
      [axis]: !prev[axis],
    }));
  };

  return {
    adjustZoom,
    resetViewport,
    toggleMprProjectionMirror,
  };
}
