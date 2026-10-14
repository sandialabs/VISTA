import { makeMprCubeVertices } from './inspectionAnnotationGeometry';
import {
  DEFAULT_ANNOTATION_FILL_OPACITY,
  getAnnotationColor,
  getAnnotationFillOpacity,
} from './inspectionAnnotationDisplay';
import { clampRange } from './inspectionUtils';

/**
 * Pure request payload builders for inspection annotation create, update,
 * and style edits, plus measurement naming and classification.
 */

export const classifyMeasurementLine = (line) => {
  const dx = Math.abs(line.x2 - line.x1);
  const dy = Math.abs(line.y2 - line.y1);
  const horizontal = dy <= Math.max(dx, 1) * 0.1;
  const vertical = dx <= Math.max(dy, 1) * 0.1;
  if (horizontal) return 'Horizontal';
  if (vertical) return 'Vertical';
  return 'Diagonal';
};

export const getNextMeasurementName = (fullscreenMeasurements, kind) => {
  const count = fullscreenMeasurements.filter((item) => item.kind === kind).length + 1;
  return `${kind} line ${count}`;
};

export const buildManualAnnotationPayload = ({
  annotationDraft,
  customDefectTypeDraft,
  enabledModalities,
  modalityOptions,
}) => {
  const measurementName = annotationDraft.measurement_name.trim();
  const measurementValue = Number(annotationDraft.measurement_value);
  const measurements = measurementName && Number.isFinite(measurementValue)
    ? { [measurementName]: Number(measurementValue.toFixed(2)) }
    : {};
  return {
    defect_class: (annotationDraft.defect_class === 'Other' ? (customDefectTypeDraft.trim() || 'Other') : annotationDraft.defect_class).trim(),
    modality: (annotationDraft.modality || enabledModalities[0] || modalityOptions[0] || 'visual').trim(),
    comment: annotationDraft.comment.trim() || null,
    disposition: annotationDraft.disposition,
    measurements,
    hidden: false,
  };
};

export const buildMeasurementAnnotationPayload = ({
  annotationImageId,
  line,
  name,
  color,
  distanceMm,
  modality,
  geometryPatch = {},
  metadataPatch = {},
}) => {
  const width = Math.abs(line.x2 - line.x1);
  const height = Math.abs(line.y2 - line.y1);
  const distancePixels = Math.sqrt((width ** 2) + (height ** 2));
  return {
    annotation_kind: 'measurement',
    image_id: annotationImageId ? String(annotationImageId) : null,
    defect_class: 'Measurement',
    modality,
    comment: name || 'Captured from measurement tool.',
    disposition: 'open',
    measurements: { length_px: Number(distancePixels.toFixed(2)), ...(Number.isFinite(distanceMm) ? { length_mm: Number(distanceMm.toFixed(2)) } : {}) },
    geometry: { ...geometryPatch, line },
    metadata: { measurement_color: color, annotation_color: color, ...metadataPatch },
    bbox: {
      x: Number(Math.min(line.x1, line.x2).toFixed(2)),
      y: Number(Math.min(line.y1, line.y2).toFixed(2)),
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
    },
    hidden: false,
  };
};

const getBoxMeasurements = (box, pixelsPerMm) => {
  const widthMm = pixelsPerMm > 0 ? box.width / pixelsPerMm : null;
  const heightMm = pixelsPerMm > 0 ? box.height / pixelsPerMm : null;
  return {
    width_px: Number(box.width.toFixed(2)),
    height_px: Number(box.height.toFixed(2)),
    ...(Number.isFinite(widthMm) ? { width_mm: Number(widthMm.toFixed(2)) } : {}),
    ...(Number.isFinite(heightMm) ? { height_mm: Number(heightMm.toFixed(2)) } : {}),
  };
};

const getRoundedBbox = (box) => ({
  x: Number(box.x.toFixed(2)),
  y: Number(box.y.toFixed(2)),
  width: Number(box.width.toFixed(2)),
  height: Number(box.height.toFixed(2)),
});

export const buildBoxAnnotationPayload = ({
  annotationImageId,
  box,
  name,
  color,
  modality,
  pixelsPerMm,
  defectClass = 'Bounding Box',
  geometryPatch = {},
  metadataPatch = {},
}) => ({
  image_id: annotationImageId ? String(annotationImageId) : null,
  defect_class: defectClass,
  modality,
  comment: name || 'Captured from draw box tool.',
  disposition: 'open',
  measurements: getBoxMeasurements(box, pixelsPerMm),
  geometry: {
    ...geometryPatch,
    imageWidth: box.imageWidth,
    imageHeight: box.imageHeight,
    box: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      imageWidth: box.imageWidth,
      imageHeight: box.imageHeight,
      ...(geometryPatch?.box || {}),
    },
  },
  metadata: { annotation_color: color, annotation_fill_opacity: DEFAULT_ANNOTATION_FILL_OPACITY, ...metadataPatch },
  bbox: getRoundedBbox(box),
  hidden: false,
});

/** Returns null when the two boxes do not span two distinct finite slices. */
export const buildCubeAnnotationPayload = ({ axis, firstBox, secondBox, color }) => {
  const firstSlice = Number(firstBox.sliceIndex);
  const secondSlice = Number(secondBox.sliceIndex);
  if (!Number.isFinite(firstSlice) || !Number.isFinite(secondSlice) || firstSlice === secondSlice) return null;
  const x = Math.min(firstBox.x, secondBox.x);
  const y = Math.min(firstBox.y, secondBox.y);
  const right = Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width);
  const bottom = Math.max(firstBox.y + firstBox.height, secondBox.y + secondBox.height);
  const width = right - x;
  const height = bottom - y;
  const cube = {
    axis,
    startSlice: Math.min(firstSlice, secondSlice),
    endSlice: Math.max(firstSlice, secondSlice),
    x,
    y,
    width,
    height,
    imageWidth: secondBox.imageWidth || firstBox.imageWidth,
    imageHeight: secondBox.imageHeight || firstBox.imageHeight,
    firstBox,
    secondBox,
    vertices: makeMprCubeVertices(axis, firstBox, secondBox),
  };
  return {
    image_id: null,
    defect_class: '3D Box',
    modality: 'volume',
    comment: 'Captured from 3D box tool.',
    disposition: 'open',
    measurements: {
      width_px: Number(width.toFixed(2)),
      height_px: Number(height.toFixed(2)),
      depth_slices: Math.abs(secondSlice - firstSlice),
    },
    geometry: { cube },
    metadata: { annotation_color: color, annotation_fill_opacity: DEFAULT_ANNOTATION_FILL_OPACITY },
    bbox: getRoundedBbox({ x, y, width, height }),
    hidden: false,
  };
};

export const buildMeasurementLineUpdatePayload = ({
  existingAnnotation,
  annotationImageId,
  calibratedLine,
  color,
}) => {
  const width = Math.abs(calibratedLine.x2 - calibratedLine.x1);
  const height = Math.abs(calibratedLine.y2 - calibratedLine.y1);
  const measurements = {
    length_px: Number(calibratedLine.distancePx.toFixed(2)),
    ...(Number.isFinite(calibratedLine.distanceMm) ? { length_mm: Number(calibratedLine.distanceMm.toFixed(2)) } : {}),
  };
  return {
    image_id: annotationImageId || calibratedLine.imageId,
    geometry: { ...(existingAnnotation?.geometry || {}), line: calibratedLine },
    measurements,
    metadata: {
      ...(existingAnnotation?.metadata || {}),
      measurement_color: color,
      annotation_color: color,
    },
    bbox: {
      x: Number(Math.min(calibratedLine.x1, calibratedLine.x2).toFixed(2)),
      y: Number(Math.min(calibratedLine.y1, calibratedLine.y2).toFixed(2)),
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
    },
  };
};

export const applyCalibratedMeasurementLine = (fullscreenMeasurements, lineId, calibratedLine, color) => (
  fullscreenMeasurements.map((item) => (String(item.id) === String(lineId)
    ? {
      ...item,
      ...calibratedLine,
      color,
      distancePx: calibratedLine.distancePx,
      distanceMm: calibratedLine.distanceMm,
    }
    : item))
);

export const buildBoxGeometryUpdatePayload = ({
  existingAnnotation,
  annotationImageId,
  nextBox,
  pixelsPerMm,
}) => ({
  image_id: annotationImageId ? String(annotationImageId) : null,
  geometry: {
    ...(existingAnnotation?.geometry || {}),
    imageWidth: nextBox.imageWidth,
    imageHeight: nextBox.imageHeight,
    ...(nextBox.axis ? { axis: nextBox.axis, slice_index: nextBox.sliceIndex } : {}),
    box: {
      x: nextBox.x,
      y: nextBox.y,
      width: nextBox.width,
      height: nextBox.height,
      imageWidth: nextBox.imageWidth,
      imageHeight: nextBox.imageHeight,
      ...(nextBox.axis ? { axis: nextBox.axis, slice_index: nextBox.sliceIndex } : {}),
    },
  },
  measurements: getBoxMeasurements(nextBox, pixelsPerMm),
  metadata: { ...(existingAnnotation?.metadata || {}), annotation_color: nextBox.color },
  bbox: getRoundedBbox(nextBox),
});

export const buildSourceImageOverlayStylePatch = (draft) => {
  const fillOpacity = clampRange(Number(draft.fill_opacity), 0, 1, 1);
  const color = getAnnotationColor({ metadata: { annotation_color: draft.color } }, '#a78bfa');
  return { overlay_color: color, overlay_opacity: fillOpacity };
};

/** Returns null when the edited annotation would have no defect class. */
export const buildAnnotationStylePayload = (selected, draft) => {
  const defectClass = String(draft.defect_class ?? selected.defect_class ?? '').trim();
  if (!defectClass) return null;
  const fillOpacity = clampRange(Number(draft.fill_opacity), 0, 1, getAnnotationFillOpacity(selected));
  const color = getAnnotationColor({ metadata: { annotation_color: draft.color } }, getAnnotationColor(selected));
  return {
    defect_class: defectClass,
    comment: draft.comment ?? selected.comment,
    measurements: selected.measurements || {},
    disposition: draft.disposition || selected.disposition || 'open',
    metadata: {
      ...(selected.metadata || {}),
      annotation_color: color,
      measurement_color: color,
      annotation_fill_opacity: fillOpacity,
    },
  };
};
