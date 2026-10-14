import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RemoveImagesTab, { buildHierarchy } from '../RemoveImagesTab';

const originalFetch = global.fetch;

const waitForAsyncWork = async (assertion) => waitFor(assertion, { timeout: 3000 });

jest.setTimeout(15000);

describe('RemoveImagesTab', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  });

  test('unloads selected images', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchSpy;
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onImagesRemoved = jest.fn().mockResolvedValue();

    render(
      <RemoveImagesTab
        projectId="proj-1"
        parts={[]}
        images={[{ id: 'img-1', filename: 'unassigned-a.png' }]}
        onImagesRemoved={onImagesRemoved}
        setError={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'unassigned-a.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unload Selected (1)' }));

    expect(confirmSpy).toHaveBeenCalledWith('Unload 1 selected image?');

    await waitForAsyncWork(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/images/img-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Unloaded from Project Data Unload Images tab', force: false }),
      });
    });
    await waitForAsyncWork(() => expect(onImagesRemoved).toHaveBeenCalledTimes(1));
    await waitForAsyncWork(() => expect(screen.getByRole('button', { name: 'Unload Selected (0)' })).toBeDisabled());
  });

  test('does not list images removed from active project image records in part buckets', () => {
    render(
      <RemoveImagesTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          serial_number: 'SN-001',
          display_name: 'Part 1',
          metadata: { source_images: [{ filename: 'unloaded.png', image_id: 'img-unloaded' }] },
        }]}
        images={[{ id: 'img-unloaded', filename: 'unloaded.png', deleted_at: '2026-05-29T00:00:00Z' }]}
      />
    );

    expect(screen.queryByText('unloaded.png')).not.toBeInTheDocument();
    expect(screen.getByText('No images assigned to this part.')).toBeInTheDocument();
  });

  test('shows an assigned exact-name UUID once and leaves its twin unassigned', () => {
    const hierarchy = buildHierarchy(
      [{
        id: 'part-1',
        metadata: { source_images: [
          { filename: 'scan.png', image_id: 'scan-a' },
          { filename: 'scan.png', image_id: 'scan-a' },
        ] },
      }],
      [
        { id: 'scan-a', filename: 'scan.png', created_at: '2026-01-01T00:00:00Z' },
        { id: 'scan-b', filename: 'scan.png', created_at: '2026-01-02T00:00:00Z' },
        { id: 'scan-a', filename: 'scan.png', created_at: '2026-01-01T00:00:00Z' },
      ],
    );

    expect(hierarchy.partBuckets[0].images.map((image) => image.id)).toEqual(['scan-a']);
    expect(hierarchy.unassignedImages.map((image) => [image.id, image.displayName])).toEqual([
      ['scan-b', 'scan (1).png'],
    ]);
  });

  test('keeps ambiguous legacy and stale explicit hierarchy rows unassigned', () => {
    const ambiguous = buildHierarchy(
      [{
        id: 'part-legacy',
        metadata: { source_images: [{ id: 'source-row-id', filename: 'scan.png' }] },
      }],
      [
        { id: 'scan-a', filename: 'scan.png' },
        { id: 'scan-b', filename: 'scan.png' },
      ],
    );
    expect(ambiguous.partBuckets[0].images).toEqual([]);
    expect(ambiguous.unassignedImages.map((image) => image.id)).toEqual(['scan-a', 'scan-b']);

    const stale = buildHierarchy(
      [{
        id: 'part-stale',
        metadata: { source_images: [{ image_id: 'missing-id', filename: 'unique.png' }] },
      }],
      [{ id: 'active-id', filename: 'unique.png' }],
    );
    expect(stale.partBuckets[0].images).toEqual([]);
    expect(stale.unassignedImages.map((image) => image.id)).toEqual(['active-id']);
  });

  test('renders numeric duplicate labels while unloading by UUID', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchSpy;
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <RemoveImagesTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          display_name: 'Part 1',
          metadata: { source_images: [{ filename: 'scan.png', image_id: 'scan-a' }] },
        }]}
        images={[
          { id: 'scan-a', filename: 'scan.png', created_at: '2026-01-01T00:00:00Z' },
          { id: 'scan-b', filename: 'scan.png', created_at: '2026-01-02T00:00:00Z' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'scan (1).png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unload Selected (1)' }));

    await waitForAsyncWork(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/images/scan-b', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });
});
