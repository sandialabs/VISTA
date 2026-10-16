import {
  clientPointToSource,
  getContainedContentTransform,
  getContainedImageTransform,
  moveBoxCorner,
  moveLineEndpoint,
  normalizeGeometryToSource,
  safeReleasePointerCapture,
  safeSetPointerCapture,
  scaleGeometryToSourceDimensions,
  sourcePointToClient,
  translateBox,
  translateLine,
} from '../annotationGeometry';

const squareRect = { left: 0, top: 0, width: 400, height: 400 };

describe('annotationGeometry contained-image transforms', () => {
  test('calculates the painted rectangle for a rectangular source in a square element', () => {
    const transform = getContainedImageTransform({
      elementRect: squareRect,
      sourceWidth: 400,
      sourceHeight: 200,
    });

    expect(transform).toEqual(expect.objectContaining({
      sourceWidth: 400,
      sourceHeight: 200,
      scale: 1,
      mirrorX: false,
      mirrorY: false,
    }));
    expect(transform.contentRect).toEqual({
      left: 0,
      top: 100,
      width: 400,
      height: 200,
      right: 400,
      bottom: 300,
    });
    expect(getContainedContentTransform).toBe(getContainedImageTransform);
  });

  test('uses element offsets and a uniform contain scale', () => {
    const transform = getContainedImageTransform({
      elementRect: { left: 25, top: 40, width: 200, height: 400 },
      sourceWidth: 400,
      sourceHeight: 200,
    });
    expect(transform.scale).toBe(0.5);
    expect(transform.contentRect).toEqual({
      left: 25,
      top: 190,
      width: 200,
      height: 100,
      right: 225,
      bottom: 290,
    });
  });

  test('rejects letterbox points by default and can clamp them to the source edge', () => {
    const transform = getContainedImageTransform({
      elementRect: squareRect,
      sourceWidth: 400,
      sourceHeight: 200,
    });
    expect(clientPointToSource(transform, { clientX: 200, clientY: 50 })).toBeNull();
    expect(clientPointToSource(transform, { clientX: 200, clientY: 350 })).toBeNull();
    expect(clientPointToSource(transform, { clientX: 200, clientY: 50 }, { clamp: true })).toEqual({ x: 200, y: 0 });
    expect(clientPointToSource(transform, { clientX: 200, clientY: 350 }, { clamp: true })).toEqual({ x: 200, y: 200 });
    expect(clientPointToSource(transform, { clientX: 200, clientY: 50 }, { rejectOutside: false })).toEqual({ x: 200, y: -50 });
  });

  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('round-trips source points within 0.01 pixels with mirrorX=%s mirrorY=%s', (mirrorX, mirrorY) => {
    const transform = getContainedImageTransform({
      elementRect: { left: 37.5, top: 12.25, width: 475, height: 325 },
      sourceWidth: 400,
      sourceHeight: 200,
      mirrorX,
      mirrorY,
    });
    const points = [
      { x: 0, y: 0 },
      { x: 400, y: 200 },
      { x: 87.125, y: 44.75 },
      { x: 219.8, y: 163.4 },
    ];
    points.forEach((sourcePoint) => {
      const clientPoint = sourcePointToClient(transform, sourcePoint);
      const roundTrip = clientPointToSource(transform, clientPoint);
      expect(Math.abs(roundTrip.x - sourcePoint.x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(roundTrip.y - sourcePoint.y)).toBeLessThanOrEqual(0.01);
    });
  });

  test.each([
    [false, false, { x: 0, y: 0 }],
    [true, false, { x: 400, y: 0 }],
    [false, true, { x: 0, y: 200 }],
    [true, true, { x: 400, y: 200 }],
  ])('inverse-maps the displayed top-left through mirrors', (mirrorX, mirrorY, expected) => {
    const transform = getContainedImageTransform({
      elementRect: squareRect,
      sourceWidth: 400,
      sourceHeight: 200,
      mirrorX,
      mirrorY,
    });
    expect(clientPointToSource(transform, { x: 0, y: 100 })).toEqual(expected);
  });

  test('clamps source points before applying mirrors', () => {
    const transform = getContainedImageTransform({
      elementRect: squareRect,
      sourceWidth: 400,
      sourceHeight: 200,
      mirrorX: true,
      mirrorY: true,
    });
    expect(sourcePointToClient(transform, { x: -20, y: 240 }, { clamp: true })).toEqual({ x: 400, y: 100 });
  });

  test.each([
    [{}],
    [{ elementRect: squareRect, sourceWidth: 0, sourceHeight: 200 }],
    [{ elementRect: squareRect, sourceWidth: 400, sourceHeight: Number.NaN }],
    [{ elementRect: { left: 0, top: 0, width: 0, height: 400 }, sourceWidth: 400, sourceHeight: 200 }],
    [{ elementRect: { left: 'bad', top: 0, width: 400, height: 400 }, sourceWidth: 400, sourceHeight: 200 }],
  ])('rejects invalid transform input %#', (input) => {
    expect(getContainedImageTransform(input)).toBeNull();
  });

  test('rejects invalid point and transform input', () => {
    const transform = getContainedImageTransform({
      elementRect: squareRect,
      sourceWidth: 400,
      sourceHeight: 200,
    });
    expect(clientPointToSource(null, { x: 1, y: 1 })).toBeNull();
    expect(clientPointToSource(transform, { x: Number.NaN, y: 1 })).toBeNull();
    expect(sourcePointToClient(null, { x: 1, y: 1 })).toBeNull();
    expect(sourcePointToClient(transform, { x: 1, y: Infinity })).toBeNull();
    expect(clientPointToSource(transform, { x: null, y: 1 })).toBeNull();
    expect(sourcePointToClient(transform, { x: '', y: 1 })).toBeNull();
  });
});

describe('annotationGeometry pointer capture safety', () => {
  test('sets and releases capture only for usable pointer IDs', () => {
    const element = {
      setPointerCapture: jest.fn(),
      hasPointerCapture: jest.fn(() => true),
      releasePointerCapture: jest.fn(),
    };
    expect(safeSetPointerCapture(element, 7)).toBe(true);
    expect(safeReleasePointerCapture(element, 7)).toBe(true);
    expect(element.setPointerCapture).toHaveBeenCalledWith(7);
    expect(element.hasPointerCapture).toHaveBeenCalledWith(7);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  test.each([undefined, null, -1, 1.5, '3'])('ignores missing or invalid pointer ID %p', (pointerId) => {
    const element = {
      setPointerCapture: jest.fn(),
      releasePointerCapture: jest.fn(),
    };
    expect(safeSetPointerCapture(element, pointerId)).toBe(false);
    expect(safeReleasePointerCapture(element, pointerId)).toBe(false);
    expect(element.setPointerCapture).not.toHaveBeenCalled();
    expect(element.releasePointerCapture).not.toHaveBeenCalled();
  });

  test('returns false when methods are absent or report no active capture', () => {
    expect(safeSetPointerCapture({}, 1)).toBe(false);
    expect(safeReleasePointerCapture({}, 1)).toBe(false);
    const element = {
      hasPointerCapture: jest.fn(() => false),
      releasePointerCapture: jest.fn(),
    };
    expect(safeReleasePointerCapture(element, 1)).toBe(false);
    expect(element.releasePointerCapture).not.toHaveBeenCalled();
  });

  test('contains browser errors from stale pointer IDs', () => {
    const element = {
      setPointerCapture: jest.fn(() => { throw new DOMException('No active pointer', 'NotFoundError'); }),
      hasPointerCapture: jest.fn(() => { throw new DOMException('No active pointer', 'NotFoundError'); }),
      releasePointerCapture: jest.fn(() => { throw new DOMException('No active pointer', 'NotFoundError'); }),
    };
    expect(safeSetPointerCapture(element, 9)).toBe(false);
    expect(safeReleasePointerCapture(element, 9)).toBe(false);
  });
});

describe('annotationGeometry line mutation', () => {
  const line = { x1: 50, y1: 25, x2: 250, y2: 175, imageWidth: 400, imageHeight: 200, color: '#fff' };

  test('moves and clamps either endpoint without mutating the input', () => {
    const start = moveLineEndpoint(line, 'start', { x: -30, y: 260 });
    const end = moveLineEndpoint(line, 'end', { x: 500, y: -40 });
    expect(start).toEqual({ ...line, x1: 0, y1: 200 });
    expect(end).toEqual({ ...line, x2: 400, y2: 0 });
    expect(line).toEqual({ x1: 50, y1: 25, x2: 250, y2: 175, imageWidth: 400, imageHeight: 200, color: '#fff' });
  });

  test('clamps the complete line when resizing legacy out-of-bounds geometry', () => {
    const legacy = { ...line, x1: -10, y1: 250, x2: 450, y2: -10 };
    expect(moveLineEndpoint(legacy, 'start', { x: 100, y: 100 })).toEqual(expect.objectContaining({
      x1: 100,
      y1: 100,
      x2: 400,
      y2: 0,
    }));
  });

  test('translates a line while preserving its vector', () => {
    const moved = translateLine(line, { dx: 30, dy: -20 });
    expect(moved).toEqual({ ...line, x1: 80, y1: 5, x2: 280, y2: 155 });
    expect(moved.x2 - moved.x1).toBe(line.x2 - line.x1);
    expect(moved.y2 - moved.y1).toBe(line.y2 - line.y1);
  });

  test('clamps line translation as a unit at every source boundary', () => {
    expect(translateLine(line, { x: -500, y: -500 })).toEqual({ ...line, x1: 0, y1: 0, x2: 200, y2: 150 });
    expect(translateLine(line, { x: 500, y: 500 })).toEqual({ ...line, x1: 200, y1: 50, x2: 400, y2: 200 });
  });

  test('supports explicit bounds and rejects impossible or invalid lines', () => {
    expect(translateLine({ ...line, imageWidth: undefined, imageHeight: undefined }, { x: 10, y: 10 }, { width: 300, height: 200 })).not.toBeNull();
    expect(translateLine({ ...line, x1: -50, x2: 500 }, { x: 0, y: 0 })).toBeNull();
    expect(translateLine({ ...line, x1: Number.NaN }, { x: 1, y: 1 })).toBeNull();
    expect(translateLine(line, { x: Infinity, y: 1 })).toBeNull();
    expect(moveLineEndpoint(line, 'middle', { x: 1, y: 1 })).toBeNull();
  });
});

describe('annotationGeometry box mutation', () => {
  const box = { x: 50, y: 30, width: 150, height: 80, imageWidth: 400, imageHeight: 200, label: 'box' };

  test.each([
    ['topLeft', { x: 20, y: 10 }, { x: 20, y: 10, width: 180, height: 100 }],
    ['topRight', { x: 260, y: 5 }, { x: 50, y: 5, width: 210, height: 105 }],
    ['bottomLeft', { x: 15, y: 170 }, { x: 15, y: 30, width: 185, height: 140 }],
    ['bottomRight', { x: 280, y: 190 }, { x: 50, y: 30, width: 230, height: 160 }],
  ])('moves the %s corner while preserving the opposite corner', (corner, point, expected) => {
    expect(moveBoxCorner(box, corner, point)).toEqual(expect.objectContaining(expected));
  });

  test('normalizes a corner dragged across its opposite corner and clamps it', () => {
    expect(moveBoxCorner(box, 'topLeft', { x: 500, y: 500 })).toEqual(expect.objectContaining({
      x: 200,
      y: 110,
      width: 200,
      height: 90,
    }));
    expect(moveBoxCorner(box, 'bottomRight', { x: -100, y: -100 })).toEqual(expect.objectContaining({
      x: 0,
      y: 0,
      width: 50,
      height: 30,
    }));
  });

  test('translates a box without resizing it', () => {
    const moved = translateBox(box, { x: 80, y: 50 });
    expect(moved).toEqual({ ...box, x: 130, y: 80 });
    expect(moved.width).toBe(box.width);
    expect(moved.height).toBe(box.height);
  });

  test('clamps box translation at every edge', () => {
    expect(translateBox(box, { x: -500, y: -500 })).toEqual({ ...box, x: 0, y: 0 });
    expect(translateBox(box, { x: 500, y: 500 })).toEqual({ ...box, x: 250, y: 120 });
  });

  test('rejects invalid bounds, corners, points, and oversized boxes', () => {
    expect(translateBox({ ...box, width: 500 }, { x: 0, y: 0 })).toBeNull();
    expect(translateBox({ ...box, height: -1 }, { x: 0, y: 0 })).toBeNull();
    expect(translateBox(box, { x: Number.NaN, y: 0 })).toBeNull();
    expect(moveBoxCorner(box, 'center', { x: 1, y: 1 })).toBeNull();
    expect(moveBoxCorner(box, 'topLeft', { x: 200, y: 110 })).toBeNull();
    expect(moveBoxCorner(box, 'topLeft', { x: Infinity, y: 1 })).toBeNull();
    expect(moveBoxCorner({ ...box, imageWidth: 0 }, 'topLeft', { x: 1, y: 1 })).toBeNull();
  });
});

describe('annotationGeometry source-dimension scaling', () => {
  test('scales direct line geometry into current source dimensions', () => {
    const line = { x1: 25, y1: 20, x2: 100, y2: 80, imageWidth: 200, imageHeight: 100, axis: 'axial' };
    expect(scaleGeometryToSourceDimensions(line, 400, 200)).toEqual({
      x1: 50,
      y1: 40,
      x2: 200,
      y2: 160,
      imageWidth: 400,
      imageHeight: 200,
      axis: 'axial',
    });
  });

  test('scales direct box geometry non-uniformly and preserves extra fields', () => {
    const box = { x: 20, y: 10, width: 60, height: 30, imageWidth: 100, imageHeight: 50, sliceIndex: 12 };
    expect(normalizeGeometryToSource(box, { width: 400, height: 200 })).toEqual({
      x: 80,
      y: 40,
      width: 240,
      height: 120,
      imageWidth: 400,
      imageHeight: 200,
      sliceIndex: 12,
    });
  });

  test('scales nested annotation geometry using child or outer source dimensions', () => {
    const geometry = {
      imageWidth: 200,
      imageHeight: 100,
      axis: 'coronal',
      slice_index: 8,
      line: { x1: 10, y1: 20, x2: 50, y2: 60 },
      box: { x: 20, y: 10, width: 80, height: 40, imageWidth: 100, imageHeight: 50 },
      bbox: { x: 5, y: 5, width: 20, height: 10 },
    };
    const scaled = scaleGeometryToSourceDimensions(geometry, { imageWidth: 400, imageHeight: 200 });
    expect(scaled).toEqual(expect.objectContaining({
      imageWidth: 400,
      imageHeight: 200,
      axis: 'coronal',
      slice_index: 8,
      line: expect.objectContaining({ x1: 20, y1: 40, x2: 100, y2: 120, imageWidth: 400, imageHeight: 200 }),
      box: expect.objectContaining({ x: 80, y: 40, width: 320, height: 160, imageWidth: 400, imageHeight: 200 }),
      bbox: expect.objectContaining({ x: 10, y: 10, width: 40, height: 20, imageWidth: 400, imageHeight: 200 }),
    }));
  });

  test('does not mutate source geometry', () => {
    const line = { x1: 1, y1: 2, x2: 3, y2: 4, imageWidth: 10, imageHeight: 10 };
    const snapshot = JSON.parse(JSON.stringify(line));
    scaleGeometryToSourceDimensions(line, 20, 20);
    expect(line).toEqual(snapshot);
  });

  test.each([
    [null, 400, 200],
    [{}, 400, 200],
    [{ x1: 0, y1: 0, x2: Number.NaN, y2: 2, imageWidth: 10, imageHeight: 10 }, 400, 200],
    [{ x: 0, y: 0, width: 2, height: 2, imageWidth: 0, imageHeight: 10 }, 400, 200],
    [{ x: 0, y: 0, width: 2, height: 2, imageWidth: 10, imageHeight: 10 }, 0, 200],
  ])('rejects invalid scaling input %#', (geometry, width, height) => {
    expect(scaleGeometryToSourceDimensions(geometry, width, height)).toBeNull();
  });
});
