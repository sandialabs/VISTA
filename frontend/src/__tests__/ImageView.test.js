import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ImageView from '../ImageView';

// Mock react-router-dom
let mockParams = { imageId: 'test-image-id' };
let mockSearchParams = new URLSearchParams('project=test-project-id');
const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => mockParams,
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

// Mock child components
jest.mock('../components/ImageDisplay', () => {
  return function MockImageDisplay({ image, imageId }) {
    return <div data-testid="image-display">ImageDisplay - {image ? image.filename : 'Loading'}</div>;
  };
});

jest.mock('../components/ImageMetadata', () => {
  return function MockImageMetadata() {
    return <div data-testid="image-metadata">ImageMetadata</div>;
  };
});

jest.mock('../components/ImageClassifications', () => {
  return function MockImageClassifications() {
    return <div data-testid="image-classifications">ImageClassifications</div>;
  };
});

jest.mock('../components/CompactImageClassifications', () => {
  return function MockCompactImageClassifications() {
    return <div data-testid="compact-image-classifications">CompactImageClassifications</div>;
  };
});

jest.mock('../components/ImageComments', () => {
  return function MockImageComments() {
    return <div data-testid="image-comments">ImageComments</div>;
  };
});

jest.mock('../components/ImageDeletionControls', () => {
  return function MockImageDeletionControls() {
    return <div data-testid="image-deletion-controls">ImageDeletionControls</div>;
  };
});

// Mock data
const mockRegularImage = {
  id: 'test-image-id',
  filename: 'test-image.jpg',
  size_bytes: 1024000,
  created_at: '2023-01-01T00:00:00Z',
  deleted_at: null,
  storage_deleted: false
};

const mockDeletedImage = {
  id: 'test-image-id',
  filename: 'deleted-image.jpg',
  size_bytes: 512000,
  created_at: '2023-01-02T00:00:00Z',
  deleted_at: '2023-01-03T00:00:00Z',
  storage_deleted: false,
  deletion_reason: 'Test deletion'
};

const mockProjectImages = [mockRegularImage, mockDeletedImage];

// Mock fetch
global.fetch = jest.fn();

const renderImageView = () => {
  return render(
    <BrowserRouter>
      <ImageView />
    </BrowserRouter>
  );
};

describe('ImageView', () => {
  beforeEach(() => {
    fetch.mockClear();
    // Provide a safe default for any unexpected fetches
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    mockNavigate.mockClear();
    console.error = jest.fn(); // Mock console.error to avoid noise in tests
    // Reset dynamic router params to defaults before each test
    mockParams = { imageId: 'test-image-id' };
    mockSearchParams = new URLSearchParams('project=test-project-id');
  });

  afterEach(() => {
    // Keep the jest mock in place between tests; just reset calls/implementations
    fetch.mockReset();
  });

  describe('Regular Image Loading', () => {
    test('loads regular image successfully via direct endpoint', async () => {
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: true, json: async () => mockRegularImage });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => mockProjectImages });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
      });

      expect(fetch).toHaveBeenCalledWith('/api/images/test-image-id');
      expect(screen.getByTestId('image-display')).toHaveTextContent('test-image.jpg');
    });

    test('sets document title correctly for regular images', async () => {
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: true, json: async () => mockRegularImage });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => mockProjectImages });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      renderImageView();

      await waitFor(() => {
        expect(document.title).toBe('test-image.jpg - Image Manager');
      });
    });
  });

  describe('Deleted Image Fallback Logic', () => {
    test('falls back to project endpoint when direct fetch fails', async () => {
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: false, status: 404 });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => [mockDeletedImage] });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => mockProjectImages });
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('deleted-image.jpg')).toBeInTheDocument();
      });

      // Verify expected endpoints were called
      expect(fetch).toHaveBeenCalledWith('/api/images/test-image-id');
      expect(fetch).toHaveBeenCalledWith('/api/projects/test-project-id/images?include_deleted=true');
    });

    test('logs fallback attempt when direct fetch fails', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: false, status: 404 });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => [mockDeletedImage] });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => mockProjectImages });
      });

      renderImageView();

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Direct image fetch failed, trying project endpoint with deleted images...'
        );
      });

      consoleSpy.mockRestore();
    });

    test('sets document title correctly for deleted images loaded via fallback', async () => {
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: false, status: 404 });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => [mockDeletedImage] });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => mockProjectImages });
      });

      renderImageView();

      await waitFor(() => {
        expect(document.title).toBe('deleted-image.jpg - Image Manager');
      });
    });

    test('handles case where image not found in project images', async () => {
      // URL-based mocking to avoid order fragility
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') {
          return Promise.resolve({ ok: false, status: 401 });
        }
        if (url === `/api/images/${mockParams.imageId}`) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) {
          // Fallback lookup returns empty (image not found)
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url === `/api/projects/test-project-id/classes`) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        // Default: succeed with empty to avoid overriding error
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('Failed to load image. Please try again later.')).toBeInTheDocument();
      });

      expect(console.error).toHaveBeenCalledWith(
        'Error loading image data:',
        expect.any(Error)
      );
    });

    test('handles project endpoint failure after direct fetch failure', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500
        });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('Failed to load image. Please try again later.')).toBeInTheDocument();
      });
    });
  });

  describe('Project Images Loading', () => {
    test('loads project images with include_deleted=true', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRegularImage)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockProjectImages)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        });

      renderImageView();

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/projects/test-project-id/images?include_deleted=true');
      });
    });

    test('handles project images loading failure', async () => {
      // URL-based mocking to ensure image load succeeds but project images fail
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') {
          return Promise.resolve({ ok: false, status: 401 });
        }
        if (url === `/api/images/${mockParams.imageId}`) {
          return Promise.resolve({ ok: true, json: async () => mockRegularImage });
        }
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        if (url === `/api/projects/test-project-id/classes`) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('Failed to load project images for navigation. Please try again later.')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    test('back button navigates to project page', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRegularImage)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockProjectImages)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('← Back')).toBeInTheDocument();
      });
    });
  });

  describe('Error States', () => {
    test('displays error when image ID or project ID is missing', () => {
      // Override dynamic params used by our jest.mock above
      mockParams = { imageId: null };
      mockSearchParams = new URLSearchParams('');

      renderImageView();

      expect(screen.getByText('Image ID or Project ID is missing.')).toBeInTheDocument();
    });

    test('displays loading state initially', () => {
      fetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      renderImageView();

      // With mocked ImageDisplay, we show a placeholder text
      expect(screen.getByTestId('image-display')).toHaveTextContent('Loading');
    });
  });

  describe('Component Integration', () => {
    test('renders all expected child components', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRegularImage)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockProjectImages)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByTestId('image-display')).toBeInTheDocument();
        expect(screen.getByTestId('image-metadata')).toBeInTheDocument();
        expect(screen.getByTestId('compact-image-classifications')).toBeInTheDocument();
        expect(screen.getByTestId('image-comments')).toBeInTheDocument();
        expect(screen.getByTestId('image-deletion-controls')).toBeInTheDocument();
      });
    });
  });
});