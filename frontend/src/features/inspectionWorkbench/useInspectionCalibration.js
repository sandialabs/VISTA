import { useCallback, useMemo } from 'react';
import { isValidCalibration, resolveMeasurementCalibration } from '../../utils/calibration';
import { getAnnotationSourceImageIdLookup } from './partImageRefs';

/**
 * Resolves the measurement calibration for an image from project metadata, image records, configuration, and session overrides.
 */
export function useInspectionCalibrationLookup({
  projectConfiguration,
  projectImageLookup,
  projectMetadata,
  sessionCalibrationByImageId,
}) {
  const getCalibrationForImage = useCallback((imageId) => {
    const key = String(imageId || '');
    return resolveMeasurementCalibration(
      projectMetadata,
      projectImageLookup[key],
      projectConfiguration,
      sessionCalibrationByImageId[key],
    );
  }, [projectConfiguration, projectImageLookup, projectMetadata, sessionCalibrationByImageId]);
  return {
    getCalibrationForImage,
  };
}

/**
 * Annotation source-image lookup, session calibration updates, and the calibration requirement check for annotation tools.
 */
export function useInspectionCalibrationActions({
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
}) {
  const { fullscreenBackingImageId, promptFullscreenCalibration, resumeFullscreenMeasure } = fullscreenSession;
  const annotationSourceImageIdLookup = useMemo(
    () => getAnnotationSourceImageIdLookup(selectedPartImageRefs, projectImageLookup),
    [projectImageLookup, selectedPartImageRefs],
  );
  const getAnnotationSourceImageIdForImage = useCallback((imageId) => {
    const key = String(imageId || '');
    return annotationSourceImageIdLookup[key] || key;
  }, [annotationSourceImageIdLookup]);
  const applySessionCalibration = useCallback((imageId, calibration) => {
    if (readOnly) return false;
    if (!imageId || !isValidCalibration(calibration)) return false;
    const key = String(imageId);
    setSessionCalibrationByImageId((prev) => ({ ...prev, [key]: calibration }));
    setProjectMetadata((prev) => ({
      ...(prev && typeof prev === 'object' ? prev : {}),
      calibration_default: prev?.calibration_default || calibration,
    }));
    return true;
  }, [readOnly, setProjectMetadata, setSessionCalibrationByImageId]);

  const handleFullscreenCalibrationChange = useCallback((calibration) => {
    if (!applySessionCalibration(fullscreenBackingImageId, calibration)) return;
    resumeFullscreenMeasure();
  }, [applySessionCalibration, fullscreenBackingImageId, resumeFullscreenMeasure]);

  const handleTileCalibrationChange = useCallback((calibration) => {
    if (!applySessionCalibration(tileCalibrationPromptImageId, calibration)) return;
    setTileCalibrationPromptImageId(null);
  }, [applySessionCalibration, tileCalibrationPromptImageId, setTileCalibrationPromptImageId]);

  const requireCalibrationForAnnotation = useCallback((imageId, { surface = 'tile', toolMode = annotationToolMode } = {}) => {
    if (readOnly) return false;
    if (toolMode === 'crop') return true;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    if (getCalibrationForImage(annotationImageId)) return true;
    if (surface === 'fullscreen') {
      promptFullscreenCalibration();
    } else {
      setTileCalibrationPromptImageId(annotationImageId ? String(annotationImageId) : null);
    }
    return false;
  }, [
    annotationToolMode,
    getAnnotationSourceImageIdForImage,
    getCalibrationForImage,
    promptFullscreenCalibration,
    readOnly,
    setTileCalibrationPromptImageId,
  ]);
  return {
    getAnnotationSourceImageIdForImage,
    handleFullscreenCalibrationChange,
    handleTileCalibrationChange,
    requireCalibrationForAnnotation,
  };
}
