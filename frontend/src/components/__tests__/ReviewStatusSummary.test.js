import { render, screen, waitFor } from '@testing-library/react';
import ReviewStatusSummary from '../ReviewStatusSummary';

describe('ReviewStatusSummary', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test('fetches and renders review stats', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_images: 10,
        reviewed: 7,
        unreviewed: 3,
        passed: 5,
        reject_pending: 1,
        reject_confirmed: 1,
      }),
    });

    render(<ReviewStatusSummary projectId="123" />);

    await waitFor(() => {
      expect(screen.getByText('Review Progress')).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/123/review-status');
    expect(screen.getByText('7/10 reviewed (70%)')).toBeInTheDocument();
    expect(screen.getByText('Unreviewed:')).toBeInTheDocument();
    expect(screen.getByText('Pass:')).toBeInTheDocument();
    expect(screen.getByText('Reject (Pending):')).toBeInTheDocument();
    expect(screen.getByText('Rejected:')).toBeInTheDocument();
  });

  test('omits zero-count chips', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_images: 2,
        reviewed: 1,
        unreviewed: 1,
        passed: 0,
        reject_pending: 0,
        reject_confirmed: 0,
      }),
    });

    render(<ReviewStatusSummary projectId="42" />);

    await waitFor(() => {
      expect(screen.getByText('1/2 reviewed (50%)')).toBeInTheDocument();
    });

    expect(screen.queryByText('Pass:')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject (Pending):')).not.toBeInTheDocument();
    expect(screen.queryByText('Rejected:')).not.toBeInTheDocument();
  });
});
