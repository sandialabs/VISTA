import {
  covarianceFromScaleQuaternion,
  DEFAULT_SPLAT_VIEW_SETTINGS,
  evaluateGraphdecoSphericalHarmonics,
  getCanvasSplatSampleIndices,
  getCanvasSplatStride,
  getGraphdecoShBasis,
  getPt3SplatViewDirection,
  MAX_CANVAS_GAUSSIANS,
  prepareSplatAssetForRendering,
  projectGaussianCovariance,
  resolveSplatCoordinateSpace,
  sortSplatRenderEntriesBackToFront,
} from '../pt3SplatRendering';
import { createPt3PerspectiveProjector } from '../pt3VolumeGeometry';

describe('PT3 splat rendering helpers', () => {
  test('uses visibility-forward 3DGS defaults', () => {
    expect(DEFAULT_SPLAT_VIEW_SETTINGS).toEqual({
      opacity: 1.25,
      pointSize: 1.35,
      contrast: 1.2,
      showSliceGuides: true,
    });
  });

  test('maps generated voxel-coordinate extrema into physical bounds without changing authored scales', () => {
    const scales = new Float32Array([1.5, 3]);
    const splats = {
      positions: new Float32Array([0, 0, 0, 4, 2, 1]),
      scales,
      colors: new Float32Array(8),
      metadata: { coordinate_space: 'voxel' },
    };
    const rendered = prepareSplatAssetForRendering(splats, {
      dimensions: [5, 3, 2],
      spacing: [2, 3, 4],
      origin: [10, 20, 30],
    });

    expect(Array.from(rendered.positions)).toEqual([10, 20, 30, 18, 26, 34]);
    expect(rendered.scales).toBe(scales);
    expect(rendered.metadata).toBe(splats.metadata);
    expect(Array.from(rendered.scales)).toEqual([1.5, 3]);
  });

  test('leaves externally authored physical coordinates and scales untouched', () => {
    const splats = {
      positions: new Float32Array([-42, 7, 3, 900, -2, 0.25]),
      scales: new Float32Array([0.125, 12]),
    };

    expect(prepareSplatAssetForRendering(splats, {
      dimensions: [5, 3, 2],
      spacing: [2, 3, 4],
      origin: [10, 20, 30],
    })).toBe(splats);
  });

  test('lets parsed physical metadata override generated-route and legacy voxel fallbacks', () => {
    expect(resolveSplatCoordinateSpace({
      parsedMetadata: { coordinateSpace: 'world' },
      sourceMetadata: { coordinate_space: 'voxel' },
      assetUrl: '/api/projects/p/parts/x/volume-splat-assets/generated.json',
      legacyPt3SplatAsset: { status: 'ready' },
    })).toBe('physical');
  });

  test('classifies direct internal generated-asset URLs as voxel coordinates', () => {
    expect(resolveSplatCoordinateSpace({
      assetUrl: '/api/projects/p/parts/x/volume-splat-assets/generated.json',
    })).toBe('voxel');
    expect(resolveSplatCoordinateSpace({
      assetUrl: 'https://assets.example/volume-splat-assets/generated.json',
      applicationOrigin: 'https://vista.example',
    })).toBe('physical');
  });

  test('retains the voxel fallback only for ready legacy PT3 splat records', () => {
    expect(resolveSplatCoordinateSpace({ legacyPt3SplatAsset: { status: 'ready' } })).toBe('voxel');
    expect(resolveSplatCoordinateSpace({ legacyPt3SplatAsset: { status: 'pending' } })).toBe('physical');
  });

  test('bounds Canvas2D work with a deterministic stride while preserving small stacks', () => {
    expect(getCanvasSplatStride(720)).toBe(1);
    expect(getCanvasSplatStride(30000)).toBe(1);
    expect(getCanvasSplatStride(30001)).toBe(2);
    expect(Math.ceil(100000 / getCanvasSplatStride(100000))).toBeLessThanOrEqual(30000);
    expect(Math.ceil(100000 / getCanvasSplatStride(100000, MAX_CANVAS_GAUSSIANS)))
      .toBeLessThanOrEqual(MAX_CANVAS_GAUSSIANS);
  });

  test('keeps every visible segment in a bounded deterministic canonical preview', () => {
    const segmentIds = new Array(100000).fill(1);
    segmentIds[99999] = 2;
    const options = {
      splatCount: segmentIds.length,
      maxSplats: MAX_CANVAS_GAUSSIANS,
      segmentIds,
      segments: [
        { id: 1, visible: true },
        { id: 2, visible: true },
      ],
    };
    const sampled = getCanvasSplatSampleIndices(options);

    expect(sampled).toHaveLength(MAX_CANVAS_GAUSSIANS);
    expect(sampled).toContain(99999);
    expect(sampled).toEqual(getCanvasSplatSampleIndices(options));
  });

  test('does not spend the preview budget on explicitly hidden segments', () => {
    const sampled = getCanvasSplatSampleIndices({
      splatCount: 12,
      maxSplats: 4,
      segmentIds: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
      segments: [
        { id: 1, visible: true },
        { id: 2, visible: false },
        { id: 3, visible: true },
      ],
    });

    expect(sampled).toHaveLength(4);
    expect(sampled.some((index) => index >= 0 && index <= 3)).toBe(true);
    expect(sampled.some((index) => index >= 4 && index <= 7)).toBe(false);
    expect(sampled.some((index) => index >= 8 && index <= 11)).toBe(true);
  });

  test('reconstructs the complete 3D covariance from Graphdeco wxyz quaternions', () => {
    const identity = covarianceFromScaleQuaternion([2, 1, 0.5], [1, 0, 0, 0]);
    expect(identity[0]).toBeCloseTo(4);
    expect(identity[4]).toBeCloseTo(1);
    expect(identity[8]).toBeCloseTo(0.25);
    const rotateZ90 = covarianceFromScaleQuaternion(
      [2, 1, 0.5],
      [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    );
    expect(rotateZ90[0]).toBeCloseTo(1);
    expect(rotateZ90[4]).toBeCloseTo(4);
    expect(rotateZ90[1]).toBeCloseTo(0);
    expect(rotateZ90[8]).toBeCloseTo(0.25);
  });

  test('projects full covariance through a numeric 2x3 screen Jacobian', () => {
    const result = projectGaussianCovariance({
      mean: [1, 2, 5],
      covariance: [4, 0, 0, 0, 9, 0, 0, 0, 16],
      project: ([x, y, z]) => [100 + 2 * x, 200 + 3 * y, z, 1],
      minimumVariance: 0,
      finiteDifferenceStep: 1e-3,
    });
    expect(result.x).toBeCloseTo(102);
    expect(result.y).toBeCloseTo(206);
    expect(result.covariance2d[0]).toBeCloseTo(16, 5);
    expect(result.covariance2d[1]).toBeCloseTo(0, 5);
    expect(result.covariance2d[3]).toBeCloseTo(81, 5);
    expect(result.sigmaMajor).toBeCloseTo(9, 5);
    expect(result.sigmaMinor).toBeCloseTo(4, 5);
    expect(Math.abs(result.angle)).toBeCloseTo(Math.PI / 2, 5);
  });

  test('includes depth variance and cross-covariance under perspective', () => {
    const result = projectGaussianCovariance({
      mean: [2, 0, 4],
      covariance: [4, 0, 1, 0, 9, 0, 1, 0, 16],
      project: ([x, y, z]) => [x / z, y / z, z, 1 / z],
      minimumVariance: 0,
      finiteDifferenceStep: 1e-4,
    });
    // du/dx=1/4 and du/dz=-1/8, so x, z, and xz terms all contribute.
    expect(result.covariance2d[0]).toBeCloseTo(0.4375, 5);
    expect(result.covariance2d[3]).toBeCloseTo(0.5625, 5);
  });

  test('evaluates coefficient-major RGB Graphdeco SH through degree four', () => {
    expect(evaluateGraphdecoSphericalHarmonics([1, 2, 3], 0, [0, 1, 0])).toEqual([
      expect.closeTo(0.5 + 0.28209479177387814, 10),
      1,
      1,
    ]);
    const degreeOne = new Array(12).fill(0);
    degreeOne[3] = 0.5; // l=1,m=-1 red coefficient; basis is -C1*y.
    expect(evaluateGraphdecoSphericalHarmonics(degreeOne, 1, [0, 1, 0])[0])
      .toBeCloseTo(0.5 - 0.5 * 0.4886025119029199, 10);
    expect(evaluateGraphdecoSphericalHarmonics(degreeOne, 1, [0, -1, 0])[0])
      .toBeCloseTo(0.5 + 0.5 * 0.4886025119029199, 10);
    const degreeFour = new Array(75).fill(0);
    degreeFour[24 * 3 + 2] = 0.2;
    expect(getGraphdecoShBasis(4, [1, 0, 0])).toHaveLength(25);
    expect(evaluateGraphdecoSphericalHarmonics(degreeFour, 4, [1, 0, 0])[2])
      .toBeCloseTo(0.5 + 0.2 * 0.6258357354491761, 10);
  });

  test('derives the view direction from the active orbit camera in physical space', () => {
    const metadata = { dimensions: [3, 3, 3], spacing: [1, 1, 1] };
    expect(getPt3SplatViewDirection({ metadata, point: [1, 1, 1], rotation: { x: 0, y: 0 } }))
      .toEqual([0, 0, -1]);
    const yawed = getPt3SplatViewDirection({ metadata, point: [1, 1, 1], rotation: { x: 0, y: 90 } });
    expect(yawed[0]).toBeCloseTo(1, 10);
    expect(yawed[1]).toBeCloseTo(0, 10);
    expect(yawed[2]).toBeCloseTo(0, 10);
  });

  test('converts voxel covariance into physical space with spacing', () => {
    const rendered = prepareSplatAssetForRendering({
      positions: new Float32Array([0, 0, 0]),
      scales: new Float32Array([3]),
      scaleVectors: new Float32Array([1, 2, 3]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Float32Array(4),
      metadata: { coordinate_space: 'voxel' },
    }, {
      dimensions: [2, 2, 2],
      spacing: [2, 3, 4],
    });
    expect(rendered.covariances3d[0]).toBeCloseTo(4);
    expect(rendered.covariances3d[4]).toBeCloseTo(36);
    expect(rendered.covariances3d[8]).toBeCloseTo(144);
  });

  test('orders translucent Canvas splats far-to-near with stable depth ties', () => {
    const entries = [
      { splatIndex: 3, viewZ: 2 },
      { splatIndex: 1, viewZ: -4 },
      { splatIndex: 2, viewZ: 2 },
    ];
    expect(sortSplatRenderEntriesBackToFront(entries).map(({ splatIndex }) => splatIndex))
      .toEqual([1, 2, 3]);
  });

  test('keeps far-to-near ordering after a mirrored 90-degree orbit', () => {
    const metadata = { dimensions: [5, 3, 2], spacing: [2, 3, 4] };
    const projector = createPt3PerspectiveProjector({
      metadata,
      width: 640,
      height: 480,
      rotation: { x: 0, y: 90 },
      mirrorScale: { x: -1, y: 1, z: 1 },
    });
    const entries = [
      { splatIndex: 0, viewZ: projector([0, 3, 2])[2] },
      { splatIndex: 1, viewZ: projector([8, 3, 2])[2] },
    ];

    sortSplatRenderEntriesBackToFront(entries);
    expect(entries[0].viewZ).toBeLessThan(entries[1].viewZ);
    expect(entries.map(({ splatIndex }) => splatIndex)).toEqual([0, 1]);
  });
});
