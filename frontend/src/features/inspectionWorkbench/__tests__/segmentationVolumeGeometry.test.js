import {
  applyShapeToSegmentationSegment,
  clampSegmentationSlicePatch,
  createSegmentationGeometry,
} from '../segmentationVolumeGeometry';
import { getMechanicalVolumeMetadata } from '../../../components/pt3MechanicalVisualization';

jest.mock('../../../components/pt3MechanicalVisualization', () => ({
  getMechanicalVolumeMetadata: jest.fn(),
}));

const makeGeometry = (overrides = {}) => createSegmentationGeometry({
  segmentationHelperVolumeDimensions: [8, 6, 4],
  segmentationHelperAxis: 'axial',
  segmentationHelperView: 'quad',
  segmentationTool: 'brush',
  segmentationToolModes: {},
  segmentationOperation: 'add',
  segmentationBrushSize: '',
  segmentationSensitivity: '',
  segmentationMlMethod: 'method-a',
  segmentationMlParameters: { k: 1 },
  slicePosition: { axial: 2, coronal: 1, sagittal: 3 },
  mprDimensions: { axial: 4, coronal: 6, sagittal: 8 },
  volumeCacheState: { cache: null },
  selectedPart: { id: 'part-1', metadata: {} },
  displayWindow: { min: 0, max: 255 },
  ...overrides,
});

describe('createSegmentationGeometry', () => {
  test('reports volume dimensions and sanitizes declared spacing', () => {
    const geometry = makeGeometry();
    expect(geometry.getSegmentationVolumeDimensions()).toEqual([8, 6, 4]);
    getMechanicalVolumeMetadata.mockReturnValueOnce({ spacing: [0.5, 'x', -2, 9] });
    expect(geometry.getSegmentationVolumeSpacing()).toEqual([0.5, 1, Number.EPSILON]);
    getMechanicalVolumeMetadata.mockReturnValueOnce({ spacing: [1, 2] });
    expect(geometry.getSegmentationVolumeSpacing()).toEqual([1, 1, 1]);
  });

  test('resolves 2d mode unless the tool supports 3d and the view or mode requests it', () => {
    expect(makeGeometry().getActiveSegmentationToolMode('polygon')).toBe('2d');
    expect(makeGeometry({ segmentationHelperView: '3d' }).getActiveSegmentationToolMode('polygon')).toBe('2d');
  });

  test('builds shape bases with brush and sensitivity defaults', () => {
    const shape = makeGeometry().makeSegmentationShapeBase('brush', { imageWidth: 80, imageHeight: 60 }, { extra: 1 });
    expect(shape).toEqual(expect.objectContaining({
      tool: 'brush',
      mode: '2d',
      operation: 'add',
      axis: 'axial',
      imageWidth: 80,
      imageHeight: 60,
      volumeDimensions: [8, 6, 4],
      brushSize: 18,
      sensitivity: 28,
      extra: 1,
    }));
    expect(shape.id).toMatch(/^shape-\d+-[a-z0-9]+$/);
  });

  test('keys the ML cache by part, axis, slice, method, parameters, and display window', () => {
    expect(JSON.parse(makeGeometry().getSegmentationMlCacheKey('coronal'))).toEqual({
      partId: 'part-1',
      axis: 'coronal',
      sliceIndex: 1,
      methodId: 'method-a',
      parameters: { k: 1 },
      displayWindow: { min: 0, max: 255 },
    });
  });

  test('prefers the rendered stage canvas for slice pixels and data URLs', () => {
    const canvas = { getContext: () => ({}), toDataURL: () => 'data:image/png;base64,AA' };
    const stage = { querySelector: () => canvas };
    const geometry = makeGeometry();
    expect(geometry.getSegmentationSliceCanvasForSelection(stage)).toBe(canvas);
    expect(geometry.getSegmentationSliceDataUrl(stage)).toBe('data:image/png;base64,AA');
  });

  test('returns no voxel for an unknown axis or missing position', () => {
    const geometry = makeGeometry();
    expect(geometry.getSegmentationVoxelPosition(null)).toBeNull();
    expect(geometry.getSegmentationVoxelPosition({ x: 1, y: 1 }, 'volume')).toBeNull();
  });
});

describe('clampSegmentationSlicePatch', () => {
  test('clamps to the axis extent and keeps min below max by moving the other bound', () => {
    const segment = { id: 's1', axis: 'coronal', minSlice: 1, maxSlice: 3 };
    expect(clampSegmentationSlicePatch(segment, { maxSlice: 99 }, [8, 6, 4])).toEqual(
      expect.objectContaining({ minSlice: 1, maxSlice: 5 }),
    );
    expect(clampSegmentationSlicePatch(segment, { minSlice: 4 }, [8, 6, 4])).toEqual(
      expect.objectContaining({ minSlice: 4, maxSlice: 4 }),
    );
    expect(clampSegmentationSlicePatch(segment, { maxSlice: 0 }, [8, 6, 4])).toEqual(
      expect.objectContaining({ minSlice: 0, maxSlice: 0 }),
    );
  });
});

describe('applyShapeToSegmentationSegment', () => {
  test('appends a planar shape without compaction', () => {
    const shape = { id: 'a', tool: 'brush', mode: '2d' };
    const result = applyShapeToSegmentationSegment({ id: 's1', areas: [] }, shape, {
      getSegmentationVolumeDimensions: () => [8, 6, 4],
      getSegmentationVolumeSpacing: () => [1, 1, 1],
    });
    expect(result.shouldCompact).toBe(false);
    expect(result.compactionWasTruncated).toBe(false);
    expect(result.nextSegment.areas).toEqual([shape]);
  });
});
