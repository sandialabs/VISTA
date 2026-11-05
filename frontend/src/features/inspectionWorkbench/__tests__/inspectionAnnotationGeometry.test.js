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

  test('projects controls into a non-square design frame', () => {
    const frame = { width: 500, height: 1000, scale: 1 };
    const line = { x1: 10, y1: 20, x2: 90, y2: 80, imageWidth: 100, imageHeight: 100 };
    expect(getMeasurementEndpointViewBoxPosition(line, frame)).toEqual({
      start: { x: 50, y: 200 },
      end: { x: 450, y: 800 },
    });
    expect(getMeasurementLabelViewBoxPosition({ ...line, x1: 99, x2: 99 }, 20, frame).x).toBe(480);
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
