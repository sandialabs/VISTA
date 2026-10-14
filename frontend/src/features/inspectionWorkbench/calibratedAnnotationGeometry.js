import { isFiniteAnnotationBox } from './inspectionAnnotationGeometry';

// Builds calibration-aware geometry helpers for an image ID. Lengths are null
// and boxes are returned unchanged when the source image has no calibration.
export const createCalibratedAnnotationGeometry = ({
  getAnnotationSourceImageIdForImage,
  getCalibrationForImage,
}) => {
  const getPixelsPerMm = (imageId) => Number(
    getCalibrationForImage(getAnnotationSourceImageIdForImage(imageId))?.pixels_per_mm || 0,
  );
  const getLineDistanceMm = (line, imageId) => {
    const pixelsPerMm = getPixelsPerMm(imageId);
    const distancePx = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    return pixelsPerMm > 0 ? distancePx / pixelsPerMm : null;
  };
  const getBoxWithDerivedDimensions = (box, imageId) => {
    if (!isFiniteAnnotationBox(box)) return box;
    const pixelsPerMm = getPixelsPerMm(imageId);
    if (pixelsPerMm <= 0) return box;
    const widthMm = Number.isFinite(Number(box.widthMm)) ? Number(box.widthMm) : Number(box.width) / pixelsPerMm;
    const heightMm = Number.isFinite(Number(box.heightMm)) ? Number(box.heightMm) : Number(box.height) / pixelsPerMm;
    return { ...box, widthMm, heightMm };
  };
  const getUnitForImage = (imageId) => (
    getCalibrationForImage(getAnnotationSourceImageIdForImage(imageId))?.unit === 'inches' ? 'inches' : 'mm'
  );
  return { getBoxWithDerivedDimensions, getLineDistanceMm, getUnitForImage };
};
