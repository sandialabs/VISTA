import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import MeasurementSaveDialog from './MeasurementSaveDialog';

export default function MeasurementTool({
  containerSize,
  naturalSize,
  zoomLevel,
  calibration,
  onSaveMeasurement,
  onCancel,
  existingMeasurementCount,
  leftClickEnabled = false
}) {
  const [drawingLine, setDrawingLine] = useState(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [measurementName, setMeasurementName] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (showSaveDialog) {
      const defaultName = `Measurement ${(existingMeasurementCount || 0) + 1}`;
      setMeasurementName(defaultName);
    }
  }, [showSaveDialog, existingMeasurementCount]);

  const getAdjustedCoordinates = (e) => {
    if (!overlayRef.current) return { x: 0, y: 0 };

    const rect = overlayRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoomLevel;
    const y = (e.clientY - rect.top) / zoomLevel;

    return { x, y };
  };

  const handleMouseDown = (e) => {
    const isRightOrCtrl = e.button === 2 || (e.button === 0 && e.ctrlKey);
    const isLeftClick = e.button === 0 && !e.ctrlKey;

    // Right-click / ctrl+click always draws; left-click only when measure mode is active
    if (!isRightOrCtrl && !(isLeftClick && leftClickEnabled)) return;
    if (showSaveDialog) return;

    e.stopPropagation(); // Prevent pan from starting
    e.preventDefault();

    const coords = getAdjustedCoordinates(e);
    setDrawingLine({
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y
    });
    setIsDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !drawingLine) return;

    const coords = getAdjustedCoordinates(e);
    setDrawingLine(prev => ({
      ...prev,
      x2: coords.x,
      y2: coords.y
    }));
  };

  const handleMouseUp = (e) => {
    if (!isDrawing || !drawingLine) return;

    const coords = getAdjustedCoordinates(e);
    const finalLine = {
      ...drawingLine,
      x2: coords.x,
      y2: coords.y
    };

    const distance = calculateDistance(finalLine);
    if (distance < 5) {
      setDrawingLine(null);
      setIsDrawing(false);
      return;
    }

    setDrawingLine(finalLine);
    setIsDrawing(false);
    setShowSaveDialog(true);
  };

  const calculateDistance = (line) => {
    if (!line) return 0;
    return Math.sqrt(
      Math.pow(line.x2 - line.x1, 2) + Math.pow(line.y2 - line.y1, 2)
    );
  };

  const calculateRealWorldDistances = (line) => {
    const scaleX = naturalSize.width / containerSize.width;
    const scaleY = naturalSize.height / containerSize.height;

    const imageX1 = line.x1 * scaleX;
    const imageY1 = line.y1 * scaleY;
    const imageX2 = line.x2 * scaleX;
    const imageY2 = line.y2 * scaleY;

    const distancePixelsImage = Math.sqrt(
      Math.pow(imageX2 - imageX1, 2) + Math.pow(imageY2 - imageY1, 2)
    );

    if (!calibration) {
      return {
        pixels: distancePixelsImage,
        mm: null,
        inches: null
      };
    }

    const distanceMM = distancePixelsImage / calibration.pixels_per_mm;
    const distanceInches = distancePixelsImage / calibration.pixels_per_inch;

    return {
      pixels: distancePixelsImage,
      mm: distanceMM,
      inches: distanceInches
    };
  };

  const formatDistance = (line) => {
    const distances = calculateRealWorldDistances(line);

    if (!calibration) {
      return `${distances.pixels.toFixed(1)} px (no calibration)`;
    }

    if (calibration.unit === 'inches') {
      return `${distances.inches.toFixed(3)}"`;
    }
    return `${distances.mm.toFixed(2)} mm`;
  };

  const handleSave = () => {
    if (!measurementName.trim()) {
      setValidationError('Please enter a name for this measurement');
      return;
    }
    setValidationError(null);

    const scaleX = naturalSize.width / containerSize.width;
    const scaleY = naturalSize.height / containerSize.height;

    const imageX1 = drawingLine.x1 * scaleX;
    const imageY1 = drawingLine.y1 * scaleY;
    const imageX2 = drawingLine.x2 * scaleX;
    const imageY2 = drawingLine.y2 * scaleY;

    const distances = calculateRealWorldDistances(drawingLine);

    const measurement = {
      id: crypto.randomUUID(),
      name: measurementName.trim(),
      x1: imageX1,
      y1: imageY1,
      x2: imageX2,
      y2: imageY2,
      distance_pixels: distances.pixels,
      distance_mm: distances.mm,
      distance_inches: distances.inches,
      created_at: new Date().toISOString()
    };

    if (onSaveMeasurement) {
      onSaveMeasurement(measurement);
    }

    setDrawingLine(null);
    setShowSaveDialog(false);
    setMeasurementName('');
  };

  const handleCancelSave = useCallback(() => {
    setDrawingLine(null);
    setShowSaveDialog(false);
    setMeasurementName('');
    setValidationError(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (showSaveDialog) {
        setDrawingLine(null);
        setShowSaveDialog(false);
        setMeasurementName('');
        setValidationError(null);
      } else if (onCancel) {
        onCancel();
      }
    }
  }, [showSaveDialog, onCancel]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Show calibration error immediately when measure mode is active without calibration
  if (!calibration && leftClickEnabled) {
    return (
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        maxWidth: '400px',
        textAlign: 'center',
        zIndex: 2000
      }}>
        <h3 style={{ margin: '0 0 12px 0', color: '#dc2626' }}>No Calibration Set</h3>
        <p style={{ margin: '0 0 16px 0', color: '#6b7280' }}>
          Please set calibration in the Calibration section before using the measurement tool.
        </p>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // Cursor: crosshair when in measure mode or actively drawing, inherit otherwise (shows container grab cursor)
  const cursor = showSaveDialog ? 'default' : (leftClickEnabled || isDrawing) ? 'crosshair' : 'inherit';

  return (
    <>
      <div
        ref={overlayRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: containerSize.width,
          height: containerSize.height,
          transform: `scale(${zoomLevel})`,
          transformOrigin: 'top left',
          cursor,
          zIndex: 1000,
          pointerEvents: 'auto'
        }}
      >
        <svg
          width={containerSize.width}
          height={containerSize.height}
          style={{ display: 'block' }}
        >
          {drawingLine && (
            <>
              <line
                x1={drawingLine.x1}
                y1={drawingLine.y1}
                x2={drawingLine.x2}
                y2={drawingLine.y2}
                stroke="#f59e0b"
                strokeWidth={3 / zoomLevel}
                strokeDasharray={`${5 / zoomLevel},${5 / zoomLevel}`}
              />
              <circle
                cx={drawingLine.x1}
                cy={drawingLine.y1}
                r={4 / zoomLevel}
                fill="#f59e0b"
                stroke="white"
                strokeWidth={1 / zoomLevel}
              />
              <circle
                cx={drawingLine.x2}
                cy={drawingLine.y2}
                r={4 / zoomLevel}
                fill="#f59e0b"
                stroke="white"
                strokeWidth={1 / zoomLevel}
              />
              <text
                x={(drawingLine.x1 + drawingLine.x2) / 2}
                y={(drawingLine.y1 + drawingLine.y2) / 2 - 10 / zoomLevel}
                fill="#f59e0b"
                fontSize={14 / zoomLevel}
                fontWeight="bold"
                textAnchor="middle"
                style={{
                  textShadow: '0 0 3px white, 0 0 3px white, 0 0 3px white'
                }}
              >
                {formatDistance(drawingLine)}
              </text>
            </>
          )}
        </svg>
      </div>

      {showSaveDialog && ReactDOM.createPortal(
        <MeasurementSaveDialog
          measurementName={measurementName}
          setMeasurementName={setMeasurementName}
          validationError={validationError}
          setValidationError={setValidationError}
          formattedDistance={drawingLine ? formatDistance(drawingLine) : ''}
          onSave={handleSave}
          onCancel={handleCancelSave}
        />,
        document.body
      )}
    </>
  );
}
