import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import HeatmapOverlay from './HeatmapOverlay';

// Deleted image placeholder SVG for larger display
const DELETED_IMAGE_DISPLAY_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2ZiZjVmNSIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1kYXNoYXJyYXk9IjE1LDgiLz48dGV4dCB4PSI1MCUiIHk9IjM1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjM2IiBmb250LXdlaWdodD0iNjAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2M0MzAyYiI+SW1hZ2UgRGVsZXRlZDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjY0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2Y1OWUwYiI+8J+XkeKcgO+4jzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjY1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzk3OWNhMSI+VGhpcyBpbWFnZSBoYXMgYmVlbiBkZWxldGVkPC90ZXh0Pjx0ZXh0IHg9IjUwJSIgeT0iNzAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTc5Y2ExIj5DaGVjayB0aGUgZGVsZXRpb24gY29udHJvbHMgYmVsb3cgZm9yIG1vcmUgaW5mbzwvdGV4dD48L3N2Zz4=';

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
  overlayOptions
}) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showForceDeleteConfirm, setShowForceDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const MIN_REASON = 5;

  // Apply zoom
  const handleZoomIn = () => {
    setZoomLevel(prev => prev + 0.25);
  };

  // Handle zoom out
  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(0.25, prev - 0.25));
  };

  // Handle reset zoom
  const handleResetZoom = () => {
    setZoomLevel(1);
  };

  // Handle delete
  const handleDelete = async () => {
    if (reason.trim().length < MIN_REASON) {
      setDeleteError(`Reason must be at least ${MIN_REASON} characters`);
      return;
    }
    
    // If force delete and not confirmed, show secondary confirmation
    if (force && !showForceDeleteConfirm) {
      setShowForceDeleteConfirm(true);
      return;
    }
    
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/projects/${projectId}/images/${image.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), force })
      });
      if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(`Delete failed (${resp.status}): ${detail}`);
      }
      const data = await resp.json();
      setImage(data);
      if (refreshProjectImages) refreshProjectImages();
      setShowDeleteModal(false);
      setReason("");
      setForce(false);
      setDeleteError(null);
      setShowForceDeleteConfirm(false);
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
      console.log('Starting download for image %s...', imageId);
      
      // Try multiple endpoints to find the working one
      const endpoints = [
        `/api/images/${imageId}/content`,
        `/api/images/${imageId}/download`,
      ];
      
      let imageBlob = null;
      let filename = image.filename || `image-${imageId}`;
      
      for (const endpoint of endpoints) {
        try {
          console.log('Trying endpoint: %s', endpoint);
          const response = await fetch(endpoint);
          
          if (!response.ok) {
            console.log('Endpoint %s failed: %s %s', endpoint, response.status, response.statusText);
            continue;
          }
          
          const contentType = response.headers.get('content-type');
          console.log('Endpoint %s - Content-Type: %s', endpoint, contentType);
          
          if (contentType && contentType.includes('application/json')) {
            // This might be a redirect URL response
            const jsonData = await response.json();
            console.log('Got JSON response:', jsonData);
            
            if (jsonData.url) {
              // Try to fetch from the provided URL
              console.log('Fetching from provided URL: %s', jsonData.url);
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
          } else {
            console.log('Unexpected content type: %s', contentType);
          }
        } catch (endpointError) {
          console.error('Error with endpoint %s:', endpoint, endpointError);
          continue;
        }
      }
      
      if (!imageBlob) {
        throw new Error('Unable to download image from any available endpoint');
      }
      
      console.log('Successfully got image blob:', {
        size: imageBlob.size,
        type: imageBlob.type
      });
      
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
      
      console.log('Download completed successfully: %s', filename);
      
    } catch (error) {
      console.error('Error downloading image:', error);
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
  }, []);

  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    if (imgRef.current) {
      // getBoundingClientRect gives us the actual displayed size after CSS transform
      // But we want the pre-transform size since the overlay is positioned relative to the container
      // Use offsetWidth/offsetHeight for the layout dimensions (pre-transform)
      const measuredSize = {
        width: imgRef.current.offsetWidth,
        height: imgRef.current.offsetHeight
      };

      if (process.env.NODE_ENV === 'development') {
        console.log('[ImageDisplay] Measured display size:', {
          displaySize: measuredSize,
          naturalWidth: imgRef.current.naturalWidth,
          naturalHeight: imgRef.current.naturalHeight,
          offsetWidth: imgRef.current.offsetWidth,
          offsetHeight: imgRef.current.offsetHeight,
          clientWidth: imgRef.current.clientWidth,
          clientHeight: imgRef.current.clientHeight,
          zoomLevel,
          imageId
        });
      }

      setDisplaySize(measuredSize);
    }
  }, [zoomLevel, imageId]);

  // Reset display size when imageId changes to prevent stale dimensions
  useEffect(() => {
    setDisplaySize({ width: 0, height: 0 });
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
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}
          onClick={handleZoomIn}
          ref={attachRef ? imgRef : null}
        />
      ) : (
        <img
          src={`/api/images/${imageId}/content`}
          alt={image.filename || ''}
          className="view-image"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}
          onClick={handleZoomIn}
          onLoad={measure}
          onError={(e) => {
            console.error('Failed to load image with ID: %s', imageId, e);
            if (!e.target.src.includes('thumbnail')) {
              e.target.src = `/api/images/${imageId}/thumbnail?width=800&height=600`;
            }
          }}
          ref={attachRef ? imgRef : null}
        />
      )}
      {showOverlays && image && overlayOptions?.showBoxes && annotations?.length > 0 && displaySize.width > 0 && (() => {
        console.log('[ImageDisplay] Rendering BoundingBoxOverlay:', {
          imageMetadata: { width: image.width, height: image.height },
          displaySize,
          zoomLevel,
          annotationCount: annotations.length
        });
        return (
          <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
            <BoundingBoxOverlay
              annotations={annotations}
              naturalSize={{ width: image.width, height: image.height }}
              containerSize={displaySize}
              opacity={overlayOptions.opacity}
            />
          </div>
        );
      })()}
      {showOverlays && image && overlayOptions?.showHeatmap && annotations?.length > 0 && displaySize.width > 0 && (
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          <HeatmapOverlay
            annotations={annotations}
            containerSize={displaySize}
            opacity={overlayOptions.opacity}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
      <div id="image-display" className={isTransitioning ? 'transitioning' : ''} ref={containerRef} style={{ position: 'relative' }}>
        {isSideBySide ? (
          <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: '0.25rem', color: '#666' }}>Original</div>
              {renderImageView(false, {}, true)}
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
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
          onClick={handleZoomIn}
        >
          Zoom In
        </button>
        <button
          className="btn btn-secondary control-btn"
          onClick={handleZoomOut}
        >
          Zoom Out
        </button>
        <button
          className="btn btn-secondary control-btn"
          onClick={handleResetZoom}
        >
          Reset
        </button>

        {/* Other controls */}
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
                setShowForceDeleteConfirm(false);
              }}>&times;</span>
            </div>
            
            <div className="modal-body">
              <p>{force ? 'This will remove the file from storage immediately. Database record stays for audit.' : 'The image will be hidden and can be restored until retention expires.'}</p>
              
              {force && showForceDeleteConfirm && (
                <div className="alert alert-warning" style={{ margin: '16px 0', padding: '12px', backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px', color: '#856404' }}>
                  <strong>⚠️ Final Warning:</strong> This action will permanently delete the image file from storage and cannot be undone. Are you absolutely sure you want to proceed?
                </div>
              )}
              
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
                      if (!e.target.checked) {
                        setShowForceDeleteConfirm(false);
                      }
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
                setShowForceDeleteConfirm(false);
              }} disabled={submitting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={submitting}>
                {submitting ? 'Deleting...' : (force && showForceDeleteConfirm ? 'Permanently Delete' : force ? 'Force Delete' : 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ImageDisplay;
