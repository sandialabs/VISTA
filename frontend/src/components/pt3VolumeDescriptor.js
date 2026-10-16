import { normalizeVolumeMetadata } from './pt3VolumeGeometry';

export const PT3_VOLUME_DESCRIPTOR_SCHEMA_VERSION = 1;
export const PT3_VOLUME_AXES = Object.freeze(['axial', 'coronal', 'sagittal']);

const SOURCE_KINDS = new Set(['server-volume', 'slice-stack', 'synthetic']);
const SOURCE_FORMATS_BY_KIND = Object.freeze({
  'server-volume': new Set(['npy', 'npz', 'inspiro', 'tiff', 'unknown']),
  'slice-stack': new Set(['image-stack']),
  synthetic: new Set(['unknown']),
});
const SOURCE_INTERPRETATIONS_BY_KIND = Object.freeze({
  'server-volume': new Set(['voxel_array', 'stack_of_2d_images']),
  'slice-stack': new Set(['stack_of_2d_images']),
  synthetic: new Set(['synthetic']),
});
const MAX_BIT_DEPTH = 64;
const COLOR_LAYOUTS = Object.freeze({
  scalar: 1,
  rgb: 3,
  rgba: 4,
});
const IDENTITY_DIRECTION = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const DEFAULT_SYNTHETIC_DIMENSIONS = Object.freeze({
  axial: 64,
  coronal: 96,
  sagittal: 128,
});

function asObject(candidate) {
  return candidate && typeof candidate === 'object' ? candidate : {};
}

function candidateLayers(candidate) {
  const value = asObject(candidate);
  const metadata = asObject(value.metadata);
  return metadata === value ? [value] : [value, metadata];
}

function firstDefined(candidates, keys) {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
}

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 && Math.floor(numeric) === numeric
    ? numeric
    : null;
}

function normalizeAxisDimensions(candidate) {
  if (Array.isArray(candidate) && candidate.length === 3) {
    const sagittal = positiveInteger(candidate[0]);
    const coronal = positiveInteger(candidate[1]);
    const axial = positiveInteger(candidate[2]);
    return sagittal && coronal && axial ? { axial, coronal, sagittal } : null;
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const axial = positiveInteger(candidate.axial);
  const coronal = positiveInteger(candidate.coronal);
  const sagittal = positiveInteger(candidate.sagittal);
  return axial && coronal && sagittal ? { axial, coronal, sagittal } : null;
}

function dimensionsFromCandidate(candidate) {
  for (const layer of candidateLayers(candidate)) {
    const direct = [
      layer.dimensions,
      layer.volume_shape,
      layer.volumeShape,
      layer.shape,
      layer.mpr?.volume_shape,
    ].map(normalizeAxisDimensions).find(Boolean);
    if (direct) return direct;
    const axial = positiveInteger(layer.image_count ?? layer.depth ?? layer.frames);
    const coronal = positiveInteger(layer.height);
    const sagittal = positiveInteger(layer.width);
    if (axial && coronal && sagittal) return { axial, coronal, sagittal };
  }
  return null;
}

function dimensionsFromRealSplat(partMetadata) {
  const asset = asObject(asObject(partMetadata).pt3_real_splat_asset);
  const sourceDimensions = asset.source_dimensions;
  if (!Array.isArray(sourceDimensions) || sourceDimensions.length !== 3) return null;
  const axial = positiveInteger(sourceDimensions[0]);
  const coronal = positiveInteger(sourceDimensions[1]);
  const sagittal = positiveInteger(sourceDimensions[2]);
  return axial && coronal && sagittal ? { axial, coronal, sagittal } : null;
}

function dimensionsFromStack(imageStack) {
  if (!Array.isArray(imageStack) || imageStack.length === 0) return null;
  const declared = dimensionsFromCandidate(imageStack);
  if (declared) return declared;
  const first = asObject(imageStack[0]);
  const sagittal = positiveInteger(
    first.width
      ?? first.naturalWidth
      ?? first.image?.naturalWidth
      ?? first.image?.width
      ?? first.metadata?.width,
  );
  const coronal = positiveInteger(
    first.height
      ?? first.naturalHeight
      ?? first.image?.naturalHeight
      ?? first.image?.height
      ?? first.metadata?.height,
  );
  return sagittal && coronal
    ? { axial: imageStack.length, coronal, sagittal }
    : null;
}

function normalizeVec3(candidate, fallback, { allowNonPositive = false } = {}) {
  if (!Array.isArray(candidate) || candidate.length !== 3) return fallback.slice();
  const normalized = candidate.map(Number);
  return normalized.every((value) => (
    Number.isFinite(value) && (allowNonPositive || value > 0)
  )) ? normalized : fallback.slice();
}

function normalizeDirection(candidate) {
  if (!Array.isArray(candidate) || candidate.length !== 9) return IDENTITY_DIRECTION.slice();
  const normalized = candidate.map(Number);
  return normalized.every(Number.isFinite) ? normalized : IDENTITY_DIRECTION.slice();
}

function physicalCandidate(candidate) {
  const value = asObject(candidate);
  return [
    value.physical,
    value.pt3_volume_geometry,
    value.source_physical_space,
    value,
  ].map(asObject);
}

function resolvePhysical(candidates, partMetadata) {
  const realAsset = asObject(asObject(partMetadata).pt3_real_splat_asset);
  const layers = [
    ...candidates.flatMap(physicalCandidate),
    ...physicalCandidate(partMetadata),
    ...physicalCandidate(realAsset),
  ];
  return {
    spacing: normalizeVec3(
      firstDefined(layers, ['spacing', 'voxel_spacing']),
      [1, 1, 1],
    ),
    origin: normalizeVec3(
      firstDefined(layers, ['origin']),
      [0, 0, 0],
      { allowNonPositive: true },
    ),
    direction: normalizeDirection(firstDefined(layers, ['direction'])),
  };
}

function normalizeScalarRange(candidate) {
  if (!Array.isArray(candidate) || candidate.length < 2) return null;
  const min = Number(candidate[0]);
  const max = Number(candidate[1]);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? [min, max] : null;
}

function resolveColorLayout(candidates) {
  for (const candidate of candidates) {
    const layers = candidateLayers(candidate);
    const hasDeclaredColorMode = layers.some((layer) => (
      layer.color_mode !== undefined && layer.color_mode !== null
    ) || (
      layer.colorMode !== undefined && layer.colorMode !== null
    ));
    const hasDeclaredChannelCount = layers.some((layer) => (
      layer.channel_count !== undefined && layer.channel_count !== null
    ) || (
      layer.channelCount !== undefined && layer.channelCount !== null
    ));
    const declaredColorMode = firstDefined(layers, ['color_mode', 'colorMode']);
    const declaredChannelCount = firstDefined(layers, ['channel_count', 'channelCount']);
    if (!hasDeclaredColorMode && !hasDeclaredChannelCount) continue;

    // The first candidate that declares either field is authoritative. Do not
    // combine a malformed/partial probe with a stale persisted layout, because
    // that can reinterpret RGBA voxels as scalar data (or vice versa).
    const colorMode = String(declaredColorMode ?? '').trim().toLowerCase();
    const channelCount = positiveInteger(declaredChannelCount);
    return COLOR_LAYOUTS[colorMode] === channelCount
      ? { channelCount, colorMode }
      : null;
  }
  return null;
}

function resolveSamples(candidates, sourceKind) {
  const layers = candidates.flatMap(candidateLayers);
  const layout = resolveColorLayout(candidates)
    || (sourceKind === 'server-volume' ? null : { channelCount: 1, colorMode: 'scalar' });
  const explicitBitDepth = firstDefined(
    layers,
    ['bit_depth', 'bitDepth', 'metadata_bit_depth'],
  );
  const bitDepthValue = Number(explicitBitDepth);
  if (
    explicitBitDepth !== undefined
    && (
      !Number.isSafeInteger(bitDepthValue)
      || bitDepthValue <= 0
      || bitDepthValue > MAX_BIT_DEPTH
    )
  ) return null;
  const bitDepth = explicitBitDepth === undefined ? null : bitDepthValue;
  const dtype = String(firstDefined(layers, [
    'pixel_dtype',
    'voxel_dtype',
    'dtype',
    'scalar_type',
    'scalarType',
  ]) || (bitDepth === 16 ? 'uint16' : 'uint8'));
  const numpyByteWidth = Number(dtype.trim().toLowerCase().match(/[<>|]?[uif](1|2|4|8)$/)?.[1]);
  const resolvedBitDepth = bitDepth
    || Number(dtype.match(/(?:u?int|float)(8|16|32|64)/i)?.[1])
    || (numpyByteWidth ? numpyByteWidth * 8 : 0)
    || 8;
  const scalarRange = layers
    .map((layer) => normalizeScalarRange(
      layer.scalar_range
        ?? layer.scalarRange
        ?? layer.intensity_range
        ?? layer.value_range,
    ))
    .find(Boolean);
  const normalizedDtype = dtype.trim().toLowerCase();
  const isSignedInteger = /^int/i.test(normalizedDtype) || /[<>|]?i[1248]$/.test(normalizedDtype);
  const isUnsignedInteger = /^uint/i.test(normalizedDtype) || /[<>|]?u[1248]$/.test(normalizedDtype);
  const defaultScalarRange = isSignedInteger
    ? [-(2 ** (resolvedBitDepth - 1)), (2 ** (resolvedBitDepth - 1)) - 1]
    : isUnsignedInteger
      ? [0, (2 ** resolvedBitDepth) - 1]
      : [0, 1];
  return layout ? {
    dtype,
    bitDepth: resolvedBitDepth,
    scalarRange: scalarRange || defaultScalarRange,
    ...layout,
  } : null;
}

function formatFromFilename(filename, sourceKind, candidates) {
  const declared = String(firstDefined(
    candidates.flatMap(candidateLayers),
    ['format', 'source_kind'],
  ) || '').trim().toLowerCase();
  const extension = String(filename || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (extension === 'npy' || declared === 'npy') return 'npy';
  if (extension === 'npz' || declared === 'npz') return 'npz';
  if (extension === 'inspiro' || declared === 'inspiro') return 'inspiro';
  if (['tif', 'tiff'].includes(extension) || ['tif', 'tiff'].includes(declared)) return 'tiff';
  if (sourceKind === 'slice-stack') return 'image-stack';
  return 'unknown';
}

function inferSourceKind(sourceKind, sourceEntry, imageRecord, imageStack, allowSynthetic) {
  if (SOURCE_KINDS.has(sourceKind)) return sourceKind;
  if (sourceEntry?.kind && SOURCE_KINDS.has(sourceEntry.kind)) return sourceEntry.kind;
  const filename = String(sourceEntry?.filename || imageRecord?.filename || '').toLowerCase();
  if (
    /\.(npy|npz|inspiro|tif|tiff)$/.test(filename)
    || sourceEntry?.load_mode === 'volume'
    || sourceEntry?.metadata?.load_mode === 'volume'
    || sourceEntry?.tiff_dimensionality === '3d'
    || sourceEntry?.metadata?.tiff_dimensionality === '3d'
  ) return 'server-volume';
  if (Array.isArray(imageStack) && imageStack.length > 0) return 'slice-stack';
  return allowSynthetic ? 'synthetic' : null;
}

function freezeDescriptor(descriptor) {
  Object.freeze(descriptor.source);
  Object.freeze(descriptor.dimensions);
  Object.freeze(descriptor.physical.spacing);
  Object.freeze(descriptor.physical.origin);
  Object.freeze(descriptor.physical.direction);
  Object.freeze(descriptor.physical);
  Object.freeze(descriptor.samples.scalarRange);
  Object.freeze(descriptor.samples);
  return Object.freeze(descriptor);
}

/**
 * Resolve every PT3 volume source into one canonical descriptor. A server
 * source deliberately remains unresolved until both its shape and channel
 * layout are authoritative; callers can then probe it instead of silently
 * rendering guessed scalar data.
 */
export function createPt3VolumeDescriptor({
  sourceKind,
  sourceEntry = null,
  imageRecord = null,
  probeMetadata = null,
  partMetadata = null,
  imageStack = null,
  allowSynthetic = false,
} = {}) {
  const resolvedSourceKind = inferSourceKind(
    sourceKind,
    sourceEntry,
    imageRecord,
    imageStack,
    allowSynthetic,
  );
  if (!resolvedSourceKind) return null;

  // This order is the contract: an endpoint probe is more authoritative than
  // a persisted image record, which is more authoritative than part linkage.
  const resolutionCandidates = [
    probeMetadata,
    imageRecord,
    sourceEntry,
    partMetadata,
  ].filter(Boolean);
  let dimensions = resolutionCandidates.map(dimensionsFromCandidate).find(Boolean)
    || dimensionsFromRealSplat(partMetadata)
    || dimensionsFromStack(imageStack);
  if (!dimensions && resolvedSourceKind === 'synthetic' && allowSynthetic) {
    dimensions = { ...DEFAULT_SYNTHETIC_DIMENSIONS };
  }
  const samples = resolveSamples(resolutionCandidates, resolvedSourceKind);
  const resolvedImageId = String(
    firstDefined(
      [imageRecord, sourceEntry].filter(Boolean).flatMap(candidateLayers),
      ['id', 'image_id', 'imageId'],
    ) || '',
  );
  const imageId = resolvedSourceKind === 'server-volume'
    ? (resolvedImageId || null)
    : null;
  if (
    !dimensions
    || !samples
    || (resolvedSourceKind === 'server-volume' && !imageId)
  ) return null;

  const filename = String(firstDefined(
    [imageRecord, sourceEntry].filter(Boolean).flatMap(candidateLayers),
    ['filename'],
  ) || '');
  const format = formatFromFilename(
    filename,
    resolvedSourceKind,
    resolutionCandidates,
  );
  const declaredInterpretation = String(firstDefined(
    resolutionCandidates.flatMap(candidateLayers),
    ['interpretation'],
  ) || '').trim().toLowerCase();
  const interpretation = ['voxel_array', 'stack_of_2d_images', 'synthetic'].includes(declaredInterpretation)
    ? declaredInterpretation
    : resolvedSourceKind === 'synthetic'
      ? 'synthetic'
      : resolvedSourceKind === 'slice-stack'
        ? 'stack_of_2d_images'
        : 'voxel_array';

  const descriptor = {
    schemaVersion: PT3_VOLUME_DESCRIPTOR_SCHEMA_VERSION,
    source: {
      kind: resolvedSourceKind,
      imageId,
      filename,
      format,
      interpretation,
    },
    dimensions,
    physical: resolvePhysical(resolutionCandidates, partMetadata),
    samples,
  };
  return isPt3VolumeDescriptor(descriptor)
    ? freezeDescriptor(descriptor)
    : null;
}

export function isPt3VolumeDescriptor(candidate) {
  if (
    !candidate
    || candidate.schemaVersion !== PT3_VOLUME_DESCRIPTOR_SCHEMA_VERSION
    || !SOURCE_KINDS.has(candidate.source?.kind)
    || !candidate.dimensions
    || Array.isArray(candidate.dimensions)
  ) return false;
  const dimensionsValid = PT3_VOLUME_AXES.every((axis) => (
    typeof candidate.dimensions[axis] === 'number'
    && Number.isInteger(candidate.dimensions[axis])
    && candidate.dimensions[axis] > 0
  ));
  const vectorIsFinite = (vector, length, allowNonPositive = true) => (
    Array.isArray(vector)
    && vector.length === length
    && vector.every((value) => (
      typeof value === 'number'
      && Number.isFinite(value)
      && (allowNonPositive || value > 0)
    ))
  );
  const sourceImageIdValid = candidate.source.kind === 'server-volume'
    ? typeof candidate.source.imageId === 'string' && candidate.source.imageId.length > 0
    : candidate.source.imageId === null;
  const sourceContractValid = (
    typeof candidate.source.filename === 'string'
    && SOURCE_FORMATS_BY_KIND[candidate.source.kind]?.has(candidate.source.format)
    && SOURCE_INTERPRETATIONS_BY_KIND[candidate.source.kind]?.has(
      candidate.source.interpretation,
    )
  );
  const scalarRange = candidate.samples?.scalarRange;
  const samplesValid = (
    typeof candidate.samples?.dtype === 'string'
    && candidate.samples.dtype.length > 0
    && typeof candidate.samples.bitDepth === 'number'
    && Number.isSafeInteger(candidate.samples.bitDepth)
    && candidate.samples.bitDepth > 0
    && candidate.samples.bitDepth <= MAX_BIT_DEPTH
    && Array.isArray(scalarRange)
    && scalarRange.length === 2
    && scalarRange.every((value) => typeof value === 'number' && Number.isFinite(value))
    && scalarRange[1] > scalarRange[0]
    && COLOR_LAYOUTS[candidate.samples.colorMode] === candidate.samples.channelCount
  );
  return Boolean(
    dimensionsValid
    && sourceImageIdValid
    && sourceContractValid
    && vectorIsFinite(candidate.physical?.spacing, 3, false)
    && vectorIsFinite(candidate.physical?.origin, 3)
    && vectorIsFinite(candidate.physical?.direction, 9)
    && samplesValid
  );
}

export function getPt3AxisDimensions(descriptor) {
  if (!isPt3VolumeDescriptor(descriptor)) return null;
  return descriptor.dimensions;
}

/**
 * Compatibility adapter for geometry/rendering code. XYZ is always derived
 * from the one stored axis object: X=sagittal, Y=coronal, Z=axial.
 */
export function getPt3VolumeMetadata(descriptor, overrides = {}) {
  if (!isPt3VolumeDescriptor(descriptor)) return null;
  const { dimensions, physical, samples, source } = descriptor;
  return normalizeVolumeMetadata({
    ...overrides,
    dimensions: [dimensions.sagittal, dimensions.coronal, dimensions.axial],
    spacing: physical.spacing,
    origin: physical.origin,
    direction: physical.direction,
    scalarType: samples.dtype,
    scalarRange: samples.scalarRange,
    sourceId: overrides.sourceId || source.imageId || source.filename || source.kind,
  });
}

export function getPt3VolumeSliceUrl(
  descriptor,
  axis,
  index,
  { rendererVersion } = {},
) {
  if (!isPt3VolumeDescriptor(descriptor) || descriptor.source.kind !== 'server-volume') return '';
  const safeAxis = PT3_VOLUME_AXES.includes(axis) ? axis : 'axial';
  const upper = Math.max(0, descriptor.dimensions[safeAxis] - 1);
  const numericIndex = Math.round(Number(index) || 0);
  const safeIndex = Math.min(upper, Math.max(0, numericIndex));
  const params = new URLSearchParams({ axis: safeAxis, index: String(safeIndex) });
  if (rendererVersion) params.set('renderer', String(rendererVersion));
  return `/api/images/${encodeURIComponent(descriptor.source.imageId)}/volume-slice?${params.toString()}`;
}
