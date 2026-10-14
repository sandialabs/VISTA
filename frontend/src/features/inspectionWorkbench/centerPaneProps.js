// Pure builders for the WorkbenchCenterPane props. The selection and tileView
// groups are shared with the fullscreen image modal.

const buildCenterSelection = (input) => ({
  isAllImagesSelection: input.isAllImagesSelection,
  selectedPart: input.selectedPart,
  selectedPartImageRefs: input.selectedPartImageRefs,
  visibleSelectedPartImageRefs: input.imageSortFilter.visibleSelectedPartImageRefs,
  selectedImageRef: input.selectedImageRef,
  selectedInspectionItem: input.selectedInspectionItem,
  projectImageLookup: input.projectImageLookup,
});

const buildImageSort = ({ imageSortFilter }) => ({
  imageSortButtonRef: imageSortFilter.imageSortButtonRef,
  selectedPartImageOrderKeys: imageSortFilter.selectedPartImageOrderKeys,
  imageOrderSaving: imageSortFilter.imageOrderSaving,
  imageSortMenuOpen: imageSortFilter.imageSortMenuOpen,
  toggleImageSortMenu: imageSortFilter.toggleImageSortMenu,
  imageSortMenuRef: imageSortFilter.imageSortMenuRef,
  effectiveImageSortLayers: imageSortFilter.effectiveImageSortLayers,
  updateImageSortLayer: imageSortFilter.updateImageSortLayer,
  imageSortOptions: imageSortFilter.imageSortOptions,
  addImageSortLayer: imageSortFilter.addImageSortLayer,
  removeImageSortLayer: imageSortFilter.removeImageSortLayer,
  saveImageSortOrder: imageSortFilter.saveImageSortOrder,
  imageOrderError: imageSortFilter.imageOrderError,
  imageOrderAnnouncement: imageSortFilter.imageOrderAnnouncement,
});

// CSS transform for the inspector tile viewport (pan, then zoom about the
// tile center).
export const getTileViewportStyle = (normalizedInspectorViewport) => ({
  transform: `translate(${normalizedInspectorViewport.panX}px, ${normalizedInspectorViewport.panY}px) scale(${normalizedInspectorViewport.zoom})`,
  transformOrigin: 'center center',
});

const buildTileView = (input) => ({
  imageEnabled: input.imageEnabled,
  normalizedInspectorViewport: input.normalizedInspectorViewport,
  tileViewportStyle: getTileViewportStyle(input.normalizedInspectorViewport),
  annotationOpacityMultiplier: input.annotationOpacityMultiplier,
  measurementLinesByImageId: input.annotationLayers.measurementLinesByImageId,
  boxAnnotationsByImageId: input.annotationLayers.boxAnnotationsByImageId,
  tileGeometryDragPreview: input.tileGeometryDragPreview,
  tileAnnotationPreview: input.annotationDrafts.tile.preview,
  selectedAnnotationId: input.selectedAnnotationId,
  deletingOverlayId: input.deletingOverlayId,
  suppressNextTileClickRef: input.suppressNextTileClickRef,
  getBoxWithDerivedDimensions: input.calibratedGeometry.getBoxWithDerivedDimensions,
  getUnitForImage: input.calibratedGeometry.getUnitForImage,
});

export const buildCenterPaneProps = (input) => ({
  readOnly: input.readOnly,
  mprViewportProps: input.mprViewportProps,
  selection: buildCenterSelection(input),
  tileColumns: {
    tileSizeRangeInputRef: input.tileSizeRangeInputRef,
    tileColumnMax: input.tileColumns.tileColumnMax,
    normalizedTileColumnCount: input.tileColumns.normalizedTileColumnCount,
    setTileColumnCount: input.tileColumns.setTileColumnCount,
  },
  imageSort: buildImageSort(input),
  tileView: buildTileView(input),
  handlers: {
    setSelectedImageRef: input.setSelectedImageRef,
    updateCropChildSubtitle: input.updateCropChildSubtitle,
    deleteAnalyzeOverlay: input.deleteAnalyzeOverlay,
    ...input.tilePointer,
    handleTileImageWheel: input.viewportZoom.handleTileImageWheel,
    setFullscreenImageModal: input.setFullscreenImageModal,
  },
});
