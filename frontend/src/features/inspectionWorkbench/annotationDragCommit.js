import { hasDraggedGeometryChanged } from './annotationPointerGeometry';

// Saves the geometry a move/resize drag was dropped at. The drag preview stays
// on screen at the drop position until the save settles: clearing it on
// pointer-up made the shape render from the not-yet-updated annotation state
// (its original position) for the length of the PATCH round trip. Once the save
// resolves, the updated annotation and the cleared preview land in the same
// render, so the shape never jumps. A failed save clears the preview and the
// shape returns to its last saved position. The preview is only cleared if no
// newer drag has replaced it in the meantime.
export async function commitDraggedGeometry({
  preview,
  source,
  cancel = false,
  previewRef,
  setPreview,
  updateMeasurementAnnotationLine,
  updateBoxAnnotationGeometry,
}) {
  const changed = !cancel
    && Boolean(preview?.geometry)
    && ['line', 'box'].includes(preview.kind)
    && (!source || hasDraggedGeometryChanged(preview, source));
  if (!changed) {
    setPreview(null);
    return;
  }
  try {
    if (preview.kind === 'line') {
      await updateMeasurementAnnotationLine(preview.geometry.id, preview.geometry);
    } else {
      await updateBoxAnnotationGeometry(preview.geometry.id, preview.geometry);
    }
  } finally {
    if (previewRef.current === preview) setPreview(null);
  }
}
