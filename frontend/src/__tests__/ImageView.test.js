import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

jest.mock('../components/ImageGroupPanel', () => {
  return function MockImageGroupPanel() {
    return <div data-testid="image-group-panel">ImageGroupPanel</div>;
  };
});

// Mock components that make their own fetch calls
jest.mock('../components/ReviewPanel', () => {
  return function MockReviewPanel() { return <div data-testid="review-panel">ReviewPanel</div>; };
});
jest.mock('../components/UserAnnotationPanel', () => {
  return function MockUserAnnotationPanel() { return <div>UserAnnotationPanel</div>; };
});
jest.mock('../components/AnnotationToolbar', () => {
  return function MockAnnotationToolbar() { return <div>AnnotationToolbar</div>; };
});
jest.mock('../components/AnnotationReviewControls', () => {
  return function MockAnnotationReviewControls() { return <div>AnnotationReviewControls</div>; };
});
jest.mock('../components/KeyboardShortcutsHelp', () => {
  return function MockKeyboardShortcutsHelp() { return null; };
});
jest.mock('../components/MLAnalysisPanel', () => {
  return function MockMLAnalysisPanel() { return <div>MLAnalysisPanel</div>; };
});
jest.mock('../components/MLDebugOutputs', () => {
  return function MockMLDebugOutputs() { return <div>MLDebugOutputs</div>; };
});
jest.mock('../components/CalibrationManager', () => {
  return function MockCalibrationManager() { return <div>CalibrationManager</div>; };
});

// Mock hooks that make their own fetch calls
jest.mock('../hooks/useAnnotations', () => {
  return () => ({
    annotationMode: false, setAnnotationMode: jest.fn(),
    userAnnotations: [], selectedAnnotationId: null,
    setSelectedAnnotationId: jest.fn(), showUserAnnotations: true,
    setShowUserAnnotations: jest.fn(), bboxClasses: [],
    activeClassId: null, setActiveClassId: jest.fn(),
    loadBBoxClasses: jest.fn(), loadUserAnnotations: jest.fn(),
    handleAnnotationCreated: jest.fn(), handleAnnotationUpdate: jest.fn(),
  });
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

const mockImageA = {
  id: 'img-a',
  filename: 'alpha.jpg',
  size_bytes: 500000,
  created_at: '2023-01-01T00:00:00Z',
  deleted_at: null,
  storage_deleted: false,
};

const mockImageB = {
  id: 'img-b',
  filename: 'bravo.png',
  size_bytes: 2000000,
  created_at: '2023-01-02T00:00:00Z',
  deleted_at: null,
  storage_deleted: false,
  content_type: 'image/png',
};

const mockImageC = {
  id: 'img-c',
  filename: 'charlie.jpg',
  size_bytes: 1000000,
  created_at: '2023-01-03T00:00:00Z',
  deleted_at: null,
  storage_deleted: false,
};

const mockNavImages = [mockImageA, mockImageB, mockImageC];

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
    localStorage.clear();
    // Provide a safe default for any unexpected fetches
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    mockNavigate.mockClear();
    console.error = jest.fn(); // Mock console.error to avoid noise in tests
    // Reset dynamic router params to defaults before each test
    mockParams = { imageId: 'test-image-id' };
    mockSearchParams = new URLSearchParams('project=test-project-id');
  });

  afterEach(() => {
    // Only clear call history; keep the safe default so stale async ops don't crash
    fetch.mockClear();
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
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: false, status: 404 });
        if (url.includes('/images?include_deleted=true')) return Promise.resolve({ ok: false, status: 500 });
        if (url.includes('/classes')) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => [] });
      });

      renderImageView();

      await waitFor(() => {
        expect(screen.getByText('Failed to load image. Please try again later.')).toBeInTheDocument();
      });
    });
  });

  describe('Project Images Loading', () => {
    test('loads project images with include_deleted=true', async () => {
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: true, json: async () => mockRegularImage });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => mockProjectImages });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => [] });
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
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: true, json: async () => mockRegularImage });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => mockProjectImages });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => [] });
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
      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${mockParams.imageId}`) return Promise.resolve({ ok: true, json: async () => mockRegularImage });
        if (url === `/api/projects/test-project-id/images?include_deleted=true`) return Promise.resolve({ ok: true, json: async () => mockProjectImages });
        if (url === `/api/projects/test-project-id/classes`) return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => [] });
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

  describe('Gallery State Navigation', () => {
    // Navigation uses a 300ms setTimeout for transitions
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    const setupNavFetch = ({ currentImage = mockImageB, projectImages = mockNavImages, reviewStatuses = null } = {}) => {
      mockParams = { imageId: currentImage.id };

      fetch.mockImplementation((url) => {
        if (url === '/api/users/me') return Promise.resolve({ ok: false, status: 401 });
        if (url === `/api/images/${currentImage.id}`) return Promise.resolve({ ok: true, json: async () => currentImage });
        if (url.startsWith('/api/projects/test-project-id/images')) return Promise.resolve({ ok: true, json: async () => projectImages });
        if (url.startsWith('/api/projects/test-project-id/classes')) return Promise.resolve({ ok: true, json: async () => [] });
        if (url.startsWith('/api/projects/test-project-id/image-review-statuses')) {
          if (reviewStatuses) {
            return Promise.resolve({ ok: true, json: async () => reviewStatuses });
          }
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });
    };

    // Wait for the component to finish loading and rendering the image
    const waitForImageLoad = async (filename) => {
      await waitFor(() => {
        expect(screen.getByTestId('image-display')).toHaveTextContent(filename);
      });
    };

    // Fire an arrow key and advance the 300ms transition timer
    const pressArrowAndAdvance = (direction) => {
      fireEvent.keyDown(document, { key: direction });
      act(() => {
        jest.advanceTimersByTime(300);
      });
    };

    test('ArrowRight navigates to next image in name-sorted order', async () => {
      // Sort by name: [alpha, bravo, charlie]. img-b at index 1. Next = charlie (img-c).
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'name', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-c?')
      );
    });

    test('ArrowLeft navigates to previous image in name-sorted order', async () => {
      // Sort by name: [alpha, bravo, charlie]. img-b at index 1. Prev = alpha (img-a).
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'name', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowLeft');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-a?')
      );
    });

    test('ArrowRight navigates to next image in date-sorted order (default)', async () => {
      // Default date sort (descending): [charlie(Jan3), bravo(Jan2), alpha(Jan1)].
      // img-b at index 1. Next = alpha (img-a).
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-a?')
      );
    });

    test('ArrowLeft navigates to previous image in date-sorted order (default)', async () => {
      // Default date sort (descending): [charlie(Jan3), bravo(Jan2), alpha(Jan1)].
      // img-b at index 1. Prev = charlie (img-c).
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowLeft');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-c?')
      );
    });

    test('ArrowRight navigates correctly in size-sorted order', async () => {
      // Sort by size (descending): [bravo(2M), charlie(1M), alpha(500K)].
      // img-b at index 0. Next = charlie (img-c).
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'size', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-c?')
      );
    });

    test('ArrowLeft does not navigate when at start of size-sorted list', async () => {
      // Sort by size (descending): [bravo(2M), charlie(1M), alpha(500K)].
      // img-b at index 0. No previous image.
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'size', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowLeft');

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('search filter restricts navigation to matching images only', async () => {
      // Search for "bravo" -> only [img-b]. img-b at index 0.
      // Neither ArrowRight nor ArrowLeft should navigate.
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'date', searchField: 'filename', searchValue: 'bravo', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowRight');
      expect(mockNavigate).not.toHaveBeenCalled();

      pressArrowAndAdvance('ArrowLeft');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('content_type search filter restricts navigation correctly', async () => {
      // Search content_type for "png" -> only bravo.png matches.
      // No prev or next available.
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'date', searchField: 'content_type', searchValue: 'png', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowRight');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('review filter restricts navigation to images with matching status', async () => {
      // Review filter "pass". Statuses: img-a=pass, img-b=unreviewed, img-c=pass.
      // Filtered+date-sorted: [img-c(Jan3), img-a(Jan1)]. img-a is current, at index 1.
      // ArrowLeft should go to img-c.
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'date', searchField: 'filename', searchValue: '', reviewFilter: 'pass',
      }));
      setupNavFetch({
        currentImage: mockImageA,
        reviewStatuses: { 'img-a': 'pass', 'img-b': 'unreviewed', 'img-c': 'pass' },
      });
      renderImageView();
      await waitForImageLoad('alpha.jpg');

      pressArrowAndAdvance('ArrowLeft');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-c?')
      );
    });

    test('review filter prevents navigation to non-matching images', async () => {
      // Review filter "pass". Current=img-a at index 1 in [img-c, img-a].
      // ArrowRight should not navigate (img-a is at the end).
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'date', searchField: 'filename', searchValue: '', reviewFilter: 'pass',
      }));
      setupNavFetch({
        currentImage: mockImageA,
        reviewStatuses: { 'img-a': 'pass', 'img-b': 'unreviewed', 'img-c': 'pass' },
      });
      renderImageView();
      await waitForImageLoad('alpha.jpg');

      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('falls back to default date sort when localStorage contains invalid JSON', async () => {
      localStorage.setItem('gallery_state_test-project-id', 'not-valid-json');
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      // Fallback date sort: [charlie, bravo, alpha]. img-b at index 1. Next = alpha.
      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-a?')
      );
    });

    test('uses group-scoped gallery state key when viewing grouped image', async () => {
      const mockImageBGrouped = { ...mockImageB, group_id: 'grp-1' };

      // Save sort by name under the group key
      localStorage.setItem('gallery_state_test-project-id_group_grp-1', JSON.stringify({
        sortBy: 'name', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));

      setupNavFetch({ currentImage: mockImageBGrouped });
      renderImageView();
      await waitForImageLoad('bravo.png');

      // Name sort: [alpha, bravo, charlie]. Next = charlie.
      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-c?')
      );
      // Verify the grouped images endpoint was called
      const imageCalls = fetch.mock.calls.filter(c => c[0].includes('group_id=grp-1'));
      expect(imageCalls.length).toBeGreaterThan(0);
    });

    test('reads galleryKey from URL param to select correct saved state', async () => {
      // Save name-sort under ungrouped key, size-sort under project key
      localStorage.setItem('gallery_state_test-project-id_ungrouped', JSON.stringify({
        sortBy: 'name', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'size', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));

      mockSearchParams = new URLSearchParams(
        'project=test-project-id&galleryKey=test-project-id_ungrouped'
      );
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      // Name sort (from ungrouped key): [alpha, bravo, charlie]. Next = charlie.
      // If size sort were used instead: [bravo, charlie, alpha]. Next = charlie too -- but prev differs.
      // Name sort prev = alpha. Size sort prev = nothing (bravo is first).
      pressArrowAndAdvance('ArrowLeft');

      // alpha confirms name-sort from the ungrouped key was used
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-a?')
      );

      // Verify the ungrouped endpoint was called
      const imageCalls = fetch.mock.calls.filter(c => c[0].includes('ungrouped=true'));
      expect(imageCalls.length).toBeGreaterThan(0);
    });

    test('falls back to project key when galleryKey is not in URL', async () => {
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'name', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      mockSearchParams = new URLSearchParams('project=test-project-id');
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      // Name sort: [alpha, bravo, charlie]. Next = charlie.
      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/view/img-c?')
      );
    });

    test('preserves galleryKey in navigation URLs', async () => {
      mockSearchParams = new URLSearchParams(
        'project=test-project-id&galleryKey=test-project-id_ungrouped'
      );
      localStorage.setItem('gallery_state_test-project-id_ungrouped', JSON.stringify({
        sortBy: 'date', searchField: 'filename', searchValue: '', reviewFilter: 'all',
      }));
      setupNavFetch();
      renderImageView();
      await waitForImageLoad('bravo.png');

      pressArrowAndAdvance('ArrowRight');

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('galleryKey=test-project-id_ungrouped')
      );
    });

    test('silently handles review status API failure during navigation filter', async () => {
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        sortBy: 'date', searchField: 'filename', searchValue: '', reviewFilter: 'pass',
      }));
      // reviewStatuses defaults to null in setupNavFetch, causing a 500 response.
      // When statuses are unavailable, the code bypasses the review filter (falls back
      // to 'all') so navigation still works with the full image list.
      setupNavFetch();
      renderImageView();

      // The image itself should still render (loading is independent of navigation)
      await waitForImageLoad('bravo.png');

      // Date sort (newest first): charlie, bravo, alpha. Bravo is at index 1.
      // Navigation should still work since the review filter is bypassed,
      // and the project query param should be preserved in the URL.
      pressArrowAndAdvance('ArrowRight');
      expect(mockNavigate).toHaveBeenCalledWith(
        '/view/img-a?project=test-project-id'
      );

      mockNavigate.mockClear();
      pressArrowAndAdvance('ArrowLeft');
      expect(mockNavigate).toHaveBeenCalledWith(
        '/view/img-c?project=test-project-id'
      );
    });
  });
});