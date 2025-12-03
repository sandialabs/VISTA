import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import './App.css';

// Import components
import ImageDisplay from './components/ImageDisplay';
import ImageMetadata from './components/ImageMetadata';
import CompactImageClassifications from './components/CompactImageClassifications';
import ImageComments from './components/ImageComments';
import ImageDeletionControls from './components/ImageDeletionControls';
import MLAnalysisPanel from './components/MLAnalysisPanel';
import OverlayControls from './components/OverlayControls';
import MLDebugOutputs from './components/MLDebugOutputs';

function ImageView() {
  const { imageId } = useParams();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const navigate = useNavigate();

  // State variables
  const [image, setImage] = useState(null);
  const [projectImages, setProjectImages] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [isResizing, setIsResizing] = useState(false);

  // Navigation settings - restore from localStorage
  const [skipDeletedImages, setSkipDeletedImages] = useState(() => {
    const saved = localStorage.getItem('skipDeletedImages');
    return saved !== null ? JSON.parse(saved) : true; // Default to true (skip deleted)
  });

  // ML Analysis state - restore from localStorage if available
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [selectedAnnotations, setSelectedAnnotations] = useState([]);
  const [overlayOptions, setOverlayOptions] = useState(() => {
    const saved = localStorage.getItem('mlOverlayOptions');
    if (saved) {
      try {
        return { ...JSON.parse(saved), bitmapAvailable: false };
      } catch (e) {
        console.error('Failed to parse saved overlay options:', e);
      }
    }
    return {
      showBoxes: true,
      showHeatmap: false,
      opacity: 0.7,
      viewMode: 'overlay',
      bitmapAvailable: false
    };
  });
  const [autoSelectLatest, setAutoSelectLatest] = useState(() => {
    const saved = localStorage.getItem('mlAutoSelectLatest');
    return saved === 'true' || saved === null; // Default to true
  });

  // ML analysis selection handler
  const handleMLAnalysisSelect = useCallback((data) => {
    if (data && data.analysis) {
      setSelectedAnalysis(data.analysis);
      setSelectedAnnotations(data.annotations || []);
      // Check if any bitmap artifacts are available (heatmap, segmentation, mask)
      const hasBitmap = (data.annotations || []).some(a =>
        a.storage_path && ['heatmap', 'segmentation', 'mask'].includes(a.annotation_type)
      );
      setOverlayOptions(prev => ({ ...prev, bitmapAvailable: hasBitmap }));
    } else {
      setSelectedAnalysis(null);
      setSelectedAnnotations([]);
      setOverlayOptions(prev => ({ ...prev, bitmapAvailable: false }));
    }
  }, []);

  // Load image data
  const loadImageData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Try to fetch image metadata directly first
      let response = await fetch(`/api/images/${imageId}`);
      
      if (!response.ok) {
        // If direct fetch fails (likely because image is deleted), 
        // try to find it through the project endpoint with deleted images included
        console.log('Direct image fetch failed, trying project endpoint with deleted images...');
        const projectResponse = await fetch(`/api/projects/${projectId}/images?include_deleted=true`);
        
        if (!projectResponse.ok) {
          throw new Error(`Failed to fetch project images: ${projectResponse.status}`);
        }
        
        const projectImages = await projectResponse.json();
        const imageData = projectImages.find(img => img.id === imageId);
        
        if (!imageData) {
          throw new Error('Image not found in project');
        }
        
        setImage(imageData);
        // Update document title
        document.title = `${imageData.filename || 'Image'} - Image Manager`;
      } else {
        const imageData = await response.json();
        setImage(imageData);
        // Update document title
        document.title = `${imageData.filename || 'Image'} - Image Manager`;
      }
      
    } catch (error) {
      console.error('Error loading image data:', error);
      setError('Failed to load image. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [imageId, projectId]);

  // Load project images for navigation
  const loadProjectImages = useCallback(async () => {
    try {
      console.log('Fetching images for project:', projectId);
      const response = await fetch(`/api/projects/${projectId}/images?include_deleted=true`);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const images = await response.json();

      if (!Array.isArray(images)) {
        console.error('Server response is not an array:', images);
        throw new Error('Invalid server response: expected an array of images');
      }

      // Sort images by date (newest first) to match the gallery default sorting
      // Use spread operator to avoid mutating the original array
      const sortedImages = [...images].sort((a, b) => {
        return new Date(b.created_at || '1970-01-01') - new Date(a.created_at || '1970-01-01');
      });

      setProjectImages(sortedImages);

      // Find the index of the current image in the sorted array
      const index = sortedImages.findIndex(img => img.id === imageId);
      setCurrentImageIndex(index);

    } catch (error) {
      console.error('Error loading project images:', error);
      setError('Failed to load project images for navigation. Please try again later.');
    }
  }, [projectId, imageId]);

  // Save skip deleted preference to localStorage
  useEffect(() => {
    localStorage.setItem('skipDeletedImages', JSON.stringify(skipDeletedImages));
  }, [skipDeletedImages]);

  // Load classes for the project
  const loadClasses = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/classes`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const classesData = await response.json();
      setClasses(classesData);
      
    } catch (error) {
      console.error('Error loading classes:', error);
      setError('Failed to load classes. Please try again later.');
    }
  }, [projectId]);

  // Initialize data on component mount
  useEffect(() => {
    if (!imageId || !projectId) {
      setError('Image ID or Project ID is missing.');
      return;
    }
    
    // Fetch the current user
    fetch('/api/users/me')
      .then(response => {
        if (!response.ok) {
          // If we get a 401, it's expected when authentication is disabled
          if (response.status === 401) {
            console.log("Authentication is disabled or user is not logged in");
            return null;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(userData => {
        if (userData) {
          setCurrentUser(userData);
        }
      })
      .catch(err => {
        console.error("Failed to fetch current user:", err);
      });
    
    loadImageData();
    loadProjectImages();
    loadClasses();
  }, [imageId, projectId, loadImageData, loadProjectImages, loadClasses]);

  // Navigate to previous image with transition
  const navigateToPreviousImage = useCallback(() => {
    let targetIndex = currentImageIndex - 1;

    // Skip deleted images if option is enabled
    if (skipDeletedImages) {
      while (targetIndex >= 0 && projectImages[targetIndex]?.deleted_at) {
        targetIndex--;
      }
    }

    if (targetIndex >= 0) {
      setIsTransitioning(true);
      setTimeout(() => {
        const prevImage = projectImages[targetIndex];
        navigate(`/view/${prevImage.id}?project=${projectId}`);
      }, 300);
    }
  }, [currentImageIndex, projectImages, navigate, projectId, skipDeletedImages]);

  // Navigate to next image with transition
  const navigateToNextImage = useCallback(() => {
    let targetIndex = currentImageIndex + 1;

    // Skip deleted images if option is enabled
    if (skipDeletedImages) {
      while (targetIndex < projectImages.length && projectImages[targetIndex]?.deleted_at) {
        targetIndex++;
      }
    }

    if (targetIndex < projectImages.length) {
      setIsTransitioning(true);
      setTimeout(() => {
        const nextImage = projectImages[targetIndex];
        navigate(`/view/${nextImage.id}?project=${projectId}`);
      }, 300);
    }
  }, [currentImageIndex, projectImages, navigate, projectId, skipDeletedImages]);

  // Reset transition state when image changes (but keep ML settings)
  useEffect(() => {
    setIsTransitioning(false);
    // Clear selected analysis so MLAnalysisPanel can auto-select latest if enabled
    setSelectedAnalysis(null);
    setSelectedAnnotations([]);
    setOverlayOptions(prev => ({
      ...prev,
      bitmapAvailable: false
    }));
  }, [imageId]);

  // Save overlay options to localStorage when they change
  useEffect(() => {
    const { bitmapAvailable, ...persistentOptions } = overlayOptions;
    localStorage.setItem('mlOverlayOptions', JSON.stringify(persistentOptions));
  }, [overlayOptions]);

  // Save auto-select preference to localStorage
  useEffect(() => {
    localStorage.setItem('mlAutoSelectLatest', autoSelectLatest.toString());
  }, [autoSelectLatest]);

  // Handle resize functionality
  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;

    const newWidth = e.clientX;
    const minWidth = 250;
    const maxWidth = window.innerWidth * 0.6; // Max 60% of screen width

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add global mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);


  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        navigateToPreviousImage();
      } else if (e.key === 'ArrowRight') {
        navigateToNextImage();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentImageIndex, projectImages.length, navigateToNextImage, navigateToPreviousImage]);

  return (
    <div className="App" style={{ maxWidth: '100%', padding: '0' }}>
      <header className="view-header-compact">
        <div className="view-header-content">
          <button
            className="btn btn-secondary btn-small"
            onClick={() => navigate(`/project/${projectId}`)}
          >
            ← Back
          </button>
          <span className="view-filename">{image ? image.filename : 'Loading...'}</span>
          {currentUser && (
            <span className="view-user-info">{currentUser.email}</span>
          )}
        </div>
      </header>

      <div className="container" style={{ maxWidth: '100%', padding: 'var(--space-4)' }}>
        {error && (
          <div className="alert alert-error">
            {error}
            <button 
              className="close-alert"
              onClick={() => setError(null)}
            >
              &times;
            </button>
          </div>
        )}
        
        <div className="image-view-container">
          <div className="image-view-main">
            {/* Left sidebar with classification controls, metadata, and comments */}
            <div
              className="image-view-sidebar"
              style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
            >
              {/* Classification controls at the top of sidebar */}
              <CompactImageClassifications
                imageId={imageId}
                classes={classes}
                loading={loading}
                setLoading={setLoading}
                setError={setError}
              />


              <ImageComments
                imageId={imageId}
                loading={loading}
                setLoading={setLoading}
                setError={setError}
              />

              <ImageMetadata
                imageId={imageId}
                image={image}
                setImage={setImage}
                loading={loading}
                setLoading={setLoading}
                setError={setError}
              />

              {/* ML Analysis Panel (read-only, only visible when analyses exist) */}
              {image && (
                <MLAnalysisPanel
                  key={imageId}
                  imageId={imageId}
                  onSelect={handleMLAnalysisSelect}
                  autoSelectLatest={autoSelectLatest}
                  onAutoSelectChange={setAutoSelectLatest}
                />
              )}

              {/* Overlay controls (only visible when an analysis is selected) */}
              {selectedAnalysis && (
                <OverlayControls
                  options={overlayOptions}
                  onChange={setOverlayOptions}
                />
              )}
            </div>

            {/* Resizable divider */}
            <div
              className="resize-divider"
              onMouseDown={handleMouseDown}
              style={{ cursor: isResizing ? 'ew-resize' : 'ew-resize' }}
            >
              <div className="resize-handle"></div>
            </div>

            {/* Right side with image display */}
            <div className="image-view-content">
              <ImageDisplay
                imageId={imageId}
                image={image}
                isTransitioning={isTransitioning}
                projectId={projectId}
                setImage={setImage}
                refreshProjectImages={loadProjectImages}
                navigateToPreviousImage={navigateToPreviousImage}
                navigateToNextImage={navigateToNextImage}
                currentImageIndex={currentImageIndex}
                projectImages={projectImages}
                selectedAnalysis={selectedAnalysis}
                annotations={selectedAnnotations}
                overlayOptions={overlayOptions}
              />
            </div>
          </div>

          {/* Keep deletion controls at the bottom for all to see */}
          <ImageDeletionControls
            projectId={projectId}
            image={image}
            setImage={setImage}
            refreshProjectImages={loadProjectImages}
          />

          {/* Navigation settings */}
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'var(--bg-secondary, #f8f9fa)',
            borderRadius: '6px',
            border: '1px solid var(--border-color, #dee2e6)'
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9rem',
              cursor: 'pointer',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={skipDeletedImages}
                onChange={(e) => setSkipDeletedImages(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Skip deleted images when navigating (arrow keys)</span>
            </label>
            <div style={{
              marginTop: '0.5rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted, #6c757d)',
              paddingLeft: '1.5rem'
            }}>
              When enabled, arrow key navigation will automatically skip over soft-deleted images.
            </div>
          </div>

          {/* Debug ML outputs section */}
          {imageId && (
            <div style={{ marginTop: '1rem' }}>
              <MLDebugOutputs imageId={imageId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImageView;
