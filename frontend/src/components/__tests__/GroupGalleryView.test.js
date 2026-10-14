import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import GroupGalleryView from '../GroupGalleryView';

// The complete frontend suite runs several CPU-heavy rendering tests in parallel.
// Give this integration-style suite enough headroom for React to flush its async
// fetch updates when a shared CI worker is under load.
jest.setTimeout(15000);

let mockParams = { id: 'proj-1', groupId: 'grp-1' };
const mockNavigate = jest.fn();
const mockLocation = { state: { groupIdentifier: 'SN001' } };

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => mockParams,
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

jest.mock('../ImageGallery', () => {
  return function MockImageGallery({ images, loading }) {
    if (loading) return <div data-testid="gallery-loading">Loading...</div>;
    return (
      <div data-testid="image-gallery">
        {images.map(img => (
          <div key={img.id} data-testid="gallery-image">{img.filename}</div>
        ))}
      </div>
    );
  };
});

const mockImages = [
  { id: 'img-1', filename: 'a.png', deleted_at: null },
  { id: 'img-2', filename: 'b.png', deleted_at: null },
];

const mockProject = { id: 'proj-1', name: 'Test Project' };

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function setupFetch({ images = mockImages, project = mockProject } = {}) {
  global.fetch = jest.fn((url) => {
    if (url.startsWith('/api/projects/proj-1/images')) {
      return Promise.resolve({ ok: true, json: async () => images });
    }
    if (url === '/api/projects/proj-1') {
      return Promise.resolve({ ok: true, json: async () => project });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('GroupGalleryView', () => {
  beforeEach(() => {
    mockParams = { id: 'proj-1', groupId: 'grp-1' };
    mockLocation.state = { groupIdentifier: 'SN001' };
    mockNavigate.mockClear();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('renders header with group identifier', async () => {
    setupFetch();
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    expect(screen.getAllByText('SN001').length).toBeGreaterThan(0);
    expect(screen.getByText('Back to Groups')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('image-gallery')).toBeInTheDocument();
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  test('fetches and renders images for the group', async () => {
    setupFetch();
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(screen.getByTestId('image-gallery')).toBeInTheDocument();
    });
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
  });

  test('passes group_id filter when fetching images', async () => {
    setupFetch();
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('group_id=grp-1'),
        expect.any(Object)
      );
    });
  });

  test('passes ungrouped=true when no groupId in params', async () => {
    mockParams = { id: 'proj-1' };
    setupFetch();
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('ungrouped=true'),
        expect.any(Object)
      );
    });
  });

  test('shows "Ungrouped" as title when no groupId', async () => {
    mockParams = { id: 'proj-1' };
    mockLocation.state = null;
    setupFetch();
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    expect(screen.getAllByText('Ungrouped').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByTestId('image-gallery')).toBeInTheDocument();
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  test('filters out deleted images', async () => {
    const imagesWithDeleted = [
      { id: 'img-1', filename: 'live.png', deleted_at: null },
      { id: 'img-2', filename: 'dead.png', deleted_at: '2026-01-01T00:00:00Z' },
    ];
    setupFetch({ images: imagesWithDeleted });
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(screen.getByText('live.png')).toBeInTheDocument();
    });
    expect(screen.queryByText('dead.png')).not.toBeInTheDocument();
  });

  test('shows project name in breadcrumb after loading', async () => {
    setupFetch();
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
  });

  test('uses fetched display_name when location state is missing', async () => {
    mockLocation.state = null;
    const mockGroup = { id: 'grp-1', identifier: 'GRP-001', display_name: 'Turbine Blade A' };
    global.fetch = jest.fn((url) => {
      if (url === '/api/groups/grp-1') {
        return Promise.resolve({ ok: true, json: async () => mockGroup });
      }
      if (url.startsWith('/api/projects/proj-1/images')) {
        return Promise.resolve({ ok: true, json: async () => mockImages });
      }
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => mockProject });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(screen.getAllByText('Turbine Blade A').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('grp-1')).not.toBeInTheDocument();
  });

  test('shows error on fetch failure', async () => {
    global.fetch = jest.fn((url) => {
      if (url.startsWith('/api/projects/proj-1/images')) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({ ok: true, json: async () => mockProject });
    });
    render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load images/)).toBeInTheDocument();
    });
  });

  test('ignores stale image responses after route changes', async () => {
    const firstImages = createDeferred();
    const secondImages = createDeferred();
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Project One' }) });
      }
      if (url === '/api/projects/proj-2') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-2', name: 'Project Two' }) });
      }
      if (url === '/api/groups/grp-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'grp-1', display_name: 'Group One' }) });
      }
      if (url === '/api/groups/grp-2') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'grp-2', display_name: 'Group Two' }) });
      }
      if (url.startsWith('/api/projects/proj-1/images')) {
        return firstImages.promise;
      }
      if (url.startsWith('/api/projects/proj-2/images')) {
        return secondImages.promise;
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { rerender } = render(<BrowserRouter><GroupGalleryView /></BrowserRouter>);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/projects/proj-1/images'), expect.any(Object)));

    mockParams = { id: 'proj-2', groupId: 'grp-2' };
    mockLocation.state = { groupIdentifier: 'SN002' };
    rerender(<BrowserRouter><GroupGalleryView /></BrowserRouter>);

    await act(async () => {
      secondImages.resolve({ ok: true, json: async () => [{ id: 'img-2', filename: 'fresh.png', deleted_at: null }] });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('fresh.png')).toBeInTheDocument());

    await act(async () => {
      firstImages.resolve({ ok: true, json: async () => [{ id: 'img-1', filename: 'stale.png', deleted_at: null }] });
      await Promise.resolve();
    });

    expect(screen.queryByText('stale.png')).not.toBeInTheDocument();
  });
});
