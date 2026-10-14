import {
  applyCalibratedMeasurementLine,
  buildAnnotationStylePayload,
  buildBoxAnnotationPayload,
  buildBoxGeometryUpdatePayload,
  buildCubeAnnotationPayload,
  buildManualAnnotationPayload,
  buildMeasurementAnnotationPayload,
  buildMeasurementLineUpdatePayload,
  buildSourceImageOverlayStylePatch,
  classifyMeasurementLine,
  getNextMeasurementName,
} from '../inspectionAnnotationPayloads';

describe('inspectionAnnotationPayloads', () => {
  test('classifies and names measurement lines', () => {
    expect(classifyMeasurementLine({ x1: 0, y1: 0, x2: 100, y2: 5 })).toBe('Horizontal');
    expect(classifyMeasurementLine({ x1: 0, y1: 0, x2: 5, y2: 100 })).toBe('Vertical');
    expect(classifyMeasurementLine({ x1: 0, y1: 0, x2: 50, y2: 60 })).toBe('Diagonal');
    expect(getNextMeasurementName([{ kind: 'Vertical' }, { kind: 'Horizontal' }], 'Vertical')).toBe('Vertical line 2');
  });

  test('builds the manual annotation payload with a custom defect type', () => {
    expect(buildManualAnnotationPayload({
      annotationDraft: {
        defect_class: 'Other', modality: '', comment: ' ', disposition: 'open', measurement_name: 'depth', measurement_value: '1.234',
      },
      customDefectTypeDraft: ' Scratch ',
      enabledModalities: [],
      modalityOptions: ['xray'],
    })).toEqual({
      defect_class: 'Scratch', modality: 'xray', comment: null, disposition: 'open', measurements: { depth: 1.23 }, hidden: false,
    });
  });

  test('builds measurement and box create payloads', () => {
    const line = { x1: 10, y1: 20, x2: 13, y2: 24, imageWidth: 100, imageHeight: 100 };
    const measurement = buildMeasurementAnnotationPayload({
      annotationImageId: 7, line, color: '#fff', distanceMm: 2.5, modality: 'visual', metadataPatch: { a: 1 },
    });
    expect(measurement).toMatchObject({
      annotation_kind: 'measurement', image_id: '7', comment: 'Captured from measurement tool.',
      measurements: { length_px: 5, length_mm: 2.5 }, geometry: { line },
      metadata: { measurement_color: '#fff', annotation_color: '#fff', a: 1 },
      bbox: { x: 10, y: 20, width: 3, height: 4 },
    });
    const box = { x: 1, y: 2, width: 10, height: 20, imageWidth: 50, imageHeight: 60 };
    const boxPayload = buildBoxAnnotationPayload({ annotationImageId: null, box, color: '#000', modality: 'visual', pixelsPerMm: 2 });
    expect(boxPayload).toMatchObject({
      image_id: null, defect_class: 'Bounding Box', comment: 'Captured from draw box tool.',
      measurements: { width_px: 10, height_px: 20, width_mm: 5, height_mm: 10 },
      geometry: { imageWidth: 50, imageHeight: 60, box },
      bbox: { x: 1, y: 2, width: 10, height: 20 },
    });
    expect(buildBoxAnnotationPayload({ box, pixelsPerMm: 0 }).measurements).toEqual({ width_px: 10, height_px: 20 });
  });

  test('builds cube payloads only across distinct slices', () => {
    const firstBox = { x: 0, y: 0, width: 4, height: 4, sliceIndex: 2, imageWidth: 10, imageHeight: 10 };
    const secondBox = { x: 2, y: 1, width: 4, height: 5, sliceIndex: 5 };
    expect(buildCubeAnnotationPayload({ axis: 'axial', firstBox, secondBox: { ...secondBox, sliceIndex: 2 } })).toBeNull();
    const payload = buildCubeAnnotationPayload({ axis: 'axial', firstBox, secondBox, color: '#abc' });
    expect(payload).toMatchObject({
      defect_class: '3D Box', modality: 'volume', image_id: null,
      measurements: { width_px: 6, height_px: 6, depth_slices: 3 },
      geometry: { cube: { axis: 'axial', startSlice: 2, endSlice: 5, imageWidth: 10, imageHeight: 10 } },
      bbox: { x: 0, y: 0, width: 6, height: 6 },
    });
  });

  test('builds geometry update payloads that keep existing geometry and metadata', () => {
    const calibratedLine = { x1: 0, y1: 0, x2: 3, y2: 4, distancePx: 5, distanceMm: 1, imageId: 'i' };
    const existingAnnotation = { geometry: { keep: 1 }, metadata: { keepMeta: 2 } };
    expect(buildMeasurementLineUpdatePayload({ existingAnnotation, annotationImageId: '', calibratedLine, color: 'red' })).toEqual({
      image_id: 'i', geometry: { keep: 1, line: calibratedLine }, measurements: { length_px: 5, length_mm: 1 },
      metadata: { keepMeta: 2, measurement_color: 'red', annotation_color: 'red' }, bbox: { x: 0, y: 0, width: 3, height: 4 },
    });
    expect(applyCalibratedMeasurementLine([{ id: 1, kind: 'k' }, { id: 2 }], '1', calibratedLine, 'red')[0])
      .toMatchObject({ id: 1, kind: 'k', color: 'red', distancePx: 5, x2: 3 });
    const nextBox = { x: 1, y: 1, width: 2, height: 3, imageWidth: 9, imageHeight: 9, axis: 'coronal', sliceIndex: 4, color: 'blue' };
    expect(buildBoxGeometryUpdatePayload({ existingAnnotation, annotationImageId: 3, nextBox, pixelsPerMm: 0 })).toMatchObject({
      image_id: '3',
      geometry: { keep: 1, axis: 'coronal', slice_index: 4, box: { x: 1, axis: 'coronal', slice_index: 4 } },
      measurements: { width_px: 2, height_px: 3 },
      metadata: { keepMeta: 2, annotation_color: 'blue' },
    });
  });

  test('builds style payloads for annotations and source-image overlays', () => {
    expect(buildSourceImageOverlayStylePatch({ fill_opacity: 3, color: '#123456' })).toEqual({ overlay_color: '#123456', overlay_opacity: 1 });
    const selected = { defect_class: 'Crack', comment: 'c', metadata: { x: 1 } };
    expect(buildAnnotationStylePayload(selected, { defect_class: ' ' })).toBeNull();
    expect(buildAnnotationStylePayload(selected, { fill_opacity: 0.4, color: '#00ff00' })).toMatchObject({
      defect_class: 'Crack', comment: 'c', measurements: {}, disposition: 'open',
      metadata: { x: 1, annotation_color: '#00ff00', measurement_color: '#00ff00', annotation_fill_opacity: 0.4 },
    });
  });
});
