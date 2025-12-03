import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImageDisplay from './ImageDisplay';

describe('ImageDisplay Component - Basic Tests', () => {
  const mockImage = {
    id: 'test-image-123',
    filename: 'test.jpg',
    width: 1920,
    height: 1080,
    deleted_at: null
  };

  const defaultProps = {
    imageId: 'test-image-123',
    image: mockImage,
    isTransitioning: false,
    projectId: 'project-123',
    setImage: jest.fn(),
    refreshProjectImages: jest.fn(),
    navigateToPreviousImage: jest.fn(),
    navigateToNextImage: jest.fn(),
    currentImageIndex: 0,
    projectImages: [mockImage],
    selectedAnalysis: null,
    annotations: [],
    overlayOptions: {
      showBoxes: false,
      showHeatmap: false,
      opacity: 0.7,
      viewMode: 'overlay',
      bitmapAvailable: false
    }
  };

  // Test 1: Component renders without crashing
  test('1. renders without crashing', () => {
    render(<ImageDisplay {...defaultProps} />);
    expect(screen.getByAltText('test.jpg')).toBeInTheDocument();
  });

  // Test 2: Displays correct image source
  test('2. displays correct image source', () => {
    render(<ImageDisplay {...defaultProps} />);
    const img = screen.getByAltText('test.jpg');
    expect(img).toHaveAttribute('src', '/api/images/test-image-123/content');
  });

  // Test 3: Shows loading state when image is null
  test('3. shows loading state when image is null', () => {
    render(<ImageDisplay {...defaultProps} image={null} />);
    expect(screen.getByText('Loading image...')).toBeInTheDocument();
  });

  // Test 4: Renders navigation buttons
  test('4. renders navigation buttons', () => {
    render(<ImageDisplay {...defaultProps} />);
    expect(screen.getByText('← Prev')).toBeInTheDocument();
    expect(screen.getByText('Next →')).toBeInTheDocument();
  });

  // Test 5: Renders zoom controls
  test('5. renders zoom controls', () => {
    render(<ImageDisplay {...defaultProps} />);
    expect(screen.getByText('Zoom In')).toBeInTheDocument();
    expect(screen.getByText('Zoom Out')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  // Test 6: Renders download button
  test('6. renders download button', () => {
    render(<ImageDisplay {...defaultProps} />);
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  // Test 7: Renders delete button for non-deleted images
  test('7. renders delete button for non-deleted images', () => {
    render(<ImageDisplay {...defaultProps} />);
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  // Test 8: Does NOT render overlays when annotations are empty
  test('8. does not render overlays when annotations are empty', () => {
    render(<ImageDisplay {...defaultProps} annotations={[]} />);
    const overlays = document.querySelectorAll('.heatmap-overlay');
    expect(overlays.length).toBe(0);
  });

  // Test 9: Renders single image in overlay mode
  test('9. renders single image in overlay mode', () => {
    render(<ImageDisplay {...defaultProps} />);
    const images = screen.getAllByAltText('test.jpg');
    expect(images.length).toBe(1);
  });

  // Test 10: Renders two images in side-by-side mode
  test('10. renders two images in side-by-side mode when bitmap available', () => {
    const sideBySideProps = {
      ...defaultProps,
      overlayOptions: {
        ...defaultProps.overlayOptions,
        viewMode: 'side-by-side',
        bitmapAvailable: true
      }
    };
    render(<ImageDisplay {...sideBySideProps} />);
    const images = screen.getAllByAltText('test.jpg');
    expect(images.length).toBe(2);
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('ML Overlay')).toBeInTheDocument();
  });
});
