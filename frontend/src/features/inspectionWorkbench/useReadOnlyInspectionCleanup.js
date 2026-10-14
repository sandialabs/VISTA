import { useEffect } from 'react';

export default function useReadOnlyInspectionCleanup({
  readOnly,
  resetAnnotationDrafts,
  setAnnotationEditModalVisible,
  setAnnotationToolMode,
  setMprGeometryDragPreview,
  setOtherAnnotationModalVisible,
  setTileCalibrationPromptImageId,
  setTileGeometryDragPreview,
}) {
  useEffect(() => {
    if (!readOnly) return;
    setAnnotationToolMode('');
    setOtherAnnotationModalVisible(false);
    setAnnotationEditModalVisible(false);
    resetAnnotationDrafts();
    setTileGeometryDragPreview(null);
    setMprGeometryDragPreview(null);
    setTileCalibrationPromptImageId(null);
  }, [
    readOnly,
    resetAnnotationDrafts,
    setAnnotationEditModalVisible,
    setAnnotationToolMode,
    setMprGeometryDragPreview,
    setOtherAnnotationModalVisible,
    setTileCalibrationPromptImageId,
    setTileGeometryDragPreview,
  ]);
}
