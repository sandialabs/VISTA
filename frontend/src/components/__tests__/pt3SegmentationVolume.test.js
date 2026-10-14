import {
  compositeVolumeRuns,
  countVolumeRunVoxels,
  floodFillVolume3d,
  floodFillVolume3dAsync,
  getVolumeRunBounds,
  normalizeVolumeDimensions,
  normalizeVolumeRuns,
  projectVolumeRunsToSlice,
  rasterizeSphereStroke,
} from '../pt3SegmentationVolume';

describe('pt3SegmentationVolume', () => {
  test('normalizes dimensions and canonicalizes clipped, sorted, merged x-runs', () => {
    expect(normalizeVolumeDimensions({ sagittal: 8, coronal: 6, axial: 4 })).toEqual([8, 6, 4]);
    expect(normalizeVolumeRuns([
      [2, 1, 5, 9],
      [0, 3, 1, 2],
      [2, 1, -4, 3],
      [2, 1, 3, 5],
      [9, 1, 0, 1],
      ['bad', 1, 0, 1],
    ], [8, 6, 4])).toEqual([
      [0, 3, 1, 2],
      [2, 1, 0, 8],
    ]);
  });

  test('counts, bounds, unions, and subtracts runs without losing split intervals', () => {
    const base = [[0, 0, 1, 7], [0, 1, 2, 5]];
    const added = compositeVolumeRuns(base, [[0, 0, 6, 9]], { dimensions: [10, 3, 2] });
    expect(added).toEqual([[0, 0, 1, 9], [0, 1, 2, 5]]);
    const cut = compositeVolumeRuns(added, [[0, 0, 3, 6]], {
      subtract: true,
      dimensions: [10, 3, 2],
    });
    expect(cut).toEqual([[0, 0, 1, 3], [0, 0, 6, 9], [0, 1, 2, 5]]);
    expect(countVolumeRunVoxels(cut)).toBe(8);
    expect(getVolumeRunBounds(cut)).toEqual({ min: [1, 0, 0], max: [8, 1, 0] });
  });

  test('subtracts adversarial alternating intervals with a linear row sweep', () => {
    const base = [];
    const cutters = [];
    for (let x = 0; x < 20_000; x += 4) {
      base.push([0, 0, x, x + 2]);
      cutters.push([0, 0, x + 1, x + 3]);
    }
    const result = compositeVolumeRuns(base, cutters, {
      subtract: true,
      dimensions: [20_000, 1, 1],
      maxRuns: 10_000,
    });
    expect(result).toHaveLength(5_000);
    expect(result[0]).toEqual([0, 0, 0, 1]);
    expect(result.at(-1)).toEqual([0, 0, 19_996, 19_997]);
  });

  test('rasterizes a clipped sphere and interpolates a gap-free 3D stroke', () => {
    const clipped = rasterizeSphereStroke({
      centers: [[0, 0, 0]],
      radius: 2,
      dimensions: [7, 7, 7],
    });
    expect(clipped.truncated).toBe(false);
    expect(clipped.bounds.min).toEqual([0, 0, 0]);
    expect(clipped.bounds.max).toEqual([2, 2, 2]);

    const stroke = rasterizeSphereStroke({
      centers: [[1, 3, 3], [9, 3, 3]],
      radius: 1.25,
      dimensions: [12, 7, 7],
    });
    const axial = projectVolumeRunsToSlice({
      runs: stroke.runs,
      axis: 'axial',
      sliceIndex: 3,
      dimensions: [12, 7, 7],
    });
    for (let x = 1; x <= 9; x += 1) {
      expect(axial.rectangles.some((rectangle) => (
        rectangle.y0 <= 3 && rectangle.y1 > 3 && rectangle.x0 <= x && rectangle.x1 > x
      ))).toBe(true);
    }
  });

  test('uses spacing to keep a physical sphere smaller along coarse axes', () => {
    const result = rasterizeSphereStroke({
      centers: [[5, 5, 5]],
      radius: 3,
      dimensions: [11, 11, 11],
      spacing: [1, 1, 3],
    });
    expect(result.bounds.min[0]).toBe(2);
    expect(result.bounds.max[0]).toBe(8);
    expect(result.bounds.min[2]).toBe(4);
    expect(result.bounds.max[2]).toBe(6);
  });

  test('projects canonical runs into axial, coronal, and sagittal display coordinates', () => {
    const runs = [[0, 1, 2, 5], [2, 1, 3, 6]];
    const dimensions = [8, 4, 3];
    const axial = projectVolumeRunsToSlice({ runs, axis: 'axial', sliceIndex: 0, dimensions });
    expect(axial).toMatchObject({
      imageWidth: 8,
      imageHeight: 4,
      rectangles: [{ x0: 2, y0: 1, x1: 5, y1: 2 }],
    });
    const coronal = projectVolumeRunsToSlice({ runs, axis: 'coronal', sliceIndex: 1, dimensions });
    expect(coronal.rectangles).toEqual(expect.arrayContaining([
      { x0: 2, y0: 2, x1: 5, y1: 3 },
      { x0: 3, y0: 0, x1: 6, y1: 1 },
    ]));
    const sagittal = projectVolumeRunsToSlice({ runs, axis: 'sagittal', sliceIndex: 4, dimensions });
    expect(sagittal).toMatchObject({
      imageWidth: 4,
      imageHeight: 3,
      rectangles: expect.arrayContaining([
        { x0: 1, y0: 2, x1: 2, y1: 3 },
        { x0: 1, y0: 0, x1: 2, y1: 1 },
      ]),
    });
  });

  test('3D flood fill crosses axes, includes the tolerance edge, and rejects diagonal-only contact', () => {
    const selected = new Set([
      '0,0,0',
      '1,0,0',
      '1,1,0',
      '1,1,1',
      '2,2,2',
    ]);
    const result = floodFillVolume3d({
      dimensions: [3, 3, 3],
      seed: [0, 0, 0],
      sensitivity: 5,
      getVoxel: (x, y, z) => (selected.has(`${x},${y},${z}`) ? 15 : 30),
    });
    expect(result.voxelCount).toBe(4);
    expect(result.runs).toEqual([
      [0, 0, 0, 2],
      [0, 1, 1, 2],
      [1, 1, 1, 2],
    ]);
  });

  test('3D flood fill compares vector channels deterministically', () => {
    const reader = (x) => (x === 0 ? [10, 20, 30, 255] : [14, 25, 29, 255]);
    const first = floodFillVolume3d({
      dimensions: [2, 1, 1],
      seed: [0, 0, 0],
      sensitivity: 5,
      getVoxel: reader,
    });
    const second = floodFillVolume3d({
      dimensions: [2, 1, 1],
      seed: [0, 0, 0],
      sensitivity: 5,
      getVoxel: reader,
    });
    expect(first.runs).toEqual([[0, 0, 0, 2]]);
    expect(second).toEqual(first);
  });

  test('returns bounded partial results for cancellation and resource limits', () => {
    let checks = 0;
    const cancelled = floodFillVolume3d({
      dimensions: [8, 8, 8],
      seed: [0, 0, 0],
      sensitivity: 0,
      getVoxel: () => 1,
      isCancelled: () => {
        checks += 1;
        return checks > 5;
      },
    });
    expect(cancelled.truncated).toBe(true);
    expect(cancelled.reason).toBe('cancelled');
    expect(cancelled.voxelCount).toBeGreaterThan(0);

    const limited = floodFillVolume3d({
      dimensions: [8, 8, 8],
      seed: [0, 0, 0],
      sensitivity: 0,
      getVoxel: () => 1,
      maxVoxels: 7,
    });
    expect(limited.truncated).toBe(true);
    expect(limited.reason).toBe('max-voxels');
    expect(limited.voxelCount).toBe(7);

    const exact = floodFillVolume3d({
      dimensions: [7, 1, 1],
      seed: [0, 0, 0],
      sensitivity: 0,
      getVoxel: () => 1,
      maxVoxels: 7,
    });
    expect(exact.truncated).toBe(false);
    expect(exact.voxelCount).toBe(7);

    const runLimited = rasterizeSphereStroke({
      centers: [[5, 5, 5]],
      radius: 4,
      dimensions: [12, 12, 12],
      maxRuns: 2,
    });
    expect(runLimited.truncated).toBe(true);
    expect(runLimited.reason).toBe('max-runs');
    expect(runLimited.runs).toHaveLength(2);
  });

  test('async 3D flood fill yields so a pending cancellation can stop local growth', async () => {
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 0);
    const result = await floodFillVolume3dAsync({
      dimensions: [80, 80, 40],
      seed: [0, 0, 0],
      sensitivity: 0,
      getVoxel: () => 1,
      maxVoxels: 50_000,
      maxExamined: 150_000,
      isCancelled: () => cancelled,
    });
    expect(result.truncated).toBe(true);
    expect(result.reason).toBe('cancelled');
    expect(result.examined).toBeLessThanOrEqual(4_097);
  });

  test('invalid seeds and empty sphere inputs are safe no-ops', () => {
    expect(floodFillVolume3d({
      dimensions: [3, 3, 3],
      seed: [9, 0, 0],
      getVoxel: () => 1,
    })).toMatchObject({ runs: [], voxelCount: 0, reason: 'invalid-seed' });
    expect(rasterizeSphereStroke({
      centers: [],
      radius: 0,
      dimensions: [3, 3, 3],
    })).toMatchObject({ runs: [], voxelCount: 0, reason: 'invalid-sphere' });
  });
});
