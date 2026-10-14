const DEFAULT_SEGMENT_COLORS = [
  '#22c55e',
  '#38bdf8',
  '#f97316',
  '#e11d48',
  '#a855f7',
  '#14b8a6',
  '#facc15',
];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function clampOpacity(value, fallback = 0.72) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function normalizeColor(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length >= 3) {
    const channels = value.slice(0, 3).map((channel) => {
      const numeric = Number(channel);
      return Math.max(0, Math.min(255, numeric <= 1 ? numeric * 255 : numeric));
    });
    return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
  }
  return fallback;
}

function flattenSegmentationLabels(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const flattened = [];
  const pending = Array.from(value).reverse();
  while (pending.length > 0) {
    const label = pending.pop();
    if (Array.isArray(label) || ArrayBuffer.isView(label)) {
      const nested = Array.from(label);
      for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]);
      continue;
    }
    const numeric = Number(label);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) return null;
    flattened.push(numeric);
  }
  return flattened;
}

function isDense3dLabelVolume(value) {
  return Array.isArray(value) && value.every((slice) => (
    (Array.isArray(slice) || ArrayBuffer.isView(slice))
    && Array.from(slice).every((row) => Array.isArray(row) || ArrayBuffer.isView(row))
  ));
}

function normalizeLabelSlice(slice, index) {
  if (!isPlainObject(slice)) return null;
  const rawLabels = Array.isArray(slice.labels) || ArrayBuffer.isView(slice.labels)
    ? slice.labels
    : (Array.isArray(slice.data) || ArrayBuffer.isView(slice.data) ? slice.data : null);
  const labels = rawLabels ? flattenSegmentationLabels(rawLabels) : null;
  if (!labels?.length) return null;
  const rawSliceIndex = slice.slice_index ?? slice.sliceIndex ?? slice.index ?? index;
  const sliceIndex = Number.isFinite(Number(rawSliceIndex)) ? Number(rawSliceIndex) : index;
  return { labels, sliceIndex };
}

/**
 * Renderer-neutral PT3 segmentation contract. Empty or incomplete metadata is
 * intentionally normalized to an empty contract so today's unsegmented data
 * keeps the exact same visual path.
 */
export function normalizePt3Segmentation(input) {
  const metadata = isPlainObject(input?.metadata) ? input.metadata : (isPlainObject(input) ? input : {});
  const raw = isPlainObject(metadata.pt3_segmentation)
    ? metadata.pt3_segmentation
    : (isPlainObject(input?.pt3_segmentation) ? input.pt3_segmentation : {});
  const seen = new Set();
  const segments = (Array.isArray(raw.segments) ? raw.segments : []).reduce((result, segment, index) => {
    if (!isPlainObject(segment)) return result;
    const rawId = segment.id ?? segment.segment_id ?? segment.segmentId;
    if (rawId === undefined || rawId === null || String(rawId).trim() === '') return result;
    const normalizedId = typeof rawId === 'string' ? rawId.trim() : rawId;
    const id = Number(normalizedId);
    if (!Number.isInteger(id) || id < 1 || id > 255) return result;
    if (seen.has(id)) return result;
    seen.add(id);
    const label = firstString(segment.label, segment.name) || `Segment ${id}`;
    result.push({
      id,
      label,
      name: firstString(segment.name, segment.label) || label,
      color: normalizeColor(segment.color, DEFAULT_SEGMENT_COLORS[index % DEFAULT_SEGMENT_COLORS.length]),
      visible: segment.visible !== false,
      opacity: clampOpacity(segment.opacity),
    });
    return result;
  }, []);
  const rawLabelSlices = raw.label_slices ?? raw.labelSlices;
  const declaredLabelSlices = (Array.isArray(rawLabelSlices) ? rawLabelSlices : [])
    .map(normalizeLabelSlice)
    .filter(Boolean);
  const rawDenseLabels = [raw.labels, raw.label_volume, raw.voxel_labels].find(isDense3dLabelVolume) || [];
  const denseLabelSlices = rawDenseLabels
    .map((labels, sliceIndex) => {
      const flattened = flattenSegmentationLabels(labels);
      return flattened?.length ? { sliceIndex, labels: flattened } : null;
    })
    .filter(Boolean);
  const labelSlices = declaredLabelSlices.length > 0 ? declaredLabelSlices : denseLabelSlices;
  return { segments, labelSlices };
}

export function segmentColorToRgba(color, opacity = 1) {
  const fallback = [34, 197, 94];
  if (typeof color !== 'string') return [...fallback, clampOpacity(opacity, 1)];
  const normalized = color.trim();
  const shortHex = normalized.match(/^#([0-9a-f]{3})$/i);
  const longHex = normalized.match(/^#([0-9a-f]{6})$/i);
  if (shortHex) {
    const channels = shortHex[1].split('').map((value) => parseInt(`${value}${value}`, 16));
    return [...channels, clampOpacity(opacity, 1)];
  }
  if (longHex) {
    return [
      parseInt(longHex[1].slice(0, 2), 16),
      parseInt(longHex[1].slice(2, 4), 16),
      parseInt(longHex[1].slice(4, 6), 16),
      clampOpacity(opacity, 1),
    ];
  }
  const rgb = normalized.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return [
      Math.max(0, Math.min(255, Number(rgb[1]))),
      Math.max(0, Math.min(255, Number(rgb[2]))),
      Math.max(0, Math.min(255, Number(rgb[3]))),
      clampOpacity(rgb[4] === undefined ? opacity : Number(rgb[4]) * opacity, 1),
    ];
  }
  return [...fallback, clampOpacity(opacity, 1)];
}

export function getSegmentDisplayStyle(segmentId, segments = []) {
  if (segmentId === undefined || segmentId === null || String(segmentId).trim() === '') return null;
  return segments.find((segment) => String(segment.id) === String(segmentId)) || null;
}
