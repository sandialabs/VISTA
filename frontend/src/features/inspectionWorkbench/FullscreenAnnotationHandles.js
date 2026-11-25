import { Fragment } from 'react';
import { getAnnotationBoxCornerViewBoxPosition, getMeasurementEndpointViewBoxPosition, getMeasurementLabelViewBoxPosition, getMeasurementLineLabel } from './inspectionAnnotationGeometry';
import { DEFAULT_ANNOTATION_FRAME, projectAnnotationBox, projectAnnotationLine } from './annotationOverlayFrame';
import { AnchorCenterDot, anchorRingProps } from './annotationAnchorHandle';
import { measurementLabelHaloProps } from './annotationOverlayRendering';

// While Draw Box, Measure, or Crop is active the tool owns the pointer:
// existing shapes render without hit targets, so a new shape can be drawn over
// them without grabbing them. Press Escape or click the tool again to edit.
function isFullscreenDrawToolActive(tools) {
  return Boolean(tools.fullscreenMeasureActive || tools.fullscreenBoxActive || tools.fullscreenCropActive);
}

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
  const editTargetsEnabled = !readOnly && !isFullscreenDrawToolActive(tools);
  return (
    <>
	                    {[...renderedFullscreenMeasurementLines, ...fullscreenPreviewLines].map((line) => {
                      const labelText = getMeasurementLineLabel(line, fullscreenAnnotationUnit);
                      const labelPosition = getMeasurementLabelViewBoxPosition(line, 20, frame, labelText);
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
                            className="inspection-measurement-label"
                            x={labelPosition.x}
                            y={labelPosition.y}
                            textAnchor={labelPosition.textAnchor}
                            fill={line.color}
                            fontSize="20"
                            pointerEvents="none"
                            opacity={annotationOpacityMultiplier}
                            {...measurementLabelHaloProps(20)}
                          >
                            {labelText}
                          </text>
	                          {editTargetsEnabled && line.id !== 'fullscreen-measure-preview' && (
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
                          {editTargetsEnabled && endpointActive && ['start', 'end'].map((endpoint) => (
                            <Fragment key={endpoint}>
                            <circle
                              className="inspection-measurement-endpoint-dot"
                              cx={endpointPositions[endpoint].x}
                              cy={endpointPositions[endpoint].y}
                              {...anchorRingProps(line.color)}
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
                            <AnchorCenterDot x={endpointPositions[endpoint].x} y={endpointPositions[endpoint].y} color={line.color} />
                            </Fragment>
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
  if (isFullscreenDrawToolActive(tools)) return null;
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
                            <Fragment key={corner}>
                            <circle
                              className="inspection-box-corner-dot"
                              cx={point.x}
                              cy={point.y}
                              {...anchorRingProps(box.color)}
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
                            <AnchorCenterDot x={point.x} y={point.y} color={box.color} />
                            </Fragment>
                          ))}
                        </g>
                      );
                    })}
    </>
  );
}
