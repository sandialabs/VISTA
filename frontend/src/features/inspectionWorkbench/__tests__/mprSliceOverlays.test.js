import { buildMprSliceOverlays } from '../mprSliceOverlays';

const line = { id: 'line-1', x1: 1, y1: 2, x2: 3, y2: 4, imageWidth: 10, imageHeight: 10 };
const box = { id: 'box-1', x: 1, y: 1, width: 2, height: 2, imageWidth: 10, imageHeight: 10 };

function buildInput(overrides = {}) {
  return {
    axis: 'axial',
    sliceIndex: 4,
    canonicalSliceIndex: 4,
    annotationLayerVisible: true,
    annotations: {
      mprMeasurementLinesBySlice: { 'axial:4': [line, { id: 'bad' }] },
      mprBoxAnnotationsBySlice: { 'axial:4': [box] },
      mprCubeAnnotations: [{ ...box, id: 'cube', axis: 'axial', startSlice: 2, endSlice: 6 }],
      vectorSegmentAnnotations: [{ id: 'seg', visible: false }],
    },
    drafts: {
      mprAnnotationPreview: null,
      mprPendingCubeDraft: null,
      mprGeometryDragPreview: null,
    },
    ...overrides,
  };
}

describe('buildMprSliceOverlays', () => {
  test('keeps finite persisted lines and boxes and adds cube slices', () => {
    const result = buildMprSliceOverlays(buildInput());
    expect(result.mprSliceLines).toEqual([line]);
    expect(result.mprEditableSliceBoxes).toEqual([box]);
    expect(result.mprSliceBoxes.map((item) => item.id)).toEqual(['box-1', 'cube-axial-4']);
    expect(result.mprSliceSegments).toEqual([]);
    expect(result.mprPreviewLines).toEqual([]);
    expect(result.pendingCubeBoxes).toEqual([]);
  });

  test('substitutes drag preview geometry and shows slice drafts', () => {
    const movedBox = { ...box, x: 5 };
    const result = buildMprSliceOverlays(buildInput({
      drafts: {
        mprAnnotationPreview: { mode: 'measure', axis: 'axial', sliceIndex: '4', line },
        mprPendingCubeDraft: { axis: 'axial', sliceIndex: 4, box },
        mprGeometryDragPreview: { kind: 'box', geometry: movedBox },
      },
    }));
    expect(result.mprEditableSliceBoxes).toEqual([movedBox]);
    expect(result.mprPreviewLines).toEqual([line]);
    expect(result.mprPreviewBoxes).toEqual([]);
    expect(result.pendingCubeBoxes[0]).toMatchObject({ id: 'mpr-cube-pending', x: 1 });
  });

  test('hides drafts from other slices and segments when the layer is hidden', () => {
    const result = buildMprSliceOverlays(buildInput({
      annotationLayerVisible: false,
      drafts: {
        mprAnnotationPreview: { mode: 'box', axis: 'axial', sliceIndex: 5, box },
        mprPendingCubeDraft: { axis: 'coronal', sliceIndex: 4, box },
        mprGeometryDragPreview: null,
      },
    }));
    expect(result.mprPreviewBoxes).toEqual([]);
    expect(result.pendingCubeBoxes).toEqual([]);
    expect(result.mprSliceSegments).toEqual([]);
  });
});
