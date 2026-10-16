import { useCallback, useEffect, useRef, useState } from 'react';
import { getMprSliceKey } from './inspectionAnnotationDisplay';

const isSameId = (left, right) => String(left) === String(right);

function useFullscreenToolTransitions({
  setFullscreenBoundsEditAnnotationId,
  setFullscreenBoxActive,
  setFullscreenCalibrationPromptVisible,
  setFullscreenCropActive,
  setFullscreenEditingBoxCorner,
  setFullscreenEditingEndpoint,
  setFullscreenGeometryDragPreview,
  setFullscreenImageModal,
  setFullscreenMeasureActive,
}) {
  const clearFullscreenTools = useCallback(() => {
    setFullscreenMeasureActive(false);
    setFullscreenBoxActive(false);
    setFullscreenCropActive(false);
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenEditingEndpoint(null);
    setFullscreenEditingBoxCorner(null);
    setFullscreenGeometryDragPreview(null);
  }, [
    setFullscreenBoxActive, setFullscreenCalibrationPromptVisible, setFullscreenCropActive,
    setFullscreenEditingBoxCorner, setFullscreenEditingEndpoint, setFullscreenGeometryDragPreview,
    setFullscreenMeasureActive,
  ]);
  const openFullscreenTool = useCallback((modal, mode) => {
    setFullscreenImageModal(modal);
    setFullscreenMeasureActive(mode === 'measure');
    setFullscreenBoxActive(mode === 'box');
    setFullscreenCalibrationPromptVisible(false);
  }, [setFullscreenBoxActive, setFullscreenCalibrationPromptVisible, setFullscreenImageModal, setFullscreenMeasureActive]);
  const promptFullscreenCalibration = useCallback(() => {
    setFullscreenCalibrationPromptVisible(true);
    setFullscreenMeasureActive(false);
    setFullscreenBoxActive(false);
  }, [setFullscreenBoxActive, setFullscreenCalibrationPromptVisible, setFullscreenMeasureActive]);
  const resumeFullscreenMeasure = useCallback(() => {
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenMeasureActive(true);
  }, [setFullscreenCalibrationPromptVisible, setFullscreenMeasureActive]);
  const deactivateFullscreenBoxTools = useCallback(() => {
    setFullscreenBoxActive(false);
    setFullscreenCropActive(false);
  }, [setFullscreenBoxActive, setFullscreenCropActive]);
  const beginFullscreenGeometryEdit = useCallback((annotationId) => {
    setFullscreenBoundsEditAnnotationId(annotationId);
    setFullscreenMeasureActive(false);
    deactivateFullscreenBoxTools();
  }, [deactivateFullscreenBoxTools, setFullscreenBoundsEditAnnotationId, setFullscreenMeasureActive]);
  return {
    beginFullscreenGeometryEdit, clearFullscreenTools, deactivateFullscreenBoxTools, openFullscreenTool,
    promptFullscreenCalibration, resumeFullscreenMeasure,
  };
}

function useFullscreenSessionLifecycle({
  clearFullscreenTools,
  fullscreenAnnotationDragRef,
  fullscreenGeometryDragPreviewRef,
  setFullscreenBoundsEditAnnotationId,
  setFullscreenEditingBoxCorner,
  setFullscreenEditingEndpoint,
  setFullscreenGeometryDragPreview,
  setFullscreenImageModal,
  setFullscreenMeasurements,
}) {
  const closeFullscreenSession = useCallback(() => {
    fullscreenAnnotationDragRef.current = null;
    fullscreenGeometryDragPreviewRef.current = null;
    setFullscreenImageModal(null);
    setFullscreenBoundsEditAnnotationId(null);
    clearFullscreenTools();
  }, [
    clearFullscreenTools, fullscreenAnnotationDragRef, fullscreenGeometryDragPreviewRef,
    setFullscreenBoundsEditAnnotationId, setFullscreenImageModal,
  ]);
  const setFullscreenDragPreview = useCallback((preview) => {
    fullscreenGeometryDragPreviewRef.current = preview;
    setFullscreenGeometryDragPreview(preview);
  }, [fullscreenGeometryDragPreviewRef, setFullscreenGeometryDragPreview]);
  const forgetFullscreenAnnotation = useCallback((annotationId) => {
    setFullscreenMeasurements((prev) => prev.filter((item) => !isSameId(item.id, annotationId)));
    setFullscreenBoundsEditAnnotationId((prev) => (isSameId(prev, annotationId) ? null : prev));
    setFullscreenEditingEndpoint((prev) => (isSameId(prev?.lineId, annotationId) ? null : prev));
    setFullscreenEditingBoxCorner((prev) => (isSameId(prev?.boxId, annotationId) ? null : prev));
  }, [
    setFullscreenBoundsEditAnnotationId, setFullscreenEditingBoxCorner, setFullscreenEditingEndpoint,
    setFullscreenMeasurements,
  ]);
  return { closeFullscreenSession, forgetFullscreenAnnotation, setFullscreenDragPreview };
}

/**
 * Owns the fullscreen image session: the open image or MPR slice, the active
 * fullscreen tool, session measurements, endpoint and corner edits, the
 * geometry drag preview, and the calibration prompt. Clears the mutation-only
 * tool state when the workbench becomes read-only.
 */
export default function useFullscreenSession({ readOnly }) {
  const [fullscreenImageModal, setFullscreenImageModal] = useState(null);
  const [fullscreenMeasureActive, setFullscreenMeasureActive] = useState(false);
  const [fullscreenBoxActive, setFullscreenBoxActive] = useState(false);
  const [fullscreenCropActive, setFullscreenCropActive] = useState(false);
  const [fullscreenMeasurements, setFullscreenMeasurements] = useState([]);
  const [fullscreenCalibrationPromptVisible, setFullscreenCalibrationPromptVisible] = useState(false);
  const [fullscreenEditingEndpoint, setFullscreenEditingEndpoint] = useState(null);
  const [fullscreenEditingBoxCorner, setFullscreenEditingBoxCorner] = useState(null);
  const [fullscreenGeometryDragPreview, setFullscreenGeometryDragPreview] = useState(null);
  const [fullscreenBoundsEditAnnotationId, setFullscreenBoundsEditAnnotationId] = useState(null);
  const fullscreenImageRef = useRef(null);
  const fullscreenAnnotationDragRef = useRef(null);
  const fullscreenGeometryDragPreviewRef = useRef(null);
  const setters = {
    setFullscreenBoundsEditAnnotationId, setFullscreenBoxActive, setFullscreenCalibrationPromptVisible,
    setFullscreenCropActive, setFullscreenEditingBoxCorner, setFullscreenEditingEndpoint,
    setFullscreenGeometryDragPreview, setFullscreenImageModal, setFullscreenMeasureActive,
    setFullscreenMeasurements,
  };
  const toolTransitions = useFullscreenToolTransitions(setters);
  const { clearFullscreenTools } = toolTransitions;
  const lifecycle = useFullscreenSessionLifecycle({
    ...setters, clearFullscreenTools, fullscreenAnnotationDragRef, fullscreenGeometryDragPreviewRef,
  });

  useEffect(() => {
    if (readOnly) clearFullscreenTools();
  }, [clearFullscreenTools, readOnly]);

  const fullscreenBackingImageId = String(
    fullscreenImageModal?.backingImageId || fullscreenImageModal?.imageId || '',
  );
  const fullscreenMprSliceKey = fullscreenImageModal?.sourceKind === 'mpr'
    ? String(fullscreenImageModal.sliceKey || getMprSliceKey(fullscreenImageModal.axis, fullscreenImageModal.sliceIndex))
    : '';
  return {
    ...setters,
    ...toolTransitions,
    ...lifecycle,
    fullscreenAnnotationDragRef, fullscreenBackingImageId, fullscreenBoundsEditAnnotationId,
    fullscreenBoxActive, fullscreenCalibrationPromptVisible, fullscreenCropActive, fullscreenEditingBoxCorner,
    fullscreenEditingEndpoint, fullscreenGeometryDragPreview, fullscreenGeometryDragPreviewRef,
    fullscreenImageModal, fullscreenImageRef, fullscreenMeasureActive, fullscreenMeasurements,
    fullscreenMprSliceKey,
  };
}
