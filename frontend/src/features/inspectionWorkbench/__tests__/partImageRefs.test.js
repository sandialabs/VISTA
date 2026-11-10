import {
  getAggregatePartImageRefs,
  getAnnotationSourceImageId,
  getPartImageRefs,
  getShellImageLayers,
  isInspectionItemForImageEntry,
} from '../partImageRefs';

// An Analyze output stored in source_images and another in analysis_outputs
// both sit at index 0 of their list; their tile ids (React keys) must differ.
const part = {
  id: 'part-1',
  metadata: {
    source_images: [
      { image_id: 'overlay-a', filename: 'a.png', analysis_output: true },
      { image_id: 'source-1', filename: 'source.png', side: 'front' },
    ],
    analysis_outputs: [
      { image_id: 'overlay-b', filename: 'b.png' },
      { image_id: 'overlay-c', filename: 'c.png' },
    ],
  },
};

const lookup = {
  'overlay-a': { id: 'overlay-a', filename: 'a.png' },
  'source-1': { id: 'source-1', filename: 'source.png' },
  'overlay-b': { id: 'overlay-b', filename: 'b.png' },
  'overlay-c': { id: 'overlay-c', filename: 'c.png' },
};

const expectUniqueIds = (refs) => {
  const ids = refs.map((ref) => ref.id);
  expect(new Set(ids).size).toBe(ids.length);
};

describe('part image ref ids', () => {
  test('are unique across source_images and analysis_outputs', () => {
    const refs = getPartImageRefs(part);
    expect(refs).toHaveLength(4);
    expectUniqueIds(refs);
    expect(refs.map((ref) => ref.id)).toEqual([
      'part-1-analysis-0',
      'part-1-source-1',
      'part-1-output-analysis-0',
      'part-1-output-analysis-1',
    ]);
  });

  test('stay unique in the all-parts aggregate view', () => {
    const refs = getAggregatePartImageRefs([part, { ...part, id: 'part-2' }], lookup);
    expect(refs).toHaveLength(8);
    expectUniqueIds(refs);
  });
});

// Annotations are owned by the exact image drawn on. Overlays assigned to a
// base image, and other images sharing the same view, never inherit them.
describe('annotation image ownership', () => {
  const ownershipLookup = {
    base: { id: 'base', filename: 'sn1_front_xray.png', metadata: {} },
    heat: { id: 'heat', filename: 'sn1_front_heatmap.png', metadata: { overlay_base_image_id: 'base' } },
  };
  const baseEntry = { imageRef: 'base', imageId: 'base', overlay: false, viewName: 'front' };
  const heatEntry = { imageRef: 'heat', imageId: 'heat', overlay: true, overlayBaseImageId: 'base', viewName: 'front' };
  const measurementOn = (imageId) => ({ kind: 'annotation', annotation: { id: 'm1', image_id: imageId } });

  test('resolves an overlay tile to its own image id, not its base', () => {
    expect(getAnnotationSourceImageId(heatEntry, ownershipLookup)).toBe('heat');
    expect(getAnnotationSourceImageId(baseEntry, ownershipLookup)).toBe('base');
    expect(getAnnotationSourceImageId({ imageId: 'missing' }, ownershipLookup)).toBe('');
  });

  test('matches an annotation only to the tile of the image it was drawn on', () => {
    expect(isInspectionItemForImageEntry(measurementOn('base'), baseEntry, ownershipLookup)).toBe(true);
    expect(isInspectionItemForImageEntry(measurementOn('base'), heatEntry, ownershipLookup)).toBe(false);
    expect(isInspectionItemForImageEntry(measurementOn('heat'), heatEntry, ownershipLookup)).toBe(true);
    expect(isInspectionItemForImageEntry(measurementOn('heat'), baseEntry, ownershipLookup)).toBe(false);
  });
});

describe('shell image layers', () => {
  const volumePart = {
    id: 'part-3d',
    metadata: {
      source_images: [
        { image_id: 'volume-npy', filename: 'large-volume.npy' },
        { image_id: 'volume-tiff', filename: 'stack.tiff', tiff_dimensionality: '3d' },
        { image_id: 'photo', filename: 'photo.png', side: 'front' },
      ],
    },
  };
  const lookup = {
    'volume-npy': { id: 'volume-npy', filename: 'large-volume.npy' },
    'volume-tiff': { id: 'volume-tiff', filename: 'stack.tiff' },
    photo: { id: 'photo', filename: 'photo.png' },
  };

  test('never include a volume file, whose content URL would download the whole file', () => {
    const layers = getShellImageLayers(volumePart, lookup);
    expect(layers.map((layer) => layer.id)).toEqual(['photo']);
    expect(layers.map((layer) => layer.url)).not.toContain('/api/images/volume-npy/content');
  });
});
