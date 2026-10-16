import {
  buildPt3SegmentMask,
  buildPt3SegmentVolumeRuns,
  buildPt3SegmentVolumeSliceMask,
  buildPt3VectorAnnotationFaces,
  forEachPt3VectorFaceVoxelPolygon,
  getInclusiveVectorSliceRange,
  mapVectorPlanePointToVoxel,
  MAX_VECTOR_AREAS,
  MAX_VECTOR_FACES,
  MAX_VECTOR_MASK_RUNS,
  MAX_VECTOR_PRIMITIVES,
  pt3SegmentMaskContainsPoint,
  pt3SegmentMaskToSvgPath,
  renderPt3VectorAnnotations,
} from '../pt3VectorAnnotations';
import { annotationToPt3VectorAnnotation } from '../inspectionAnnotationAdapter';
import { rasterizeSphereStroke } from '../pt3SegmentationVolume';
import { voxelToPhysical } from '../pt3VolumeGeometry';

const metadata = {
  dimensions: [11, 9, 7],
  spacing: [0.5, 0.75, 2],
  origin: [10, -2, 4],
};

function rectangleAnnotation(overrides = {}) {
  return {
    id: 'segment-a',
    label: 'Segment A',
    color: '#22d3ee',
    visible: true,
    axis: 'axial',
    minSlice: 2,
    maxSlice: 4,
    imageWidth: 11,
    imageHeight: 9,
    areas: [{ tool: 'rectangle', operation: 'add', start: { x: 2, y: 1 }, end: { x: 7, y: 6 } }],
    ...overrides,
  };
}

function makeContext() {
  return {
    canvas: { width: 640, height: 480 },
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    setLineDash: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
  };
}

function collectFaceVoxelPolygons(face) {
  const polygons = [];
  forEachPt3VectorFaceVoxelPolygon(face, (polygon) => polygons.push(polygon));
  return polygons;
}

function collectSurfaceVoxelPolygons(faces, surface) {
  return faces
    .filter((face) => face.surface === surface)
    .flatMap(collectFaceVoxelPolygons);
}

describe('PT3 vector annotation registration', () => {
  test.each([
    ['line', 'axial', 0, 2, 2],
    ['box', 'axial', 6, 2, 2],
    ['line', 'coronal', 0, 1, 0.75],
    ['box', 'coronal', 8, 1, 0.75],
    ['line', 'sagittal', 0, 0, 0.5],
    ['box', 'sagittal', 10, 0, 0.5],
  ])('renders converted %s geometry on the %s boundary slice with exact physical thickness', (
    kind,
    axis,
    sliceIndex,
    constantCoordinate,
    expectedPhysicalThickness,
  ) => {
    const planeDimensions = {
      axial: [11, 9],
      coronal: [11, 7],
      sagittal: [9, 7],
    };
    const [imageWidth, imageHeight] = planeDimensions[axis];
    const sharedGeometry = {
      axis,
      slice_index: sliceIndex,
      imageWidth,
      imageHeight,
    };
    const annotation = kind === 'line'
      ? {
        id: `${axis}-line-${sliceIndex}`,
        annotation_kind: 'measurement',
        geometry: {
          ...sharedGeometry,
          line: {
            ...sharedGeometry,
            x1: 1,
            y1: 1,
            x2: imageWidth - 2,
            y2: imageHeight - 2,
          },
        },
      }
      : {
        id: `${axis}-box-${sliceIndex}`,
        bbox: { x: 1, y: 1, width: imageWidth - 3, height: imageHeight - 3 },
        geometry: {
          ...sharedGeometry,
          box: {
            ...sharedGeometry,
            x: 1,
            y: 1,
            width: imageWidth - 3,
            height: imageHeight - 3,
          },
        },
      };
    const converted = annotationToPt3VectorAnnotation(annotation);
    const { faces } = buildPt3VectorAnnotationFaces([converted], metadata);
    const lowerPoints = collectSurfaceVoxelPolygons(faces, 'lower').flat();
    const upperPoints = collectSurfaceVoxelPolygons(faces, 'upper').flat();
    const expectedLower = sliceIndex - 0.5;
    const expectedUpper = sliceIndex + 0.5;

    expect(converted).toMatchObject({ axis, minSlice: sliceIndex, maxSlice: sliceIndex });
    expect(lowerPoints.length).toBeGreaterThan(0);
    expect(upperPoints.length).toBeGreaterThan(0);
    expect(lowerPoints.every((point) => point[constantCoordinate] === expectedLower)).toBe(true);
    expect(upperPoints.every((point) => point[constantCoordinate] === expectedUpper)).toBe(true);

    const lowerPhysical = voxelToPhysical(lowerPoints[0], metadata);
    const matchingUpperPoint = [...lowerPoints[0]];
    matchingUpperPoint[constantCoordinate] = expectedUpper;
    const upperPhysical = voxelToPhysical(matchingUpperPoint, metadata);
    expect(Math.hypot(
      upperPhysical[0] - lowerPhysical[0],
      upperPhysical[1] - lowerPhysical[1],
      upperPhysical[2] - lowerPhysical[2],
    )).toBeCloseTo(expectedPhysicalThickness, 10);
  });

  test('renders a converted cube through its inclusive slice range and respects visibility gates', () => {
    const cubeAnnotation = {
      id: 'inclusive-coronal-cube',
      defect_class: '3D Box',
      geometry: {
        cube: {
          axis: 'coronal',
          startSlice: 6,
          endSlice: 2,
          x: 1,
          y: 1,
          width: 7,
          height: 4,
          imageWidth: 11,
          imageHeight: 7,
        },
      },
    };
    const converted = annotationToPt3VectorAnnotation(cubeAnnotation);
    const built = buildPt3VectorAnnotationFaces([converted], metadata);
    const lowerPoints = collectSurfaceVoxelPolygons(built.faces, 'lower').flat();
    const upperPoints = collectSurfaceVoxelPolygons(built.faces, 'upper').flat();

    expect(converted).toMatchObject({ axis: 'coronal', minSlice: 2, maxSlice: 6 });
    expect(lowerPoints.every((point) => point[1] === 1.5)).toBe(true);
    expect(upperPoints.every((point) => point[1] === 6.5)).toBe(true);
    expect(6.5 - 1.5).toBe(5);
    expect((6.5 - 1.5) * metadata.spacing[1]).toBeCloseTo(3.75, 10);

    const hidden = annotationToPt3VectorAnnotation({ ...cubeAnnotation, hidden: true });
    expect(buildPt3VectorAnnotationFaces([hidden], metadata).faces).toEqual([]);
    expect(buildPt3VectorAnnotationFaces(
      [converted],
      metadata,
      { showAnnotations: false },
    ).faces).toEqual([]);
  });

  test('maps continuous source-image boundaries onto canonical voxel faces for every MPR plane', () => {
    expect(mapVectorPlanePointToVoxel({
      axis: 'axial',
      point: { x: 0, y: 0 },
      sliceIndex: 3,
      imageWidth: 3,
      imageHeight: 5,
      dimensions: metadata.dimensions,
    })).toEqual([-0.5, -0.5, 3]);
    expect(mapVectorPlanePointToVoxel({
      axis: 'axial',
      point: { x: 3, y: 5 },
      sliceIndex: 3,
      imageWidth: 3,
      imageHeight: 5,
      dimensions: metadata.dimensions,
    })).toEqual([10.5, 8.5, 3]);

    expect(mapVectorPlanePointToVoxel({
      axis: 'coronal',
      point: { x: 0, y: 0 },
      sliceIndex: 2,
      imageWidth: 3,
      imageHeight: 4,
      dimensions: metadata.dimensions,
    })).toEqual([-0.5, 2, 6.5]);
    expect(mapVectorPlanePointToVoxel({
      axis: 'coronal',
      point: { x: 3, y: 4 },
      sliceIndex: 2,
      imageWidth: 3,
      imageHeight: 4,
      dimensions: metadata.dimensions,
    })).toEqual([10.5, 2, -0.5]);

    expect(mapVectorPlanePointToVoxel({
      axis: 'sagittal',
      point: { x: 0, y: 0 },
      sliceIndex: 6,
      imageWidth: 5,
      imageHeight: 4,
      dimensions: metadata.dimensions,
    })).toEqual([6, -0.5, 6.5]);
    expect(mapVectorPlanePointToVoxel({
      axis: 'sagittal',
      point: { x: 5, y: 4 },
      sliceIndex: 6,
      imageWidth: 5,
      imageHeight: 4,
      dimensions: metadata.dimensions,
    })).toEqual([6, 8.5, -0.5]);
  });

  test('keeps geometry in the final source-pixel column nondegenerate', () => {
    const { faces } = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({
        areas: [{
          tool: 'rectangle',
          operation: 'add',
          start: { x: 10, y: 1 },
          end: { x: 11, y: 2 },
        }],
      }),
    ], metadata);
    const lowerFace = faces.find((face) => face.surface === 'lower');
    const lowerPoints = collectFaceVoxelPolygons(lowerFace).flat();
    expect([...new Set(lowerPoints.map((point) => point[0]))].sort((a, b) => a - b))
      .toEqual([9.5, 10.5]);
  });

  test('treats min and max slices as inclusive voxel ranges', () => {
    expect(getInclusiveVectorSliceRange({
      axis: 'axial',
      minSlice: 4,
      maxSlice: 2,
      dimensions: metadata.dimensions,
    })).toEqual({ minSlice: 2, maxSlice: 4, lowerFace: 1.5, upperFace: 4.5 });
    expect(getInclusiveVectorSliceRange({
      axis: 'coronal',
      minSlice: 3,
      maxSlice: 3,
      dimensions: metadata.dimensions,
    })).toEqual({ minSlice: 3, maxSlice: 3, lowerFace: 2.5, upperFace: 3.5 });
    expect(getInclusiveVectorSliceRange({
      axis: 'axial',
      minSlice: -8,
      maxSlice: -2,
      dimensions: metadata.dimensions,
    })).toBeNull();
    expect(getInclusiveVectorSliceRange({
      axis: 'axial',
      minSlice: 7,
      maxSlice: 12,
      dimensions: metadata.dimensions,
    })).toBeNull();
    expect(getInclusiveVectorSliceRange({
      axis: 'axial',
      minSlice: -4,
      maxSlice: 2,
      dimensions: metadata.dimensions,
    })).toEqual({ minSlice: 0, maxSlice: 2, lowerFace: -0.5, upperFace: 2.5 });
    expect(getInclusiveVectorSliceRange({
      axis: 'axial',
      minSlice: 5,
      maxSlice: 10,
      dimensions: metadata.dimensions,
    })).toEqual({ minSlice: 5, maxSlice: 6, lowerFace: 4.5, upperFace: 6.5 });

    const { faces } = buildPt3VectorAnnotationFaces([rectangleAnnotation()], metadata);
    expect(collectSurfaceVoxelPolygons(faces, 'lower').flat().every((point) => point[2] === 1.5)).toBe(true);
    expect(collectSurfaceVoxelPolygons(faces, 'upper').flat().every((point) => point[2] === 4.5)).toBe(true);

    expect(buildPt3VectorAnnotationFaces([
      rectangleAnnotation({ minSlice: 8, maxSlice: 12 }),
    ], metadata).faces).toEqual([]);
    const clipped = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({ minSlice: 5, maxSlice: 12 }),
    ], metadata);
    expect(collectSurfaceVoxelPolygons(clipped.faces, 'lower').flat()
      .every((point) => point[2] === 4.5)).toBe(true);
    expect(collectSurfaceVoxelPolygons(clipped.faces, 'upper').flat()
      .every((point) => point[2] === 6.5)).toBe(true);
  });

  test.each([
    ['axial', 11, 9, 2, 1.5, 4.5],
    ['coronal', 11, 7, 1, 0.5, 3.5],
    ['sagittal', 9, 7, 0, -0.5, 2.5],
  ])('keeps a composited hole registered through the %s slice range', (
    axis,
    imageWidth,
    imageHeight,
    constantCoordinate,
    expectedLower,
    expectedUpper,
  ) => {
    const built = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({
        axis,
        minSlice: expectedLower + 0.5,
        maxSlice: expectedUpper - 0.5,
        imageWidth,
        imageHeight,
        areas: [
          { tool: 'rectangle', operation: 'add', start: { x: 1, y: 1 }, end: { x: imageWidth - 1, y: imageHeight - 1 } },
          { tool: 'circle', operation: 'subtract', center: { x: imageWidth / 2, y: imageHeight / 2 }, radius: 1.5 },
        ],
      }),
    ], metadata);
    const lowerFaces = built.faces.filter((face) => face.surface === 'lower');
    const upperFaces = built.faces.filter((face) => face.surface === 'upper');

    expect(built.stats.subtractAreasApplied).toBe(1);
    expect(lowerFaces.length).toBeGreaterThan(0);
    expect(upperFaces.length).toBe(lowerFaces.length);
    expect(lowerFaces.flatMap(collectFaceVoxelPolygons).flat().every((point) => point[constantCoordinate] === expectedLower)).toBe(true);
    expect(upperFaces.flatMap(collectFaceVoxelPolygons).flat().every((point) => point[constantCoordinate] === expectedUpper)).toBe(true);
  });

  test('supports bounded rectangle, circle, polygon, brush, connected-run, and bbox geometry', () => {
    const annotation = rectangleAnnotation({
      minSlice: 1,
      maxSlice: 1,
      areas: [
        { tool: 'rectangle', start: { x: 1, y: 1 }, end: { x: 3, y: 3 } },
        { tool: 'circle', center: { x: 5, y: 4 }, radius: 2 },
        { tool: 'polygon', points: [{ x: 1, y: 5 }, { x: 3, y: 7 }, { x: 4, y: 5 }] },
        { tool: 'brush', brushSize: 2, points: [{ x: 5, y: 1 }, { x: 7, y: 2 }, { x: 8, y: 4 }] },
        { tool: 'connected', maskRuns: [[2, 1, 4], [3, 2, 5]] },
        { tool: 'connected', bbox: [6, 5, 9, 8] },
      ],
    });
    const original = JSON.parse(JSON.stringify(annotation));
    const built = buildPt3VectorAnnotationFaces([annotation], metadata);

    expect(built.stats.areasRead).toBe(6);
    expect(built.stats.primitivesBuilt).toBeGreaterThan(0);
    expect(built.stats.primitivesBuilt).toBeLessThanOrEqual(MAX_VECTOR_PRIMITIVES);
    expect(built.stats.maskRunsRead).toBe(2);
    expect(built.faces.length).toBeGreaterThan(0);
    expect(annotation).toEqual(original);
  });

  test('applies the area limit per segment so a later valid segment is retained', () => {
    const firstAreas = Array.from({ length: MAX_VECTOR_AREAS }, () => ({
      tool: 'rectangle',
      operation: 'add',
      start: { x: 1, y: 1 },
      end: { x: 3, y: 3 },
    }));
    const built = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({ id: 'segment-at-area-limit', areas: firstAreas }),
      rectangleAnnotation({
        id: 'segment-after-area-limit',
        areas: [{
          tool: 'connected',
          operation: 'add',
          maskRuns: [[7, 8, 10]],
        }],
      }),
    ], metadata);

    expect(built.stats.annotationsRead).toBe(2);
    expect(built.stats.areasRead).toBe(MAX_VECTOR_AREAS + 1);
    expect(built.stats.maskRunsRead).toBe(1);
    expect(built.stats.truncated).toBe(false);
    expect(built.faces.some((face) => face.annotationId === 'segment-after-area-limit')).toBe(true);
    const laterLowerPolygons = built.faces
      .filter((face) => face.annotationId === 'segment-after-area-limit' && face.surface === 'lower')
      .flatMap(collectFaceVoxelPolygons);
    expect(laterLowerPolygons).toHaveLength(1);
    expect(laterLowerPolygons[0].map((point) => point[0]))
      .toEqual(expect.arrayContaining([7.5, 9.5]));
  });

  test('applies the mask-run limit per segment without approximating the next segment', () => {
    const boundaryRuns = Array.from(
      { length: MAX_VECTOR_MASK_RUNS },
      (_unused, row) => [row, 0, 1],
    );
    const built = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({
        id: 'segment-at-mask-limit',
        imageWidth: 2,
        imageHeight: MAX_VECTOR_MASK_RUNS,
        areas: [{ tool: 'connected', operation: 'add', maskRuns: boundaryRuns }],
      }),
      rectangleAnnotation({
        id: 'segment-after-mask-limit',
        areas: [{ tool: 'connected', operation: 'add', maskRuns: [[7, 8, 10]] }],
      }),
    ], metadata);

    expect(built.stats.annotationsRead).toBe(2);
    expect(built.stats.maskRunsRead).toBe(MAX_VECTOR_MASK_RUNS + 1);
    expect(built.stats.maskApproximated).toBe(0);
    expect(built.stats.truncated).toBe(false);
    const laterLowerPolygons = built.faces
      .filter((face) => face.annotationId === 'segment-after-mask-limit' && face.surface === 'lower')
      .flatMap(collectFaceVoxelPolygons);
    expect(laterLowerPolygons).toHaveLength(1);
    expect(laterLowerPolygons[0].map((point) => point[0]))
      .toEqual(expect.arrayContaining([7.5, 9.5]));
  });

  test('does no work when globally hidden and skips individually hidden annotations', () => {
    expect(buildPt3VectorAnnotationFaces(
      [rectangleAnnotation()],
      metadata,
      { showAnnotations: false },
    ).faces).toEqual([]);
    expect(buildPt3VectorAnnotationFaces([
      rectangleAnnotation({ visible: false }),
      rectangleAnnotation({ id: 'segment-hidden', hidden: true }),
    ], metadata).faces).toEqual([]);

    const context = makeContext();
    const result = renderPt3VectorAnnotations(context, {
      vectorAnnotations: [rectangleAnnotation()],
      showAnnotations: false,
      metadata,
    });
    expect(result.renderedFaces).toBe(0);
    expect(context.beginPath).not.toHaveBeenCalled();
  });

  test('does not let hidden segments consume the visible annotation budget', () => {
    const hidden = Array.from({ length: 64 }, (_, index) => (
      rectangleAnnotation({ id: `hidden-${index}`, visible: false })
    ));
    const visible = rectangleAnnotation({ id: 'selected-visible' });
    const built = buildPt3VectorAnnotationFaces([...hidden, visible], metadata);

    expect(built.stats.annotationsRead).toBe(1);
    expect(built.faces.some((face) => face.annotationId === 'selected-visible')).toBe(true);
    expect(built.stats.truncated).toBe(false);
  });

  test('multiplies authored vector face alpha without changing annotation geometry', () => {
    const context = makeContext();
    const fillStyles = [];
    const strokeStyles = [];
    context.fill = jest.fn(() => fillStyles.push(context.fillStyle));
    context.stroke = jest.fn(() => strokeStyles.push(context.strokeStyle));

    const result = renderPt3VectorAnnotations(context, {
      vectorAnnotations: [rectangleAnnotation({ opacity: 0.4 })],
      metadata,
      rotation: { x: -18, y: 32 },
      zoom: 1,
      opacityMultiplier: 0.25,
    });

    expect(result.renderedFaces).toBe(3);
    expect(fillStyles).toEqual(expect.arrayContaining([
      'rgba(34,211,238,0.07800000000000001)',
      'rgba(34,211,238,0.05500000000000001)',
    ]));
    expect(strokeStyles.every((style) => style === 'rgba(34,211,238,0.205)')).toBe(true);
  });

  test('caps adversarial connected masks and total face work', () => {
    const maskRuns = Array.from({ length: MAX_VECTOR_MASK_RUNS + 100 }, (_unused, index) => [index, 0, 1]);
    const built = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({
        imageHeight: MAX_VECTOR_MASK_RUNS + 100,
        areas: [{ tool: 'connected', maskRuns }],
      }),
    ], metadata);

    expect(built.stats.maskRunsRead).toBe(MAX_VECTOR_MASK_RUNS);
    expect(built.stats.primitivesBuilt).toBeLessThanOrEqual(MAX_VECTOR_PRIMITIVES);
    expect(built.stats.primitivesBuilt).toBeGreaterThan(0);
    expect(built.stats.facesBuilt).toBeLessThanOrEqual(MAX_VECTOR_FACES);
    expect(built.stats.maskApproximated).toBe(1);
    expect(built.stats.truncated).toBe(true);
  });

  test('keeps connected masks above the old primitive budget exact in both 2D and 3D', () => {
    const maskRuns = Array.from({ length: MAX_VECTOR_PRIMITIVES + 188 }, (_unused, index) => [index * 2, 1, 3]);
    const annotation = rectangleAnnotation({
      imageWidth: 11,
      imageHeight: maskRuns.length * 2,
      areas: [{
        tool: 'connected',
        operation: 'add',
        maskRuns,
        bbox: [1, 0, 3, maskRuns.length * 2 - 1],
      }],
    });
    const mask = buildPt3SegmentMask(annotation);
    const path = pt3SegmentMaskToSvgPath(mask);

    expect(mask.stats.maskRunsRead).toBe(maskRuns.length);
    expect(mask.stats.truncated).toBe(false);
    expect(mask.stats.approximated).toBe(false);
    expect(mask.rectangles).toHaveLength(maskRuns.length);
    expect((path.match(/M /g) || [])).toHaveLength(maskRuns.length);
    expect(pt3SegmentMaskContainsPoint(mask, 2, maskRuns.length * 2 - 1.5)).toBe(true);

    const built = buildPt3VectorAnnotationFaces([annotation], metadata);
    const maximumDisplayedY = Math.max(...built.faces.flatMap(collectFaceVoxelPolygons).flat().map((point) => point[1]));
    expect(built.stats.maskRectanglesRead).toBe(maskRuns.length);
    expect(built.stats.maskApproximated).toBe(0);
    expect(built.stats.primitivesBuilt).toBeLessThanOrEqual(MAX_VECTOR_PRIMITIVES);
    expect(built.stats.truncated).toBe(false);
    expect(maximumDisplayedY).toBeCloseTo(((maskRuns.length * 2 - 1) / (maskRuns.length * 2)) * 9 - 0.5, 10);
    expect(maximumDisplayedY).toBeLessThan(8.5);
  });

  test('preserves an enclosed narrow RLE hole and exact voxel coordinates beyond 512 runs', () => {
    const imageWidth = 802;
    const imageHeight = 700;
    const maskRuns = [[0, 0, 800]];
    for (let row = 1; row < imageHeight - 1; row += 1) {
      const narrowRow = row % 2 === 1;
      maskRuns.push([row, 0, narrowRow ? 400 : 399]);
      maskRuns.push([row, narrowRow ? 401 : 402, 800]);
    }
    maskRuns.push([imageHeight - 1, 0, 800]);
    expect(maskRuns.length).toBeGreaterThan(MAX_VECTOR_PRIMITIVES);

    const annotation = rectangleAnnotation({
      imageWidth,
      imageHeight,
      minSlice: 1,
      maxSlice: 2,
      areas: [{ tool: 'connected', operation: 'add', maskRuns }],
    });
    const largeMetadata = {
      dimensions: [imageWidth, imageHeight, 4],
      spacing: [1, 1, 1],
    };
    const mask = buildPt3SegmentMask(annotation);
    const built = buildPt3VectorAnnotationFaces([annotation], largeMetadata);
    const lowerPolygons = collectSurfaceVoxelPolygons(built.faces, 'lower');
    const containsVoxelPoint = (x, y) => lowerPolygons.some((polygon) => {
      const xs = polygon.map((point) => point[0]);
      const ys = polygon.map((point) => point[1]);
      return x >= Math.min(...xs) && x < Math.max(...xs)
        && y >= Math.min(...ys) && y < Math.max(...ys);
    });

    expect(mask.stats.approximated).toBe(false);
    expect(mask.stats.truncated).toBe(false);
    expect(built.stats.maskRectanglesRead).toBe(mask.rectangles.length);
    expect(built.stats.maskApproximated).toBe(0);
    expect(built.stats.truncated).toBe(false);
    expect(built.stats.facesBuilt).toBe(3);
    expect(built.stats.primitivesBuilt).toBe(3);
    expect(lowerPolygons).toHaveLength(mask.rectangles.length);

    // Source row 351 maps to voxel y=351. Its one-pixel source gap
    // [400, 401] maps exactly to voxel boundaries [399.5, 400.5].
    expect(containsVoxelPoint(399, 351)).toBe(true);
    expect(containsVoxelPoint(400, 351)).toBe(false);
    expect(containsVoxelPoint(401, 351)).toBe(true);
    const row351Boundaries = lowerPolygons
      .filter((polygon) => polygon.some((point) => point[1] === 350.5))
      .flatMap((polygon) => polygon.map((point) => point[0]));
    expect(row351Boundaries).toEqual(expect.arrayContaining([399.5, 400.5]));

    // Full top and bottom rows close the gap into a hole rather than an open
    // split; the hole remains empty hundreds of runs past the old cutoff.
    expect(containsVoxelPoint(400, -0.25)).toBe(true);
    expect(containsVoxelPoint(400, imageHeight - 1)).toBe(true);

    const context = makeContext();
    const rendered = renderPt3VectorAnnotations(context, {
      vectorAnnotations: [annotation],
      metadata: largeMetadata,
      rotation: { x: -18, y: 32 },
      zoom: 1,
    });
    expect(rendered.renderedFaces).toBe(3);
    expect(context.fill).toHaveBeenCalledTimes(3);
    expect(context.moveTo.mock.calls.length).toBeGreaterThan(MAX_VECTOR_PRIMITIVES);
  });

  test('exactly erases a plausible large connected mask without Cartesian boolean work', () => {
    const maskRuns = Array.from({ length: 2048 }, (_unused, index) => [index * 2, 1, 3]);
    const segment = rectangleAnnotation({
      imageWidth: 4,
      imageHeight: 4096,
      areas: [
        { tool: 'connected', operation: 'add', maskRuns },
        { tool: 'connected', operation: 'subtract', maskRuns },
      ],
    });
    const mask = buildPt3SegmentMask(segment);

    expect(mask.stats.maskRunsRead).toBe(4096);
    expect(mask.stats.subtractAreasApplied).toBe(1);
    expect(mask.stats.booleanOperations).toBeGreaterThan(0);
    expect(mask.stats.approximated).toBe(false);
    expect(mask.stats.truncated).toBe(false);
    expect(mask.rectangles).toEqual([]);
    expect(pt3SegmentMaskContainsPoint(mask, 2, 4094.5)).toBe(false);
  });

  test('keeps the conservative fallback explicit when the scanline budget is exhausted', () => {
    const maskRuns = Array.from({ length: 32 }, (_unused, index) => [index * 2, 1, 3]);
    const segment = rectangleAnnotation({
      imageWidth: 4,
      imageHeight: 64,
      areas: [
        { tool: 'connected', operation: 'add', maskRuns },
        { tool: 'connected', operation: 'subtract', maskRuns },
      ],
    });
    const mask = buildPt3SegmentMask(segment, { maxBooleanOperations: 10 });

    expect(mask.stats.maskRunsRead).toBe(64);
    expect(mask.stats.subtractAreasApplied).toBe(1);
    expect(mask.stats.approximated).toBe(true);
    expect(mask.stats.truncated).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, 2, 62.5)).toBe(true);
  });

  test('composites ordered add, subtract, and refill operations into the shared 2D/3D mask', () => {
    const annotation = rectangleAnnotation({
      areas: [
        {
          tool: 'rectangle',
          operation: 'add',
          start: { x: 1, y: 1 },
          end: { x: 8, y: 7 },
        },
        {
          tool: 'rectangle',
          operation: 'subtract',
          start: { x: 2, y: 2 },
          end: { x: 4, y: 4 },
        },
        {
          tool: 'rectangle',
          operation: 'add',
          start: { x: 2.5, y: 2.5 },
          end: { x: 3.5, y: 3.5 },
        },
      ],
    });
    const mask = buildPt3SegmentMask(annotation);
    expect(pt3SegmentMaskContainsPoint(mask, 1.5, 1.5)).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, 2.25, 2.25)).toBe(false);
    expect(pt3SegmentMaskContainsPoint(mask, 3, 3)).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, 7.5, 6.5)).toBe(true);
    expect(pt3SegmentMaskToSvgPath(mask)).not.toContain('undefined');

    const built = buildPt3VectorAnnotationFaces([annotation], metadata);
    expect(built.stats.areasRead).toBe(3);
    expect(built.stats.subtractAreasApplied).toBe(1);
    expect(built.stats.subtractAreasOmitted).toBe(0);
    expect(built.stats.primitivesBuilt).toBe(built.stats.facesBuilt);
    expect(built.faces.every((face) => face.operation === 'add')).toBe(true);
    const sidePolygons = collectSurfaceVoxelPolygons(built.faces, 'side');
    expect(built.faces.filter((face) => face.surface === 'side')).toHaveLength(1);
    expect(sidePolygons.length).toBeGreaterThanOrEqual(8);

    const context = makeContext();
    const result = renderPt3VectorAnnotations(context, {
      vectorAnnotations: [annotation],
      metadata,
      rotation: { x: -22, y: 32 },
      zoom: 1.4,
      mirrorScale: { x: -1, y: 1, z: 1 },
    });

    expect(result.renderedFaces).toBeGreaterThan(0);
    expect(result.subtractAreasApplied).toBe(1);
    expect(result.subtractAreasOmitted).toBe(0);
    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
    expect(context.setLineDash).not.toHaveBeenCalledWith([6, 4]);

    const subtractOnly = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({ areas: [{ tool: 'eraser', points: [{ x: 1, y: 1 }] }] }),
    ], metadata);
    expect(subtractOnly.faces).toEqual([]);
    expect(subtractOnly.stats.subtractAreasApplied).toBe(1);
    expect(subtractOnly.stats.subtractAreasOmitted).toBe(0);
  });

  test('preserves connected mask-run extents exactly while subtracting from them', () => {
    const segment = rectangleAnnotation({
      imageWidth: 10,
      imageHeight: 8,
      areas: [
        {
          tool: 'connected',
          operation: 'add',
          canvasHeight: 4,
          maskRuns: [[2, 1, 5], [4, 2, 6, 1]],
          bbox: [1, 2, 6, 5],
        },
        {
          tool: 'rectangle',
          operation: 'subtract',
          start: { x: 2, y: 2.5 },
          end: { x: 3, y: 3.5 },
        },
      ],
    });
    const mask = buildPt3SegmentMask(segment);

    expect(mask.stats.maskRunsRead).toBe(2);
    expect(pt3SegmentMaskContainsPoint(mask, 1.5, 2.25)).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, 2.5, 3)).toBe(false);
    expect(pt3SegmentMaskContainsPoint(mask, 4.5, 3.75)).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, 2.5, 4.5)).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, 5.5, 5.5)).toBe(false);
  });

  test.each([
    ['rectangle', { start: { x: 2, y: 2 }, end: { x: 8, y: 7 } }, [3, 3], [1, 1]],
    ['circle', { center: { x: 5, y: 4 }, radius: 2 }, [5, 4], [1, 1]],
    ['polygon', { points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 7 }] }, [5, 4], [1, 1]],
    ['brush', { points: [{ x: 2, y: 2 }, { x: 8, y: 6 }], brushSize: 2 }, [5, 4], [1, 7]],
  ])('creates bounded occupied masks for %s geometry', (tool, area, inside, outside) => {
    const mask = buildPt3SegmentMask(rectangleAnnotation({
      imageWidth: 10,
      imageHeight: 8,
      areas: [{ tool, operation: 'add', ...area }],
    }));
    expect(pt3SegmentMaskContainsPoint(mask, inside[0], inside[1])).toBe(true);
    expect(pt3SegmentMaskContainsPoint(mask, outside[0], outside[1])).toBe(false);
    expect(mask.rectangles.length).toBeGreaterThan(0);
    expect(mask.rectangles.length).toBeLessThanOrEqual(MAX_VECTOR_PRIMITIVES);
  });

  test('composites volumetric add/erase runs and projects them across all MPR axes', () => {
    const segment = rectangleAnnotation({
      version: 2,
      volumeDimensions: [6, 5, 4],
      areas: [
        {
          tool: 'brush',
          mode: '3d',
          operation: 'add',
          volumeRuns: [[0, 1, 1, 5], [1, 1, 1, 5], [2, 2, 2, 4]],
        },
        {
          tool: 'brush',
          mode: '3d',
          operation: 'subtract',
          volumeRuns: [[1, 1, 2, 4]],
        },
      ],
    });
    const volume = buildPt3SegmentVolumeRuns(segment, [6, 5, 4]);
    expect(volume.runs).toEqual([
      [0, 1, 1, 5],
      [1, 1, 1, 2],
      [1, 1, 4, 5],
      [2, 2, 2, 4],
    ]);
    expect(volume.stats.voxelCount).toBe(8);
    expect(buildPt3SegmentVolumeRuns(segment, [6, 5, 4])).toBe(volume);

    const axial = buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'axial',
      sliceIndex: 1,
      dimensions: [6, 5, 4],
    });
    expect(axial.rectangles).toEqual([
      { x0: 1, y0: 1, x1: 2, y1: 2 },
      { x0: 4, y0: 1, x1: 5, y1: 2 },
    ]);
    expect(buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'axial',
      sliceIndex: 1,
      dimensions: [6, 5, 4],
    })).toBe(axial);
    const coronal = buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'coronal',
      sliceIndex: 1,
      dimensions: [6, 5, 4],
    });
    expect(coronal.rectangles).toEqual(expect.arrayContaining([
      { x0: 1, y0: 3, x1: 5, y1: 4 },
      { x0: 1, y0: 2, x1: 2, y1: 3 },
      { x0: 4, y0: 2, x1: 5, y1: 3 },
    ]));
    const sagittal = buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'sagittal',
      sliceIndex: 3,
      dimensions: [6, 5, 4],
    });
    expect(sagittal.rectangles).toEqual([
      { x0: 2, y0: 1, x1: 3, y1: 2 },
      { x0: 1, y0: 3, x1: 2, y1: 4 },
    ]);
  });

  test('marks volume runs partial only after the canonical 50k limit is exceeded', () => {
    const depth = 25_000;
    const firstColumn = Array.from({ length: depth }, (_, z) => [z, 0, 0, 1]);
    const secondColumn = Array.from({ length: depth }, (_, z) => [z, 0, 2, 3]);
    const base = {
      version: 2,
      volumeDimensions: [5, 1, depth],
      areas: [
        { tool: 'volume-mask', mode: '3d', operation: 'add', volumeRuns: firstColumn },
        { tool: 'volume-mask', mode: '3d', operation: 'add', volumeRuns: secondColumn },
      ],
    };
    const exact = buildPt3SegmentVolumeRuns(base, [5, 1, depth]);
    const overflow = buildPt3SegmentVolumeRuns({
      ...base,
      areas: [
        ...base.areas,
        { tool: 'volume-mask', mode: '3d', operation: 'add', volumeRuns: [[0, 0, 4, 5]] },
      ],
    }, [5, 1, depth]);

    expect(exact.runs).toHaveLength(50_000);
    expect(exact.stats.truncated).toBe(false);
    expect(overflow.runs).toHaveLength(50_000);
    expect(overflow.stats.truncated).toBe(true);
  });

  test('keeps planar edits on their own axis and slice', () => {
    const segment = rectangleAnnotation({
      imageWidth: 6,
      imageHeight: 6,
      minSlice: 0,
      maxSlice: 5,
      areas: [
        {
          tool: 'rectangle',
          axis: 'axial',
          sliceIndex: 1,
          imageWidth: 6,
          imageHeight: 6,
          operation: 'add',
          start: { x: 1, y: 1 },
          end: { x: 5, y: 5 },
        },
        {
          tool: 'rectangle',
          axis: 'coronal',
          sliceIndex: 2,
          imageWidth: 6,
          imageHeight: 6,
          operation: 'add',
          start: { x: 2, y: 2 },
          end: { x: 4, y: 4 },
        },
      ],
    });

    const axial = buildPt3SegmentMask(segment, {
      axis: 'axial',
      sliceIndex: 1,
      imageWidth: 6,
      imageHeight: 6,
    });
    const wrongAxialSlice = buildPt3SegmentMask(segment, {
      axis: 'axial',
      sliceIndex: 2,
      imageWidth: 6,
      imageHeight: 6,
    });
    const coronal = buildPt3SegmentMask(segment, {
      axis: 'coronal',
      sliceIndex: 2,
      imageWidth: 6,
      imageHeight: 6,
    });

    expect(pt3SegmentMaskContainsPoint(axial, 1.5, 1.5)).toBe(true);
    expect(wrongAxialSlice.rectangles).toHaveLength(0);
    expect(pt3SegmentMaskContainsPoint(coronal, 2.5, 2.5)).toBe(true);
    expect(pt3SegmentMaskContainsPoint(coronal, 1.5, 1.5)).toBe(false);
  });

  test('composites 2D and 3D add/erase operations into the same voxel mask', () => {
    const erasePlanarWithVolume = buildPt3SegmentVolumeRuns({
      axis: 'axial',
      minSlice: 0,
      maxSlice: 5,
      imageWidth: 6,
      imageHeight: 6,
      volumeDimensions: [6, 6, 6],
      areas: [
        {
          tool: 'rectangle',
          mode: '2d',
          axis: 'axial',
          sliceIndex: 2,
          imageWidth: 6,
          imageHeight: 6,
          operation: 'add',
          start: { x: 1, y: 2 },
          end: { x: 5, y: 3 },
        },
        {
          tool: 'brush',
          mode: '3d',
          operation: 'subtract',
          volumeRuns: [[2, 2, 2, 4]],
        },
      ],
    }, [6, 6, 6]);
    expect(erasePlanarWithVolume.runs).toEqual([
      [2, 2, 1, 2],
      [2, 2, 4, 5],
    ]);

    const eraseVolumeWithPlanar = buildPt3SegmentVolumeRuns({
      axis: 'axial',
      minSlice: 0,
      maxSlice: 5,
      imageWidth: 6,
      imageHeight: 6,
      volumeDimensions: [6, 6, 6],
      areas: [
        {
          tool: 'brush',
          mode: '3d',
          operation: 'add',
          volumeRuns: [[2, 2, 1, 5]],
        },
        {
          tool: 'rectangle',
          mode: '2d',
          axis: 'axial',
          sliceIndex: 2,
          imageWidth: 6,
          imageHeight: 6,
          operation: 'subtract',
          start: { x: 2, y: 2 },
          end: { x: 4, y: 3 },
        },
      ],
    }, [6, 6, 6]);
    expect(eraseVolumeWithPlanar.runs).toEqual([
      [2, 2, 1, 2],
      [2, 2, 4, 5],
    ]);
  });

  test('builds only exposed faces and promotes mixed planar/volume masks into one canonical surface', () => {
    const volumeOnly = rectangleAnnotation({
      version: 2,
      volumeDimensions: [4, 3, 2],
      areas: [{
        tool: 'brush',
        mode: '3d',
        operation: 'add',
        volumeRuns: [[0, 0, 0, 2]],
      }],
    });
    const built = buildPt3VectorAnnotationFaces([volumeOnly], {
      dimensions: [4, 3, 2],
      spacing: [1, 1, 1],
    });
    expect(built.faces).toHaveLength(1);
    expect(built.faces[0].surface).toBe('volume');
    const polygons = [];
    forEachPt3VectorFaceVoxelPolygon(built.faces[0], (polygon) => polygons.push(polygon));
    expect(polygons).toHaveLength(6);
    expect(built.stats.volumeRunsRead).toBe(1);
    expect(built.stats.volumeVoxelsRead).toBe(2);

    const mixed = buildPt3VectorAnnotationFaces([
      rectangleAnnotation({
        volumeDimensions: [11, 9, 7],
        areas: [
          { tool: 'rectangle', operation: 'add', start: { x: 2, y: 1 }, end: { x: 7, y: 6 } },
          { tool: 'brush', mode: '3d', operation: 'add', volumeRuns: [[0, 0, 0, 1]] },
        ],
      }),
    ], metadata);
    expect(mixed.faces.some((face) => face.surface === 'lower')).toBe(false);
    expect(mixed.faces.some((face) => face.surface === 'volume')).toBe(true);
  });

  test('keeps a near-maximum isotropic brush surface complete in the 3D renderer', () => {
    const sphere = rasterizeSphereStroke({
      centers: [[50, 50, 50]],
      radius: 39,
      dimensions: [101, 101, 101],
      spacing: [1, 1, 1],
      maxRuns: 50_000,
      maxVoxels: 250_000,
    });
    expect(sphere.truncated).toBe(false);
    const built = buildPt3VectorAnnotationFaces([{
      id: 'large-sphere',
      label: 'Large sphere',
      color: '#22d3ee',
      visible: true,
      axis: 'axial',
      minSlice: 50,
      maxSlice: 50,
      imageWidth: 101,
      imageHeight: 101,
      version: 2,
      volumeDimensions: [101, 101, 101],
      areas: [{
        tool: 'volume-mask',
        mode: '3d',
        operation: 'add',
        volumeRuns: sphere.runs,
      }],
    }], {
      dimensions: [101, 101, 101],
      spacing: [1, 1, 1],
    });
    expect(built.stats.truncated).toBe(false);
    expect(built.faces).toHaveLength(1);
    expect(built.faces[0].voxelPolygons.length).toBeGreaterThan(MAX_VECTOR_FACES);
  });

  test('reports a truncated 3D surface preview without truncating a thin stored mask', () => {
    const depth = 13_000;
    const runs = Array.from({ length: depth }, (_, z) => [z, 0, 0, 1]);
    const annotation = {
      id: 'thin-component',
      label: 'Thin component',
      color: '#22d3ee',
      visible: true,
      axis: 'axial',
      minSlice: 0,
      maxSlice: depth - 1,
      imageWidth: 1,
      imageHeight: 1,
      version: 2,
      volumeDimensions: [1, 1, depth],
      areas: [{
        tool: 'volume-mask',
        mode: '3d',
        operation: 'add',
        volumeRuns: runs,
      }],
    };
    expect(buildPt3SegmentVolumeRuns(annotation, [1, 1, depth]).stats.voxelCount).toBe(depth);
    const built = buildPt3VectorAnnotationFaces([annotation], {
      dimensions: [1, 1, depth],
      spacing: [1, 1, 1],
    });

    expect(built.stats.volumeVoxelsRead).toBe(depth);
    expect(built.stats.volumeSurfaceTruncated).toBe(true);
    expect(built.stats.truncated).toBe(true);
    expect(built.faces[0].voxelPolygons).toHaveLength(50_000);
  });

  test('shares one 50k surface budget across segments and reuses the complete build', () => {
    const depth = 7_000;
    const makeThinSegment = (id, x) => ({
      id,
      label: id,
      color: '#22d3ee',
      visible: true,
      axis: 'axial',
      minSlice: 0,
      maxSlice: depth - 1,
      imageWidth: 2,
      imageHeight: 1,
      version: 2,
      volumeDimensions: [2, 1, depth],
      areas: [{
        tool: 'volume-mask',
        mode: '3d',
        operation: 'add',
        volumeRuns: Array.from({ length: depth }, (_, z) => [z, 0, x, x + 1]),
      }],
    });
    const annotations = [
      makeThinSegment('thin-a', 0),
      makeThinSegment('thin-b', 1),
    ];
    const first = buildPt3VectorAnnotationFaces(annotations, {
      dimensions: [2, 1, depth],
      spacing: [1, 1, 1],
    });
    const second = buildPt3VectorAnnotationFaces(annotations, {
      dimensions: [2, 1, depth],
      spacing: [2, 2, 2],
    });

    expect(first.stats.volumeVoxelsRead).toBe(depth * 2);
    expect(first.stats.volumeSurfacePolygonsBuilt).toBe(50_000);
    expect(first.stats.volumeSurfaceTruncated).toBe(true);
    expect(first.faces.reduce(
      (total, face) => total + (face.voxelPolygons?.length || 0),
      0,
    )).toBe(50_000);
    expect(second).toBe(first);
  });

  test('keeps only a small LRU of projected volume slices per segment', () => {
    const segment = rectangleAnnotation({
      version: 2,
      volumeDimensions: [2, 2, 12],
      areas: [{
        tool: 'volume-mask',
        mode: '3d',
        operation: 'add',
        volumeRuns: Array.from({ length: 12 }, (_, z) => [z, 0, 0, 1]),
      }],
    });
    const first = buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'axial',
      sliceIndex: 0,
      dimensions: [2, 2, 12],
    });
    const retained = buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'axial',
      sliceIndex: 4,
      dimensions: [2, 2, 12],
    });
    for (let sliceIndex = 1; sliceIndex < 12; sliceIndex += 1) {
      buildPt3SegmentVolumeSliceMask(segment, {
        axis: 'axial',
        sliceIndex,
        dimensions: [2, 2, 12],
      });
    }

    expect(buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'axial',
      sliceIndex: 4,
      dimensions: [2, 2, 12],
    })).toBe(retained);
    expect(buildPt3SegmentVolumeSliceMask(segment, {
      axis: 'axial',
      sliceIndex: 0,
      dimensions: [2, 2, 12],
    })).not.toBe(first);
  });
});
