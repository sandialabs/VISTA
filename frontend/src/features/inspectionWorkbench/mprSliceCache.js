import { scheduleMprServerSliceTask } from '../../components/mprServerSliceScheduler';
import { getExternalOverlayOpacity, parseHexRgb } from './inspectionAnnotationDisplay';
import {
  MPR_AXES,
  MPR_SERVER_VOLUME_KIND,
  MPR_SERVER_SLICE_PREFETCH_RADIUS,
  MPR_SERVER_CURRENT_SLICE_DEBOUNCE_MS,
} from './mprConstants';
import { clampRange } from './inspectionUtils';
import { getScaledIndex } from './mprGeometry';
import {
  normalizeServerVolumeDimensions,
  getServerVolumeSliceUrl,
  isServerVolumeDescriptor,
  getMprAxisImageDimensions,
} from './volumeDescriptors';

const MPR_VOLUME_CACHE_LIMIT = 4;
const MPR_SLICE_CANVAS_CACHE_MAX_BYTES = 192 * 1024 * 1024;

export const mprVolumeCacheStore = new Map();
const mprSliceCanvasCacheStore = new Map();
let mprSliceCanvasCacheBytes = 0;

export function shouldApplyDisplayWindowToVolumeCache(volumeCache) {
  return volumeCache?.colorMode !== 'rgb' && volumeCache?.colorMode !== 'rgba';
}

export function getMprOverlayCompositeAlpha(volumeCache) {
  return volumeCache?.colorMode === 'rgba' ? 1 : 0.45;
}

function getMprOverlayTintAlpha(volumeCache) {
  return volumeCache?.colorMode === 'rgba' ? 1 : getMprOverlayCompositeAlpha(volumeCache);
}

export function drawMprOverlaySlice(context, overlaySliceCanvas, overlayCache, width, height) {
  if (!context || !overlaySliceCanvas) return;
  const overlayColor = parseHexRgb(overlayCache?.overlayColor || overlayCache?.color);
  context.save();
  context.globalAlpha = getMprOverlayCompositeAlpha(overlayCache)
    * getExternalOverlayOpacity(overlayCache, 1);
  context.globalCompositeOperation = 'source-over';
  context.drawImage(overlaySliceCanvas, 0, 0, width, height);
  if (overlayColor) {
    context.globalCompositeOperation = 'source-in';
    context.globalAlpha = getMprOverlayTintAlpha(overlayCache)
      * getExternalOverlayOpacity(overlayCache, 1);
    context.fillStyle = `rgb(${overlayColor.join(',')})`;
    context.fillRect(0, 0, width, height);
  }
  context.restore();
}

export function brightenMprOverlaySlice(context, overlaySliceCanvas, overlayCache, width, height) {
  if (!context || !overlaySliceCanvas) return;
  context.save();
  context.globalAlpha = Math.min(1, getMprOverlayCompositeAlpha(overlayCache) * 1.5)
    * getExternalOverlayOpacity(overlayCache, 1);
  context.globalCompositeOperation = 'screen';
  context.drawImage(overlaySliceCanvas, 0, 0, width, height);
  context.restore();
}

export function getMprVolumeCacheKey(imageStack, dimensions = {}) {
  if (!isServerVolumeDescriptor(imageStack) && (!Array.isArray(imageStack) || imageStack.length === 0)) return '';
  const resolvedDimensions = isServerVolumeDescriptor(imageStack) ? imageStack.dimensions : dimensions;
  const dimensionKey = MPR_AXES.map((axis) => `${axis}:${resolvedDimensions?.[axis] || 0}`).join(',');
  if (isServerVolumeDescriptor(imageStack)) {
    return `${dimensionKey}|${MPR_SERVER_VOLUME_KIND}:${imageStack.imageId}:${imageStack.channelCount || 1}:${imageStack.colorMode || 'scalar'}:${imageStack.overlayColor || ''}:${imageStack.overlayOpacity ?? ''}`;
  }
  return `${dimensionKey}|${imageStack
    .map((entry) => `${entry.id}:${entry.sliceIndex}:${entry.url}:${entry.overlayColor || ''}:${entry.overlayOpacity ?? ''}`)
    .join('|')}`;
}

export function rememberMprVolumeCache(key, cache) {
  if (!key || !cache) return;
  const replaced = mprVolumeCacheStore.get(key);
  if (replaced && replaced !== cache) forgetMprVolumeCacheCanvases(replaced);
  mprVolumeCacheStore.delete(key);
  mprVolumeCacheStore.set(key, cache);
  while (mprVolumeCacheStore.size > MPR_VOLUME_CACHE_LIMIT) {
    const oldestKey = mprVolumeCacheStore.keys().next().value;
    const oldestCache = mprVolumeCacheStore.get(oldestKey);
    mprVolumeCacheStore.delete(oldestKey);
    forgetMprVolumeCacheCanvases(oldestCache);
  }
}

function getSliceCanvasByteSize(canvas) {
  const width = Math.max(0, Math.floor(Number(canvas?.width) || 0));
  const height = Math.max(0, Math.floor(Number(canvas?.height) || 0));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return 0;
  const bytes = width * height * 4;
  return Number.isSafeInteger(bytes) ? bytes : 0;
}

function getGlobalSliceCanvasKey(volumeCache, sliceKey) {
  return `${volumeCache?.key || 'anonymous'}\0${sliceKey}`;
}

function forgetMprVolumeCacheCanvases(volumeCache) {
  if (!volumeCache?.sliceCanvases) return;
  volumeCache.sliceCanvases.forEach((canvas, sliceKey) => {
    const globalKey = getGlobalSliceCanvasKey(volumeCache, sliceKey);
    const entry = mprSliceCanvasCacheStore.get(globalKey);
    if (entry?.canvas === canvas) {
      mprSliceCanvasCacheBytes = Math.max(0, mprSliceCanvasCacheBytes - entry.bytes);
      mprSliceCanvasCacheStore.delete(globalKey);
    }
  });
  volumeCache.sliceCanvases.clear();
}

export function rememberSliceCanvas(volumeCache, key, canvas) {
  if (!volumeCache?.sliceCanvases || !key || !canvas) return;
  const globalKey = getGlobalSliceCanvasKey(volumeCache, key);
  const previous = mprSliceCanvasCacheStore.get(globalKey);
  if (previous) {
    mprSliceCanvasCacheBytes = Math.max(0, mprSliceCanvasCacheBytes - previous.bytes);
    mprSliceCanvasCacheStore.delete(globalKey);
  }
  volumeCache.sliceCanvases.delete(key);
  volumeCache.sliceCanvases.set(key, canvas);
  const bytes = getSliceCanvasByteSize(canvas);
  mprSliceCanvasCacheStore.set(globalKey, { volumeCache, sliceKey: key, canvas, bytes });
  mprSliceCanvasCacheBytes += bytes;
  while (mprSliceCanvasCacheBytes > MPR_SLICE_CANVAS_CACHE_MAX_BYTES) {
    const oldestGlobalKey = mprSliceCanvasCacheStore.keys().next().value;
    const oldest = mprSliceCanvasCacheStore.get(oldestGlobalKey);
    mprSliceCanvasCacheStore.delete(oldestGlobalKey);
    mprSliceCanvasCacheBytes = Math.max(0, mprSliceCanvasCacheBytes - (oldest?.bytes || 0));
    if (oldest?.volumeCache?.sliceCanvases?.get(oldest.sliceKey) === oldest.canvas) {
      oldest.volumeCache.sliceCanvases.delete(oldest.sliceKey);
    }
  }
}

export function getMprSliceCanvasCacheStats() {
  return {
    bytes: mprSliceCanvasCacheBytes,
    items: mprSliceCanvasCacheStore.size,
    maxBytes: MPR_SLICE_CANVAS_CACHE_MAX_BYTES,
  };
}

export function resetMprSliceCanvasCacheForTests() {
  [...mprVolumeCacheStore.values()].forEach(forgetMprVolumeCacheCanvases);
  mprVolumeCacheStore.clear();
  mprSliceCanvasCacheStore.clear();
  mprSliceCanvasCacheBytes = 0;
}

function loadMprImage(source, onSettled) {
  return new Promise((resolve) => {
    const image = new Image();
    const settle = (loadedImage) => {
      onSettled?.();
      resolve(loadedImage);
    };
    image.onload = () => settle(image);
    image.onerror = () => settle(null);
    image.src = source.url;
  });
}

export function createServerMprVolumeCache(cacheKey, descriptor, dimensions = {}) {
  const resolvedDimensions = normalizeServerVolumeDimensions(descriptor?.dimensions || dimensions);
  return {
    ...descriptor,
    kind: MPR_SERVER_VOLUME_KIND,
    key: cacheKey,
    dimensions: resolvedDimensions,
    width: resolvedDimensions.sagittal,
    height: resolvedDimensions.coronal,
    depth: resolvedDimensions.axial,
    sliceCanvases: new Map(),
    pendingSliceRequests: new Map(),
    prefetchAnchorByAxis: {},
    prefetchGenerationByAxis: {},
    currentGenerationByAxis: {},
    currentDebounceByAxis: {},
  };
}

export function beginServerMprSlicePrefetch(volumeCache, axis, index) {
  const previousAnchor = volumeCache.prefetchAnchorByAxis[axis];
  if (previousAnchor === index) return volumeCache.prefetchGenerationByAxis[axis] || 1;
  const generation = (volumeCache.prefetchGenerationByAxis[axis] || 0) + 1;
  volumeCache.prefetchAnchorByAxis[axis] = index;
  volumeCache.prefetchGenerationByAxis[axis] = generation;
  volumeCache.currentGenerationByAxis[axis] = generation;
  return generation;
}

export function invalidateServerMprSliceGeneration(volumeCache, axis) {
  if (!volumeCache) return;
  const pendingDebounce = volumeCache.currentDebounceByAxis?.[axis];
  if (pendingDebounce) {
    clearTimeout(pendingDebounce.timer);
    delete volumeCache.currentDebounceByAxis[axis];
    pendingDebounce.resolve(null);
  }
  const generation = Math.max(
    volumeCache.prefetchGenerationByAxis?.[axis] || 0,
    volumeCache.currentGenerationByAxis?.[axis] || 0,
  ) + 1;
  volumeCache.prefetchGenerationByAxis[axis] = generation;
  volumeCache.currentGenerationByAxis[axis] = generation;
}

export function getServerVolumePrefetchSources(volume, axis, index, radius = MPR_SERVER_SLICE_PREFETCH_RADIUS) {
  if (!isServerVolumeDescriptor(volume)) return [];
  const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
  const dimensions = normalizeServerVolumeDimensions(volume.dimensions);
  const upper = Math.max(0, dimensions[safeAxis] - 1);
  const center = clampRange(Math.round(Number(index) || 0), 0, upper, 0);
  const offsets = [0];
  for (let distance = 1; distance <= Math.max(0, Number(radius) || 0); distance += 1) {
    offsets.push(-distance, distance);
  }
  const indexes = [];
  offsets.forEach((offset) => {
    const candidate = center + offset;
    if (candidate >= 0 && candidate <= upper && !indexes.includes(candidate)) indexes.push(candidate);
  });
  return indexes.map((sliceIndex) => ({
    axis: safeAxis,
    index: sliceIndex,
    url: getServerVolumeSliceUrl(volume, safeAxis, sliceIndex),
  }));
}

async function buildServerMprSliceCanvas(volumeCache, source) {
  const image = await loadMprImage(source);
  if (!image) throw new Error(`Failed to load ${source.axis} slice ${source.index}`);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d');
  if (!context) throw new Error('Canvas rendering is unavailable');
  const fallbackDimensions = getMprAxisImageDimensions(source.axis, volumeCache.dimensions, volumeCache);
  canvas.width = image.naturalWidth || image.width || fallbackDimensions.width;
  canvas.height = image.naturalHeight || image.height || fallbackDimensions.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawServerMprSliceImage(context, image, source.axis, canvas.width, canvas.height);
  return canvas;
}

export function drawServerMprSliceImage(context, image, axis, width, height) {
  context.save();
  if (axis === 'coronal' || axis === 'sagittal') {
    // The legacy reconstruction displays axial z=0 on the bottom row for
    // orthogonal views. Backend NumPy slices arrive with z=0 on the top row.
    context.translate(0, height);
    context.scale(1, -1);
  }
  context.drawImage(image, 0, 0, width, height);
  context.restore();
}

export function requestServerMprSliceCanvas(
  volumeCache,
  source,
  { priority = false, prefetchGeneration = null, currentGeneration = null } = {},
) {
  if (!isServerVolumeDescriptor(volumeCache) || !source?.url) return Promise.resolve(null);
  const sliceKey = `${source.axis}:${source.index}`;
  const cachedCanvas = volumeCache.sliceCanvases.get(sliceKey);
  if (cachedCanvas) {
    rememberSliceCanvas(volumeCache, sliceKey, cachedCanvas);
    return Promise.resolve(cachedCanvas);
  }
  const pendingRequest = volumeCache.pendingSliceRequests.get(sliceKey);
  if (pendingRequest) {
    if (priority) {
      pendingRequest.isPrefetch = false;
      pendingRequest.currentGeneration = currentGeneration;
      return pendingRequest.promise.then((canvas) => (
        canvas || requestServerMprSliceCanvas(volumeCache, source, {
          priority: true,
          currentGeneration,
        })
      ));
    }
    if (pendingRequest.isPrefetch && prefetchGeneration !== null) {
      pendingRequest.prefetchGeneration = prefetchGeneration;
    }
    return pendingRequest.promise;
  }

  const requestState = {
    isPrefetch: !priority && prefetchGeneration !== null,
    prefetchGeneration,
    currentGeneration,
  };
  const shouldRun = () => (
    requestState.isPrefetch
      ? volumeCache.prefetchGenerationByAxis[source.axis] === requestState.prefetchGeneration
      : (
        requestState.currentGeneration === null
        || volumeCache.currentGenerationByAxis[source.axis] === requestState.currentGeneration
      )
  );
  const enqueue = () => scheduleMprServerSliceTask(
    () => buildServerMprSliceCanvas(volumeCache, source),
    { priority, shouldRun },
  );
  const scheduledRequest = priority && currentGeneration !== null
    ? new Promise((resolve, reject) => {
      const previous = volumeCache.currentDebounceByAxis[source.axis];
      if (previous) {
        clearTimeout(previous.timer);
        previous.resolve(null);
      }
      const state = { resolve, timer: null };
      state.timer = setTimeout(() => {
        if (volumeCache.currentDebounceByAxis[source.axis] === state) {
          delete volumeCache.currentDebounceByAxis[source.axis];
        }
        if (!shouldRun()) {
          resolve(null);
          return;
        }
        enqueue().then(resolve, reject);
      }, MPR_SERVER_CURRENT_SLICE_DEBOUNCE_MS);
      volumeCache.currentDebounceByAxis[source.axis] = state;
    })
    : enqueue();
  const request = scheduledRequest.then((canvas) => {
    if (canvas) rememberSliceCanvas(volumeCache, sliceKey, canvas);
    return canvas;
  }).finally(() => {
    volumeCache.pendingSliceRequests.delete(sliceKey);
  });
  requestState.promise = request;
  volumeCache.pendingSliceRequests.set(sliceKey, requestState);
  return request;
}

export function getMprSliceCachingMessage(progress = {}) {
  const loaded = Math.max(0, Number(progress.loadedSlices) || 0);
  const total = Math.max(0, Number(progress.totalSlices) || 0);
  if (total > 0) return `Caching MPR slices ${Math.min(loaded, total)}/${total}`;
  return 'Caching MPR slices';
}

export function getStackOverlayStyle(source) {
  if (isServerVolumeDescriptor(source)) {
    return {
      overlayColor: source.overlayColor || source.color || '',
      overlayOpacity: getExternalOverlayOpacity(source, 1),
    };
  }
  const stack = Array.isArray(source?.stack)
    ? source.stack
    : (Array.isArray(source) ? source : []);
  const styleEntry = stack.find((entry) => entry?.overlayColor || entry?.color || entry?.overlayOpacity !== undefined || entry?.opacity !== undefined) || {};
  return {
    overlayColor: styleEntry.overlayColor || styleEntry.color || '',
    overlayOpacity: getExternalOverlayOpacity(styleEntry, 1),
  };
}

export async function buildMprVolumeCache(cacheKey, imageStack, dimensions, onProgress) {
  const totalSlices = Array.isArray(imageStack) ? imageStack.length : 0;
  let loadedSlices = 0;
  const reportProgress = () => {
    loadedSlices += 1;
    onProgress?.({ loadedSlices, totalSlices });
  };
  const images = await Promise.all(imageStack.map((source) => loadMprImage(source, reportProgress)));
  const loadedEntries = images
    .map((image, index) => ({ image, source: imageStack[index], index }))
    .filter((entry) => entry.image);
  if (loadedEntries.length === 0) return null;

  const first = loadedEntries[0].image;
  const width = first.naturalWidth || first.width || Math.max(1, dimensions.sagittal || 1);
  const height = first.naturalHeight || first.height || Math.max(1, dimensions.coronal || 1);
  const scratch = document.createElement('canvas');
  const scratchContext = scratch.getContext?.('2d');
  if (!scratchContext) return null;

  scratch.width = width;
  scratch.height = height;

  const maxDeclaredSliceIndex = imageStack.reduce((max, source, index) => {
    const sliceIndex = Number(source?.sliceIndex);
    return Math.max(max, Number.isFinite(sliceIndex) ? Math.floor(sliceIndex) : index);
  }, 0);
  const depth = Math.max(
    1,
    Math.floor(Number(dimensions?.axial) || 0),
    maxDeclaredSliceIndex + 1,
    imageStack.length,
  );
  const slices = Array.from({ length: depth }, () => ({
    image: null,
    imageData: scratchContext.createImageData(width, height),
    valid: false,
  }));

  loadedEntries.forEach(({ image, source, index }) => {
    const declaredSliceIndex = Number(source?.sliceIndex);
    const sliceIndex = clampRange(
      Number.isFinite(declaredSliceIndex) ? Math.floor(declaredSliceIndex) : index,
      0,
      depth - 1,
      index,
    );
    scratchContext.clearRect(0, 0, width, height);
    scratchContext.drawImage(image, 0, 0, width, height);
    slices[sliceIndex] = {
      image,
      imageData: scratchContext.getImageData(0, 0, width, height),
      valid: true,
    };
  });
  const validSliceCount = slices.reduce((count, slice) => count + (slice.valid ? 1 : 0), 0);

  return {
    key: cacheKey,
    id: String(imageStack[0]?.id || imageStack[0]?.imageId || ''),
    imageId: String(imageStack[0]?.imageId || imageStack[0]?.id || ''),
    width,
    height,
    depth,
    channelCount: Number(imageStack[0]?.channelCount) || 1,
    colorMode: String(imageStack[0]?.colorMode || 'scalar'),
    overlayColor: String(imageStack[0]?.overlayColor || imageStack[0]?.color || ''),
    overlayOpacity: getExternalOverlayOpacity(imageStack[0], 1),
    slices,
    validSliceCount,
    complete: validSliceCount === depth,
    sliceCanvases: new Map(),
  };
}

export function getCachedMprSliceCanvas(axis, slicePosition, dimensions, volumeCache) {
  if (!volumeCache || typeof document === 'undefined') return null;
  if (isServerVolumeDescriptor(volumeCache)) {
    const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
    const sourceMax = Math.max(0, (Number(dimensions?.[safeAxis]) || 1) - 1);
    const targetLength = Number(volumeCache.dimensions?.[safeAxis]) || 1;
    const sliceIndex = getScaledIndex(slicePosition?.[safeAxis], sourceMax, targetLength);
    const sliceKey = `${safeAxis}:${sliceIndex}`;
    const cachedCanvas = volumeCache.sliceCanvases.get(sliceKey);
    if (cachedCanvas) rememberSliceCanvas(volumeCache, sliceKey, cachedCanvas);
    return cachedCanvas || null;
  }
  const sourceMaxByAxis = {
    axial: Math.max(0, (dimensions.axial || 1) - 1),
    coronal: Math.max(0, (dimensions.coronal || 1) - 1),
    sagittal: Math.max(0, (dimensions.sagittal || 1) - 1),
  };
  const cacheIndexByAxis = {
    axial: getScaledIndex(slicePosition.axial, sourceMaxByAxis.axial, volumeCache.depth),
    coronal: getScaledIndex(slicePosition.coronal, sourceMaxByAxis.coronal, volumeCache.height),
    sagittal: getScaledIndex(slicePosition.sagittal, sourceMaxByAxis.sagittal, volumeCache.width),
  };
  const sliceKey = `${axis}:${cacheIndexByAxis[axis]}`;
  const cachedCanvas = volumeCache.sliceCanvases.get(sliceKey);
  if (cachedCanvas) return cachedCanvas;

  const output = document.createElement('canvas');
  const outputContext = output.getContext?.('2d');
  if (!outputContext) return null;

  if (axis === 'axial') {
    const slice = volumeCache.slices[cacheIndexByAxis.axial] || volumeCache.slices[0];
    output.width = volumeCache.width;
    output.height = volumeCache.height;
    if (slice?.imageData) {
      outputContext.putImageData(slice.imageData, 0, 0);
    }
    rememberSliceCanvas(volumeCache, sliceKey, output);
    return output;
  }

  if (axis === 'coronal') {
    output.width = volumeCache.width;
    output.height = volumeCache.depth;
    const y = cacheIndexByAxis.coronal;
    const outData = outputContext.createImageData(output.width, output.height);
    volumeCache.slices.forEach((slice, zIndex) => {
      const sourceOffset = y * volumeCache.width * 4;
      const targetOffset = (volumeCache.depth - 1 - zIndex) * volumeCache.width * 4;
      outData.data.set(
        slice.imageData.data.subarray(sourceOffset, sourceOffset + volumeCache.width * 4),
        targetOffset,
      );
    });
    outputContext.putImageData(outData, 0, 0);
    rememberSliceCanvas(volumeCache, sliceKey, output);
    return output;
  }

  output.width = volumeCache.height;
  output.height = volumeCache.depth;
  const x = cacheIndexByAxis.sagittal;
  const outData = outputContext.createImageData(output.width, output.height);
  volumeCache.slices.forEach((slice, zIndex) => {
    const targetRowOffset = (volumeCache.depth - 1 - zIndex) * volumeCache.height * 4;
    for (let y = 0; y < volumeCache.height; y += 1) {
      const sourceOffset = (y * volumeCache.width + x) * 4;
      const targetOffset = targetRowOffset + y * 4;
      outData.data[targetOffset] = slice.imageData.data[sourceOffset];
      outData.data[targetOffset + 1] = slice.imageData.data[sourceOffset + 1];
      outData.data[targetOffset + 2] = slice.imageData.data[sourceOffset + 2];
      outData.data[targetOffset + 3] = slice.imageData.data[sourceOffset + 3];
    }
  });
  outputContext.putImageData(outData, 0, 0);
  rememberSliceCanvas(volumeCache, sliceKey, output);
  return output;
}
