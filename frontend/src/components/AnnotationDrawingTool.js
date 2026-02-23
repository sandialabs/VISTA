import React, { useState, useRef, useCallback } from 'react';

function AnnotationDrawingTool({
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  selectedClassId,
  onAnnotationCreated,
  active,
}) {
  const svgRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentPoint, setCurrentPoint] = useState(null);

  const getImageCoords = useCallback((e) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Convert display coords to image coords
    const imgX = (x / displayWidth) * imageWidth;
    const imgY = (y / displayHeight) * imageHeight;
    return { x: imgX, y: imgY, displayX: x, displayY: y };
  }, [displayWidth, displayHeight, imageWidth, imageHeight]);

  const handleMouseDown = useCallback((e) => {
    if (!active || !selectedClassId) return;
    e.preventDefault();
    const coords = getImageCoords(e);
    if (coords) {
      setStartPoint(coords);
      setCurrentPoint(coords);
      setDrawing(true);
    }
  }, [active, selectedClassId, getImageCoords]);

  const handleMouseMove = useCallback((e) => {
    if (!drawing) return;
    e.preventDefault();
    const coords = getImageCoords(e);
    if (coords) {
      setCurrentPoint(coords);
    }
  }, [drawing, getImageCoords]);

  const handleMouseUp = useCallback((e) => {
    if (!drawing || !startPoint || !currentPoint) {
      setDrawing(false);
      return;
    }
    e.preventDefault();

    const x_min = Math.min(startPoint.x, currentPoint.x);
    const y_min = Math.min(startPoint.y, currentPoint.y);
    const x_max = Math.max(startPoint.x, currentPoint.x);
    const y_max = Math.max(startPoint.y, currentPoint.y);

    // Minimum box size check (at least 5px in image space)
    if (x_max - x_min > 5 && y_max - y_min > 5) {
      onAnnotationCreated({
        x_min: Math.max(0, x_min),
        y_min: Math.max(0, y_min),
        x_max: Math.min(imageWidth, x_max),
        y_max: Math.min(imageHeight, y_max),
        image_width: imageWidth,
        image_height: imageHeight,
      });
    }

    setDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
  }, [drawing, startPoint, currentPoint, imageWidth, imageHeight, onAnnotationCreated]);

  if (!active) return null;

  // Calculate display rectangle
  let rectProps = null;
  if (drawing && startPoint && currentPoint) {
    const x1 = Math.min(startPoint.displayX, currentPoint.displayX);
    const y1 = Math.min(startPoint.displayY, currentPoint.displayY);
    const w = Math.abs(currentPoint.displayX - startPoint.displayX);
    const h = Math.abs(currentPoint.displayY - startPoint.displayY);
    rectProps = { x: x1, y: y1, width: w, height: h };
  }

  return (
    <svg
      ref={svgRef}
      className="annotation-drawing-svg"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: displayWidth,
        height: displayHeight,
        cursor: selectedClassId ? 'crosshair' : 'not-allowed',
        zIndex: 10,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {rectProps && (
        <rect
          x={rectProps.x}
          y={rectProps.y}
          width={rectProps.width}
          height={rectProps.height}
          fill="rgba(255, 0, 0, 0.2)"
          stroke="#FF0000"
          strokeWidth="2"
          strokeDasharray="4"
        />
      )}
      {!selectedClassId && active && (
        <text x="10" y="20" fill="#FF0000" fontSize="12">
          Select a class before drawing
        </text>
      )}
    </svg>
  );
}

export default AnnotationDrawingTool;
