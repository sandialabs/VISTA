import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_FILL_OPACITY,
  getAnnotationColor,
  getAnnotationFillOpacity,
  getAnnotationOpacityMultiplier,
  getAnnotationTransparencyPercent,
  getBoxAnnotationsByImageId,
  getInspectionOverlayStyleDraft,
  getMeasurementLinesByImageId,
  getMprBoxAnnotationsBySlice,
  getMprCubeAnnotations,
  getMprCubeBoxesForSlice,
  getMprMeasurementLinesBySlice,
  getMprSliceKey,
  normalizeAnnotationTransparencyPercent,
  parseHexRgb,
} from '../inspectionAnnotationDisplay';

describe('inspection annotation display helpers', () => {
  test('normalizes colors and opacity values', () => {
    expect(getAnnotationColor({ metadata: { annotation_color: '#123abc' } })).toBe('#123abc');
    expect(getAnnotationColor({ color: 'bad' })).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(getAnnotationFillOpacity({ metadata: { annotation_fill_opacity: 2 } })).toBe(1);
    expect(getAnnotationFillOpacity({ fill_opacity: -1 })).toBe(0);
    expect(getAnnotationFillOpacity({})).toBe(DEFAULT_ANNOTATION_FILL_OPACITY);
    expect(normalizeAnnotationTransparencyPercent(44.6)).toBe(45);
    expect(getAnnotationOpacityMultiplier(25)).toBe(0.75);
    expect(getAnnotationTransparencyPercent({ metadata: { annotation_fill_opacity: 0.25 } })).toBe(75);
  });

  test('parses hex rgb values', () => {
    expect(parseHexRgb('#0a1b2c')).toEqual([10, 27, 44]);
    expect(parseHexRgb('0a1b2c')).toEqual([10, 27, 44]);
    expect(parseHexRgb('bad')).toBeNull();
  });

  test('groups measurement lines and boxes by source image', () => {
    const annotations = [
      {
        id: 'line-1',
        image_id: 'image-a',
        comment: 'Line A',
        geometry: { line: { x1: 1, y1: 2, x2: 4, y2: 6, imageWidth: 10, imageHeight: 10 } },
      },
      {
        id: 'box-1',
        image_id: 'image-a',
        defect_class: 'Crack',
        bbox: { x: 2, y: 3, width: 4, height: 5, imageWidth: 20, imageHeight: 30 },
      },
    ];

    expect(getMeasurementLinesByImageId(annotations)['image-a']?.[0]).toMatchObject({
      id: 'line-1',
      distancePx: 5,
      name: 'Line A',
    });
    expect(getBoxAnnotationsByImageId(annotations)['image-a']?.[0]).toMatchObject({
      id: 'box-1',
      name: 'Crack',
      width: 4,
      height: 5,
    });
  });

  test('derives MPR annotation displays by slice and cube coverage', () => {
    const annotations = [
      {
        id: 'mpr-line',
        geometry: { axis: 'axial', line: { x1: 1, y1: 2, x2: 3, y2: 4, imageWidth: 10, imageHeight: 10, sliceIndex: 7 } },
      },
      {
        id: 'mpr-box',
        bbox: { x: 2, y: 3, width: 4, height: 5 },
        geometry: { axis: 'coronal', box: { x: 2, y: 3, width: 4, height: 5, imageWidth: 20, imageHeight: 20, slice_index: 4 } },
      },
      {
        id: 'cube-1',
        geometry: { cube: { axis: 'sagittal', start_slice: 2, end_slice: 4, x: 1, y: 1, width: 3, height: 3, imageWidth: 10, imageHeight: 10 } },
      },
    ];

    expect(getMprSliceKey('axial', 7)).toBe('axial:7');
    expect(getMprMeasurementLinesBySlice(annotations)['axial:7']?.[0]).toMatchObject({ id: 'mpr-line', axis: 'axial' });
    expect(getMprBoxAnnotationsBySlice(annotations)['coronal:4']?.[0]).toMatchObject({ id: 'mpr-box', axis: 'coronal' });
    const cubes = getMprCubeAnnotations(annotations);
    expect(cubes).toHaveLength(1);
    expect(getMprCubeBoxesForSlice(cubes, 'sagittal', 3)[0]).toMatchObject({
      id: 'cube-1-sagittal-3',
      imageId: 'sagittal:3',
    });
  });

  test('creates edit drafts for annotations and source-image overlays', () => {
    expect(getInspectionOverlayStyleDraft({
      id: 'overlay-item',
      source: { resource: 'source_image', resourceId: 'overlay-1' },
      color: '#a78bfa',
      overlay: { overlay_opacity: 0.4 },
    })).toMatchObject({
      id: 'overlay-item',
      resource: 'source_image',
      resourceId: 'overlay-1',
      transparency_percent: 60,
    });
    expect(getInspectionOverlayStyleDraft({
      annotation: {
        id: 'annotation-1',
        defect_class: 'Void',
        metadata: { annotation_color: '#abcdef', annotation_fill_opacity: 0.2 },
      },
      source: { resource: 'annotation', resourceId: 'annotation-1' },
    })).toMatchObject({
      id: 'annotation-1',
      resource: 'annotation',
      color: '#abcdef',
      transparency_percent: 80,
    });
  });
});
