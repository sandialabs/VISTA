import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ImageGallery from '../ImageGallery';

// Mock react-router-dom
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

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

const mockPermanentlyDeletedImage = {
  id: 'img-3',
  filename: 'permanently-deleted.jpg',
  size_bytes: 256000,
  created_at: '2023-01-01T00:00:00Z',
  deleted_at: '2023-01-02T00:00:00Z',
  storage_deleted: true,
  deletion_reason: 'Permanent deletion test'
};

const mockImageWithMetadata = {
  id: 'img-4',
  filename: 'brick-wall.jpg',
  size_bytes: 2048000,
  created_at: '2023-01-04T00:00:00Z',
  deleted_at: null,
  storage_deleted: false,
  metadata: { brick: true, color: 'red', location: 'warehouse' }
};

const mockImageWithMetadataUnderscore = {
  id: 'img-5',
  filename: 'concrete-slab.jpg',
  size_bytes: 3072000,
  created_at: '2023-01-05T00:00:00Z',
  deleted_at: null,
  storage_deleted: false,
  metadata_: { concrete: true, color: 'gray' }
};

const mockImageNoMetadata = {
  id: 'img-6',
  filename: 'no-meta.jpg',
  size_bytes: 512000,
  created_at: '2023-01-06T00:00:00Z',
  deleted_at: null,
  storage_deleted: false
};

const renderImageGallery = (props = {}) => {
  const defaultProps = {
    projectId: 'test-project-id',
    images: [mockRegularImage],
    loading: false,
    onImageUpdated: jest.fn(),
    refreshProjectImages: jest.fn(),
    ...props
  };

  return render(
    <BrowserRouter>
      <ImageGallery {...defaultProps} />
    </BrowserRouter>
  );
};

describe('ImageGallery', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    localStorage.clear();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
  });

  afterEach(() => {
    if (global.fetch && global.fetch.mockRestore) {
      global.fetch.mockRestore();
    }
    delete global.fetch;
  });

  describe('Regular Images', () => {
    test('renders regular images with proper thumbnail URLs (medium view)', () => {
      renderImageGallery();
      
      const image = screen.getByAltText('test-image.jpg');
      expect(image).toBeInTheDocument();
      expect(image.src).toContain('/api/images/img-1/thumbnail?width=400&height=400');
    });

    test('uses small thumbnail resolution in small view mode', () => {
      renderImageGallery();

      fireEvent.click(screen.getByTitle('Small thumbnails'));

      const image = screen.getByAltText('test-image.jpg');
      expect(image.src).toContain('/api/images/img-1/thumbnail?width=200&height=200');
    });

    test('uses large thumbnail resolution in large view mode', () => {
      renderImageGallery();

      fireEvent.click(screen.getByTitle('Large thumbnails'));

      const image = screen.getByAltText('test-image.jpg');
      expect(image.src).toContain('/api/images/img-1/thumbnail?width=600&height=600');
    });

    test('displays image filename and size', () => {
      renderImageGallery();
      
      expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
      expect(screen.getByText('1000 KB')).toBeInTheDocument();
    });

    test('navigates to image view when image is clicked', () => {
      renderImageGallery();
      
      const imageContainer = screen.getByAltText('test-image.jpg').closest('.gallery-item-image');
      fireEvent.click(imageContainer);
      
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/view/img-1?project=test-project-id'));
    });

    test('shows View button on hover', () => {
      renderImageGallery();
      
      const viewButton = screen.getByText('View');
      expect(viewButton).toBeInTheDocument();
    });
  });

  describe('Deleted Images', () => {
    test('renders deleted images with placeholder SVG', () => {
      renderImageGallery({ images: [mockDeletedImage] });
      
      const image = screen.getByAltText('deleted-image.jpg');
      expect(image).toBeInTheDocument();
      expect(image.src).toContain('data:image/svg+xml;base64,');
      // Decode the base64 content to check for "Image Deleted" text
      const base64Content = image.src.split(',')[1];
      const decodedContent = atob(base64Content);
      expect(decodedContent).toContain('Image Deleted');
    });

    test('applies deleted class to gallery item', () => {
      renderImageGallery({ images: [mockDeletedImage] });
      
      const galleryItem = screen.getByAltText('deleted-image.jpg').closest('.gallery-item');
      expect(galleryItem).toHaveClass('deleted');
    });

    test('shows deleted status indicator', () => {
      renderImageGallery({ images: [mockDeletedImage] });
      
      expect(screen.getByText('Deleted')).toBeInTheDocument();
    });

    test('shows Restore button for deleted but not permanently deleted images', () => {
      renderImageGallery({ images: [mockDeletedImage] });
      
      const restoreButton = screen.getByText('Restore');
      expect(restoreButton).toBeInTheDocument();
    });

    test('does not show Restore button for permanently deleted images', () => {
      renderImageGallery({ images: [mockPermanentlyDeletedImage] });
      
      expect(screen.queryByText('Restore')).not.toBeInTheDocument();
    });

    test('does not show Delete button for any images in gallery', () => {
      renderImageGallery({ images: [mockRegularImage, mockDeletedImage] });
      
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });
  });

  describe('Image Loading', () => {
    test('uses fallback SVG on image load error for regular images', async () => {
      renderImageGallery();
      
      const image = screen.getByAltText('test-image.jpg');
      
      // Simulate image load error
      fireEvent.error(image);
      
      await waitFor(() => {
        expect(image.src).toContain('data:image/svg+xml;base64,');
        const base64Content = image.src.split(',')[1];
        const decodedContent = atob(base64Content);
        expect(decodedContent).toContain('Image Unavailable');
      });
    });

    test('uses deleted placeholder SVG on image load error for deleted images', async () => {
      renderImageGallery({ images: [mockDeletedImage] });
      
      const image = screen.getByAltText('deleted-image.jpg');
      
      // Simulate image load error
      fireEvent.error(image);
      
      await waitFor(() => {
        expect(image.src).toContain('data:image/svg+xml;base64,');
        const base64Content = image.src.split(',')[1];
        const decodedContent = atob(base64Content);
        expect(decodedContent).toContain('Image Deleted');
      });
    });
  });

  describe('Gallery Controls', () => {
    test('displays correct image count', () => {
      renderImageGallery({ images: [mockRegularImage, mockDeletedImage] });
      
      expect(screen.getByText('2 images')).toBeInTheDocument();
    });

    test('shows search functionality', () => {
      renderImageGallery();

      const searchInput = screen.getByPlaceholderText('Search by filename...');
      expect(searchInput).toBeInTheDocument();
    });

    test('filters images based on search term', async () => {
      renderImageGallery({ images: [mockRegularImage, mockDeletedImage] });

      const searchInput = screen.getByPlaceholderText('Search by filename...');
      fireEvent.change(searchInput, { target: { value: 'test-image' } });

      await waitFor(() => {
        expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
        expect(screen.queryByText('deleted-image.jpg')).not.toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    test('shows loading spinner when loading is true', () => {
      renderImageGallery({ loading: true, images: [] });
      
      expect(screen.getByText('Loading images...')).toBeInTheDocument();
      const spinnerElement = document.querySelector('.spinner');
      expect(spinnerElement).toBeInTheDocument();
    });

    test('shows empty state when no images', () => {
      renderImageGallery({ images: [] });
      
      expect(screen.getByText('No images yet')).toBeInTheDocument();
      expect(screen.getByText('Upload your first image to get started')).toBeInTheDocument();
    });
  });

  describe('Metadata Search', () => {
    const metadataImages = [mockImageWithMetadata, mockImageWithMetadataUnderscore, mockImageNoMetadata];

    test('filters by "All Metadata" and returns images with matching values', async () => {
      renderImageGallery({ images: metadataImages });

      const select = screen.getByDisplayValue('Filename');
      fireEvent.change(select, { target: { value: 'metadata' } });

      const searchInput = screen.getByPlaceholderText('Search by metadata...');
      fireEvent.change(searchInput, { target: { value: 'red' } });

      await waitFor(() => {
        expect(screen.getByText('brick-wall.jpg')).toBeInTheDocument();
        expect(screen.queryByText('concrete-slab.jpg')).not.toBeInTheDocument();
        expect(screen.queryByText('no-meta.jpg')).not.toBeInTheDocument();
      });
    });

    test('filters by "All Metadata" with metadata_ field (backward compat)', async () => {
      renderImageGallery({ images: metadataImages });

      const select = screen.getByDisplayValue('Filename');
      fireEvent.change(select, { target: { value: 'metadata' } });

      const searchInput = screen.getByPlaceholderText('Search by metadata...');
      fireEvent.change(searchInput, { target: { value: 'gray' } });

      await waitFor(() => {
        expect(screen.getByText('concrete-slab.jpg')).toBeInTheDocument();
        expect(screen.queryByText('brick-wall.jpg')).not.toBeInTheDocument();
        expect(screen.queryByText('no-meta.jpg')).not.toBeInTheDocument();
      });
    });

    test('filters by specific metadata key', async () => {
      renderImageGallery({ images: metadataImages });

      const select = screen.getByDisplayValue('Filename');
      fireEvent.change(select, { target: { value: 'color' } });

      const searchInput = screen.getByPlaceholderText('Search by color...');
      fireEvent.change(searchInput, { target: { value: 'red' } });

      await waitFor(() => {
        expect(screen.getByText('brick-wall.jpg')).toBeInTheDocument();
        expect(screen.queryByText('concrete-slab.jpg')).not.toBeInTheDocument();
      });
    });

    test('populates metadata keys dropdown from both metadata and metadata_ fields', () => {
      renderImageGallery({ images: metadataImages });

      const select = screen.getByDisplayValue('Filename');
      const options = Array.from(select.querySelectorAll('option')).map(o => o.value);

      // Keys from metadata field (brick, color, location)
      expect(options).toContain('brick');
      expect(options).toContain('color');
      expect(options).toContain('location');
      // Keys from metadata_ field (concrete, color -- color already present)
      expect(options).toContain('concrete');
    });

    test('returns no images when metadata search has no matches', async () => {
      renderImageGallery({ images: metadataImages });

      const select = screen.getByDisplayValue('Filename');
      fireEvent.change(select, { target: { value: 'metadata' } });

      const searchInput = screen.getByPlaceholderText('Search by metadata...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent_value_xyz' } });

      await waitFor(() => {
        expect(screen.queryByText('brick-wall.jpg')).not.toBeInTheDocument();
        expect(screen.queryByText('concrete-slab.jpg')).not.toBeInTheDocument();
        expect(screen.queryByText('no-meta.jpg')).not.toBeInTheDocument();
      });
    });

    test('images without metadata are excluded from metadata search', async () => {
      renderImageGallery({ images: metadataImages });

      const select = screen.getByDisplayValue('Filename');
      fireEvent.change(select, { target: { value: 'metadata' } });

      const searchInput = screen.getByPlaceholderText('Search by metadata...');
      fireEvent.change(searchInput, { target: { value: 'true' } });

      await waitFor(() => {
        // Both images with metadata match (brick: true, concrete: true)
        expect(screen.getByText('brick-wall.jpg')).toBeInTheDocument();
        expect(screen.getByText('concrete-slab.jpg')).toBeInTheDocument();
        // Image without metadata is excluded
        expect(screen.queryByText('no-meta.jpg')).not.toBeInTheDocument();
      });
    });
  });

  describe('Multi-selection (Shift+Click and Ctrl+Click)', () => {
    const threeImages = [
      { id: 'img-a', filename: 'a.jpg', size_bytes: 100, created_at: '2023-01-01T00:00:00Z', deleted_at: null, storage_deleted: false },
      { id: 'img-b', filename: 'b.jpg', size_bytes: 200, created_at: '2023-01-02T00:00:00Z', deleted_at: null, storage_deleted: false },
      { id: 'img-c', filename: 'c.jpg', size_bytes: 300, created_at: '2023-01-03T00:00:00Z', deleted_at: null, storage_deleted: false },
    ];

    test('ctrl+click on image toggles selection without navigating', () => {
      renderImageGallery({ images: threeImages });

      const firstImage = screen.getByAltText('a.jpg').closest('.gallery-item-image');
      fireEvent.click(firstImage, { ctrlKey: true });

      expect(mockNavigate).not.toHaveBeenCalled();
      const item = screen.getByAltText('a.jpg').closest('.gallery-item');
      expect(item).toHaveClass('selected');
    });

    test('shift+click selects a range of images', () => {
      renderImageGallery({ images: threeImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      // Select first image
      fireEvent.click(checkboxes[0]);
      // Shift+click third image to select range
      fireEvent.click(checkboxes[2], { shiftKey: true });

      const items = document.querySelectorAll('.gallery-item');
      expect(items[0]).toHaveClass('selected');
      expect(items[1]).toHaveClass('selected');
      expect(items[2]).toHaveClass('selected');
    });

    test('ctrl+click on image area deselects already-selected image', () => {
      renderImageGallery({ images: threeImages });

      const firstImage = screen.getByAltText('a.jpg').closest('.gallery-item-image');
      fireEvent.click(firstImage, { ctrlKey: true });
      fireEvent.click(firstImage, { ctrlKey: true });

      const item = screen.getByAltText('a.jpg').closest('.gallery-item');
      expect(item).not.toHaveClass('selected');
    });

    test('shift+click on same page uses checkbox as anchor too', () => {
      renderImageGallery({ images: threeImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      // Select second image via checkbox
      fireEvent.click(checkboxes[1]);
      // Shift+click third image checkbox
      fireEvent.click(checkboxes[2], { shiftKey: true });

      const items = document.querySelectorAll('.gallery-item');
      expect(items[1]).toHaveClass('selected');
      expect(items[2]).toHaveClass('selected');
      expect(items[0]).not.toHaveClass('selected');
    });

    test('list view: ctrl+click on row selects without navigating', () => {
      renderImageGallery({ images: threeImages });

      fireEvent.click(screen.getByTitle('List view'));

      const rows = document.querySelectorAll('.gallery-list-row');
      fireEvent.click(rows[0], { ctrlKey: true });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(rows[0]).toHaveClass('selected');
    });

    test('list view: shift+click selects a range of rows', () => {
      renderImageGallery({ images: threeImages });

      fireEvent.click(screen.getByTitle('List view'));

      const rows = document.querySelectorAll('.gallery-list-row');
      // Select first row via checkbox
      const checkboxes = document.querySelectorAll('.gallery-list-cell-check .custom-check');
      fireEvent.click(checkboxes[0]);
      // Shift+click third row
      fireEvent.click(rows[2], { shiftKey: true });

      expect(rows[0]).toHaveClass('selected');
      expect(rows[1]).toHaveClass('selected');
      expect(rows[2]).toHaveClass('selected');
    });
  });

  describe('Bulk Actions', () => {
    const twoImages = [
      { id: 'ba-1', filename: 'bulk-a.jpg', size_bytes: 100, created_at: '2023-01-01T00:00:00Z', deleted_at: null, storage_deleted: false },
      { id: 'ba-2', filename: 'bulk-b.jpg', size_bytes: 200, created_at: '2023-01-02T00:00:00Z', deleted_at: null, storage_deleted: false },
    ];

    test('shows bulk action buttons when images are selected', () => {
      renderImageGallery({ images: twoImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);

      expect(screen.getByText(/Delete Selected/)).toBeInTheDocument();
      expect(screen.getByText('Add Metadata to Selected')).toBeInTheDocument();
      expect(screen.getByText('Clear Selection')).toBeInTheDocument();
    });

    test('opens bulk delete modal when Delete Selected is clicked', () => {
      renderImageGallery({ images: twoImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);

      fireEvent.click(screen.getByText(/Delete Selected/));

      expect(screen.getByText('Delete Selected Images')).toBeInTheDocument();
      expect(screen.getByLabelText('Reason (required)')).toBeInTheDocument();
    });

    test('bulk delete validates reason length', async () => {
      renderImageGallery({ images: twoImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(screen.getByText(/Delete Selected/));

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText(/Reason must be at least/)).toBeInTheDocument();
      });
    });

    test('bulk delete calls API for each selected image', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...twoImages[0], deleted_at: '2023-06-01T00:00:00Z' })
        })
      );

      const mockRefresh = jest.fn();
      renderImageGallery({ images: twoImages, refreshProjectImages: mockRefresh });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByText(/Delete Selected/));

      const reasonBox = screen.getByLabelText('Reason (required)');
      fireEvent.change(reasonBox, { target: { value: 'test bulk deletion reason' } });
      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/test-project-id/images/ba-1',
          expect.objectContaining({ method: 'DELETE' })
        );
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/test-project-id/images/ba-2',
          expect.objectContaining({ method: 'DELETE' })
        );
      });

      global.fetch.mockRestore();
    });

    test('opens bulk metadata modal when Add Metadata to Selected is clicked', () => {
      renderImageGallery({ images: twoImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);

      fireEvent.click(screen.getByText('Add Metadata to Selected'));

      expect(screen.getByText('Add Metadata to Selected Images')).toBeInTheDocument();
      expect(screen.getByLabelText('Key')).toBeInTheDocument();
    });

    test('bulk metadata validates key is not empty', async () => {
      renderImageGallery({ images: twoImages });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(screen.getByText('Add Metadata to Selected'));

      fireEvent.click(screen.getByText('Apply to All Selected'));

      await waitFor(() => {
        expect(screen.getByText(/Metadata key cannot be empty/)).toBeInTheDocument();
      });
    });

    test('bulk metadata calls API for each selected image', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...twoImages[0], metadata_: { inspector: 'alice' } })
        })
      );

      const mockRefresh = jest.fn();
      renderImageGallery({ images: twoImages, refreshProjectImages: mockRefresh });

      const checkboxes = document.querySelectorAll('.gallery-item-checkbox .custom-check');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByText('Add Metadata to Selected'));

      fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'inspector' } });
      fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByText('Apply to All Selected'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/images/ba-1/metadata',
          expect.objectContaining({ method: 'PUT' })
        );
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/images/ba-2/metadata',
          expect.objectContaining({ method: 'PUT' })
        );
      });

      global.fetch.mockRestore();
    });
  });

  describe('Restore Functionality', () => {
    test('calls handleRestore when restore button is clicked', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockDeletedImage, deleted_at: null })
        })
      );

      const mockOnImageUpdated = jest.fn();
      const mockRefreshProjectImages = jest.fn();
      
      renderImageGallery({ 
        images: [mockDeletedImage],
        onImageUpdated: mockOnImageUpdated,
        refreshProjectImages: mockRefreshProjectImages
      });
      
      const restoreButton = screen.getByText('Restore');
      fireEvent.click(restoreButton);
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/test-project-id/images/img-2/restore',
          { method: 'POST' }
        );
      });

      global.fetch.mockRestore();
    });
  });

  describe('List View', () => {
    test('switches to list view when list button is clicked', () => {
      renderImageGallery({ images: [mockRegularImage] });

      const listButton = screen.getByTitle('List view');
      fireEvent.click(listButton);

      expect(document.querySelector('.gallery-list')).toBeInTheDocument();
      expect(document.querySelector('.gallery-grid')).not.toBeInTheDocument();
    });

    test('list view shows filename column header and filename', () => {
      renderImageGallery({ images: [mockRegularImage] });

      fireEvent.click(screen.getByTitle('List view'));

      const headers = document.querySelectorAll('.gallery-list-header .gallery-list-cell');
      const headerTexts = Array.from(headers).map(h => h.textContent);
      expect(headerTexts).toContain('Filename');
      expect(headerTexts).toContain('Review Status');

      expect(screen.getAllByText('test-image.jpg').length).toBeGreaterThan(0);
    });

    test('list view shows metadata columns from image metadata', () => {
      renderImageGallery({ images: [mockImageWithMetadata] });

      fireEvent.click(screen.getByTitle('List view'));

      const headers = document.querySelectorAll('.gallery-list-header .gallery-list-cell');
      const headerTexts = Array.from(headers).map(h => h.textContent);
      expect(headerTexts).toContain('color');
      expect(headerTexts).toContain('location');
    });

    test('list view navigates to image on row click', () => {
      renderImageGallery({ images: [mockRegularImage] });

      fireEvent.click(screen.getByTitle('List view'));

      const row = document.querySelector('.gallery-list-row');
      fireEvent.click(row);

      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/view/img-1?project=test-project-id'));
    });

    test('list view shows deleted badge for deleted images', () => {
      renderImageGallery({ images: [mockDeletedImage] });

      fireEvent.click(screen.getByTitle('List view'));

      expect(screen.getByText('Deleted')).toBeInTheDocument();
    });

    test('list view row has deleted class for deleted images', () => {
      renderImageGallery({ images: [mockDeletedImage] });

      fireEvent.click(screen.getByTitle('List view'));

      const row = document.querySelector('.gallery-list-row');
      expect(row).toHaveClass('deleted');
    });

    test('list view supports checkbox selection', () => {
      renderImageGallery({ images: [mockRegularImage] });

      fireEvent.click(screen.getByTitle('List view'));

      const checkbox = document.querySelector('.gallery-list-cell-check .custom-check');
      expect(checkbox).toBeInTheDocument();
      fireEvent.click(checkbox);

      const row = document.querySelector('.gallery-list-row');
      expect(row).toHaveClass('selected');
    });

    test('list view excludes measurements key from metadata columns', () => {
      const imageWithMeasurements = {
        id: 'img-meas',
        filename: 'measured.jpg',
        size_bytes: 1024,
        created_at: '2023-01-01T00:00:00Z',
        deleted_at: null,
        storage_deleted: false,
        metadata: { color: 'blue', measurements: [{ id: 1, length: 42 }] }
      };
      renderImageGallery({ images: [imageWithMeasurements] });

      fireEvent.click(screen.getByTitle('List view'));

      const headers = document.querySelectorAll('.gallery-list-header .gallery-list-cell');
      const headerTexts = Array.from(headers).map(h => h.textContent);
      expect(headerTexts).toContain('color');
      expect(headerTexts).not.toContain('measurements');
    });
  });

  describe('State Persistence', () => {
    test('persists filter/sort state to localStorage on render', async () => {
      renderImageGallery();

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('gallery_state_test-project-id'));
        expect(stored).toMatchObject({
          viewMode: 'medium',
          sortBy: 'date',
          searchField: 'filename',
          searchValue: '',
          reviewFilter: 'all',
        });
        expect(typeof stored.lastAccessed).toBe('number');
      });
    });

    test('persists sort change to localStorage', async () => {
      renderImageGallery();

      const sortSelect = document.querySelector('.sort-select:not([title])');
      fireEvent.change(sortSelect, { target: { value: 'name' } });

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('gallery_state_test-project-id'));
        expect(stored.sortBy).toBe('name');
      });
    });

    test('persists search value to localStorage', async () => {
      renderImageGallery();

      const searchInput = screen.getByPlaceholderText('Search by filename...');
      fireEvent.change(searchInput, { target: { value: 'brick' } });

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('gallery_state_test-project-id'));
        expect(stored.searchValue).toBe('brick');
      });
    });

    test('persists view mode change to localStorage', async () => {
      renderImageGallery();

      fireEvent.click(screen.getByTitle('Small thumbnails'));

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('gallery_state_test-project-id'));
        expect(stored.viewMode).toBe('small');
      });
    });

    test('persists review filter change to localStorage', async () => {
      renderImageGallery();

      const reviewSelect = screen.getByTitle('Filter by review status');
      fireEvent.change(reviewSelect, { target: { value: 'pass' } });

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('gallery_state_test-project-id'));
        expect(stored.reviewFilter).toBe('pass');
      });
    });

    test('restores saved state from localStorage on mount', () => {
      localStorage.setItem('gallery_state_test-project-id', JSON.stringify({
        viewMode: 'large',
        sortBy: 'name',
        searchField: 'content_type',
        searchValue: 'png',
        reviewFilter: 'pass',
        lastAccessed: Date.now(),
      }));

      renderImageGallery();

      // Sort select should show 'name'
      const sortSelect = document.querySelector('.sort-select:not([title])');
      expect(sortSelect.value).toBe('name');

      // Search field should show 'content_type'
      const searchFieldSelect = document.querySelector('.search-field-select');
      expect(searchFieldSelect.value).toBe('content_type');

      // Search input should show 'png'
      const searchInput = screen.getByPlaceholderText('Search by content_type...');
      expect(searchInput.value).toBe('png');

      // Review filter should show 'pass'
      const reviewSelect = screen.getByTitle('Filter by review status');
      expect(reviewSelect.value).toBe('pass');

      // Large view mode button should be active
      const largeBtn = screen.getByTitle('Large thumbnails');
      expect(largeBtn).toHaveAttribute('aria-pressed', 'true');
    });

    test('uses galleryKey for localStorage when provided', async () => {
      renderImageGallery({ galleryKey: 'proj-1_group_g1' });

      await waitFor(() => {
        const stored = localStorage.getItem('gallery_state_proj-1_group_g1');
        expect(stored).toBeTruthy();
      });

      // Should not write to the projectId key
      expect(localStorage.getItem('gallery_state_test-project-id')).toBeNull();
    });

    test('falls back to defaults when localStorage contains invalid JSON', () => {
      localStorage.setItem('gallery_state_test-project-id', 'not valid json');

      renderImageGallery();

      // Should render with defaults without crashing
      const sortSelect = document.querySelector('.sort-select:not([title])');
      expect(sortSelect.value).toBe('date');
    });

    test('resets state when galleryKey prop changes', async () => {
      // Save different state for two different keys
      localStorage.setItem('gallery_state_proj-1_group_g1', JSON.stringify({
        viewMode: 'small',
        sortBy: 'name',
        searchField: 'filename',
        searchValue: 'alpha',
        reviewFilter: 'pass',
        lastAccessed: Date.now(),
      }));
      localStorage.setItem('gallery_state_proj-1_group_g2', JSON.stringify({
        viewMode: 'large',
        sortBy: 'size',
        searchField: 'content_type',
        searchValue: 'png',
        reviewFilter: 'unreviewed',
        lastAccessed: Date.now(),
      }));

      // Mount with key g1
      const { rerender } = render(
        <BrowserRouter>
          <ImageGallery
            projectId="proj-1"
            galleryKey="proj-1_group_g1"
            images={[mockRegularImage]}
            loading={false}
            onImageUpdated={jest.fn()}
            refreshProjectImages={jest.fn()}
          />
        </BrowserRouter>
      );

      // Verify g1 state is loaded
      await waitFor(() => {
        expect(document.querySelector('.sort-select:not([title])').value).toBe('name');
      });

      // Re-render with key g2
      rerender(
        <BrowserRouter>
          <ImageGallery
            projectId="proj-1"
            galleryKey="proj-1_group_g2"
            images={[mockRegularImage]}
            loading={false}
            onImageUpdated={jest.fn()}
            refreshProjectImages={jest.fn()}
          />
        </BrowserRouter>
      );

      // Verify g2 state is loaded after key change
      await waitFor(() => {
        expect(document.querySelector('.sort-select:not([title])').value).toBe('size');
        expect(screen.getByTitle('Filter by review status').value).toBe('unreviewed');
      });
    });

    test('resets to defaults when galleryKey changes to a key with no saved state', async () => {
      localStorage.setItem('gallery_state_proj-1_group_g1', JSON.stringify({
        viewMode: 'small',
        sortBy: 'name',
        searchField: 'filename',
        searchValue: 'test',
        reviewFilter: 'pass',
        lastAccessed: Date.now(),
      }));

      const { rerender } = render(
        <BrowserRouter>
          <ImageGallery
            projectId="proj-1"
            galleryKey="proj-1_group_g1"
            images={[mockRegularImage]}
            loading={false}
            onImageUpdated={jest.fn()}
            refreshProjectImages={jest.fn()}
          />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(document.querySelector('.sort-select:not([title])').value).toBe('name');
      });

      // Switch to a key that has no saved state
      rerender(
        <BrowserRouter>
          <ImageGallery
            projectId="proj-1"
            galleryKey="proj-1_group_new"
            images={[mockRegularImage]}
            loading={false}
            onImageUpdated={jest.fn()}
            refreshProjectImages={jest.fn()}
          />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(document.querySelector('.sort-select:not([title])').value).toBe('date');
        expect(screen.getByTitle('Filter by review status').value).toBe('all');
      });
    });

    test('includes galleryKey in navigation URL', () => {
      renderImageGallery({ galleryKey: 'proj-1_group_g1' });

      const imageContainer = screen.getByAltText('test-image.jpg').closest('.gallery-item-image');
      fireEvent.click(imageContainer);

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('galleryKey=proj-1_group_g1')
      );
    });

    test('includes projectId as galleryKey when no explicit galleryKey prop', () => {
      renderImageGallery();

      const imageContainer = screen.getByAltText('test-image.jpg').closest('.gallery-item-image');
      fireEvent.click(imageContainer);

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('galleryKey=test-project-id')
      );
    });
  });
});