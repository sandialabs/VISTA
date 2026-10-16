import {
  getSegmentDisplayStyle,
  normalizePt3Segmentation,
  segmentColorToRgba,
} from '../pt3Segmentation';

describe('PT3 segmentation contract', () => {
  test('keeps unsegmented current data on an empty no-op contract', () => {
    expect(normalizePt3Segmentation({ metadata: {} })).toEqual({ segments: [], labelSlices: [] });
  });

  test('normalizes segment presentation and inline snake-case label slices', () => {
    const contract = normalizePt3Segmentation({
      metadata: {
        pt3_segmentation: {
          segments: [
            { id: 7, name: 'Housing', color: [1, 0.5, 0], opacity: 1.4 },
            { segment_id: ' 8 ', label: 'Void', visible: false },
            { segment_id: 'void', label: 'Invalid', visible: false },
          ],
          label_slices: [
            { slice_index: 9, labels: [[7, 0], [0, 8]] },
            { slice_index: 10, asset_url: '/labels/10.png' },
            '/labels/10.png',
          ],
        },
      },
    });

    expect(contract.segments).toEqual([
      { id: 7, label: 'Housing', name: 'Housing', color: '#ff8000', visible: true, opacity: 1 },
      expect.objectContaining({ id: 8, label: 'Void', visible: false }),
    ]);
    expect(contract.labelSlices).toEqual([{ labels: [7, 0, 0, 8], sliceIndex: 9 }]);
    expect(getSegmentDisplayStyle(7, contract.segments)?.label).toBe('Housing');
  });

  test('converts configured colors into renderer-ready RGBA values', () => {
    expect(segmentColorToRgba('#0f8', 0.5)).toEqual([0, 255, 136, 0.5]);
    expect(segmentColorToRgba('rgb(10, 20, 30)', 0.25)).toEqual([10, 20, 30, 0.25]);
  });

  test.each(['label_volume', 'voxel_labels'])('normalizes dense %s aliases in z-order', (alias) => {
    const contract = normalizePt3Segmentation({
      metadata: {
        pt3_segmentation: {
          [alias]: [
            [[1, 0], [2, 0]],
            [[0, 2], [0, 1]],
          ],
        },
      },
    });
    expect(contract.labelSlices).toEqual([
      { sliceIndex: 0, labels: [1, 0, 2, 0] },
      { sliceIndex: 1, labels: [0, 2, 0, 1] },
    ]);
  });
});
