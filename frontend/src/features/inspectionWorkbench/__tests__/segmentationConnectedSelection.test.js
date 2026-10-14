import {
  buildConnectedSliceSelection,
  makeConnectedVolumeSelection,
  pickMlRegionAtPosition,
  readCachedVolumeVoxel,
} from '../segmentationConnectedSelection';

const makeShapeBase = (tool, position, overrides) => ({ tool, position, ...overrides });

const makeCanvas = (width, height, pixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height, getContext: () => ({ getImageData: () => ({ data }) }) };
};

describe('buildConnectedSliceSelection', () => {
  test('flood-fills the contiguous seed region and emits mask runs and bbox', () => {
    const canvas = makeCanvas(4, 3, (x, y) => (x < 2 && y < 2 ? 0 : 255));
    const shape = buildConnectedSliceSelection({
      canvas,
      position: { x: 0, y: 0, imageWidth: 4, imageHeight: 3 },
      segmentationSensitivity: 28,
      makeSegmentationShapeBase: makeShapeBase,
    });
    expect(shape.tool).toBe('connected');
    expect(shape.areaPx).toBe(4);
    expect(shape.bbox).toEqual([0, 0, 2, 2]);
    expect(shape.maskRuns).toEqual([[0, 0, 2], [1, 0, 2]]);
    expect(shape.maskPath).toBe('M 0 0 h 2 v 1 h -2 Z M 0 1 h 2 v 1 h -2 Z');
    expect(shape.seedColor).toEqual([0, 0, 0, 255]);
  });

  test('falls back to a seed shape when slice pixels are unavailable', () => {
    const shape = buildConnectedSliceSelection({
      canvas: null,
      position: { x: 1, y: 1, imageWidth: 4, imageHeight: 3 },
      segmentationSensitivity: '',
      makeSegmentationShapeBase: makeShapeBase,
    });
    expect(shape).toEqual(expect.objectContaining({ radius: 28, error: 'slice-pixels-unavailable', points: [] }));
  });

  test('returns null for an incomplete pixel buffer', () => {
    const canvas = { width: 4, height: 4, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) };
    expect(buildConnectedSliceSelection({
      canvas,
      position: { x: 0, y: 0 },
      segmentationSensitivity: 28,
      makeSegmentationShapeBase: makeShapeBase,
    })).toBeNull();
  });
});

describe('makeConnectedVolumeSelection', () => {
  test('normalizes server result fields into a 3d connected shape', () => {
    const shape = makeConnectedVolumeSelection({
      makeSegmentationShapeBase: makeShapeBase,
      getSegmentationVolumeDimensions: () => [2, 2, 2],
      position: { x: 1, y: 1 },
      seedVoxel: [1, 1, 0],
      result: { runs: [[0, 0, 0, 2]], voxel_count: 2, stats: { examined: 5, truncated: true, reason: 'max_voxels' } },
      segmentId: 'seg-1',
      sourceAxis: 'axial',
      sourceSliceIndex: 0,
    });
    expect(shape).toEqual(expect.objectContaining({
      mode: '3d',
      segmentId: 'seg-1',
      volumeRuns: [[0, 0, 0, 2]],
      volumeDimensions: [2, 2, 2],
      voxelCount: 2,
      examined: 5,
      connectivity: 6,
      truncated: true,
      truncationReason: 'max_voxels',
    }));
  });
});

describe('readCachedVolumeVoxel', () => {
  test('reads RGBA at the slice offset and returns null for a missing slice', () => {
    const data = Uint8ClampedArray.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const cache = { slices: [{ imageData: { data } }] };
    expect(readCachedVolumeVoxel(cache, [2, 1, 1], 1, 0, 0)).toEqual([5, 6, 7, 8]);
    expect(readCachedVolumeVoxel(cache, [2, 1, 1], 0, 0, 3)).toBeNull();
  });
});

describe('pickMlRegionAtPosition', () => {
  test('picks the smallest containing region, then the selected region fallback', () => {
    const big = { label: 1, bbox: [0, 0, 10, 10], area_px: 100 };
    const small = { label: 2, bbox: [2, 2, 4, 4], area_px: 4 };
    expect(pickMlRegionAtPosition({ regions: [big, small] }, { x: 3, y: 3 }).selectedRegion).toBe(small);
    const fallback = { label: 3, bbox: [20, 20, 30, 30] };
    expect(pickMlRegionAtPosition({ regions: [big], selected_region: fallback }, { x: 25, y: 25 }).selectedRegion).toBe(fallback);
    expect(pickMlRegionAtPosition({}, { x: 1, y: 1 })).toEqual({ regions: [], selectedRegion: null });
  });
});
