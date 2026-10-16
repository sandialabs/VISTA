import { useCallback } from 'react';
import { deleteAnalysisOverlay } from '../../api/analyses';
import { deletePartAnnotation, updatePartSourceImage } from '../../api/parts';
import { isVistaSegmentAnnotation } from '../../components/inspectionAnnotationAdapter';
import {
  getMeasurementLineWithDerivedLength,
  isFiniteAnnotationBox,
  isFiniteMeasurementLine,
} from './inspectionAnnotationGeometry';
import {
  applyCalibratedMeasurementLine,
  buildAnnotationStylePayload,
  buildBoxAnnotationPayload,
  buildBoxGeometryUpdatePayload,
  buildCubeAnnotationPayload,
  buildManualAnnotationPayload,
  buildMeasurementAnnotationPayload,
  buildMeasurementLineUpdatePayload,
  buildSourceImageOverlayStylePatch,
  classifyMeasurementLine,
  getNextMeasurementName,
} from './inspectionAnnotationPayloads';
import { isRejectPartAnnotation } from './useInspectionPartSelection';

/**
 * Inspection annotation create and update actions for manual, measurement,
 * box, and cube annotations, plus overlay and annotation deletion and the
 * edit modal save. Saves go through `mutateAnnotation`.
 */
export function useInspectionAnnotationActions({
  readOnly,
  projectId,
  selectedPart,
  annotations,
  enabledModalities,
  modalityOptions,
  annotationDraft,
  customDefectTypeDraft,
  fullscreenSession,
  setAnnotations,
  setSelectedAnnotationId,
  setAnnotationToolMode,
  setTileCalibrationPromptImageId,
  cancelAnnotationDraft,
  resetAnnotationDraft,
  closeOtherAnnotationModal,
  updatePartAnnotationsState,
  getAnnotationSourceImageIdForImage,
  getCalibrationForImage,
  mutateAnnotation,
  activePartMutationGeneration,
  isActivePartMutation,
  deleteSegmentationSegment,
  setParts,
  setError,
  setDeletingOverlayId,
  setSelectedImageRef,
  annotationEditDraft,
  selectedInspectionOverlayStyleTarget,
  inspectionAnnotationItems,
  selectedAnnotationId,
  closeAnnotationEditModal,
}) {
  const {
    forgetFullscreenAnnotation, fullscreenBackingImageId, fullscreenMeasurements, setFullscreenMeasurements,
  } = fullscreenSession;
  const deleteAnalyzeOverlay = useCallback(async (entry) => {
    if (readOnly) return;
    const overlayId = entry?.imageId || entry?.imageRef;
    if (!overlayId) return;
    try {
      setDeletingOverlayId(String(overlayId));
      const updatedPart = await deleteAnalysisOverlay(projectId, overlayId, { readOnly, errorLabel: 'Failed to delete Analyze overlay' });
      setParts((prev) => prev.map((part) => (part.id === updatedPart.id ? updatedPart : part)));
      setSelectedImageRef((current) => (String(current) === String(entry.imageRef) ? '' : current));
    } catch (err) {
      setError(err.message || 'Failed to delete Analyze overlay');
    } finally {
      setDeletingOverlayId('');
    }
  }, [projectId, readOnly, setDeletingOverlayId, setError, setParts, setSelectedImageRef]);

  const setTileAnnotationMode = (mode) => {
    if (readOnly) return;
    setAnnotationToolMode((prev) => (prev === mode ? '' : mode));
    cancelAnnotationDraft('tile');
    setTileCalibrationPromptImageId(null);
    cancelAnnotationDraft('mpr');
  };

  const selectCreatedAnnotation = (created) => {
    setAnnotations((prev) => [created, ...prev]);
    setSelectedAnnotationId(created.id);
  };

  const selectUpdatedAnnotation = (updated) => {
    setAnnotations((prev) => prev.map((item) => (String(item.id) === String(updated.id) ? updated : item)));
    setSelectedAnnotationId(updated.id);
  };

  const getPixelsPerMm = (annotationImageId) => Number(getCalibrationForImage(annotationImageId)?.pixels_per_mm || 0);

  const createAnnotation = async () => {
    if (!selectedPart?.id || !annotationDraft.defect_class.trim()) return;
    const payload = buildManualAnnotationPayload({
      annotationDraft, customDefectTypeDraft, enabledModalities, modalityOptions,
    });
    await mutateAnnotation({
      payload,
      errorLabel: 'Failed to create annotation',
      onSuccess: (created, mutationPartId) => {
        setAnnotations((prev) => [created, ...prev]);
        updatePartAnnotationsState(mutationPartId, (previous) => [created, ...previous], {
          rejectPart: isRejectPartAnnotation(created),
        });
        resetAnnotationDraft();
        closeOtherAnnotationModal();
      },
    });
  };

  const createMeasurementAnnotation = async ({ imageId, line, name, color, distanceMm, modality, geometryPatch = {}, metadataPatch = {} }) => {
    if (!selectedPart?.id || !line || !line.imageWidth || !line.imageHeight) return;
    const payload = buildMeasurementAnnotationPayload({
      annotationImageId: getAnnotationSourceImageIdForImage(imageId),
      line,
      name,
      color,
      distanceMm,
      modality: modality || enabledModalities[0] || modalityOptions[0] || 'visual',
      geometryPatch,
      metadataPatch,
    });
    return mutateAnnotation({
      payload,
      errorLabel: 'Failed to create measurement annotation',
      onSuccess: selectCreatedAnnotation,
    });
  };

  const createBoxAnnotation = async ({ imageId, box, name, color, modality, defectClass = 'Bounding Box', geometryPatch = {}, metadataPatch = {} }) => {
    if (!selectedPart?.id || !isFiniteAnnotationBox(box)) return null;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    const payload = buildBoxAnnotationPayload({
      annotationImageId,
      box,
      name,
      color,
      modality: modality || enabledModalities[0] || modalityOptions[0] || 'visual',
      pixelsPerMm: getPixelsPerMm(annotationImageId),
      defectClass,
      geometryPatch,
      metadataPatch,
    });
    return mutateAnnotation({
      payload,
      errorLabel: 'Failed to create box annotation',
      onSuccess: selectCreatedAnnotation,
    });
  };

  const createCubeAnnotation = async ({ axis, firstBox, secondBox, color }) => {
    if (!selectedPart?.id || !axis || !isFiniteAnnotationBox(firstBox) || !isFiniteAnnotationBox(secondBox)) return null;
    const payload = buildCubeAnnotationPayload({ axis, firstBox, secondBox, color });
    if (!payload) return null;
    return mutateAnnotation({
      payload,
      errorLabel: 'Failed to create 3D annotation',
      onSuccess: selectCreatedAnnotation,
    });
  };

  const findAnnotation = (annotationId) => annotations.find((annotation) => String(annotation.id) === String(annotationId));

  const updateMeasurementAnnotationLine = async (lineId, nextLine) => {
    if (!selectedPart?.id || !lineId || !isFiniteMeasurementLine(nextLine)) return null;
    const existingAnnotation = findAnnotation(lineId);
    const annotationImageId = getAnnotationSourceImageIdForImage(
      existingAnnotation?.image_id || nextLine.imageId || fullscreenBackingImageId,
    );
    const calibratedLine = getMeasurementLineWithDerivedLength(
      nextLine,
      annotationImageId,
      getCalibrationForImage(annotationImageId),
    );
    return mutateAnnotation({
      payload: buildMeasurementLineUpdatePayload({
        existingAnnotation, annotationImageId, calibratedLine, color: nextLine.color,
      }),
      annotationId: lineId,
      errorLabel: 'Failed to update measurement annotation',
      onSuccess: (updated) => {
        setFullscreenMeasurements((prev) => applyCalibratedMeasurementLine(prev, lineId, calibratedLine, nextLine.color));
        selectUpdatedAnnotation(updated);
      },
    });
  };

  const updateBoxAnnotationGeometry = async (boxId, nextBox) => {
    if (!selectedPart?.id || !boxId || !isFiniteAnnotationBox(nextBox)) return null;
    const existingAnnotation = findAnnotation(boxId);
    const annotationImageId = getAnnotationSourceImageIdForImage(
      existingAnnotation?.image_id || nextBox.imageId || fullscreenBackingImageId,
    );
    return mutateAnnotation({
      payload: buildBoxGeometryUpdatePayload({
        existingAnnotation, annotationImageId, nextBox, pixelsPerMm: getPixelsPerMm(annotationImageId),
      }),
      annotationId: boxId,
      errorLabel: 'Failed to update box annotation',
      onSuccess: selectUpdatedAnnotation,
    });
  };

  const deleteMeasurementAnnotation = async (lineId) => {
    if (readOnly) return;
    if (!selectedPart?.id || !lineId) return;
    const mutationPartId = String(selectedPart.id);
    const mutationScope = `${projectId}:${mutationPartId}`;
    const mutationGeneration = activePartMutationGeneration;
    const annotation = annotations.find((candidate) => String(candidate.id) === String(lineId));
    if (annotation && isVistaSegmentAnnotation(annotation)) {
      await deleteSegmentationSegment(lineId);
      return;
    }
    try {
      await deletePartAnnotation(projectId, mutationPartId, lineId, { readOnly, errorLabel: 'Failed to delete measurement annotation' });
      if (!isActivePartMutation(mutationScope, mutationGeneration)) return;
      setAnnotations((prev) => prev.filter((item) => String(item.id) !== String(lineId)));
      forgetFullscreenAnnotation(lineId);
      setSelectedAnnotationId((prev) => (String(prev) === String(lineId) ? null : prev));
    } catch (err) {
      if (isActivePartMutation(mutationScope, mutationGeneration)) {
        setError(err.message || 'Failed to delete measurement annotation');
      }
    }
  };

  const updateSourceImageOverlayStyle = async (styleTarget, draft) => {
    if (!selectedPart?.id || !styleTarget.resourceId) return;
    const mutationPartId = String(selectedPart.id);
    try {
      const updatedPart = await updatePartSourceImage(
        projectId,
        mutationPartId,
        styleTarget.resourceId,
        buildSourceImageOverlayStylePatch(draft),
        { readOnly, errorLabel: 'Failed to update overlay' },
      );
      setParts((prev) => prev.map((part) => (
        String(part.id) === String(updatedPart.id) ? updatedPart : part
      )));
      closeAnnotationEditModal();
    } catch (err) {
      setError(err.message || 'Failed to update overlay');
    }
  };

  const updateAnnotationFromModal = async () => {
    if (readOnly) return;
    const draft = annotationEditDraft || {};
    const styleTarget = draft.resource === 'source_image'
      ? { resource: 'source_image', resourceId: draft.resourceId }
      : selectedInspectionOverlayStyleTarget;
    if (styleTarget?.resource === 'source_image') {
      await updateSourceImageOverlayStyle(styleTarget, draft);
      return;
    }
    const selectedStyleItem = styleTarget
      ? inspectionAnnotationItems.find((item) => (
        item.source?.resource === styleTarget.resource
        && String(item.source?.resourceId || '') === String(styleTarget.resourceId || '')
      ))
      : null;
    const selected = selectedStyleItem?.annotation
      || annotations.find((annotation) => annotation.id === selectedAnnotationId);
    if (!selected || !selectedPart?.id) return;
    const payload = buildAnnotationStylePayload(selected, draft);
    if (!payload) return;
    await mutateAnnotation({
      payload,
      annotationId: selected.id,
      errorLabel: 'Failed to update annotation',
      onSuccess: (updated, mutationPartId) => {
        setAnnotations((prev) => prev.map((annotation) => (annotation.id === updated.id ? updated : annotation)));
        updatePartAnnotationsState(mutationPartId, (previous) => previous.map((annotation) => (
          String(annotation.id) === String(updated.id) ? updated : annotation
        )), { rejectPart: isRejectPartAnnotation(updated) });
        closeAnnotationEditModal();
      },
    });
  };

  const nextMeasurementName = (kind) => getNextMeasurementName(fullscreenMeasurements, kind);

  return {
    deleteAnalyzeOverlay,
    setTileAnnotationMode,
    createAnnotation,
    createMeasurementAnnotation,
    createBoxAnnotation,
    createCubeAnnotation,
    updateMeasurementAnnotationLine,
    updateBoxAnnotationGeometry,
    deleteMeasurementAnnotation,
    updateAnnotationFromModal,
    classifyMeasurementLine,
    nextMeasurementName,
  };
}
