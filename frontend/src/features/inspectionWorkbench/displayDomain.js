import { getImageMetadata } from '../../utils/calibration';
import { getProjectImageRecord } from './imageLookup';
import { clampRange } from './inspectionUtils';
import { getMprDimensions } from './volumeDescriptors';

const DEFAULT_DISPLAY_VALUE_DOMAIN = { min: 0, max: 255, step: 1, label: '8-bit image' };

function getNumericRangeFromCandidate(candidate) {
  if (!candidate) return null;
  if (Array.isArray(candidate) && candidate.length >= 2) {
    const min = Number(candidate[0]);
    const max = Number(candidate[1]);
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
  }
  if (typeof candidate !== 'object') return null;
  const min = Number(candidate.min ?? candidate.minimum ?? candidate.low ?? candidate.lower ?? candidate.min_value ?? candidate.range_min);
  const max = Number(candidate.max ?? candidate.maximum ?? candidate.high ?? candidate.upper ?? candidate.max_value ?? candidate.range_max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
}

function getDisplayDomainFromDtype(value) {
  const dtype = String(value || '').trim().toLowerCase();
  if (!dtype) return null;
  if (/uint8|\|u1|<u1|>u1|ubyte/.test(dtype)) return { min: 0, max: 255, step: 1, label: 'uint8' };
  if (/int8|\|i1|<i1|>i1/.test(dtype)) return { min: -128, max: 127, step: 1, label: 'int8' };
  if (/uint16|<u2|>u2|\|u2/.test(dtype)) return { min: 0, max: 65535, step: 1, label: 'uint16' };
  if (/uint32|<u4|>u4|\|u4/.test(dtype)) return { min: 0, max: 4294967295, step: 1, label: 'uint32' };
  if (/int16|<i2|>i2|\|i2/.test(dtype)) return { min: -32768, max: 32767, step: 1, label: 'int16' };
  if (/int32|<i4|>i4|\|i4/.test(dtype)) return { min: -2147483648, max: 2147483647, step: 1, label: 'int32' };
  if (/float|double|<f|>f|\|f/.test(dtype)) return { min: 0, max: 1, step: 0.001, label: dtype.includes('64') ? 'float64' : 'float' };
  return null;
}

function getDisplayDomainFromBitDepth(value, signed = false) {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits <= 0 || bits > 32) return null;
  if (signed) {
    const max = (2 ** (bits - 1)) - 1;
    return { min: -(2 ** (bits - 1)), max, step: 1, label: `int${bits}` };
  }
  return { min: 0, max: (2 ** bits) - 1, step: 1, label: `${bits}-bit` };
}

function getExplicitDisplayDomainFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const explicitRange = [
    metadata.data_value_range,
    metadata.voxel_value_range,
    metadata.pixel_value_range,
    metadata.scalar_range,
    metadata.value_range,
    metadata.intensity_range,
    metadata.display_range,
  ].map(getNumericRangeFromCandidate).find(Boolean);
  if (explicitRange) {
    const span = explicitRange.max - explicitRange.min;
    return {
      ...explicitRange,
      step: Number.isInteger(explicitRange.min) && Number.isInteger(explicitRange.max) ? 1 : Math.max(0.001, span / 1000),
      label: 'loaded image range',
    };
  }
  return null;
}

function getDisplayDomainFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const explicitRangeDomain = getExplicitDisplayDomainFromMetadata(metadata);
  if (explicitRangeDomain) return explicitRangeDomain;
  const dtypeDomain = getDisplayDomainFromDtype(
    metadata.voxel_dtype
      ?? metadata.pixel_dtype
      ?? metadata.data_dtype
      ?? metadata.dtype
      ?? metadata.pixel_type
      ?? metadata.data_type,
  );
  if (dtypeDomain) return dtypeDomain;
  const bitDepthDomain = getDisplayDomainFromBitDepth(
    metadata.bit_depth ?? metadata.bits_allocated ?? metadata.bits_per_sample,
    metadata.signed === true || String(metadata.pixel_representation || '').toLowerCase() === 'signed',
  );
  if (bitDepthDomain) return bitDepthDomain;
  return null;
}

function combineDisplayDomains(domains) {
  const validDomains = domains.filter(Boolean);
  if (validDomains.length === 0) return null;
  const min = Math.min(...validDomains.map((domain) => Number(domain.min)));
  const max = Math.max(...validDomains.map((domain) => Number(domain.max)));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const integerSteps = validDomains.every((domain) => Number(domain.step) === 1);
  return {
    min,
    max,
    step: integerSteps && Number.isInteger(min) && Number.isInteger(max) ? 1 : Math.max(0.001, (max - min) / 1000),
    label: 'loaded image range',
  };
}

function getSourceImageDisplayDomain(source, projectImageLookup = {}, explicitOnly = false) {
  const metadataCandidates = [source?.metadata, source];
  const imageRecord = getProjectImageRecord(projectImageLookup, source);
  metadataCandidates.push(getImageMetadata(imageRecord));
  for (const metadata of metadataCandidates) {
    const domain = explicitOnly ? getExplicitDisplayDomainFromMetadata(metadata) : getDisplayDomainFromMetadata(metadata);
    if (domain) return domain;
  }
  return null;
}

export function getPartDisplayValueDomain(part, projectImageLookup = {}) {
  const partExplicitDomain = getExplicitDisplayDomainFromMetadata(part?.metadata);
  if (partExplicitDomain) return partExplicitDomain;

  const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
  const sourceExplicitDomain = combineDisplayDomains(
    sourceImages.map((source) => getSourceImageDisplayDomain(source, projectImageLookup, true)),
  );
  if (sourceExplicitDomain) return sourceExplicitDomain;

  const partDomain = getDisplayDomainFromMetadata(part?.metadata);
  if (partDomain) return partDomain;

  for (const source of sourceImages) {
    const sourceDomain = getSourceImageDisplayDomain(source, projectImageLookup);
    if (sourceDomain) return sourceDomain;
  }

  return DEFAULT_DISPLAY_VALUE_DOMAIN;
}


function getNumericHistogramThreshold(metadata, domain) {
  const histogram = metadata?.histogram || metadata?.pixel_histogram || metadata?.intensity_histogram;
  const bins = Array.isArray(histogram?.bins) ? histogram.bins : Array.isArray(histogram?.bucket_edges) ? histogram.bucket_edges : null;
  const counts = Array.isArray(histogram?.counts) ? histogram.counts : Array.isArray(histogram?.buckets) ? histogram.buckets : null;
  if (!bins || !counts || counts.length === 0) return null;
  const numericCounts = counts.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
  const total = numericCounts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const target = total * 0.75;
  let cumulative = 0;
  for (let index = 0; index < numericCounts.length; index += 1) {
    cumulative += numericCounts[index];
    if (cumulative >= target) {
      const candidate = Number(bins[Math.min(index, bins.length - 1)]);
      if (Number.isFinite(candidate)) return clampRange(candidate, domain.min, domain.max, candidate);
    }
  }
  return null;
}

function getSplatDefaultThreshold(part, displayDomain) {
  const domain = getNormalizedDisplayDomain(displayDomain);
  const metadataCandidates = [part?.metadata];
  const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
  sourceImages.forEach((source) => metadataCandidates.push(source?.metadata, source));
  for (const metadata of metadataCandidates) {
    const threshold = getNumericHistogramThreshold(metadata, domain);
    if (threshold !== null) return threshold;
  }
  return domain.min + ((domain.max - domain.min) * 0.65);
}

export function getDefaultSplatParameters(part, displayDomain) {
  const domain = getNormalizedDisplayDomain(displayDomain);
  const dimensions = getMprDimensions(part);
  const voxelCount = Math.max(1, Number(dimensions.axial || 1) * Number(dimensions.coronal || 1) * Number(dimensions.sagittal || 1));
  const targetMaxSplats = Math.min(100000, Math.max(50000, Math.round(voxelCount * 0.08)));
  return {
    threshold: Math.round(getSplatDefaultThreshold(part, domain) / domain.step) * domain.step,
    intensityMin: domain.min,
    intensityMax: domain.max,
    opacityMin: 0.08,
    opacityMax: 0.95,
    downsample: Math.max(1, Math.ceil(Math.cbrt(voxelCount / targetMaxSplats))),
    maxSplats: targetMaxSplats,
    outputFormat: 'ply',
  };
}

export function getSplatParametersForPart(part, displayDomain, overridesByPart) {
  const defaults = getDefaultSplatParameters(part, displayDomain);
  const overrides = part?.id ? overridesByPart?.[part.id] : null;
  return { ...defaults, ...(overrides || {}) };
}

export function getNormalizedDisplayDomain(domain) {
  const min = Number(domain?.min);
  const max = Number(domain?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return DEFAULT_DISPLAY_VALUE_DOMAIN;
  const step = Number(domain?.step);
  return {
    min,
    max,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    label: domain?.label || DEFAULT_DISPLAY_VALUE_DOMAIN.label,
  };
}

export function formatWindowValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3).replace(/\.?0+$/, '');
}

export function normalizeDisplayWindow(candidate, domain, fallback) {
  const safeDomain = getNormalizedDisplayDomain(domain);
  const minimumGap = Math.min(safeDomain.step, safeDomain.max - safeDomain.min);
  const fallbackWindow = fallback && Number.isFinite(Number(fallback.min)) && Number.isFinite(Number(fallback.max))
    ? fallback
    : { min: safeDomain.min, max: safeDomain.max };
  const rawMin = Number(candidate?.min);
  const rawMax = Number(candidate?.max);
  let min = Number.isFinite(rawMin) ? rawMin : Number(fallbackWindow.min);
  let max = Number.isFinite(rawMax) ? rawMax : Number(fallbackWindow.max);
  min = clampRange(min, safeDomain.min, safeDomain.max - minimumGap, safeDomain.min);
  max = clampRange(max, min + minimumGap, safeDomain.max, safeDomain.max);
  return { min, max };
}

export function remapDisplayWindow(candidate, previousDomain, nextDomain) {
  const previous = getNormalizedDisplayDomain(previousDomain);
  const next = getNormalizedDisplayDomain(nextDomain);
  const windowRange = normalizeDisplayWindow(candidate, previous);
  const previousSpan = previous.max - previous.min;
  const nextSpan = next.max - next.min;
  const mapValue = (value) => {
    const ratio = (value - previous.min) / previousSpan;
    const unrounded = next.min + (ratio * nextSpan);
    return next.min + (Math.round((unrounded - next.min) / next.step) * next.step);
  };
  return normalizeDisplayWindow(
    { min: mapValue(windowRange.min), max: mapValue(windowRange.max) },
    next,
  );
}

export function getWindowPercent(value, domain) {
  const safeDomain = getNormalizedDisplayDomain(domain);
  return ((clampRange(value, safeDomain.min, safeDomain.max, safeDomain.min) - safeDomain.min) / (safeDomain.max - safeDomain.min)) * 100;
}

export function applyDisplayWindowToCanvasContext(ctx, width, height, displayWindow, displayDomain) {
  const domain = getNormalizedDisplayDomain(displayDomain);
  const windowRange = normalizeDisplayWindow(displayWindow, domain);
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const domainSpan = Math.max(Number.EPSILON, domain.max - domain.min);
  const displaySpan = Math.max(Number.EPSILON, windowRange.max - windowRange.min);

  for (let i = 0; i < data.length; i += 4) {
    const intensity = (data[i] * 0.2126) + (data[i + 1] * 0.7152) + (data[i + 2] * 0.0722);
    const sourceValue = domain.min + ((intensity / 255) * domainSpan);
    const clipped = Math.min(windowRange.max, Math.max(windowRange.min, sourceValue));
    const normalized = Math.round(((clipped - windowRange.min) / displaySpan) * 255);
    data[i] = normalized;
    data[i + 1] = normalized;
    data[i + 2] = normalized;
  }
  ctx.putImageData(imageData, 0, 0);
}
