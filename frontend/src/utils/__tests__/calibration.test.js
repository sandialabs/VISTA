import {
  areCalibrationScalesConsistent,
  isValidCalibration,
  isValidProjectCalibration,
  resolveMeasurementCalibration,
} from '../calibration';

const calibration = (source, pixelsPerMm) => ({
  source,
  pixels_per_mm: pixelsPerMm,
  pixels_per_inch: pixelsPerMm * 25.4,
  unit: 'mm',
});

describe('measurement calibration resolution', () => {
  const session = calibration('session', 50);
  const imageOverride = calibration('image override', 40);
  const metadataRule = calibration('metadata rule', 30);
  const projectConfig = calibration('project config', 20);
  const legacyDefault = calibration('legacy metadata default', 10);
  const image = {
    metadata: {
      camera: 'macro-a',
      calibration_override: imageOverride,
    },
  };
  const projectMetadata = {
    calibration_rules: [{
      metadata_key: 'camera',
      metadata_value: 'macro-a',
      calibration: metadataRule,
    }],
    calibration_default: legacyDefault,
  };

  test.each([
    ['session calibration', session, image, projectMetadata, projectConfig, session],
    ['image override', null, image, projectMetadata, projectConfig, imageOverride],
    [
      'matching metadata rule',
      null,
      { metadata: { camera: 'macro-a' } },
      projectMetadata,
      projectConfig,
      metadataRule,
    ],
    [
      'project configuration',
      null,
      { metadata: {} },
      projectMetadata,
      projectConfig,
      projectConfig,
    ],
    [
      'legacy project metadata default',
      null,
      { metadata: {} },
      projectMetadata,
      null,
      legacyDefault,
    ],
    ['no calibration', null, { metadata: {} }, {}, null, null],
  ])(
    'selects %s at the documented precedence',
    (_label, activeSession, activeImage, metadata, configCalibration, expected) => {
      expect(resolveMeasurementCalibration(
        metadata,
        activeImage,
        { calibration: configCalibration },
        activeSession,
      )).toBe(expected);
    },
  );

  test('skips malformed higher-precedence calibration values', () => {
    const invalid = { pixels_per_mm: Number.NaN };
    expect(isValidCalibration(invalid)).toBe(false);
    expect(resolveMeasurementCalibration(
      { calibration_default: legacyDefault },
      { metadata: { calibration_override: invalid } },
      { calibration: projectConfig },
      invalid,
    )).toBe(projectConfig);
  });

  test('requires millimeter and inch scales to describe the same calibration', () => {
    expect(areCalibrationScalesConsistent(10, 254)).toBe(true);
    expect(areCalibrationScalesConsistent(10, 254.0000001)).toBe(true);
    expect(areCalibrationScalesConsistent(10, 255)).toBe(false);
    expect(isValidCalibration({
      pixels_per_mm: 10,
      pixels_per_inch: 255,
    })).toBe(false);
    expect(isValidProjectCalibration({
      pixels_per_mm: 10,
      pixels_per_inch: 255,
    })).toBe(false);
    expect(isValidProjectCalibration({
      pixels_per_mm: 1e308,
      pixels_per_inch: 1e308,
    })).toBe(false);
  });

  test('keeps one-field legacy metadata calibration backward compatible', () => {
    const legacyOneFieldCalibration = { pixels_per_mm: 8 };
    expect(isValidCalibration(legacyOneFieldCalibration)).toBe(true);
    expect(isValidProjectCalibration(legacyOneFieldCalibration)).toBe(false);
    expect(resolveMeasurementCalibration(
      { calibration_default: legacyOneFieldCalibration },
      { metadata: {} },
      {},
      null,
    )).toBe(legacyOneFieldCalibration);
  });
});
