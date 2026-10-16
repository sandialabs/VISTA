import {
  getAnnotationBoxCornerPoints,
  isFiniteAnnotationBox,
  makeBoxFromMovedCorner,
  makeBoxFromPoints,
} from './inspectionAnnotationGeometry';
import { MEASUREMENT_COLORS } from './inspectionAnnotationDisplay';
import { FULLSCREEN_MIN_MEASURE_LENGTH_PX, getDraftLine, isCommittableDraftLine } from './annotationDraftReducer';
import { safeReleasePointerCapture, safeSetPointerCapture } from '../../utils/annotationGeometry';

export function useFullscreenAnnotationTools({
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
    fullscreenMeasurements,
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
    if (fullscreenBoxActive || fullscreenCropActive) {
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
      const annotationSourceImageId = getAnnotationSourceImageIdForImage(fullscreenBackingImageId);
      const existingBoxCount = fullscreenMprSliceKey
        ? (storedMprBoxAnnotationsBySlice[fullscreenMprSliceKey] || []).length
        : (storedBoxAnnotationsByImageId[String(annotationSourceImageId || '')] || []).length;
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
        color: MEASUREMENT_COLORS[existingBoxCount % MEASUREMENT_COLORS.length],
        modality: fullscreenMprSliceKey ? 'volume' : undefined,
        geometryPatch: mprGeometryPatch,
      });
      if (created?.id) setFullscreenBoundsEditAnnotationId(created.id);
    }
    cancelAnnotationDraft('fullscreen', ['drag', 'preview']);
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
    const existingLineCount = ((fullscreenMprSliceKey
      ? storedMprMeasurementLinesBySlice[fullscreenMprSliceKey]
      : storedMeasurementLinesByImageId[String(annotationSourceImageId || '')]) || []).length
      + fullscreenMeasurements.filter((item) => String(item.imageId || '') === annotationLookupKey).length;
    const color = MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length];
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
    cancelAnnotationDraft('fullscreen', ['measure', 'preview']);
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
    if (!isCommittableDraftLine(line, { minLength: FULLSCREEN_MIN_MEASURE_LENGTH_PX })) {
      cancelAnnotationDraft('fullscreen', ['measure', 'preview']);
      return;
    }
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
    if (firstPoint && position) {
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
    } else {
      cancelAnnotationDraft('fullscreen', ['drag', 'preview']);
      setFullscreenBoxActive(false);
    }
        setFullscreenBoxActive(false);
        setFullscreenCropActive(false);
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
  };

  const handleFullscreenBoxPointerCancel = (event) => {
    if (!fullscreenBoxActive && !fullscreenCropActive && !annotationDraftsRef.current.fullscreen.drag) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAnnotationDraft('fullscreen', ['drag', 'preview']);
    setFullscreenBoxActive(false);
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
