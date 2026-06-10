import { getVolumeOverlayStacks, getVolumeSourceImages } from '../InspectionWorkbenchPanel';

describe('PT3 volume overlay stack mapping', () => {
  test('keeps base and overlay stacks separate and aligns overlay slices by image id', () => {
    const part = {
      id: 'part-1',
      metadata: {
        source_images: [
          { filename: 'scan.npy', image_id: 'stack-base-id', overlay: false, slice_index: 0 },
          {
            filename: 'scan.npy',
            image_id: 'stack-overlay-id',
            overlay: true,
            overlay_base_filename: 'scan.npy',
            overlay_base_image_id: 'stack-base-id',
            slice_index: 0,
          },
        ],
      },
    };
    const projectImageLookup = {
      'stack-base-id': { id: 'stack-base-id', filename: 'scan.npy' },
      'stack-overlay-id': { id: 'stack-overlay-id', filename: 'scan.npy' },
    };

    const baseStack = getVolumeSourceImages(part, projectImageLookup);
    const overlayStacks = getVolumeOverlayStacks(part, projectImageLookup);

    expect(baseStack).toEqual([
      expect.objectContaining({ id: 'stack-base-id', filename: 'scan.npy', sliceIndex: 0, url: '/api/images/stack-base-id/content' }),
    ]);
    expect(overlayStacks).toEqual([
      expect.objectContaining({
        id: 'stack-overlay-id',
        stack: [expect.objectContaining({ id: 'stack-overlay-id', sliceIndex: 0, overlayBaseImageId: 'stack-base-id', url: '/api/images/stack-overlay-id/content' })],
      }),
    ]);
  });
});
