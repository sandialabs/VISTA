import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BatchesTab from '../BatchesTab';

describe('BatchesTab', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('renders batch summary and manual counts', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
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
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/parts/batch-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ part_id: 'part-1', to_batch_id: 'batch-1' }),
      });
    });
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalled());
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
      expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/batches/batch-1', { method: 'DELETE' });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete Batch 1? 1 part assigned to this batch will move to Unbatched Parts.',
    );
    await waitFor(() => expect(onAssignmentsChanged).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('Batch 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-target-unbatched')).toHaveTextContent('Part A');
  });

});
