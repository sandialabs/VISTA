import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RemoveImagesTab from '../RemoveImagesTab';

describe('RemoveImagesTab', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('labels the subtab panel as Unload Images and unloads selected images', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
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

    expect(screen.getByRole('tabpanel', { name: 'Unload Images' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unload Images' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Unload Selected (1)' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/images/img-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Unloaded from Project Data Unload Images tab' }),
      });
    });
    await waitFor(() => expect(onImagesRemoved).toHaveBeenCalled());
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
});
