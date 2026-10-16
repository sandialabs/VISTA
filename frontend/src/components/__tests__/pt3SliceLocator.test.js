import {
  buildPt3SliceLocatorGeometry,
  drawPt3SliceLocator,
  PT3_SLICE_LOCATOR_AXES,
} from '../pt3SliceLocator';

const metadata = {
  dimensions: [300, 550, 200],
  spacing: [0.2, 0.1, 0.4],
  origin: [4, -2, 10],
};

function createDrawingContext() {
  const strokes = [];
  const fills = [];
  const ctx = {
    canvas: { width: 800, height: 600 },
    globalAlpha: 1,
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    stroke: jest.fn(() => strokes.push({
      alpha: ctx.globalAlpha,
      lineWidth: ctx.lineWidth,
      style: ctx.strokeStyle,
    })),
    fill: jest.fn(() => fills.push({ alpha: ctx.globalAlpha, style: ctx.fillStyle })),
    arc: jest.fn(),
    fillRect: jest.fn(),
    fillText: jest.fn(),
  };
  return { ctx, fills, strokes };
}

test('builds three colored planes, three intersection axes, and zero-based MPR readouts', () => {
  const geometry = buildPt3SliceLocatorGeometry({
    metadata,
    width: 800,
    height: 600,
    rotation: { x: -22, y: 32 },
    zoom: 1.4,
    mirrorScale: { x: -1, y: 1, z: -1 },
    slicePosition: { axial: 99, coronal: 274, sagittal: 149 },
    activeSliceAxis: 'axial',
  });

  expect(geometry.positions).toEqual({ axial: 99, coronal: 274, sagittal: 149 });
  expect(geometry.readouts).toEqual({
    axial: 'Z 99 / 199',
    coronal: 'Y 274 / 549',
    sagittal: 'X 149 / 299',
  });
  expect(geometry.activePlaneLabel).toBe('XY • Z 99 / 199');
  expect(geometry.planes).toHaveLength(3);
  expect(geometry.planes.find(({ active }) => active)).toMatchObject({
    axis: 'axial',
    color: PT3_SLICE_LOCATOR_AXES.axial.color,
  });
  expect(geometry.intersectionLines.map(({ axis, color }) => [axis, color])).toEqual([
    ['sagittal', '#10b981'],
    ['coronal', '#f59e0b'],
    ['axial', '#3b82f6'],
  ]);
  [...geometry.planes.flatMap(({ points }) => points),
    ...geometry.intersectionLines.flatMap(({ points }) => points),
    geometry.center].forEach((point) => {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(Number.isFinite(point.depth)).toBe(true);
  });
});

test('clamps malformed slice and volume inputs to finite degenerate geometry', () => {
  const geometry = buildPt3SliceLocatorGeometry({
    metadata: {
      dimensions: [0, Number.NaN, -20],
      spacing: [0, Number.POSITIVE_INFINITY, -4],
      direction: [Number.NaN],
    },
    width: Number.NaN,
    height: Number.POSITIVE_INFINITY,
    rotation: { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
    zoom: -100,
    mirrorScale: { x: Number.NaN, y: 0, z: -10 },
    slicePosition: { axial: 9000, coronal: -50, sagittal: 'invalid' },
    activeSliceAxis: 'unknown',
  });

  expect(geometry.width).toBe(1);
  expect(geometry.height).toBe(1);
  expect(geometry.metadata.dimensions).toEqual([1, 1, 1]);
  expect(geometry.positions).toEqual({ axial: 0, coronal: 0, sagittal: 0 });
  expect(geometry.activeAxis).toBe('axial');
  expect(geometry.activePlaneLabel).toBe('XY • Z 0 / 0');
  geometry.planes.flatMap(({ points }) => points).forEach((point) => {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  expect(buildPt3SliceLocatorGeometry({ metadata: null }).activePlaneLabel).toBe('XY • Z 0 / 0');
});

test.each([
  [{ x: 90, y: 90 }, { x: 1, y: 1, z: 1 }],
  [{ x: -90, y: 180 }, { x: -1, y: -1, z: -1 }],
  [{ x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY }, { x: -1, y: 1, z: -1 }],
])('keeps edge-on, mirrored, and non-finite rotations finite', (rotation, mirrorScale) => {
  const geometry = buildPt3SliceLocatorGeometry({
    metadata,
    width: 640,
    height: 360,
    rotation,
    mirrorScale,
    slicePosition: { axial: 199, coronal: 0, sagittal: 299 },
  });
  const points = [
    ...geometry.planes.flatMap(({ points: planePoints }) => planePoints),
    ...geometry.intersectionLines.flatMap(({ points: linePoints }) => linePoints),
    geometry.center,
  ];
  points.forEach((point) => {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(Number.isFinite(point.depth)).toBe(true);
  });
});

test('draws unlabeled half-width planes and 50%-transparent half-width crosshairs', () => {
  const { ctx, fills, strokes } = createDrawingContext();

  const geometry = drawPt3SliceLocator(ctx, {
    metadata,
    width: 800,
    height: 600,
    slicePosition: { axial: 99, coronal: 274, sagittal: 149 },
    activeSliceAxis: 'coronal',
  });

  expect(geometry.activePlaneLabel).toBe('XZ • Y 274 / 549');
  expect(strokes).toHaveLength(12);
  expect(strokes.slice(0, 6).map(({ alpha }) => alpha)).toEqual(Array(6).fill(1));
  expect(strokes.slice(6).map(({ alpha }) => alpha)).toEqual(Array(6).fill(0.5));
  expect(strokes.slice(0, 6).map(({ lineWidth }) => lineWidth)).toEqual([
    2.125, 0.625,
    2.75, 1.25,
    2.125, 0.625,
  ]);
  expect(strokes.slice(6).map(({ lineWidth }) => lineWidth)).toEqual([
    2.75, 1.25,
    2.75, 1.25,
    2.75, 1.25,
  ]);
  expect(ctx.fill).toHaveBeenCalledTimes(3);
  expect(fills.map(({ alpha }) => alpha)).toEqual([1, 0.5, 0.5]);
  expect(ctx.arc).toHaveBeenCalledTimes(2);
  expect(ctx.fillRect).not.toHaveBeenCalled();
  expect(ctx.fillText).not.toHaveBeenCalled();
  expect(ctx.save).toHaveBeenCalledTimes(1);
  expect(ctx.restore).toHaveBeenCalledTimes(1);
});

test('applies independently configured 3D plane and crosshair appearance', () => {
  const { ctx, fills, strokes } = createDrawingContext();

  drawPt3SliceLocator(ctx, {
    metadata,
    width: 800,
    height: 600,
    slicePosition: { axial: 99, coronal: 274, sagittal: 149 },
    activeSliceAxis: 'coronal',
    guideSettings: {
      crosshair_transparency_percent: 75,
      crosshair_line_width_px: 4,
      plane_outline_transparency_percent: 40,
      plane_outline_line_width_px: 3,
    },
  });

  expect(strokes.slice(0, 6).map(({ alpha }) => alpha)).toEqual(Array(6).fill(0.6));
  expect(strokes.slice(0, 6).map(({ lineWidth }) => lineWidth)).toEqual([
    3, 1.5,
    4.5, 3,
    3, 1.5,
  ]);
  expect(strokes.slice(6).map(({ alpha }) => alpha)).toEqual(Array(6).fill(0.25));
  expect(strokes.slice(6).map(({ lineWidth }) => lineWidth)).toEqual([
    5.5, 4,
    5.5, 4,
    5.5, 4,
  ]);
  expect(fills.map(({ alpha }) => alpha)).toEqual([1, 0.25, 0.25]);
});
