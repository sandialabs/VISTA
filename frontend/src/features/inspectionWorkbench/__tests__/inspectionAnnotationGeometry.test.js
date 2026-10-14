import {
  formatCropCoordinate,
  getAnnotationBoxCornerPoints,
  getAnnotationBoxCornerViewBoxPosition,
  getAnnotationBoxHeightLabel,
  getAnnotationBoxOppositeCornerName,
  getAnnotationBoxWidthLabel,
  getAnnotationCropBox,
  getCropImageTitle,
  getCropUploadFilename,
  getMeasurementEndpointViewBoxPosition,
  getMeasurementLabelViewBoxPosition,
  getMeasurementLineLabel,
  getMeasurementLineWithDerivedLength,
  getTextCounterScaleTransform,
  isBoundingBoxAnnotation,
  isFiniteAnnotationBox,
  isFiniteMeasurementLine,
  makeBoxFromMovedCorner,
  makeBoxFromPoints,
  makeMprCubeVertices,
  sanitizeCropFilename,
} from '../inspectionAnnotationGeometry';

describe('inspection annotation geometry helpers', () => {
  test('validates finite measurement lines and boxes', () => {
    expect(isFiniteMeasurementLine({ x1: 1, y1: 2, x2: 4, y2: 6, imageWidth: 10, imageHeight: 20 })).toBe(true);
    expect(isFiniteMeasurementLine({ x1: 1, y1: 2, x2: 'bad', y2: 6, imageWidth: 10, imageHeight: 20 })).toBe(false);
    expect(isFiniteAnnotationBox({ x: 1, y: 2, width: 3, height: 4, imageWidth: 10, imageHeight: 20 })).toBe(true);
    expect(isFiniteAnnotationBox({ x: 1, y: 2, width: 0, height: 4, imageWidth: 10, imageHeight: 20 })).toBe(false);
  });

  test('formats measurement and box labels', () => {
    expect(getMeasurementLineLabel({ distanceMm: 2.345 })).toBe('2.35 mm');
    expect(getMeasurementLineLabel({ x1: 0, y1: 0, x2: 3, y2: 4, imageWidth: 10, imageHeight: 10 })).toBe('5.0 px');
    expect(getAnnotationBoxWidthLabel({ widthMm: 1.234, width: 12 })).toBe('Width 1.23 mm');
    expect(getAnnotationBoxHeightLabel({ height: 7.89 })).toBe('Height 7.9 px');
  });

  test('normalizes crop boxes and crop filenames', () => {
    const annotation = {
      bbox: { x: 12.345, y: 8, width: 20, height: 10, imageWidth: 100, imageHeight: 80 },
    };
    expect(isBoundingBoxAnnotation(annotation)).toBe(true);
    expect(getAnnotationCropBox(annotation)).toEqual({
      x: 12.345,
      y: 8,
      width: 20,
      height: 10,
      imageWidth: 100,
      imageHeight: 80,
    });
    expect(formatCropCoordinate(12.345)).toBe('12.35');
    expect(sanitizeCropFilename('bad/name: value')).toBe('bad-name- value');
    expect(getCropImageTitle(annotation, 'parent.png')).toBe('Child of parent.png');
    expect(getCropUploadFilename(annotation, 'parent/name.png')).toBe('12.35_8_child of parent-name.png.png');
  });

  test('projects measurement and box controls into a 1000 viewBox', () => {
    const line = { x1: 10, y1: 20, x2: 90, y2: 80, imageWidth: 100, imageHeight: 100 };
    expect(getMeasurementEndpointViewBoxPosition(line)).toEqual({
      start: { x: 100, y: 200 },
      end: { x: 900, y: 800 },
    });
    expect(getMeasurementLabelViewBoxPosition(line, 20)).toEqual({ x: 500, y: 494 });
    expect(getAnnotationBoxCornerViewBoxPosition({ x: 10, y: 20, width: 30, height: 40, imageWidth: 100, imageHeight: 200 })).toEqual({
      topLeft: { x: 100, y: 100 },
      topRight: { x: 400, y: 100 },
      bottomLeft: { x: 100, y: 300 },
      bottomRight: { x: 400, y: 300 },
    });
  });

  test('builds boxes from points and moved corners', () => {
    const box = makeBoxFromPoints(
      { x: 30, y: 5, imageWidth: 100, imageHeight: 80 },
      { x: 10, y: 25, imageWidth: 100, imageHeight: 80 },
    );
    expect(box).toEqual({ x: 10, y: 5, width: 20, height: 20, imageWidth: 100, imageHeight: 80 });
    expect(getAnnotationBoxCornerPoints(box).bottomRight).toEqual({ x: 30, y: 25 });
    expect(getAnnotationBoxOppositeCornerName('topLeft')).toBe('bottomRight');
    expect(makeBoxFromMovedCorner(box, 'topLeft', { x: 15, y: 10 })).toEqual({
      x: 15,
      y: 10,
      width: 15,
      height: 15,
      imageWidth: 100,
      imageHeight: 80,
    });
  });

  test('counter-scales text to its native aspect ratio without moving its anchor', () => {
    // Square image: ambient scale(1, 1) in the 1000-unit viewBox, so no correction is needed.
    expect(getTextCounterScaleTransform(500, 500, 1000, 1000)).toBe(
      'translate(500 500) scale(1 1) translate(-500 -500)',
    );
    // Wide image: ambient scale(2, 1) would stretch glyphs horizontally; the correction
    // narrows them back by the same factor the geometric mean needs to cancel the distortion,
    // and leaves (x, y) fixed so the anchor point stays pixel-perfect.
    const wide = getTextCounterScaleTransform(400, 300, 2000, 1000);
    expect(wide).toBe('translate(400 300) scale(0.7071067811865476 1.4142135623730951) translate(-400 -300)');
    // Tall image: ambient scale(1, 2) would stretch glyphs vertically.
    const tall = getTextCounterScaleTransform(400, 300, 1000, 2000);
    expect(tall).toBe('translate(400 300) scale(1.4142135623730951 0.7071067811865476) translate(-400 -300)');
    // A rotation composes after the counter-scale, pivoting on the same fixed anchor.
    expect(getTextCounterScaleTransform(400, 300, 2000, 1000, 90)).toBe(
      'translate(400 300) scale(0.7071067811865476 1.4142135623730951) translate(-400 -300) rotate(90 400 300)',
    );
  });

  test('derives calibrated line lengths and MPR cube vertices', () => {
    expect(getMeasurementLineWithDerivedLength(
      { x1: 0, y1: 0, x2: 6, y2: 8, imageWidth: 100, imageHeight: 100 },
      'image-1',
      { pixels_per_mm: 2 },
    )).toMatchObject({ imageId: 'image-1', distancePx: 10, distanceMm: 5 });
    expect(makeMprCubeVertices(
      'sagittal',
      { x: 1.234, y: 2, width: 4, height: 5, sliceIndex: 3 },
      { x: 2, y: 1, width: 6, height: 3, sliceIndex: 7 },
    )).toEqual([
      { x: 3, y: 1.23, z: 1 },
      { x: 3, y: 8, z: 1 },
      { x: 3, y: 8, z: 7 },
      { x: 3, y: 1.23, z: 7 },
      { x: 7, y: 1.23, z: 1 },
      { x: 7, y: 8, z: 1 },
      { x: 7, y: 8, z: 7 },
      { x: 7, y: 1.23, z: 7 },
    ]);
  });
});
