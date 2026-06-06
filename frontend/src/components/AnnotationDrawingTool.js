import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * AnnotationDrawingTool
 * SVG overlay for drawing new bounding boxes on images.
 * When the cursor leaves the image edge during drawing, coordinates
 * are clamped to the image boundary so the box is placed at the edge.
 */
export default function AnnotationDrawingTool({
  containerSize,
  naturalSize,
  zoomLevel,
  active,
  leftClickEnabled,
  activeClassColor,
  onAnnotationCreated,
  onCancel
}) {
  const [drawingBox, setDrawingBox] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const overlayRef = useRef(null);
  const drawingRef = useRef(null);

  // Minimum box size in display pixels
  const MIN_BOX_SIZE = 10;

  const getClampedCoordinates = useCallback((e) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / zoomLevel;
    const rawY = (e.clientY - rect.top) / zoomLevel;
    return {
      x: Math.max(0, Math.min(containerSize.width, rawX)),
      y: Math.max(0, Math.min(containerSize.height, rawY)),
    };
  }, [zoomLevel, containerSize]);

  const handleMouseDown = (e) => {
    if (!active) return;
    const isLeftClick = e.button === 0 && !e.ctrlKey;
    if (!(isLeftClick && leftClickEnabled)) return;

    e.stopPropagation();
    e.preventDefault();

    const coords = getClampedCoordinates(e);
    const box = { x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y };
    setDrawingBox(box);
    setIsDrawing(true);
    drawingRef.current = box;
  };

  // Document-level handlers for mousemove/mouseup so drawing continues
  // even when the cursor leaves the overlay element.
  const handleDocMouseMove = useCallback((e) => {
    if (!drawingRef.current) return;
    const coords = getClampedCoordinates(e);
    const updated = { ...drawingRef.current, x2: coords.x, y2: coords.y };
    drawingRef.current = updated;
    setDrawingBox(updated);
  }, [getClampedCoordinates]);

  const handleDocMouseUp = useCallback((e) => {
    if (!drawingRef.current) return;

    const coords = getClampedCoordinates(e);
    const finalBox = { ...drawingRef.current, x2: coords.x, y2: coords.y };

    // Check minimum size in display space
    const displayWidth = Math.abs(finalBox.x2 - finalBox.x1);
    const displayHeight = Math.abs(finalBox.y2 - finalBox.y1);

    if (displayWidth >= MIN_BOX_SIZE && displayHeight >= MIN_BOX_SIZE) {
      // Convert from display coordinates to image coordinates
      const scaleX = naturalSize.width / containerSize.width;
      const scaleY = naturalSize.height / containerSize.height;

      const x1 = finalBox.x1 * scaleX;
      const y1 = finalBox.y1 * scaleY;
      const x2 = finalBox.x2 * scaleX;
      const y2 = finalBox.y2 * scaleY;

      const bbox = {
        bbox_x_min: Math.min(x1, x2),
        bbox_y_min: Math.min(y1, y2),
        bbox_x_max: Math.max(x1, x2),
        bbox_y_max: Math.max(y1, y2),
        image_width: naturalSize.width,
        image_height: naturalSize.height,
      };

      if (onAnnotationCreated) {
        onAnnotationCreated(bbox);
      }
    }

    setDrawingBox(null);
    setIsDrawing(false);
    drawingRef.current = null;
  }, [getClampedCoordinates, naturalSize, containerSize, onAnnotationCreated]);

  // Attach document-level listeners while drawing
  useEffect(() => {
    if (!isDrawing) return;
    document.addEventListener('mousemove', handleDocMouseMove);
    document.addEventListener('mouseup', handleDocMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleDocMouseMove);
      document.removeEventListener('mouseup', handleDocMouseUp);
    };
  }, [isDrawing, handleDocMouseMove, handleDocMouseUp]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (isDrawing) {
        setDrawingBox(null);
        setIsDrawing(false);
        drawingRef.current = null;
      } else if (onCancel) {
        onCancel();
      }
    }
  }, [isDrawing, onCancel]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!active) return null;

  const color = activeClassColor || '#FF9800';
  const cursor = leftClickEnabled ? 'crosshair' : 'inherit';

  // Compute preview rectangle
  let previewRect = null;
  if (drawingBox) {
    const x = Math.min(drawingBox.x1, drawingBox.x2);
    const y = Math.min(drawingBox.y1, drawingBox.y2);
    const w = Math.abs(drawingBox.x2 - drawingBox.x1);
    const h = Math.abs(drawingBox.y2 - drawingBox.y1);
    previewRect = { x, y, w, h };
  }

  return (
    <div
      ref={overlayRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: containerSize.width,
        height: containerSize.height,
        transform: `scale(${zoomLevel})`,
        transformOrigin: 'top left',
        cursor,
        zIndex: 1001,
        pointerEvents: 'auto',
      }}
    >
      <svg
        width={containerSize.width}
        height={containerSize.height}
        style={{ display: 'block' }}
      >
        {previewRect && (
          <>
            <rect
              x={previewRect.x}
              y={previewRect.y}
              width={previewRect.w}
              height={previewRect.h}
              fill={`${color}15`}
              stroke={color}
              strokeWidth={2 / zoomLevel}
              strokeDasharray={`${6 / zoomLevel},${4 / zoomLevel}`}
            />
            {/* Corner indicators */}
            <circle
              cx={previewRect.x}
              cy={previewRect.y}
              r={3 / zoomLevel}
              fill={color}
              stroke="white"
              strokeWidth={1 / zoomLevel}
            />
            <circle
              cx={previewRect.x + previewRect.w}
              cy={previewRect.y + previewRect.h}
              r={3 / zoomLevel}
              fill={color}
              stroke="white"
              strokeWidth={1 / zoomLevel}
            />
            {/* Size label */}
            <text
              x={previewRect.x + previewRect.w / 2}
              y={previewRect.y - 6 / zoomLevel}
              fill={color}
              fontSize={12 / zoomLevel}
              fontWeight="bold"
              textAnchor="middle"
              style={{ textShadow: '0 0 3px white, 0 0 3px white' }}
            >
              {Math.round(previewRect.w)}x{Math.round(previewRect.h)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
