import { getAnnotationBoxCornerViewBoxPosition, getMeasurementEndpointViewBoxPosition, getMeasurementLabelViewBoxPosition, getMeasurementLineLabel } from './inspectionAnnotationGeometry';
import { DEFAULT_ANNOTATION_FRAME, projectAnnotationBox, projectAnnotationLine } from './annotationOverlayFrame';

export function FullscreenMeasurementLines({ readOnly, model, tools, display, fullscreenHandlers, frame = DEFAULT_ANNOTATION_FRAME }) {
  const {
    renderedFullscreenMeasurementLines,
    fullscreenPreviewLines,
    fullscreenAnnotationUnit,
  } = model;
  const {
    fullscreenEditingEndpoint,
    fullscreenBoundsEditAnnotationId,
  } = tools;
  const {
    annotationOpacityMultiplier,
  } = display;
  const {
    startFullscreenAnnotationDrag,
    handleFullscreenAnnotationDragMove,
    finishFullscreenAnnotationDrag,
    handleFullscreenEndpointDotClick,
  } = fullscreenHandlers;
  return (
    <>
	                    {[...renderedFullscreenMeasurementLines, ...fullscreenPreviewLines].map((line) => {
                      const labelPosition = getMeasurementLabelViewBoxPosition(line, 20, frame);
                      const endpointPositions = getMeasurementEndpointViewBoxPosition(line, frame);
                      const endpointActive = fullscreenEditingEndpoint?.lineId === String(line.id)
                        || String(fullscreenBoundsEditAnnotationId || '') === String(line.id);
                      return (
                        <g key={line.id}>
                          <line
                            {...projectAnnotationLine(line, frame)}
                            stroke={line.color}
                            strokeWidth="3"
                            pointerEvents="none"
                            opacity={annotationOpacityMultiplier}
                          />
                          <text
                            x={labelPosition.x}
                            y={labelPosition.y}
                            fill={line.color}
                            fontSize="20"
                            pointerEvents="none"
                            opacity={annotationOpacityMultiplier}
                          >
                            {getMeasurementLineLabel(line, fullscreenAnnotationUnit)}
                          </text>
	                          {!readOnly && line.id !== 'fullscreen-measure-preview' && (
                            <line
                              className="inspection-annotation-drag-target"
                              {...projectAnnotationLine(line, frame)}
                              stroke="transparent"
                              strokeWidth="24"
                              pointerEvents="stroke"
                              onPointerDown={(event) => startFullscreenAnnotationDrag(event, 'line', 'translate', line)}
                              onPointerMove={handleFullscreenAnnotationDragMove}
                              onPointerUp={finishFullscreenAnnotationDrag}
                              onPointerCancel={(event) => finishFullscreenAnnotationDrag(event, { cancel: true })}
                            />
                          )}
                          {!readOnly && endpointActive && ['start', 'end'].map((endpoint) => (
                            <circle
                              key={endpoint}
                              className="inspection-measurement-endpoint-dot"
                              cx={endpointPositions[endpoint].x}
                              cy={endpointPositions[endpoint].y}
                              r="11"
                              fill="#ffffff"
                              stroke={line.color}
                              strokeWidth="5"
                              role="button"
                              tabIndex={0}
                              aria-label={`Reposition ${endpoint} endpoint for ${line.name || 'measurement'}`}
                              onPointerDown={(event) => startFullscreenAnnotationDrag(event, 'line', endpoint, line)}
                              onPointerMove={handleFullscreenAnnotationDragMove}
                              onPointerUp={finishFullscreenAnnotationDrag}
                              onPointerCancel={(event) => finishFullscreenAnnotationDrag(event, { cancel: true })}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (event.detail === 0) handleFullscreenEndpointDotClick(event, line, endpoint);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  handleFullscreenEndpointDotClick(event, line, endpoint);
                                }
                              }}
                            />
                          ))}
                        </g>
	                      );
	                    })}
    </>
  );
}

export function FullscreenBoxHandles({ readOnly, model, tools, fullscreenHandlers, frame = DEFAULT_ANNOTATION_FRAME }) {
  const {
    renderedFullscreenBoxAnnotations,
  } = model;
  const {
    fullscreenEditingBoxCorner,
    fullscreenBoundsEditAnnotationId,
  } = tools;
  const {
    startFullscreenAnnotationDrag,
    handleFullscreenAnnotationDragMove,
    finishFullscreenAnnotationDrag,
    handleFullscreenBoxCornerDotClick,
  } = fullscreenHandlers;
  return (
    <>
                    {renderedFullscreenBoxAnnotations.map((box) => {
                      const cornerPositions = getAnnotationBoxCornerViewBoxPosition(box, frame);
                      const cornerActive = fullscreenEditingBoxCorner?.boxId === String(box.id)
                        || String(fullscreenBoundsEditAnnotationId || '') === String(box.id);
                      return (
                        <g key={`box-corners-${box.id}`}>
                          <rect
                            className="inspection-annotation-drag-target"
                            {...projectAnnotationBox(box, frame)}
                            fill="transparent"
                            pointerEvents={readOnly ? 'none' : 'all'}
                            onPointerDown={(event) => startFullscreenAnnotationDrag(event, 'box', 'translate', box)}
                            onPointerMove={handleFullscreenAnnotationDragMove}
                            onPointerUp={finishFullscreenAnnotationDrag}
                            onPointerCancel={(event) => finishFullscreenAnnotationDrag(event, { cancel: true })}
                          />
                          {!readOnly && cornerActive && Object.entries(cornerPositions).map(([corner, point]) => (
                            <circle
                              key={corner}
                              className="inspection-box-corner-dot"
                              cx={point.x}
                              cy={point.y}
                              r="11"
                              fill="#ffffff"
                              stroke={box.color}
                              strokeWidth="5"
                              role="button"
                              tabIndex={0}
                              aria-label={`Reposition ${corner} corner for ${box.name || 'bounding box'}`}
                              onPointerDown={(event) => startFullscreenAnnotationDrag(event, 'box', corner, box)}
                              onPointerMove={handleFullscreenAnnotationDragMove}
                              onPointerUp={finishFullscreenAnnotationDrag}
                              onPointerCancel={(event) => finishFullscreenAnnotationDrag(event, { cancel: true })}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (event.detail === 0) handleFullscreenBoxCornerDotClick(event, box, corner);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  handleFullscreenBoxCornerDotClick(event, box, corner);
                                }
                              }}
                            />
                          ))}
                        </g>
                      );
                    })}
    </>
  );
}
