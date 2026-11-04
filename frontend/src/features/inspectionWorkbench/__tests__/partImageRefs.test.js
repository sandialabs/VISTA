import { getAggregatePartImageRefs, getPartImageRefs } from '../partImageRefs';

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
