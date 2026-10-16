// Pure builder for the FullscreenImageModal props. It reuses the selection and
// tile view groups of the center pane and the MPR viewport groups, and adds the
// fullscreen modal, tool, and handler groups.

const buildFullscreenModal = ({ fullscreenPointer, fullscreenSession }) => ({
  fullscreenImageModal: fullscreenSession.fullscreenImageModal,
  fullscreenBackingImageId: fullscreenSession.fullscreenBackingImageId,
  fullscreenMprSliceKey: fullscreenSession.fullscreenMprSliceKey,
  fullscreenImageRef: fullscreenSession.fullscreenImageRef,
  fullscreenImageZoom: fullscreenPointer.fullscreenImageZoom,
  fullscreenImagePanning: fullscreenPointer.fullscreenImagePanning,
  fullscreenPanDragRef: fullscreenPointer.fullscreenPanDragRef,
  fullscreenCalibrationPromptVisible: fullscreenSession.fullscreenCalibrationPromptVisible,
});

const buildFullscreenTools = ({ fullscreenSession, ...input }) => ({
  fullscreenMeasureActive: fullscreenSession.fullscreenMeasureActive,
  fullscreenBoxActive: fullscreenSession.fullscreenBoxActive,
  fullscreenCropActive: fullscreenSession.fullscreenCropActive,
  fullscreenEditingEndpoint: fullscreenSession.fullscreenEditingEndpoint,
  fullscreenEditingBoxCorner: fullscreenSession.fullscreenEditingBoxCorner,
  fullscreenBoundsEditAnnotationId: fullscreenSession.fullscreenBoundsEditAnnotationId,
  fullscreenMeasurements: fullscreenSession.fullscreenMeasurements,
  fullscreenGeometryDragPreview: fullscreenSession.fullscreenGeometryDragPreview,
  fullscreenAnnotationPreview: input.annotationDrafts.fullscreen.preview,
  annotationDraftsRef: input.annotationDraftsRef,
  croppingAnnotationId: input.croppingAnnotationId,
});

const buildFullscreenHandlers = ({
  fullscreenPointer, fullscreenSession, fullscreenTools, ...input
}) => ({
  ...fullscreenTools,
  closeFullscreenImageModal: fullscreenPointer.closeFullscreenImageModal,
  handleFullscreenCalibrationChange: input.handleFullscreenCalibrationChange,
  handleFullscreenImageWheel: fullscreenPointer.handleFullscreenImageWheel,
  handleFullscreenPanMouseDown: fullscreenPointer.handleFullscreenPanMouseDown,
  handleFullscreenImagePointerMove: fullscreenPointer.handleFullscreenImagePointerMove,
  handleFullscreenPanMouseUp: fullscreenPointer.handleFullscreenPanMouseUp,
  cancelAnnotationDraft: input.cancelAnnotationDraft,
  startFullscreenAnnotationDrag: fullscreenPointer.startFullscreenAnnotationDrag,
  handleFullscreenAnnotationDragMove: fullscreenPointer.handleFullscreenAnnotationDragMove,
  finishFullscreenAnnotationDrag: fullscreenPointer.finishFullscreenAnnotationDrag,
  setSelectedAnnotationId: input.setSelectedAnnotationId,
  setFullscreenBoundsEditAnnotationId: fullscreenSession.setFullscreenBoundsEditAnnotationId,
  cropBoxAnnotation: input.cropBoxAnnotation,
  deleteMeasurementAnnotation: input.deleteMeasurementAnnotation,
  getAnnotationSourceImageIdForImage: input.getAnnotationSourceImageIdForImage,
  getUnitForImage: input.calibratedGeometry.getUnitForImage,
});

export const buildFullscreenModalProps = (input) => ({
  readOnly: input.readOnly,
  projectId: input.projectId,
  projectType: input.projectType,
  selection: input.centerPaneProps.selection,
  tileView: input.centerPaneProps.tileView,
  navigation: input.mprViewportProps.navigation,
  volume: input.mprViewportProps.volume,
  display: input.mprViewportProps.display,
  annotations: input.mprViewportProps.annotations,
  handlers: input.mprViewportProps.handlers,
  modal: buildFullscreenModal(input),
  tools: buildFullscreenTools(input),
  fullscreenHandlers: buildFullscreenHandlers(input),
});
