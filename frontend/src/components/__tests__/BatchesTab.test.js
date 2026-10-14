import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BatchesTab from '../BatchesTab';

describe('BatchesTab', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('renders batch summary and manual counts', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'batch-1', name: 'Batch 1', status: 'in_progress', owner: 'alice' }],
    });

    render(
      <BatchesTab
        projectId="proj-1"
        parts={[
          { id: 'part-1', batch_id: 'batch-1', display_name: 'Part A', review_state: 'pass', metadata: { manual_flagged: true } },
          { id: 'part-2', batch_id: 'batch-1', display_name: 'Part B', review_state: 'reject_pending', metadata: {} },
        ]}
      />,
    );

    expect(await screen.findByDisplayValue('Batch 1')).toBeInTheDocument();
    expect(screen.getByText(/Parts: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Accepted: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Rejected: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Manual: 1/)).toBeInTheDocument();
  });


  test('keeps unbatched parts sticky while batch targets scroll', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => Array.from({ length: 12 }, (_, index) => ({
        id: `batch-${index + 1}`,
        name: `Batch ${index + 1}`,
        status: 'not_started',
        owner: '',
      })),
    });

    render(
      <BatchesTab
        projectId="proj-1"
        parts={[{ id: 'part-1', display_name: 'Part A', serial_number: 'SN-1', metadata: {} }]}
      />,
    );

    await screen.findByDisplayValue('Batch 1');
    expect(screen.getByTestId('batch-target-unbatched')).toHaveClass('sticky-assignment-column');
  });

  test('moves unbatched part into a batch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'batch-1', name: 'Batch 1', status: 'not_started', owner: '' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const onAssignmentsChanged = jest.fn().mockResolvedValue();

    render(
      <BatchesTab
        projectId="proj-1"
        parts={[{ id: 'part-1', display_name: 'Part A', serial_number: 'SN-1', metadata: {} }]}
        onAssignmentsChanged={onAssignmentsChanged}
      />,
    );

    await screen.findByDisplayValue('Batch 1');
    fireEvent.dragStart(screen.getByText('Part A'));
    fireEvent.drop(screen.getByTestId('batch-target-batch-1'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/batch-assignments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ part_id: 'part-1', to_batch_id: 'batch-1' }),
      }));
    });
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalled());
  });

  test('uses the synchronous drag payload when a part is dropped immediately', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'batch-1', name: 'Batch 1' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const values = new Map();
    const dataTransfer = {
      effectAllowed: '',
      setData: jest.fn((type, value) => values.set(type, value)),
      getData: jest.fn((type) => values.get(type) || ''),
    };

    render(<BatchesTab projectId="proj-1" parts={[{ id: 'part-fast', display_name: 'Fast Part' }]} />);

    await screen.findByDisplayValue('Batch 1');
    fireEvent.dragStart(screen.getByText('Fast Part').closest('.batch-part-chip'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('batch-target-batch-1'), { dataTransfer });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects/proj-1/parts/batch-assignments',
      expect.objectContaining({ body: JSON.stringify({ part_id: 'part-fast', to_batch_id: 'batch-1' }) }),
    ));
  });

  test('does not start marquee selection when native dragging begins on a part chip', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'batch-1', name: 'Batch 1' }],
    });
    render(<BatchesTab projectId="proj-1" parts={[{ id: 'part-1', display_name: 'Part A' }]} />);
    await screen.findByDisplayValue('Batch 1');

    const chip = screen.getByText('Part A').closest('.batch-part-chip');
    const grid = document.querySelector('.batches-grid');
    fireEvent.mouseDown(chip, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(grid, { clientX: 100, clientY: 100 });

    expect(screen.queryByTestId('batch-selection-marquee')).not.toBeInTheDocument();
  });

  test('keeps the dragged part identity when dropping onto a new batch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'batch-new', name: 'Batch 1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const data = new Map();
    const dataTransfer = {
      setData: (type, value) => data.set(type, value),
      getData: (type) => data.get(type) || '',
    };
    render(<BatchesTab projectId="proj-1" parts={[{ id: 'part-new', display_name: 'New Part' }]} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.dragStart(screen.getByText('New Part').closest('.batch-part-chip'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('batch-target-new'), { dataTransfer });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects/proj-1/parts/batch-assignments',
      expect.objectContaining({ body: JSON.stringify({ part_id: 'part-new', to_batch_id: 'batch-new' }) }),
    ));
  });

  test('does not submit stale selected part ids after the parts list changes', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'batch-1', name: 'Batch 1' }] })
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    const initialParts = [
      { id: 'part-removed', display_name: 'Removed Part' },
      { id: 'part-current', display_name: 'Current Part' },
    ];
    const { rerender } = render(<BatchesTab projectId="proj-1" parts={initialParts} />);
    await screen.findByDisplayValue('Batch 1');

    fireEvent.click(screen.getByText('Removed Part').closest('.batch-part-chip'));
    fireEvent.click(screen.getByText('Current Part').closest('.batch-part-chip'), { ctrlKey: true });
    rerender(<BatchesTab projectId="proj-1" parts={[initialParts[1]]} />);
    fireEvent.dragStart(screen.getByText('Current Part').closest('.batch-part-chip'));
    fireEvent.drop(screen.getByTestId('batch-target-batch-1'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects/proj-1/parts/batch-assignments',
      expect.objectContaining({ body: JSON.stringify({ part_id: 'part-current', to_batch_id: 'batch-1' }) }),
    ));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      '/api/projects/proj-1/parts/batch-assignments',
      expect.objectContaining({ body: JSON.stringify({ part_id: 'part-removed', to_batch_id: 'batch-1' }) }),
    );
  });

  test('deletes a batch and refreshes assignments so parts move back to unbatched', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'batch-1', name: 'Batch 1', status: 'not_started', owner: '' }] })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onAssignmentsChanged = jest.fn().mockResolvedValue();

    render(
      <BatchesTab
        projectId="proj-1"
        parts={[{ id: 'part-1', batch_id: 'batch-1', display_name: 'Part A', serial_number: 'SN-1', metadata: {} }]}
        onAssignmentsChanged={onAssignmentsChanged}
      />,
    );

    await screen.findByDisplayValue('Batch 1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete batch Batch 1' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/proj-1/batches/batch-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete Batch 1? 1 part assigned to this batch will move to Unbatched Parts.',
    );
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('Batch 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-target-unbatched')).toHaveTextContent('Part A');
  });


  test('supports file-explorer style ctrl-click, shift-click, and marquee selection across unbatched and batched parts', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'batch-1', name: 'Batch 1', status: 'not_started', owner: '' }],
    });

    render(
      <BatchesTab
        projectId="proj-1"
        parts={[
          { id: 'part-a', display_name: 'Part A', metadata: {} },
          { id: 'part-b', display_name: 'Part B', metadata: {} },
          { id: 'part-c', batch_id: 'batch-1', display_name: 'Part C', metadata: {} },
          { id: 'part-d', batch_id: 'batch-1', display_name: 'Part D', metadata: {} },
        ]}
      />,
    );

    await screen.findByDisplayValue('Batch 1');
    const partA = screen.getByText('Part A').closest('.batch-part-chip');
    const partB = screen.getByText('Part B').closest('.batch-part-chip');
    const partC = screen.getByText('Part C').closest('.batch-part-chip');
    const partD = screen.getByText('Part D').closest('.batch-part-chip');

    fireEvent.click(partA);
    expect(partA).toHaveClass('selected');

    fireEvent.click(partC, { shiftKey: true });
    expect(partA).toHaveClass('selected');
    expect(partB).toHaveClass('selected');
    expect(partC).toHaveClass('selected');
    expect(partD).not.toHaveClass('selected');

    fireEvent.click(partB, { ctrlKey: true });
    expect(partB).not.toHaveClass('selected');
    expect(partA).toHaveClass('selected');
    expect(partC).toHaveClass('selected');

    [partA, partB, partC, partD].forEach((chip, index) => {
      chip.getBoundingClientRect = jest.fn(() => ({
        left: 10,
        right: 110,
        top: 20 + (index * 30),
        bottom: 45 + (index * 30),
        width: 100,
        height: 25,
      }));
    });

    const grid = document.querySelector('.batches-grid');
    fireEvent.mouseDown(grid, { button: 0, clientX: 0, clientY: 15 });
    fireEvent.mouseMove(grid, { clientX: 120, clientY: 110 });
    expect(screen.getByTestId('batch-selection-marquee')).toBeInTheDocument();
    fireEvent.mouseUp(grid, { clientX: 120, clientY: 110 });

    expect(partA).toHaveClass('selected');
    expect(partB).toHaveClass('selected');
    expect(partC).toHaveClass('selected');
    expect(partD).not.toHaveClass('selected');
  });


});
