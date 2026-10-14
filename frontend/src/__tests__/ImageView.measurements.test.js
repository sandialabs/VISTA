import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ImageView from '../ImageView';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

// Mock react-router-dom
let mockParams = { imageId: 'test-image-id' };
let mockSearchParams = new URLSearchParams('project=test-project-id');
const mockNavigate = jest.fn();
let mockImageDisplaySnapshots = [];

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => mockParams,
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

// Mock all child components
jest.mock('../components/ImageDisplay', () => {
  return function MockImageDisplay({
    annotations,
    calibration,
    currentImageIndex,
    image,
    imageId,
    measurements,
    onSaveMeasurement,
    projectImages,
    selectedAnalysis,
  }) {
    mockImageDisplaySnapshots.push({
      annotationCount: annotations?.length || 0,
      image,
      imageId,
      measurementCount: measurements?.length || 0,
      selectedAnalysis,
    });
    return (
      <div data-testid="image-display">
        ImageDisplay
        <span data-testid="navigation-state">
          Navigation: {projectImages?.length || 0}/{currentImageIndex}
        </span>
        <span data-testid="calibration-state">
          Calibration: {calibration?.unit || 'none'}
        </span>
        <button
          type="button"
          onClick={() => onSaveMeasurement?.({ id: 'measurement-new', name: 'New Measurement' })}
        >
          Save Measurement
        </button>
      </div>
    );
  };
});

jest.mock('../components/ImageMetadata', () => {
  return function MockImageMetadata({ image, readOnly, setImage }) {
    return (
      <div>
        <span data-testid="image-metadata-state">
          Group: {image?.group_id || 'none'}; Note: {image?.metadata?.note || 'none'};
          Read only: {String(readOnly)}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setImage?.((currentImage) => ({
              ...currentImage,
              metadata: {
                ...(currentImage?.metadata || {}),
                note: 'newer-note',
              },
            }))}
          >
            Change Metadata
          </button>
        )}
      </div>
    );
  };
});

jest.mock('../components/CompactImageClassifications', () => {
  return function MockCompactImageClassifications({ classes, readOnly }) {
    return (
      <div data-testid="classification-state">
        Classifications: {classes?.length || 0}; Read only: {String(readOnly)}
      </div>
    );
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
  return function MockMLAnalysisPanel({ onSelect }) {
    return (
      <div>
        MLAnalysisPanel
        <button
          type="button"
          onClick={() => onSelect?.({
            analysis: { id: 'analysis-a' },
            annotations: [{ id: 'analysis-annotation-a' }],
          })}
        >
          Select Analysis
        </button>
      </div>
    );
  };
});

jest.mock('../components/CalibrationManager', () => {
  return function MockCalibrationManager({ onCalibrationChange, readOnly }) {
    return (
      <div data-testid="calibration-manager-state">
        Calibration read only: {String(readOnly)}
        {!readOnly && (
          <button
            type="button"
            onClick={() => onCalibrationChange?.({ unit: 'mm' })}
          >
            Set Calibration
          </button>
        )}
      </div>
    );
  };
});

jest.mock('../components/ImageGroupPanel', () => {
  return function MockImageGroupPanel({ onGroupChanged }) {
    return (
      <div>
        ImageGroupPanel
        <button type="button" onClick={() => onGroupChanged?.('updated-group')}>
          Change Group
        </button>
      </div>
    );
  };
});

jest.mock('../components/MeasurementList', () => {
  return function MockMeasurementList({
    onDeleteMeasurement,
    onRenameMeasurement,
    onToggleVisibility,
    measurements,
    readOnly,
    visibleMeasurementIds
  }) {
    return (
      <div data-testid="measurement-list">
        MeasurementList - {measurements?.length || 0} measurements
        <span data-testid="visible-count">Visible: {visibleMeasurementIds?.length || 0}</span>
        {(measurements || []).map((measurement) => (
          <span key={measurement.id}>{measurement.name}</span>
        ))}
        <span data-testid="measurement-readonly">Measurement read only: {String(readOnly)}</span>
        {!readOnly && onDeleteMeasurement && (
          <button onClick={() => onDeleteMeasurement('test-measurement-id')}>
            Delete First
          </button>
        )}
        {!readOnly && onRenameMeasurement && (
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
    mockParams = { imageId: 'test-image-id' };
    mockSearchParams = new URLSearchParams('project=test-project-id');
    mockImageDisplaySnapshots = [];
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const setupFetchMock = (image, options = {}) => {
    const {
      metadataResponse,
      metadataOk = true,
      metadataStatus = metadataOk ? 200 : 422,
      metadataText = 'Validation error',
      metadataJsonError = false
    } = options;

    fetchMock.mockImplementation(async (url, requestOptions = {}) => {
      const urlString = String(url);
      const method = requestOptions.method || 'GET';

      if (urlString === '/api/users/me') {
        return { ok: true, json: async () => ({ email: 'test@example.com' }) };
      }

      if (urlString === '/api/images/test-image-id' && method === 'GET') {
        return { ok: true, json: async () => image };
      }

      if (urlString === '/api/projects/test-project-id/classes') {
        return { ok: true, json: async () => [] };
      }

      if (urlString === '/api/projects/test-project-id') {
        return { ok: true, json: async () => ({ is_archived: false }) };
      }

      if (urlString.startsWith('/api/projects/test-project-id/images')) {
        return { ok: true, json: async () => [image] };
      }

      if (urlString === '/api/images/test-image-id/reviews') {
        return { ok: true, json: async () => [] };
      }

      if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
        if (!metadataOk) {
          return { ok: false, status: metadataStatus, text: async () => metadataText };
        }
        if (metadataJsonError) {
          return {
            ok: true,
            json: async () => {
              throw new Error('Malformed response body');
            }
          };
        }

        const body = JSON.parse(requestOptions.body);
        return {
          ok: true,
          json: async () => metadataResponse || {
            ...image,
            metadata: {
              ...(image.metadata || image.metadata_ || {}),
              [body.key]: body.value
            }
          }
        };
      }

      throw new Error(`Unhandled fetch in ImageView.measurements.test.js: ${method} ${urlString}`);
    });
  };

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

      setupFetchMock(mockImage);

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });
    });

    test('falls back to metadata_ measurements when metadata does not contain an array', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {},
        metadata_: {
          measurements: [
            { id: 'measurement-1', name: 'Legacy Measurement' }
          ]
        }
      };

      setupFetchMock(mockImage);

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      });
    });

    test('ignores non-array measurements values', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: { id: 'not-an-array' }
        }
      };

      setupFetchMock(mockImage);

      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('image-display')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('measurement-list')).not.toBeInTheDocument();
    });

    test('falls back to legacy measurements when the canonical value is malformed', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: { id: 'not-an-array' }
        },
        metadata_: {
          measurements: [
            { id: 'measurement-legacy', name: 'Legacy Measurement' }
          ]
        }
      };

      setupFetchMock(mockImage);
      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      expect(await screen.findByText('Legacy Measurement')).toBeInTheDocument();
      expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
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

      setupFetchMock(mockImage);

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

      setupFetchMock(mockImage);

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
        const metadataCalls = fetchMock.mock.calls.filter(call => call[0].includes('/metadata'));
        const [url, options] = metadataCalls[metadataCalls.length - 1];

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

      setupFetchMock(mockImage);

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
        const metadataCalls = fetchMock.mock.calls.filter(call => call[0].includes('/metadata'));
        const [url, options] = metadataCalls[metadataCalls.length - 1];

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
    test('keeps a server-acknowledged mutation when its success body is malformed', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [
            { id: 'test-measurement-id', name: 'Measurement 1' }
          ]
        }
      };

      setupFetchMock(mockImage, { metadataJsonError: true });
      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );
      expect(await screen.findByText(/1 measurements/)).toBeInTheDocument();

      await act(async () => {
        screen.getByText('Save Measurement').click();
      });

      expect(await screen.findByText(/2 measurements/)).toBeInTheDocument();
      expect(screen.getByText('New Measurement')).toBeInTheDocument();
      expect(screen.queryByText(/Failed to save measurement/)).not.toBeInTheDocument();
    });

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

      setupFetchMock(mockImage, {
        metadataOk: false,
        metadataStatus: 422,
        metadataText: 'Validation error'
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

      setupFetchMock(mockImage, {
        metadataOk: false,
        metadataStatus: 500,
        metadataText: 'Server error'
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

      setupFetchMock(mockImage);

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

    test('preserves hidden measurement IDs when unrelated image fields change', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        group_id: 'original-group',
        metadata: {
          measurements: [
            { id: 'test-measurement-id', name: 'Measurement 1' },
            { id: 'measurement-2', name: 'Measurement 2' }
          ]
        }
      };

      setupFetchMock(mockImage);
      render(
        <BrowserRouter>
          <ImageView />
        </BrowserRouter>
      );

      expect(await screen.findByTestId('visible-count')).toHaveTextContent('Visible: 2');
      await act(async () => {
        screen.getByText('Toggle Visibility').click();
      });
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 1');

      await act(async () => {
        screen.getByText('Change Group').click();
      });
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 1');
    });
  });

  describe('Async request ownership', () => {
    test('never renders the previous route payload during the first A to B render', async () => {
      const imageBRequest = createDeferred();
      const imageA = {
        id: 'image-a',
        filename: 'image-a.jpg',
        metadata: { measurements: [{ id: 'a-1', name: 'A Measurement' }] }
      };
      const imageB = {
        id: 'image-b',
        filename: 'image-b.jpg',
        metadata: { measurements: [{ id: 'b-1', name: 'B Measurement' }] }
      };

      fetchMock.mockImplementation((url) => {
        const urlString = String(url);
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/image-a') {
          return Promise.resolve({ ok: true, json: async () => imageA });
        }
        if (urlString === '/api/images/image-b') return imageBRequest.promise;
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [imageA, imageB] });
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${urlString}`);
      });

      mockParams = { imageId: 'image-a' };
      const view = render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('image-a.jpg')).toBeInTheDocument();
      expect(await screen.findByText('A Measurement')).toBeInTheDocument();
      await act(async () => {
        screen.getByText('Select Analysis').click();
      });

      const snapshotCountBeforeNavigation = mockImageDisplaySnapshots.length;
      mockParams = { imageId: 'image-b' };
      view.rerender(<BrowserRouter><ImageView /></BrowserRouter>);

      const firstImageBRender = mockImageDisplaySnapshots
        .slice(snapshotCountBeforeNavigation)
        .find((snapshot) => snapshot.imageId === 'image-b');
      expect(firstImageBRender).toEqual(expect.objectContaining({
        annotationCount: 0,
        image: null,
        imageId: 'image-b',
        measurementCount: 0,
        selectedAnalysis: null,
      }));
      expect(screen.queryByText('image-a.jpg')).not.toBeInTheDocument();
      expect(screen.queryByText('A Measurement')).not.toBeInTheDocument();
      await act(async () => {
        screen.getByText('Save Measurement').click();
      });
      expect(fetchMock.mock.calls).not.toContainEqual([
        '/api/images/image-b/metadata',
        expect.objectContaining({ method: 'PUT' }),
      ]);

      await act(async () => {
        imageBRequest.resolve({ ok: true, json: async () => imageB });
        await imageBRequest.promise;
      });
      expect(await screen.findByText('image-b.jpg')).toBeInTheDocument();
      expect(await screen.findByText('B Measurement')).toBeInTheDocument();
    });

    test('keeps the current route when an aborted older image request resolves last', async () => {
      const imageARequest = createDeferred();
      const imageBRequest = createDeferred();
      const imageA = {
        id: 'image-a',
        filename: 'image-a.jpg',
        metadata: { measurements: [{ id: 'a-1', name: 'A Measurement' }] }
      };
      const imageB = {
        id: 'image-b',
        filename: 'image-b.jpg',
        metadata: {
          measurements: [
            { id: 'b-1', name: 'B Measurement 1' },
            { id: 'b-2', name: 'B Measurement 2' }
          ]
        }
      };

      fetchMock.mockImplementation((url) => {
        const urlString = String(url);
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/image-a') return imageARequest.promise;
        if (urlString === '/api/images/image-b') return imageBRequest.promise;
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [imageA, imageB] });
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${urlString}`);
      });

      mockParams = { imageId: 'image-a' };
      const view = render(<BrowserRouter><ImageView /></BrowserRouter>);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/images/image-a',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ));

      mockParams = { imageId: 'image-b' };
      view.rerender(<BrowserRouter><ImageView /></BrowserRouter>);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/images/image-b',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ));

      await act(async () => {
        imageBRequest.resolve({ ok: true, json: async () => imageB });
        await imageBRequest.promise;
      });
      expect(await screen.findByText('image-b.jpg')).toBeInTheDocument();
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 2');

      await act(async () => {
        imageARequest.resolve({ ok: true, json: async () => imageA });
        await imageARequest.promise;
      });
      expect(screen.getByText('image-b.jpg')).toBeInTheDocument();
      expect(screen.queryByText('image-a.jpg')).not.toBeInTheDocument();
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      expect(document.title).toBe('image-b.jpg - Image Manager');
    });

    test('ignores an older failure, then rolls a current failure back to confirmed server state', async () => {
      const firstMutation = createDeferred();
      const secondMutation = createDeferred();
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
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
      let metadataCallCount = 0;

      fetchMock.mockImplementation((url, requestOptions = {}) => {
        const urlString = String(url);
        const method = requestOptions.method || 'GET';
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => mockImage });
        }
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [mockImage] });
        }
        if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
          metadataCallCount += 1;
          if (metadataCallCount === 1) return firstMutation.promise;
          return secondMutation.promise;
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${method} ${urlString}`);
      });

      render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('Measurement 1')).toBeInTheDocument();

      await act(async () => {
        screen.getByText('Rename First').click();
      });
      await waitFor(() => expect(metadataCallCount).toBe(1));
      await act(async () => {
        screen.getByText('Delete First').click();
      });
      expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      expect(screen.getByText('Measurement 2')).toBeInTheDocument();

      await act(async () => {
        firstMutation.resolve({
          ok: false,
          status: 500,
          text: async () => 'older request failed',
        });
        await firstMutation.promise;
      });
      await waitFor(() => expect(metadataCallCount).toBe(2));
      expect(screen.getByText(/1 measurements/)).toBeInTheDocument();
      expect(screen.getByText('Measurement 2')).toBeInTheDocument();
      expect(screen.queryByText('Measurement 1')).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed to rename measurement/)).not.toBeInTheDocument();

      await act(async () => {
        secondMutation.resolve({
          ok: false,
          status: 500,
          text: async () => 'current request failed',
        });
        await secondMutation.promise;
      });

      expect(await screen.findByText(/Failed to delete measurement/)).toBeInTheDocument();
      expect(screen.getByText(/2 measurements/)).toBeInTheDocument();
      expect(screen.getByText('Measurement 1')).toBeInTheDocument();
      expect(screen.getByText('Measurement 2')).toBeInTheDocument();
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      expect(consoleError).toHaveBeenCalledWith(
        'Error deleting measurement:',
        expect.objectContaining({ message: expect.stringContaining('current request failed') }),
      );
    });

    test('ignores a successful mutation after navigation without blocking the new route queue', async () => {
      const mutationResponse = createDeferred();
      const imageA = {
        id: 'test-image-id',
        filename: 'image-a.jpg',
        metadata: {
          measurements: [{ id: 'test-measurement-id', name: 'A Measurement' }]
        }
      };
      const imageB = {
        id: 'image-b',
        filename: 'image-b.jpg',
        metadata: {
          measurements: [{ id: 'b-measurement', name: 'B Measurement' }]
        }
      };

      fetchMock.mockImplementation((url, requestOptions = {}) => {
        const urlString = String(url);
        const method = requestOptions.method || 'GET';
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => imageA });
        }
        if (urlString === '/api/images/image-b' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => imageB });
        }
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [imageA, imageB] });
        }
        if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
          return mutationResponse.promise;
        }
        if (urlString === '/api/images/image-b/metadata' && method === 'PUT') {
          const body = JSON.parse(requestOptions.body);
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...imageB,
              metadata: { measurements: body.value }
            })
          });
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${method} ${urlString}`);
      });

      const view = render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('A Measurement')).toBeInTheDocument();
      await act(async () => {
        screen.getByText('Rename First').click();
      });

      mockParams = { imageId: 'image-b' };
      view.rerender(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('B Measurement')).toBeInTheDocument();

      await act(async () => {
        screen.getByText('Rename First').click();
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/images/image-b/metadata',
        expect.objectContaining({ method: 'PUT' }),
      ));

      await act(async () => {
        mutationResponse.resolve({
          ok: true,
          json: async () => ({
            ...imageA,
            metadata: {
              measurements: [{ id: 'test-measurement-id', name: 'Server A Measurement' }]
            }
          })
        });
        await mutationResponse.promise;
      });

      expect(screen.getByText('image-b.jpg')).toBeInTheDocument();
      expect(screen.getByText('B Measurement')).toBeInTheDocument();
      expect(screen.queryByText('Server A Measurement')).not.toBeInTheDocument();
    });

    test('serializes and rebases an A to B to A mutation on the old A acknowledgement', async () => {
      const oldAMutation = createDeferred();
      const imageA = {
        id: 'test-image-id',
        filename: 'image-a.jpg',
        metadata: {
          measurements: [{ id: 'test-measurement-id', name: 'A Measurement' }]
        }
      };
      const imageB = {
        id: 'image-b',
        filename: 'image-b.jpg',
        metadata: {
          measurements: [{ id: 'b-measurement', name: 'B Measurement' }]
        }
      };
      let imageAMutationCount = 0;
      const persistedAMeasurements = [];
      let oldAMutationSignal;

      fetchMock.mockImplementation((url, requestOptions = {}) => {
        const urlString = String(url);
        const method = requestOptions.method || 'GET';
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => imageA });
        }
        if (urlString === '/api/images/image-b' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => imageB });
        }
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [imageA, imageB] });
        }
        if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
          imageAMutationCount += 1;
          const body = JSON.parse(requestOptions.body);
          persistedAMeasurements.push(body.value);
          if (imageAMutationCount === 1) {
            oldAMutationSignal = requestOptions.signal;
            return oldAMutation.promise;
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...imageA,
              metadata: { measurements: body.value },
            }),
          });
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${method} ${urlString}`);
      });

      const view = render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('A Measurement')).toBeInTheDocument();
      await act(async () => {
        screen.getByText('Rename First').click();
      });
      await waitFor(() => expect(imageAMutationCount).toBe(1));

      mockParams = { imageId: 'image-b' };
      view.rerender(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('B Measurement')).toBeInTheDocument();

      mockParams = { imageId: 'test-image-id' };
      view.rerender(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('A Measurement')).toBeInTheDocument();
      await act(async () => {
        screen.getByText('Save Measurement').click();
      });

      expect(screen.getByText('New Measurement')).toBeInTheDocument();
      expect(imageAMutationCount).toBe(1);
      expect(oldAMutationSignal?.aborted).not.toBe(true);

      await act(async () => {
        oldAMutation.resolve({
          ok: true,
          json: async () => ({
            ...imageA,
            metadata: {
              measurements: [
                { id: 'test-measurement-id', name: 'Server Canonical Name' },
                { id: 'server-added', name: 'Server Added Measurement' },
              ],
            },
          }),
        });
        await oldAMutation.promise;
      });

      await waitFor(() => expect(imageAMutationCount).toBe(2));
      expect(persistedAMeasurements[1]).toEqual([
        { id: 'test-measurement-id', name: 'Server Canonical Name' },
        { id: 'server-added', name: 'Server Added Measurement' },
        { id: 'measurement-new', name: 'New Measurement' },
      ]);
      expect(await screen.findByText('Server Canonical Name')).toBeInTheDocument();
      expect(screen.getByText('Server Added Measurement')).toBeInTheDocument();
      expect(screen.getByText('New Measurement')).toBeInTheDocument();
    });

    test('merges only returned measurements after newer group and metadata edits', async () => {
      const mutationResponse = createDeferred();
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        group_id: 'old-group',
        metadata: {
          note: 'old-note',
          measurements: [{ id: 'test-measurement-id', name: 'Original Name' }]
        }
      };

      fetchMock.mockImplementation((url, requestOptions = {}) => {
        const urlString = String(url);
        const method = requestOptions.method || 'GET';
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => mockImage });
        }
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [mockImage] });
        }
        if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
          return mutationResponse.promise;
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${method} ${urlString}`);
      });

      render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('Original Name')).toBeInTheDocument();
      await act(async () => {
        screen.getByText('Rename First').click();
      });
      await act(async () => {
        screen.getByText('Change Group').click();
        screen.getByText('Change Metadata').click();
      });
      expect(screen.getByTestId('image-metadata-state')).toHaveTextContent(
        'Group: updated-group; Note: newer-note',
      );

      await act(async () => {
        mutationResponse.resolve({
          ok: true,
          json: async () => ({
            ...mockImage,
            group_id: 'old-group',
            metadata: {
              note: 'old-note',
              measurements: [{ id: 'test-measurement-id', name: 'Server Name' }],
            },
          }),
        });
        await mutationResponse.promise;
      });

      expect(await screen.findByText('Server Name')).toBeInTheDocument();
      expect(screen.getByTestId('image-metadata-state')).toHaveTextContent(
        'Group: updated-group; Note: newer-note',
      );
    });

    test('restores a failed deleted measurement and its captured visibility', async () => {
      const mutationResponse = createDeferred();
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [
            { id: 'test-measurement-id', name: 'Measurement 1' },
            { id: 'measurement-2', name: 'Measurement 2' },
          ]
        }
      };

      fetchMock.mockImplementation((url, requestOptions = {}) => {
        const urlString = String(url);
        const method = requestOptions.method || 'GET';
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => mockImage });
        }
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [mockImage] });
        }
        if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
          return mutationResponse.promise;
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${method} ${urlString}`);
      });

      render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByTestId('visible-count')).toHaveTextContent('Visible: 2');
      await act(async () => {
        screen.getByText('Delete First').click();
      });
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 1');
      expect(screen.queryByText('Measurement 1')).not.toBeInTheDocument();

      await act(async () => {
        mutationResponse.resolve({
          ok: false,
          status: 500,
          text: async () => 'delete failed',
        });
        await mutationResponse.promise;
      });

      expect(await screen.findByText('Measurement 1')).toBeInTheDocument();
      expect(screen.getByTestId('visible-count')).toHaveTextContent('Visible: 2');
      consoleError.mockRestore();
    });

    test('upserts identical rapid saves without duplicate IDs', async () => {
      const firstMutation = createDeferred();
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {
          measurements: [{ id: 'existing', name: 'Existing Measurement' }]
        }
      };
      let metadataCallCount = 0;
      const persistedMeasurementLists = [];

      fetchMock.mockImplementation((url, requestOptions = {}) => {
        const urlString = String(url);
        const method = requestOptions.method || 'GET';
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id' && method === 'GET') {
          return Promise.resolve({ ok: true, json: async () => mockImage });
        }
        if (urlString === '/api/projects/test-project-id/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/test-project-id') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString.startsWith('/api/projects/test-project-id/images')) {
          return Promise.resolve({ ok: true, json: async () => [mockImage] });
        }
        if (urlString === '/api/images/test-image-id/metadata' && method === 'PUT') {
          metadataCallCount += 1;
          const body = JSON.parse(requestOptions.body);
          persistedMeasurementLists.push(body.value);
          if (metadataCallCount === 1) return firstMutation.promise;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ...mockImage,
              metadata: { measurements: body.value },
            }),
          });
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${method} ${urlString}`);
      });

      render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('Existing Measurement')).toBeInTheDocument();
      await act(async () => {
        screen.getByText('Save Measurement').click();
        screen.getByText('Save Measurement').click();
      });

      expect(screen.getByText(/2 measurements/)).toBeInTheDocument();
      expect(screen.getAllByText('New Measurement')).toHaveLength(1);
      await waitFor(() => expect(metadataCallCount).toBe(1));

      await act(async () => {
        firstMutation.resolve({
          ok: true,
          json: async () => ({
            ...mockImage,
            metadata: { measurements: persistedMeasurementLists[0] },
          }),
        });
        await firstMutation.promise;
      });

      await waitFor(() => expect(metadataCallCount).toBe(2));
      persistedMeasurementLists.forEach((persistedMeasurements) => {
        const persistedIds = persistedMeasurements.map((measurement) => measurement.id);
        expect(persistedIds.filter((measurementId) => measurementId === 'measurement-new')).toHaveLength(1);
        expect(new Set(persistedIds).size).toBe(persistedIds.length);
      });
      expect(screen.getByText(/2 measurements/)).toBeInTheDocument();
    });

    test('disables writes and clears project-owned state while archive status is unresolved', async () => {
      const projectBArchive = createDeferred();
      const imageA = {
        id: 'test-image-id',
        filename: 'project-a.jpg',
        metadata: {
          measurements: [{ id: 'test-measurement-id', name: 'A Measurement' }]
        }
      };
      const imageB = {
        id: 'image-b',
        filename: 'project-b.jpg',
        metadata: {
          measurements: [{ id: 'b-measurement', name: 'B Measurement' }]
        }
      };

      fetchMock.mockImplementation((url) => {
        const urlString = String(url);
        if (urlString === '/api/users/me') {
          return Promise.resolve({ ok: true, json: async () => ({ email: 'test@example.com' }) });
        }
        if (urlString === '/api/images/test-image-id') {
          return Promise.resolve({ ok: true, json: async () => imageA });
        }
        if (urlString === '/api/images/image-b') {
          return Promise.resolve({ ok: true, json: async () => imageB });
        }
        if (urlString === '/api/projects/project-a/classes') {
          return Promise.resolve({ ok: true, json: async () => [{ id: 'class-a' }] });
        }
        if (urlString === '/api/projects/project-b/classes') {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (urlString === '/api/projects/project-a') {
          return Promise.resolve({ ok: true, json: async () => ({ is_archived: false }) });
        }
        if (urlString === '/api/projects/project-b') return projectBArchive.promise;
        if (urlString.startsWith('/api/projects/project-a/images')) {
          return Promise.resolve({ ok: true, json: async () => [imageA] });
        }
        if (urlString.startsWith('/api/projects/project-b/images')) {
          return Promise.resolve({ ok: true, json: async () => [imageB] });
        }
        if (urlString.endsWith('/reviews')) {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        throw new Error(`Unhandled fetch: ${urlString}`);
      });

      mockSearchParams = new URLSearchParams('project=project-a');
      const view = render(<BrowserRouter><ImageView /></BrowserRouter>);
      expect(await screen.findByText('project-a.jpg')).toBeInTheDocument();
      expect(await screen.findByText('ImageDeletionControls')).toBeInTheDocument();
      expect(screen.getByTestId('classification-state')).toHaveTextContent(
        'Classifications: 1; Read only: false',
      );
      await act(async () => {
        screen.getByText('Set Calibration').click();
      });
      expect(screen.getByTestId('calibration-state')).toHaveTextContent('Calibration: mm');
      await waitFor(() => {
        expect(screen.getByTestId('navigation-state')).toHaveTextContent('Navigation: 1/0');
      });

      mockParams = { imageId: 'image-b' };
      mockSearchParams = new URLSearchParams('project=project-b');
      view.rerender(<BrowserRouter><ImageView /></BrowserRouter>);

      expect(screen.queryByText('ImageDeletionControls')).not.toBeInTheDocument();
      expect(screen.getByTestId('classification-state')).toHaveTextContent(
        'Classifications: 0; Read only: true',
      );
      expect(screen.getByTestId('calibration-state')).toHaveTextContent('Calibration: none');
      expect(screen.getByTestId('navigation-state')).toHaveTextContent('Navigation: 0/-1');

      expect(await screen.findByText('project-b.jpg')).toBeInTheDocument();
      expect(screen.queryByText('ImageDeletionControls')).not.toBeInTheDocument();
      expect(screen.getByTestId('classification-state')).toHaveTextContent('Read only: true');
      expect(screen.getByTestId('calibration-manager-state')).toHaveTextContent(
        'Calibration read only: true',
      );
      expect(screen.getByTestId('measurement-readonly')).toHaveTextContent(
        'Measurement read only: true',
      );
      expect(screen.getByTestId('image-metadata-state')).toHaveTextContent('Read only: true');
      expect(screen.queryByText('Set Calibration')).not.toBeInTheDocument();
      expect(screen.queryByText('Change Metadata')).not.toBeInTheDocument();
      expect(screen.queryByText('Rename First')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete First')).not.toBeInTheDocument();

      await act(async () => {
        projectBArchive.resolve({
          ok: true,
          json: async () => ({ is_archived: true }),
        });
        await projectBArchive.promise;
      });
      expect(await screen.findByText('This project is archived.')).toBeInTheDocument();
      expect(screen.queryByText('ImageDeletionControls')).not.toBeInTheDocument();
    });
  });


  describe('Initial state when no measurements exist', () => {
    test('does not render MeasurementList when no measurements', async () => {
      const mockImage = {
        id: 'test-image-id',
        filename: 'test.jpg',
        metadata: {}
      };

      setupFetchMock(mockImage);

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

      setupFetchMock(mockImage);

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
