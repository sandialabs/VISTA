import {
  moveBoxCorner,
  moveLineEndpoint,
  translateBox,
  translateLine,
} from '../../utils/annotationGeometry';

const isPositiveFinite = (value) => Number.isFinite(value) && value > 0;

// Rescales a point measured on a rendered surface of surfaceWidth x surfaceHeight
// into the coordinate space the saved geometry was recorded in.
export function scalePointToGeometrySpace(point, surfaceWidth, surfaceHeight, geometry) {
  const geometryWidth = Number(geometry?.imageWidth);
  const geometryHeight = Number(geometry?.imageHeight);
  const width = Number(surfaceWidth);
  const height = Number(surfaceHeight);
  if (
    !point
    || !isPositiveFinite(geometryWidth)
    || !isPositiveFinite(geometryHeight)
    || !isPositiveFinite(width)
    || !isPositiveFinite(height)
  ) return null;
  return {
    x: point.x * (geometryWidth / width),
    y: point.y * (geometryHeight / height),
  };
}

// Applies a pointer position to an active line/box drag ({ kind, operation,
// source, startPoint }) and returns the previewed geometry, or null.
export function computeDraggedGeometry(drag, position) {
  const bounds = { width: drag.source.imageWidth, height: drag.source.imageHeight };
  const delta = {
    x: position.x - drag.startPoint.x,
    y: position.y - drag.startPoint.y,
  };
  if (drag.kind === 'line') {
    return drag.operation === 'translate'
      ? translateLine(drag.source, delta, bounds)
      : moveLineEndpoint(drag.source, drag.operation, position, bounds);
  }
  if (drag.kind === 'box') {
    return drag.operation === 'translate'
      ? translateBox(drag.source, delta, bounds)
      : moveBoxCorner(drag.source, drag.operation, position, bounds);
  }
  return null;
}

export function getLineLengthPx(line) {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

export function hasDraggedGeometryChanged(preview, source) {
  const comparisonFields = preview.kind === 'line'
    ? ['x1', 'y1', 'x2', 'y2']
    : ['x', 'y', 'width', 'height'];
  return comparisonFields.some((field) => (
    Number(preview.geometry[field]) !== Number(source[field])
  ));
}
