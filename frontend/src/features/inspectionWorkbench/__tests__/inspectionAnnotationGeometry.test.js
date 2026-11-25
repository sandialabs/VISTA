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
    const label = getMeasurementLabelViewBoxPosition(line, 20);
    // A down-right line puts the label above and to the right of its midpoint.
    expect(label.box.left).toBeGreaterThan(500);
    expect(label.box.bottom).toBeLessThan(500);
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
    // A vertical line at the right edge flips its label to the left side and stays in the frame.
    const label = getMeasurementLabelViewBoxPosition({ ...line, x1: 99, x2: 99 }, 20, frame, '12.34 mm');
    expect(label.box.right).toBeLessThanOrEqual(frame.width);
    expect(label.box.right).toBeLessThan(495);
    expect(label.textAnchor).toBe('end');
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

  describe('measurement label clearance', () => {
    const segmentHitsRect = (p1, p2, rect) => {
      for (let step = 0; step <= 400; step += 1) {
        const t = step / 400;
        const x = p1.x + ((p2.x - p1.x) * t);
        const y = p1.y + ((p2.y - p1.y) * t);
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
      }
      return false;
    };
    const lineAt = (angleDegrees, cx, cy, half) => {
      const radians = (angleDegrees * Math.PI) / 180;
      return {
        x1: cx - (Math.cos(radians) * half),
        y1: cy - (Math.sin(radians) * half),
        x2: cx + (Math.cos(radians) * half),
        y2: cy + (Math.sin(radians) * half),
        imageWidth: 1000,
        imageHeight: 1000,
      };
    };

    test.each(Array.from({ length: 24 }, (_, index) => index * 15))('the label never overlaps a %i degree line', (angle) => {
      [20, 30].forEach((fontSize) => {
        const line = lineAt(angle, 500, 500, 150);
        const label = getMeasurementLabelViewBoxPosition(line, fontSize, undefined, '123.45 mm');
        expect(segmentHitsRect({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, label.box)).toBe(false);
        expect(['start', 'middle', 'end']).toContain(label.textAnchor);
      });
    });

    test('a line angled up and to the right gets its label clear of the line', () => {
      const line = { x1: 200, y1: 800, x2: 800, y2: 200, imageWidth: 1000, imageHeight: 1000 };
      const label = getMeasurementLabelViewBoxPosition(line, 20, undefined, '84.85 mm');
      expect(segmentHitsRect({ x: 200, y: 800 }, { x: 800, y: 200 }, label.box)).toBe(false);
      // Placed on the upper-left side of the line, anchored at the edge nearest the line.
      expect(label.textAnchor).toBe('end');
      expect(label.box.bottom).toBeLessThan(500);
    });

    test.each([
      ['top edge', { x1: 100, y1: 2, x2: 900, y2: 2 }],
      ['bottom edge', { x1: 100, y1: 998, x2: 900, y2: 998 }],
      ['left edge', { x1: 2, y1: 100, x2: 2, y2: 900 }],
      ['right edge', { x1: 998, y1: 100, x2: 998, y2: 900 }],
      ['top-right corner', { x1: 700, y1: 300, x2: 998, y2: 2 }],
    ])('keeps the label inside the frame and off a line on the %s', (_name, coords) => {
      const line = { ...coords, imageWidth: 1000, imageHeight: 1000 };
      const label = getMeasurementLabelViewBoxPosition(line, 20, undefined, '40.00 mm');
      expect(label.box.left).toBeGreaterThanOrEqual(0);
      expect(label.box.top).toBeGreaterThanOrEqual(0);
      expect(label.box.right).toBeLessThanOrEqual(1000);
      expect(label.box.bottom).toBeLessThanOrEqual(1000);
      expect(segmentHitsRect({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, label.box)).toBe(false);
    });

    test('handles a zero-length line', () => {
      const label = getMeasurementLabelViewBoxPosition({ x1: 500, y1: 500, x2: 500, y2: 500, imageWidth: 1000, imageHeight: 1000 }, 20);
      expect(Number.isFinite(label.x)).toBe(true);
      expect(Number.isFinite(label.y)).toBe(true);
      expect(label.box.bottom).toBeLessThan(500);
    });
  });
});
