import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ImagesToPartsTab, { buildBuckets } from '../ImagesToPartsTab';
import { shouldApplyDisplayWindowToVolumeCache } from '../InspectionWorkbenchPanel';

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
    expect(screen.queryByText('Serial: SN-001')).not.toBeInTheDocument();
  });


  test('keeps the unassigned assignment source column sticky while parts scroll', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={Array.from({ length: 12 }, (_, index) => ({
          id: `part-${index + 1}`,
          serial_number: `SN-${index + 1}`,
          display_name: `Part ${index + 1}`,
          metadata: { source_images: [] },
        }))}
        images={[{ id: 'unassigned-1', filename: 'unassigned-1.png' }]}
      />
    );

    expect(screen.getByTestId('images-to-parts-unassigned-target')).toHaveClass('sticky-assignment-column');
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
        body: JSON.stringify({ filename: 'unassigned-z.png', image_id: null, to_part_id: 'part-1' }),
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
    expect(screen.queryByText('Serial: SN-001')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Serial: SN-001')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Serial: SN-NEW-001')).not.toBeInTheDocument();
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
        body: JSON.stringify({ filename: 'assigned-a.png', image_id: 'img-assigned-a', to_part_id: null }),
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

  test('reports the attempted HTTP call when part deletion fails', async () => {
    const setError = jest.fn();
    const failedResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: (name) => (name === 'x-request-id' ? 'request-123' : null) },
      clone: () => ({
        json: async () => ({
          detail: 'Unexpected server error.',
          error_context: {
            method: 'DELETE',
            path: '/api/projects/proj-1/parts/part-1',
            request_id: 'context-request-123',
          },
        }),
      }),
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(failedResponse);
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
        setError={setError}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete part Part 1' }));

    await waitFor(() => {
      expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('Failed to delete part (500 Internal Server Error)'));
      expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('attempted=DELETE /api/projects/proj-1/parts/part-1'));
      expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('request_id=request-123'));
      expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('details=Unexpected server error.'));
    });
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

  test('keeps same-name numpy stacks distinct and moves only the dragged duplicate to a part', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <ImagesToPartsTab
        projectId="proj-pt3"
        parts={[{ id: 'part-1', serial_number: 'PT3-001', display_name: 'PT3 Part', metadata: { source_images: [] } }]}
        images={[
          { id: 'stack-base-id', filename: 'scan.npy' },
          { id: 'stack-overlay-id', filename: 'scan.npy' },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'scan.npy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scan (1).npy' })).toBeInTheDocument();

    fireEvent.dragStart(screen.getByRole('button', { name: 'scan.npy' }));
    fireEvent.drop(screen.getByTestId('images-to-parts-target-part-1'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-pt3/parts/image-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'scan.npy', image_id: 'stack-base-id', to_part_id: 'part-1' }),
      });
    });

    await waitFor(() => expect(screen.getByTestId('images-to-parts-unassigned-target')).toHaveTextContent('scan (1).npy'));
    await waitFor(() => expect(screen.getByTestId('images-to-parts-unassigned-target')).not.toHaveTextContent('scan.npy'));
  });

  test('claims exact-name files only by UUID and leaves same-name twins unassigned', () => {
    const buckets = buildBuckets({
      parts: [{
        id: 'part-1',
        display_name: 'Part 1',
        metadata: { source_images: [{ image_id: 'scan-a', filename: 'scan.png' }] },
      }],
      images: [
        { id: 'scan-a', filename: 'scan.png', created_at: '2026-01-01T00:00:00Z' },
        { id: 'scan-b', filename: 'scan.png', created_at: '2026-01-02T00:00:00Z' },
      ],
    });

    expect(buckets.partBuckets[0].images.map((image) => image.id)).toEqual(['scan-a']);
    expect(buckets.unassigned.map((image) => [image.id, image.displayName])).toEqual([
      ['scan-b', 'scan (1).png'],
    ]);
  });

  test('keeps ambiguous legacy and stale explicit assignments visible as unassigned', () => {
    const ambiguous = buildBuckets({
      parts: [{
        id: 'part-legacy',
        metadata: { source_images: [{ id: 'unrelated-record-id', filename: 'scan.png' }] },
      }],
      images: [
        { id: 'scan-a', filename: 'scan.png', created_at: '2026-01-01T00:00:00Z' },
        { id: 'scan-b', filename: 'scan.png', created_at: '2026-01-02T00:00:00Z' },
      ],
    });
    expect(ambiguous.partBuckets[0].images).toEqual([]);
    expect(ambiguous.unassigned.map((image) => image.id)).toEqual(['scan-a', 'scan-b']);

    const stale = buildBuckets({
      parts: [{
        id: 'part-stale',
        metadata: { source_images: [{ image_id: 'missing-id', filename: 'unique.png' }] },
      }],
      images: [{ id: 'active-id', filename: 'unique.png' }],
    });
    expect(stale.partBuckets[0].images).toEqual([]);
    expect(stale.unassigned.map((image) => image.id)).toEqual(['active-id']);
  });

  test('ignores unrelated source record ids when resolving a unique legacy filename', () => {
    const buckets = buildBuckets({
      parts: [{
        id: 'part-legacy',
        metadata: { source_images: [{ id: 'source-row-id', filename: 'unique.png' }] },
      }],
      images: [{ id: 'image-uuid', filename: 'unique.png' }],
    });

    expect(buckets.partBuckets[0].images.map((image) => image.id)).toEqual(['image-uuid']);
    expect(buckets.unassigned).toEqual([]);
  });

  test('automatically creates parts from selected filename segments and assigns matching images', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      if (url === '/api/projects/proj-1/parts') {
        const payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: `part-${payload.serial_number}`, serial_number: payload.serial_number, display_name: payload.display_name }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const onAssignmentsChanged = jest.fn().mockResolvedValue();

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[
          { id: 'img-1', filename: 'L1_SN1_front.png' },
          { id: 'img-2', filename: 'L1_SN1_back.png' },
          { id: 'img-3', filename: 'L1_SN2_front.png' },
          { id: 'img-4', filename: 'L1_SN2_back.png' },
          { id: 'img-5', filename: 'L2_SN1_front.png' },
          { id: 'img-6', filename: 'L2_SN1_back.png' },
          { id: 'img-7', filename: 'L2_SN2_front.png' },
          { id: 'img-8', filename: 'L2_SN2_back.png' },
        ]}
        onAssignmentsChanged={onAssignmentsChanged}
        setError={jest.fn()}
      />
    );

    const filenameKeySelect = screen.getByRole('combobox', { name: 'Filename key for autoassign' });
    expect(within(filenameKeySelect).getByRole('option', { name: 'Blank key (numeric segment)' })).toBeInTheDocument();
    expect(within(filenameKeySelect).getByRole('option', { name: 'SN' })).toBeInTheDocument();
    fireEvent.change(filenameKeySelect, { target: { value: 'SN' } });

    expect(screen.getByText('Part 1')).toBeInTheDocument();
    expect(screen.getAllByText('4 images')).toHaveLength(2);
    expect(screen.getAllByText('L2_SN1_back.png').length).toBeGreaterThan(0);
    expect(screen.getByText('Part 2')).toBeInTheDocument();
    expect(screen.getAllByText('L2_SN2_back.png').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Assign Parts' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ serial_number: '1', display_name: '1' }),
    })));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ filename: 'L2_SN2_back.png', image_id: 'img-8', to_part_id: 'part-2' }),
    })));
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });


  test('switches autoassign dropdown between filename keys and mapped metadata labels', async () => {
    const projectConfiguration = {
      file_naming_scheme: {
        hierarchy_levels: [
          { id: 'serial_number', label: 'Serial', abbreviation: 'SN' },
        ],
      },
    };

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        projectConfiguration={projectConfiguration}
        images={[
          { id: 'img-1', filename: 'SN100_front.png', metadata: { serial_number: '100' } },
          { id: 'img-2', filename: 'SN200_front.png', metadata: { serial_number: '200' } },
        ]}
      />
    );

    const keySelect = screen.getByRole('combobox', { name: 'Filename key for autoassign' });
    expect(within(keySelect).getByRole('option', { name: 'SN' })).toBeInTheDocument();
    expect(within(keySelect).queryByRole('option', { name: 'serial_number' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use metadata labels for autoassign' }));

    expect(within(keySelect).getByRole('option', { name: 'serial_number' })).toBeInTheDocument();
    expect(within(keySelect).queryByRole('option', { name: 'SN' })).not.toBeInTheDocument();
    fireEvent.change(keySelect, { target: { value: 'serial_number' } });
    expect(screen.getByText('Part 100')).toBeInTheDocument();
    expect(screen.getAllByText('SN100_front.png').length).toBeGreaterThan(0);
    expect(screen.getByText('Part 200')).toBeInTheDocument();
    expect(screen.getAllByText('SN200_front.png').length).toBeGreaterThan(0);
  });

  test('can use a numeric filename segment with no letter identifier as the assignment key', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      if (url === '/api/projects/proj-1/parts') {
        const payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: `part-${payload.serial_number}`, serial_number: payload.serial_number, display_name: payload.display_name }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[
          { id: 'img-001', filename: 'L1_SN1_001.png' },
          { id: 'img-002', filename: 'L1_SN1_002.png' },
        ]}
      />
    );

    fireEvent.change(screen.getByLabelText('Filename key for autoassign'), { target: { value: '' } });

    expect(screen.getByText('Part 001')).toBeInTheDocument();
    expect(screen.getAllByText('L1_SN1_001.png').length).toBeGreaterThan(0);
    expect(screen.getByText('Part 002')).toBeInTheDocument();
    expect(screen.getAllByText('L1_SN1_002.png').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Assign Parts' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ serial_number: '001', display_name: '001' }),
    })));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ filename: 'L1_SN1_001.png', image_id: 'img-001', to_part_id: 'part-001' }),
    })));
  });


  test('multi-level autoassign creates compound parts from multiple filename levels', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      if (url === '/api/projects/proj-1/parts') {
        const payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: `part-${payload.serial_number}`, serial_number: payload.serial_number, display_name: payload.display_name }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[
          { id: 'img-1', filename: 'D1_SN1_front.png' },
          { id: 'img-2', filename: 'D1_SN2_front.png' },
          { id: 'img-3', filename: 'D2_SN1_front.png' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use multi-level autoassign' }));
    fireEvent.change(screen.getByLabelText('Filename key', { selector: '#auto-assign-level-key-1' }), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));
    const keySelects = screen.getAllByLabelText('Filename key');
    fireEvent.change(keySelects[1], { target: { value: 'SN' } });

    expect(screen.getByText('Part 1-1')).toBeInTheDocument();
    expect(screen.getByText('Part 1-2')).toBeInTheDocument();
    expect(screen.getByText('Part 2-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assign Parts' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ serial_number: '1-1', display_name: '1-1' }),
    })));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ filename: 'D2_SN1_front.png', image_id: 'img-3', to_part_id: 'part-2-1' }),
    })));
  });

  test('single-level metadata mode requires a metadata label instead of a blank filename key', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[{ id: 'img-1', filename: '001_front.png', metadata: { serial_number: 'SN001' } }]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use metadata labels for autoassign' }));
    const keySelect = screen.getByRole('combobox', { name: 'Filename key for autoassign' });
    expect(within(keySelect).getByRole('option', { name: 'Select metadata label' })).toBeInTheDocument();
    expect(within(keySelect).queryByRole('option', { name: 'Blank key (numeric segment)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Parts' })).toBeDisabled();
  });

  test('multi-level blank filename levels consume numeric filename segments in order', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[{ id: 'img-1', filename: '001_002_front.png' }]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use multi-level autoassign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));

    expect(screen.getByText('Part 001-002')).toBeInTheDocument();
    expect(screen.queryByText('Part 001-001')).not.toBeInTheDocument();
  });

  test('multi-level autoassign waits for metadata levels to select a label', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[{ id: 'img-1', filename: 'D1_front.png', metadata: { serial_number: 'SN001' } }]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use multi-level autoassign' }));
    fireEvent.change(screen.getByLabelText('Filename key', { selector: '#auto-assign-level-key-1' }), { target: { value: 'D' } });
    expect(screen.getByText('Part 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));
    fireEvent.change(screen.getByLabelText('Level 2 source'), { target: { value: 'metadata' } });

    expect(screen.getByRole('option', { name: 'Select metadata label' })).toBeInTheDocument();
    expect(screen.queryByText('Part 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Parts' })).toBeDisabled();
  });

  test('multi-level autoassign can combine filename and metadata levels and skips incomplete images', () => {
    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[]}
        images={[
          { id: 'img-1', filename: 'D1_front.png', metadata: { serial_number: 'SN 001' } },
          { id: 'img-2', filename: 'D1_back.png', metadata: {} },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use multi-level autoassign' }));
    fireEvent.change(screen.getByLabelText('Filename key', { selector: '#auto-assign-level-key-1' }), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add level' }));
    fireEvent.change(screen.getByLabelText('Level 2 source'), { target: { value: 'metadata' } });
    fireEvent.change(screen.getByLabelText('Metadata label'), { target: { value: 'serial_number' } });

    expect(screen.getByText('Part 1-SN001')).toBeInTheDocument();
    expect(screen.getAllByText('D1_front.png').length).toBeGreaterThan(0);
    expect(screen.queryByText('Part 1-')).not.toBeInTheDocument();
  });

});

test('opens a multi-image volume viewer with metadata, editable slice, and axis control', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      image_count: 5,
      height: 12,
      width: 10,
      interpretation: 'voxel_array',
      bit_depth: 16,
      pixel_dtype: 'uint16',
      dimensions: { axial: 5, coronal: 12, sagittal: 10 },
    }),
  });

  render(
    <ImagesToPartsTab
      projectId="proj-1"
      parts={[{ id: 'part-1', serial_number: 'SN-001', display_name: 'Part 1', metadata: { source_images: [{ filename: 'volume.npy', image_id: 'img-volume' }] } }]}
      images={[{ id: 'img-volume', filename: 'volume.npy', metadata: { load_mode: 'volume', frame_count: 5 } }]}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'volume.npy' }));

  expect(await screen.findByRole('dialog', { name: 'volume.npy' })).toBeInTheDocument();
  expect(await screen.findByText('Total images')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
  expect(screen.getByText('12 × 10')).toBeInTheDocument();
  expect(screen.getByText('Voxel array')).toBeInTheDocument();
  expect(screen.getByText(/16-bit uint16/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Slice axis'), { target: { value: 'sagittal' } });
  fireEvent.change(screen.getByLabelText('Current slice'), { target: { value: '3' } });
  expect(screen.getByLabelText('Current slice')).toHaveValue(3);
});

test('opens a single-image viewer for a one-frame TIFF instead of a stack preview', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });

  render(
    <ImagesToPartsTab
      projectId="proj-1"
      parts={[{ id: 'part-1', serial_number: 'SN-001', display_name: 'Part 1', metadata: { source_images: [{ filename: 'slice.tif', image_id: 'img-tiff' }] } }]}
      images={[{ id: 'img-tiff', filename: 'slice.tif', metadata: { tiff_dimensionality: '2d', load_mode: 'single_image', frame_count: 1 } }]}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'slice.tif' }));

  const dialog = await screen.findByRole('dialog', { name: 'slice.tif' });
  expect(within(dialog).getByRole('img', { name: 'slice.tif' })).toHaveAttribute('src', '/api/images/img-tiff/content');
  expect(within(dialog).queryByText('Multi-image volume preview')).not.toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('uses canonical descriptor fields when volume metadata omits legacy display fields', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      dimensions: { axial: 749, coronal: 1010, sagittal: 984 },
      source_kind: 'npy',
      channel_count: 4,
      color_mode: 'rgba',
    }),
  });

  render(
    <ImagesToPartsTab
      projectId="proj-1"
      parts={[{ id: 'part-1', serial_number: 'SN-001', display_name: 'Part 1', metadata: { source_images: [{ filename: 'segments.npy', image_id: 'img-volume' }] } }]}
      images={[{ id: 'img-volume', filename: 'segments.npy', metadata: { load_mode: 'volume' } }]}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'segments.npy' }));

  const dialog = await screen.findByRole('dialog', { name: 'segments.npy' });
  expect(await within(dialog).findByText('749')).toBeInTheDocument();
  expect(within(dialog).getByText('1010 × 984')).toBeInTheDocument();
  expect(within(dialog).getByText('Voxel array')).toBeInTheDocument();
  expect(within(dialog).getByText('8-bit uint8')).toBeInTheDocument();
});

test.each([
  ['npy', 'segments.npy', 'voxel_array'],
  ['npz', 'segments.npz', 'voxel_array'],
  ['inspiro', 'segments.inspiro', 'voxel_array'],
  ['tiff', 'segments.tif', 'stack_of_2d_images'],
])('preserves RGBA layout metadata in the lazy %s volume preview', async (
  sourceKind,
  filename,
  interpretation,
) => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      image_count: 5,
      height: 12,
      width: 10,
      interpretation,
      source_kind: sourceKind,
      bit_depth: 8,
      pixel_dtype: 'uint8',
      channel_count: 4,
      color_mode: 'rgba',
      dimensions: { axial: 5, coronal: 12, sagittal: 10 },
    }),
  });

  render(
    <ImagesToPartsTab
      projectId="proj-1"
      parts={[{
        id: 'part-rgba',
        serial_number: 'RGBA-001',
        display_name: 'RGBA segments',
        metadata: { source_images: [{ filename, image_id: 'img-rgba-volume' }] },
      }]}
      images={[{
        id: 'img-rgba-volume',
        filename,
        metadata: { load_mode: 'volume', frame_count: 5 },
      }]}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: filename }));

  const dialog = await screen.findByRole('dialog', { name: filename });
  const sliceCanvas = await within(dialog).findByRole('img', { name: 'XY slice 2' });
  expect(sliceCanvas).toHaveAttribute('data-volume-color-mode', 'rgba');
  expect(shouldApplyDisplayWindowToVolumeCache({ colorMode: sliceCanvas.dataset.volumeColorMode })).toBe(false);
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/volume-slice'))).toHaveLength(0);
});

describe('ImagesToPartsTab volume preview progress', () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  afterEach(() => {
    jest.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  test('shows legacy stack caching progress inside the modal view section', async () => {
    URL.createObjectURL = jest.fn(() => 'blob:preview-slice');
    URL.revokeObjectURL = jest.fn();

    const oneMb = new Uint8Array(1024 * 1024);
    const sliceStream = {
      getReader: () => {
        let delivered = false;
        return {
          read: () => {
            if (!delivered) {
              delivered = true;
              return Promise.resolve({ done: false, value: oneMb });
            }
            return new Promise(() => {});
          },
        };
      },
    };

    global.fetch = jest.fn((url) => {
      if (url.includes('/volume-metadata')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            image_count: 1,
            height: 8,
            width: 8,
            dimensions: { axial: 1, coronal: 8, sagittal: 8 },
            interpretation: 'voxel_array',
            bit_depth: 8,
            pixel_dtype: 'uint8',
          }),
        });
      }
      if (url.includes('/volume-slice')) {
        return Promise.resolve({
          ok: true,
          headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(2 * 1024 * 1024) : 'image/png') },
          body: sliceStream,
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[{
          id: 'part-1',
          serial_number: 'P1',
          display_name: 'Part 1',
          metadata: { source_images: [{ filename: 'scan.tif', image_id: 'img-volume-1' }] },
        }]}
        images={[{ id: 'img-volume-1', filename: 'scan.tif', metadata: { load_mode: 'volume' } }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'scan.tif' }));

    const dialog = await screen.findByRole('dialog', { name: 'scan.tif' });
    await waitFor(() => expect(within(dialog).getByText('Caching 1/2 MB')).toBeInTheDocument());
    expect(within(dialog).getByTestId('volume-slice-stage')).toContainElement(within(dialog).getByRole('status'));
  });

  test('does not eagerly fetch every axial slice for a large npy preview', async () => {
    const dimensions = { axial: 749, coronal: 1010, sagittal: 984 };
    global.fetch = jest.fn((url) => {
      if (url.includes('/volume-metadata')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            image_count: dimensions.axial,
            height: dimensions.coronal,
            width: dimensions.sagittal,
            dimensions,
            interpretation: 'voxel_array',
            bit_depth: 16,
            pixel_dtype: 'uint16',
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(
      <ImagesToPartsTab
        projectId="proj-1"
        parts={[{
          id: 'part-large',
          serial_number: 'P-LARGE',
          display_name: 'Large part',
          metadata: { source_images: [{ filename: 'large-part.npy', image_id: 'large-volume-id' }] },
        }]}
        images={[{ id: 'large-volume-id', filename: 'large-part.npy', metadata: { load_mode: 'volume' } }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'large-part.npy' }));
    const dialog = await screen.findByRole('dialog', { name: 'large-part.npy' });
    await waitFor(() => expect(within(dialog).getByText('749')).toBeInTheDocument());

    expect(global.fetch.mock.calls.filter(([url]) => url.includes('/volume-slice'))).toHaveLength(0);
    expect(within(dialog).queryByText(/Caching \d+\//)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'XY slice 374' })).toHaveAttribute('width', '984');
    expect(within(dialog).getByRole('img', { name: 'XY slice 374' })).toHaveAttribute('height', '1010');
  });
});
