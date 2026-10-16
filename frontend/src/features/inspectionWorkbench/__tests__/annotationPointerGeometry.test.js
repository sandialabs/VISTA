import {
  computeDraggedGeometry,
  getLineLengthPx,
  hasDraggedGeometryChanged,
  scalePointToGeometrySpace,
} from '../annotationPointerGeometry';

describe('scalePointToGeometrySpace', () => {
  test('rescales surface pixels into the saved geometry space', () => {
    expect(scalePointToGeometrySpace({ x: 50, y: 20 }, 100, 50, { imageWidth: 400, imageHeight: 200 }))
      .toEqual({ x: 200, y: 80 });
  });

  test('accepts numeric strings for sizes', () => {
    expect(scalePointToGeometrySpace({ x: 10, y: 10 }, '20', '20', { imageWidth: '40', imageHeight: '40' }))
      .toEqual({ x: 20, y: 20 });
  });

  test.each([
    [null, 100, 100, { imageWidth: 10, imageHeight: 10 }],
    [{ x: 1, y: 1 }, 0, 100, { imageWidth: 10, imageHeight: 10 }],
    [{ x: 1, y: 1 }, 100, Number.NaN, { imageWidth: 10, imageHeight: 10 }],
    [{ x: 1, y: 1 }, 100, 100, { imageWidth: 0, imageHeight: 10 }],
    [{ x: 1, y: 1 }, 100, 100, { imageWidth: 10 }],
    [{ x: 1, y: 1 }, 100, 100, null],
  ])('rejects missing or non-positive dimensions (%#)', (point, width, height, geometry) => {
    expect(scalePointToGeometrySpace(point, width, height, geometry)).toBeNull();
  });
});

describe('computeDraggedGeometry', () => {
  const line = { id: 'l', x1: 10, y1: 10, x2: 50, y2: 30, imageWidth: 100, imageHeight: 100 };
  const box = { id: 'b', x: 10, y: 10, width: 20, height: 20, imageWidth: 100, imageHeight: 100 };

  test('translates a line by the pointer delta', () => {
    const drag = { kind: 'line', operation: 'translate', source: line, startPoint: { x: 20, y: 20 } };
    expect(computeDraggedGeometry(drag, { x: 25, y: 30 })).toEqual(expect.objectContaining({
      x1: 15, y1: 20, x2: 55, y2: 40,
    }));
  });

  test('clamps a translated line inside the image bounds', () => {
    const drag = { kind: 'line', operation: 'translate', source: line, startPoint: { x: 0, y: 0 } };
    const moved = computeDraggedGeometry(drag, { x: 90, y: 0 });
    expect(Math.max(moved.x1, moved.x2)).toBeLessThanOrEqual(100);
    expect(moved.x2 - moved.x1).toBe(40);
  });

  test('moves a line endpoint to the pointer', () => {
    const drag = { kind: 'line', operation: 'end', source: line, startPoint: { x: 50, y: 30 } };
    expect(computeDraggedGeometry(drag, { x: 70, y: 60 })).toEqual(expect.objectContaining({
      x1: 10, y1: 10, x2: 70, y2: 60,
    }));
  });

  test('translates a box and resizes it from a corner', () => {
    const translate = { kind: 'box', operation: 'translate', source: box, startPoint: { x: 15, y: 15 } };
    expect(computeDraggedGeometry(translate, { x: 25, y: 20 })).toEqual(expect.objectContaining({
      x: 20, y: 15, width: 20, height: 20,
    }));
    const corner = { kind: 'box', operation: 'bottomRight', source: box, startPoint: { x: 30, y: 30 } };
    expect(computeDraggedGeometry(corner, { x: 50, y: 40 })).toEqual(expect.objectContaining({
      x: 10, y: 10, width: 40, height: 30,
    }));
  });

  test('returns null for unknown kinds', () => {
    expect(computeDraggedGeometry({ kind: 'cube', operation: 'translate', source: box, startPoint: { x: 0, y: 0 } }, { x: 1, y: 1 }))
      .toBeNull();
  });
});

describe('drag commit helpers', () => {
  test('measures line length in pixels', () => {
    expect(getLineLengthPx({ x1: 0, y1: 0, x2: 3, y2: 4 })).toBe(5);
  });

  test('detects changed line and box geometry by numeric comparison', () => {
    const source = { x1: 1, y1: 2, x2: 3, y2: 4, x: 1, y: 2, width: 3, height: 4 };
    expect(hasDraggedGeometryChanged({ kind: 'line', geometry: { x1: '1', y1: 2, x2: 3, y2: 4 } }, source)).toBe(false);
    expect(hasDraggedGeometryChanged({ kind: 'line', geometry: { x1: 1, y1: 2, x2: 3, y2: 5 } }, source)).toBe(true);
    expect(hasDraggedGeometryChanged({ kind: 'box', geometry: { x: 1, y: 2, width: 3, height: 4 } }, source)).toBe(false);
    expect(hasDraggedGeometryChanged({ kind: 'box', geometry: { x: 1, y: 2, width: 9, height: 4 } }, source)).toBe(true);
  });
});
