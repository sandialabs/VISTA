import { getAnnotationBoxHeightLabel, getAnnotationBoxWidthLabel, getMeasurementLineLabel, isFiniteAnnotationBox, isFiniteMeasurementLine } from './inspectionAnnotationGeometry';
import { getMprCrosshairStyle } from './mprGeometry';
import { getMprAxisImageDimensions } from './volumeDescriptors';
import { getAnnotationListType } from './annotationListHelpers';
import { segmentVisibleOnSlice } from './segmentationGeometry';

// Identity of the image shown fullscreen and where its annotations live.
function resolveFullscreenIdentity(ctx) {
  const {
    fullscreenImageModal,
    fullscreenBackingImageId,
    fullscreenMprSliceKey,
    projectImageLookup,
    getAnnotationSourceImageIdForImage,
  } = ctx;
    const isMprFullscreen = fullscreenImageModal?.sourceKind === 'mpr';
    const fullscreenImageId = fullscreenBackingImageId;
    const fullscreenAnnotationSourceImageId = getAnnotationSourceImageIdForImage(fullscreenImageId);
    const fullscreenAnnotationLookupKey = isMprFullscreen
      ? fullscreenMprSliceKey
      : fullscreenAnnotationSourceImageId;
    const fullscreenBaseImageId = String(fullscreenImageModal.baseImageId || (
      fullscreenAnnotationSourceImageId && fullscreenAnnotationSourceImageId !== fullscreenImageId
        ? fullscreenAnnotationSourceImageId
        : ''
    ));
    const fullscreenImageRecord = projectImageLookup[fullscreenImageId] || {};
  return {
    isMprFullscreen,
    fullscreenImageId,
    fullscreenAnnotationSourceImageId,
    fullscreenAnnotationLookupKey,
    fullscreenBaseImageId,
    fullscreenImageRecord,
  };
}

// Saved, drag-previewed, and draft geometry drawn on the fullscreen image.
function buildFullscreenGeometry(ctx) {
  const {
    isMprFullscreen,
    fullscreenImageId,
    fullscreenAnnotationSourceImageId,
    fullscreenAnnotationLookupKey,
    fullscreenMeasurements,
    fullscreenGeometryDragPreview,
    fullscreenAnnotationPreview,
    annotationsVisible,
    mprMeasurementLinesBySlice,
    mprBoxAnnotationsBySlice,
    inspectionAnnotationItems,
    measurementLinesByImageId,
    boxAnnotationsByImageId,
    getBoxWithDerivedDimensions,
  } = ctx;
	    const fullscreenExternalOverlayItem = inspectionAnnotationItems.find((item) => (
	      item.kind === 'external_overlay'
	      && [
	        item.source?.resourceId,
	        item.overlay?.imageId,
	        item.overlay?.imageRef,
	        item.overlay?.filename,
	      ].some((identity) => String(identity || '') === fullscreenImageId)
	    ));
	    const fullscreenExternalOverlayVisible = !fullscreenExternalOverlayItem
	      || (annotationsVisible && fullscreenExternalOverlayItem.visible !== false);
	    const fullscreenMeasurementLines = [
	      ...(isMprFullscreen
	        ? (mprMeasurementLinesBySlice[fullscreenAnnotationLookupKey] || [])
	        : (measurementLinesByImageId[fullscreenAnnotationSourceImageId] || [])),
	      ...fullscreenMeasurements.filter((line) => String(line.imageId || '') === String(fullscreenAnnotationLookupKey || '')),
	    ].filter(isFiniteMeasurementLine);
	    const fullscreenBoxAnnotations = (isMprFullscreen
	      ? (mprBoxAnnotationsBySlice[fullscreenAnnotationLookupKey] || [])
	      : (boxAnnotationsByImageId[fullscreenAnnotationSourceImageId] || []))
	      .filter(isFiniteAnnotationBox)
	      .map((box) => getBoxWithDerivedDimensions(box, fullscreenAnnotationSourceImageId));
	    const renderedFullscreenMeasurementLines = fullscreenMeasurementLines.map((line) => (
	      fullscreenGeometryDragPreview?.kind === 'line'
	      && String(fullscreenGeometryDragPreview.geometry?.id) === String(line.id)
	        ? fullscreenGeometryDragPreview.geometry
	        : line
	    ));
	    const renderedFullscreenBoxAnnotations = fullscreenBoxAnnotations.map((box) => (
	      fullscreenGeometryDragPreview?.kind === 'box'
	      && String(fullscreenGeometryDragPreview.geometry?.id) === String(box.id)
	        ? fullscreenGeometryDragPreview.geometry
	        : box
	    ));
	    const fullscreenPreviewLines = fullscreenAnnotationPreview?.mode === 'measure'
	      ? [fullscreenAnnotationPreview.line].filter(isFiniteMeasurementLine)
	      : [];
	    const fullscreenPreviewBoxes = ['box', 'crop'].includes(fullscreenAnnotationPreview?.mode)
	      ? [fullscreenAnnotationPreview.box].filter(isFiniteAnnotationBox).map((box) => getBoxWithDerivedDimensions(box, fullscreenAnnotationSourceImageId))
	      : [];
  return {
    fullscreenExternalOverlayItem,
    fullscreenExternalOverlayVisible,
    fullscreenMeasurementLines,
    fullscreenBoxAnnotations,
    renderedFullscreenMeasurementLines,
    renderedFullscreenBoxAnnotations,
    fullscreenPreviewLines,
    fullscreenPreviewBoxes,
  };
}

// Rows for the fullscreen annotation side list.
function buildFullscreenAnnotationItems(ctx) {
  const {
    renderedFullscreenMeasurementLines,
    renderedFullscreenBoxAnnotations,
    inspectionAnnotationItems,
    fullscreenAnnotationSourceImageId,
    getUnitForImage = () => 'mm',
  } = ctx;
	    const fullscreenAnnotationUnit = getUnitForImage(fullscreenAnnotationSourceImageId);
	    const fullscreenInspectionItemById = new Map(
	      inspectionAnnotationItems.map((item) => [String(item.id), item]),
	    );
	    const fullscreenGeometryItems = [
	      ...renderedFullscreenMeasurementLines.map((line, index) => ({
	        ...line,
	        annotationType: 'measurement',
	        title: line.name || `Measurement ${index + 1}`,
	        summary: getMeasurementLineLabel(line, fullscreenAnnotationUnit),
	        inspectionItem: fullscreenInspectionItemById.get(String(line.id)),
	      })),
	      ...renderedFullscreenBoxAnnotations.map((box, index) => ({
	        ...box,
	        annotationType: 'box',
	        title: box.name || `Box ${index + 1}`,
	        summary: `${getAnnotationBoxWidthLabel(box, fullscreenAnnotationUnit)} • ${getAnnotationBoxHeightLabel(box, fullscreenAnnotationUnit)}`,
	        inspectionItem: fullscreenInspectionItemById.get(String(box.id)),
	      })),
	    ];
	    const fullscreenGeometryIds = new Set(fullscreenGeometryItems.map((item) => String(item.id)));
	    const fullscreenUnifiedItems = inspectionAnnotationItems
	      .filter((item) => !fullscreenGeometryIds.has(String(item.id)))
	      .map((item) => {
	        const segment = item.annotation?.geometry?.segment;
	        return {
	          id: item.id,
	          annotationType: item.kind,
	          title: item.kind === 'external_overlay' ? `External: ${item.label}` : item.label,
	          summary: item.kind === 'vista_segment'
	            ? `${segment?.axis || 'axial'} slices ${segment?.min_slice ?? 0}-${segment?.max_slice ?? 0}`
	            : item.kind === 'external_overlay'
	              ? 'Assigned external image or volume'
	              : getAnnotationListType(item.annotation),
	          color: item.color,
	          inspectionItem: item,
	        };
	      });
	    const fullscreenAnnotationItems = [...fullscreenGeometryItems, ...fullscreenUnifiedItems];
  return {
    fullscreenInspectionItemById,
    fullscreenGeometryItems,
    fullscreenGeometryIds,
    fullscreenUnifiedItems,
    fullscreenAnnotationItems,
    fullscreenAnnotationUnit,
  };
}

// Slice position, overlay sizing, and visible segments for MPR fullscreen.
function buildFullscreenMprLayout(ctx) {
  const {
    isMprFullscreen,
    renderedFullscreenMeasurementLines,
    renderedFullscreenBoxAnnotations,
    fullscreenPreviewLines,
    fullscreenPreviewBoxes,
    fullscreenImageModal,
    annotationLayerVisible,
    vectorSegmentAnnotations,
    slicePosition,
    mprProjectionMirror,
    mprDimensions,
    volumeCacheState,
    getSegmentationCanonicalSliceIndex,
  } = ctx;
	    const fullscreenMprSlicePosition = isMprFullscreen
	      ? { ...slicePosition, [fullscreenImageModal.axis]: fullscreenImageModal.sliceIndex }
	      : null;
	    const fullscreenMprProjectionStyle = isMprFullscreen
	      ? getMprCrosshairStyle(
	        fullscreenImageModal.axis,
	        fullscreenMprSlicePosition,
	        mprDimensions,
	        mprProjectionMirror,
	      )
	      : undefined;
	    const fullscreenMprImageDimensions = isMprFullscreen
	      ? getMprAxisImageDimensions(fullscreenImageModal.axis, mprDimensions, volumeCacheState.cache)
	      : null;
	    const fullscreenOverlayGeometry = [
	      ...renderedFullscreenMeasurementLines,
	      ...renderedFullscreenBoxAnnotations,
	      ...fullscreenPreviewLines,
	      ...fullscreenPreviewBoxes,
	    ][0];
	    const fullscreenOverlayWidth = fullscreenMprImageDimensions?.width
	      || Math.max(1, Number(fullscreenOverlayGeometry?.imageWidth) || 1000);
	    const fullscreenOverlayHeight = fullscreenMprImageDimensions?.height
	      || Math.max(1, Number(fullscreenOverlayGeometry?.imageHeight) || 1000);
	    const fullscreenOverlayViewBox = `0 0 ${fullscreenOverlayWidth} ${fullscreenOverlayHeight}`;
	    const fullscreenOverlayContentTransform = `scale(${fullscreenOverlayWidth / 1000} ${fullscreenOverlayHeight / 1000})`;
	    const fullscreenCanonicalSliceIndex = isMprFullscreen
	      ? getSegmentationCanonicalSliceIndex(
	        fullscreenImageModal.axis,
	        Number(fullscreenImageModal.sliceIndex),
	      )
	      : 0;
	    const fullscreenSegmentAnnotations = isMprFullscreen && annotationLayerVisible
	      ? vectorSegmentAnnotations.filter((segment) => (
	        segmentVisibleOnSlice(
	          segment,
	          fullscreenImageModal.axis,
	          fullscreenCanonicalSliceIndex,
	        )
	      ))
	      : [];
  return {
    fullscreenMprSlicePosition,
    fullscreenMprProjectionStyle,
    fullscreenMprImageDimensions,
    fullscreenOverlayGeometry,
    fullscreenOverlayWidth,
    fullscreenOverlayHeight,
    fullscreenOverlayViewBox,
    fullscreenOverlayContentTransform,
    fullscreenCanonicalSliceIndex,
    fullscreenSegmentAnnotations,
  };
}

// Pure derivation of everything the fullscreen image modal renders. Takes the
// flattened panel state and returns it extended with the derived values.
export function buildFullscreenModalModel(input) {
  const ctx = { ...input };
  Object.assign(ctx, resolveFullscreenIdentity(ctx));
  Object.assign(ctx, buildFullscreenGeometry(ctx));
  Object.assign(ctx, buildFullscreenAnnotationItems(ctx));
  ctx.fullscreenShowsExternalOverlay = Boolean(ctx.fullscreenBaseImageId && ctx.fullscreenExternalOverlayVisible);
  Object.assign(ctx, buildFullscreenMprLayout(ctx));
  return ctx;
}
