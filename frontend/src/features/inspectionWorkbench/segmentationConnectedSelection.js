import { getMprAxisImageDimensions } from './volumeDescriptors';

export const CONNECTED_VOLUME_LIMITS = {
  maxVoxels: 50000,
  maxExamined: 150000,
  maxRuns: 10000,
};

const floodFillSlicePixels = (data, width, height, seedX, seedY, maxDelta) => {
  const seedOffset = (seedY * width + seedX) * 4;
  const seed = [
    data[seedOffset],
    data[seedOffset + 1],
    data[seedOffset + 2],
    data[seedOffset + 3],
  ];
  const visited = new Uint8Array(width * height);
  const selected = new Uint8Array(width * height);
  const stack = [seedY * width + seedX];
  const bounds = { areaPx: 0, minX: seedX, maxX: seedX, minY: seedY, maxY: seedY };

  const matchesSeed = (index) => {
    const offset = index * 4;
    return Math.max(
      Math.abs(data[offset] - seed[0]),
      Math.abs(data[offset + 1] - seed[1]),
      Math.abs(data[offset + 2] - seed[2]),
      Math.abs(data[offset + 3] - seed[3]),
    ) <= maxDelta;
  };

  while (stack.length > 0) {
    const index = stack.pop();
    if (visited[index]) continue;
    visited[index] = 1;
    if (!matchesSeed(index)) continue;
    selected[index] = 1;
    bounds.areaPx += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - width);
    if (y < height - 1) stack.push(index + width);
  }
  return { seed, selected, ...bounds };
};

const buildSelectionMask = (fill, width, scaleX, scaleY) => {
  const { selected, minX, maxX, minY, maxY } = fill;
  const pathParts = [];
  const maskRuns = [];
  for (let y = minY; y <= maxY; y += 1) {
    let x = minX;
    while (x <= maxX) {
      const index = y * width + x;
      if (!selected[index]) {
        x += 1;
        continue;
      }
      const startX = x;
      while (x <= maxX && selected[y * width + x]) x += 1;
      const runWidth = x - startX;
      pathParts.push(`M ${startX * scaleX} ${y * scaleY} h ${runWidth * scaleX} v ${scaleY} h ${-runWidth * scaleX} Z`);
      maskRuns.push([y * scaleY, startX * scaleX, x * scaleX]);
    }
  }
  return { maskPath: pathParts.join(' '), maskRuns };
};

const readCanvasPixels = (ctx, width, height) => {
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch (_) {
    imageData = null;
  }
  return imageData?.data;
};

/**
 * Flood-fills the clicked slice pixel within the sensitivity tolerance and
 * returns a connected shape, a fallback seed shape when pixels are not
 * readable, or null when the pixel buffer is incomplete.
 */
export function buildConnectedSliceSelection({
  canvas,
  position,
  segmentationSensitivity,
  makeSegmentationShapeBase,
}) {
  const ctx = canvas?.getContext?.('2d');
  const width = Math.max(1, Number(canvas?.width) || Math.round(position?.imageWidth || 1));
  const height = Math.max(1, Number(canvas?.height) || Math.round(position?.imageHeight || 1));
  if (!ctx?.getImageData || !position || width <= 0 || height <= 0) {
    const radius = Math.max(4, Number(segmentationSensitivity) || 28);
    return makeSegmentationShapeBase('connected', position, {
      seed: position,
      radius,
      points: [],
      error: 'slice-pixels-unavailable',
    });
  }

  const data = readCanvasPixels(ctx, width, height);
  if (!data || data.length < width * height * 4) {
    return null;
  }

  const seedX = Math.max(0, Math.min(width - 1, Math.round((position.x / Math.max(1, position.imageWidth || width)) * (width - 1))));
  const seedY = Math.max(0, Math.min(height - 1, Math.round((position.y / Math.max(1, position.imageHeight || height)) * (height - 1))));
  const maxDelta = Math.max(0, Number(segmentationSensitivity) || 28);
  const fill = floodFillSlicePixels(data, width, height, seedX, seedY, maxDelta);
  const scaleX = (position.imageWidth || width) / width;
  const scaleY = (position.imageHeight || height) / height;
  const { maskPath, maskRuns } = buildSelectionMask(fill, width, scaleX, scaleY);

  return makeSegmentationShapeBase('connected', position, {
    seed: position,
    points: [],
    maskPath,
    maskRuns,
    bbox: [fill.minX * scaleX, fill.minY * scaleY, (fill.maxX + 1) * scaleX, (fill.maxY + 1) * scaleY],
    areaPx: fill.areaPx,
    canvasWidth: width,
    canvasHeight: height,
    seedColor: fill.seed,
  });
}

/** Converts a 3D connected-selection result into a pending volume shape. */
export function makeConnectedVolumeSelection({
  makeSegmentationShapeBase,
  getSegmentationVolumeDimensions,
  position,
  seedVoxel,
  result,
  segmentId,
  sourceAxis,
  sourceSliceIndex,
}) {
  return makeSegmentationShapeBase('connected', position, {
    segmentId,
    axis: sourceAxis,
    sliceIndex: sourceSliceIndex,
    mode: '3d',
    seed: position,
    seedVoxel,
    points: [],
    volumeRuns: result?.volume_runs || result?.runs || [],
    volumeDimensions: result?.dimensions || getSegmentationVolumeDimensions(),
    voxelCount: Number(result?.voxel_count ?? result?.voxelCount ?? result?.stats?.voxelCount) || 0,
    examined: Number(result?.examined ?? result?.stats?.examined) || 0,
    connectivity: Number(result?.connectivity) || 6,
    truncated: result?.truncated === true || result?.stats?.truncated === true,
    truncationReason: String(
      result?.truncation_reason || result?.truncationReason || result?.reason || result?.stats?.reason || '',
    ),
  });
}

/** Reads one RGBA voxel from a complete client-side slice cache. */
export const readCachedVolumeVoxel = (volumeCache, dimensions, x, y, z) => {
  const data = volumeCache.slices[z]?.imageData?.data;
  if (!data) return null;
  const offset = ((y * dimensions[0]) + x) * 4;
  return [
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  ];
};

/** Converts an ML segmentation region into a helper shape on the active axis. */
export function makeShapeFromMlRegion({
  region,
  position,
  cachedResult,
  segmentationHelperAxis,
  segmentationMlMethod,
  mprDimensions,
  volumeCache,
  makeSegmentationShapeBase,
}) {
  if (!region?.bbox) return null;
  const dimensions = getMprAxisImageDimensions(
    segmentationHelperAxis,
    mprDimensions,
    volumeCache,
  );
  return makeSegmentationShapeBase('ml-helper', position, {
    bbox: region.bbox,
    seed: position,
    points: [
      position,
      ...(Array.isArray(region.centroid) ? [{ x: region.centroid[0], y: region.centroid[1] }] : []),
    ],
    label: region.label,
    areaPx: region.area_px,
    className: region.class_name,
    confidence: region.confidence,
    methodId: segmentationMlMethod,
    methodLabel: cachedResult?.method_id || segmentationMlMethod,
    imageWidth: position?.imageWidth || dimensions.width,
    imageHeight: position?.imageHeight || dimensions.height,
  });
}

/**
 * Picks the smallest cached ML region whose bbox contains the click, falling
 * back to the server's selected region when it contains the click.
 */
export function pickMlRegionAtPosition(cachedResult, position) {
  const regions = Array.isArray(cachedResult?.regions) ? cachedResult.regions : [];
  const containsPosition = (region) => {
    const bbox = Array.isArray(region?.bbox) ? region.bbox.map(Number) : [];
    if (bbox.length < 4 || bbox.some((value) => !Number.isFinite(value))) return false;
    return bbox[0] <= position.x && position.x <= bbox[2] && bbox[1] <= position.y && position.y <= bbox[3];
  };
  const containing = regions.filter((region) => {
    return containsPosition(region);
  });
  const selectedRegion = containing.length > 0
    ? containing.sort((left, right) => Number(left.area_px || Infinity) - Number(right.area_px || Infinity))[0]
    : (containsPosition(cachedResult?.selected_region) ? cachedResult.selected_region : null);
  return { regions, selectedRegion };
}
