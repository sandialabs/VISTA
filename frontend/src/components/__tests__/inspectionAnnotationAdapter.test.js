import {
  annotationToPt3VectorAnnotation,
  annotationToVectorSegment,
  buildInspectionAnnotationItems,
  getInspectionAnnotationDisplayName,
  getInspectionAnnotationKind,
  getInspectionAnnotationTypeLabel,
  makeVistaSegmentAnnotationPayload,
} from '../inspectionAnnotationAdapter';

describe('inspectionAnnotationAdapter', () => {
  test('infers legacy annotation kinds without rewriting them', () => {
    expect(getInspectionAnnotationKind({ geometry: { line: {} } })).toBe('measurement');
    expect(getInspectionAnnotationKind({ geometry: { segment: {} } })).toBe('vista_segment');
    expect(getInspectionAnnotationKind({ geometry: { box: {} } })).toBe('annotation');
  });

  test('combines annotations and deduplicated assigned overlays', () => {
    const items = buildInspectionAnnotationItems(
      [{
        id: 'a-1',
        annotation_kind: 'measurement',
        defect_class: 'Measurement',
        comment: 'Bearing width',
        measurements: { length_mm: 4.2 },
        hidden: true,
      }],
      [
        { overlay: true, imageId: 'overlay-1', label: 'Pore mask' },
        { overlay: true, imageId: 'overlay-1', label: 'Pore mask duplicate' },
        { overlay: false, imageId: 'source-1' },
      ],
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: 'annotation:a-1',
      kind: 'measurement',
      typeLabel: 'Measurement',
      displayName: '4.20 mm',
      visible: false,
    });
    expect(items[1]).toMatchObject({
      key: 'overlay:overlay-1',
      kind: 'external_overlay',
      typeLabel: 'External overlay',
      displayName: 'External: Pore mask',
      visible: true,
    });
  });

  test('lists Anomalib heatmap analysis output as an Analysis overlay', () => {
    const items = buildInspectionAnnotationItems([], [{
      filename: 'sample_image_ab12cd34_analyze-overlay.png',
      image_id: 'anomalib-overlay-image',
      imageId: 'anomalib-overlay-image',
      label: 'Anomaly Heatmap :: Anomalib',
      overlay: true,
      analysis_output: true,
      analysis_method_id: 'segmentation.anomalib.placeholder',
      analysis_method_name: 'Anomalib',
      analysis_overlay_type: 'heatmap',
      analysis_source_image_id: 'source-image-1',
      overlay_base_image_id: 'source-image-1',
      metadata: { analysis_overlay_type: 'heatmap' },
    }]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'overlay:anomalib-overlay-image',
      kind: 'external_overlay',
      label: 'Anomaly Heatmap :: Anomalib',
      typeLabel: 'Analysis overlay',
      displayName: 'Analysis: Anomaly Heatmap :: Anomalib',
      visible: true,
      source: { resource: 'source_image', resourceId: 'anomalib-overlay-image' },
    });
  });

  test('uses one canonical MPR presentation for measurements, boxes, comments, and fallback labels', () => {
    expect(getInspectionAnnotationTypeLabel({
      defect_class: 'Porosity',
      bbox: { width: 8, height: 4 },
    })).toBe('Porosity');
    expect(getInspectionAnnotationDisplayName({
      measurements: { width_mm: 7.5, height_mm: 3.25 },
    })).toBe('7.50 x 3.25 mm');
    expect(getInspectionAnnotationDisplayName({
      comment: 'Surface indication',
    })).toBe('Surface indication');
    expect(getInspectionAnnotationDisplayName({
      defect_class: 'Crack',
    })).toBe('Crack');
  });

  test('trims semantic names and falls back when defect and comment labels are blank', () => {
    const named = buildInspectionAnnotationItems([{
      id: 'named',
      defect_class: '  Porosity  ',
      comment: '  Surface indication  ',
    }])[0];
    expect(named).toMatchObject({
      label: 'Surface indication',
      typeLabel: 'Porosity',
      displayName: 'Surface indication',
    });

    const unnamed = buildInspectionAnnotationItems([{
      id: 'unnamed',
      defect_class: '   ',
      comment: '\t',
    }])[0];
    expect(unnamed).toMatchObject({
      label: 'Annotation',
      typeLabel: 'Annotation',
      displayName: 'Annotation',
    });

    const segment = {
      id: 'blank-segment',
      annotation_kind: 'vista_segment',
      defect_class: ' ',
      comment: '\n',
      geometry: {
        segment: {
          axis: 'axial',
          min_slice: 1,
          max_slice: 1,
          image_width: 8,
          image_height: 6,
          areas: [{ tool: 'rectangle', start: { x: 1, y: 1 }, end: { x: 3, y: 3 } }],
        },
      },
    };
    expect(buildInspectionAnnotationItems([segment])[0]).toMatchObject({
      label: 'Segment',
      displayName: 'Segment',
    });
    expect(annotationToVectorSegment(segment).label).toBe('Segment');

    const overlay = buildInspectionAnnotationItems([], [{
      overlay: true,
      imageId: 'overlay-blank-label',
      label: '  ',
      filename: '  pore-mask.npy  ',
    }])[0];
    expect(overlay).toMatchObject({
      label: 'pore-mask.npy',
      displayName: 'External: pore-mask.npy',
    });
  });

  test('assigns deterministic unique React keys without changing duplicate or empty resource IDs', () => {
    const annotations = [
      { id: 'duplicate', comment: 'First' },
      { id: 'duplicate', comment: 'Second' },
      { id: '', comment: 'Missing one' },
      { comment: 'Missing two' },
      { id: 'duplicate', comment: 'Third' },
    ];
    const first = buildInspectionAnnotationItems(annotations);
    const second = buildInspectionAnnotationItems(
      annotations.map((annotation) => ({ ...annotation })),
    );

    expect(first.map((item) => item.key)).toEqual([
      'annotation:duplicate',
      'annotation:duplicate::2',
      'annotation:<missing>::1',
      'annotation:<missing>::2',
      'annotation:duplicate::3',
    ]);
    expect(new Set(first.map((item) => item.key)).size).toBe(first.length);
    expect(second.map((item) => item.key)).toEqual(first.map((item) => item.key));
    expect(first.map((item) => item.id)).toEqual(['duplicate', 'duplicate', '', '', 'duplicate']);
    expect(first.map((item) => item.source.resourceId))
      .toEqual(['duplicate', 'duplicate', '', '', 'duplicate']);
  });

  test('round-trips a persisted vector segment contract', () => {
    const payload = makeVistaSegmentAnnotationPayload({
      label: 'Internal pore',
      color: '#00ffaa',
      axis: 'coronal',
      minSlice: 3,
      maxSlice: 9,
      imageWidth: 80,
      imageHeight: 40,
      areas: [{ id: 'shape-1', tool: 'rectangle', operation: 'add' }],
      visible: false,
    });
    expect(payload).toMatchObject({
      annotation_kind: 'vista_segment',
      defect_class: 'Internal pore',
      hidden: true,
      geometry: { segment: { axis: 'coronal', min_slice: 3, max_slice: 9 } },
    });
    expect(annotationToVectorSegment({ id: 'segment-1', ...payload })).toMatchObject({
      id: 'segment-1',
      label: 'Internal pore',
      color: '#00ffaa',
      visible: false,
      axis: 'coronal',
      minSlice: 3,
      maxSlice: 9,
      imageWidth: 80,
      imageHeight: 40,
    });
    expect(annotationToPt3VectorAnnotation({ id: 'segment-1', ...payload }))
      .toEqual(annotationToVectorSegment({ id: 'segment-1', ...payload }));
  });

  test.each([
    ['axial', 3],
    ['coronal', 4],
    ['sagittal', 5],
  ])('converts an MPR measurement on %s to a one-slice vector brush', (axis, sliceIndex) => {
    const annotation = {
      id: `line-${axis}`,
      annotation_kind: 'measurement',
      defect_class: 'Measurement',
      comment: `${axis} line`,
      measurements: { length_px: 9.25 },
      geometry: {
        axis,
        slice_index: sliceIndex,
        line: {
          x1: 1,
          y1: 2,
          x2: 8,
          y2: 6,
          imageWidth: 20,
          imageHeight: 12,
          axis,
          slice_index: sliceIndex,
        },
      },
      metadata: { measurement_color: '#00ffaa' },
      hidden: true,
    };

    expect(annotationToPt3VectorAnnotation(annotation)).toMatchObject({
      id: `line-${axis}`,
      label: '9.3 px',
      color: '#00ffaa',
      visible: false,
      axis,
      minSlice: sliceIndex,
      maxSlice: sliceIndex,
      imageWidth: 20,
      imageHeight: 12,
      areas: [{
        tool: 'brush',
        operation: 'add',
        brushSize: 2,
        points: [{ x: 1, y: 2 }, { x: 8, y: 6 }],
      }],
    });
  });

  test('converts an MPR box to one slice and a cube to an inclusive slice range', () => {
    const box = {
      id: 'box-1',
      defect_class: 'Porosity',
      measurements: { width_px: 6, height_px: 5 },
      bbox: { x: 2, y: 3, width: 6, height: 5 },
      geometry: {
        axis: 'coronal',
        slice_index: 7,
        imageWidth: 18,
        imageHeight: 14,
        box: {
          x: 2,
          y: 3,
          width: 6,
          height: 5,
          axis: 'coronal',
          slice_index: 7,
          imageWidth: 18,
          imageHeight: 14,
        },
      },
    };
    expect(annotationToPt3VectorAnnotation(box)).toMatchObject({
      axis: 'coronal',
      minSlice: 7,
      maxSlice: 7,
      imageWidth: 18,
      imageHeight: 14,
      areas: [{
        tool: 'rectangle',
        start: { x: 2, y: 3 },
        end: { x: 8, y: 8 },
      }],
    });

    const cube = {
      id: 'cube-1',
      defect_class: '3D Box',
      geometry: {
        cube: {
          axis: 'sagittal',
          startSlice: 9,
          endSlice: 3,
          x: 4,
          y: 5,
          width: 8,
          height: 6,
          imageWidth: 24,
          imageHeight: 16,
        },
      },
    };
    expect(annotationToPt3VectorAnnotation(cube)).toMatchObject({
      axis: 'sagittal',
      minSlice: 3,
      maxSlice: 9,
      imageWidth: 24,
      imageHeight: 16,
      areas: [{
        tool: 'rectangle',
        start: { x: 4, y: 5 },
        end: { x: 12, y: 11 },
      }],
    });
  });

  test.each([
    ['nonspatial annotation', { id: 'plain', comment: 'No geometry' }],
    ['tile line without an MPR axis', {
      geometry: { line: { x1: 1, y1: 2, x2: 3, y2: 4, imageWidth: 10, imageHeight: 10 } },
    }],
    ['line without a slice', {
      geometry: { axis: 'axial', line: { x1: 1, y1: 2, x2: 3, y2: 4, imageWidth: 10, imageHeight: 10 } },
    }],
    ['box with invalid dimensions', {
      bbox: { x: 1, y: 2, width: 0, height: 4 },
      geometry: {
        axis: 'axial',
        slice_index: 2,
        imageWidth: 10,
        imageHeight: 10,
        box: { axis: 'axial', slice_index: 2, imageWidth: 10, imageHeight: 10 },
      },
    }],
    ['cube with an invalid axis', {
      geometry: {
        cube: {
          axis: 'diagonal',
          startSlice: 1,
          endSlice: 3,
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          imageWidth: 10,
          imageHeight: 10,
        },
      },
    }],
  ])('does not fabricate 3D placement for %s', (_label, annotation) => {
    expect(annotationToPt3VectorAnnotation(annotation)).toBeNull();
  });

  test('clamps invalid segment ranges and opacity', () => {
    const payload = makeVistaSegmentAnnotationPayload({
      axis: 'invalid',
      minSlice: -4,
      maxSlice: -10,
      imageWidth: 0,
      imageHeight: Number.NaN,
      opacity: 5,
    });
    expect(payload.geometry.segment).toMatchObject({
      axis: 'axial',
      min_slice: 0,
      max_slice: 0,
      image_width: 1,
      image_height: 1,
    });
    expect(payload.metadata.annotation_fill_opacity).toBe(1);
  });

  test('round-trips canonical volumetric area runs without changing legacy planar payloads', () => {
    const payload = makeVistaSegmentAnnotationPayload({
      axis: 'axial',
      minSlice: 2,
      maxSlice: 2,
      imageWidth: 8,
      imageHeight: 6,
      volumeDimensions: [8, 6, 4],
      areas: [
        {
          id: 'sphere-1',
          tool: 'brush',
          mode: '3d',
          operation: 'add',
          volumeDimensions: [8, 6, 4],
          volumeRuns: [
            [0, 1, 2, 5],
            [1, 1, 2, 6],
            [1, 1, 4, 4],
            [Number.NaN, 1, 0, 1],
          ],
          seedVoxel: [3, 1, 1],
          spacing: [0.5, 0.5, 1],
          voxelCount: 7,
          connectivity: 6,
          truncated: false,
        },
      ],
    });
    expect(payload.geometry.segment).toMatchObject({
      version: 2,
      volume_dimensions: [8, 6, 4],
      areas: [{
        id: 'sphere-1',
        tool: 'brush',
        mode: '3d',
        operation: 'add',
        volumeDimensions: [8, 6, 4],
        volumeRuns: [[0, 1, 2, 5], [1, 1, 2, 6]],
        seedVoxel: [3, 1, 1],
        spacing: [0.5, 0.5, 1],
        voxelCount: 7,
        connectivity: 6,
        truncated: false,
      }],
    });
    expect(annotationToVectorSegment({ id: 'volume-segment', ...payload })).toMatchObject({
      id: 'volume-segment',
      version: 2,
      volumeDimensions: [8, 6, 4],
      areas: [expect.objectContaining({ mode: '3d', volumeRuns: [[0, 1, 2, 5], [1, 1, 2, 6]] })],
    });

    const planar = makeVistaSegmentAnnotationPayload({
      axis: 'axial',
      imageWidth: 8,
      imageHeight: 6,
      areas: [{ tool: 'brush', points: [{ x: 1, y: 1 }] }],
    });
    expect(planar.geometry.segment.version).toBe(1);
    expect(planar.geometry.segment).not.toHaveProperty('volume_dimensions');
  });

  test('does not let an empty volume-run alias hide populated legacy runs', () => {
    const payload = makeVistaSegmentAnnotationPayload({
      axis: 'axial',
      imageWidth: 4,
      imageHeight: 4,
      volumeDimensions: [4, 4, 4],
      areas: [{
        tool: 'volume-mask',
        mode: '3d',
        volumeRuns: [],
        volume_runs: [[1, 2, 0, 3]],
      }],
    });

    expect(payload.geometry.segment.areas[0].volumeRuns).toEqual([[1, 2, 0, 3]]);
  });

  test('persists only canonical source-space segment area geometry', () => {
    const transientPoint = (x, y) => ({
      x,
      y,
      displayX: x * 10,
      displayY: y * 10,
      stageWidth: 900,
      stageHeight: 600,
      imageWidth: 90,
      imageHeight: 60,
      cachedPixels: new Array(4).fill(255),
    });
    const payload = makeVistaSegmentAnnotationPayload({
      axis: 'axial',
      imageWidth: 90,
      imageHeight: 60,
      areas: [
        {
          id: 'brush-1',
          tool: 'brush',
          operation: 'subtract',
          axis: 'axial',
          sliceIndex: 8,
          imageWidth: 90,
          imageHeight: 60,
          brushSize: 7,
          points: [transientPoint(3, 4), transientPoint(8, 9), { x: Infinity, y: 2 }],
          displayX: 100,
          stageWidth: 900,
        },
        {
          id: 'rectangle-1',
          tool: 'rectangle',
          operation: 'add',
          start: transientPoint(5, 6),
          end: transientPoint(30, 28),
          points: [transientPoint(5, 6), transientPoint(30, 28)],
        },
        {
          id: 'circle-1',
          tool: 'circle',
          operation: 'add',
          center: transientPoint(20, 15),
          edge: transientPoint(25, 15),
          seed: transientPoint(20, 15),
          radius: 5,
          closed: true,
        },
        {
          id: 'connected-1',
          tool: 'connected',
          operation: 'add',
          seed: transientPoint(2, 3),
          maskPath: 'M 1 2 h 4 v 1 h -4 Z',
          mask_runs: [
            [2, 1, 5],
            { row: 3, x: 2, x2: 6, displayX: 20 },
            [Number.NaN, 0, 1],
          ],
          bbox: [1, 2, 6, 4],
          canvasWidth: 90,
          canvasHeight: 60,
          seedColor: [10, 20, 30, 255],
          areaPx: 8,
        },
        {
          id: 'ml-1',
          tool: 'ml-helper',
          operation: 'add',
          bbox: [10, 12, 30, 32],
          points: [transientPoint(15, 20)],
          label: 4,
          area_px: 400,
          class_name: 'void',
          confidence: 0.92,
          method_id: 'segmentation.sam.placeholder',
          method_label: 'SAM',
          imageWidth: 90,
          imageHeight: 60,
          decodedPixels: [1, 2, 3],
          mlCache: { result: 'transient' },
        },
      ],
    });

    expect(payload.geometry.segment.areas).toEqual([
      {
        id: 'brush-1',
        tool: 'brush',
        operation: 'subtract',
        axis: 'axial',
        sliceIndex: 8,
        imageWidth: 90,
        imageHeight: 60,
        brushSize: 7,
        points: [{ x: 3, y: 4 }, { x: 8, y: 9 }],
      },
      {
        id: 'rectangle-1',
        tool: 'rectangle',
        operation: 'add',
        points: [{ x: 5, y: 6 }, { x: 30, y: 28 }],
        start: { x: 5, y: 6 },
        end: { x: 30, y: 28 },
      },
      {
        id: 'circle-1',
        tool: 'circle',
        operation: 'add',
        radius: 5,
        closed: true,
        center: { x: 20, y: 15 },
        edge: { x: 25, y: 15 },
        seed: { x: 20, y: 15 },
      },
      {
        id: 'connected-1',
        tool: 'connected',
        operation: 'add',
        seed: { x: 2, y: 3 },
        bbox: [1, 2, 6, 4],
        maskPath: 'M 1 2 h 4 v 1 h -4 Z',
        maskRuns: [[2, 1, 5], [3, 2, 6]],
        canvasWidth: 90,
        canvasHeight: 60,
        areaPx: 8,
        seedColor: [10, 20, 30, 255],
      },
      {
        id: 'ml-1',
        tool: 'ml-helper',
        operation: 'add',
        points: [{ x: 15, y: 20 }],
        bbox: [10, 12, 30, 32],
        areaPx: 400,
        confidence: 0.92,
        className: 'void',
        methodId: 'segmentation.sam.placeholder',
        methodLabel: 'SAM',
        label: 4,
        imageWidth: 90,
        imageHeight: 60,
      },
    ]);

    const transientKeys = new Set([
      'displayX',
      'displayY',
      'stageWidth',
      'stageHeight',
      'cachedPixels',
      'decodedPixels',
      'mlCache',
    ]);
    const assertCanonical = (value) => {
      if (Array.isArray(value)) {
        value.forEach(assertCanonical);
        return;
      }
      if (!value || typeof value !== 'object') return;
      Object.entries(value).forEach(([key, child]) => {
        expect(transientKeys).not.toContain(key);
        assertCanonical(child);
      });
    };
    assertCanonical(payload.geometry.segment.areas);
    payload.geometry.segment.areas.flatMap((area) => (
      [area.start, area.end, area.center, area.edge, area.seed, ...(area.points || [])].filter(Boolean)
    )).forEach((point) => expect(Object.keys(point).sort()).toEqual(['x', 'y']));
  });
});
