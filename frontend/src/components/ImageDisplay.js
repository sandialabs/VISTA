import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import HeatmapOverlay from './HeatmapOverlay';
import MeasurementTool from './MeasurementTool';
import MeasurementOverlay from './MeasurementOverlay';
import {
  deleteProjectImage,
  fetchImageContentResponse,
  fetchImageDownloadResponse,
} from '../api/images';

// Deleted image placeholder SVG for larger display
const DELETED_IMAGE_DISPLAY_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2ZiZjVmNSIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1kYXNoYXJyYXk9IjE1LDgiLz48dGV4dCB4PSI1MCUiIHk9IjM1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjM2IiBmb250LXdlaWdodD0iNjAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2M0MzAyYiI+SW1hZ2UgRGVsZXRlZDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjY0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2Y1OWUwYiI+8J+XkeKcgO+4jzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjY1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzk3OWNhMSI+VGhpcyBpbWFnZSBoYXMgYmVlbiBkZWxldGVkPC90ZXh0Pjx0ZXh0IHg9IjUwJSIgeT0iNzAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTc5Y2ExIj5DaGVjayB0aGUgZGVsZXRpb24gY29udHJvbHMgYmVsb3cgZm9yIG1vcmUgaW5mbzwvdGV4dD48L3N2Zz4=';

// Minimum pixels of image that must remain visible when panning
const MIN_VISIBLE_IMAGE_MARGIN = 50;

// Interactive elements that should not trigger pan on click
const PAN_EXCLUDE_SELECTOR = 'button, a, input, select, textarea';

function ImageDisplay({
  imageId,
  image,
  isTransitioning,
  projectId,
  setImage,
  refreshProjectImages,
  navigateToPreviousImage,
  navigateToNextImage,
  currentImageIndex,
  projectImages,
  selectedAnalysis,
  annotations,
  overlayOptions,
  calibration,
  measurements,
  measurementActive,
  setMeasurementActive,
  onSaveMeasurement,
  selectedMeasurementId,
  visibleMeasurementIds
}) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const MIN_REASON = 5;

  // Refs for stable event-handler access to latest state
  const zoomRef = useRef(zoomLevel);
  const panRef = useRef(panOffset);
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panRef.current = panOffset; }, [panOffset]);

  // Apply zoom (kept for keyboard shortcuts)
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(10, prev + 0.25));
  }, []);

  // Handle zoom out (kept for keyboard shortcuts)
  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(0.25, prev - 0.25));
  }, []);

  // Clamp pan so at least MIN_VISIBLE_IMAGE_MARGIN px of the image remains visible in the container
  const clampPan = useCallback((pan, zoom) => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return pan;
    const cW = container.offsetWidth;
    const cH = container.offsetHeight;
    const scaledW = img.offsetWidth * zoom;
    const scaledH = img.offsetHeight * zoom;
    const margin = MIN_VISIBLE_IMAGE_MARGIN;
    return {
      x: Math.max(margin - scaledW, Math.min(cW - margin, pan.x)),
      y: Math.max(margin - scaledH, Math.min(cH - margin, pan.y))
    };
  }, []);

  // Handle reset zoom and pan
  const handleResetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
  }, []);

  // Handle delete
  const handleDelete = async () => {
    if (reason.trim().length < MIN_REASON) {
      setDeleteError(`Reason must be at least ${MIN_REASON} characters`);
      return;
    }
    
    setSubmitting(true);
    try {
      const data = await deleteProjectImage(
        projectId,
        image.id,
        { reason: reason.trim(), force },
        { errorLabel: 'Delete failed' },
      );
      setImage(data);
      if (refreshProjectImages) refreshProjectImages();
      setShowDeleteModal(false);
      setReason("");
      setForce(false);
      setDeleteError(null);
    } catch (e) {
      setDeleteError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle download
  const handleDownload = async () => {
    if (!image) return;

    try {
      // Try multiple endpoints to find the working one
      const endpoints = [fetchImageContentResponse, fetchImageDownloadResponse];
      
      let imageBlob = null;
      let filename = image.filename || `image-${imageId}`;

      for (const fetchImageResponse of endpoints) {
        try {
          const response = await fetchImageResponse(imageId);

          if (!response.ok) {
            continue;
          }

          const contentType = response.headers.get('content-type');

          if (contentType && contentType.includes('application/json')) {
            // This might be a redirect URL response
            const jsonData = await response.json();

            if (jsonData.url) {
              // Try to fetch from the provided URL
              const imageResponse = await fetch(jsonData.url);
              
              if (imageResponse.ok) {
                const blobContentType = imageResponse.headers.get('content-type');
                if (blobContentType && blobContentType.startsWith('image/')) {
                  imageBlob = await imageResponse.blob();
                  break;
                }
              }
            }
          } else if (contentType && contentType.startsWith('image/')) {
            // Direct image response
            imageBlob = await response.blob();
            break;
          }
        } catch (endpointError) {
          continue;
        }
      }
      
      if (!imageBlob) {
        throw new Error('Unable to download image from any available endpoint');
      }

      // Ensure we have the right file extension
      if (!filename.includes('.') && imageBlob.type) {
        const extension = imageBlob.type.split('/')[1];
        if (extension && extension !== 'jpeg') {
          filename = `${filename}.${extension}`;
        } else if (extension === 'jpeg') {
          filename = `${filename}.jpg`;
        }
      }
      
      // Create a URL for the blob and trigger download
      const blobUrl = window.URL.createObjectURL(imageBlob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      
      // Append to the document, click it, and remove it
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      window.URL.revokeObjectURL(blobUrl);

    } catch (error) {
      alert(`Download failed: ${error.message}`);
    }
  };

  // Keyboard navigation for zoom
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoom();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleZoomIn, handleZoomOut, handleResetZoom]);

  const containerRef = useRef(null);

  // Wheel zoom toward cursor
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const prevZoom = zoomRef.current;
    const newZoom = Math.max(0.25, Math.min(10, prevZoom * zoomFactor));
    const scale = newZoom / prevZoom;

    const prevPan = panRef.current;
    const rawPan = {
      x: mouseX - scale * (mouseX - prevPan.x),
      y: mouseY - scale * (mouseY - prevPan.y)
    };
    const newPan = clampPan(rawPan, newZoom);

    zoomRef.current = newZoom;
    panRef.current = newPan;
    setZoomLevel(newZoom);
    setPanOffset(newPan);
  }, [clampPan]);

  // Attach wheel listener (passive: false allows preventDefault)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Pan: start on plain left-click (not on interactive elements, not in measure mode)
  const handlePanMouseDown = useCallback((e) => {
    if (e.button !== 0 || e.ctrlKey) return;
    if (e.target.closest(PAN_EXCLUDE_SELECTOR)) return;
    e.preventDefault();
    const start = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
    panStartRef.current = start;
    setIsPanning(true);
  }, []);

  // Pan: global mousemove/mouseup for dragging
  useEffect(() => {
    if (!isPanning) return;
    const handleMouseMove = (e) => {
      const rawPan = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y };
      const newPan = clampPan(rawPan, zoomRef.current);
      panRef.current = newPan;
      setPanOffset(newPan);
    };
    const handleMouseUp = () => setIsPanning(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning, clampPan]);
  const imgRef = useRef(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    if (imgRef.current) {
      // getBoundingClientRect gives us the actual displayed size after CSS transform
      // But we want the pre-transform size since the overlay is positioned relative to the container
      // Use offsetWidth/offsetHeight for the layout dimensions (pre-transform)
      const measuredSize = {
        width: imgRef.current.offsetWidth,
        height: imgRef.current.offsetHeight
      };

      const naturalDimensions = {
        width: imgRef.current.naturalWidth,
        height: imgRef.current.naturalHeight
      };

      setDisplaySize(measuredSize);
      setNaturalSize(naturalDimensions);
    }
  }, []);

  // Reset display size, zoom, and pan when imageId changes to prevent stale dimensions
  useEffect(() => {
    setDisplaySize({ width: 0, height: 0 });
    setNaturalSize({ width: 0, height: 0 });
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
  }, [imageId]);

  useLayoutEffect(() => { measure(); }, [image, measure, annotations]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Side-by-side mode helper
  const isSideBySide = overlayOptions?.viewMode === 'side-by-side' && overlayOptions?.bitmapAvailable;

  const renderImageView = (showOverlays = true, containerStyle = {}, attachRef = true) => (
    <div style={{ position: 'relative', ...containerStyle }}>
      <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, position: 'relative' }}>
        <div
          data-testid="image-anchored-layer"
          style={{
            position: 'relative',
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top left'
          }}
        >
      {!image ? (
        <div className="loading-container">
          <div className="loading"></div>
          <p>Loading image...</p>
        </div>
      ) : image.deleted_at ? (
        <img
          src={DELETED_IMAGE_DISPLAY_SVG}
          alt="Deleted"
          className="view-image deleted-image"
          ref={attachRef ? imgRef : null}
        />
      ) : (
        <img
          src={`/api/images/${imageId}/content`}
          alt={image.filename || ''}
          className="view-image"
          onLoad={measure}
          onError={(e) => {
            if (!e.target.src.includes('thumbnail')) {
              e.target.src = `/api/images/${imageId}/thumbnail?width=800&height=600`;
            }
          }}
          ref={attachRef ? imgRef : null}
        />
      )}
      {showOverlays && image && overlayOptions?.showBoxes && annotations?.length > 0 && displaySize.width > 0 && (
        <div style={{ position: 'absolute', top: 0, left: 0 }}>
          <BoundingBoxOverlay
            annotations={annotations}
            naturalSize={naturalSize}
            containerSize={displaySize}
            opacity={overlayOptions.opacity}
          />
        </div>
      )}
      {showOverlays && image && overlayOptions?.showHeatmap && annotations?.length > 0 && displaySize.width > 0 && (
        <div style={{ position: 'absolute', top: 0, left: 0 }}>
          <HeatmapOverlay
            annotations={annotations}
            containerSize={displaySize}
            opacity={overlayOptions.opacity}
          />
        </div>
      )}
      {showOverlays && image && measurements && measurements.length > 0 && displaySize.width > 0 && naturalSize.width > 0 && (
        <div style={{ position: 'absolute', top: 0, left: 0 }}>
          <MeasurementOverlay
            measurements={measurements}
            naturalSize={naturalSize}
            containerSize={displaySize}
            calibration={calibration}
            selectedMeasurementId={selectedMeasurementId}
            visibleMeasurementIds={visibleMeasurementIds}
            zoomLevel={zoomLevel}
          />
        </div>
      )}
      {image && displaySize.width > 0 && naturalSize.width > 0 && (
        <MeasurementTool
          containerSize={displaySize}
          naturalSize={naturalSize}
          zoomLevel={zoomLevel}
          calibration={calibration}
          onSaveMeasurement={onSaveMeasurement}
          onCancel={() => setMeasurementActive && setMeasurementActive(false)}
          existingMeasurementCount={measurements ? measurements.length : 0}
          leftClickEnabled={!!measurementActive}
        />
      )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div id="image-display" className={isTransitioning ? 'transitioning' : ''} ref={containerRef} style={{ position: 'relative', cursor: isPanning ? 'grabbing' : 'crosshair' }} onMouseDown={handlePanMouseDown}>
        {isSideBySide ? (
          <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: '0.25rem', color: '#666' }}>Original</div>
              {renderImageView(false, {}, true)}
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: '0.25rem', color: '#666' }}>ML Overlay</div>
              {renderImageView(true, {}, false)}
            </div>
          </div>
        ) : (
          renderImageView(true, {}, true)
        )}
      </div>
      
      <div className="image-controls">
        {/* Navigation buttons */}
        {navigateToPreviousImage && (
          <button
            className="btn btn-secondary btn-small control-btn"
            onClick={navigateToPreviousImage}
            disabled={currentImageIndex <= 0}
          >
            ← Prev
          </button>
        )}
        {navigateToNextImage && (
          <button
            className="btn btn-secondary btn-small control-btn"
            onClick={navigateToNextImage}
            disabled={currentImageIndex >= (projectImages?.length || 0) - 1 || currentImageIndex === -1}
          >
            Next →
          </button>
        )}

        {/* Zoom controls */}
        <button
          className="btn btn-secondary control-btn"
          onClick={handleResetZoom}
        >
          Reset
        </button>

        {/* Other controls */}
        {image && !image.deleted_at && setMeasurementActive && (
          <button
            className={`btn control-btn ${measurementActive ? 'btn-warning' : 'btn-secondary'}`}
            onClick={() => setMeasurementActive(!measurementActive)}
          >
            {measurementActive ? 'Done Measuring' : 'Measure'}
          </button>
        )}
        <span className="measure-hint" aria-hidden={!measurementActive} style={{ visibility: measurementActive ? 'visible' : 'hidden' }}>
          Left-click to draw. Right-click also works.
        </span>
        <button
          className="btn btn-success control-btn"
          onClick={handleDownload}
        >
          Download
        </button>
        {image && !image.deleted_at && (
          <button
            className="btn btn-danger control-btn"
            onClick={() => setShowDeleteModal(true)}
          >
            Delete
          </button>
        )}
      </div>
      
      {showDeleteModal && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>{force ? 'Force Delete Image' : 'Delete Image'}</h3>
              <span className="close-modal" onClick={() => {
                setShowDeleteModal(false);
                setReason("");
                setForce(false);
                setDeleteError(null);
              }}>&times;</span>
            </div>
            
            <div className="modal-body">
              <p>{force ? 'This will remove the file from storage immediately. Database record stays for audit.' : 'The image will be hidden and can be restored until retention expires.'}</p>
              
              <div className="form-group">
                <label htmlFor="delete-reason">Reason (required)</label>
                <textarea 
                  id="delete-reason" 
                  rows={3} 
                  value={reason} 
                  onChange={e => setReason(e.target.value)}
                  placeholder="Enter a reason for deleting this image..."
                />
                <small>Min {MIN_REASON} chars. Helps auditing.</small>
              </div>
              
              <div className="form-group">
                <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input 
                    type="checkbox" 
                    checked={force} 
                    onChange={e => {
                      setForce(e.target.checked);
                    }} 
                  />
                  Force delete (also remove object from storage)
                </label>
              </div>
              
              {deleteError && <div className="alert alert-error">{deleteError}</div>}
            </div>
            
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => {
                setShowDeleteModal(false);
                setReason("");
                setForce(false);
                setDeleteError(null);
              }} disabled={submitting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={submitting}>
                {submitting ? 'Deleting...' : (force ? 'Force Delete' : 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ImageDisplay;
