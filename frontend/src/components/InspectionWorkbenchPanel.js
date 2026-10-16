import {
  useCallback,
  useRef,
  useState,
} from 'react';
import { Layout } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import {
  DEFAULT_RAY_MARCH_SETTINGS,
  DEFAULT_SPLAT_VIEW_SETTINGS,
} from './Pt3GaussianSplatViewer';
import useInspectionSessionState from '../features/inspectionWorkbench/useInspectionSessionState';
import useInspectionWorkbenchLayoutMetrics from '../features/inspectionWorkbench/useInspectionWorkbenchLayoutMetrics';
import useAnnotationMutation from '../features/inspectionWorkbench/useAnnotationMutation';
import useAnnotationDrafts from '../features/inspectionWorkbench/useAnnotationDrafts';
import useInspectionPartSelection from '../features/inspectionWorkbench/useInspectionPartSelection';
import useReadOnlyInspectionCleanup from '../features/inspectionWorkbench/useReadOnlyInspectionCleanup';
import useCollapsedPartRows from '../features/inspectionWorkbench/useCollapsedPartRows';
import useInspectionViewTab from '../features/inspectionWorkbench/useInspectionViewTab';
import useInspectionEnabledModalities from '../features/inspectionWorkbench/useInspectionEnabledModalities';
import useInspectionTileColumns from '../features/inspectionWorkbench/useInspectionTileColumns';
import useInspectionDisplayLayers from '../features/inspectionWorkbench/useInspectionDisplayLayers';
import useInspectionImageSelection from '../features/inspectionWorkbench/useInspectionImageSelection';
import useInspectionAnnotationModals from '../features/inspectionWorkbench/useInspectionAnnotationModals';
import useFullscreenSession from '../features/inspectionWorkbench/useFullscreenSession';
import {
  getAnnotationOpacityMultiplier,
  normalizeAnnotationTransparencyPercent,
} from '../features/inspectionWorkbench/inspectionAnnotationDisplay';
import {
  DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
  DEFAULT_MODALITY_IMAGE_FILTER_KEY,
  DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
  INSPECTION_VIEW_ALL_IMAGES_TAB,
  INSPECTION_VIEW_PARTS_TAB,
} from '../features/inspectionWorkbench/inspectionConstants';
import { MPR_RECONSTRUCTION_MODES, DEFAULT_MPR_PROJECTION_MIRROR, MPR_VOLUME_SLICE_RENDER_VERSION } from '../features/inspectionWorkbench/mprConstants';
import { getInspectionTileMaxColumns, normalizeTileViewportTransform } from '../features/inspectionWorkbench/inspectionUtils';
import { getCanonicalSegmentationSliceIndex, getMprFallbackModelZoom, projectMprPointToOverlay } from '../features/inspectionWorkbench/mprGeometry';
import {
  createServerVolumeDescriptor,
  getVolumeSourceImages,
  getVolumeOverlayStacks,
  getAlignedVolumeOverlayRendererStacks,
  getVolumeSummaryRepresentativeIndices,
  isRenderableVolumeOverlay,
  getSemantic3dVolumeOverlayStacks,
  mapWithConcurrency,
  getVolumeRendererSliceIndices,
} from '../features/inspectionWorkbench/volumeDescriptors';
import {
  shouldApplyDisplayWindowToVolumeCache,
  getMprOverlayCompositeAlpha,
  drawMprOverlaySlice,
  getMprVolumeCacheKey,
  rememberSliceCanvas,
  getMprSliceCanvasCacheStats,
  resetMprSliceCanvasCacheForTests,
  getServerVolumePrefetchSources,
  drawServerMprSliceImage,
  getMprSliceCachingMessage,
} from '../features/inspectionWorkbench/mprSliceCache';
import { getInspectionImageOrderKey, applyInspectionImageDisplayOrder, sortInspectionImageDisplayEntries } from '../features/inspectionWorkbench/imageSorting';
import { buildInspectionShareParams } from '../features/inspectionWorkbench/inspectionShareParams';
import { buildPt3SplatViewerProps } from '../features/inspectionWorkbench/pt3SplatViewerProps';
import { Pt3FocusedWorkbench } from '../features/inspectionWorkbench/Pt3FocusedWorkbench';
import { MprViewport } from '../features/inspectionWorkbench/MprViewport';
import { FullscreenImageModal } from '../features/inspectionWorkbench/FullscreenImageModal';
import { AnnotationsPane } from '../features/inspectionWorkbench/AnnotationsPane';
import { AnnotationEditModal } from '../features/inspectionWorkbench/AnnotationEditModal';
import { WorkbenchUtilityModal } from '../features/inspectionWorkbench/WorkbenchUtilityModal';
import { OtherAnnotationModal } from '../features/inspectionWorkbench/OtherAnnotationModal';
import { useFullscreenAnnotationPointer } from '../features/inspectionWorkbench/useFullscreenAnnotationPointer';
import { useFullscreenAnnotationTools } from '../features/inspectionWorkbench/useFullscreenAnnotationTools';
import { useMprAnnotationPointer } from '../features/inspectionWorkbench/useMprAnnotationPointer';
import { useTileAnnotationPointer } from '../features/inspectionWorkbench/useTileAnnotationPointer';
import { useInspectionViewportZoom } from '../features/inspectionWorkbench/useInspectionViewportZoom';
import { useInspectionAnnotationActions } from '../features/inspectionWorkbench/useInspectionAnnotationActions';
import { useInspectionCropActions } from '../features/inspectionWorkbench/useInspectionCropActions';
import { useInspectionItemVisibility } from '../features/inspectionWorkbench/useInspectionItemVisibility';
import { useInspectionFlexLayoutActions } from '../features/inspectionWorkbench/useInspectionFlexLayoutActions';
import useInspectionVolumeSources from '../features/inspectionWorkbench/useInspectionVolumeSources';
import useInspectionVolumeRendererLayers from '../features/inspectionWorkbench/useInspectionVolumeRendererLayers';
import useMprAnnotationContext from '../features/inspectionWorkbench/useMprAnnotationContext';
import useMprSliceNavigation from '../features/inspectionWorkbench/useMprSliceNavigation';
import useInspectionMprWorkspaceHydration from '../features/inspectionWorkbench/useInspectionMprWorkspaceHydration';
import useInspectorWorkspaceHydration from '../features/inspectionWorkbench/useInspectorWorkspaceHydration';
import useInspectionAnnotationSync from '../features/inspectionWorkbench/useInspectionAnnotationSync';
import useInspectionWorkspacePersistence from '../features/inspectionWorkbench/useInspectionWorkspacePersistence';
import useInspectionSegmentationWorkbench from '../features/inspectionWorkbench/useInspectionSegmentationWorkbench';
import { InspectionSegmentationHelperDialog } from '../features/inspectionWorkbench/InspectionSegmentationHelperDialog';
import { getMprReconstructionView } from '../features/inspectionWorkbench/mprReconstructionView';
import useInspectionPartReview from '../features/inspectionWorkbench/useInspectionPartReview';
import useInspectionLayoutModel from '../features/inspectionWorkbench/useInspectionLayoutModel';
import useInspectionPartLoading from '../features/inspectionWorkbench/useInspectionPartLoading';
import { useInspectionCalibrationLookup, useInspectionCalibrationActions } from '../features/inspectionWorkbench/useInspectionCalibration';
import useInspectionVolumeMetadataProbe from '../features/inspectionWorkbench/useInspectionVolumeMetadataProbe';
import useMprFallbackOverlayCanvas from '../features/inspectionWorkbench/useMprFallbackOverlayCanvas';
import useInspectionImageCollection from '../features/inspectionWorkbench/useInspectionImageCollection';
import useInspectionLaunchFilters from '../features/inspectionWorkbench/useInspectionLaunchFilters';
import useInspectionImageSortFilter from '../features/inspectionWorkbench/useInspectionImageSortFilter';
import usePt3GuideSettings from '../features/inspectionWorkbench/usePt3GuideSettings';
import useInspectionAnnotationLayers, { useConfiguredDefectTypes } from '../features/inspectionWorkbench/useInspectionAnnotationLayers';
import useInspectionHierarchy from '../features/inspectionWorkbench/useInspectionHierarchy';
import useTileGeometryDragReset from '../features/inspectionWorkbench/useTileGeometryDragReset';
import useInspectionMprDerived from '../features/inspectionWorkbench/useInspectionMprDerived';
import useInspectionAnnotationItems, { useSelectedInspectionItem } from '../features/inspectionWorkbench/useInspectionAnnotationItems';
import useInspectionFocusRequest from '../features/inspectionWorkbench/useInspectionFocusRequest';
import useMprTooltipValues from '../features/inspectionWorkbench/useMprTooltipValues';
import { createCalibratedAnnotationGeometry } from '../features/inspectionWorkbench/calibratedAnnotationGeometry';
import { createInspectionFlexLayoutFactory } from '../features/inspectionWorkbench/inspectionFlexLayoutFactory';
import { buildPartPaneProps } from '../features/inspectionWorkbench/partPaneProps';
import { buildAnnotationEditModalProps, buildAnnotationsPaneProps, buildWorkbenchUtilityModalProps } from '../features/inspectionWorkbench/workbenchModalProps';
import { buildMprViewportProps, buildSegmentationHelperSliceImage } from '../features/inspectionWorkbench/mprViewportProps';
import { buildCenterPaneProps } from '../features/inspectionWorkbench/centerPaneProps';
import { buildFullscreenModalProps } from '../features/inspectionWorkbench/fullscreenModalProps';

function InspectionWorkbenchPanel({
  projectId,
  projectType,
  readOnly = false,
  hierarchy,
  launchFilters,
  mprSession,
  onMprSessionChange,
  onInspectionShareStateChange,
}) {
  const collapsedPartRows = useCollapsedPartRows();
  const [savingPartId, setSavingPartId] = useState(null);
  const {
    applyMprNavigationSession,
    lastControlledMprSessionRef,
    mprDimensionsRef,
    mprNavigationHydratedProjectRef,
    mprNavigationSession,
    mprNavigationSessionRef,
    mprSessionProjectKey,
    pendingPublishedMprSessionRef,
  } = useInspectionSessionState({
    onMprSessionChange,
    projectId,
  });
  const {
    slicePosition,
    viewportTransform,
    activePane: activeMprPane,
    lastActiveAxis: lastActiveMprAxis,
    rotation: mprRotation,
  } = mprNavigationSession;
  const [mprReconstructionMode, setMprReconstructionMode] = useState(MPR_RECONSTRUCTION_MODES.orientation);
  const [mprFullscreenOpen, setMprFullscreenOpen] = useState(false);
  const [mprFullscreenAnnotationListVisible, setMprFullscreenAnnotationListVisible] = useState(true);
  const [mprFullscreenReconstructionSettingsVisible, setMprFullscreenReconstructionSettingsVisible] = useState(true);
  const [rayMarchSettings, setRayMarchSettings] = useState(() => ({ ...DEFAULT_RAY_MARCH_SETTINGS }));
  const [splatViewSettings, setSplatViewSettings] = useState(() => ({ ...DEFAULT_SPLAT_VIEW_SETTINGS }));
  const [splatConfigModalOpen, setSplatConfigModalOpen] = useState(false);
  const [splatParameterOverridesByPart, setSplatParameterOverridesByPart] = useState({});
  const [mprProjectionMirror, setMprProjectionMirror] = useState(DEFAULT_MPR_PROJECTION_MIRROR);
  const [activeWorkbenchModal, setActiveWorkbenchModal] = useState(null);
  const [activeMetadataTab, setActiveMetadataTab] = useState('nsipro');
  const [displayWindow, setDisplayWindow] = useState({ min: 0, max: 255 });
  const displayWindowContextRef = useRef(null);
  const [activeOverlayIds, setActiveOverlayIds] = useState([]);
  const [cursorProbe, setCursorProbe] = useState({ x: 50, y: 50 });
  const [segmentationRun, setSegmentationRun] = useState(null);
  const [measurementRun, setMeasurementRun] = useState(null);
  const {
    enabledModalities,
    ensureEnabledModality,
    selectOnlyModalityVisibility,
    setAllModalityVisibility,
    setEnabledModalities,
  } = useInspectionEnabledModalities();
  const [primaryImageFilterKey, setPrimaryImageFilterKey] = useState(DEFAULT_PRIMARY_IMAGE_FILTER_KEY);
  const [modalityImageFilterKey, setModalityImageFilterKey] = useState(DEFAULT_MODALITY_IMAGE_FILTER_KEY);
  const [secondaryImageFilterKey, setSecondaryImageFilterKey] = useState(DEFAULT_SECONDARY_IMAGE_FILTER_KEY);
  const [measurementEntries, setMeasurementEntries] = useState([]);
  const [inspectorViewport, setInspectorViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [annotations, setAnnotationsState] = useState([]);
  const annotationsMutationRevisionRef = useRef(0);
  const setAnnotations = useCallback((updater) => {
    annotationsMutationRevisionRef.current += 1;
    setAnnotationsState(updater);
  }, []);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationToolMode, setAnnotationToolMode] = useState('');
  const customDefectTypeDraft = '';
  const {
    annotationDrafts,
    annotationDraftsRef,
    cancelAnnotationDraft,
    finishAnnotationDraft,
    moveAnnotationDraft,
    resetAnnotationDrafts,
    startAnnotationDraft,
  } = useAnnotationDrafts();
  const [tileGeometryDragPreview, setTileGeometryDragPreview] = useState(null);
  const [shortcutHelpVisible, setShortcutHelpVisible] = useState(false);
  const [normalizationTriageField, setNormalizationTriageField] = useState('');
  const [allPartsImageSortLayers, setAllPartsImageSortLayers] = useState([]);
  const tileSizeRangeInputRef = useRef(null);
  const volumeMetadataProbeCacheRef = useRef(new Map());
  const volumeRenderSummaryCacheRef = useRef(new Map());
  const [volumeRenderSummariesByImageId, setVolumeRenderSummariesByImageId] = useState({});
  const [volumeMetadataProbeState, setVolumeMetadataProbeState] = useState({ pending: false, warning: '' });
  const [deletingOverlayId, setDeletingOverlayId] = useState('');
  const fullscreenSession = useFullscreenSession({ readOnly });
  const [tileCalibrationPromptImageId, setTileCalibrationPromptImageId] = useState(null);
  const {
    annotationLayerVisible,
    annotationsVisible,
    ensureRenderCategoryVisible,
    imageEnabled,
    renderCategories,
    setAnnotationsVisible,
    setImageEnabled,
    volumeOverlayLayersVisible,
  } = useInspectionDisplayLayers({ projectType });
  const annotationOpacityMultiplier = 1;
  const [sessionCalibrationByImageId, setSessionCalibrationByImageId] = useState({});
  const annotationLayers = useInspectionAnnotationLayers({ annotationLayerVisible, annotations });
  const {
    pt3RenderableAnnotations, storedBoxAnnotationsByImageId, storedMeasurementLinesByImageId,
    storedMprBoxAnnotationsBySlice, storedMprMeasurementLinesBySlice,
  } = annotationLayers;
  const [mprGeometryDragPreview, setMprGeometryDragPreview] = useState(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [selectedInspectionItemKey, setSelectedInspectionItemKey] = useState('');
  const [inspectionFocusRequest, setInspectionFocusRequest] = useState(null);
  const [croppingAnnotationId, setCroppingAnnotationId] = useState(null);
  const {
    inspectionResizeSaveTimerRef,
    viewportWidth,
    workbenchDetailsRef,
    workbenchWidth,
  } = useInspectionWorkbenchLayoutMetrics();
  const [manualFilterNotice, setManualFilterNotice] = useState('');
  const mprDragRef = useRef(null);
  const suppressNextMprSceneClickRef = useRef(false);
  const mprFullscreenCloseRef = useRef(null);
  const mprFullscreenSceneRef = useRef(null);
  const mprFullscreenOpenerRef = useRef(null);
  const tileAnnotationGeometryDragRef = useRef(null);
  const tileGeometryDragPreviewRef = useRef(null);
  const mprAnnotationGeometryDragRef = useRef(null);
  const mprGeometryDragPreviewRef = useRef(null);
  const activeSegmentationPersistenceScopeRef = useRef('');
  const tilePanDragRef = useRef(null);
  const suppressNextTileClickRef = useRef(false);
  const mprOverlayCanvasRef = useRef(null);

  const [mprFallbackOverlaySize, setMprFallbackOverlaySize] = useState({ width: 0, height: 0 });
  const appliedLaunchFiltersSignatureRef = useRef('');

  const inspectionHierarchy = useInspectionHierarchy({ hierarchy, projectType });

  const {
    activeInspectionViewTab,
    setActiveInspectionViewTab,
  } = useInspectionViewTab({
    allImagesTab: INSPECTION_VIEW_ALL_IMAGES_TAB,
    centerTabs: inspectionHierarchy.centerTabs,
    defaultTab: INSPECTION_VIEW_PARTS_TAB,
  });
  const {
    batches, error, inspectionColumnWidths, inspectorHotkeys, loading, panelLayout, partFilter,
    parts, projectConfiguration, projectImageLookup, projectMetadata, reviewFilter, selectedBatchId,
    selectedPartId, setError, setPartFilter, setParts, setProjectConfiguration, setProjectImageLookup,
    setProjectMetadata, setReviewFilter, setSelectedBatchId, setSelectedPartId, setSortMode, sortMode,
    workspaceHydration, workspaceStateLoaded,
  } = useInspectionPartLoading({ projectId, setActiveInspectionViewTab });
  const { pt3GuideAppearance, pt3GuideSettings } = usePt3GuideSettings(projectConfiguration);
  const configuredDefectTypes = useConfiguredDefectTypes(projectConfiguration);

  const {
    activeSelectionId,
    filteredParts,
    isAllImagesSelection,
    normalizationTriageMatchCount,
    selectedPart,
  } = useInspectionPartSelection({
    activeInspectionViewTab,
    inspectionViewAllImagesTab: INSPECTION_VIEW_ALL_IMAGES_TAB,
    normalizationTriageField,
    partFilter,
    parts,
    reviewFilter,
    selectedBatchId,
    selectedPartId,
    sortMode,
  });
  const {
    availableLayoutWidth,
    inspectionFlexLayoutModel,
    saveInspectionColumnWidths,
    workbenchFlexLayoutStyle,
  } = useInspectionLayoutModel({
    activeInspectionViewTab,
    inspectionColumnWidths,
    inspectionHierarchy,
    isAllImagesSelection,
    projectConfiguration,
    projectId,
    projectType,
    readOnly,
    setProjectConfiguration,
    viewportWidth,
    workbenchWidth,
  });

  const {
    getCalibrationForImage,
  } = useInspectionCalibrationLookup({
    projectConfiguration,
    projectImageLookup,
    projectMetadata,
    sessionCalibrationByImageId,
  });

  useInspectionVolumeMetadataProbe({
    projectId,
    projectImageLookup,
    selectedPart,
    setProjectImageLookup,
    setVolumeMetadataProbeState,
    volumeMetadataProbeCacheRef,
  });

  const {
    activePartMutationGeneration,
    isActivePartMutation,
    mutateAnnotation,
  } = useAnnotationMutation({
    projectId,
    activeSelectionId,
    selectedPart,
    readOnly,
    setError,
    scopeRef: activeSegmentationPersistenceScopeRef,
  });

  useTileGeometryDragReset({
    partId: selectedPart?.id, projectId, setTileGeometryDragPreview,
    tileAnnotationGeometryDragRef, tileGeometryDragPreviewRef,
  });

  const mprDerived = useInspectionMprDerived({
    mprDimensionsRef, mprFullscreenOpen, mprProjectionMirror, projectImageLookup, selectedPart,
    splatParameterOverridesByPart, viewportTransformZoom: viewportTransform.zoom,
  });
  const { displayValueDomain, fallbackMprModelZoom, mprAxisMirrorScale, mprDimensions } = mprDerived;

  useMprFallbackOverlayCanvas({
    activeMprPane,
    annotationLayerVisible,
    annotationOpacityMultiplier,
    fallbackMprModelZoom,
    lastActiveMprAxis,
    mprAxisMirrorScale,
    mprDimensions,
    mprFallbackOverlaySize,
    mprFullscreenOpen,
    mprOverlayCanvasRef,
    mprReconstructionMode,
    mprRotation,
    pt3GuideAppearance,
    pt3RenderableAnnotations,
    setMprFallbackOverlaySize,
    slicePosition,
  });

  const {
    aggregateLayerAvailability,
    aggregateLoadedModalities,
    aggregateModalities,
    aggregatePartImageRefs,
    aggregateViews,
    modalityOptions,
    selectedPartImageRefs,
  } = useInspectionImageCollection({
    allPartsImageSortLayers,
    filteredParts,
    isAllImagesSelection,
    projectConfiguration,
    projectImageLookup,
    selectedPart,
  });
  const {
    selectedImageRef,
    setSelectedImageRef,
  } = useInspectionImageSelection({
    selectedPartImageRefs,
  });

  useInspectionLaunchFilters({
    appliedLaunchFiltersSignatureRef,
    applyMprNavigationSession,
    batches,
    launchFilters,
    mprNavigationHydratedProjectRef,
    mprSessionProjectKey,
    parts,
    projectImageLookup,
    projectType,
    selectedPartId,
    setActiveInspectionViewTab,
    setActiveMetadataTab,
    setActiveOverlayIds,
    setManualFilterNotice,
    setReviewFilter,
    setSelectedBatchId,
    setSelectedImageRef,
    setSelectedPartId,
  });
  const imageSortFilter = useInspectionImageSortFilter({
    activeSelectionId, aggregatePartImageRefs, annotationsVisible, enabledModalities,
    isAllImagesSelection, modalityImageFilterKey, primaryImageFilterKey, projectConfiguration,
    projectId, projectImageLookup, projectType, readOnly, renderCategories, secondaryImageFilterKey,
    selectedPart, selectedPartId, selectedPartImageRefs, setAllPartsImageSortLayers,
    setAnnotationsVisible, setParts, tileSizeRangeInputRef,
  });
  const {
    effectiveModalityImageFilterKey, effectivePrimaryImageFilterKey, effectiveSecondaryImageFilterKey,
    hiddenModalityImageFilterValues, hiddenPrimaryImageFilterValues, hiddenSecondaryImageFilterValues,
    setHiddenModalityImageFilterValues, setHiddenPrimaryImageFilterValues,
    setHiddenSecondaryImageFilterValues, visibleSelectedPartImageRefs,
  } = imageSortFilter;
  const inspectionAnnotationItems = useInspectionAnnotationItems({ annotations, selectedPartImageRefs });
  const {
    annotationDraft,
    annotationEditDraft,
    annotationEditModalVisible,
    closeAnnotationEditModal,
    closeOtherAnnotationModal,
    openInspectionItemConfigModal,
    openOtherAnnotationModal,
    otherAnnotationModalVisible,
    resetAnnotationDraft,
    selectInspectionAnnotationItem,
    setAnnotationDraft,
    setAnnotationEditDraft,
    setAnnotationEditModalVisible,
    setOtherAnnotationModalVisible,
  } = useInspectionAnnotationModals({
    enabledModalities,
    inspectionAnnotationItems,
    modalityOptions,
    setSelectedAnnotationId,
    setSelectedImageRef,
    setSelectedInspectionItemKey,
  });
  useReadOnlyInspectionCleanup({
    readOnly,
    resetAnnotationDrafts,
    setAnnotationEditModalVisible,
    setAnnotationToolMode,
    setMprGeometryDragPreview,
    setOtherAnnotationModalVisible,
    setTileCalibrationPromptImageId,
    setTileGeometryDragPreview,
  });
  const {
    selectedExternalOverlayResourceId, selectedInspectionItem, selectedInspectionOverlayStyleTarget,
  } = useSelectedInspectionItem({ inspectionAnnotationItems, selectedAnnotationId, selectedInspectionItemKey });
  const tileColumns = useInspectionTileColumns({
    configuredMaxColumns: getInspectionTileMaxColumns(projectConfiguration),
    imageCount: visibleSelectedPartImageRefs.length || selectedPartImageRefs.length,
    initialColumnCount: 3,
  });
  const normalizedInspectorViewport = normalizeTileViewportTransform(inspectorViewport);
  const {
    getAnnotationSourceImageIdForImage,
    handleFullscreenCalibrationChange,
    handleTileCalibrationChange,
    requireCalibrationForAnnotation,
  } = useInspectionCalibrationActions({
    annotationToolMode,
    fullscreenSession,
    getCalibrationForImage,
    projectImageLookup,
    readOnly,
    selectedPartImageRefs,
    setProjectMetadata,
    setSessionCalibrationByImageId,
    setTileCalibrationPromptImageId,
    tileCalibrationPromptImageId,
  });

  useInspectionFocusRequest({
    annotations, inspectionAnnotationItems, inspectionFlexLayoutModel, inspectionFocusRequest,
    projectImageLookup, selectedPart, selectedPartImageRefs, setActiveInspectionViewTab,
    setActiveWorkbenchModal, setInspectionFocusRequest, setSelectedAnnotationId, setSelectedImageRef,
    setSelectedInspectionItemKey, setTileColumnCount: tileColumns.setTileColumnCount,
  });
  const {
    loadedVolumeOverlayStacks, visibleSemantic3dVolumeOverlayStacks, volumeCacheState,
    volumeImageStack,
  } = useInspectionVolumeSources({
    mprDimensions, mprReconstructionMode, projectId, projectImageLookup, selectedPart,
    setVolumeRenderSummariesByImageId, volumeRenderSummaryCacheRef,
  });
  const {
    activeVolumeOverlayCaches, displayVolumeRendererOverlayImageStacks, hasVolumeImageSource,
    shellImageLayers, volumePreviewLayers, volumeRendererDescriptor, volumeRendererImageStack,
  } = useInspectionVolumeRendererLayers({
    loadedVolumeOverlayStacks, mprDimensions, projectImageLookup,
    selectedExternalOverlayResourceId, selectedPart, visibleSemantic3dVolumeOverlayStacks,
    volumeImageStack, volumeOverlayLayersVisible, volumeRenderSummariesByImageId,
  });
  const {
    getMprAnnotationImage, getMprAnnotationSliceContext, openMprAnnotationTool,
  } = useMprAnnotationContext({
    mprDimensions, openFullscreenTool: fullscreenSession.openFullscreenTool, readOnly,
    selectedImageRef, setAnnotationDraft, shellImageLayers, slicePosition, volumeCacheState, volumeImageStack,
  });

  const mprReconstructionView = getMprReconstructionView({
    mprReconstructionMode, rayMarchSettings, selectedPart, shellImageLayers, volumePreviewLayers,
  });

  const sliceNavigation = useMprSliceNavigation({
    applyMprNavigationSession, mprDimensions, mprDragRef, mprFullscreenCloseRef,
    mprFullscreenOpen, mprFullscreenOpenerRef, mprFullscreenSceneRef, mprRotation,
    setMprFullscreenOpen, suppressNextMprSceneClickRef,
  });
  const { stepSlicePosition, updateSlicePosition } = sliceNavigation;

  const tooltipValues = useMprTooltipValues({
    activeOverlayIds, cursorProbe, displayValueDomain, displayWindow, slicePosition,
  });

  useInspectionMprWorkspaceHydration({
    applyMprNavigationSession, displayValueDomain, displayWindowContextRef, isAllImagesSelection,
    lastControlledMprSessionRef, launchFilters, mprDimensions, mprNavigationHydratedProjectRef,
    mprNavigationSessionRef, mprSession, mprSessionProjectKey, onMprSessionChange,
    pendingPublishedMprSessionRef, projectId, projectType, selectedPart, selectedPartId,
    setActiveOverlayIds, setCursorProbe, setDisplayWindow, setMeasurementRun,
    setMprProjectionMirror, setMprReconstructionMode, setRayMarchSettings, setSegmentationRun,
    setSelectedPartId, workspaceHydration, workspaceStateLoaded,
  });

  useInspectorWorkspaceHydration({
    aggregateLoadedModalities, isAllImagesSelection, selectedPart, setAnnotationDraft,
    setEnabledModalities, setHiddenModalityImageFilterValues, setHiddenPrimaryImageFilterValues,
    setHiddenSecondaryImageFilterValues, setImageEnabled, setInspectorViewport,
    setMeasurementEntries, setModalityImageFilterKey, setNormalizationTriageField,
    setPrimaryImageFilterKey, setSecondaryImageFilterKey,
    setShortcutHelpVisible, workspaceHydration,
  });

  useInspectionAnnotationSync({
    annotations, annotationsMutationRevisionRef,
    fullscreenBoundsEditAnnotationId: fullscreenSession.fullscreenBoundsEditAnnotationId,
    inspectionAnnotationItems, isAllImagesSelection, projectId, selectedAnnotationId,
    selectedInspectionItemKey, selectedPart, setAnnotationsLoading, setAnnotationsState,
    setFullscreenBoundsEditAnnotationId: fullscreenSession.setFullscreenBoundsEditAnnotationId,
    setSelectedAnnotationId, setSelectedInspectionItemKey,
  });

  useInspectionWorkspacePersistence({
    activeMetadataTab, activeMprPane, activeOverlayIds, activeSelectionId,
    cursorProbe, displayWindow, effectiveModalityImageFilterKey, effectivePrimaryImageFilterKey,
    effectiveSecondaryImageFilterKey, enabledModalities, hiddenModalityImageFilterValues,
    hiddenPrimaryImageFilterValues, hiddenSecondaryImageFilterValues, imageEnabled,
    inspectorViewport, loading, measurementEntries, modalityImageFilterKey, mprProjectionMirror,
    mprReconstructionMode, normalizationTriageField, onInspectionShareStateChange, panelLayout,
    partFilter, primaryImageFilterKey, projectId, projectType, rayMarchSettings, readOnly,
    reviewFilter, secondaryImageFilterKey, selectedBatchId, selectedImageRef, selectedPart,
    selectedPartId, shortcutHelpVisible, slicePosition, sortMode, viewportTransform,
    workspaceStateLoaded,
  });

  const {
    reviewSummary, updatePartAnnotationsState, updatePartReviewState,
  } = useInspectionPartReview({
    inspectorHotkeys, mprFullscreenOpen, parts, projectId, readOnly, savingPartId, selectedPart,
    setError, setParts, setSavingPartId, setShortcutHelpVisible,
  });

  const segmentationWorkbench = useInspectionSegmentationWorkbench({
    activeMprPane, annotations, applyMprNavigationSession, displayWindow, mprDimensions,
    mprProjectionMirror, persistenceScopeRef: activeSegmentationPersistenceScopeRef, projectId,
    readOnly, selectedPart, selectedPartId, setAnnotations, setError, setSelectedAnnotationId,
    slicePosition, stepSlicePosition, updateSlicePosition, volumeCacheState,
  });
  const {
    getCanonicalSliceIndex: getSegmentationCanonicalSliceIndex,
    helperOpen: segmentationHelperOpen,
    helperView: segmentationHelperView,
    openSegmentationHelper,
  } = segmentationWorkbench;

  const viewportZoom = useInspectionViewportZoom({
    applyMprNavigationSession, selectedImageRef, setInspectorViewport, setMprProjectionMirror,
  });

  const {
    classifyMeasurementLine, createAnnotation, createBoxAnnotation, createCubeAnnotation,
    createMeasurementAnnotation, deleteAnalyzeOverlay, deleteMeasurementAnnotation, nextMeasurementName,
    setTileAnnotationMode, updateAnnotationFromModal, updateBoxAnnotationGeometry,
    updateMeasurementAnnotationLine,
  } = useInspectionAnnotationActions({
    readOnly,
    setDeletingOverlayId,
    projectId,
    setParts,
    setSelectedImageRef,
    setError,
    setAnnotationToolMode,
    cancelAnnotationDraft,
    setTileCalibrationPromptImageId,
    setAnnotations,
    setSelectedAnnotationId,
    selectedPart,
    annotationDraft,
    customDefectTypeDraft,
    enabledModalities,
    modalityOptions,
    mutateAnnotation,
    updatePartAnnotationsState,
    resetAnnotationDraft,
    closeOtherAnnotationModal,
    getAnnotationSourceImageIdForImage,
    getCalibrationForImage,
    annotations,
    fullscreenSession,
    activePartMutationGeneration,
    deleteSegmentationSegment: segmentationWorkbench.deleteSegment,
    isActivePartMutation,
    annotationEditDraft,
    selectedInspectionOverlayStyleTarget,
    closeAnnotationEditModal,
    inspectionAnnotationItems,
    selectedAnnotationId,
  });
  const { createCropChildImage, cropBoxAnnotation, updateCropChildSubtitle } = useInspectionCropActions({
    readOnly,
    selectedPart,
    projectImageLookup,
    setError,
    projectId,
    setProjectImageLookup,
    setParts,
    ensureEnabledModality,
    setSelectedImageRef,
    getAnnotationSourceImageIdForImage,
    setCroppingAnnotationId,
  });

  const { setInspectionItemVisibility } = useInspectionItemVisibility({
    isAllImagesSelection,
    selectedPart,
    projectId,
    activePartMutationGeneration,
    readOnly,
    setAnnotations,
    segmentVisibility: segmentationWorkbench.segmentVisibility,
    setParts,
    mutateAnnotation,
    isActivePartMutation,
    setError,
  });
  const pt3SplatViewerBaseProps = buildPt3SplatViewerProps({
    part: selectedPart,
    projectId,
    volume: {
      descriptor: volumeRendererDescriptor,
      imageStack: volumeRendererImageStack,
      overlayImageStacks: displayVolumeRendererOverlayImageStacks,
      splatParameters: mprDerived.splatParameters,
    },
    navigation: {
      rotation: mprRotation,
      zoom: viewportTransform.zoom,
      mirrorScale: mprAxisMirrorScale,
      activeSliceAxis: lastActiveMprAxis,
      apply: applyMprNavigationSession,
      onReset: viewportZoom.resetViewport,
    },
    settings: {
      rayMarchSettings,
      splatViewSettings,
      onRayMarchSettingsChange: setRayMarchSettings,
      onSplatViewSettingsChange: setSplatViewSettings,
    },
    pt3GuideSettings,
  });

  const {
    handleInspectionFlexLayoutAction, handleInspectionFlexLayoutChange,
  } = useInspectionFlexLayoutActions({
    inspectionHierarchy,
    setActiveInspectionViewTab,
    setSelectedPartId,
    selectedPartId,
    filteredParts,
    availableLayoutWidth,
    inspectionResizeSaveTimerRef,
    saveInspectionColumnWidths,
  });

  const calibratedGeometry = createCalibratedAnnotationGeometry({
    getAnnotationSourceImageIdForImage, getCalibrationForImage,
  });
  const { getLineDistanceMm } = calibratedGeometry;

  const tilePointer = useTileAnnotationPointer({
    tileGeometryDragPreviewRef,
    setTileGeometryDragPreview,
    readOnly,
    annotations,
    suppressNextTileClickRef,
    setSelectedAnnotationId,
    setAnnotationToolMode,
    cancelAnnotationDraft,
    tileAnnotationGeometryDragRef,
    getLineDistanceMm,
    updateMeasurementAnnotationLine,
    updateBoxAnnotationGeometry,
    tilePanDragRef,
    normalizedInspectorViewport,
    setInspectorViewport,
    annotationToolMode,
    getAnnotationSourceImageIdForImage,
    requireCalibrationForAnnotation,
    annotationDraftsRef,
    startAnnotationDraft,
    storedMeasurementLinesByImageId,
    createMeasurementAnnotation,
    nextMeasurementName,
    classifyMeasurementLine,
    finishAnnotationDraft,
    createCropChildImage,
    storedBoxAnnotationsByImageId,
    createBoxAnnotation,
    deactivateFullscreenBoxTools: fullscreenSession.deactivateFullscreenBoxTools,
    moveAnnotationDraft,
  });

  const mprPointer = useMprAnnotationPointer({
    getMprAnnotationSliceContext,
    mprProjectionMirror,
    readOnly,
    annotationToolMode,
    applyMprNavigationSession,
    slicePosition,
    requireCalibrationForAnnotation,
    annotationDraftsRef,
    startAnnotationDraft,
    storedMprMeasurementLinesBySlice,
    createMeasurementAnnotation,
    getMprAnnotationImage,
    nextMeasurementName,
    classifyMeasurementLine,
    finishAnnotationDraft,
    setAnnotationToolMode,
    moveAnnotationDraft,
    storedMprBoxAnnotationsBySlice,
    createBoxAnnotation,
    createCubeAnnotation,
    cancelAnnotationDraft,
    mprGeometryDragPreviewRef,
    setMprGeometryDragPreview,
    annotations,
    setSelectedAnnotationId,
    mprAnnotationGeometryDragRef,
    getLineDistanceMm,
    updateMeasurementAnnotationLine,
    updateBoxAnnotationGeometry,
  });

  const fullscreenPointer = useFullscreenAnnotationPointer({
    fullscreenSession,
    mprProjectionMirror,
    annotationDraftsRef,
    moveAnnotationDraft,
    getLineDistanceMm,
    readOnly,
    setSelectedAnnotationId,
    updateMeasurementAnnotationLine,
    updateBoxAnnotationGeometry,
    cancelAnnotationDraft,
  });

  const fullscreenTools = useFullscreenAnnotationTools({
    fullscreenSession,
    readOnly,
    cancelAnnotationDraft,
    getCalibrationForImage,
    getAnnotationSourceImageIdForImage,
    requireCalibrationForAnnotation,
    storedMprBoxAnnotationsBySlice,
    storedBoxAnnotationsByImageId,
    createBoxAnnotation,
    classifyMeasurementLine,
    nextMeasurementName,
    storedMprMeasurementLinesBySlice,
    storedMeasurementLinesByImageId,
    getLineDistanceMm,
    createMeasurementAnnotation,
    getFullscreenImagePointerPosition: fullscreenPointer.getFullscreenImagePointerPosition,
    updateMeasurementAnnotationLine,
    updateBoxAnnotationGeometry,
    startAnnotationDraft,
    annotationDraftsRef,
    createCropChildImage,
  });
  const partPaneProps = buildPartPaneProps({
    aggregateLayerAvailability, aggregateModalities, aggregatePartImageRefs, aggregateViews,
    annotations, batches, collapsedPartRows, enabledModalities, ensureRenderCategoryVisible,
    filteredParts, imageSortFilter, inspectionHierarchy, manualFilterNotice,
    normalizationTriageField, normalizationTriageMatchCount, partFilter, projectConfiguration,
    projectImageLookup, reviewFilter, selectOnlyModalityVisibility, selectedBatchId, selectedPart,
    setAllModalityVisibility, setInspectionFocusRequest, setModalityImageFilterKey, setPartFilter,
    setPrimaryImageFilterKey, setReviewFilter, setSecondaryImageFilterKey, setSelectedBatchId,
    setSelectedImageRef, setSelectedPartId, setSortMode, sortMode,
  });
  const annotationsPaneProps = buildAnnotationsPaneProps({
    annotationToolMode, annotationsLoading, annotationsVisible, cropBoxAnnotation, croppingAnnotationId,
    deleteMeasurementAnnotation, handleTileCalibrationChange, inspectionAnnotationItems,
    inspectionHierarchy, openInspectionItemConfigModal, openOtherAnnotationModal, projectId,
    projectImageLookup, projectType, readOnly, selectInspectionAnnotationItem, selectedInspectionItem,
    selectedPart, setAnnotationsVisible, setInspectionItemVisibility, setTileAnnotationMode,
    tileCalibrationPromptImageId,
  });
  const annotationEditModalProps = buildAnnotationEditModalProps({
    annotationEditDraft, annotationEditModalVisible, annotations, closeAnnotationEditModal,
    configuredDefectTypes, inspectionAnnotationItems, readOnly, selectedAnnotationId,
    selectedInspectionOverlayStyleTarget, setAnnotationEditDraft, updateAnnotationFromModal,
  });
  const workbenchUtilityModalProps = buildWorkbenchUtilityModalProps({
    activeMetadataTab, activeWorkbenchModal, annotationsPaneProps, partPaneProps, selectedPart,
    setActiveMetadataTab, setActiveWorkbenchModal,
  });
  const mprViewportProps = buildMprViewportProps({
    activeVolumeOverlayCaches, annotationDrafts, annotationLayerVisible, annotationLayers,
    annotationOpacityMultiplier, annotationToolMode, annotationsVisible, applyMprNavigationSession,
    calibratedGeometry, displayVolumeRendererOverlayImageStacks, displayWindow, filteredParts, fullscreenPointer,
    getMprAnnotationImage, getSegmentationCanonicalSliceIndex, hasVolumeImageSource, inspectionAnnotationItems,
    measurementRun, mprDerived, mprFullscreenAnnotationListVisible, mprFullscreenCloseRef,
    mprFullscreenOpen, mprFullscreenReconstructionSettingsVisible, mprFullscreenSceneRef,
    mprGeometryDragPreview, mprNavigationSession, mprOverlayCanvasRef, mprPointer,
    mprProjectionMirror, mprReconstructionView, openMprAnnotationTool, openSegmentationHelper,
    projectType, pt3GuideAppearance, pt3SplatViewerBaseProps, readOnly, segmentationHelperOpen,
    segmentationHelperView, segmentationRun, selectedAnnotationId, selectedExternalOverlayResourceId,
    selectedPart, setAnnotationsVisible, setDisplayWindow,
    setFullscreenMeasureActive: fullscreenSession.setFullscreenMeasureActive,
    setInspectionItemVisibility, setMprFullscreenAnnotationListVisible,
    setMprFullscreenReconstructionSettingsVisible, setMprReconstructionMode, setRayMarchSettings,
    setSelectedPartId, setSplatConfigModalOpen, setSplatParameterOverridesByPart, shellImageLayers,
    sliceNavigation, splatConfigModalOpen, tooltipValues, viewportZoom, volumeCacheState,
    volumeMetadataProbeState, volumePreviewLayers,
  });
  const centerPaneProps = buildCenterPaneProps({
    annotationDrafts, annotationLayers, annotationOpacityMultiplier, calibratedGeometry,
    deleteAnalyzeOverlay, deletingOverlayId, imageEnabled, imageSortFilter, isAllImagesSelection,
    mprViewportProps,
    normalizedInspectorViewport, projectImageLookup, readOnly, selectedAnnotationId, selectedImageRef,
    selectedInspectionItem, selectedPart, selectedPartImageRefs,
    setFullscreenImageModal: fullscreenSession.setFullscreenImageModal,
    setSelectedImageRef, suppressNextTileClickRef, tileColumns,
    tileGeometryDragPreview, tilePointer, tileSizeRangeInputRef, updateCropChildSubtitle, viewportZoom,
  });
  const fullscreenModalProps = buildFullscreenModalProps({
    annotationDrafts, annotationDraftsRef, calibratedGeometry, cancelAnnotationDraft, centerPaneProps, cropBoxAnnotation,
    croppingAnnotationId, deleteMeasurementAnnotation, fullscreenPointer, fullscreenSession,
    fullscreenTools, getAnnotationSourceImageIdForImage, handleFullscreenCalibrationChange,
    mprViewportProps, projectId, projectType, readOnly, setSelectedAnnotationId,
  });
  const inspectionFlexLayoutFactory = createInspectionFlexLayoutFactory({
    annotationsPaneProps, centerPaneProps, inspectionHierarchy, partPaneProps,
  });
  const segmentationHelperSliceImage = buildSegmentationHelperSliceImage({
    activeVolumeOverlayCaches, displayWindow, hasVolumeImageSource, mprDerived, mprProjectionMirror,
    shellImageLayers, slicePosition, volumeCacheState,
  });

  return (
    <section className="workbench-panel" aria-label="Inspection Workbench">
      {loading && <div className="loading-text">Loading inspection workbench…</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && (
        <>
          {projectType !== 'PT3' && (
            <div className="workbench-stats">
              <span className="group-badge">Batches: {batches.length}</span>
              <span className="group-badge">Parts: {parts.length}</span>
              <span className="group-badge">Passed: {reviewSummary.pass}</span>
              <span className="group-badge">Rejected: {reviewSummary.reject_confirmed + reviewSummary.reject_pending}</span>
            </div>
          )}

          <div className="workbench-layout">
            {projectType === 'PT3' ? (
              <Pt3FocusedWorkbench
                detailsRef={workbenchDetailsRef}
                selectedPart={selectedPart}
                summary={{ batchCount: batches.length, partCount: parts.length, reviewSummary }}
                inspectorHotkeys={inspectorHotkeys}
                review={{ readOnly, savingPartId, onReview: updatePartReviewState }}
                shortcutHelpVisible={shortcutHelpVisible}
                onOpenPartSelection={() => setActiveWorkbenchModal('parts')}
                onOpenMetadata={() => {
                  setActiveMetadataTab('nsipro');
                  setActiveWorkbenchModal('metadata');
                }}
                mprViewport={<MprViewport {...mprViewportProps} />}
                annotationsPane={<AnnotationsPane {...annotationsPaneProps} />}
                workbenchModal={<WorkbenchUtilityModal {...workbenchUtilityModalProps} />}
              />
            ) : (
            <div className="workbench-details" ref={workbenchDetailsRef}>
              {selectedPart ? (
                <>
                  <div className="workbench-detail-header">
                    <h3>{selectedPart.display_name || selectedPart.serial_number}</h3>
                    <div className="workbench-detail-actions">
                      <button
                        className="btn btn-success"
                        disabled={readOnly || savingPartId === selectedPart.id}
                        onClick={() => updatePartReviewState(selectedPart, 'pass')}
                      >
                        Pass
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={readOnly || savingPartId === selectedPart.id}
                        onClick={() => updatePartReviewState(selectedPart, 'unreviewed')}
                      >
                        Reset
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={readOnly || savingPartId === selectedPart.id}
                        onClick={() => updatePartReviewState(selectedPart, 'reject_confirmed')}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  <p className="muted" data-testid="inspector-hotkey-hints">
                    Hotkeys: pass ({inspectorHotkeys.accept_classification.toUpperCase()}), reject (
                    {inspectorHotkeys.reject_classification.toUpperCase()}), shortcuts help (
                    {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}).
                  </p>
                  {shortcutHelpVisible && (
                    <div className="workbench-notice" data-testid="shortcut-help-panel">
                      <strong>Shortcut help</strong>
                      <ul>
                        <li>Mark Pass: {inspectorHotkeys.accept_classification.toUpperCase()}</li>
                        <li>Reject: {inspectorHotkeys.reject_classification.toUpperCase()}</li>
                        <li>Toggle this help: {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}</li>
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="workbench-notice" data-testid="inspection-empty-state">
                  <strong>No part selected</strong>
                  <p className="muted">
                    {filteredParts.length === 0
                      ? 'No parts found for the current filters. The configured inspection workspace is ready for incoming parts.'
                      : 'Select a part from the summary panel to begin inspection.'}
                  </p>
                  {normalizationTriageField && (
                    <p className="muted" data-testid="normalization-triage-empty-guidance">
                      {normalizationTriageMatchCount > 0
                        ? `Triage matches exist for ${normalizationTriageField}, but they are hidden by the active filters.`
                        : `No parts in this project contain mixed ${normalizationTriageField} metadata values.`}
                    </p>
                  )}
                </div>
              )}

                  <div
                    className="workbench-flexlayout-shell"
                    style={workbenchFlexLayoutStyle}
                    data-testid="inspection-layout-grid"
                  >
                    <Layout
                      model={inspectionFlexLayoutModel}
                      factory={inspectionFlexLayoutFactory}
                      onAction={handleInspectionFlexLayoutAction}
                      onModelChange={handleInspectionFlexLayoutChange}
                    />
                  </div>

            </div>
            )}
          </div>
        </>
	      )}
      <OtherAnnotationModal
        readOnly={readOnly}
        otherAnnotationModalVisible={otherAnnotationModalVisible}
        closeOtherAnnotationModal={closeOtherAnnotationModal}
        annotationDraft={annotationDraft}
        setAnnotationDraft={setAnnotationDraft}
        configuredDefectTypes={configuredDefectTypes}
        selectedPart={selectedPart}
        createAnnotation={createAnnotation}
      />
      <AnnotationEditModal {...annotationEditModalProps} />
      <InspectionSegmentationHelperDialog
        dialog={segmentationWorkbench.dialog}
        pt3SplatViewerBaseProps={pt3SplatViewerBaseProps}
        sliceImage={segmentationHelperSliceImage}
        readOnly={readOnly}
      />
	      <FullscreenImageModal {...fullscreenModalProps} />
	    </section>
	  );
}

export {
  getInspectionImageOrderKey,
  applyInspectionImageDisplayOrder,
  sortInspectionImageDisplayEntries,
  buildInspectionShareParams,
};
export {
  getVolumeSourceImages,
  getVolumeOverlayStacks,
  getAlignedVolumeOverlayRendererStacks,
  getVolumeSummaryRepresentativeIndices,
  getVolumeRendererSliceIndices,
  getSemantic3dVolumeOverlayStacks,
  isRenderableVolumeOverlay,
  mapWithConcurrency,
};
export {
  MPR_VOLUME_SLICE_RENDER_VERSION,
  getMprFallbackModelZoom,
  getCanonicalSegmentationSliceIndex,
  getMprSliceCanvasCacheStats,
  getMprSliceCachingMessage,
  getMprOverlayCompositeAlpha,
  getAnnotationOpacityMultiplier,
  normalizeAnnotationTransparencyPercent,
  getServerVolumePrefetchSources,
  projectMprPointToOverlay,
  drawServerMprSliceImage,
  drawMprOverlaySlice,
  createServerVolumeDescriptor,
  getMprVolumeCacheKey,
  rememberSliceCanvas,
  resetMprSliceCanvasCacheForTests,
  shouldApplyDisplayWindowToVolumeCache,
};
export default InspectionWorkbenchPanel;
