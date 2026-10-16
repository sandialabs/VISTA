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

export function getTextCounterScaleTransform(x, y, imageWidth, imageHeight, rotationDegrees = 0) {
  const scaleX = Number(imageWidth) / 1000;
  const scaleY = Number(imageHeight) / 1000;
  const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  // Counter-scale glyphs by the inverse aspect ratio so the ambient non-uniform
  // scale(scaleX, scaleY) applied by the parent <g> stops stretching text, while
  // the geometric-mean target keeps the rendered size unchanged for square images
  // (scaleX === scaleY) and keeps (x, y) fixed so registration stays pixel-perfect.
  const sx = Math.sqrt(safeScaleY / safeScaleX);
  const sy = Math.sqrt(safeScaleX / safeScaleY);
  const rotation = rotationDegrees ? ` rotate(${rotationDegrees} ${x} ${y})` : '';
  return `translate(${x} ${y}) scale(${sx} ${sy}) translate(${-x} ${-y})${rotation}`;
}

export function getMeasurementLabelViewBoxPosition(line, fontSize = 20) {
  const x = ((Number(line.x1) + Number(line.x2)) / (2 * Number(line.imageWidth))) * 1000;
  const y = ((Number(line.y1) + Number(line.y2)) / (2 * Number(line.imageHeight))) * 1000 - 6;
  const inset = Math.max(12, fontSize + 4);
  return {
    x: Math.min(980, Math.max(20, x)),
    y: Math.min(980, Math.max(inset, y)),
  };
}

export function getMeasurementEndpointViewBoxPosition(line) {
  return {
    start: {
      x: (Number(line.x1) / Number(line.imageWidth)) * 1000,
      y: (Number(line.y1) / Number(line.imageHeight)) * 1000,
    },
    end: {
      x: (Number(line.x2) / Number(line.imageWidth)) * 1000,
      y: (Number(line.y2) / Number(line.imageHeight)) * 1000,
    },
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

export function getAnnotationBoxCornerViewBoxPosition(box) {
  const imageWidth = Number(box?.imageWidth);
  const imageHeight = Number(box?.imageHeight);
  return Object.entries(getAnnotationBoxCornerPoints(box)).reduce((acc, [corner, point]) => {
    acc[corner] = {
      x: (point.x / imageWidth) * 1000,
      y: (point.y / imageHeight) * 1000,
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
