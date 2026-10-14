import { getAnnotationBoxCornerViewBoxPosition, getMeasurementEndpointViewBoxPosition } from './inspectionAnnotationGeometry';

function MprLineEditHandles({ line, axis, currentSliceIndex, selectedAnnotationId, handlers }) {
  const {
    startMprAnnotationGeometryDrag,
    handleMprAnnotationGeometryDragMove,
    finishMprAnnotationGeometryDrag,
    stopMprAnnotationGeometryClick,
  } = handlers;
  const endpointPositions = getMeasurementEndpointViewBoxPosition(line);
  const isSelected = String(selectedAnnotationId || '') === String(line.id || '');
  return (
    <g>
      <line
        className="inspection-annotation-drag-target mpr-annotation-drag-target"
        x1={endpointPositions.start.x}
        y1={endpointPositions.start.y}
        x2={endpointPositions.end.x}
        y2={endpointPositions.end.y}
        stroke="transparent"
        strokeWidth="28"
        pointerEvents="stroke"
        aria-label={`Move ${line.name || 'MPR measurement'}`}
        onPointerDown={(event) => startMprAnnotationGeometryDrag(
          event,
          'line',
          'translate',
          line,
          axis,
          currentSliceIndex,
        )}
        onPointerMove={handleMprAnnotationGeometryDragMove}
        onPointerUp={finishMprAnnotationGeometryDrag}
        onPointerCancel={(event) => finishMprAnnotationGeometryDrag(event, { cancel: true })}
        onClick={stopMprAnnotationGeometryClick}
      />
      {isSelected && ['start', 'end'].map((endpoint) => (
        <circle
          key={endpoint}
          className="inspection-measurement-endpoint-dot mpr-annotation-resize-handle"
          cx={endpointPositions[endpoint].x}
          cy={endpointPositions[endpoint].y}
          r="12"
          fill="#ffffff"
          stroke={line.color}
          strokeWidth="5"
          aria-label={`Resize ${endpoint} endpoint for ${line.name || 'MPR measurement'}`}
          onPointerDown={(event) => startMprAnnotationGeometryDrag(
            event,
            'line',
            endpoint,
            line,
            axis,
            currentSliceIndex,
          )}
          onPointerMove={handleMprAnnotationGeometryDragMove}
          onPointerUp={finishMprAnnotationGeometryDrag}
          onPointerCancel={(event) => finishMprAnnotationGeometryDrag(event, { cancel: true })}
          onClick={stopMprAnnotationGeometryClick}
        />
      ))}
    </g>
  );
}

function MprBoxEditHandles({ box, axis, currentSliceIndex, selectedAnnotationId, handlers }) {
  const {
    startMprAnnotationGeometryDrag,
    handleMprAnnotationGeometryDragMove,
    finishMprAnnotationGeometryDrag,
    stopMprAnnotationGeometryClick,
  } = handlers;
  const cornerPositions = getAnnotationBoxCornerViewBoxPosition(box);
  const isSelected = String(selectedAnnotationId || '') === String(box.id || '');
  return (
    <g>
      <rect
        className="inspection-annotation-drag-target mpr-annotation-drag-target"
        x={(box.x / box.imageWidth) * 1000}
        y={(box.y / box.imageHeight) * 1000}
        width={(box.width / box.imageWidth) * 1000}
        height={(box.height / box.imageHeight) * 1000}
        fill="transparent"
        pointerEvents="all"
        aria-label={`Move ${box.name || 'MPR bounding box'}`}
        onPointerDown={(event) => startMprAnnotationGeometryDrag(
          event,
          'box',
          'translate',
          box,
          axis,
          currentSliceIndex,
        )}
        onPointerMove={handleMprAnnotationGeometryDragMove}
        onPointerUp={finishMprAnnotationGeometryDrag}
        onPointerCancel={(event) => finishMprAnnotationGeometryDrag(event, { cancel: true })}
        onClick={stopMprAnnotationGeometryClick}
      />
      {isSelected && Object.entries(cornerPositions).map(([corner, point]) => (
        <circle
          key={corner}
          className="inspection-box-corner-dot mpr-annotation-resize-handle"
          cx={point.x}
          cy={point.y}
          r="12"
          fill="#ffffff"
          stroke={box.color}
          strokeWidth="5"
          aria-label={`Resize ${corner} corner for ${box.name || 'MPR bounding box'}`}
          onPointerDown={(event) => startMprAnnotationGeometryDrag(
            event,
            'box',
            corner,
            box,
            axis,
            currentSliceIndex,
          )}
          onPointerMove={handleMprAnnotationGeometryDragMove}
          onPointerUp={finishMprAnnotationGeometryDrag}
          onPointerCancel={(event) => finishMprAnnotationGeometryDrag(event, { cancel: true })}
          onClick={stopMprAnnotationGeometryClick}
        />
      ))}
    </g>
  );
}

export function MprSliceEditHandles({
  readOnly,
  axis,
  currentSliceIndex,
  mprSliceLines,
  mprEditableSliceBoxes,
  selectedAnnotationId,
  handlers,
}) {
  if (readOnly) return null;
  return (
    <>
      {mprSliceLines.map((line) => (
        <MprLineEditHandles
          key={`mpr-line-controls-${line.id}`}
          line={line}
          axis={axis}
          currentSliceIndex={currentSliceIndex}
          selectedAnnotationId={selectedAnnotationId}
          handlers={handlers}
        />
      ))}
      {mprEditableSliceBoxes.map((box) => (
        <MprBoxEditHandles
          key={`mpr-box-controls-${box.id}`}
          box={box}
          axis={axis}
          currentSliceIndex={currentSliceIndex}
          selectedAnnotationId={selectedAnnotationId}
          handlers={handlers}
        />
      ))}
    </>
  );
}
