import { createPt3VolumeDescriptor, getPt3AxisDimensions, getPt3VolumeSliceUrl } from '../../components/pt3VolumeDescriptor';
import { getExternalOverlayOpacity } from './inspectionAnnotationDisplay';
import { parseMetadataBoolean } from '../../utils/imageIdentity';
import {
  MPR_AXES,
  MPR_FALLBACK_MODEL_SIZE,
  MPR_SERVER_VOLUME_KIND,
  MPR_VOLUME_SLICE_RENDER_VERSION,
  MPR_VOLUME_RENDER_SUMMARY_VERSION,
  MPR_VOLUME_RENDERER_MAX_SLICES,
} from './mprConstants';
import { getProjectImageRecord } from './imageLookup';
import { clampRange } from './inspectionUtils';
import { getMprFallbackModelCoordinate } from './mprGeometry';

function getVolumeShapeFromEntry(entry, projectImageLookup = {}) {
  const isValidShape = (candidate) => MPR_AXES.every((axis) => {
    const value = Number(candidate?.[axis]);
    return Number.isFinite(value) && value > 0 && Math.floor(value) === value;
  });
  const direct = entry?.volume_shape || entry?.metadata?.volume_shape;
  if (isValidShape(direct)) return direct;
  const record = getProjectImageRecord(projectImageLookup, entry);
  const authoritative = record?.volume_shape || record?.metadata?.volume_shape;
  return isValidShape(authoritative) ? authoritative : null;
}

function isVolumeFileEntry(entry, projectImageLookup = {}) {
  const record = getProjectImageRecord(projectImageLookup, entry) || {};
  const filename = String(entry?.filename || record.filename || '').toLowerCase();
  const hasExplicitSliceIndex = [
    entry?.slice_index,
    entry?.metadata?.slice_index,
    record?.slice_index,
    record?.metadata?.slice_index,
  ].some((value) => value !== undefined && value !== null && Number.isFinite(Number(value)));
  const isTiffVolumeCandidate = (filename.endsWith('.tif') || filename.endsWith('.tiff'))
    && !hasExplicitSliceIndex;
  return Boolean(
    entry?.load_mode === 'volume'
      || entry?.metadata?.load_mode === 'volume'
      || entry?.tiff_dimensionality === '3d'
      || entry?.metadata?.tiff_dimensionality === '3d'
      || filename.endsWith('.npy')
      || filename.endsWith('.npz')
      || filename.endsWith('.inspiro')
      || isTiffVolumeCandidate,
  );
}

export function getMprDimensions(part, projectImageLookup = {}) {
  const volumeSourceShape = (Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [])
    .filter((entry) => entry && !parseMetadataBoolean(entry.overlay))
    .map((entry) => getVolumeShapeFromEntry(entry, projectImageLookup))
    .find(Boolean);
  const raw = part?.metadata?.volume_shape || part?.metadata?.mpr?.volume_shape || volumeSourceShape || {};
  const dimensions = MPR_AXES.reduce((acc, axis) => {
    const value = Number(raw?.[axis]);
    acc[axis] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 128;
    return acc;
  }, {});
  return dimensions;
}

function getVolumeEntryImageId(entry, projectImageLookup = {}) {
  const imageId = entry?.image_id ? String(entry.image_id).trim() : '';
  if (imageId) {
    if (Object.keys(projectImageLookup).length === 0) return imageId;
    const record = getProjectImageRecord(projectImageLookup, { image_id: imageId });
    return record?.id ? String(record.id) : '';
  }
  const record = getProjectImageRecord(projectImageLookup, entry);
  return record?.id ? String(record.id) : '';
}

function getCanonicalServerVolumeDescriptor(entry, projectImageLookup = {}, probeMetadata = null) {
  const record = getProjectImageRecord(projectImageLookup, entry);
  const imageId = getVolumeEntryImageId(entry, projectImageLookup);
  return createPt3VolumeDescriptor({
    sourceKind: 'server-volume',
    sourceEntry: {
      ...entry,
      image_id: imageId,
      filename: String(entry?.filename || record?.filename || ''),
    },
    imageRecord: record,
    probeMetadata,
  });
}

export function normalizeServerVolumeDimensions(candidate = {}) {
  const compatibilityDimensions = Object.fromEntries(MPR_AXES.map((axis) => {
    const value = Number(candidate?.[axis]);
    return [axis, Number.isFinite(value) && value > 0 ? Math.floor(value) : 1];
  }));
  const descriptor = createPt3VolumeDescriptor({
    sourceKind: 'synthetic',
    partMetadata: { volume_shape: compatibilityDimensions },
    allowSynthetic: true,
  });
  const resolved = getPt3AxisDimensions(descriptor);
  return resolved
    ? { ...resolved }
    : { axial: 1, coronal: 1, sagittal: 1 };
}

function getServerVolumeColorLayout(entry, projectImageLookup = {}) {
  const record = getProjectImageRecord(projectImageLookup, entry);
  const descriptor = getCanonicalServerVolumeDescriptor(entry, projectImageLookup)
    || createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: {
        ...entry,
        image_id: getVolumeEntryImageId(entry, projectImageLookup) || 'layout-validation',
        volume_shape: getVolumeShapeFromEntry(entry, projectImageLookup)
          || { axial: 1, coronal: 1, sagittal: 1 },
      },
      imageRecord: record,
    });
  return descriptor ? {
    channelCount: descriptor.samples.channelCount,
    colorMode: descriptor.samples.colorMode,
  } : null;
}

function getVolumeColorLayout(entry, projectImageLookup = {}) {
  const layout = getServerVolumeColorLayout(entry, projectImageLookup);
  if (layout) return layout;
  return { channelCount: 1, colorMode: 'scalar' };
}

export function getVolumeMetadataProbeCandidates(part, projectImageLookup = {}) {
  const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
  return sourceImages
    .filter((entry) => entry && isVolumeFileEntry(entry, projectImageLookup))
    .filter((entry) => !getCanonicalServerVolumeDescriptor(entry, projectImageLookup))
    .map((entry) => ({
      entry,
      imageId: String(getVolumeEntryImageId(entry, projectImageLookup) || ''),
      filename: String(entry?.filename || getProjectImageRecord(projectImageLookup, entry)?.filename || ''),
    }));
}

export function normalizeProbedVolumeMetadata(payload) {
  const descriptor = createPt3VolumeDescriptor({
    sourceKind: 'server-volume',
    sourceEntry: {
      image_id: 'metadata-probe',
      filename: 'metadata-probe.npy',
    },
    probeMetadata: payload,
  });
  if (!descriptor) {
    throw new Error('Volume metadata response did not include valid dimensions and color layout');
  }
  const metadata = {
    volume_shape: getPt3AxisDimensions(descriptor),
    channel_count: descriptor.samples.channelCount,
    color_mode: descriptor.samples.colorMode,
  };
  [
    'pixel_dtype',
    'voxel_dtype',
    'bit_depth',
    'metadata_bit_depth',
    'source_kind',
    'interpretation',
    'image_count',
    'height',
    'width',
  ].forEach((key) => {
    if (payload?.[key] !== undefined && payload?.[key] !== null) metadata[key] = payload[key];
  });
  return metadata;
}

export function getServerVolumeSliceUrl(volume, axis, index) {
  if (!volume?.imageId) return '';
  if (volume.volumeDescriptor) {
    return getPt3VolumeSliceUrl(volume.volumeDescriptor, axis, index, {
      rendererVersion: MPR_VOLUME_SLICE_RENDER_VERSION,
    });
  }
  const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
  const dimensions = normalizeServerVolumeDimensions(volume.dimensions);
  const upper = Math.max(0, dimensions[safeAxis] - 1);
  const safeIndex = clampRange(Math.round(Number(index) || 0), 0, upper, 0);
  return `/api/images/${encodeURIComponent(String(volume.imageId))}/volume-slice?axis=${safeAxis}&index=${safeIndex}&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`;
}

export function createServerVolumeDescriptor(entry, projectImageLookup = {}, extra = {}) {
  const volumeDescriptor = getCanonicalServerVolumeDescriptor(entry, projectImageLookup);
  if (!volumeDescriptor || !isVolumeFileEntry(entry, projectImageLookup)) return null;
  const dimensions = getPt3AxisDimensions(volumeDescriptor);
  const descriptor = {
    kind: MPR_SERVER_VOLUME_KIND,
    id: volumeDescriptor.source.imageId,
    imageId: volumeDescriptor.source.imageId,
    filename: volumeDescriptor.source.filename,
    dimensions,
    channelCount: volumeDescriptor.samples.channelCount,
    colorMode: volumeDescriptor.samples.colorMode,
    volumeDescriptor,
    sliceIndex: Math.floor((dimensions.axial - 1) / 2),
    ...extra,
  };
  return {
    ...descriptor,
    url: getPt3VolumeSliceUrl(volumeDescriptor, 'axial', descriptor.sliceIndex, {
      rendererVersion: MPR_VOLUME_SLICE_RENDER_VERSION,
    }),
  };
}

export function isServerVolumeDescriptor(candidate) {
  return candidate?.kind === MPR_SERVER_VOLUME_KIND && Boolean(candidate?.imageId);
}

export function hasMprVolumeSource(source) {
  return isServerVolumeDescriptor(source) || (Array.isArray(source) && source.length > 0);
}

export function getMprVolumeSourceEntries(source) {
  if (isServerVolumeDescriptor(source)) return [source];
  return Array.isArray(source) ? source : [];
}

export function getVolumeSourceImages(part, projectImageLookup = {}) {
  const sourceImages = part?.metadata?.source_images;
  if (!Array.isArray(sourceImages)) return [];
  const serverVolume = sourceImages
    .filter((entry) => entry && !parseMetadataBoolean(entry.overlay))
    .map((entry) => createServerVolumeDescriptor(entry, projectImageLookup))
    .find(Boolean);
  if (serverVolume) return serverVolume;
  return sourceImages
    .filter((entry) => entry && !parseMetadataBoolean(entry.overlay))
    .map((entry, index) => {
      const filename = String(entry?.filename || '');
      const imageId = getVolumeEntryImageId(entry, projectImageLookup);
      if (!imageId) return null;
      const sliceIndex = Number(entry?.metadata?.slice_index ?? entry?.slice_index ?? index);
      const normalizedSliceIndex = Number.isFinite(sliceIndex) ? sliceIndex : index;
      if (isVolumeFileEntry(entry, projectImageLookup)) return null;
      return {
        id: String(imageId),
        filename,
        sliceIndex: normalizedSliceIndex,
        url: `/api/images/${encodeURIComponent(String(imageId))}/content`,
        ...getVolumeColorLayout(entry, projectImageLookup),
      };
    })
    .flat()
    .filter(Boolean)
    .sort((left, right) => left.sliceIndex - right.sliceIndex || left.filename.localeCompare(right.filename));
}

export function getVolumeOverlayStacks(part, projectImageLookup = {}) {
  const sourceImages = part?.metadata?.source_images;
  if (!Array.isArray(sourceImages)) return [];
  const analysisOutputs = Array.isArray(part?.metadata?.analysis_outputs)
    ? part.metadata.analysis_outputs
    : [];
  const baseRecords = sourceImages
    .filter((entry) => entry && !parseMetadataBoolean(entry.overlay))
    .map((entry) => ({
      imageId: getVolumeEntryImageId(entry, projectImageLookup),
      filename: String(entry?.filename || ''),
    }))
    .filter((record) => record.imageId);
  const baseIds = new Set(baseRecords.map((record) => record.imageId));
  const baseRecordsByFilename = baseRecords.reduce((acc, record) => {
    if (!record.filename) return acc;
    if (!acc.has(record.filename)) acc.set(record.filename, []);
    acc.get(record.filename).push(record);
    return acc;
  }, new Map());
  const overlays = [...sourceImages, ...analysisOutputs].filter((entry) => {
    if (!parseMetadataBoolean(entry?.overlay)) return false;
    const baseImageId = String(entry.overlay_base_image_id || '');
    const baseFilename = String(entry.overlay_base_filename || '');
    if (baseImageId) return baseIds.has(baseImageId);
    if (baseFilename) return (baseRecordsByFilename.get(baseFilename) || []).length === 1;
    return baseRecords.length === 1;
  });
  const stacksByOverlayImage = new Map();
  const serverVolumesByOverlayImage = new Map();
  overlays.forEach((entry, index) => {
    const imageId = getVolumeEntryImageId(entry, projectImageLookup);
    if (!imageId) return;
    const filename = String(entry?.filename || '');
    const sliceIndex = Number(entry?.metadata?.slice_index ?? entry?.slice_index ?? index);
    const key = imageId;
    const serverVolume = createServerVolumeDescriptor(entry, projectImageLookup, {
      overlayBaseImageId: String(entry.overlay_base_image_id || ''),
      overlayBaseFilename: String(entry.overlay_base_filename || ''),
      color: String(entry.overlay_color || entry.metadata?.overlay_color || ''),
      opacity: getExternalOverlayOpacity(entry, 1),
      overlayColor: String(entry.overlay_color || entry.metadata?.overlay_color || ''),
      overlayOpacity: getExternalOverlayOpacity(entry, 1),
      hidden: parseMetadataBoolean(entry.hidden),
    });
    if (serverVolume) {
      serverVolumesByOverlayImage.set(key, serverVolume);
      return;
    }
    if (isVolumeFileEntry(entry, projectImageLookup)) return;
    if (!stacksByOverlayImage.has(key)) stacksByOverlayImage.set(key, []);
    stacksByOverlayImage.get(key).push({
      id: String(imageId),
      filename,
      sliceIndex: Number.isFinite(sliceIndex) ? sliceIndex : index,
      url: `/api/images/${encodeURIComponent(String(imageId))}/content`,
      ...getVolumeColorLayout(entry, projectImageLookup),
      overlayBaseImageId: String(entry.overlay_base_image_id || ''),
      overlayBaseFilename: String(entry.overlay_base_filename || ''),
      color: String(entry.overlay_color || entry.metadata?.overlay_color || ''),
      opacity: getExternalOverlayOpacity(entry, 1),
      overlayColor: String(entry.overlay_color || entry.metadata?.overlay_color || ''),
      overlayOpacity: getExternalOverlayOpacity(entry, 1),
      hidden: parseMetadataBoolean(entry.hidden),
    });
  });
  return [
    ...Array.from(serverVolumesByOverlayImage.values()),
    ...Array.from(stacksByOverlayImage.entries()).map(([id, stack]) => ({
      id,
      hidden: stack.every((entry) => entry.hidden === true),
      stack: stack.sort((left, right) => left.sliceIndex - right.sliceIndex || left.filename.localeCompare(right.filename)),
    })),
  ];
}

export function getAlignedVolumeOverlayRendererStacks(
  overlayStacks,
  volumeRendererImageStack,
  dimensions = {},
  summariesByImageId = {},
) {
  if (!Array.isArray(overlayStacks) || !Array.isArray(volumeRendererImageStack)
    || volumeRendererImageStack.length === 0) return [];
  const baseSliceIndices = volumeRendererImageStack.map((entry, index) => {
    const sliceIndex = Number(entry?.sliceIndex);
    return Number.isFinite(sliceIndex) ? Math.floor(sliceIndex) : index;
  });
  const axialCount = Math.max(1, Number(dimensions?.axial) || baseSliceIndices.length);

  return overlayStacks.map((overlayEntry) => {
    if (isServerVolumeDescriptor(overlayEntry)) {
      const overlayAxialCount = Math.max(1, Number(overlayEntry.dimensions?.axial) || axialCount);
      const assignments = baseSliceIndices.map((baseSliceIndex) => {
        const normalizedIndex = axialCount <= 1 ? 0 : baseSliceIndex / (axialCount - 1);
        const sourceSliceIndex = clampRange(
          Math.round(normalizedIndex * Math.max(0, overlayAxialCount - 1)),
          0,
          overlayAxialCount - 1,
          0,
        );
        return {
          sourceSliceIndex,
          voxelSliceIndex: baseSliceIndex,
        };
      });
      const summary = summariesByImageId?.[String(overlayEntry.imageId)];
      const representatives = getVolumeSummaryRepresentativeIndices(
        summary,
        overlayAxialCount,
      );
      const claimedSlots = new Set();
      representatives.forEach((sourceSliceIndex) => {
        const voxelSliceIndex = overlayAxialCount <= 1
          ? 0
          : (sourceSliceIndex / (overlayAxialCount - 1)) * Math.max(0, axialCount - 1);
        const nearestSlot = baseSliceIndices
          .map((baseSliceIndex, slotIndex) => ({
            slotIndex,
            distance: Math.abs(baseSliceIndex - voxelSliceIndex),
          }))
          .filter(({ slotIndex }) => !claimedSlots.has(slotIndex))
          .sort((left, right) => left.distance - right.distance || left.slotIndex - right.slotIndex)[0];
        if (!nearestSlot) return;
        claimedSlots.add(nearestSlot.slotIndex);
        assignments[nearestSlot.slotIndex] = { sourceSliceIndex, voxelSliceIndex };
      });
      return baseSliceIndices.map((baseSliceIndex, slotIndex) => {
        const { sourceSliceIndex, voxelSliceIndex } = assignments[slotIndex];
        return {
          ...overlayEntry,
          id: `${overlayEntry.imageId}:axial:${sourceSliceIndex}:slot:${slotIndex}`,
          // Keep the stack sort key aligned with the immutable base slots.
          sliceIndex: baseSliceIndex,
          sourceSliceIndex,
          voxelSliceIndex,
          url: getServerVolumeSliceUrl(overlayEntry, 'axial', sourceSliceIndex),
          depth: getMprFallbackModelCoordinate(
            voxelSliceIndex,
            axialCount,
            MPR_FALLBACK_MODEL_SIZE.depth,
          ),
          opacity: 1,
        };
      });
    }

    const sourceStack = Array.isArray(overlayEntry?.stack)
      ? overlayEntry.stack
      : (Array.isArray(overlayEntry) ? overlayEntry : []);
    if (sourceStack.length === 0) return [];
    const ordered = [...sourceStack].sort((left, right) => (
      Number(left?.sliceIndex || 0) - Number(right?.sliceIndex || 0)
    ));
    return baseSliceIndices.map((baseSliceIndex) => {
      const exact = ordered.find((entry, index) => (
        Number(entry?.sliceIndex ?? index) === baseSliceIndex
      ));
      const closest = exact || ordered.reduce((best, entry, index) => {
        const distance = Math.abs(Number(entry?.sliceIndex ?? index) - baseSliceIndex);
        return !best || distance < best.distance ? { entry, distance } : best;
      }, null)?.entry;
      if (!closest) return null;
      const sourceSliceIndex = Number(closest?.sourceSliceIndex ?? closest?.sliceIndex);
      return {
        ...closest,
        sliceIndex: baseSliceIndex,
        sourceSliceIndex: Number.isFinite(sourceSliceIndex) ? sourceSliceIndex : baseSliceIndex,
        voxelSliceIndex: baseSliceIndex,
        depth: getMprFallbackModelCoordinate(
          baseSliceIndex,
          axialCount,
          MPR_FALLBACK_MODEL_SIZE.depth,
        ),
        opacity: 1,
      };
    }).filter(Boolean);
  }).filter((stack) => stack.length === volumeRendererImageStack.length);
}

export function getVolumeSummaryRepresentativeIndices(summary, axialCount) {
  if (Number(summary?.summary_version) !== MPR_VOLUME_RENDER_SUMMARY_VERSION) return [];
  const safeAxialCount = Math.max(1, Math.floor(Number(axialCount) || 1));
  const channelRepresentatives = Array.isArray(summary?.channel_representatives)
    ? summary.channel_representatives.slice(0, 4).map((entry) => entry?.axial_index)
    : [];
  const candidates = channelRepresentatives.length > 0
    ? channelRepresentatives
    : (Array.isArray(summary?.representative_axial_indices)
      ? summary.representative_axial_indices.slice(0, 4)
      : []);
  const representatives = [];
  candidates.forEach((candidate) => {
    const sourceSliceIndex = Math.round(Number(candidate));
    if (
      Number.isFinite(sourceSliceIndex)
      && sourceSliceIndex >= 0
      && sourceSliceIndex < safeAxialCount
      && !representatives.includes(sourceSliceIndex)
    ) representatives.push(sourceSliceIndex);
  });
  return representatives;
}

export function isRenderableVolumeOverlay(overlayEntry) {
  if (isServerVolumeDescriptor(overlayEntry)) {
    return ['rgba', 'rgb', 'scalar'].includes(String(overlayEntry.colorMode || '').toLowerCase());
  }
  const stack = Array.isArray(overlayEntry?.stack)
    ? overlayEntry.stack
    : (Array.isArray(overlayEntry) ? overlayEntry : []);
  return stack.length > 0 && stack.every((entry) => (
    (entry?.channelCount === undefined && entry?.colorMode === undefined)
    || ['rgba', 'rgb', 'scalar'].includes(String(entry?.colorMode || '').toLowerCase())
  ));
}

export function getSemantic3dVolumeOverlayStacks(overlayStacks, maxStacks = 4) {
  const safeLimit = Math.min(4, Math.max(0, Math.floor(Number(maxStacks) || 0)));
  return (Array.isArray(overlayStacks) ? overlayStacks : [])
    .filter(isRenderableVolumeOverlay)
    .slice(0, safeLimit);
}

export async function mapWithConcurrency(items, concurrency, task) {
  const source = Array.isArray(items) ? items : [];
  if (source.length === 0) return [];
  const results = new Array(source.length);
  let cursor = 0;
  const workerCount = Math.min(
    source.length,
    Math.max(1, Math.floor(Number(concurrency) || 1)),
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(source[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function getVolumeRendererSliceIndices(
  axialCount,
  maxLayers = MPR_VOLUME_RENDERER_MAX_SLICES,
) {
  const safeAxialCount = Math.max(1, Math.floor(Number(axialCount) || 1));
  const safeMaxLayers = Math.min(
    MPR_VOLUME_RENDERER_MAX_SLICES,
    Math.max(1, Math.floor(Number(maxLayers) || MPR_VOLUME_RENDERER_MAX_SLICES)),
    safeAxialCount,
  );
  return safeMaxLayers <= 1
    ? [Math.floor((safeAxialCount - 1) / 2)]
    : Array.from({ length: safeMaxLayers }, (_unused, index) => Math.round(
      (index * (safeAxialCount - 1)) / (safeMaxLayers - 1),
    ));
}

export function getMprAxisImageDimensions(axis, dimensions = {}, volumeCache = null) {
  const cacheDimensions = isServerVolumeDescriptor(volumeCache) ? volumeCache.dimensions : null;
  const resolvedDimensions = {
    axial: Number(cacheDimensions?.axial) || Number(volumeCache?.depth) || Number(dimensions.axial),
    coronal: Number(cacheDimensions?.coronal) || Number(volumeCache?.height) || Number(dimensions.coronal),
    sagittal: Number(cacheDimensions?.sagittal) || Number(volumeCache?.width) || Number(dimensions.sagittal),
  };
  if (axis === 'coronal') {
    return {
      width: Math.max(1, resolvedDimensions.sagittal || 1),
      height: Math.max(1, resolvedDimensions.axial || 1),
    };
  }
  if (axis === 'sagittal') {
    return {
      width: Math.max(1, resolvedDimensions.coronal || 1),
      height: Math.max(1, resolvedDimensions.axial || 1),
    };
  }
  return {
    width: Math.max(1, resolvedDimensions.sagittal || 1),
    height: Math.max(1, resolvedDimensions.coronal || 1),
  };
}
