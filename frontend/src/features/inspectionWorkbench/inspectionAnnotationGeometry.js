import {
  DEFAULT_ANNOTATION_FRAME,
  projectAnnotationLine,
  projectAnnotationX,
  projectAnnotationY,
} from './annotationOverlayFrame';
import { MM_PER_INCH } from '../../utils/calibration';

export function makeMprCubeVertices(axis, firstBox, secondBox) {
  const lowerSlice = Math.min(Number(firstBox.sliceIndex), Number(secondBox.sliceIndex));
  const upperSlice = Math.max(Number(firstBox.sliceIndex), Number(secondBox.sliceIndex));
  const x = Math.min(Number(firstBox.x), Number(secondBox.x));
  const y = Math.min(Number(firstBox.y), Number(secondBox.y));
  const width = Math.max(Number(firstBox.x) + Number(firstBox.width), Number(secondBox.x) + Number(secondBox.width)) - x;
  const height = Math.max(Number(firstBox.y) + Number(firstBox.height), Number(secondBox.y) + Number(secondBox.height)) - y;
  const planeCorners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  const toVolumeVertex = (point, slice) => {
    if (axis === 'coronal') return { x: Number(point.x.toFixed(2)), y: slice, z: Number(point.y.toFixed(2)) };
    if (axis === 'sagittal') return { x: slice, y: Number(point.x.toFixed(2)), z: Number(point.y.toFixed(2)) };
    return { x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)), z: slice };
  };
  return [
    ...planeCorners.map((point) => toVolumeVertex(point, lowerSlice)),
    ...planeCorners.map((point) => toVolumeVertex(point, upperSlice)),
  ];
}

export function isFiniteMeasurementLine(line) {
  if (!line || typeof line !== 'object') return false;
  const values = [line.x1, line.y1, line.x2, line.y2, line.imageWidth, line.imageHeight];
  return values.every((value) => Number.isFinite(Number(value)));
}

export function isFiniteAnnotationBox(box) {
  if (!box || typeof box !== 'object') return false;
  const values = [box.x, box.y, box.width, box.height, box.imageWidth, box.imageHeight];
  return values.every((value) => Number.isFinite(Number(value))) && Number(box.width) > 0 && Number(box.height) > 0;
}

function formatMmValue(mmValue, unit) {
  if (unit === 'inches') {
    return `${(mmValue / MM_PER_INCH).toFixed(3)}"`;
  }
  return `${mmValue.toFixed(2)} mm`;
}

export function getMeasurementLineLabel(line, unit = 'mm') {
  if (Number.isFinite(Number(line?.distanceMm))) {
    return formatMmValue(Number(line.distanceMm), unit);
  }
  const distancePx = Number.isFinite(Number(line?.distancePx))
    ? Number(line.distancePx)
    : isFiniteMeasurementLine(line)
      ? Math.hypot(Number(line.x2) - Number(line.x1), Number(line.y2) - Number(line.y1))
      : null;
  return Number.isFinite(distancePx) ? `${distancePx.toFixed(1)} px` : '';
}

export function getAnnotationBoxWidthLabel(box, unit = 'mm') {
  if (Number.isFinite(Number(box?.widthMm))) {
    return `Width ${formatMmValue(Number(box.widthMm), unit)}`;
  }
  return `Width ${Number(box.width).toFixed(1)} px`;
}

export function getAnnotationBoxHeightLabel(box, unit = 'mm') {
  if (Number.isFinite(Number(box?.heightMm))) {
    return `Height ${formatMmValue(Number(box.heightMm), unit)}`;
  }
  return `Height ${Number(box.height).toFixed(1)} px`;
}

export function isBoundingBoxAnnotation(annotation) {
  const bbox = annotation?.bbox || annotation?.geometry?.box || annotation;
  if (!bbox || typeof bbox !== 'object') return false;
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(bbox[key])))
    && Number(bbox.width) > 0
    && Number(bbox.height) > 0;
}

export function getAnnotationCropBox(annotation) {
  const bbox = annotation?.bbox || annotation?.geometry?.box || annotation || {};
  const geometry = annotation?.geometry || {};
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width);
  const height = Number(bbox.height);
  const imageWidth = Number(geometry.imageWidth || bbox.imageWidth || geometry.box?.imageWidth || annotation?.imageWidth);
  const imageHeight = Number(geometry.imageHeight || bbox.imageHeight || geometry.box?.imageHeight || annotation?.imageHeight);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x,
    y,
    width,
    height,
    imageWidth: Number.isFinite(imageWidth) && imageWidth > 0 ? imageWidth : null,
    imageHeight: Number.isFinite(imageHeight) && imageHeight > 0 ? imageHeight : null,
  };
}

export function formatCropCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return String(Math.round(numeric * 100) / 100).replace(/\.0+$/, '');
}

export function sanitizeCropFilename(value) {
  return String(value || 'image')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'image';
}

export function getCropImageTitle(_annotation, parentImageName) {
  return `Child of ${parentImageName || 'image'}`;
}

export function getCropUploadFilename(annotation, parentImageName) {
  const box = getAnnotationCropBox(annotation);
  const title = `${formatCropCoordinate(box?.x)}_${formatCropCoordinate(box?.y)}_child of ${parentImageName || 'image'}`;
  return `${sanitizeCropFilename(title)}.png`;
}

// Approximate text metrics for the measurement label. The label box is only
// used to keep the text clear of its line, so a slightly generous estimate is
// preferred over an exact one.
const LABEL_CHAR_WIDTH_EM = 0.62;
const LABEL_ASCENT_EM = 0.8;
const LABEL_EDGE_PADDING = 4;

function estimateLabelSize(label, fontSize) {
  const text = String(label || '');
  return {
    width: Math.max(1, text.length) * fontSize * LABEL_CHAR_WIDTH_EM,
    height: fontSize,
  };
}

// Text anchoring that grows the label away from the line along `normal`.
function getLabelAlignment(normal) {
  const horizontal = normal.x > 0.35 ? 'start' : normal.x < -0.35 ? 'end' : 'middle';
  const vertical = normal.y < -0.35 ? 'above' : normal.y > 0.35 ? 'below' : 'center';
  return { horizontal, vertical };
}

// Label box corners relative to the anchor point for an alignment.
function getLabelBoxOffsets(size, alignment) {
  const left = alignment.horizontal === 'start' ? 0 : alignment.horizontal === 'end' ? -size.width : -size.width / 2;
  const top = alignment.vertical === 'above' ? -size.height : alignment.vertical === 'below' ? 0 : -size.height / 2;
  return { left, top, right: left + size.width, bottom: top + size.height };
}

function segmentIntersectsRect(p1, p2, rect) {
  const inside = (p) => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
  if (inside(p1) || inside(p2)) return true;
  // Liang-Barsky clipping of the segment against the rectangle.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, p1.x - rect.left],
    [dx, rect.right - p1.x],
    [-dy, p1.y - rect.top],
    [dy, rect.bottom - p1.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function placeLabelOnSide(midpoint, normal, size, margin, frame) {
  const alignment = getLabelAlignment(normal);
  const offsets = getLabelBoxOffsets(size, alignment);
  // Distance along the normal that puts every corner of the label box at least
  // `margin` beyond the line, so the line never runs through the text.
  const minProjection = Math.min(
    ...[offsets.left, offsets.right].flatMap((ox) => [offsets.top, offsets.bottom].map((oy) => (ox * normal.x) + (oy * normal.y))),
  );
  const distance = margin - minProjection;
  let left = midpoint.x + (normal.x * distance) + offsets.left;
  let top = midpoint.y + (normal.y * distance) + offsets.top;
  const unclampedLeft = left;
  const unclampedTop = top;
  left = Math.min(frame.width - LABEL_EDGE_PADDING - size.width, Math.max(LABEL_EDGE_PADDING, left));
  top = Math.min(frame.height - LABEL_EDGE_PADDING - size.height, Math.max(LABEL_EDGE_PADDING, top));
  return {
    alignment,
    rect: { left, top, right: left + size.width, bottom: top + size.height },
    shift: Math.hypot(left - unclampedLeft, top - unclampedTop),
  };
}

/**
 * Position of a measurement line's length label in overlay units.
 *
 * The label is placed beside the line's midpoint on the side that faces up the
 * screen (right for vertical lines) and is anchored so it grows away from the
 * line. The offset is large enough that no part of the (estimated) text box
 * touches the line at any angle. When the image edge would push the label back
 * onto the line, the opposite side is used instead.
 *
 * Returns the SVG text position (`x`, baseline `y`), its `textAnchor`, and the
 * estimated label `box` used for the clearance check.
 */
export function getMeasurementLabelViewBoxPosition(line, fontSize = 20, frame = DEFAULT_ANNOTATION_FRAME, label) {
  const size = Number(fontSize) > 0 ? Number(fontSize) : 20;
  const projected = projectAnnotationLine(line, frame);
  const p1 = { x: projected.x1, y: projected.y1 };
  const p2 = { x: projected.x2, y: projected.y2 };
  const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  // Unit normal pointing up the screen; straight up for a degenerate line.
  let normal = { x: 0, y: -1 };
  if (Number.isFinite(length) && length > 0) {
    normal = { x: (p2.y - p1.y) / length, y: -(p2.x - p1.x) / length };
    if (normal.y > 0 || (normal.y === 0 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y };
  }
  const labelSize = estimateLabelSize(label ?? getMeasurementLineLabel(line), size);
  // Clears the line stroke, the selected-line underlay, and the text halo.
  const margin = Math.max(8, size * 0.35);
  const candidates = [normal, { x: -normal.x, y: -normal.y }].map((side) => {
    const placement = placeLabelOnSide(midpoint, side, labelSize, margin, frame);
    const padded = {
      left: placement.rect.left - margin / 2,
      right: placement.rect.right + margin / 2,
      top: placement.rect.top - margin / 2,
      bottom: placement.rect.bottom + margin / 2,
    };
    return { ...placement, overlapsLine: length > 0 && segmentIntersectsRect(p1, p2, padded) };
  });
  const chosen = candidates.find((candidate) => !candidate.overlapsLine)
    || candidates.reduce((best, candidate) => (candidate.shift < best.shift ? candidate : best));
  // Anchor the text on the edge nearest the line so that if the real text is
  // wider than estimated it grows away from the line, not across it.
  const { horizontal } = chosen.alignment;
  const textAnchor = horizontal;
  const x = horizontal === 'start'
    ? chosen.rect.left
    : horizontal === 'end' ? chosen.rect.right : (chosen.rect.left + chosen.rect.right) / 2;
  return {
    x,
    y: chosen.rect.top + (labelSize.height * LABEL_ASCENT_EM),
    textAnchor,
    box: chosen.rect,
  };
}

export function getMeasurementEndpointViewBoxPosition(line, frame = DEFAULT_ANNOTATION_FRAME) {
  const projected = projectAnnotationLine(line, frame);
  return {
    start: { x: projected.x1, y: projected.y1 },
    end: { x: projected.x2, y: projected.y2 },
  };
}

export function getAnnotationBoxCornerPoints(box) {
  const x = Number(box?.x);
  const y = Number(box?.y);
  const width = Number(box?.width);
  const height = Number(box?.height);
  return {
    topLeft: { x, y },
    topRight: { x: x + width, y },
    bottomLeft: { x, y: y + height },
    bottomRight: { x: x + width, y: y + height },
  };
}

export function getAnnotationBoxCornerViewBoxPosition(box, frame = DEFAULT_ANNOTATION_FRAME) {
  return Object.entries(getAnnotationBoxCornerPoints(box)).reduce((acc, [corner, point]) => {
    acc[corner] = {
      x: projectAnnotationX(point.x, box?.imageWidth, frame),
      y: projectAnnotationY(point.y, box?.imageHeight, frame),
    };
    return acc;
  }, {});
}

export function getAnnotationBoxOppositeCornerName(corner) {
  return {
    topLeft: 'bottomRight',
    topRight: 'bottomLeft',
    bottomLeft: 'topRight',
    bottomRight: 'topLeft',
  }[corner];
}

export function makeBoxFromPoints(firstPoint, secondPoint) {
  if (!firstPoint || !secondPoint) return null;
  const x = Math.min(firstPoint.x, secondPoint.x);
  const y = Math.min(firstPoint.y, secondPoint.y);
  const width = Math.abs(secondPoint.x - firstPoint.x);
  const height = Math.abs(secondPoint.y - firstPoint.y);
  return {
    x,
    y,
    width,
    height,
    imageWidth: secondPoint.imageWidth || firstPoint.imageWidth,
    imageHeight: secondPoint.imageHeight || firstPoint.imageHeight,
  };
}

export function makeBoxFromMovedCorner(box, corner, point, naturalWidth, naturalHeight) {
  if (!isFiniteAnnotationBox(box) || !corner || !point) return null;
  const oppositeCorner = getAnnotationBoxOppositeCornerName(corner);
  const oppositePoint = getAnnotationBoxCornerPoints(box)[oppositeCorner];
  if (!oppositePoint) return null;
  return makeBoxFromPoints(
    { x: point.x, y: point.y, imageWidth: naturalWidth || box.imageWidth, imageHeight: naturalHeight || box.imageHeight },
    { x: oppositePoint.x, y: oppositePoint.y, imageWidth: naturalWidth || box.imageWidth, imageHeight: naturalHeight || box.imageHeight },
  );
}

export function getMeasurementLineWithDerivedLength(line, imageId, calibration) {
  if (!isFiniteMeasurementLine(line)) return null;
  const distancePx = Math.hypot(Number(line.x2) - Number(line.x1), Number(line.y2) - Number(line.y1));
  const pixelsPerMm = Number(calibration?.pixels_per_mm || 0);
  return {
    ...line,
    imageId: String(imageId || line.imageId || ''),
    distancePx,
    distanceMm: pixelsPerMm > 0 ? distancePx / pixelsPerMm : null,
  };
}
