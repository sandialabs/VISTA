import {
  getAnnotationBoxCornerViewBoxPosition,
  getAnnotationBoxHeightLabel,
  getAnnotationBoxWidthLabel,
  getMeasurementEndpointViewBoxPosition,
  getMeasurementLabelViewBoxPosition,
  getMeasurementLineLabel,
  isFiniteAnnotationBox,
  isFiniteMeasurementLine,
} from './inspectionAnnotationGeometry';
import {
  DEFAULT_ANNOTATION_FRAME,
  getAnnotationTextRotation,
  projectAnnotationBox,
  projectAnnotationLine,
} from './annotationOverlayFrame';
import { DEFAULT_ANNOTATION_FILL_OPACITY } from './inspectionAnnotationDisplay';

export function renderAnnotationOverlay({
  measurementLines = [],
  boxes = [],
  fontSize = 24,
  selectedAnnotationId = '',
  opacityMultiplier = 1,
  unit = 'mm',
  frame = DEFAULT_ANNOTATION_FRAME,
}) {
  const visualOpacity = Math.min(1, Math.max(0, Number(opacityMultiplier) || 0));
  return (
    <>
      {measurementLines.filter(isFiniteMeasurementLine).map((line) => {
        const labelPosition = getMeasurementLabelViewBoxPosition(line, fontSize, frame);
        const projected = projectAnnotationLine(line, frame);
        const isSelected = String(selectedAnnotationId || '') === String(line.id || '');
        const lineOpacity = Number.isFinite(Number(line.opacity)) ? Math.min(1, Math.max(0, Number(line.opacity))) : 1;
        return (
          <g key={`line-${line.id}`} className={isSelected ? 'inspection-annotation-selected' : ''} opacity={visualOpacity * lineOpacity}>
            {isSelected && <line {...projected} stroke="#ffffff" strokeWidth="10" />}
            <line {...projected} stroke={line.color} strokeWidth={isSelected ? '6' : '3'} />
            <text x={labelPosition.x} y={labelPosition.y} fill={line.color} fontSize={fontSize} fontWeight={isSelected ? '800' : '400'}>
              {getMeasurementLineLabel(line, unit)}
            </text>
          </g>
        );
      })}
      {boxes.filter(isFiniteAnnotationBox).map((box) => {
        const { x, y, width, height } = projectAnnotationBox(box, frame);
        const labelSize = Math.max(18, fontSize * 0.82);
        const isSelected = String(selectedAnnotationId || '') === String(box.id || '');
        const fillOpacity = Number.isFinite(Number(box.fillOpacity)) ? Math.min(1, Math.max(0, Number(box.fillOpacity))) : DEFAULT_ANNOTATION_FILL_OPACITY;
        return (
          <g key={`box-${box.id}`} className={isSelected ? 'inspection-annotation-selected' : ''} opacity={visualOpacity}>
            {isSelected && <rect x={x} y={y} width={width} height={height} fill={box.color} fillOpacity={Math.min(1, fillOpacity + 0.18)} stroke="#ffffff" strokeWidth="10" />}
            <rect x={x} y={y} width={width} height={height} fill={box.color} fillOpacity={fillOpacity} stroke={box.color} strokeWidth={isSelected ? '6' : '3'} />
            {(() => {
              const widthLabelX = Math.min(frame.width - 20, Math.max(20, x + (width / 2)));
              const widthLabelY = Math.max(24, y - 8);
              const heightLabelX = Math.min(frame.width - 20, x + width + 12);
              const heightLabelY = Math.min(frame.height - 20, y + (height / 2));
              return (
                <>
                  <text x={widthLabelX} y={widthLabelY} fill={box.color} fontSize={labelSize} fontWeight={isSelected ? '800' : '400'} textAnchor="middle">
                    {getAnnotationBoxWidthLabel(box, unit)}
                  </text>
                  <text x={heightLabelX} y={heightLabelY} fill={box.color} fontSize={labelSize} fontWeight={isSelected ? '800' : '400'} textAnchor="middle" transform={getAnnotationTextRotation(heightLabelX, heightLabelY, 90)}>
                    {getAnnotationBoxHeightLabel(box, unit)}
                  </text>
                </>
              );
            })()}
          </g>
        );
      })}
    </>
  );
}

export function renderTileAnnotationEditingTargets({
  measurementLines = [],
  boxes = [],
  selectedAnnotationId = '',
  onStartDrag,
  onDragMove,
  onDragFinish,
  onDragCancel,
  frame = DEFAULT_ANNOTATION_FRAME,
}) {
  const stopSyntheticClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <>
      {measurementLines.filter(isFiniteMeasurementLine).map((line) => {
        const selected = String(selectedAnnotationId || '') === String(line.id || '');
        const endpoints = getMeasurementEndpointViewBoxPosition(line, frame);
        return (
          <g key={`tile-line-edit-${line.id}`}>
            <line
              className="inspection-annotation-drag-target"
              {...projectAnnotationLine(line, frame)}
              stroke="transparent"
              strokeWidth="24"
              pointerEvents="stroke"
              aria-label={`Move tile measurement ${line.name || line.id || ''}`.trim()}
              onPointerDown={(event) => onStartDrag(event, 'line', 'translate', line)}
              onPointerMove={onDragMove}
              onPointerUp={onDragFinish}
              onPointerCancel={onDragCancel}
              onClick={stopSyntheticClick}
            />
            {selected && ['start', 'end'].map((endpoint) => (
              <circle
                key={endpoint}
                className="inspection-measurement-endpoint-dot"
                cx={endpoints[endpoint].x}
                cy={endpoints[endpoint].y}
                r="11"
                fill="#ffffff"
                stroke={line.color}
                strokeWidth="5"
                role="button"
                aria-label={`Reposition tile ${endpoint} endpoint for ${line.name || 'measurement'}`}
                onPointerDown={(event) => onStartDrag(event, 'line', endpoint, line)}
                onPointerMove={onDragMove}
                onPointerUp={onDragFinish}
                onPointerCancel={onDragCancel}
                onClick={stopSyntheticClick}
              />
            ))}
          </g>
        );
      })}
      {boxes.filter(isFiniteAnnotationBox).map((box) => {
        const selected = String(selectedAnnotationId || '') === String(box.id || '');
        const corners = getAnnotationBoxCornerViewBoxPosition(box, frame);
        return (
          <g key={`tile-box-edit-${box.id}`}>
            <rect
              className="inspection-annotation-drag-target"
              {...projectAnnotationBox(box, frame)}
              fill="transparent"
              pointerEvents="all"
              aria-label={`Move tile box ${box.name || box.id || ''}`.trim()}
              onPointerDown={(event) => onStartDrag(event, 'box', 'translate', box)}
              onPointerMove={onDragMove}
              onPointerUp={onDragFinish}
              onPointerCancel={onDragCancel}
              onClick={stopSyntheticClick}
            />
            {selected && Object.entries(corners).map(([corner, point]) => (
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
                aria-label={`Reposition tile ${corner} corner for ${box.name || 'bounding box'}`}
                onPointerDown={(event) => onStartDrag(event, 'box', corner, box)}
                onPointerMove={onDragMove}
                onPointerUp={onDragFinish}
                onPointerCancel={onDragCancel}
                onClick={stopSyntheticClick}
              />
            ))}
          </g>
        );
      })}
    </>
  );
}
