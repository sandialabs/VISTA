import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageDisplay from '../ImageDisplay';

// Mock data
const mockRegularImage = {
  id: 'img-1',
  filename: 'test-image.jpg',
  size_bytes: 1024000,
  created_at: '2023-01-01T00:00:00Z',
  deleted_at: null,
  storage_deleted: false
};

const mockDeletedImage = {
  id: 'img-2',
  filename: 'deleted-image.jpg',
  size_bytes: 512000,
  created_at: '2023-01-02T00:00:00Z',
  deleted_at: '2023-01-03T00:00:00Z',
  storage_deleted: false,
  deletion_reason: 'Test deletion'
};


const renderImageDisplay = (props = {}) => {
  const defaultProps = {
    imageId: 'img-1',
    image: mockRegularImage,
    isTransitioning: false,
    projectId: 'test-project-id',
    setImage: jest.fn(),
    refreshProjectImages: jest.fn(),
    ...props
  };

  return render(<ImageDisplay {...defaultProps} />);
};

// Mock fetch for testing
global.fetch = jest.fn();

describe('ImageDisplay', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  afterEach(() => {
    // Keep the jest mock installed; just reset between tests
    fetch.mockReset();
  });

  describe('Regular Images', () => {
    test('renders regular image with correct content URL', () => {
      renderImageDisplay();
      
      const image = screen.getByAltText('test-image.jpg');
      expect(image).toBeInTheDocument();
      expect(image.src).toContain('/api/images/img-1/content');
      expect(image).not.toHaveClass('deleted-image');
    });

    test('shows all control buttons for regular images', () => {
      renderImageDisplay();
      
      expect(screen.getByText('Reset')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    test('renders original and ML overlay images side by side when a bitmap is available', () => {
      renderImageDisplay({
        navigateToPreviousImage: jest.fn(),
        navigateToNextImage: jest.fn(),
        currentImageIndex: 0,
        projectImages: [mockRegularImage],
        selectedAnalysis: null,
        annotations: [],
        overlayOptions: {
          showBoxes: false,
          showHeatmap: false,
          opacity: 0.7,
          viewMode: 'side-by-side',
          bitmapAvailable: true
        }
      });

      expect(screen.getAllByAltText('test-image.jpg')).toHaveLength(2);
      expect(screen.getByText('Original')).toBeInTheDocument();
      expect(screen.getByText('ML Overlay')).toBeInTheDocument();
    });

    test('keeps image geometry unchanged when measure mode toggles', () => {
      const setMeasurementActive = jest.fn();
      const { rerender } = renderImageDisplay({
        setMeasurementActive,
        measurementActive: false,
        calibration: { pixels_per_mm: 10, pixels_per_inch: 254, unit: 'mm' }
      });

      const inactiveImage = screen.getByAltText('test-image.jpg');
      const inactiveLayer = screen.getByTestId('image-anchored-layer');
      const inactiveImageStyle = inactiveImage.getAttribute('style') || '';
      const inactiveLayerStyle = inactiveLayer.getAttribute('style') || '';
      const imageDisplay = document.getElementById('image-display');
      const inactiveDisplayClass = imageDisplay.getAttribute('class') || '';
      const inactiveDisplayStyle = imageDisplay.getAttribute('style') || '';

      rerender(
        <ImageDisplay
          imageId="img-1"
          image={mockRegularImage}
          isTransitioning={false}
          projectId="test-project-id"
          setImage={jest.fn()}
          refreshProjectImages={jest.fn()}
          setMeasurementActive={setMeasurementActive}
          measurementActive={true}
          calibration={{ pixels_per_mm: 10, pixels_per_inch: 254, unit: 'mm' }}
        />
      );

      expect(screen.getByAltText('test-image.jpg').getAttribute('style') || '').toBe(inactiveImageStyle);
      expect(screen.getByTestId('image-anchored-layer').getAttribute('style') || '').toBe(inactiveLayerStyle);
      expect(document.getElementById('image-display').getAttribute('class') || '').toBe(inactiveDisplayClass);
      expect(document.getElementById('image-display').getAttribute('style') || '').toBe(inactiveDisplayStyle);
    });

    test('zoom reset functionality works correctly', () => {
      renderImageDisplay();
      
      const image = screen.getByAltText('test-image.jpg');
      
      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(1)');
      expect(image.style.transform).toBe('');
      
      const resetButton = screen.getByText('Reset');
      fireEvent.click(resetButton);
      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(1)');
      expect(image.style.transform).toBe('');
    });
  });

  describe('Image Navigation', () => {
    test('navigates between images and disables navigation at the list boundaries', () => {
      const navigateToPreviousImage = jest.fn();
      const navigateToNextImage = jest.fn();
      const projectImages = [
        mockRegularImage,
        { ...mockRegularImage, id: 'img-2', filename: 'second-image.jpg' },
        { ...mockRegularImage, id: 'img-3', filename: 'third-image.jpg' }
      ];
      const navigationProps = {
        isTransitioning: false,
        projectId: 'test-project-id',
        setImage: jest.fn(),
        refreshProjectImages: jest.fn(),
        navigateToPreviousImage,
        navigateToNextImage,
        projectImages
      };

      const { rerender } = renderImageDisplay({
        ...navigationProps,
        imageId: projectImages[1].id,
        image: projectImages[1],
        currentImageIndex: 1
      });

      fireEvent.click(screen.getByRole('button', { name: /prev/i }));
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      expect(navigateToPreviousImage).toHaveBeenCalledTimes(1);
      expect(navigateToNextImage).toHaveBeenCalledTimes(1);

      rerender(
        <ImageDisplay
          {...navigationProps}
          imageId={projectImages[0].id}
          image={projectImages[0]}
          currentImageIndex={0}
        />
      );
      expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();

      rerender(
        <ImageDisplay
          {...navigationProps}
          imageId={projectImages[2].id}
          image={projectImages[2]}
          currentImageIndex={2}
        />
      );
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });
  });

  describe('Deleted Images', () => {
    test('renders deleted image with placeholder SVG', () => {
      renderImageDisplay({
        imageId: 'img-2',
        image: mockDeletedImage
      });

      const image = screen.getByAltText('Deleted');
      expect(image).toBeInTheDocument();
      expect(image.src).toContain('data:image/svg+xml;base64,');
      expect(image).toHaveClass('deleted-image');
    });

    test('does not show delete button for deleted images', () => {
      renderImageDisplay({ 
        imageId: 'img-2',
        image: mockDeletedImage
      });
      
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    test('still shows other control buttons for deleted images', () => {
      renderImageDisplay({ 
        imageId: 'img-2',
        image: mockDeletedImage
      });
      
      expect(screen.getByText('Reset')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
    });

    test('zoom reset works on deleted image placeholder', () => {
      renderImageDisplay({
        imageId: 'img-2',
        image: mockDeletedImage
      });

      const image = screen.getByAltText('Deleted');

      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(1)');
      expect(image.style.transform).toBe('');
    });
  });

  describe('Download Functionality', () => {
    test('download attempts to fetch image content', async () => {
      const mockBlob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (header) => {
            if (header === 'content-type') return 'image/jpeg';
            return null;
          }
        },
        blob: () => Promise.resolve(mockBlob)
      });

        // Mock URL.createObjectURL and click functionality
        const originalCreateElement = document.createElement.bind(document);
        global.URL.createObjectURL = jest.fn(() => 'blob:fake-url');
        global.URL.revokeObjectURL = jest.fn();

        const mockClick = jest.fn();

        // Only mock anchor creation; preserve default DOM behavior
        document.createElement = jest.fn((tagName) => {
          if (tagName === 'a') {
            const a = originalCreateElement('a');
            a.click = mockClick;
            return a;
          }
          return originalCreateElement(tagName);
        });

      renderImageDisplay();

      const downloadButton = screen.getByText('Download');
      fireEvent.click(downloadButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/images/img-1/content');
      });

      // Cleanup
      global.URL.createObjectURL.mockRestore();
      global.URL.revokeObjectURL.mockRestore();
      document.createElement = originalCreateElement;
    });
  });

  describe('Delete Functionality', () => {
    test('shows delete modal when delete button is clicked', () => {
      renderImageDisplay();
      
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      expect(screen.getByText('Delete Image')).toBeInTheDocument();
      expect(screen.getByLabelText('Reason (required)')).toBeInTheDocument();
      expect(screen.getByText('Force delete (also remove object from storage)')).toBeInTheDocument();
    });

    test('delete modal has proper form validation', async () => {
      renderImageDisplay();
      
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      const submitButton = screen.getAllByRole('button', { name: /^Delete$/ })[1];
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText('Reason must be at least 5 characters')).toBeInTheDocument();
      });
    });

    test('successful delete updates image state', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockRegularImage, deleted_at: '2023-01-04T00:00:00Z' })
      });

      const mockSetImage = jest.fn();
      const mockRefreshProjectImages = jest.fn();
      
      renderImageDisplay({ 
        setImage: mockSetImage,
        refreshProjectImages: mockRefreshProjectImages
      });
      
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      const reasonTextarea = screen.getByLabelText('Reason (required)');
      fireEvent.change(reasonTextarea, { target: { value: 'Test deletion reason' } });
      
      const submitButton = screen.getAllByRole('button', { name: /^Delete$/ })[1];
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/projects/test-project-id/images/img-1',
          expect.objectContaining({
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Test deletion reason', force: false })
          })
        );
      });

      await waitFor(() => {
        expect(mockSetImage).toHaveBeenCalled();
        expect(mockRefreshProjectImages).toHaveBeenCalled();
      });
    });

    test('delete modal closes when cancel is clicked', () => {
      renderImageDisplay();
      
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      expect(screen.getByText('Delete Image')).toBeInTheDocument();
      
      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);
      
      expect(screen.queryByText('Delete Image')).not.toBeInTheDocument();
    });

    test('force delete checkbox changes modal title and description', () => {
      renderImageDisplay();
      
      const deleteButton = screen.getByText('Delete');
      fireEvent.click(deleteButton);
      
      expect(screen.getByText('Delete Image')).toBeInTheDocument();
      expect(screen.getByText(/The image will be hidden and can be restored/)).toBeInTheDocument();
      
      const forceCheckbox = screen.getByLabelText('Force delete (also remove object from storage)');
      fireEvent.click(forceCheckbox);
      
      expect(screen.getByText('Force Delete Image')).toBeInTheDocument();
      expect(screen.getByText(/This will remove the file from storage immediately/)).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    test('shows loading state when no image provided', () => {
      renderImageDisplay({ image: null });
      
      expect(screen.getByText('Loading image...')).toBeInTheDocument();
    });

    test('applies transition class when transitioning', () => {
      renderImageDisplay({ isTransitioning: true });
      
      const imageDisplay = screen.getByRole('img').closest('#image-display');
      expect(imageDisplay).toHaveClass('transitioning');
    });
  });

  describe('Error Handling', () => {
    test('falls back to thumbnail on image load error', async () => {
      renderImageDisplay();
      
      const image = screen.getByAltText('test-image.jpg');
      
      // Simulate image load error
      fireEvent.error(image);
      
      await waitFor(() => {
        expect(image.src).toContain('/api/images/img-1/thumbnail?width=800&height=600');
      });
    });
  });

  describe('Keyboard Navigation', () => {
    test('keyboard zoom controls work', () => {
      renderImageDisplay();
      
      const image = screen.getByAltText('test-image.jpg');
      
      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(1)');
      expect(image.style.transform).toBe('');
      
      // Zoom in with + key
      fireEvent.keyDown(document, { key: '+' });
      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(1.25)');
      expect(image.style.transform).toBe('');
      
      // Reset with 0 key
      fireEvent.keyDown(document, { key: '0' });
      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(1)');
      expect(image.style.transform).toBe('');
      
      // Zoom out with - key
      fireEvent.keyDown(document, { key: '-' });
      expect(screen.getByTestId('image-anchored-layer').style.transform).toBe('scale(0.75)');
      expect(image.style.transform).toBe('');
    });
  });
});
