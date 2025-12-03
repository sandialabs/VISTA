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
      
      expect(screen.getByText('Zoom In')).toBeInTheDocument();
      expect(screen.getByText('Zoom Out')).toBeInTheDocument();
      expect(screen.getByText('Reset')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    test('zoom functionality works correctly', () => {
      renderImageDisplay();
      
      const image = screen.getByAltText('test-image.jpg');
      const zoomInButton = screen.getByText('Zoom In');
      
      expect(image.style.transform).toBe('scale(1)');
      
      fireEvent.click(zoomInButton);
      expect(image.style.transform).toBe('scale(1.25)');
      
      const resetButton = screen.getByText('Reset');
      fireEvent.click(resetButton);
      expect(image.style.transform).toBe('scale(1)');
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
      
      expect(screen.getByText('Zoom In')).toBeInTheDocument();
      expect(screen.getByText('Zoom Out')).toBeInTheDocument();
      expect(screen.getByText('Reset')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
    });

    test('zoom works on deleted image placeholder', () => {
      renderImageDisplay({
        imageId: 'img-2',
        image: mockDeletedImage
      });

      const image = screen.getByAltText('Deleted');
      const zoomInButton = screen.getByText('Zoom In');

      expect(image.style.transform).toBe('scale(1)');

      fireEvent.click(zoomInButton);
      expect(image.style.transform).toBe('scale(1.25)');
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
      
      expect(image.style.transform).toBe('scale(1)');
      
      // Zoom in with + key
      fireEvent.keyDown(document, { key: '+' });
      expect(image.style.transform).toBe('scale(1.25)');
      
      // Reset with 0 key
      fireEvent.keyDown(document, { key: '0' });
      expect(image.style.transform).toBe('scale(1)');
      
      // Zoom out with - key
      fireEvent.keyDown(document, { key: '-' });
      expect(image.style.transform).toBe('scale(0.75)');
    });
  });
});