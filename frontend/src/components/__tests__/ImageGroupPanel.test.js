import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageGroupPanel from '../ImageGroupPanel';

const mockGroups = [
  { id: 'g1', identifier: 'SN001', display_name: 'Serial 001' },
  { id: 'g2', identifier: 'SN002', display_name: null },
];

const mockCurrentGroup = { id: 'g1', identifier: 'SN001', display_name: 'Serial 001' };

function setupFetch({ groups = mockGroups, currentGroup = null } = {}) {
  global.fetch = jest.fn((url, opts) => {
    if (url.includes('/groups?')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ groups }),
      });
    }
    if (url.match(/\/api\/groups\/[^/]+$/) && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        json: async () => currentGroup,
      });
    }
    // POST/DELETE for assign/remove
    return Promise.resolve({
      ok: true,
      json: async () => ({ assigned: 1, removed: 1 }),
    });
  });
}

const renderPanel = (props = {}) => {
  const defaultProps = {
    imageId: 'img-1',
    projectId: 'proj-1',
    groupId: null,
    onGroupChanged: jest.fn(),
    ...props,
  };
  return { ...render(<ImageGroupPanel {...defaultProps} />), props: defaultProps };
};

describe('ImageGroupPanel', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('renders "Group Assignment" header', () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    renderPanel();

    expect(screen.getByText('Group Assignment')).toBeInTheDocument();
  });

  test('shows "Not assigned" when groupId is null', async () => {
    setupFetch();
    renderPanel({ groupId: null });

    await waitFor(() => {
      expect(screen.getByText('Not assigned to any group')).toBeInTheDocument();
    });
  });

  test('shows current group name when groupId is set', async () => {
    setupFetch({ currentGroup: mockCurrentGroup });
    renderPanel({ groupId: 'g1' });

    await waitFor(() => {
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });
  });

  test('shows Edit button in view mode', async () => {
    setupFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
  });

  test('shows dropdown and Save/Cancel in edit mode', async () => {
    setupFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  test('dropdown includes "None" option and available groups', async () => {
    setupFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options.length).toBe(3); // None + 2 groups
      expect(options[0].textContent).toBe('-- None (ungrouped) --');
      expect(options[1].textContent).toBe('Serial 001');
      expect(options[2].textContent).toBe('SN002');
    });
  });

  test('Cancel returns to view mode without saving', async () => {
    setupFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  test('Save assigns image to selected group', async () => {
    setupFetch();
    const { props } = renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBe(3);
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/groups/g2/images',
        expect.objectContaining({ method: 'POST' })
      );
    });
    expect(props.onGroupChanged).toHaveBeenCalledWith('g2');
  });

  test('Save removes image from group when "None" selected', async () => {
    setupFetch({ currentGroup: mockCurrentGroup });
    const { props } = renderPanel({ groupId: 'g1' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/groups/g1/images',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    expect(props.onGroupChanged).toHaveBeenCalledWith(null);
  });

  test('shows error on save failure', async () => {
    global.fetch = jest.fn((url, opts) => {
      if (url.includes('/groups?')) {
        return Promise.resolve({ ok: true, json: async () => ({ groups: mockGroups }) });
      }
      if (opts && opts.method === 'POST') {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBe(3);
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText(/Request failed \(500\)/)).toBeInTheDocument();
    });
  });
});
