import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import CalibrationManager from './components/CalibrationManager';
import MeasurementList from './components/MeasurementList';
import MeasurementPanel from './components/MeasurementPanel';
import AnnotationMeasurementTabs from './components/AnnotationMeasurementTabs';
import ReviewPanel from './components/ReviewPanel';
import ImageGroupPanel from './components/ImageGroupPanel';
import { loadGalleryState, applyGalleryFilters, sortImages } from './utils/galleryState';
import UserAnnotationPanel from './components/UserAnnotationPanel';
import AnnotationToolbar from './components/AnnotationToolbar';
import AnnotationReviewControls from './components/AnnotationReviewControls';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';

// Custom hooks
import useAnnotations from './hooks/useAnnotations';
import useMeasurements from './hooks/useMeasurements';

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
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Navigation settings - restore from localStorage
  const [skipDeletedImages, setSkipDeletedImages] = useState(() => {
    const saved = localStorage.getItem('skipDeletedImages');
    return saved !== null ? JSON.parse(saved) : true;
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
    return saved === 'true' || saved === null;
  });

  // Custom hooks for measurements and annotations
  // Use refs to break circular dependency between the two hooks
  const selectMeasurementRef = useRef(null);
  const measurementHook = useMeasurements(imageId, setImage, setError);
  const annotationHook = useAnnotations(imageId, projectId, setError, {
    measurements: measurementHook.measurements,
    selectedMeasurementId: measurementHook.selectedMeasurementId,
    onSelectMeasurement: (...args) => selectMeasurementRef.current?.(...args),
    onDeleteMeasurement: measurementHook.handleDeleteMeasurement,
  });

  // Cross-deselection: selecting one type clears the other
  const handleSelectAnnotation = useCallback((id) => {
    annotationHook.setSelectedAnnotationId(id);
    if (id != null) measurementHook.setSelectedMeasurementId(null);
  }, [annotationHook.setSelectedAnnotationId, measurementHook.setSelectedMeasurementId]);

  const handleSelectMeasurement = useCallback((id) => {
    measurementHook.setSelectedMeasurementId(id);
    if (id != null) annotationHook.setSelectedAnnotationId(null);
  }, [measurementHook.setSelectedMeasurementId, annotationHook.setSelectedAnnotationId]);

  selectMeasurementRef.current = handleSelectMeasurement;

  // ML analysis selection handler
  const handleMLAnalysisSelect = useCallback((data) => {
    if (data && data.analysis) {
      setSelectedAnalysis(data.analysis);
      setSelectedAnnotations(data.annotations || []);
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
      let response = await fetch(`/api/images/${imageId}`);
      if (!response.ok) {
        console.log('Direct image fetch failed, trying project endpoint with deleted images...');
        const projectResponse = await fetch(`/api/projects/${projectId}/images?include_deleted=true`);
        if (!projectResponse.ok) {
          throw new Error(`Failed to fetch project images: ${projectResponse.status}`);
        }
        const projImages = await projectResponse.json();
        const imageData = projImages.find(img => img.id === imageId);
        if (!imageData) {
          throw new Error('Image not found in project');
        }
        setImage(imageData);
        document.title = `${imageData.filename || 'Image'} - Image Manager`;
      } else {
        const imageData = await response.json();
        setImage(imageData);
        document.title = `${imageData.filename || 'Image'} - Image Manager`;
      }
    } catch (err) {
      console.error('Error loading image data:', err);
      setError('Failed to load image. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [imageId, projectId]);

  // Load project images for navigation
  const loadProjectImages = useCallback(async (groupId) => {
    try {
      const params = new URLSearchParams({ include_deleted: 'true' });
      const urlGalleryKey = searchParams.get('galleryKey');
      const isUngroupedGallery = urlGalleryKey && urlGalleryKey.endsWith('_ungrouped');

      if (isUngroupedGallery) {
        params.set('ungrouped', 'true');
      } else if (groupId) {
        params.set('group_id', groupId);
      }
      const response = await fetch(`/api/projects/${projectId}/images?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const images = await response.json();

      if (!Array.isArray(images)) {
        console.error('Server response is not an array:', images);
        throw new Error('Invalid server response: expected an array of images');
      }

      let galleryStateKey;
      if (urlGalleryKey) {
        galleryStateKey = urlGalleryKey;
      } else if (groupId) {
        galleryStateKey = `${projectId}_group_${groupId}`;
      } else {
        galleryStateKey = projectId;
      }

      let navImages;
      try {
        const galleryState = loadGalleryState(galleryStateKey);

        let reviewStatuses = null;
        if (galleryState.reviewFilter && galleryState.reviewFilter !== 'all') {
          try {
            const reviewResp = await fetch(`/api/projects/${projectId}/image-review-statuses`);
            if (reviewResp.ok) {
              reviewStatuses = await reviewResp.json();
            } else {
              console.warn('Non-OK response when loading review statuses for navigation filter:', reviewResp.status);
            }
          } catch (e) {
            console.warn('Failed to load review statuses for navigation filter:', e);
          }
        }

        const effectiveGalleryState =
          reviewStatuses != null
            ? { ...galleryState, reviewStatuses }
            : { ...galleryState, reviewFilter: 'all', reviewStatuses: null };

        navImages = applyGalleryFilters(images, effectiveGalleryState);
      } catch (e) {
        navImages = sortImages(images, 'date');
      }

      setProjectImages(navImages);

      const index = navImages.findIndex(img => img.id === imageId);
      setCurrentImageIndex(index);
    } catch (err) {
      console.error('Error loading project images:', err);
      setError('Failed to load project images for navigation. Please try again later.');
    }
  }, [projectId, imageId, searchParams]);

  useEffect(() => { localStorage.setItem('skipDeletedImages', JSON.stringify(skipDeletedImages)); }, [skipDeletedImages]);
  const loadClasses = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/classes`);
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const classesData = await response.json();
      setClasses(classesData);
    } catch (err) {
      console.error('Error loading classes:', err);
      setError('Failed to load classes. Please try again later.');
    }
  }, [projectId]);

  // Initialize data on component mount
  useEffect(() => {
    if (!imageId || !projectId) {
      setError('Image ID or Project ID is missing.');
      return;
    }
    fetch('/api/users/me')
      .then(response => {
        if (!response.ok) {
          if (response.status === 401) return null;
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(userData => { if (userData) setCurrentUser(userData); })
      .catch(err => console.error('Failed to fetch current user:', err));

    loadImageData();
    loadClasses();
    annotationHook.loadBBoxClasses();
  }, [imageId, projectId, loadImageData, loadClasses, annotationHook.loadBBoxClasses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load project images for navigation once we know the current image's group
  useEffect(() => {
    if (image && projectId) {
      loadProjectImages(image.group_id || null);
    }
  }, [image?.id, image?.group_id, projectId, loadProjectImages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build query string for navigation, preserving galleryKey if present
  const buildNavQuery = useCallback(() => {
    const params = new URLSearchParams({ project: projectId });
    const galleryKey = searchParams.get('galleryKey');
    if (galleryKey) params.set('galleryKey', galleryKey);
    return params.toString();
  }, [projectId, searchParams]);
  useEffect(() => {
    annotationHook.loadUserAnnotations();
  }, [imageId, annotationHook.loadUserAnnotations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to previous image
  const navigateToPreviousImage = useCallback(() => {
    let targetIndex = currentImageIndex - 1;
    if (skipDeletedImages) {
      while (targetIndex >= 0 && projectImages[targetIndex]?.deleted_at) targetIndex--;
    }
    if (targetIndex >= 0) {
      setIsTransitioning(true);
      setTimeout(() => {
        const prevImage = projectImages[targetIndex];
        navigate(`/view/${prevImage.id}?${buildNavQuery()}`);
      }, 300);
    }
  }, [currentImageIndex, projectImages, navigate, buildNavQuery, skipDeletedImages]);

  // Navigate to next image
  const navigateToNextImage = useCallback(() => {
    let targetIndex = currentImageIndex + 1;
    if (skipDeletedImages) {
      while (targetIndex < projectImages.length && projectImages[targetIndex]?.deleted_at) targetIndex++;
    }
    if (targetIndex < projectImages.length) {
      setIsTransitioning(true);
      setTimeout(() => {
        const nextImage = projectImages[targetIndex];
        navigate(`/view/${nextImage.id}?${buildNavQuery()}`);
      }, 300);
    }
  }, [currentImageIndex, projectImages, navigate, buildNavQuery, skipDeletedImages]);

  // Reset transition state when image changes
  useEffect(() => {
    setIsTransitioning(false);
    setSelectedAnalysis(null);
    setSelectedAnnotations([]);
    setOverlayOptions(prev => ({ ...prev, bitmapAvailable: false }));
    measurementHook.setMeasurementActive(false);
    measurementHook.setSelectedMeasurementId(null);
    annotationHook.setAnnotationMode(false);
    annotationHook.setSelectedAnnotationId(null);
  }, [imageId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Load measurements when image changes
  useEffect(() => {
    const metadata = image?.metadata || image?.metadata_;
    if (metadata?.measurements) {
      measurementHook.setMeasurements(metadata.measurements);
      measurementHook.setVisibleMeasurementIds(metadata.measurements.map(m => m.id));
    } else {
      measurementHook.setMeasurements([]);
      measurementHook.setVisibleMeasurementIds(null);
    }
  }, [imageId, image]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { bitmapAvailable, ...persistentOptions } = overlayOptions;
    localStorage.setItem('mlOverlayOptions', JSON.stringify(persistentOptions));
  }, [overlayOptions]);
  useEffect(() => { localStorage.setItem('mlAutoSelectLatest', autoSelectLatest.toString()); }, [autoSelectLatest]);
  // Sidebar resize
  const handleMouseDown = useCallback(() => setIsResizing(true), []);
  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 250 && newWidth <= window.innerWidth * 0.6) setSidebarWidth(newWidth);
  }, [isResizing]);
  const handleMouseUp = useCallback(() => setIsResizing(false), []);

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

  // Sync: when entering measure mode via toolbar, clear standalone measurementActive
  // When entering other modes, ensure no conflict with measurement tool
  useEffect(() => {
    if (annotationHook.measureMode) {
      measurementHook.setMeasurementActive(false);
    }
  }, [annotationHook.measureMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation and help toggle
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') navigateToPreviousImage();
      else if (e.key === 'ArrowRight') navigateToNextImage();
      else if (e.key === '?') setShowShortcutsHelp(prev => !prev);
      else if (e.key === 'c') {
        const el = document.getElementById('image-comments-section');
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ta = el.querySelector('textarea');
        if (ta) setTimeout(() => ta.focus(), 300);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigateToNextImage, navigateToPreviousImage]);

  return (
    <div className="App" style={{ maxWidth: '100%', padding: '0' }}>
      <header className="view-header-compact">
        <div className="view-header-content">
          <button
            className="btn btn-secondary btn-small"
            onClick={() => {
              if (image && image.group_id) {
                navigate(`/project/${projectId}/group/${image.group_id}`);
              } else {
                navigate(`/project/${projectId}`);
              }
            }}
          >
            &larr; Back
          </button>
          <span className="view-filename">{image ? image.filename : 'Loading...'}</span>
          {currentUser && <span className="view-user-info">{currentUser.email}</span>}
        </div>
      </header>

      <div className="container" style={{ maxWidth: '100%', padding: 'var(--space-4)' }}>
        {error && (
          <div className="alert alert-error">
            {error}
            <button className="close-alert" onClick={() => setError(null)}>&times;</button>
          </div>
        )}

        <div className="image-view-container">
          <div className="image-view-main">
            <div className="image-view-sidebar" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
              {image && <ReviewPanel imageId={imageId} />}
              {image && (
                <AnnotationToolbar
                  interactionMode={annotationHook.interactionMode}
                  onModeChange={annotationHook.setInteractionMode}
                  bboxClasses={annotationHook.bboxClasses}
                  activeClassId={annotationHook.activeClassId}
                  onActiveClassChange={annotationHook.setActiveClassId}
                  showUserAnnotations={annotationHook.showUserAnnotations}
                  onToggleShowAnnotations={() => annotationHook.setShowUserAnnotations(prev => !prev)}
                  selectedAnnotationId={annotationHook.selectedAnnotationId}
                  onDeleteSelected={annotationHook.handleDeleteSelected}
                />
              )}
              {image && (
                <AnnotationMeasurementTabs
                  interactionMode={annotationHook.interactionMode}
                  imageId={imageId} projectId={projectId}
                  bboxClasses={annotationHook.bboxClasses}
                  annotations={annotationHook.userAnnotations}
                  onAnnotationsChange={annotationHook.loadUserAnnotations}
                  selectedAnnotationId={annotationHook.selectedAnnotationId}
                  onSelectAnnotation={handleSelectAnnotation}
                  hoveredAnnotationId={annotationHook.hoveredAnnotationId}
                  onHoverAnnotation={annotationHook.setHoveredAnnotationId}
                  measurements={measurementHook.measurements}
                  calibration={measurementHook.calibration}
                  selectedMeasurementId={measurementHook.selectedMeasurementId}
                  onSelectMeasurement={handleSelectMeasurement}
                  onDeleteMeasurement={measurementHook.handleDeleteMeasurement}
                  onRenameMeasurement={measurementHook.handleRenameMeasurement}
                  onToggleVisibility={measurementHook.handleToggleVisibility}
                  visibleMeasurementIds={measurementHook.visibleMeasurementIds}
                />
              )}
              {annotationHook.selectedAnnotationId && (
                <AnnotationReviewControls
                  annotationId={annotationHook.selectedAnnotationId}
                  onReviewComplete={annotationHook.loadUserAnnotations}
                />
              )}
              {image && projectId && (
                <ImageGroupPanel
                  imageId={imageId}
                  projectId={projectId}
                  groupId={image.group_id || null}
                  onGroupChanged={(newGroupId) => {
                    setImage(prev => prev ? { ...prev, group_id: newGroupId } : prev);
                  }}
                />
              )}
              <CompactImageClassifications imageId={imageId} classes={classes} loading={loading} setLoading={setLoading} setError={setError} />
              <ImageComments imageId={imageId} loading={loading} setLoading={setLoading} setError={setError} />
              <ImageMetadata imageId={imageId} image={image} setImage={setImage} loading={loading} setLoading={setLoading} setError={setError} />
              {image && (
                <CalibrationManager projectId={projectId} imageId={imageId} image={image} onCalibrationChange={measurementHook.setCalibration} />
              )}
              {image && (
                <MLAnalysisPanel key={imageId} imageId={imageId} onSelect={handleMLAnalysisSelect} autoSelectLatest={autoSelectLatest} onAutoSelectChange={setAutoSelectLatest} />
              )}
              {selectedAnalysis && <OverlayControls options={overlayOptions} onChange={setOverlayOptions} />}
            </div>

            <div className="resize-divider" onMouseDown={handleMouseDown} style={{ cursor: 'ew-resize' }}>
              <div className="resize-handle"></div>
            </div>

            <div className="image-view-content">
              <ImageDisplay
                imageId={imageId} image={image} isTransitioning={isTransitioning}
                projectId={projectId} setImage={setImage} refreshProjectImages={loadProjectImages}
                navigateToPreviousImage={navigateToPreviousImage} navigateToNextImage={navigateToNextImage}
                currentImageIndex={currentImageIndex} projectImages={projectImages}
                selectedAnalysis={selectedAnalysis} annotations={selectedAnnotations} overlayOptions={overlayOptions}
                calibration={measurementHook.calibration} measurements={measurementHook.measurements}
                measurementActive={measurementHook.measurementActive} setMeasurementActive={measurementHook.setMeasurementActive}
                onSaveMeasurement={measurementHook.handleSaveMeasurement}
                selectedMeasurementId={measurementHook.selectedMeasurementId}
                visibleMeasurementIds={measurementHook.visibleMeasurementIds}
                userAnnotations={annotationHook.userAnnotations}
                showUserAnnotations={annotationHook.showUserAnnotations}
                annotationMode={annotationHook.annotationMode}
                selectMode={annotationHook.selectMode}
                interactionMode={annotationHook.interactionMode}
                activeClassColor={annotationHook.bboxClasses.find(c => c.id === annotationHook.activeClassId)?.color || '#FF9800'}
                selectedAnnotationId={annotationHook.selectedAnnotationId}
                hoveredAnnotationId={annotationHook.hoveredAnnotationId}
                onSelectAnnotation={handleSelectAnnotation}
                onSelectMeasurement={handleSelectMeasurement}
                onAnnotationCreated={annotationHook.handleAnnotationCreated}
                onAnnotationUpdate={annotationHook.handleAnnotationUpdate}
                onToggleAnnotationMode={() => annotationHook.setAnnotationMode(prev => !prev)}
              />
            </div>
          </div>

          <ImageDeletionControls projectId={projectId} image={image} setImage={setImage} refreshProjectImages={loadProjectImages} />
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: '6px', border: '1px solid var(--border-color, #dee2e6)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={skipDeletedImages} onChange={(e) => setSkipDeletedImages(e.target.checked)} style={{ cursor: 'pointer' }} />
              <span>Skip deleted images when navigating (arrow keys)</span>
            </label>
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted, #6c757d)', paddingLeft: '1.5rem' }}>
              When enabled, arrow key navigation will automatically skip over soft-deleted images.
            </div>
          </div>
          {imageId && <div style={{ marginTop: '1rem' }}><MLDebugOutputs imageId={imageId} /></div>}
        </div>
      </div>
      <KeyboardShortcutsHelp show={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />
    </div>
  );
}

export default ImageView;
