import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UnloadPartsTab from '../UnloadPartsTab';

const originalFetch = global.fetch;

const PARTS = [
  { id: 'part-1', serial_number: 'SN-001' },
  { id: 'part-2', serial_number: 'SN-002' },
];

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('UnloadPartsTab', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  });

  test('does nothing when the native confirmation is cancelled', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    global.fetch = jest.fn();
    const onPartsUnloaded = jest.fn();

    render(
      <UnloadPartsTab
        projectId="project-1"
        parts={PARTS}
        onPartsUnloaded={onPartsUnloaded}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unload All Parts (2)' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Unload all 2 parts from this project?\n\nImages and batches will be preserved. This cannot be undone.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onPartsUnloaded).not.toHaveBeenCalled();
  });

  test('disables unloading when the project has zero parts', () => {
    const confirmSpy = jest.spyOn(window, 'confirm');
    global.fetch = jest.fn();

    render(<UnloadPartsTab projectId="project-1" parts={[]} />);

    expect(screen.getByText('There are no parts to unload.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unload All Parts (0)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Unload All Parts (0)' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('unloads all parts once and refreshes project state before reporting success', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const setError = jest.fn();
    const onPartsUnloaded = jest.fn().mockResolvedValue('fresh');

    render(
      <UnloadPartsTab
        projectId="project-1"
        parts={PARTS}
        onPartsUnloaded={onPartsUnloaded}
        setError={setError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unload All Parts (2)' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1/parts', {
        method: 'DELETE',
      });
    });
    await waitFor(() => expect(onPartsUnloaded).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unloaded 2 parts. Project images and batches were preserved.',
    );
    expect(setError).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Unload All Parts (2)' })).toBeDisabled();
  });

  test('shows a clear error and leaves refresh untouched when deletion fails', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const setError = jest.fn();
    const onPartsUnloaded = jest.fn();

    render(
      <UnloadPartsTab
        projectId="project-1"
        parts={PARTS}
        onPartsUnloaded={onPartsUnloaded}
        setError={setError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unload All Parts (2)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to unload all parts (503) | attempted=DELETE /api/projects/project-1/parts',
    );
    expect(setError).toHaveBeenLastCalledWith(
      'Failed to unload all parts (503) | attempted=DELETE /api/projects/project-1/parts',
    );
    expect(onPartsUnloaded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Unload All Parts (2)' })).toBeEnabled();
  });

  test('shows server detail and request id when bulk deletion returns a 500', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: (name) => (name === 'x-request-id' ? 'bulk-request-123' : null) },
      clone: () => ({
        json: async () => ({
          detail: 'Unexpected server error.',
          error_context: {
            method: 'DELETE',
            path: '/api/projects/project-1/parts',
            request_id: 'context-bulk-request-123',
          },
        }),
      }),
    });
    const setError = jest.fn();

    render(
      <UnloadPartsTab
        projectId="project-1"
        parts={PARTS}
        onPartsUnloaded={jest.fn()}
        setError={setError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unload All Parts (2)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to unload all parts (500 Internal Server Error)');
    expect(alert).toHaveTextContent('attempted=DELETE /api/projects/project-1/parts');
    expect(alert).toHaveTextContent('request_id=bulk-request-123');
    expect(alert).toHaveTextContent('details=Unexpected server error.');
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('attempted=DELETE /api/projects/project-1/parts'));
  });

  test.each([false, 'error', 'stale'])(
    'reports refresh outcome %p after deletion and blocks a repeat against stale props',
    async (refreshOutcome) => {
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
      const setError = jest.fn();
      const onPartsUnloaded = jest.fn().mockResolvedValue(refreshOutcome);
      const { rerender } = render(
        <UnloadPartsTab
          projectId="project-1"
          parts={PARTS}
          onPartsUnloaded={onPartsUnloaded}
          setError={setError}
        />,
      );

      const unloadButton = screen.getByRole('button', { name: 'Unload All Parts (2)' });
      fireEvent.click(unloadButton);

      const warning = await screen.findByRole('alert');
      expect(warning).toHaveTextContent(
        'Unloaded 2 parts, but project data could not be refreshed. Reload the project to verify its current parts before trying again.',
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(setError).toHaveBeenLastCalledWith(
        'Unloaded 2 parts, but project data could not be refreshed. Reload the project to verify its current parts before trying again.',
      );
      expect(unloadButton).toBeDisabled();

      fireEvent.click(unloadButton);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      rerender(
        <UnloadPartsTab
          projectId="project-1"
          parts={[{ id: 'part-3', serial_number: 'SN-003' }]}
          onPartsUnloaded={onPartsUnloaded}
          setError={setError}
        />,
      );
      expect(screen.getByRole('button', { name: 'Unload All Parts (1)' })).toBeEnabled();
    },
  );

  test('reports a refresh exception as a post-delete warning and keeps the action locked', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const setError = jest.fn();
    const onPartsUnloaded = jest.fn().mockRejectedValue(new Error('refresh unavailable'));

    render(
      <UnloadPartsTab
        projectId="project-1"
        parts={PARTS}
        onPartsUnloaded={onPartsUnloaded}
        setError={setError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unload All Parts (2)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unloaded 2 parts, but project data could not be refreshed.',
    );
    expect(screen.queryByText('Failed to unload all parts')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unload All Parts (2)' })).toBeDisabled();
  });

  test('blocks repeat submissions while the first deletion is in flight', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const pendingDelete = deferred();
    global.fetch = jest.fn().mockReturnValue(pendingDelete.promise);

    render(<UnloadPartsTab projectId="project-1" parts={PARTS} />);

    const unloadButton = screen.getByRole('button', { name: 'Unload All Parts (2)' });
    fireEvent.click(unloadButton);
    fireEvent.click(unloadButton);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Unloading All Parts...' })).toBeDisabled();

    pendingDelete.resolve({ ok: true, status: 204 });
    expect(await screen.findByRole('status')).toHaveTextContent('Unloaded 2 parts');
  });
});
