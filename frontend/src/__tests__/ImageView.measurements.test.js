import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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

jest.mock('../components/CalibrationManager', () => {
  return function MockCalibrationManager() {
    return <div>CalibrationManager</div>;
  };
});

jest.mock('../components/MeasurementList', () => {
  return function MockMeasurementList({
    onDeleteMeasurement,
    onRenameMeasurement,
    onToggleVisibility,
    measurements,
    visibleMeasurementIds
  }) {
    return (
      <div data-testid="measurement-list">
        MeasurementList - {measurements?.length || 0} measurements
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

describe('ImageView - Measurement Handlers', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.clearAllMocks();
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
          measurements: [
            { id: 'measurement-1', name: 'Test Measurement' }
          ]
        }
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });
    });

    test('loads measurements from metadata_ field for backward compatibility', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata_: {
          measurements: [
            { id: 'measurement-1', name: 'Test Measurement' }
          ]
        }
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

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

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockImage,
            metadata: {
              measurements: [{ id: 'measurement-2', name: 'Measurement 2' }]
            }
          })
        });

      const { getByText } = render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getByText(/2 measurements/)).toBeInTheDocument();
      });

      const deleteButton = getByText('Delete First');

      await act(async () => {
        deleteButton.click();
      });

      await waitFor(() => {
        const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        const [url, options] = lastCall;

        expect(url).toContain('/metadata');
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
          measurements: [
            { id: 'test-measurement-id', name: 'Old Name' }
          ]
        }
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ...mockImage,
            metadata: {
              measurements: [{ id: 'test-measurement-id', name: 'New Name' }]
            }
          })
        });

      const { getByText } = render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getByText(/1 measurements/)).toBeInTheDocument();
      });

      const renameButton = getByText('Rename First');

      await act(async () => {
        renameButton.click();
      });

      await waitFor(() => {
        const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        const [url, options] = lastCall;

        expect(url).toContain('/metadata');
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
          measurements: [
            { id: 'test-measurement-id', name: 'Measurement 1' }
          ]
        }
      };

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          text: async () => 'Validation error'
        });

      const { getByText } = render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getByText(/1 measurements/)).toBeInTheDocument();
      });

      const deleteButton = getByText('Delete First');

      await act(async () => {
        deleteButton.click();
      });

      // Should still show 1 measurement (reverted)
      await waitFor(() => {
        expect(getByText(/1 measurements/)).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    test('reverts state when rename fails', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [
            { id: 'test-measurement-id', name: 'Original Name' }
          ]
        }
      };

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Server error'
        });

      const { getByText } = render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getByText(/1 measurements/)).toBeInTheDocument();
      });

      const renameButton = getByText('Rename First');

      await act(async () => {
        renameButton.click();
      });

      // Verify the API was called
      await waitFor(() => {
        const metadataCalls = fetchMock.mock.calls.filter(call => call[0].includes('/metadata'));
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

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      const { getByText, getByTestId } = render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      // Wait for initial render with both measurements visible
      await waitFor(() => {
        expect(getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      });

      // Toggle visibility of first measurement
      const toggleButton = getByText('Toggle Visibility');
      await act(async () => {
        toggleButton.click();
      });

      // Now only 1 should be visible
      await waitFor(() => {
        expect(getByTestId('visible-count')).toHaveTextContent('Visible: 1');
      });

      // Toggle again to make it visible
      await act(async () => {
        toggleButton.click();
      });

      // Back to 2 visible
      await waitFor(() => {
        expect(getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      });
    });
  });


  describe('Initial state when no measurements exist', () => {
    test('does not render MeasurementList when no measurements', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {}
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('test.jpg')).toBeInTheDocument();
      });

      // MeasurementList should not be rendered when there are no measurements
      expect(screen.queryByTestId('measurement-list')).not.toBeInTheDocument();
    });

    test('handles null metadata gracefully', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: null
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'test@example.com' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockImage
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('test.jpg')).toBeInTheDocument();
      });

      // Should render without crashing
      expect(screen.queryByTestId('measurement-list')).not.toBeInTheDocument();
    });
  });
});
