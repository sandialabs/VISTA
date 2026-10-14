export const MM_PER_INCH = 25.4;
export const CALIBRATION_RELATIVE_TOLERANCE = 1e-9;

export function areCalibrationScalesConsistent(pixelsPerMm, pixelsPerInch) {
  if (
    typeof pixelsPerMm !== 'number'
    || !Number.isFinite(pixelsPerMm)
    || pixelsPerMm <= 0
    || typeof pixelsPerInch !== 'number'
    || !Number.isFinite(pixelsPerInch)
    || pixelsPerInch <= 0
  ) {
    return false;
  }
  const expectedPixelsPerInch = pixelsPerMm * MM_PER_INCH;
  if (!Number.isFinite(expectedPixelsPerInch) || expectedPixelsPerInch <= 0) {
    return false;
  }
  return Math.abs(pixelsPerInch - expectedPixelsPerInch)
    <= CALIBRATION_RELATIVE_TOLERANCE * Math.max(
      Math.abs(pixelsPerInch),
      Math.abs(expectedPixelsPerInch),
    );
}

export function isValidCalibration(calibration) {
  const pixelsPerMm = Number(calibration?.pixels_per_mm);
  if (!Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0) return false;
  if (calibration?.pixels_per_inch === undefined || calibration?.pixels_per_inch === null) {
    return true;
  }
  return areCalibrationScalesConsistent(
    pixelsPerMm,
    calibration.pixels_per_inch,
  );
}

export function isValidProjectCalibration(calibration) {
  return areCalibrationScalesConsistent(
    calibration?.pixels_per_mm,
    calibration?.pixels_per_inch,
  );
}

export function getImageMetadata(image) {
  return (image?.metadata && typeof image.metadata === 'object')
    ? image.metadata
    : (image?.metadata_ && typeof image.metadata_ === 'object')
      ? image.metadata_
      : {};
}

export function resolveMeasurementCalibration(
  projectMetadata,
  image,
  projectConfiguration,
  sessionCalibration,
) {
  if (isValidCalibration(sessionCalibration)) return sessionCalibration;

  const imageMetadata = getImageMetadata(image);
  if (isValidCalibration(imageMetadata.calibration_override)) {
    return imageMetadata.calibration_override;
  }

  const rules = Array.isArray(projectMetadata?.calibration_rules)
    ? projectMetadata.calibration_rules
    : [];
  const matchingRule = rules.find((rule) => (
    rule?.metadata_key
    && rule?.metadata_value !== undefined
    && isValidCalibration(rule?.calibration)
    && imageMetadata[rule.metadata_key] !== undefined
    && String(imageMetadata[rule.metadata_key]) === String(rule.metadata_value)
  ));
  if (matchingRule) return matchingRule.calibration;

  if (isValidProjectCalibration(projectConfiguration?.calibration)) {
    return projectConfiguration.calibration;
  }
  if (isValidCalibration(projectMetadata?.calibration_default)) {
    return projectMetadata.calibration_default;
  }
  return null;
}
