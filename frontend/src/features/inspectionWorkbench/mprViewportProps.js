import { SplatConfigurationModal } from './SplatConfigurationModal';

// Pure builders for the MprViewport props. The navigation, volume, display,
// annotations, and handlers groups are shared with the fullscreen image modal.

const buildMprNavigation = ({ mprDerived, mprNavigationSession, mprProjectionMirror }) => ({
  activeMprPane: mprNavigationSession.activePane,
  lastActiveMprAxis: mprNavigationSession.lastActiveAxis,
  viewportTransform: mprNavigationSession.viewportTransform,
  mprRotation: mprNavigationSession.rotation,
  slicePosition: mprNavigationSession.slicePosition,
  mprProjectionMirror,
  mprAxisMirrorScale: mprDerived.mprAxisMirrorScale,
  fallbackMprModelZoom: mprDerived.fallbackMprModelZoom,
  mprDimensions: mprDerived.mprDimensions,
});

const buildMprVolume = ({ mprReconstructionView, ...input }) => ({
  volumeCacheState: input.volumeCacheState,
  hasVolumeImageSource: input.hasVolumeImageSource,
  activeVolumeOverlayCaches: input.activeVolumeOverlayCaches,
  selectedExternalOverlayResourceId: input.selectedExternalOverlayResourceId,
  shellImageLayers: input.shellImageLayers,
  volumePreviewLayers: input.volumePreviewLayers,
  displayVolumeRendererOverlayImageStacks: input.displayVolumeRendererOverlayImageStacks,
  volumeMetadataProbeState: input.volumeMetadataProbeState,
  canShowStackReconstruction: mprReconstructionView.canShowStackReconstruction,
  canShowShellReconstruction: mprReconstructionView.canShowShellReconstruction,
  canShowGaussianSplatPreview: mprReconstructionView.canShowGaussianSplatPreview,
  effectiveMprReconstructionMode: mprReconstructionView.effectiveMprReconstructionMode,
  effectiveMprReconstructionLabel: mprReconstructionView.effectiveMprReconstructionLabel,
  mprReconstructionSelectorValue: mprReconstructionView.mprReconstructionSelectorValue,
});

const buildMprDisplay = (input) => ({
  displayWindow: input.displayWindow,
  displayValueDomain: input.mprDerived.displayValueDomain,
  tooltipValues: input.tooltipValues,
  pt3GuideAppearance: input.pt3GuideAppearance,
  annotationLayerVisible: input.annotationLayerVisible,
  annotationOpacityMultiplier: input.annotationOpacityMultiplier,
  annotationsVisible: input.annotationsVisible,
});

const buildMprAnnotations = ({ annotationLayers, inspectionAnnotationItems, selectedAnnotationId }) => ({
  mprMeasurementLinesBySlice: annotationLayers.mprMeasurementLinesBySlice,
  mprBoxAnnotationsBySlice: annotationLayers.mprBoxAnnotationsBySlice,
  mprCubeAnnotations: annotationLayers.mprCubeAnnotations,
  vectorSegmentAnnotations: annotationLayers.vectorSegmentAnnotations,
  pt3RenderableAnnotations: annotationLayers.pt3RenderableAnnotations,
  inspectionAnnotationItems,
  selectedAnnotationId,
});

const buildMprFullscreen = (input) => ({
  mprFullscreenOpen: input.mprFullscreenOpen,
  mprFullscreenAnnotationListVisible: input.mprFullscreenAnnotationListVisible,
  mprFullscreenReconstructionSettingsVisible: input.mprFullscreenReconstructionSettingsVisible,
  mprFullscreenCloseRef: input.mprFullscreenCloseRef,
  mprFullscreenSceneRef: input.mprFullscreenSceneRef,
  mprOverlayCanvasRef: input.mprOverlayCanvasRef,
  segmentationHelperOpen: input.segmentationHelperOpen,
  segmentationHelperView: input.segmentationHelperView,
});

const buildMprHandlers = ({ fullscreenPointer, mprPointer, sliceNavigation, viewportZoom, ...input }) => ({
  setSelectedPartId: input.setSelectedPartId,
  setDisplayWindow: input.setDisplayWindow,
  setMprReconstructionMode: input.setMprReconstructionMode,
  setRayMarchSettings: input.setRayMarchSettings,
  openSegmentationHelper: input.openSegmentationHelper,
  setSplatConfigModalOpen: input.setSplatConfigModalOpen,
  applyMprNavigationSession: input.applyMprNavigationSession,
  openMprAnnotationTool: input.openMprAnnotationTool,
  setFullscreenMeasureActive: input.setFullscreenMeasureActive,
  resetFullscreenImageZoom: fullscreenPointer.resetFullscreenImageZoom,
  handleMprPaneWheel: sliceNavigation.handleMprPaneWheel,
  toggleMprProjectionMirror: viewportZoom.toggleMprProjectionMirror,
  ...mprPointer,
  updateSlicePosition: sliceNavigation.updateSlicePosition,
  closeMprFullscreen: sliceNavigation.closeMprFullscreen,
  openMprFullscreen: sliceNavigation.openMprFullscreen,
  handleMprVolumeWheel: sliceNavigation.handleMprVolumeWheel,
  setAnnotationsVisible: input.setAnnotationsVisible,
  setMprFullscreenAnnotationListVisible: input.setMprFullscreenAnnotationListVisible,
  setMprFullscreenReconstructionSettingsVisible: input.setMprFullscreenReconstructionSettingsVisible,
  handleMprVolumePointerDown: sliceNavigation.handleMprVolumePointerDown,
  handleMprVolumePointerMove: sliceNavigation.handleMprVolumePointerMove,
  handleMprVolumePointerUp: sliceNavigation.handleMprVolumePointerUp,
  handleMprVolumePointerCancel: sliceNavigation.handleMprVolumePointerCancel,
  preventMprNativeDrag: sliceNavigation.preventMprNativeDrag,
  adjustZoom: viewportZoom.adjustZoom,
  resetViewport: viewportZoom.resetViewport,
  setInspectionItemVisibility: input.setInspectionItemVisibility,
  getSegmentationCanonicalSliceIndex: input.getSegmentationCanonicalSliceIndex,
  getMprAnnotationImage: input.getMprAnnotationImage,
  getUnitForImage: input.calibratedGeometry.getUnitForImage,
});

export const buildSplatConfigurationModalProps = ({ mprDerived, ...input }) => ({
  splatConfigModalOpen: input.splatConfigModalOpen,
  selectedPart: input.selectedPart,
  displayValueDomain: mprDerived.displayValueDomain,
  splatParameters: mprDerived.splatParameters,
  setSplatParameterOverridesByPart: input.setSplatParameterOverridesByPart,
  setSplatConfigModalOpen: input.setSplatConfigModalOpen,
});

// Slice image inputs for the segmentation helper modal stage.
export const buildSegmentationHelperSliceImage = ({ mprDerived, ...input }) => ({
  hasVolumeImageSource: input.hasVolumeImageSource,
  volumeCacheState: input.volumeCacheState,
  overlayCaches: input.activeVolumeOverlayCaches,
  slicePosition: input.slicePosition,
  mprDimensions: mprDerived.mprDimensions,
  displayWindow: input.displayWindow,
  displayDomain: mprDerived.displayValueDomain,
  shellImageLayers: input.shellImageLayers,
  mprProjectionMirror: input.mprProjectionMirror,
});

export const buildMprViewportProps = (input) => ({
  selectedPart: input.selectedPart,
  projectType: input.projectType,
  filteredParts: input.filteredParts,
  readOnly: input.readOnly,
  segmentationRun: input.segmentationRun,
  measurementRun: input.measurementRun,
  pt3SplatViewerBaseProps: input.pt3SplatViewerBaseProps,
  splatConfigurationModal: <SplatConfigurationModal {...buildSplatConfigurationModalProps(input)} />,
  navigation: buildMprNavigation(input),
  volume: buildMprVolume(input),
  display: buildMprDisplay(input),
  annotations: buildMprAnnotations(input),
  drafts: {
    mprAnnotationPreview: input.annotationDrafts.mpr.preview,
    mprPendingCubeDraft: input.annotationDrafts.mpr.pending,
    mprGeometryDragPreview: input.mprGeometryDragPreview,
    annotationToolMode: input.annotationToolMode,
  },
  fullscreen: buildMprFullscreen(input),
  handlers: buildMprHandlers(input),
});
