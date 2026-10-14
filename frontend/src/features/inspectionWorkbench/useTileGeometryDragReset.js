import { useEffect } from 'react';
import { safeReleasePointerCapture } from '../../utils/annotationGeometry';

// Cancels any in-flight tile annotation geometry drag when the project or the
// selected part changes.
export default function useTileGeometryDragReset({
  partId,
  projectId,
  setTileGeometryDragPreview,
  tileAnnotationGeometryDragRef,
  tileGeometryDragPreviewRef,
}) {
  useEffect(() => {
    const drag = tileAnnotationGeometryDragRef.current;
    if (drag) safeReleasePointerCapture(drag.captureTarget, drag.pointerId);
    tileAnnotationGeometryDragRef.current = null;
    tileGeometryDragPreviewRef.current = null;
    setTileGeometryDragPreview(null);
  }, [partId, projectId, setTileGeometryDragPreview, tileAnnotationGeometryDragRef, tileGeometryDragPreviewRef]);
}
