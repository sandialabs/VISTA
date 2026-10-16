import { findVisibilitySegment, setAnnotationHidden, setPartSourceImageHidden } from '../inspectionVisibilityPatches';

describe('inspectionVisibilityPatches', () => {
  test('sets the hidden flag on the matching annotation', () => {
    expect(setAnnotationHidden([{ id: 1 }, { id: 2 }], '2', true)).toEqual([{ id: 1 }, { id: 2, hidden: true }]);
  });

  test('matches source images by explicit image ID before filename', () => {
    const part = { id: 'p', metadata: { source_images: [{ image_id: 'x', filename: 'a.png' }, { image_id: 'y', filename: 'a.png' }] } };
    const byId = setPartSourceImageHidden(part, { overlay: { imageId: 'y', filename: 'a.png' }, source: { resourceId: 'a.png' } }, true);
    expect(byId.metadata.source_images.map((entry) => Boolean(entry.hidden))).toEqual([false, true]);
    const ambiguous = setPartSourceImageHidden(part, { overlay: { filename: 'a.png' }, source: { resourceId: 'a.png' } }, true);
    expect(ambiguous.metadata.source_images.map((entry) => Boolean(entry.hidden))).toEqual([false, false]);
    const unique = setPartSourceImageHidden(
      { id: 'p', metadata: { source_images: [{ filename: 'b.png' }] } },
      { source: { resourceId: 'b.png' } },
      true,
    );
    expect(unique.metadata.source_images).toEqual([{ filename: 'b.png', hidden: true }]);
  });

  test('finds a segment by ID or annotation ID', () => {
    const segments = [{ id: 's1', annotationId: 'a1' }];
    expect(findVisibilitySegment(segments, { source: { resourceId: 'a1' } })).toBe(segments[0]);
    expect(findVisibilitySegment(segments, { source: { resourceId: 's1' } })).toBe(segments[0]);
  });
});
