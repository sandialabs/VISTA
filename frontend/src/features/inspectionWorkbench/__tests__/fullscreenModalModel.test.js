import { buildFullscreenModalModel } from '../fullscreenModalModel';

const baseInput = (overrides = {}) => ({
  fullscreenImageModal: { label: 'front view', baseImageId: '' },
  fullscreenBackingImageId: 'img-1',
  fullscreenMprSliceKey: '',
  projectImageLookup: { 'img-1': { id: 'img-1' } },
  getAnnotationSourceImageIdForImage: (imageId) => imageId,
  inspectionAnnotationItems: [],
  annotationsVisible: true,
  annotationLayerVisible: true,
  mprMeasurementLinesBySlice: {},
  measurementLinesByImageId: {},
  mprBoxAnnotationsBySlice: {},
  boxAnnotationsByImageId: {},
  fullscreenMeasurements: [],
  fullscreenGeometryDragPreview: null,
  fullscreenAnnotationPreview: null,
  getBoxWithDerivedDimensions: (box) => box,
  slicePosition: { axial: 0, coronal: 0, sagittal: 0 },
  mprDimensions: { axial: 4, coronal: 4, sagittal: 4 },
  mprProjectionMirror: {},
  volumeCacheState: { cache: null },
  vectorSegmentAnnotations: [],
  getSegmentationCanonicalSliceIndex: (axis, index) => index,
  ...overrides,
});

const line = { id: 'line-1', name: 'Gap', x1: 0, y1: 0, x2: 100, y2: 0, imageWidth: 200, imageHeight: 100, color: '#f00' };
const box = { id: 'box-1', x: 10, y: 10, width: 50, height: 20, imageWidth: 200, imageHeight: 100, color: '#0f0' };

describe('buildFullscreenModalModel', () => {
  test('derives a plain image model with saved geometry and overlay sizing', () => {
    const model = buildFullscreenModalModel(baseInput({
      measurementLinesByImageId: { 'img-1': [line] },
      boxAnnotationsByImageId: { 'img-1': [box] },
    }));

    expect(model.isMprFullscreen).toBe(false);
    expect(model.fullscreenImageId).toBe('img-1');
    expect(model.fullscreenBaseImageId).toBe('');
    expect(model.fullscreenImageRecord).toEqual({ id: 'img-1' });
    expect(model.fullscreenShowsExternalOverlay).toBe(false);
    expect(model.renderedFullscreenMeasurementLines).toEqual([line]);
    expect(model.renderedFullscreenBoxAnnotations).toEqual([box]);
    expect(model.fullscreenAnnotationItems.map((item) => [item.annotationType, item.title])).toEqual([
      ['measurement', 'Gap'],
      ['box', 'Box 1'],
    ]);
    expect(model.fullscreenOverlayViewBox).toBe('0 0 200 100');
    expect(model.fullscreenOverlayContentTransform).toBe('scale(0.2 0.1)');
    expect(model.fullscreenMprSlicePosition).toBeNull();
    expect(model.fullscreenSegmentAnnotations).toEqual([]);
  });

  test('substitutes drag previews and appends draft previews', () => {
    const moved = { ...line, x2: 150 };
    const draftBox = { ...box, id: 'draft' };
    const model = buildFullscreenModalModel(baseInput({
      measurementLinesByImageId: { 'img-1': [line] },
      fullscreenGeometryDragPreview: { kind: 'line', geometry: moved },
      fullscreenAnnotationPreview: { mode: 'crop', box: draftBox },
    }));

    expect(model.renderedFullscreenMeasurementLines).toEqual([moved]);
    expect(model.fullscreenPreviewLines).toEqual([]);
    expect(model.fullscreenPreviewBoxes).toEqual([draftBox]);
  });

  test('lists non-geometry inspection items and shows assigned external overlays', () => {
    const overlayItem = { id: 'ov-1', kind: 'external_overlay', label: 'Heat', visible: true, color: '#00f', source: { resourceId: 'img-1' } };
    const model = buildFullscreenModalModel(baseInput({
      fullscreenImageModal: { label: 'front view', baseImageId: 'base-1' },
      inspectionAnnotationItems: [overlayItem],
    }));

    expect(model.fullscreenBaseImageId).toBe('base-1');
    expect(model.fullscreenExternalOverlayItem).toBe(overlayItem);
    expect(model.fullscreenShowsExternalOverlay).toBe(true);
    expect(model.fullscreenAnnotationItems).toEqual([expect.objectContaining({
      id: 'ov-1',
      title: 'External: Heat',
      summary: 'Assigned external image or volume',
      inspectionItem: overlayItem,
    })]);
  });

  test('uses the MPR slice key and slice position for MPR fullscreen', () => {
    const model = buildFullscreenModalModel(baseInput({
      fullscreenImageModal: { label: 'XY', sourceKind: 'mpr', axis: 'axial', sliceIndex: 2 },
      fullscreenMprSliceKey: 'axial:2',
      mprMeasurementLinesBySlice: { 'axial:2': [line] },
    }));

    expect(model.isMprFullscreen).toBe(true);
    expect(model.fullscreenAnnotationLookupKey).toBe('axial:2');
    expect(model.renderedFullscreenMeasurementLines).toEqual([line]);
    expect(model.fullscreenMprSlicePosition).toEqual({ axial: 2, coronal: 0, sagittal: 0 });
    expect(model.fullscreenCanonicalSliceIndex).toBe(2);
  });
});
