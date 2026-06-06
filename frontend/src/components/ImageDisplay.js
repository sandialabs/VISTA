import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import HeatmapOverlay from './HeatmapOverlay';
import MeasurementTool from './MeasurementTool';
import MeasurementOverlay from './MeasurementOverlay';
import UserAnnotationOverlay from './UserAnnotationOverlay';
import AnnotationDrawingTool from './AnnotationDrawingTool';
import ImageDeleteModal from './ImageDeleteModal';
import downloadImage from '../utils/imageDownload';

// Deleted image placeholder SVG for larger display
const DELETED_IMAGE_DISPLAY_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2ZiZjVmNSIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1kYXNoYXJyYXk9IjE1LDgiLz48dGV4dCB4PSI1MCUiIHk9IjM1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjM2IiBmb250LXdlaWdodD0iNjAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2M0MzAyYiI+SW1hZ2UgRGVsZXRlZDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjY0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2Y1OWUwYiI+8J+XkeKcgO+4jzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjY1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzk3OWNhMSI+VGhpcyBpbWFnZSBoYXMgYmVlbiBkZWxldGVkPC90ZXh0Pjx0ZXh0IHg9IjUwJSIgeT0iNzAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTc5Y2ExIj5DaGVjayB0aGUgZGVsZXRpb24gY29udHJvbHMgYmVsb3cgZm9yIG1vcmUgaW5mbzwvdGV4dD48L3N2Zz4=';

// Minimum pixels of image that must remain visible when panning
const MIN_VISIBLE_IMAGE_MARGIN = 50;

// Interactive elements that should not trigger pan on click
const PAN_EXCLUDE_SELECTOR = 'button, a, input, select, textarea';

function ImageDisplay({
  imageId, image, isTransitioning, projectId, setImage, refreshProjectImages,
  navigateToPreviousImage, navigateToNextImage, currentImageIndex, projectImages,
  annotations, overlayOptions, calibration, measurements,
  measurementActive, setMeasurementActive, onSaveMeasurement, selectedMeasurementId,
  visibleMeasurementIds, userAnnotations, showUserAnnotations, annotationMode,
  selectMode, interactionMode, activeClassColor, selectedAnnotationId,
  hoveredAnnotationId, onSelectAnnotation, onSelectMeasurement, onAnnotationCreated,
  onAnnotationUpdate, onToggleAnnotationMode, onModeChange
}) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Refs for stable event-handler access to latest state
  const zoomRef = useRef(zoomLevel);
  const panRef = useRef(panOffset);
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panRef.current = panOffset; }, [panOffset]);

  const handleZoomIn = useCallback(() => setZoomLevel(prev => Math.min(10, prev + 0.25)), []);
  const handleZoomOut = useCallback(() => setZoomLevel(prev => Math.max(0.25, prev - 0.25)), []);

  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

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

  const handleResetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
  }, []);

  const handleDownload = useCallback(async () => {
    if (!image) return;
    try {
      await downloadImage(imageId, image.filename || `image-${imageId}`);
    } catch (err) {
      console.error('Error downloading image:', err);
      alert(`Download failed: ${err.message}`);
    }
  }, [image, imageId]);

  // Keyboard navigation for zoom
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '+' || e.key === '=') handleZoomIn();
      else if (e.key === '-') handleZoomOut();
      else if (e.key === '0') handleResetZoom();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleResetZoom]);

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
    const rawPan = { x: mouseX - scale * (mouseX - prevPan.x), y: mouseY - scale * (mouseY - prevPan.y) };
    const newPan = clampPan(rawPan, newZoom);
    zoomRef.current = newZoom;
    panRef.current = newPan;
    setZoomLevel(newZoom);
    setPanOffset(newPan);
  }, [clampPan]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const measureMode = interactionMode === 'measure';

  // Pan: start on plain left-click (only in pan mode, or middle-click in any mode)
  const handlePanMouseDown = useCallback((e) => {
    if (annotationMode) return;
    if (measureMode && e.button === 0) return; // let measure mode handle left clicks
    if (selectMode && e.button === 0) return; // let select mode handle left clicks
    if (e.button !== 0 || e.ctrlKey) return;
    if (e.target.closest(PAN_EXCLUDE_SELECTOR)) return;
    e.preventDefault();
    panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
    setIsPanning(true);
  }, [annotationMode, selectMode, measureMode]);

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

  const measure = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    setNaturalSize({ width: natW, height: natH });
    if (natW > 0 && natH > 0) {
      const cs = getComputedStyle(container);
      const availW = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = container.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const scale = Math.min(availW / natW, availH / natH);
      const fitW = Math.round(natW * scale);
      const fitH = Math.round(natH * scale);
      img.style.width = fitW + 'px';
      img.style.height = fitH + 'px';
      setDisplaySize({ width: fitW, height: fitH });
    } else {
      setDisplaySize({ width: img.offsetWidth, height: img.offsetHeight });
    }
  }, []);

  // Reset display size, zoom, and pan when imageId changes
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

  const isSideBySide = overlayOptions?.viewMode === 'side-by-side' && overlayOptions?.bitmapAvailable;

  const renderImageView = (showOverlays = true, containerStyle = {}, attachRef = true) => (
    <div style={{ position: 'relative', ...containerStyle }}>
      <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)`, position: 'relative' }}>
      {!image ? (
        <div className="loading-container"><div className="loading"></div><p>Loading image...</p></div>
      ) : image.deleted_at ? (
        <img src={DELETED_IMAGE_DISPLAY_SVG} alt="Deleted" className="view-image deleted-image"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }} ref={attachRef ? imgRef : null} />
      ) : (
        <img src={`/api/images/${imageId}/content`} alt={image.filename || ''} className="view-image"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }} onLoad={measure}
          onError={(e) => { if (!e.target.src.includes('thumbnail')) e.target.src = `/api/images/${imageId}/thumbnail?width=800&height=600`; }}
          ref={attachRef ? imgRef : null} />
      )}
      {showOverlays && image && overlayOptions?.showBoxes && annotations?.length > 0 && displaySize.width > 0 && (
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          <BoundingBoxOverlay annotations={annotations} naturalSize={naturalSize} containerSize={displaySize} opacity={overlayOptions.opacity} />
        </div>
      )}
      {showOverlays && image && overlayOptions?.showHeatmap && annotations?.length > 0 && displaySize.width > 0 && (
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          <HeatmapOverlay annotations={annotations} containerSize={displaySize} opacity={overlayOptions.opacity} />
        </div>
      )}
      {showOverlays && image && measurements?.length > 0 && displaySize.width > 0 && naturalSize.width > 0 && (
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
          <MeasurementOverlay measurements={measurements} naturalSize={naturalSize} containerSize={displaySize}
            calibration={calibration} selectedMeasurementId={selectedMeasurementId}
            visibleMeasurementIds={visibleMeasurementIds} zoomLevel={zoomLevel}
            onSelectMeasurement={selectMode ? onSelectMeasurement : undefined} />
        </div>
      )}
      {showOverlays && image && userAnnotations?.length > 0 && showUserAnnotations && displaySize.width > 0 && (
        <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0,
          zIndex: (selectedAnnotationId && selectMode) ? 1002 : undefined,
          pointerEvents: (annotationMode || measureMode) ? 'none' : undefined }}>
          <UserAnnotationOverlay annotations={userAnnotations} naturalSize={naturalSize} containerSize={displaySize}
            opacity={overlayOptions?.opacity || 0.7} selectedAnnotationId={selectedAnnotationId}
            hoveredAnnotationId={hoveredAnnotationId}
            onSelectAnnotation={onSelectAnnotation} onAnnotationUpdate={onAnnotationUpdate} visible={showUserAnnotations} />
        </div>
      )}
      {image && !image.deleted_at && annotationMode && displaySize.width > 0 && naturalSize.width > 0 && (
        <AnnotationDrawingTool containerSize={displaySize} naturalSize={naturalSize} zoomLevel={zoomLevel}
          active={annotationMode} leftClickEnabled={annotationMode} activeClassColor={activeClassColor || '#FF9800'}
          onAnnotationCreated={onAnnotationCreated} onCancel={() => {}} />
      )}
      {image && (measureMode || measurementActive) && displaySize.width > 0 && naturalSize.width > 0 && (
        <MeasurementTool containerSize={displaySize} naturalSize={naturalSize} zoomLevel={zoomLevel}
          calibration={calibration} onSaveMeasurement={onSaveMeasurement}
          onCancel={() => {
            if (setMeasurementActive) setMeasurementActive(false);
            if (onModeChange) onModeChange('pan');
          }}
          existingMeasurementCount={measurements ? measurements.length : 0}
          leftClickEnabled={measureMode || !!measurementActive} />
      )}
      </div>
    </div>
  );

  return (
    <>
      <div id="image-display" className={isTransitioning ? 'transitioning' : ''} ref={containerRef}
        style={{
          position: 'relative',
          cursor: isPanning ? 'grabbing'
            : annotationMode ? 'crosshair'
            : measureMode ? 'crosshair'
            : selectMode ? 'default'
            : 'grab'
        }} onMouseDown={handlePanMouseDown}>
        {/* Mode indicator badge */}
        {interactionMode && interactionMode !== 'pan' && (
          <div style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2000,
            padding: '4px 12px',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.5px',
            pointerEvents: 'none',
            userSelect: 'none',
            background: interactionMode === 'draw' ? '#2563eb'
              : interactionMode === 'measure' ? '#d97706'
              : '#7c3aed',
            color: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            {interactionMode === 'draw' ? 'DRAW MODE'
              : interactionMode === 'measure' ? 'MEASURE MODE'
              : 'SELECT MODE'}
          </div>
        )}
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
        ) : renderImageView(true, {}, true)}
      </div>

      <div className="image-controls">
        {navigateToPreviousImage && (
          <button className="btn btn-secondary btn-small control-btn" onClick={navigateToPreviousImage} disabled={currentImageIndex <= 0}>
            &larr; Prev
          </button>
        )}
        {navigateToNextImage && (
          <button className="btn btn-secondary btn-small control-btn" onClick={navigateToNextImage}
            disabled={currentImageIndex >= (projectImages?.length || 0) - 1 || currentImageIndex === -1}>
            Next &rarr;
          </button>
        )}
        <button className="btn btn-secondary control-btn" onClick={handleResetZoom}>Reset</button>
        <button className="btn btn-success control-btn" onClick={handleDownload}>Download</button>
        {image && !image.deleted_at && (
          <button className="btn btn-danger control-btn" onClick={() => setShowDeleteModal(true)}>Delete</button>
        )}
      </div>

      <ImageDeleteModal
        image={image} projectId={projectId} setImage={setImage}
        refreshProjectImages={refreshProjectImages} show={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
      />
    </>
  );
}

export default ImageDisplay;
