import {
  getAnnotationBoxCornerPoints,
  isFiniteAnnotationBox,
  makeBoxFromMovedCorner,
  makeBoxFromPoints,
} from './inspectionAnnotationGeometry';
import { NEW_ANNOTATION_COLOR } from './inspectionAnnotationDisplay';
import { FULLSCREEN_MIN_MEASURE_LENGTH_PX, getDraftLine, isCommittableDraftLine } from './annotationDraftReducer';
import { safeReleasePointerCapture, safeSetPointerCapture } from '../../utils/annotationGeometry';

export function useFullscreenAnnotationTools({
  fullscreenSession,
  readOnly,
  cancelAnnotationDraft,
  getCalibrationForImage,
  getAnnotationSourceImageIdForImage,
  requireCalibrationForAnnotation,
  createBoxAnnotation,
  classifyMeasurementLine,
  nextMeasurementName,
  getLineDistanceMm,
  createMeasurementAnnotation,
  getFullscreenImagePointerPosition,
  updateMeasurementAnnotationLine,
  updateBoxAnnotationGeometry,
  startAnnotationDraft,
  annotationDraftsRef,
  createCropChildImage,
}) {
  const {
    fullscreenBackingImageId,
    fullscreenBoundsEditAnnotationId,
    fullscreenBoxActive,
    fullscreenCropActive,
    fullscreenEditingBoxCorner,
    fullscreenEditingEndpoint,
    fullscreenImageModal,
    fullscreenMeasureActive,
    fullscreenMprSliceKey,
    setFullscreenBoundsEditAnnotationId,
    setFullscreenBoxActive,
    setFullscreenCalibrationPromptVisible,
    setFullscreenCropActive,
    setFullscreenEditingBoxCorner,
    setFullscreenEditingEndpoint,
    setFullscreenMeasureActive,
    setFullscreenMeasurements,
  } = fullscreenSession;
  const toggleFullscreenMeasure = () => {
    if (readOnly) return;
    if (fullscreenMeasureActive) {
      setFullscreenMeasureActive(false);
      cancelAnnotationDraft('fullscreen', ['measure']);
      setFullscreenEditingEndpoint(null);
      setFullscreenEditingBoxCorner(null);
      cancelAnnotationDraft('fullscreen', ['preview']);
      return;
    }
    if (!getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenBackingImageId))) {
      setFullscreenCalibrationPromptVisible(true);
      return;
    }
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenBoxActive(false);
    setFullscreenCropActive(false);
    cancelAnnotationDraft('fullscreen', ['drag']);
    setFullscreenEditingBoxCorner(null);
    cancelAnnotationDraft('fullscreen', ['preview']);
    setFullscreenMeasureActive(true);
  };

  const toggleFullscreenBox = () => {
    if (readOnly) return;
    // Only a second click on Draw box turns it off; clicking it while New Crop is
    // active switches tools (the code below turns crop off).
    if (fullscreenBoxActive) {
      setFullscreenBoxActive(false);
      cancelAnnotationDraft('fullscreen', ['drag']);
      setFullscreenEditingBoxCorner(null);
      cancelAnnotationDraft('fullscreen', ['preview']);
      return;
    }
    setFullscreenMeasureActive(false);
    setFullscreenCropActive(false);
    cancelAnnotationDraft('fullscreen', ['measure']);
    if (!requireCalibrationForAnnotation(fullscreenBackingImageId, { surface: 'fullscreen', toolMode: 'box' })) return;
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenEditingEndpoint(null);
    setFullscreenEditingBoxCorner(null);
    cancelAnnotationDraft('fullscreen', ['preview']);
    setFullscreenBoxActive(true);
  };

  const toggleFullscreenCrop = () => {
    if (readOnly) return;
    if (fullscreenCropActive) {
      setFullscreenCropActive(false);
      cancelAnnotationDraft('fullscreen', ['drag']);
      setFullscreenEditingBoxCorner(null);
      cancelAnnotationDraft('fullscreen', ['preview']);
      return;
    }
    setFullscreenMeasureActive(false);
    setFullscreenBoxActive(false);
    cancelAnnotationDraft('fullscreen', ['measure', 'drag']);
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenEditingEndpoint(null);
    setFullscreenEditingBoxCorner(null);
    cancelAnnotationDraft('fullscreen', ['preview']);
    setFullscreenCropActive(true);
  };

  const commitFullscreenBox = async (box) => {
    if (readOnly) return null;
    if (isFiniteAnnotationBox(box)) {
      if (!requireCalibrationForAnnotation(fullscreenBackingImageId, { surface: 'fullscreen', toolMode: 'box' })) {
        cancelAnnotationDraft('fullscreen', ['drag', 'preview']);
        return;
      }
      const mprGeometryPatch = fullscreenMprSliceKey
        ? {
          axis: fullscreenImageModal.axis,
          slice_index: fullscreenImageModal.sliceIndex,
          box: { axis: fullscreenImageModal.axis, slice_index: fullscreenImageModal.sliceIndex },
        }
        : {};
      const created = await createBoxAnnotation({
        imageId: fullscreenBackingImageId,
        box,
        name: 'Drawn bounding box',
        color: NEW_ANNOTATION_COLOR,
        modality: fullscreenMprSliceKey ? 'volume' : undefined,
        geometryPatch: mprGeometryPatch,
      });
      if (created?.id) setFullscreenBoundsEditAnnotationId(created.id);
    }
  };

  const commitFullscreenMeasureLine = async (line) => {
    if (readOnly) return null;
    if (!line) return;
    if (!getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenBackingImageId))) {
      cancelAnnotationDraft('fullscreen', ['measure']);
      setFullscreenMeasureActive(false);
      setFullscreenCalibrationPromptVisible(true);
      return;
    }
    const kind = classifyMeasurementLine(line);
    const name = nextMeasurementName(kind);
    const annotationSourceImageId = getAnnotationSourceImageIdForImage(fullscreenBackingImageId);
    const annotationLookupKey = fullscreenMprSliceKey || String(annotationSourceImageId || '');
    const color = NEW_ANNOTATION_COLOR;
    const distancePx = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const distanceMm = getLineDistanceMm(line, annotationSourceImageId);
    const mprLine = fullscreenMprSliceKey
      ? { ...line, axis: fullscreenImageModal.axis, slice_index: fullscreenImageModal.sliceIndex }
      : line;
    const created = await createMeasurementAnnotation({
      imageId: fullscreenBackingImageId,
      line: mprLine,
      name,
      color,
      distanceMm,
      modality: fullscreenMprSliceKey ? 'volume' : undefined,
      geometryPatch: fullscreenMprSliceKey
        ? { axis: fullscreenImageModal.axis, slice_index: fullscreenImageModal.sliceIndex }
        : {},
    });
    if (created && (!created.image_id || !created.geometry?.line)) {
      setFullscreenMeasurements((prev) => [...prev, { ...mprLine, id: created.id, imageId: annotationLookupKey, name, kind, color, distanceMm, distancePx }]);
    }
    if (created?.id) setFullscreenBoundsEditAnnotationId(created.id);
  };

  const handleFullscreenMeasurePointerDown = async (event) => {
    if (readOnly) return;
    if (event.button !== undefined && event.button !== 0) return;
    const position = getFullscreenImagePointerPosition(event);
    if (!position) return;
    if (fullscreenEditingEndpoint?.lineId) {
      const sourceLine = fullscreenEditingEndpoint.line;
      const adjustedPosition = position;
      const coordinatePatch = fullscreenEditingEndpoint.endpoint === 'start'
        ? { x1: adjustedPosition.x, y1: adjustedPosition.y }
        : { x2: adjustedPosition.x, y2: adjustedPosition.y };
      const nextLine = {
        ...sourceLine,
        ...coordinatePatch,
        imageWidth: position.naturalWidth,
        imageHeight: position.naturalHeight,
      };
      await updateMeasurementAnnotationLine(fullscreenEditingEndpoint.lineId, nextLine);
      setFullscreenEditingEndpoint(null);
      return;
    }
    if (fullscreenEditingBoxCorner?.boxId) {
      const adjustedPosition = position;
      const nextBox = makeBoxFromMovedCorner(
        fullscreenEditingBoxCorner.box,
        fullscreenEditingBoxCorner.corner,
        adjustedPosition,
        position.naturalWidth,
        position.naturalHeight,
      );
      if (nextBox && isFiniteAnnotationBox(nextBox)) {
        await updateBoxAnnotationGeometry(fullscreenEditingBoxCorner.boxId, {
          ...nextBox,
          id: fullscreenEditingBoxCorner.boxId,
          color: fullscreenEditingBoxCorner.box.color,
          axis: fullscreenEditingBoxCorner.box.axis,
          sliceIndex: fullscreenEditingBoxCorner.box.sliceIndex,
        });
      }
      setFullscreenEditingBoxCorner(null);
      return;
    }
    if (fullscreenBoxActive || fullscreenCropActive) return;
    if (!fullscreenMeasureActive) return;
    if (!getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenBackingImageId))) {
      setFullscreenMeasureActive(false);
      setFullscreenCalibrationPromptVisible(true);
      cancelAnnotationDraft('fullscreen', ['measure']);
      return;
    }
    const { x, y, naturalWidth, naturalHeight } = position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    event.preventDefault();
    event.stopPropagation();
    const nextPoint = { x, y, imageWidth: naturalWidth, imageHeight: naturalHeight };
    startAnnotationDraft('fullscreen', 'measure', nextPoint);
  };

  const handleFullscreenMeasurePointerUp = async (event) => {
    if (readOnly) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (!fullscreenMeasureActive) return;
    const firstPoint = annotationDraftsRef.current.fullscreen.measure;
    if (!firstPoint) return;
    const position = getFullscreenImagePointerPosition(event);
    event.preventDefault();
    event.stopPropagation();
    if (!position) {
      cancelAnnotationDraft('fullscreen', ['measure', 'preview']);
      return;
    }
    const line = getDraftLine(firstPoint, {
      x: position.x,
      y: position.y,
      imageWidth: position.naturalWidth,
      imageHeight: position.naturalHeight,
    });
    // Clear the draft synchronously, before the async create, so the click event
    // that follows mouseup cannot see the anchor and commit the line a second time.
    cancelAnnotationDraft('fullscreen', ['measure', 'preview']);
    if (!isCommittableDraftLine(line, { minLength: FULLSCREEN_MIN_MEASURE_LENGTH_PX })) return;
    await commitFullscreenMeasureLine(line);
  };

  const handleFullscreenBoxPointerDown = (event) => {
    if (readOnly) return;
    if (!fullscreenBoxActive && !fullscreenCropActive) return;
    if (event.button !== undefined && event.button !== 0) return;
    const position = getFullscreenImagePointerPosition(event);
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    const nextPoint = {
      x: position.x,
      y: position.y,
      imageWidth: position.naturalWidth,
      imageHeight: position.naturalHeight,
    };
    startAnnotationDraft('fullscreen', 'drag', nextPoint);
    safeSetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handleFullscreenBoxPointerUp = async (event) => {
    if (readOnly) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (!fullscreenBoxActive && !fullscreenCropActive) return;
    const position = getFullscreenImagePointerPosition(event);
    event.preventDefault();
    event.stopPropagation();
    const firstPoint = annotationDraftsRef.current.fullscreen.drag;
    // Draw box and New Crop stay selected so the user can draw the next shape;
    // they are turned off by clicking the tool button again or pressing Escape.
    // The draft is cleared before the async save so a quick next drag is not
    // wiped when this save finishes.
    cancelAnnotationDraft('fullscreen', ['drag', 'preview']);
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
    if (!firstPoint || !position) return;
    const box = makeBoxFromPoints(firstPoint, {
      x: position.x,
      y: position.y,
      imageWidth: position.naturalWidth,
      imageHeight: position.naturalHeight,
    });
    if (fullscreenCropActive) {
      await createCropChildImage({ parentImageId: getAnnotationSourceImageIdForImage(fullscreenBackingImageId), cropBox: box });
    } else {
      await commitFullscreenBox(box);
    }
  };

  const handleFullscreenBoxPointerCancel = (event) => {
    if (!fullscreenBoxActive && !fullscreenCropActive && !annotationDraftsRef.current.fullscreen.drag) return;
    event.preventDefault();
    event.stopPropagation();
    // Leaving the image discards the box in progress but keeps the tool selected.
    cancelAnnotationDraft('fullscreen', ['drag', 'preview']);
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
  };

  const startFullscreenEndpointEdit = (event, line, endpoint) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    if (String(fullscreenBoundsEditAnnotationId || '') !== String(line?.id || '')) return;
    const anchor = endpoint === 'start'
      ? { x: Number(line.x1), y: Number(line.y1) }
      : { x: Number(line.x2), y: Number(line.y2) };
    setFullscreenMeasureActive(false);
    setFullscreenBoxActive(false);
    cancelAnnotationDraft('fullscreen', ['measure', 'drag']);
    setFullscreenEditingBoxCorner(null);
    setFullscreenEditingEndpoint({ lineId: String(line.id), endpoint, line, anchor });
  };

  const handleFullscreenEndpointDotClick = (event, line, endpoint) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    if (fullscreenEditingEndpoint?.lineId) {
      handleFullscreenMeasurePointerDown(event);
      return;
    }
    startFullscreenEndpointEdit(event, line, endpoint);
  };

  const startFullscreenBoxCornerEdit = (event, box, corner) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    if (String(fullscreenBoundsEditAnnotationId || '') !== String(box?.id || '')) return;
    const anchor = getAnnotationBoxCornerPoints(box)[corner];
    setFullscreenMeasureActive(false);
    setFullscreenBoxActive(false);
    cancelAnnotationDraft('fullscreen', ['measure', 'drag']);
    setFullscreenEditingEndpoint(null);
    setFullscreenEditingBoxCorner({ boxId: String(box.id), corner, box, anchor });
  };

  const handleFullscreenBoxCornerDotClick = (event, box, corner) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    if (fullscreenEditingBoxCorner?.boxId) {
      handleFullscreenMeasurePointerDown(event);
      return;
    }
    startFullscreenBoxCornerEdit(event, box, corner);
  };

  return {
    toggleFullscreenMeasure,
    toggleFullscreenBox,
    toggleFullscreenCrop,
    handleFullscreenMeasurePointerDown,
    handleFullscreenMeasurePointerUp,
    handleFullscreenBoxPointerDown,
    handleFullscreenBoxPointerUp,
    handleFullscreenBoxPointerCancel,
    handleFullscreenEndpointDotClick,
    handleFullscreenBoxCornerDotClick,
  };
}
