import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImagesToPartsTab from '../ImagesToPartsTab';

describe('ImagesToPartsTab', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('renders unassigned and per-part image hierarchy', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[
          {
            id: 'part-1',
            serial_number: 'SN-001',
            display_name: 'Part 1',
            metadata: { source_images: [{ filename: 'assigned-a.png', image_id: 'img-assigned-a' }] },
          },
        ]}
        images={[
          { id: 'img-assigned-a', filename: 'assigned-a.png' },
          { id: 'img-unassigned-z', filename: 'unassigned-z.png' },
        ]}
      />
    );

    expect(screen.getByText('Images to Parts')).toBeInTheDocument();
    expect(screen.getByText('assigned-a.png')).toBeInTheDocument();
    expect(screen.getByText('unassigned-z.png')).toBeInTheDocument();
  });

  test('moves an unassigned image into a part and calls backend assignment API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const onAssignmentsChanged = jest.fn().mockResolvedValue();

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[
          {
            id: 'part-1',
            serial_number: 'SN-001',
            display_name: 'Part 1',
            metadata: { source_images: [] },
          },
        ]}
        images={[{ filename: 'unassigned-z.png' }]}
        onAssignmentsChanged={onAssignmentsChanged}
        setError={jest.fn()}
      />
    );

    fireEvent.dragStart(screen.getByRole('button', { name: 'unassigned-z.png' }));
    fireEvent.drop(screen.getByTestId('images-to-parts-target-part-1'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'unassigned-z.png', to_part_id: 'part-1' }),
      });
    });
    await waitFor(() => {
      expect(onAssignmentsChanged).toHaveBeenCalled();
    });
  });

  test('opens a single-image modal when an image is clicked', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[
          {
            id: 'part-1',
            serial_number: 'SN-001',
            display_name: 'Part 1',
            metadata: { source_images: [{ filename: 'assigned-a.png', image_id: 'img-assigned-a' }] },
          },
        ]}
        images={[{ id: 'img-assigned-a', filename: 'assigned-a.png' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'assigned-a.png' }));

    const dialog = screen.getByRole('dialog', { name: 'assigned-a.png' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'assigned-a.png' })).toHaveAttribute(
      'src',
      '/api/images/img-assigned-a/content'
    );
  });

  test('opens a tiled part modal when a part heading is clicked', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[
          {
            id: 'part-1',
            serial_number: 'SN-001',
            display_name: 'Part 1',
            metadata: {
              source_images: [
                { filename: 'assigned-a.png', image_id: 'img-assigned-a' },
                { filename: 'assigned-b.png', image_id: 'img-assigned-b' },
              ],
            },
          },
        ]}
        images={[
          { id: 'img-assigned-a', filename: 'assigned-a.png' },
          { id: 'img-assigned-b', filename: 'assigned-b.png' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Part 1' }));

    const dialog = screen.getByRole('dialog', { name: 'Part 1' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'assigned-a.png' })).toHaveAttribute(
      'src',
      '/api/images/img-assigned-a/content'
    );
    expect(screen.getByRole('img', { name: 'assigned-b.png' })).toHaveAttribute(
      'src',
      '/api/images/img-assigned-b/content'
    );
  });


  test('creates a new part from the parts section button', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const onAssignmentsChanged = jest.fn().mockResolvedValue();
    const promptSpy = jest.spyOn(window, 'prompt')
      .mockReturnValueOnce('New Part Name');

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[]}
        onAssignmentsChanged={onAssignmentsChanged}
        setError={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create new part' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial_number: 'New Part Name', display_name: 'New Part Name' }),
      });
    });
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith('Enter a name for the new part:');
    await waitFor(() => {
      expect(onAssignmentsChanged).toHaveBeenCalled();
    });
  });

  test('does not create a new part when the name prompt is blank', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValueOnce('   ');

    render(<ImagesToPartsTab projectId="proj-1" parts={[]} images={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create new part' }));

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('adds an empty new part above existing parts after creating a part', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'part-new', serial_number: 'SN-NEW-001', display_name: 'New Part Name' }),
    });
    jest.spyOn(window, 'prompt')
      .mockReturnValueOnce('New Part Name');

    const { container } = render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[
          { id: 'part-1', serial_number: 'SN-001', display_name: 'Part 1', metadata: { source_images: [] } },
          { id: 'part-2', serial_number: 'SN-002', display_name: 'Part 2', metadata: { source_images: [] } },
        ]}
        images={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create new part' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Part Name' })).toBeInTheDocument();
    });
    expect(screen.getByText('Serial: SN-NEW-001')).toBeInTheDocument();
    expect(screen.getAllByText('No mapped images.')[0]).toBeInTheDocument();

    const partHeadings = Array.from(container.querySelectorAll('.parts-column .part-heading-button')).map((node) =>
      node.textContent?.trim()
    );
    expect(partHeadings).toEqual(['New Part Name', 'Part 1', 'Part 2']);
  });



  test('supports All and None selection controls in Unassigned panel', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[
          { id: 'img-a', filename: 'unassigned-a.png' },
          { id: 'img-b', filename: 'unassigned-b.png' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(document.querySelectorAll('.image-part-chip.selected')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(document.querySelectorAll('.image-part-chip.selected')).toHaveLength(0);
  });

  test('drags multiple selected unassigned images to a part', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[{ id: 'part-1', serial_number: 'SN-001', display_name: 'Part 1', metadata: { source_images: [] } }]}
        images={[{ filename: 'unassigned-a.png' }, { filename: 'unassigned-b.png' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.dragStart(screen.getByRole('button', { name: 'unassigned-a.png' }));
    fireEvent.drop(screen.getByTestId('images-to-parts-target-part-1'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', expect.objectContaining({
        method: 'POST',
      }));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });


  test('filters unloaded images out of part buckets', () => {
    render(
      <ImagesToPartsTab
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
    expect(screen.getByText('No mapped images.')).toBeInTheDocument();
  });

  test('drags an image from a part back to unassigned', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          serial_number: 'SN-001',
          display_name: 'Part 1',
          metadata: { source_images: [{ filename: 'assigned-a.png', image_id: 'img-assigned-a' }] },
        }]}
        images={[{ id: 'img-assigned-a', filename: 'assigned-a.png' }]}
      />
    );

    fireEvent.dragStart(screen.getByRole('button', { name: 'assigned-a.png' }));
    fireEvent.drop(screen.getByTestId('images-to-parts-unassigned-target'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'assigned-a.png', to_part_id: null }),
      });
    });
    await waitFor(() => expect(screen.getByTestId('images-to-parts-unassigned-target')).toHaveTextContent('assigned-a.png'));
  });

  test('deletes a part and moves its images to unassigned', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          serial_number: 'SN-001',
          display_name: 'Part 1',
          metadata: { source_images: [{ filename: 'assigned-a.png', image_id: 'img-assigned-a' }] },
        }]}
        images={[{ id: 'img-assigned-a', filename: 'assigned-a.png' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete part Part 1' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/part-1', { method: 'DELETE' });
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Part 1' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('images-to-parts-unassigned-target')).toHaveTextContent('assigned-a.png'));
  });

  test('toggles inline image thumbnails on and off', () => {
    const { container } = render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[
          { id: 'img-a', filename: 'unassigned-a.png' },
          { id: 'img-b', filename: 'unassigned-b.png' },
        ]}
      />
    );

    expect(container.querySelectorAll('.image-part-chip-thumbnail')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Show image thumbnails'));

    expect(container.querySelectorAll('.image-part-chip-thumbnail')).toHaveLength(0);
  });
});
