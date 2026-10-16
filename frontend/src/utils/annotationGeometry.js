import { clamp } from './numbers';

const isFiniteNumber = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return Number.isFinite(Number(value));
};

const toFiniteNumber = (value) => (isFiniteNumber(value) ? Number(value) : null);

function getPointCoordinates(point) {
  if (!point || typeof point !== 'object') return null;
  const x = toFiniteNumber(point.x ?? point.clientX);
  const y = toFiniteNumber(point.y ?? point.clientY);
  return x === null || y === null ? null : { x, y };
}

function getSourceDimensions(widthOrDimensions, height) {
  const width = typeof widthOrDimensions === 'object' && widthOrDimensions !== null
    ? toFiniteNumber(widthOrDimensions.width ?? widthOrDimensions.imageWidth ?? widthOrDimensions.sourceWidth)
    : toFiniteNumber(widthOrDimensions);
  const resolvedHeight = typeof widthOrDimensions === 'object' && widthOrDimensions !== null
    ? toFiniteNumber(widthOrDimensions.height ?? widthOrDimensions.imageHeight ?? widthOrDimensions.sourceHeight)
    : toFiniteNumber(height);
  if (width === null || resolvedHeight === null || width <= 0 || resolvedHeight <= 0) return null;
  return { width, height: resolvedHeight };
}

function getGeometryBounds(geometry, explicitBounds) {
  return getSourceDimensions(
    explicitBounds || {
      width: geometry?.imageWidth,
      height: geometry?.imageHeight,
    },
  );
}

/**
 * Describe the painted rectangle for an object-fit: contain image/canvas.
 * The returned transform deliberately keeps mirrors as display-only state;
 * callers always receive and persist unmirrored source-pixel coordinates.
 */
export function getContainedImageTransform({
  elementRect,
  sourceWidth,
  sourceHeight,
  mirrorX = false,
  mirrorY = false,
} = {}) {
  const dimensions = getSourceDimensions(sourceWidth, sourceHeight);
  const left = toFiniteNumber(elementRect?.left ?? elementRect?.x);
  const top = toFiniteNumber(elementRect?.top ?? elementRect?.y);
  const elementWidth = toFiniteNumber(elementRect?.width);
  const elementHeight = toFiniteNumber(elementRect?.height);
  if (
    !dimensions
    || left === null
    || top === null
    || elementWidth === null
    || elementHeight === null
    || elementWidth <= 0
    || elementHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(elementWidth / dimensions.width, elementHeight / dimensions.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  const contentLeft = left + ((elementWidth - width) / 2);
  const contentTop = top + ((elementHeight - height) / 2);

  return {
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    scale,
    mirrorX: mirrorX === true,
    mirrorY: mirrorY === true,
    elementRect: {
      left,
      top,
      width: elementWidth,
      height: elementHeight,
      right: left + elementWidth,
      bottom: top + elementHeight,
    },
    contentRect: {
      left: contentLeft,
      top: contentTop,
      width,
      height,
      right: contentLeft + width,
      bottom: contentTop + height,
    },
  };
}

export const getContainedContentTransform = getContainedImageTransform;

export function clientPointToSource(
  transform,
  point,
  { rejectOutside = true, clamp: shouldClamp = false } = {},
) {
  const clientPoint = getPointCoordinates(point);
  const contentRect = transform?.contentRect;
  const sourceWidth = toFiniteNumber(transform?.sourceWidth);
  const sourceHeight = toFiniteNumber(transform?.sourceHeight);
  if (
    !clientPoint
    || !contentRect
    || sourceWidth === null
    || sourceHeight === null
    || sourceWidth <= 0
    || sourceHeight <= 0
    || ![contentRect.left, contentRect.top, contentRect.width, contentRect.height].every(isFiniteNumber)
    || Number(contentRect.width) <= 0
    || Number(contentRect.height) <= 0
  ) {
    return null;
  }

  const rawXFraction = (clientPoint.x - Number(contentRect.left)) / Number(contentRect.width);
  const rawYFraction = (clientPoint.y - Number(contentRect.top)) / Number(contentRect.height);
  const outside = rawXFraction < 0 || rawXFraction > 1 || rawYFraction < 0 || rawYFraction > 1;
  if (outside && rejectOutside && !shouldClamp) return null;

  let xFraction = shouldClamp ? clamp(rawXFraction, 0, 1) : rawXFraction;
  let yFraction = shouldClamp ? clamp(rawYFraction, 0, 1) : rawYFraction;
  if (transform.mirrorX === true) xFraction = 1 - xFraction;
  if (transform.mirrorY === true) yFraction = 1 - yFraction;

  return {
    x: xFraction * sourceWidth,
    y: yFraction * sourceHeight,
  };
}

export function sourcePointToClient(transform, point, { clamp: shouldClamp = false } = {}) {
  const sourcePoint = getPointCoordinates(point);
  const contentRect = transform?.contentRect;
  const sourceWidth = toFiniteNumber(transform?.sourceWidth);
  const sourceHeight = toFiniteNumber(transform?.sourceHeight);
  if (
    !sourcePoint
    || !contentRect
    || sourceWidth === null
    || sourceHeight === null
    || sourceWidth <= 0
    || sourceHeight <= 0
    || ![contentRect.left, contentRect.top, contentRect.width, contentRect.height].every(isFiniteNumber)
    || Number(contentRect.width) <= 0
    || Number(contentRect.height) <= 0
  ) {
    return null;
  }

  let xFraction = sourcePoint.x / sourceWidth;
  let yFraction = sourcePoint.y / sourceHeight;
  if (shouldClamp) {
    xFraction = clamp(xFraction, 0, 1);
    yFraction = clamp(yFraction, 0, 1);
  }
  if (transform.mirrorX === true) xFraction = 1 - xFraction;
  if (transform.mirrorY === true) yFraction = 1 - yFraction;

  return {
    x: Number(contentRect.left) + (xFraction * Number(contentRect.width)),
    y: Number(contentRect.top) + (yFraction * Number(contentRect.height)),
  };
}

function hasUsablePointerId(pointerId) {
  return Number.isInteger(pointerId) && pointerId >= 0;
}

export function safeSetPointerCapture(element, pointerId) {
  if (!element || typeof element.setPointerCapture !== 'function' || !hasUsablePointerId(pointerId)) {
    return false;
  }
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch (_) {
    return false;
  }
}

export function safeReleasePointerCapture(element, pointerId) {
  if (!element || typeof element.releasePointerCapture !== 'function' || !hasUsablePointerId(pointerId)) {
    return false;
  }
  try {
    if (typeof element.hasPointerCapture === 'function' && !element.hasPointerCapture(pointerId)) {
      return false;
    }
    element.releasePointerCapture(pointerId);
    return true;
  } catch (_) {
    return false;
  }
}

export const safeCapturePointer = safeSetPointerCapture;

function isFiniteLine(line) {
  return line && [line.x1, line.y1, line.x2, line.y2].every(isFiniteNumber);
}

function isFiniteBox(box) {
  return box
    && [box.x, box.y, box.width, box.height].every(isFiniteNumber)
    && Number(box.width) > 0
    && Number(box.height) > 0;
}

function clampLineToBounds(line, bounds) {
  return {
    ...line,
    x1: clamp(Number(line.x1), 0, bounds.width),
    y1: clamp(Number(line.y1), 0, bounds.height),
    x2: clamp(Number(line.x2), 0, bounds.width),
    y2: clamp(Number(line.y2), 0, bounds.height),
  };
}

export function moveLineEndpoint(line, endpoint, point, explicitBounds) {
  const bounds = getGeometryBounds(line, explicitBounds);
  const nextPoint = getPointCoordinates(point);
  if (!isFiniteLine(line) || !bounds || !nextPoint || !['start', 'end'].includes(endpoint)) return null;
  const boundedLine = clampLineToBounds(line, bounds);
  if (endpoint === 'start') {
    return {
      ...boundedLine,
      x1: clamp(nextPoint.x, 0, bounds.width),
      y1: clamp(nextPoint.y, 0, bounds.height),
    };
  }
  return {
    ...boundedLine,
    x2: clamp(nextPoint.x, 0, bounds.width),
    y2: clamp(nextPoint.y, 0, bounds.height),
  };
}

function getDelta(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const x = toFiniteNumber(delta.x ?? delta.dx);
  const y = toFiniteNumber(delta.y ?? delta.dy);
  return x === null || y === null ? null : { x, y };
}

export function translateLine(line, delta, explicitBounds) {
  const bounds = getGeometryBounds(line, explicitBounds);
  const movement = getDelta(delta);
  if (!isFiniteLine(line) || !bounds || !movement) return null;

  const x1 = Number(line.x1);
  const y1 = Number(line.y1);
  const x2 = Number(line.x2);
  const y2 = Number(line.y2);
  const minimumX = Math.min(x1, x2);
  const maximumX = Math.max(x1, x2);
  const minimumY = Math.min(y1, y2);
  const maximumY = Math.max(y1, y2);
  if ((maximumX - minimumX) > bounds.width || (maximumY - minimumY) > bounds.height) return null;

  const boundedDeltaX = clamp(movement.x, -minimumX, bounds.width - maximumX);
  const boundedDeltaY = clamp(movement.y, -minimumY, bounds.height - maximumY);
  return {
    ...line,
    x1: x1 + boundedDeltaX,
    y1: y1 + boundedDeltaY,
    x2: x2 + boundedDeltaX,
    y2: y2 + boundedDeltaY,
  };
}

const BOX_OPPOSITE_CORNERS = {
  topLeft: 'bottomRight',
  topRight: 'bottomLeft',
  bottomLeft: 'topRight',
  bottomRight: 'topLeft',
};

function getBoxCorners(box, bounds) {
  const left = clamp(Number(box.x), 0, bounds.width);
  const top = clamp(Number(box.y), 0, bounds.height);
  const right = clamp(Number(box.x) + Number(box.width), 0, bounds.width);
  const bottom = clamp(Number(box.y) + Number(box.height), 0, bounds.height);
  return {
    topLeft: { x: left, y: top },
    topRight: { x: right, y: top },
    bottomLeft: { x: left, y: bottom },
    bottomRight: { x: right, y: bottom },
  };
}

export function moveBoxCorner(box, corner, point, explicitBounds) {
  const bounds = getGeometryBounds(box, explicitBounds);
  const nextPoint = getPointCoordinates(point);
  const oppositeCorner = BOX_OPPOSITE_CORNERS[corner];
  if (!isFiniteBox(box) || !bounds || !nextPoint || !oppositeCorner) return null;

  const anchor = getBoxCorners(box, bounds)[oppositeCorner];
  const boundedPoint = {
    x: clamp(nextPoint.x, 0, bounds.width),
    y: clamp(nextPoint.y, 0, bounds.height),
  };
  const x = Math.min(anchor.x, boundedPoint.x);
  const y = Math.min(anchor.y, boundedPoint.y);
  const width = Math.max(anchor.x, boundedPoint.x) - x;
  const height = Math.max(anchor.y, boundedPoint.y) - y;
  if (width <= 0 || height <= 0) return null;
  return {
    ...box,
    x,
    y,
    width,
    height,
  };
}

export function translateBox(box, delta, explicitBounds) {
  const bounds = getGeometryBounds(box, explicitBounds);
  const movement = getDelta(delta);
  if (!isFiniteBox(box) || !bounds || !movement) return null;

  const width = Number(box.width);
  const height = Number(box.height);
  if (width > bounds.width || height > bounds.height) return null;
  return {
    ...box,
    x: clamp(Number(box.x) + movement.x, 0, bounds.width - width),
    y: clamp(Number(box.y) + movement.y, 0, bounds.height - height),
  };
}

function scaleDirectGeometry(geometry, fallbackSourceDimensions, targetDimensions) {
  const sourceDimensions = getSourceDimensions({
    width: geometry.imageWidth ?? fallbackSourceDimensions?.width,
    height: geometry.imageHeight ?? fallbackSourceDimensions?.height,
  });
  if (!sourceDimensions) return null;
  const scaleX = targetDimensions.width / sourceDimensions.width;
  const scaleY = targetDimensions.height / sourceDimensions.height;

  if (isFiniteLine(geometry)) {
    return {
      ...geometry,
      x1: Number(geometry.x1) * scaleX,
      y1: Number(geometry.y1) * scaleY,
      x2: Number(geometry.x2) * scaleX,
      y2: Number(geometry.y2) * scaleY,
      imageWidth: targetDimensions.width,
      imageHeight: targetDimensions.height,
    };
  }
  if (isFiniteBox(geometry)) {
    return {
      ...geometry,
      x: Number(geometry.x) * scaleX,
      y: Number(geometry.y) * scaleY,
      width: Number(geometry.width) * scaleX,
      height: Number(geometry.height) * scaleY,
      imageWidth: targetDimensions.width,
      imageHeight: targetDimensions.height,
    };
  }
  return null;
}

/**
 * Scale a direct line/box or an annotation geometry object containing line,
 * box, and/or bbox into the dimensions of the currently rendered source.
 */
export function scaleGeometryToSourceDimensions(geometry, widthOrDimensions, height) {
  if (!geometry || typeof geometry !== 'object') return null;
  const targetDimensions = getSourceDimensions(widthOrDimensions, height);
  if (!targetDimensions) return null;

  const direct = scaleDirectGeometry(geometry, null, targetDimensions);
  if (direct) return direct;

  const fallbackSourceDimensions = getSourceDimensions({
    width: geometry.imageWidth,
    height: geometry.imageHeight,
  });
  const hasNestedGeometry = geometry.line || geometry.box || geometry.bbox;
  if (!hasNestedGeometry) return null;

  const next = {
    ...geometry,
    imageWidth: targetDimensions.width,
    imageHeight: targetDimensions.height,
  };
  for (const key of ['line', 'box', 'bbox']) {
    if (!geometry[key]) continue;
    const scaled = scaleDirectGeometry(geometry[key], fallbackSourceDimensions, targetDimensions);
    if (!scaled) return null;
    next[key] = scaled;
  }
  return next;
}

export const normalizeGeometryToSource = scaleGeometryToSourceDimensions;
