import { normalizeTileViewportTransform } from './inspectionUtils';

/**
 * MPR zoom, viewport reset, projection mirror toggles, and selected tile
 * wheel zoom. Uses no React hooks.
 */
export function useInspectionViewportZoom({
  applyMprNavigationSession,
  setMprProjectionMirror,
  setInspectorViewport,
  selectedImageRef,
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

  const handleTileImageWheel = (event, imageRef) => {
    if (event.target?.closest?.('.inspection-tile-metadata-overlay')) return;
    if (String(selectedImageRef || '') !== String(imageRef || '')) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setInspectorViewport((previous) => normalizeTileViewportTransform({
      ...previous,
      zoom: Number(((Number(previous.zoom) || 1) * (direction > 0 ? 1.15 : 1 / 1.15)).toFixed(2)),
    }));
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
    handleTileImageWheel,
    toggleMprProjectionMirror,
  };
}
