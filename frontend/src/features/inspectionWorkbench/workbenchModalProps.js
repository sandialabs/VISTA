// Pure builders for the annotations pane, annotation edit modal, and the
// workbench utility modal (parts, metadata, annotations) props.

export const buildAnnotationsPaneProps = (input) => ({
  inspectionHierarchy: input.inspectionHierarchy,
  annotationsVisible: input.annotationsVisible,
  setAnnotationsVisible: input.setAnnotationsVisible,
  selectedPart: input.selectedPart,
  readOnly: input.readOnly,
  annotationToolMode: input.annotationToolMode,
  setTileAnnotationMode: input.setTileAnnotationMode,
  projectType: input.projectType,
  openOtherAnnotationModal: input.openOtherAnnotationModal,
  tileCalibrationPromptImageId: input.tileCalibrationPromptImageId,
  projectId: input.projectId,
  projectImageLookup: input.projectImageLookup,
  handleTileCalibrationChange: input.handleTileCalibrationChange,
  annotationsLoading: input.annotationsLoading,
  inspectionAnnotationItems: input.inspectionAnnotationItems,
  selectedInspectionItem: input.selectedInspectionItem,
  selectInspectionAnnotationItem: input.selectInspectionAnnotationItem,
  setInspectionItemVisibility: input.setInspectionItemVisibility,
  croppingAnnotationId: input.croppingAnnotationId,
  cropBoxAnnotation: input.cropBoxAnnotation,
  openInspectionItemConfigModal: input.openInspectionItemConfigModal,
  deleteMeasurementAnnotation: input.deleteMeasurementAnnotation,
});

export const buildAnnotationEditModalProps = (input) => ({
  annotationEditModalVisible: input.annotationEditModalVisible,
  annotationEditDraft: input.annotationEditDraft,
  selectedInspectionOverlayStyleTarget: input.selectedInspectionOverlayStyleTarget,
  inspectionAnnotationItems: input.inspectionAnnotationItems,
  annotations: input.annotations,
  selectedAnnotationId: input.selectedAnnotationId,
  configuredDefectTypes: input.configuredDefectTypes,
  closeAnnotationEditModal: input.closeAnnotationEditModal,
  readOnly: input.readOnly,
  setAnnotationEditDraft: input.setAnnotationEditDraft,
  updateAnnotationFromModal: input.updateAnnotationFromModal,
});

export const buildWorkbenchUtilityModalProps = (input) => ({
  activeWorkbenchModal: input.activeWorkbenchModal,
  setActiveWorkbenchModal: input.setActiveWorkbenchModal,
  partPaneProps: input.partPaneProps,
  metadataModalBodyProps: {
    selectedPart: input.selectedPart,
    activeMetadataTab: input.activeMetadataTab,
    setActiveMetadataTab: input.setActiveMetadataTab,
  },
  annotationsPaneProps: input.annotationsPaneProps,
});
