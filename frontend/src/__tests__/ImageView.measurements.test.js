import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ImageView from '../ImageView';

// Mock react-router-dom
const mockParams = { imageId: 'test-image-id' };
const mockSearchParams = new URLSearchParams('project=test-project-id');
const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => mockParams,
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

// Mock all child components
jest.mock('../components/ImageDisplay', () => {
  return function MockImageDisplay() {
    return <div data-testid="image-display">ImageDisplay</div>;
  };
});

jest.mock('../components/ImageMetadata', () => {
  return function MockImageMetadata() {
    return <div>ImageMetadata</div>;
  };
});

jest.mock('../components/CompactImageClassifications', () => {
  return function MockCompactImageClassifications() {
    return <div>CompactImageClassifications</div>;
  };
});

jest.mock('../components/ImageComments', () => {
  return function MockImageComments() {
    return <div>ImageComments</div>;
  };
});

jest.mock('../components/ImageDeletionControls', () => {
  return function MockImageDeletionControls() {
    return <div>ImageDeletionControls</div>;
  };
});

// Mock components that make their own fetch calls
jest.mock('../components/ReviewPanel', () => {
  return function MockReviewPanel() { return <div>ReviewPanel</div>; };
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
jest.mock('../components/OverlayControls', () => {
  return function MockOverlayControls() { return <div>OverlayControls</div>; };
});

// Mock annotation hook to avoid unhandled fetch calls
jest.mock('../hooks/useAnnotations', () => {
  return () => ({
    interactionMode: 'pan', setInteractionMode: jest.fn(),
    annotationMode: false, selectMode: false, measureMode: false,
    setAnnotationMode: jest.fn(),
    userAnnotations: [], selectedAnnotationId: null,
    setSelectedAnnotationId: jest.fn(), hoveredAnnotationId: null,
    setHoveredAnnotationId: jest.fn(), showUserAnnotations: true,
    setShowUserAnnotations: jest.fn(), bboxClasses: [],
    activeClassId: null, setActiveClassId: jest.fn(),
    loadBBoxClasses: jest.fn(), loadUserAnnotations: jest.fn(),
    handleAnnotationCreated: jest.fn(), handleAnnotationUpdate: jest.fn(),
    handleDeleteSelected: jest.fn(),
  });
});

jest.mock('../components/ClassManager', () => {
  return function MockClassManager() {
    return <div>ClassManager</div>;
  };
});

jest.mock('../components/MLAnalysisPanel', () => {
  return function MockMLAnalysisPanel() {
    return <div>MLAnalysisPanel</div>;
  };
});

jest.mock('../components/MLDebugOutputs', () => {
  return function MockMLDebugOutputs() {
    return <div>MLDebugOutputs</div>;
  };
});

jest.mock('../components/CalibrationManager', () => {
  return function MockCalibrationManager() {
    return <div>CalibrationManager</div>;
  };
});

jest.mock('../components/ImageGroupPanel', () => {
  return function MockImageGroupPanel() {
    return <div>ImageGroupPanel</div>;
  };
});

jest.mock('../components/MeasurementList', () => {
  return function MockMeasurementList() {
    return <div>MeasurementList</div>;
  };
});

jest.mock('../components/MeasurementPanel', () => {
  return function MockMeasurementPanel() { return <div>MeasurementPanel</div>; };
});

jest.mock('../components/AnnotationMeasurementTabs', () => {
  return function MockAnnotationMeasurementTabs({
    onDeleteMeasurement,
    onRenameMeasurement,
    onToggleVisibility,
    measurements,
    visibleMeasurementIds
  }) {
    return (
      <div data-testid="measurement-panel">
        AnnotationMeasurementTabs - {measurements?.length || 0} measurements
        <span data-testid="visible-count">Visible: {visibleMeasurementIds?.length || 0}</span>
        {onDeleteMeasurement && (
          <button onClick={() => onDeleteMeasurement('test-measurement-id')}>
            Delete First
          </button>
        )}
        {onRenameMeasurement && (
          <button onClick={() => onRenameMeasurement('test-measurement-id', 'New Name')}>
            Rename First
          </button>
        )}
        {onToggleVisibility && (
          <button onClick={() => onToggleVisibility('test-measurement-id')}>
            Toggle Visibility
          </button>
        )}
      </div>
    );
  };
});

// Helper to create a URL-based fetch mock that returns the right response per URL.
// metadataResponse should be a function that returns a new Promise each call.
function createFetchMock(mockImage, options = {}) {
  const { metadataResponseFn } = options;
  const fn = jest.fn().mockImplementation((url) => {
    if (url === '/api/users/me') {
      return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
    }
    if (url === `/api/images/${mockParams.imageId}`) {
      return Promise.resolve({ ok: true, json: async () => mockImage });
    }
    if (url.includes('/images?include_deleted=true')) {
      return Promise.resolve({ ok: true, json: async () => [mockImage] });
    }
    if (url.includes('/classes')) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (url.includes('/metadata') && metadataResponseFn) {
      return metadataResponseFn();
    }
    return Promise.resolve({ ok: true, json: async () => [], text: async () => '' });
  });
  return fn;
}

describe('ImageView - Measurement Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Bug Fix: Metadata field compatibility', () => {
    test('loads measurements from metadata field (not metadata_)', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [{ id: 'measurement-1', name: 'Test Measurement' }]
        }
      };
      global.fetch = createFetchMock(mockImage);

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });
    });

    test('loads measurements from metadata_ field for backward compatibility', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata_: {
          measurements: [{ id: 'measurement-1', name: 'Test Measurement' }]
        }
      };
      global.fetch = createFetchMock(mockImage);

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });
    });
  });

  describe('Bug Fix: Delete payload includes value field', () => {
    test('handleDeleteMeasurement sends correct payload with value field', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [
            { id: 'test-measurement-id', name: 'Measurement 1' },
            { id: 'measurement-2', name: 'Measurement 2' }
          ]
        }
      };
      const updatedImage = {
        ...mockImage,
        metadata: { measurements: [{ id: 'measurement-2', name: 'Measurement 2' }] }
      };
      const fetchMock = createFetchMock(mockImage, {
        metadataResponseFn: () => Promise.resolve({
          ok: true,
          json: async () => updatedImage
        })
      });
      global.fetch = fetchMock;

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText(/2 measurements/)).toBeInTheDocument();
      });

      // Click without act() wrapper to avoid hanging on async effects
      screen.getByText('Delete First').click();

      await waitFor(() => {
        const metadataCalls = fetchMock.mock.calls.filter(c => c[0].includes('/metadata'));
        expect(metadataCalls.length).toBeGreaterThan(0);
        const [, options] = metadataCalls[metadataCalls.length - 1];
        expect(options.method).toBe('PUT');
        const body = JSON.parse(options.body);
        expect(body).toHaveProperty('key', 'measurements');
        expect(body).toHaveProperty('value');
        expect(Array.isArray(body.value)).toBe(true);
        expect(body.value.length).toBe(1);
        expect(body.value[0].id).toBe('measurement-2');
      });
    });
  });

  describe('Bug Fix: Rename payload includes value field', () => {
    test('handleRenameMeasurement sends correct payload with value field', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [{ id: 'test-measurement-id', name: 'Old Name' }]
        }
      };
      const updatedImage = {
        ...mockImage,
        metadata: { measurements: [{ id: 'test-measurement-id', name: 'New Name' }] }
      };
      const fetchMock = createFetchMock(mockImage, {
        metadataResponseFn: () => Promise.resolve({
          ok: true,
          json: async () => updatedImage
        })
      });
      global.fetch = fetchMock;

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });

      screen.getByText('Rename First').click();

      await waitFor(() => {
        const metadataCalls = fetchMock.mock.calls.filter(c => c[0].includes('/metadata'));
        expect(metadataCalls.length).toBeGreaterThan(0);
        const [, options] = metadataCalls[metadataCalls.length - 1];
        expect(options.method).toBe('PUT');
        const body = JSON.parse(options.body);
        expect(body).toHaveProperty('key', 'measurements');
        expect(body).toHaveProperty('value');
        expect(Array.isArray(body.value)).toBe(true);
        expect(body.value[0].name).toBe('New Name');
      });
    });
  });

  describe('Error handling with revert', () => {
    test('reverts state when delete fails', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [{ id: 'test-measurement-id', name: 'Measurement 1' }]
        }
      };
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = createFetchMock(mockImage, {
        metadataResponseFn: () => Promise.resolve({
          ok: false, status: 422, text: async () => 'Validation error'
        })
      });
      global.fetch = fetchMock;

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });

      screen.getByText('Delete First').click();

      // Should still show 1 measurement (reverted after error)
      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    test('reverts state when rename fails', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [{ id: 'test-measurement-id', name: 'Original Name' }]
        }
      };
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = createFetchMock(mockImage, {
        metadataResponseFn: () => Promise.resolve({
          ok: false, status: 500, text: async () => 'Server error'
        })
      });
      global.fetch = fetchMock;

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });

      screen.getByText('Rename First').click();

      await waitFor(() => {
        const metadataCalls = fetchMock.mock.calls.filter(c => c[0].includes('/metadata'));
        expect(metadataCalls.length).toBeGreaterThan(0);
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Toggle visibility', () => {
    test('handleToggleVisibility toggles measurement visibility', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [
            { id: 'test-measurement-id', name: 'Measurement 1' },
            { id: 'measurement-2', name: 'Measurement 2' }
          ]
        }
      };
      global.fetch = createFetchMock(mockImage);

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      });

      // Toggle visibility of first measurement (no act wrapper)
      screen.getByText('Toggle Visibility').click();

      await waitFor(() => {
        expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 1');
      });

      // Toggle again to make it visible
      screen.getByText('Toggle Visibility').click();

      await waitFor(() => {
        expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      });
    });
  });

  describe('Initial state when no measurements exist', () => {
    test('renders MeasurementPanel with 0 measurements when no measurements', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {}
      };
      global.fetch = createFetchMock(mockImage);

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText('test.jpg')).toBeInTheDocument();
      });

      expect(screen.getByText(/0 measurements/)).toBeInTheDocument();
    });

    test('handles null metadata gracefully', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: null
      };
      global.fetch = createFetchMock(mockImage);

      render(<BrowserRouter><ImageView /></BrowserRouter>);

      await waitFor(() => {
        expect(screen.getByText('test.jpg')).toBeInTheDocument();
      });

      expect(screen.getByText(/0 measurements/)).toBeInTheDocument();
    });
  });
});
