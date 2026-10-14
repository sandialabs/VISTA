export const MEASUREMENT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
export const DEFAULT_ANNOTATION_COLOR = '#f97316';
export const DEFAULT_ANNOTATION_FILL_OPACITY = 0.5;
export const DEFAULT_ANNOTATION_TRANSPARENCY_PERCENT = 0;

export function getAnnotationColor(annotation, fallback = DEFAULT_ANNOTATION_COLOR) {
  const color = String(
    annotation?.metadata?.annotation_color
    || annotation?.metadata?.measurement_color
    || annotation?.color
    || fallback,
  ).trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

export function getAnnotationFillOpacity(annotation, fallback = DEFAULT_ANNOTATION_FILL_OPACITY) {
  const value = Number(annotation?.metadata?.annotation_fill_opacity ?? annotation?.fillOpacity ?? annotation?.fill_opacity);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function normalizeAnnotationTransparencyPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ANNOTATION_TRANSPARENCY_PERCENT;
  return Math.round(Math.min(100, Math.max(0, numeric)));
}

export function getAnnotationOpacityMultiplier(transparencyPercent) {
  return 1 - (normalizeAnnotationTransparencyPercent(transparencyPercent) / 100);
}

export function getAnnotationTransparencyPercent(annotation) {
  return normalizeAnnotationTransparencyPercent((1 - getAnnotationFillOpacity(annotation)) * 100);
}

export function getExternalOverlayOpacity(entry, fallback = 1) {
  const value = Number(
    entry?.overlay_opacity
    ?? entry?.overlayOpacity
    ?? entry?.metadata?.overlay_opacity
    ?? entry?.metadata?.overlayOpacity
    ?? entry?.opacity
    ?? fallback,
  );
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function parseHexRgb(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

export function getMeasurementLinesByImageId(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const imageId = annotation?.image_id;
    const line = annotation?.geometry?.line;
    if (!imageId || !line) return acc;
    const x1 = Number(line.x1);
    const y1 = Number(line.y1);
    const x2 = Number(line.x2);
    const y2 = Number(line.y2);
    const imageWidth = Number(line.imageWidth);
    const imageHeight = Number(line.imageHeight);
    if (![x1, y1, x2, y2, imageWidth, imageHeight].every(Number.isFinite)) return acc;
    const lengthMm = Number(annotation?.measurements?.length_mm);
    const providedLengthPx = Number(annotation?.measurements?.length_px);
    const distancePx = Number.isFinite(providedLengthPx)
      ? providedLengthPx
      : Math.hypot(x2 - x1, y2 - y1);
    const key = String(imageId);
    const lineIndex = (acc[key] || []).length;
    const color = getAnnotationColor(annotation, MEASUREMENT_COLORS[lineIndex % MEASUREMENT_COLORS.length]);
    const entry = {
      id: String(annotation.id || `${imageId}-${x1}-${y1}`),
      imageId: key,
      name: annotation?.comment || `Measurement ${lineIndex + 1}`,
      kind: annotation?.defect_class || 'Measurement',
      x1,
      y1,
      x2,
      y2,
      imageWidth,
      imageHeight,
      color,
      opacity: getAnnotationFillOpacity(annotation, 1),
      axis: line.axis || annotation?.geometry?.axis || '',
      sliceIndex: Number.isFinite(Number(line.slice_index ?? line.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex))
        ? Number(line.slice_index ?? line.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex)
        : null,
      distanceMm: Number.isFinite(lengthMm) ? lengthMm : null,
      distancePx,
    };
    acc[key] = [...(acc[key] || []), entry];
    return acc;
  }, {});
}

export function getBoxAnnotationsByImageId(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const imageId = annotation?.image_id;
    const bbox = annotation?.bbox;
    if (!imageId || !bbox) return acc;
    const x = Number(bbox.x);
    const y = Number(bbox.y);
    const width = Number(bbox.width);
    const height = Number(bbox.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return acc;
    const imageWidth = Number(annotation?.geometry?.imageWidth || annotation?.geometry?.box?.imageWidth || bbox.imageWidth);
    const imageHeight = Number(annotation?.geometry?.imageHeight || annotation?.geometry?.box?.imageHeight || bbox.imageHeight);
    if (![imageWidth, imageHeight].every(Number.isFinite) || imageWidth <= 0 || imageHeight <= 0) return acc;
    const key = String(imageId);
    const boxIndex = (acc[key] || []).length;
    const color = getAnnotationColor(annotation, MEASUREMENT_COLORS[boxIndex % MEASUREMENT_COLORS.length]);
    const widthMm = Number(annotation?.measurements?.width_mm);
    const heightMm = Number(annotation?.measurements?.height_mm);
    const entry = {
      id: String(annotation.id || `${imageId}-${x}-${y}`),
      imageId: key,
      name: annotation?.comment || annotation?.defect_class || `Box ${boxIndex + 1}`,
      x,
      y,
      width,
      height,
      imageWidth,
      imageHeight,
      color,
      fillOpacity: getAnnotationFillOpacity(annotation),
      axis: annotation?.geometry?.box?.axis || annotation?.geometry?.axis || '',
      sliceIndex: Number.isFinite(Number(annotation?.geometry?.box?.slice_index ?? annotation?.geometry?.box?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex))
        ? Number(annotation?.geometry?.box?.slice_index ?? annotation?.geometry?.box?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex)
        : null,
      widthMm: Number.isFinite(widthMm) ? widthMm : null,
      heightMm: Number.isFinite(heightMm) ? heightMm : null,
    };
    acc[key] = [...(acc[key] || []), entry];
    return acc;
  }, {});
}

export function getInspectionOverlayStyleTarget(item) {
  if (!item) return null;
  if (item.source?.resource === 'annotation') {
    return { resource: 'annotation', resourceId: String(item.source.resourceId || item.id || '') };
  }
  if (item.source?.resource === 'source_image') {
    return { resource: 'source_image', resourceId: String(item.source.resourceId || '').trim() };
  }
  return null;
}

export function getInspectionOverlayStyleDraft(item) {
  if (!item) return null;
  if (item.source?.resource === 'source_image') {
    const opacity = getExternalOverlayOpacity(item.overlay, 1);
    return {
      id: item.id,
      resource: 'source_image',
      resourceId: item.source.resourceId,
      color: getAnnotationColor({ metadata: { annotation_color: item.color } }, '#a78bfa'),
      fill_opacity: opacity,
      transparency_percent: normalizeAnnotationTransparencyPercent((1 - opacity) * 100),
    };
  }
  const annotation = item.annotation;
  if (!annotation) return null;
  return {
    id: annotation.id,
    resource: 'annotation',
    resourceId: annotation.id,
    defect_class: String(annotation.defect_class || '').trim(),
    comment: annotation.comment || '',
    disposition: annotation.disposition || 'open',
    color: getAnnotationColor(annotation),
    fill_opacity: getAnnotationFillOpacity(annotation),
    transparency_percent: getAnnotationTransparencyPercent(annotation),
  };
}

export function getMprSliceKey(axis, sliceIndex) {
  return `${axis}:${Number(sliceIndex) || 0}`;
}

export function getMprMeasurementLinesBySlice(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const line = annotation?.geometry?.line;
    const axis = String(line?.axis || annotation?.geometry?.axis || '').trim();
    const sliceIndex = Number(line?.slice_index ?? line?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex);
    if (!axis || !Number.isFinite(sliceIndex)) return acc;
    const parsed = getMeasurementLinesByImageId([{ ...annotation, image_id: annotation?.image_id || getMprSliceKey(axis, sliceIndex) }]);
    const entry = Object.values(parsed)[0]?.[0];
    if (!entry) return acc;
    const key = getMprSliceKey(axis, sliceIndex);
    acc[key] = [...(acc[key] || []), { ...entry, axis, sliceIndex }];
    return acc;
  }, {});
}

export function getMprBoxAnnotationsBySlice(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const box = annotation?.geometry?.box;
    const axis = String(box?.axis || annotation?.geometry?.axis || '').trim();
    const sliceIndex = Number(box?.slice_index ?? box?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex);
    if (!axis || !Number.isFinite(sliceIndex)) return acc;
    const bbox = annotation?.bbox || box;
    const imageWidth = Number(annotation?.geometry?.imageWidth || box?.imageWidth || bbox?.imageWidth);
    const imageHeight = Number(annotation?.geometry?.imageHeight || box?.imageHeight || bbox?.imageHeight);
    const x = Number(bbox?.x);
    const y = Number(bbox?.y);
    const width = Number(bbox?.width);
    const height = Number(bbox?.height);
    if (![x, y, width, height, imageWidth, imageHeight].every(Number.isFinite) || width <= 0 || height <= 0) return acc;
    const key = getMprSliceKey(axis, sliceIndex);
    const boxIndex = (acc[key] || []).length;
    acc[key] = [...(acc[key] || []), {
      id: String(annotation.id || `${key}-${x}-${y}`),
      imageId: key,
      name: annotation?.comment || annotation?.defect_class || `Box ${boxIndex + 1}`,
      x,
      y,
      width,
      height,
      imageWidth,
      imageHeight,
      color: getAnnotationColor(annotation, MEASUREMENT_COLORS[boxIndex % MEASUREMENT_COLORS.length]),
      fillOpacity: getAnnotationFillOpacity(annotation),
      axis,
      sliceIndex,
    }];
    return acc;
  }, {});
}

export function getMprCubeAnnotations(annotations) {
  if (!Array.isArray(annotations)) return [];
  return annotations.map((annotation) => {
    const cube = annotation?.geometry?.cube;
    if (!cube || typeof cube !== 'object') return null;
    const axis = String(cube.axis || '').trim();
    const startSlice = Number(cube.startSlice ?? cube.start_slice);
    const endSlice = Number(cube.endSlice ?? cube.end_slice);
    const x = Number(cube.x);
    const y = Number(cube.y);
    const width = Number(cube.width);
    const height = Number(cube.height);
    const imageWidth = Number(cube.imageWidth || cube.image_width);
    const imageHeight = Number(cube.imageHeight || cube.image_height);
    if (!axis || ![startSlice, endSlice, x, y, width, height, imageWidth, imageHeight].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return {
      id: String(annotation.id || `${axis}-${startSlice}-${endSlice}-${x}-${y}`),
      axis,
      startSlice: Math.min(startSlice, endSlice),
      endSlice: Math.max(startSlice, endSlice),
      x,
      y,
      width,
      height,
      imageWidth,
      imageHeight,
      color: getAnnotationColor(annotation),
      fillOpacity: getAnnotationFillOpacity(annotation),
      name: annotation?.comment || annotation?.defect_class || 'Cube',
    };
  }).filter(Boolean);
}

export function getMprCubeBoxesForSlice(cubes, axis, sliceIndex) {
  return (Array.isArray(cubes) ? cubes : [])
    .filter((cube) => cube.axis === axis && Number(sliceIndex) >= cube.startSlice && Number(sliceIndex) <= cube.endSlice)
    .map((cube) => ({
      ...cube,
      id: `${cube.id}-${axis}-${sliceIndex}`,
      imageId: getMprSliceKey(axis, sliceIndex),
    }));
}
