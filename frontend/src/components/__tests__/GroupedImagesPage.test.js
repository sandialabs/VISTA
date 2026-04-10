import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import GroupedImagesPage from '../GroupedImagesPage';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockGroups = [
  { id: 'g1', identifier: 'SN001', display_name: 'Serial 001', image_count: 3, aggregate_review_status: 'pass' },
  { id: 'g2', identifier: 'SN002', display_name: null, image_count: 1, aggregate_review_status: 'reject_pending' },
  { id: 'g3', identifier: 'SN003', display_name: 'Serial 003', image_count: 5, aggregate_review_status: 'reject_confirmed' },
];

function mockFetchResponses({ groups = mockGroups, total = null, ungroupedCount = 0 } = {}) {
  global.fetch = jest.fn((url) => {
    if (url.includes('/groups?')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ groups, total: total ?? groups.length }),
      });
    }
    if (url.includes('/ungrouped-count')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ count: ungroupedCount }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

const renderPage = (props = {}) => {
  const defaultProps = {
    projectId: 'proj-1',
    projectName: 'Test Project',
    onBack: jest.fn(),
    search: '',
    ...props,
  };
  return render(
    <BrowserRouter>
      <GroupedImagesPage {...defaultProps} />
    </BrowserRouter>
  );
};

describe('GroupedImagesPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('shows loading spinner initially', () => {
    mockFetchResponses();
    renderPage();
    expect(screen.getByText('Loading groups...')).toBeInTheDocument();
  });

  test('renders group rows after loading', async () => {
    mockFetchResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });
    expect(screen.getByText('SN002')).toBeInTheDocument();
    expect(screen.getByText('Serial 003')).toBeInTheDocument();
  });

  test('shows image count for each group', async () => {
    mockFetchResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('3 images')).toBeInTheDocument();
    });
    expect(screen.getByText('1 image')).toBeInTheDocument();
    expect(screen.getByText('5 images')).toBeInTheDocument();
  });

  test('shows review status badges', async () => {
    mockFetchResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Pass')).toBeInTheDocument();
    });
    expect(screen.getByText('Reject Pending')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  test('shows identifier alongside display_name when they differ', async () => {
    mockFetchResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });
    // SN001 shown as sub-text since display_name differs
    expect(screen.getByText('SN001')).toBeInTheDocument();
  });

  test('navigates to group gallery on click', async () => {
    mockFetchResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });

    const row = screen.getByText('Serial 001').closest('.group-row');
    fireEvent.click(row);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/project/proj-1/group/g1',
      { state: { groupIdentifier: 'SN001', groupId: 'g1' } }
    );
  });

  test('navigates to group on Enter keypress', async () => {
    mockFetchResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });

    const row = screen.getByText('Serial 001').closest('.group-row');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(
      '/project/proj-1/group/g1',
      expect.any(Object)
    );
  });

  test('shows ungrouped row when ungroupedCount > 0', async () => {
    mockFetchResponses({ ungroupedCount: 4 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    });
    expect(screen.getByText('4 images')).toBeInTheDocument();
  });

  test('navigates to ungrouped page on click', async () => {
    mockFetchResponses({ ungroupedCount: 2 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Ungrouped').closest('.group-row'));
    expect(mockNavigate).toHaveBeenCalledWith('/project/proj-1/ungrouped');
  });

  test('hides ungrouped row when count is 0', async () => {
    mockFetchResponses({ ungroupedCount: 0 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });
    expect(screen.queryByText('Ungrouped')).not.toBeInTheDocument();
  });

  test('shows empty state when no groups and no ungrouped', async () => {
    mockFetchResponses({ groups: [], ungroupedCount: 0 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeInTheDocument();
    });
  });

  test('shows load more button when there are more groups', async () => {
    mockFetchResponses({ total: 250 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(`Load more (${mockGroups.length} of 250)`)).toBeInTheDocument();
    });
  });

  test('shows error on fetch failure', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/HTTP error 500/)).toBeInTheDocument();
    });
  });

  describe('delete empty groups', () => {
    const groupsWithEmpty = [
      { id: 'g1', identifier: 'SN001', display_name: 'Serial 001', image_count: 3, aggregate_review_status: null },
      { id: 'g-empty', identifier: 'EMPTY', display_name: 'Empty Group', image_count: 0, aggregate_review_status: null },
    ];

    test('shows delete button only on groups with zero images', async () => {
      mockFetchResponses({ groups: groupsWithEmpty });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Serial 001')).toBeInTheDocument();
      });

      // The empty group row should have a Delete button
      const buttons = screen.getAllByRole('button', { name: 'Delete' });
      expect(buttons).toHaveLength(1);
      // The non-empty group should not
      const nonEmptyRow = screen.getByText('Serial 001').closest('.group-row');
      expect(nonEmptyRow.querySelector('.btn-danger')).toBeNull();
    });

    test('deletes empty group after confirmation', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      mockFetchResponses({ groups: groupsWithEmpty });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Empty Group')).toBeInTheDocument();
      });

      // Mock the DELETE call
      global.fetch.mockImplementation((url, opts) => {
        if (opts?.method === 'DELETE') {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(window.confirm).toHaveBeenCalledWith('Delete empty group "Empty Group"?');

      await waitFor(() => {
        expect(screen.queryByText('Empty Group')).not.toBeInTheDocument();
      });

      // The non-empty group should still be there
      expect(screen.getByText('Serial 001')).toBeInTheDocument();
    });

    test('does not delete when confirmation is cancelled', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      mockFetchResponses({ groups: groupsWithEmpty });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Empty Group')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      // Group should still be present
      expect(screen.getByText('Empty Group')).toBeInTheDocument();
    });

    test('shows error when delete request fails', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      mockFetchResponses({ groups: groupsWithEmpty });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Empty Group')).toBeInTheDocument();
      });

      global.fetch.mockImplementation((url, opts) => {
        if (opts?.method === 'DELETE') {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(screen.getByText(/Failed to delete group/)).toBeInTheDocument();
      });
    });
  });
});
