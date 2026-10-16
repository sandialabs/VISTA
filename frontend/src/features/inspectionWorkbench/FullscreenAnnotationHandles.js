import { getAnnotationBoxCornerViewBoxPosition, getMeasurementEndpointViewBoxPosition, getMeasurementLabelViewBoxPosition, getMeasurementLineLabel, getTextCounterScaleTransform } from './inspectionAnnotationGeometry';

export function FullscreenMeasurementLines({ readOnly, model, tools, display, fullscreenHandlers }) {
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
                      const labelPosition = getMeasurementLabelViewBoxPosition(line, 20);
                      const endpointPositions = getMeasurementEndpointViewBoxPosition(line);
                      const endpointActive = fullscreenEditingEndpoint?.lineId === String(line.id)
                        || String(fullscreenBoundsEditAnnotationId || '') === String(line.id);
                      return (
                        <g key={line.id}>
                          <line
                            x1={(line.x1 / line.imageWidth) * 1000}
                            y1={(line.y1 / line.imageHeight) * 1000}
                            x2={(line.x2 / line.imageWidth) * 1000}
                            y2={(line.y2 / line.imageHeight) * 1000}
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
                            transform={getTextCounterScaleTransform(labelPosition.x, labelPosition.y, line.imageWidth, line.imageHeight)}
                          >
                            {getMeasurementLineLabel(line, fullscreenAnnotationUnit)}
                          </text>
	                          {!readOnly && line.id !== 'fullscreen-measure-preview' && (
                            <line
                              className="inspection-annotation-drag-target"
                              x1={(line.x1 / line.imageWidth) * 1000}
                              y1={(line.y1 / line.imageHeight) * 1000}
                              x2={(line.x2 / line.imageWidth) * 1000}
                              y2={(line.y2 / line.imageHeight) * 1000}
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

export function FullscreenBoxHandles({ readOnly, model, tools, fullscreenHandlers }) {
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
                      const cornerPositions = getAnnotationBoxCornerViewBoxPosition(box);
                      const cornerActive = fullscreenEditingBoxCorner?.boxId === String(box.id)
                        || String(fullscreenBoundsEditAnnotationId || '') === String(box.id);
                      return (
                        <g key={`box-corners-${box.id}`}>
                          <rect
                            className="inspection-annotation-drag-target"
                            x={(box.x / box.imageWidth) * 1000}
                            y={(box.y / box.imageHeight) * 1000}
                            width={(box.width / box.imageWidth) * 1000}
                            height={(box.height / box.imageHeight) * 1000}
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
