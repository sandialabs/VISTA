import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OverlaysTab, { buildOverlayBuckets } from '../OverlaysTab';

describe('OverlaysTab', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('renders base images with multiple overlays to the side', () => {
    render(
      <OverlaysTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          display_name: 'Part 1',
          metadata: {
            source_images: [
              { filename: 'base.png', image_id: 'base-id', side: 'front', overlay: false },
              { filename: 'heatmap.png', image_id: 'heat-id', side: 'front', overlay: true, overlay_base_filename: 'base.png' },
              { filename: 'mask.png', image_id: 'mask-id', side: 'front', overlay: true, overlay_base_filename: 'base.png' },
            ],
          },
        }]}
        images={[
          { id: 'base-id', filename: 'base.png' },
          { id: 'heat-id', filename: 'heatmap.png' },
          { id: 'mask-id', filename: 'mask.png' },
          { id: 'free-id', filename: 'available.png' },
        ]}
      />
    );

    expect(screen.getByRole('tabpanel', { name: 'Overlays' })).toBeInTheDocument();
    expect(screen.getByText('Image / Overlay Assignments')).toBeInTheDocument();
    expect(screen.getAllByText('base.png').length).toBeGreaterThan(0);
    expect(screen.getByText('heatmap.png')).toBeInTheDocument();
    expect(screen.getByText('mask.png')).toBeInTheDocument();
    expect(screen.getByText('available.png')).toBeInTheDocument();
  });

  test('assigns a dragged overlay image to a base image', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const onAssignmentsChanged = jest.fn().mockResolvedValue();

    render(
      <OverlaysTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          display_name: 'Part 1',
          metadata: { source_images: [{ filename: 'base.png', image_id: 'base-id', overlay: false }] },
        }]}
        images={[{ id: 'base-id', filename: 'base.png' }, { id: 'overlay-id', filename: 'overlay.png' }]}
        onAssignmentsChanged={onAssignmentsChanged}
        setError={jest.fn()}
      />
    );

    fireEvent.dragStart(screen.getByRole('button', { name: 'overlay.png' }), { dataTransfer: { setData: jest.fn() } });
    fireEvent.drop(screen.getByTestId('overlay-target-base-id'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/overlay-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlay_filename: 'overlay.png', overlay_image_id: 'overlay-id', base_filename: 'base.png', base_image_id: 'base-id' }),
      });
    });
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalled());
  });

  test('buildOverlayBuckets keeps assigned overlays out of available overlays', () => {
    const buckets = buildOverlayBuckets({
      parts: [{
        id: 'part-1',
        metadata: { source_images: [
          { filename: 'base.png', image_id: 'base-id', overlay: false },
          { filename: 'overlay.png', image_id: 'overlay-id', overlay: true, overlay_base_filename: 'base.png' },
        ] },
      }],
      images: [
        { id: 'base-id', filename: 'base.png' },
        { id: 'overlay-id', filename: 'overlay.png' },
        { id: 'loose-id', filename: 'loose.png' },
      ],
    });

    expect(buckets.baseBuckets).toHaveLength(1);
    expect(buckets.baseBuckets[0].overlays.map((image) => image.filename)).toEqual(['overlay.png']);
    expect(buckets.unassignedOverlays.map((image) => image.filename)).toEqual(['loose.png']);
  });

  test('assigns one duplicate stack as the overlay for the same-name base stack', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <OverlaysTab
        projectId="proj-pt3"
        parts={[{
          id: 'part-1',
          display_name: 'PT3 Part',
          metadata: { source_images: [{ filename: 'scan.npy', image_id: 'stack-base-id', overlay: false }] },
        }]}
        images={[{ id: 'stack-base-id', filename: 'scan.npy' }, { id: 'stack-overlay-id', filename: 'scan.npy' }]}
      />
    );

    fireEvent.dragStart(screen.getByRole('button', { name: 'scan (duplicate).npy' }), { dataTransfer: { setData: jest.fn() } });
    fireEvent.drop(screen.getByTestId('overlay-target-stack-base-id'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-pt3/parts/overlay-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlay_filename: 'scan.npy', overlay_image_id: 'stack-overlay-id', base_filename: 'scan.npy', base_image_id: 'stack-base-id' }),
      });
    });
  });
});
