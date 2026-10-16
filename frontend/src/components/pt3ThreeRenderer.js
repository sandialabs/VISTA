import {
  getPt3CameraClippingRange,
  getPt3CameraDistance,
  getPt3ViewSize,
  getPt3WorldScale,
  PT3_VIEW_CAMERA_FOV_DEGREES,
} from './pt3VolumeGeometry';
import { segmentColorToRgba } from './pt3Segmentation';
import {
  MPR_SERVER_SLICE_MAX_CONCURRENCY,
  scheduleMprServerSliceTask,
} from './mprServerSliceScheduler';
import { getPt3VolumeMetadata } from './pt3VolumeDescriptor';
import { clamp } from '../utils/numbers';

let threeModulePromise = null;

export const PT3_RECONSTRUCTION_STYLE_IDS = Object.freeze({
  composite: 0,
  mip: 1,
  xray: 2,
  iso: 3,
  window: 4,
});

export const PT3_MAX_RAY_MARCH_SAMPLES = 512;
export const PT3_MAX_BROWSER_VOLUME_TEXTURE_BYTES = 512 * 1024 * 1024;

export const PT3_VOLUME_MATERIAL_OPTIONS = Object.freeze({
  transparent: true,
  premultipliedAlpha: true,
  depthWrite: false,
});

export const DEFAULT_PT3_RECONSTRUCTION_OPTIONS = Object.freeze({
  reconstructionStyle: 'composite',
  windowCenter: 0.45,
  windowWidth: 0.18,
  isoThreshold: 0.45,
  isoWidth: 0.04,
  boundaryEnhancement: false,
  boundaryStrength: 0.45,
  boundaryBandWidth: 0.08,
});

const finiteNumberOr = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const booleanOr = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
};

export function getPt3AdaptiveMarchParameters({
  requestedStepSize,
  rayExitDistance,
  sampleStep = 1,
  maxSamples = PT3_MAX_RAY_MARCH_SAMPLES,
} = {}) {
  const safeRequestedStep = Math.max(Number.EPSILON, finiteNumberOr(requestedStepSize, 1));
  const safeExitDistance = Math.max(0, finiteNumberOr(rayExitDistance, 0));
  const safeMaxSamples = Math.max(2, Math.floor(finiteNumberOr(
    maxSamples,
    PT3_MAX_RAY_MARCH_SAMPLES,
  )));
  const marchStep = Math.max(safeRequestedStep, safeExitDistance / (safeMaxSamples - 1));
  return {
    marchStep,
    effectiveSampleStep: Math.max(0, finiteNumberOr(sampleStep, 1))
      * marchStep / safeRequestedStep,
  };
}

export function getPt3TextureSizeLimitError(dimensions, hardwareLimit) {
  const observed = Array.from({ length: 3 }, (_unused, axis) => Math.max(
    1,
    Math.floor(finiteNumberOr(dimensions?.[axis], 1)),
  ));
  const limit = Math.floor(finiteNumberOr(hardwareLimit, 0));
  if (limit < 1 || observed.every((dimension) => dimension <= limit)) return null;
  return `PT3 volume texture dimensions ${observed.join('×')} exceed this device's WebGL MAX_3D_TEXTURE_SIZE limit of ${limit} voxels per axis`;
}

export function getPt3TextureAllocationLimitError(dimensions, {
  includeSegmentation = false,
  includeExternalOverlay = false,
  byteLimit = PT3_MAX_BROWSER_VOLUME_TEXTURE_BYTES,
} = {}) {
  const observed = Array.from({ length: 3 }, (_unused, axis) => Math.max(
    1,
    Math.floor(finiteNumberOr(dimensions?.[axis], 1)),
  ));
  const limit = Math.floor(finiteNumberOr(byteLimit, 0));
  if (limit < 1) return null;
  const voxelCount = observed.reduce((product, dimension) => product * dimension, 1);
  // Volume and optional labels each have one CPU staging copy and one R8 GPU
  // texture. The composited external overlay keeps one decoded RGBA stack,
  // one per-stack rollback-safe buffer, one CPU RGBA staging copy, and one
  // RGBA GPU texture (sixteen bytes per voxel total). Allow for the bounded
  // decode queue, Canvas backing store, and one ImageData copy at peak too.
  const residentVoxelCopies = (includeSegmentation ? 4 : 2)
    + (includeExternalOverlay ? 16 : 0);
  const sliceRgbaCopies = MPR_SERVER_SLICE_MAX_CONCURRENCY + 2;
  const requiredBytes = voxelCount * residentVoxelCopies
    + observed[0] * observed[1] * 4 * sliceRgbaCopies;
  if (requiredBytes <= limit) return null;
  const requiredMiB = (requiredBytes / (1024 * 1024)).toFixed(1);
  const limitMiB = (limit / (1024 * 1024)).toFixed(1);
  return `PT3 volume texture dimensions ${observed.join('×')} require an estimated ${requiredMiB} MiB of browser decode, staging, and 3D-texture memory, exceeding the built-in ${limitMiB} MiB browser volume budget`;
}

export function getPt3BoundedProjectionOpacity(transferResponse, opacityMultiplier) {
  const response = clamp(finiteNumberOr(transferResponse, 0), 0, 1);
  const opticalDepth = Math.max(0, finiteNumberOr(opacityMultiplier, 0)) * response;
  return clamp(1 - Math.exp(-opticalDepth), 0, 1);
}

export function scalePt3PremultipliedOverlayLayer(overlayColor, opacityMultiplier) {
  const multiplier = clamp(finiteNumberOr(opacityMultiplier, 1), 0, 1);
  return Array.from({ length: 4 }, (_unused, index) => (
    finiteNumberOr(overlayColor?.[index], 0) * multiplier
  ));
}

function parseHexColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

export function shouldRenderPt3ExternalOverlay(externalOverlayTexture, showExternalOverlay, opacity) {
  return Boolean(
    externalOverlayTexture
    && showExternalOverlay
    && clamp(finiteNumberOr(opacity, 0), 0, 1) > 0,
  );
}

function getWebGlErrorLabel(gl, errorCode) {
  return [
    ['INVALID_ENUM', gl.INVALID_ENUM],
    ['INVALID_VALUE', gl.INVALID_VALUE],
    ['INVALID_OPERATION', gl.INVALID_OPERATION],
    ['INVALID_FRAMEBUFFER_OPERATION', gl.INVALID_FRAMEBUFFER_OPERATION],
    ['OUT_OF_MEMORY', gl.OUT_OF_MEMORY],
    ['CONTEXT_LOST_WEBGL', gl.CONTEXT_LOST_WEBGL],
  ].find(([, value]) => value === errorCode)?.[0] || errorCode;
}

export function normalizePt3ReconstructionOptions(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const requestedStyle = String(settings.reconstructionStyle || '').trim().toLowerCase();
  const reconstructionStyle = requestedStyle === 'average'
    ? 'xray'
    : (Object.prototype.hasOwnProperty.call(PT3_RECONSTRUCTION_STYLE_IDS, requestedStyle)
      ? requestedStyle
      : DEFAULT_PT3_RECONSTRUCTION_OPTIONS.reconstructionStyle);
  return {
    reconstructionStyle,
    windowCenter: clamp(finiteNumberOr(
      settings.windowCenter,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.windowCenter,
    ), 0, 1),
    windowWidth: clamp(finiteNumberOr(
      settings.windowWidth,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.windowWidth,
    ), 0.01, 1),
    isoThreshold: clamp(finiteNumberOr(
      settings.isoThreshold,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.isoThreshold,
    ), 0, 1),
    isoWidth: clamp(finiteNumberOr(
      settings.isoWidth,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.isoWidth,
    ), 0.001, 1),
    boundaryEnhancement: booleanOr(
      settings.boundaryEnhancement,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.boundaryEnhancement,
    ),
    boundaryStrength: clamp(finiteNumberOr(
      settings.boundaryStrength,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.boundaryStrength,
    ), 0, 2),
    boundaryBandWidth: clamp(finiteNumberOr(
      settings.boundaryBandWidth,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.boundaryBandWidth,
    ), 0.001, 1),
  };
}

export function getPt3ReconstructionUniformValues(options = {}) {
  const normalized = normalizePt3ReconstructionOptions(options);
  return {
    renderStyle: PT3_RECONSTRUCTION_STYLE_IDS[normalized.reconstructionStyle],
    windowCenter: normalized.windowCenter,
    windowWidth: normalized.windowWidth,
    isoThreshold: normalized.isoThreshold,
    isoWidth: normalized.isoWidth,
    boundaryEnhancement: normalized.boundaryEnhancement,
    boundaryStrength: normalized.boundaryStrength,
    boundaryBandWidth: normalized.boundaryBandWidth,
  };
}

export function loadThree() {
  if (!threeModulePromise) threeModulePromise = import('three');
  return threeModulePromise;
}

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('PT3 volume loading was cancelled', 'AbortError');
  }
  const error = new Error('PT3 volume loading was cancelled');
  error.name = 'AbortError';
  return error;
}

class VolumeSliceDimensionMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VolumeSliceDimensionMismatchError';
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function disposeOptionalTexture(texture) {
  try {
    texture?.dispose?.();
  } catch (_error) {
    // Optional renderer resources must never prevent the base resources from
    // being released or the base-only renderer from continuing.
  }
}

export class Pt3WebGlContextLossError extends Error {
  constructor(message = 'PT3 volume GPU initialization lost the WebGL context') {
    super(message);
    this.name = 'Pt3WebGlContextLossError';
  }
}

export async function createPt3ExternalOverlayTextureWithinBudget({
  dimensions,
  includeSegmentation = false,
  hasOverlaySources = false,
  byteLimit = PT3_MAX_BROWSER_VOLUME_TEXTURE_BYTES,
  createTexture,
  signal,
} = {}) {
  if (!hasOverlaySources || typeof createTexture !== 'function') return null;
  const allocationError = getPt3TextureAllocationLimitError(dimensions, {
    includeSegmentation,
    includeExternalOverlay: true,
    byteLimit,
  });
  if (allocationError) return null;

  let texture;
  try {
    throwIfAborted(signal);
    texture = await createTexture();
    throwIfAborted(signal);
    return texture || null;
  } catch (error) {
    disposeOptionalTexture(texture);
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}

export function initializePt3RendererWithExternalOverlayFallback({
  initialize,
  externalOverlayTexture,
  disableExternalOverlay,
  signal,
} = {}) {
  try {
    throwIfAborted(signal);
    initialize();
    throwIfAborted(signal);
    return externalOverlayTexture || null;
  } catch (error) {
    if (
      error?.name === 'AbortError'
      || error?.name === 'Pt3WebGlContextLossError'
      || !externalOverlayTexture
    ) throw error;
    disableExternalOverlay(externalOverlayTexture);
    throwIfAborted(signal);
    initialize();
    throwIfAborted(signal);
    return null;
  }
}

export async function recreatePt3BaseRendererAfterContextLoss({
  disposeFailedRenderer,
  restoreContext,
  createBaseRenderer,
  signal,
} = {}) {
  // Cleanup must happen even when cancellation raced with context loss.
  disposeFailedRenderer?.();
  throwIfAborted(signal);
  await restoreContext?.();
  throwIfAborted(signal);
  return createBaseRenderer();
}

function waitForPt3WebGlContextRestoration(canvas, forceContextRestore, signal) {
  if (typeof forceContextRestore !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let settled = false;
    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      canvas?.removeEventListener?.('webglcontextrestored', handleRestore);
      signal?.removeEventListener?.('abort', handleAbort);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleRestore = () => settle(resolve);
    const handleAbort = () => settle(() => reject(createAbortError()));

    if (signal?.aborted) {
      handleAbort();
      return;
    }
    canvas?.addEventListener?.('webglcontextrestored', handleRestore, { once: true });
    signal?.addEventListener?.('abort', handleAbort, { once: true });
    try {
      forceContextRestore();
    } catch (_error) {
      settle(resolve);
      return;
    }
    // Some browsers restore synchronously without dispatching an observable
    // event. Bound the recovery wait, then let the new base-only renderer
    // perform the authoritative context validation.
    if (!settled) timeoutId = setTimeout(() => settle(resolve), 250);
  });
}

function loadImage(source, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => signal?.removeEventListener?.('abort', handleAbort);
    const handleAbort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      cleanup();
      reject(createAbortError());
    };
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Could not load volume slice ${source.filename || source.id || ''}`));
    };
    signal?.addEventListener?.('abort', handleAbort, { once: true });
    image.src = source.url;
  });
}

function getDeclaredSliceDimensions(source) {
  const width = Number(
    source?.width
      ?? source?.imageWidth
      ?? source?.metadata?.width
      ?? source?.metadata?.image_width,
  );
  const height = Number(
    source?.height
      ?? source?.imageHeight
      ?? source?.metadata?.height
      ?? source?.metadata?.image_height,
  );
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? [Math.floor(width), Math.floor(height)]
    : null;
}

async function consumeVolumeTextureImages(volumeImageStack, {
  validateDimensions,
  signal,
  onImage,
} = {}) {
  const ordered = [...volumeImageStack].sort((a, b) => Number(a.sliceIndex || 0) - Number(b.sliceIndex || 0));
  if (ordered.length === 0) throw new Error('No volume stack images are available');
  const internalController = new AbortController();
  const handleExternalAbort = () => internalController.abort();
  signal?.addEventListener?.('abort', handleExternalAbort, { once: true });
  if (signal?.aborted) internalController.abort();
  const activeSignal = internalController.signal;
  let expectedWidth = null;
  let expectedHeight = null;

  const consumeImage = async (source, z) => {
    const result = await scheduleMprServerSliceTask(async () => {
      try {
        throwIfAborted(activeSignal);
        const image = await loadImage(source, activeSignal);
        throwIfAborted(activeSignal);
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          throw new Error(`Volume slice ${source.filename || source.id || z} has invalid dimensions`);
        }
        if (z === 0) {
          expectedWidth = width;
          expectedHeight = height;
          await validateDimensions?.([width, height, ordered.length]);
        } else if (width !== expectedWidth || height !== expectedHeight) {
          throw new VolumeSliceDimensionMismatchError(
            `Volume slice ${source.filename || source.id || z} dimensions ${width}×${height} do not match the built-in consistent-stack requirement of ${expectedWidth}×${expectedHeight}`,
          );
        }
        throwIfAborted(activeSignal);
        await onImage?.(image, z, {
          width: expectedWidth,
          height: expectedHeight,
          depth: ordered.length,
        });
        return true;
      } catch (error) {
        internalController.abort();
        throw error;
      }
    }, { shouldRun: () => !activeSignal.aborted });
    throwIfAborted(activeSignal);
    if (!result) throw createAbortError();
  };

  try {
    const declaredFirstDimensions = getDeclaredSliceDimensions(ordered[0]);
    if (declaredFirstDimensions) {
      await validateDimensions?.([
        declaredFirstDimensions[0],
        declaredFirstDimensions[1],
        ordered.length,
      ]);
    }
    await consumeImage(ordered[0], 0);
    ordered.slice(1).forEach((source, index) => {
      const declaredDimensions = getDeclaredSliceDimensions(source);
      if (
        declaredDimensions
        && (declaredDimensions[0] !== expectedWidth || declaredDimensions[1] !== expectedHeight)
      ) {
        throw new VolumeSliceDimensionMismatchError(
          `Volume slice ${source.filename || source.id || index + 1} declared dimensions ${declaredDimensions[0]}×${declaredDimensions[1]} do not match the built-in consistent-stack requirement of ${expectedWidth}×${expectedHeight}`,
        );
      }
    });
    await Promise.all(ordered.slice(1).map((source, index) => (
      consumeImage(source, index + 1)
    )));
    return { ordered, dimensions: [expectedWidth, expectedHeight, ordered.length] };
  } catch (error) {
    internalController.abort();
    throw error;
  } finally {
    signal?.removeEventListener?.('abort', handleExternalAbort);
  }
}

export async function loadVolumeTextureImages(volumeImageStack, options = {}) {
  const images = [];
  const { ordered } = await consumeVolumeTextureImages(volumeImageStack, {
    ...options,
    onImage: (image, z) => { images[z] = image; },
  });
  return { images, ordered };
}

async function createVolumeTexture(THREE, volumeImageStack, validateDimensions, signal) {
  let canvas;
  let context;
  let voxels;
  let textureDimensions;
  await consumeVolumeTextureImages(volumeImageStack, {
    validateDimensions,
    signal,
    onImage: (image, z, dimensions) => {
      if (!voxels) {
        textureDimensions = [dimensions.width, dimensions.height, dimensions.depth];
        canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas image decoding is unavailable');
        voxels = new Uint8Array(dimensions.width * dimensions.height * dimensions.depth);
      }
      const [width, height] = textureDimensions;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, width, height).data;
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        voxels[z * width * height + index] = Math.round(rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722);
      }
    },
  });
  throwIfAborted(signal);
  const [width, height, depth] = textureDimensions;
  const texture = new THREE.Data3DTexture(voxels, width, height, depth);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function compositeRgbaPixel(target, targetOffset, source, sourceOffset, options = {}) {
  const alphaMultiplier = finiteNumberOr(options.alphaMultiplier, 1);
  const colorMultiplier = finiteNumberOr(options.colorMultiplier, 1);
  const sourceColorOverride = options.sourceColorOverride || null;
  const sourceAlphaOverride = options.sourceAlphaOverride;
  const rawSourceAlpha = sourceAlphaOverride === undefined || sourceAlphaOverride === null
    ? source[sourceOffset + 3] / 255
    : finiteNumberOr(sourceAlphaOverride, 0);
  const sourceAlpha = clamp(rawSourceAlpha * alphaMultiplier, 0, 1);
  if (sourceAlpha <= 0) return;
  const targetAlpha = target[targetOffset + 3] / 255;
  const retainedTargetAlpha = targetAlpha * (1 - sourceAlpha);
  const outputAlpha = sourceAlpha + retainedTargetAlpha;
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceColor = clamp((sourceColorOverride?.[channel] ?? source[sourceOffset + channel]) * colorMultiplier, 0, 255);
    target[targetOffset + channel] = Math.round(
      (sourceColor * sourceAlpha
        + target[targetOffset + channel] * retainedTargetAlpha) / outputAlpha,
    );
  }
  target[targetOffset + 3] = Math.round(outputAlpha * 255);
}

class ExternalOverlayDimensionMismatchError extends VolumeSliceDimensionMismatchError {
  constructor(message) {
    super(message);
    this.name = 'ExternalOverlayDimensionMismatchError';
  }
}

async function createExternalOverlayTexture(
  THREE,
  volumeOverlayImageStacks,
  width,
  height,
  depth,
  signal,
) {
  const overlayStacks = Array.isArray(volumeOverlayImageStacks)
    ? volumeOverlayImageStacks.filter((stack) => Array.isArray(stack) && stack.length > 0)
    : [];
  if (overlayStacks.length === 0) return null;

  const expectedDimensions = [width, height, depth];
  let voxels;
  let canvas;
  let context;
  try {
    voxels = new Uint8Array(width * height * depth * 4);
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d', { willReadFrequently: true });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
  if (!context) return null;

  let acceptedOverlayStackCount = 0;
  for (let stackIndex = 0; stackIndex < overlayStacks.length; stackIndex += 1) {
    throwIfAborted(signal);
    try {
      const stackEntries = overlayStacks[stackIndex];
      const isHighlightedStack = stackEntries.some((entry) => entry?.highlighted === true);
      const configuredColor = parseHexColor(stackEntries.find((entry) => entry?.overlayColor)?.overlayColor);
      const configuredOpacity = Math.min(1, Math.max(0, finiteNumberOr(
        stackEntries.find((entry) => entry?.overlayOpacity !== undefined)?.overlayOpacity,
        1,
      )));
      const stackColorMode = String(stackEntries.find((entry) => entry?.colorMode)?.colorMode || '').toLowerCase();
      const stackChannelCount = Number(stackEntries.find((entry) => entry?.channelCount !== undefined)?.channelCount);
      const shouldTintByMask = Boolean(configuredColor)
        && (stackColorMode !== 'rgba' || stackChannelCount !== 4);
      const stackVoxels = new Uint8Array(voxels.length);
      const { images } = await loadVolumeTextureImages(stackEntries, {
        signal,
        validateDimensions: (observedDimensions) => {
          if (observedDimensions.some((dimension, axis) => dimension !== expectedDimensions[axis])) {
            throw new ExternalOverlayDimensionMismatchError(
              `External overlay stack ${stackIndex + 1} dimensions ${observedDimensions.join('×')} do not match volume dimensions ${expectedDimensions.join('×')}`,
            );
          }
        },
      });
      images.forEach((image, z) => {
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, width, height).data;
        const sliceOffset = z * width * height * 4;
        for (let index = 0; index < width * height; index += 1) {
          const pixelOffset = index * 4;
          compositeRgbaPixel(
            stackVoxels,
            sliceOffset + pixelOffset,
            rgba,
            pixelOffset,
            {
              alphaMultiplier: configuredOpacity * (isHighlightedStack ? 1.8 : 1),
              colorMultiplier: isHighlightedStack ? 1.35 : 1,
              sourceColorOverride: configuredColor,
              sourceAlphaOverride: shouldTintByMask
                ? Math.max(rgba[pixelOffset], rgba[pixelOffset + 1], rgba[pixelOffset + 2]) / 255
                : null,
            },
          );
        }
      });
      for (let pixelOffset = 0; pixelOffset < stackVoxels.length; pixelOffset += 4) {
        compositeRgbaPixel(voxels, pixelOffset, stackVoxels, pixelOffset);
      }
      acceptedOverlayStackCount += 1;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // External uploads are optional. A corrupt, unavailable, or mismatched
      // overlay must not take down an otherwise valid base reconstruction.
      continue;
    }
  }

  throwIfAborted(signal);
  if (acceptedOverlayStackCount === 0) return null;
  let texture;
  try {
    texture = new THREE.Data3DTexture(voxels, width, height, depth);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    disposeOptionalTexture(texture);
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}

async function createSegmentationTexture(THREE, labelSlices, volumeImageStack, width, height, depth) {
  if (!Array.isArray(labelSlices) || labelSlices.length === 0) return null;
  const inlineLabelSlices = labelSlices.filter((slice) => Array.isArray(slice?.labels) || ArrayBuffer.isView(slice?.labels));
  if (inlineLabelSlices.length === 0) return null;
  const labels = new Uint8Array(width * height * depth);
  const orderedVolume = [...volumeImageStack].sort((a, b) => Number(a.sliceIndex || 0) - Number(b.sliceIndex || 0));
  const sliceIndexToDepth = new Map(orderedVolume.map((slice, index) => [String(slice.sliceIndex ?? index), index]));
  if (inlineLabelSlices.length !== depth) {
    throw new Error(`Segmentation label depth ${inlineLabelSlices.length} does not match volume depth ${depth}`);
  }
  const seenDepths = new Set();
  inlineLabelSlices.forEach((slice, fallbackIndex) => {
    const z = sliceIndexToDepth.get(String(slice?.sliceIndex)) ?? fallbackIndex;
    if (z < 0 || z >= depth || seenDepths.has(z)) {
      throw new Error(`Segmentation label slice ${slice?.sliceIndex ?? fallbackIndex} is duplicated or outside the volume`);
    }
    seenDepths.add(z);
    const targetOffset = z * width * height;
    if (slice.labels.length !== width * height) throw new Error(`Segmentation label slice ${z} has invalid dimensions`);
    for (let index = 0; index < width * height; index += 1) {
      const label = Number(slice.labels[index]);
      if (!Number.isInteger(label) || label < 0 || label > 255) throw new Error(`Segmentation label slice ${z} contains an invalid label`);
      labels[targetOffset + index] = label;
    }
  });
  const texture = new THREE.Data3DTexture(labels, width, height, depth);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function createSegmentationPaletteTexture(THREE) {
  const data = new Uint8Array(256 * 4);
  const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function createSegmentationStateTexture(THREE) {
  const data = new Uint8Array(256);
  const texture = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function updateSegmentationPalette(texture, stateTexture, segments = []) {
  const data = texture.image.data;
  const states = stateTexture.image.data;
  data.fill(0);
  states.fill(0);
  segments.forEach((segment) => {
    const id = Number(segment.id);
    if (!Number.isInteger(id) || id < 1 || id > 255) return;
    states[id] = segment.visible === false ? 2 : 1;
    if (segment.visible === false) return;
    const [red, green, blue, alpha] = segmentColorToRgba(segment.color, segment.opacity);
    const offset = id * 4;
    data[offset] = Math.round(red);
    data[offset + 1] = Math.round(green);
    data[offset + 2] = Math.round(blue);
    data[offset + 3] = Math.round(alpha * 255);
  });
  texture.needsUpdate = true;
  stateTexture.needsUpdate = true;
}

export const PT3_VOLUME_FRAGMENT_SHADER = `
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D volumeMap;
#ifdef PT3_EXTERNAL_OVERLAY
  uniform sampler3D externalOverlayMap;
#endif
  uniform sampler3D segmentationMap;
  uniform sampler2D segmentationPalette;
  uniform sampler2D segmentationState;
  uniform bool hasSegmentation;
  uniform bool hasExternalOverlay;
  uniform float segmentationOpacityMultiplier;
  uniform float externalOverlayOpacity;
  uniform vec3 cameraLocal;
  uniform vec3 voxelStep;
  uniform vec3 physicalSize;
  uniform float stepSize;
  uniform float sampleStep;
  uniform float opacityMultiplier;
  uniform float intensityThreshold;
  uniform float opacityRampWidth;
  uniform vec3 colorLow;
  uniform vec3 colorHigh;
  uniform int renderStyle;
  uniform float windowCenter;
  uniform float windowWidth;
  uniform float isoThreshold;
  uniform float isoWidth;
  uniform bool boundaryEnhancement;
  uniform float boundaryStrength;
  uniform float boundaryBandWidth;
  in vec3 localPosition;
  out vec4 outputColor;

  vec3 centralDifferenceGradient(vec3 point) {
    vec3 lower = vec3(0.0);
    vec3 upper = vec3(1.0);
    vec3 forwardPoint = min(upper, point + voxelStep);
    vec3 backwardPoint = max(lower, point - voxelStep);
    float xForward = texture(volumeMap, vec3(forwardPoint.x, point.y, point.z)).r;
    float xBackward = texture(volumeMap, vec3(backwardPoint.x, point.y, point.z)).r;
    float yForward = texture(volumeMap, vec3(point.x, forwardPoint.y, point.z)).r;
    float yBackward = texture(volumeMap, vec3(point.x, backwardPoint.y, point.z)).r;
    float zForward = texture(volumeMap, vec3(point.x, point.y, forwardPoint.z)).r;
    float zBackward = texture(volumeMap, vec3(point.x, point.y, backwardPoint.z)).r;
    vec3 physicalSpan = max((forwardPoint - backwardPoint) * physicalSize, vec3(0.000001));
    return vec3(xForward - xBackward, yForward - yBackward, zForward - zBackward) / physicalSpan;
  }

  void applyBoundaryEnhancement(vec3 point, inout vec3 color, inout float alpha) {
    if (!boundaryEnhancement || alpha <= 0.0) return;
    float gradientMagnitude = length(centralDifferenceGradient(point));
    float edge = smoothstep(boundaryBandWidth * 0.25, boundaryBandWidth, gradientMagnitude);
    float boost = boundaryStrength * edge;
    alpha *= 1.0 + boost;
    color = mix(color, colorHigh, clamp(boost * 0.35, 0.0, 0.75));
  }

  float rayBoxExitDistance(vec3 point, vec3 direction) {
    float xDistance = direction.x > 0.000001
      ? (1.0 - point.x) / direction.x
      : direction.x < -0.000001 ? (0.0 - point.x) / direction.x : 1000000.0;
    float yDistance = direction.y > 0.000001
      ? (1.0 - point.y) / direction.y
      : direction.y < -0.000001 ? (0.0 - point.y) / direction.y : 1000000.0;
    float zDistance = direction.z > 0.000001
      ? (1.0 - point.z) / direction.z
      : direction.z < -0.000001 ? (0.0 - point.z) / direction.z : 1000000.0;
    return max(0.0, min(xDistance, min(yDistance, zDistance)));
  }

  float boundedProjectionOpacity(float transferResponse) {
    float opticalDepth = max(0.0, opacityMultiplier) * clamp(transferResponse, 0.0, 1.0);
    return clamp(1.0 - exp(-opticalDepth), 0.0, 1.0);
  }

  vec4 addProjectionOverlay(vec4 baseColor, vec4 overlayColor) {
    return vec4(
      overlayColor.rgb + (1.0 - overlayColor.a) * baseColor.rgb,
      overlayColor.a + (1.0 - overlayColor.a) * baseColor.a
    );
  }

  void main() {
    // Front faces provide the near entry point; march away from the camera.
    vec3 ray = normalize(localPosition - cameraLocal);
    vec3 samplePoint = localPosition + vec3(0.5);
    float exitDistance = rayBoxExitDistance(samplePoint, ray);
    float marchStep = max(stepSize, exitDistance / ${PT3_MAX_RAY_MARCH_SAMPLES - 1}.0);
    float effectiveSampleStep = sampleStep * marchStep / max(stepSize, 0.0000001);
    vec4 accumulated = vec4(0.0);
    float maximumValue = -1.0;
    vec3 maximumColor = vec3(0.0);
    float xrayValueTotal = 0.0;
    float xraySampleCount = 0.0;
    vec4 segmentProjection = vec4(0.0);
    vec4 externalOverlayProjection = vec4(0.0);

    for (int i = 0; i < ${PT3_MAX_RAY_MARCH_SAMPLES}; i++) {
      bool outsideVolume = any(lessThan(samplePoint, vec3(0.0)))
        || any(greaterThan(samplePoint, vec3(1.0)));
      bool projectionsComplete = accumulated.a > 0.98
        && (!hasExternalOverlay || externalOverlayProjection.a > 0.98);
      if (outsideVolume || projectionsComplete) break;
      float value = texture(volumeMap, samplePoint).r;
#ifdef PT3_EXTERNAL_OVERLAY
      if (hasExternalOverlay) {
        vec4 externalOverlaySample = texture(externalOverlayMap, samplePoint);
        float externalOverlayAlpha = clamp(
          1.0 - exp(-clamp(externalOverlaySample.a, 0.0, 1.0) * effectiveSampleStep),
          0.0,
          1.0
        );
        externalOverlayProjection.rgb += (1.0 - externalOverlayProjection.a)
          * externalOverlayAlpha * externalOverlaySample.rgb;
        externalOverlayProjection.a += (1.0 - externalOverlayProjection.a)
          * externalOverlayAlpha;
      }
#endif
      float segmentState = 0.0;
      vec4 segmentColor = vec4(0.0);
      if (hasSegmentation) {
        float label = floor(texture(segmentationMap, samplePoint).r * 255.0 + 0.5);
        if (label > 0.5) {
          vec2 palettePoint = vec2((label + 0.5) / 256.0, 0.5);
          segmentState = floor(texture(segmentationState, palettePoint).r * 255.0 + 0.5);
          if (segmentState > 1.5) {
            samplePoint += ray * marchStep;
            continue;
          }
          if (segmentState > 0.5) {
            segmentColor = texture(segmentationPalette, palettePoint);
          }
        }
      }

      if ((renderStyle == 1 || renderStyle == 2) && segmentState > 0.5) {
        float segmentAlpha = clamp(
          1.0 - exp(-clamp(segmentColor.a, 0.0, 1.0) * effectiveSampleStep),
          0.0,
          1.0
        );
        segmentProjection.rgb += (1.0 - segmentProjection.a) * segmentAlpha * segmentColor.rgb;
        segmentProjection.a += (1.0 - segmentProjection.a) * segmentAlpha;
      }

      if (renderStyle == 1) {
        // Maximum-intensity projection keeps the strongest visible sample on the ray.
        if (value > maximumValue) {
          maximumValue = value;
          maximumColor = mix(colorLow, colorHigh, smoothstep(intensityThreshold, 1.0, value));
        }
      } else if (renderStyle == 2) {
        // Average-intensity projection traverses the full ray for an X-ray view.
        xrayValueTotal += value;
        xraySampleCount += 1.0;
      } else if (renderStyle == 3) {
        // Iso rendering accumulates only the narrow intensity band around the threshold.
        float isoBand = 1.0 - smoothstep(0.0, isoWidth, abs(value - isoThreshold));
        float alpha = isoBand * 0.28 * opacityMultiplier * effectiveSampleStep;
        vec3 color = mix(colorLow, colorHigh, smoothstep(intensityThreshold, 1.0, value));
        if (boundaryEnhancement && alpha > 0.0) {
          vec3 gradient = centralDifferenceGradient(samplePoint);
          float gradientMagnitude = length(gradient);
          if (gradientMagnitude > 0.00001) {
            vec3 normal = gradient / gradientMagnitude;
            vec3 physicalRay = normalize(ray * physicalSize);
            float diffuse = 0.25 + 0.75 * abs(dot(normal, physicalRay));
            color *= mix(1.0, diffuse, clamp(boundaryStrength * 0.5, 0.0, 1.0));
          }
        }
        if (segmentState > 0.5) {
          color = mix(color, segmentColor.rgb, segmentationOpacityMultiplier);
          alpha *= mix(1.0, segmentColor.a, segmentationOpacityMultiplier);
        }
        alpha = clamp(alpha, 0.0, 1.0);
        accumulated.rgb += (1.0 - accumulated.a) * alpha * color;
        accumulated.a += (1.0 - accumulated.a) * alpha;
      } else if (renderStyle == 4) {
        // Window rendering suppresses samples outside the selected intensity band.
        float halfWindow = windowWidth * 0.5;
        float windowLow = max(0.0, windowCenter - halfWindow);
        float windowHigh = min(1.0, windowCenter + halfWindow);
        float windowEdge = max(0.002, min(opacityRampWidth * 0.25, (windowHigh - windowLow) * 0.25));
        float windowOpacity = smoothstep(windowLow, windowLow + windowEdge, value)
          * (1.0 - smoothstep(windowHigh - windowEdge, windowHigh, value));
        float alpha = windowOpacity * 0.075 * opacityMultiplier * effectiveSampleStep;
        float windowPosition = clamp((value - windowLow) / max(0.001, windowHigh - windowLow), 0.0, 1.0);
        vec3 color = mix(colorLow, colorHigh, windowPosition);
        applyBoundaryEnhancement(samplePoint, color, alpha);
        if (segmentState > 0.5) {
          color = mix(color, segmentColor.rgb, segmentationOpacityMultiplier);
          alpha *= mix(1.0, segmentColor.a, segmentationOpacityMultiplier);
        }
        alpha = clamp(alpha, 0.0, 1.0);
        accumulated.rgb += (1.0 - accumulated.a) * alpha * color;
        accumulated.a += (1.0 - accumulated.a) * alpha;
      } else {
        // Composite is the legacy transfer and front-to-back accumulation path.
        float alpha = smoothstep(intensityThreshold, min(1.0, intensityThreshold + opacityRampWidth), value)
          * 0.075 * opacityMultiplier * effectiveSampleStep;
        vec3 color = mix(colorLow, colorHigh, smoothstep(intensityThreshold, 1.0, value));
        applyBoundaryEnhancement(samplePoint, color, alpha);
        if (segmentState > 0.5) {
          color = mix(color, segmentColor.rgb, segmentationOpacityMultiplier);
          alpha *= mix(1.0, segmentColor.a, segmentationOpacityMultiplier);
        }
        alpha = clamp(alpha, 0.0, 1.0);
        accumulated.rgb += (1.0 - accumulated.a) * alpha * color;
        accumulated.a += (1.0 - accumulated.a) * alpha;
      }
      samplePoint += ray * marchStep;
    }

    vec4 reconstructedColor = vec4(0.0);
    segmentProjection *= segmentationOpacityMultiplier;
    externalOverlayProjection *= externalOverlayOpacity;
    if (renderStyle == 1) {
      if (maximumValue < 0.0) {
        reconstructedColor = vec4(0.0);
      } else {
        float transferResponse = smoothstep(
          intensityThreshold,
          min(1.0, intensityThreshold + opacityRampWidth),
          maximumValue
        );
        float alpha = boundedProjectionOpacity(transferResponse);
        reconstructedColor = addProjectionOverlay(
          vec4(maximumColor * alpha, alpha),
          segmentProjection
        );
      }
    } else if (renderStyle == 2) {
      if (xraySampleCount < 0.5) {
        reconstructedColor = vec4(0.0);
      } else {
        float averageValue = xrayValueTotal / xraySampleCount;
        vec3 color = mix(colorLow, colorHigh, smoothstep(intensityThreshold, 1.0, averageValue));
        float transferResponse = smoothstep(
          intensityThreshold,
          min(1.0, intensityThreshold + opacityRampWidth),
          averageValue
        );
        float alpha = boundedProjectionOpacity(transferResponse);
        reconstructedColor = addProjectionOverlay(
          vec4(color * alpha, alpha),
          segmentProjection
        );
      }
    } else {
      reconstructedColor = accumulated;
    }
    outputColor = addProjectionOverlay(reconstructedColor, externalOverlayProjection);
  }
`;

export async function createThreeMechanicalRenderer(canvas, {
  volumeDescriptor = null,
  metadata,
  mode,
  volumeImageStack = [],
  volumeOverlayImageStacks = [],
  segmentationLabelSlices = [],
  signal,
  onError,
}) {
  if (!canvas || mode === 'splat') return null;
  const rendererMetadata = getPt3VolumeMetadata(volumeDescriptor)
    || getPt3VolumeMetadata(metadata)
    || metadata;
  const THREE = await loadThree();
  throwIfAborted(signal);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  const gl = renderer.getContext();
  const hardwareTextureSizeLimit = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
  const includeSegmentationTexture = segmentationLabelSlices.some((slice) => (
    Array.isArray(slice?.labels) || ArrayBuffer.isView(slice?.labels)
  ));
  const includeExternalOverlayTexture = Array.isArray(volumeOverlayImageStacks)
    && volumeOverlayImageStacks.some((stack) => Array.isArray(stack) && stack.length > 0);
  let volumeTexture;
  try {
    volumeTexture = await createVolumeTexture(THREE, volumeImageStack, (dimensions) => {
      const validationError = getPt3TextureSizeLimitError(
        dimensions,
        hardwareTextureSizeLimit,
      ) || getPt3TextureAllocationLimitError(dimensions, {
        includeSegmentation: includeSegmentationTexture,
      });
      if (validationError) throw new Error(validationError);
    }, signal);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  const volumeWidth = volumeTexture.image?.width || 1;
  const volumeHeight = volumeTexture.image?.height || 1;
  const volumeDepth = volumeTexture.image?.depth || volumeImageStack.length || 1;
  const textureDimensions = [volumeWidth, volumeHeight, volumeDepth];
  let externalOverlayTexture;
  let segmentationTexture;
  let segmentationPaletteTexture;
  let segmentationStateTexture;
  try {
    throwIfAborted(signal);
    segmentationTexture = await createSegmentationTexture(
      THREE,
      segmentationLabelSlices,
      volumeImageStack,
      volumeWidth,
      volumeHeight,
      volumeDepth,
    );
    throwIfAborted(signal);
    externalOverlayTexture = await createPt3ExternalOverlayTextureWithinBudget({
      dimensions: textureDimensions,
      includeSegmentation: includeSegmentationTexture,
      hasOverlaySources: includeExternalOverlayTexture,
      signal,
      createTexture: () => createExternalOverlayTexture(
        THREE,
        volumeOverlayImageStacks,
        volumeWidth,
        volumeHeight,
        volumeDepth,
        signal,
      ),
    });
    throwIfAborted(signal);
    segmentationPaletteTexture = createSegmentationPaletteTexture(THREE);
    segmentationStateTexture = createSegmentationStateTexture(THREE);
  } catch (error) {
    volumeTexture.dispose();
    disposeOptionalTexture(externalOverlayTexture);
    segmentationTexture?.dispose();
    segmentationPaletteTexture?.dispose();
    segmentationStateTexture?.dispose();
    renderer.dispose();
    throw error;
  }
  const dimensions = rendererMetadata?.dimensions || [1, 1, 1];
  const spacing = rendererMetadata?.spacing || [1, 1, 1];
  const size = getPt3ViewSize(rendererMetadata);
  let scene;
  let camera;
  let geometry;
  let material;
  let volumeGroup;
  let boundsMaterial;
  let boundsGeometry;
  let sliceGuides = {};
  let inverseMatrix;
  let sizeVector;
  let presetColors;
  const partialSliceGuides = [];
  try {
    throwIfAborted(signal);
    scene = new THREE.Scene();
    const clipping = getPt3CameraClippingRange(rendererMetadata);
    camera = new THREE.PerspectiveCamera(
      PT3_VIEW_CAMERA_FOV_DEGREES,
      1,
      clipping.near,
      clipping.far,
    );
    camera.position.set(0, 0, 260);
    geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    presetColors = {
      machinedMetal: [[0.24, 0.36, 0.48], [0.96, 0.98, 1]],
      composite: [[0.06, 0.42, 0.4], [0.86, 1, 0.96]],
      defect: [[0.75, 0.2, 0.08], [1, 0.88, 0.72]],
    };
    const defaultReconstructionUniforms = getPt3ReconstructionUniformValues();
    material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    ...PT3_VOLUME_MATERIAL_OPTIONS,
    side: THREE.FrontSide,
    defines: externalOverlayTexture ? { PT3_EXTERNAL_OVERLAY: 1 } : {},
    uniforms: {
      volumeMap: { value: volumeTexture },
      externalOverlayMap: { value: externalOverlayTexture || volumeTexture },
      segmentationMap: { value: segmentationTexture || volumeTexture },
      segmentationPalette: { value: segmentationPaletteTexture },
      segmentationState: { value: segmentationStateTexture },
      hasSegmentation: { value: Boolean(segmentationTexture) },
      hasExternalOverlay: { value: Boolean(externalOverlayTexture) },
      segmentationOpacityMultiplier: { value: 1 },
      externalOverlayOpacity: { value: 1 },
      cameraLocal: { value: new THREE.Vector3() },
      voxelStep: {
        value: new THREE.Vector3(
          1 / Math.max(1, volumeWidth),
          1 / Math.max(1, volumeHeight),
          1 / Math.max(1, volumeDepth),
        ),
      },
      physicalSize: {
        value: new THREE.Vector3(
          ...size.map((axisSize) => Math.max(Number.EPSILON, Math.abs(Number(axisSize) || 1))),
        ),
      },
      stepSize: { value: 1 / Math.max(...textureDimensions, 1) },
      sampleStep: { value: 1.25 },
      opacityMultiplier: { value: 1.25 },
      intensityThreshold: { value: 0.08 },
      opacityRampWidth: { value: 0.52 },
      colorLow: { value: new THREE.Vector3(...presetColors.machinedMetal[0]) },
      colorHigh: { value: new THREE.Vector3(...presetColors.machinedMetal[1]) },
      renderStyle: { value: defaultReconstructionUniforms.renderStyle },
      windowCenter: { value: defaultReconstructionUniforms.windowCenter },
      windowWidth: { value: defaultReconstructionUniforms.windowWidth },
      isoThreshold: { value: defaultReconstructionUniforms.isoThreshold },
      isoWidth: { value: defaultReconstructionUniforms.isoWidth },
      boundaryEnhancement: { value: defaultReconstructionUniforms.boundaryEnhancement },
      boundaryStrength: { value: defaultReconstructionUniforms.boundaryStrength },
      boundaryBandWidth: { value: defaultReconstructionUniforms.boundaryBandWidth },
    },
    vertexShader: `
      out vec3 localPosition;
      void main() {
        localPosition = position / vec3(${size[0].toFixed(8)}, ${size[1].toFixed(8)}, ${size[2].toFixed(8)});
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: PT3_VOLUME_FRAGMENT_SHADER,
    });
    const mesh = new THREE.Mesh(geometry, material);
    volumeGroup = new THREE.Group();
    volumeGroup.add(mesh);

    boundsMaterial = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.34 });
    boundsGeometry = new THREE.EdgesGeometry(geometry);
    volumeGroup.add(new THREE.LineSegments(boundsGeometry, boundsMaterial));

    const createSliceGuide = (color, points) => {
      let guideGeometry;
      let guideMaterial;
      try {
        guideGeometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point)));
        guideMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.82, depthTest: false });
        const guide = new THREE.LineLoop(guideGeometry, guideMaterial);
        guide.renderOrder = 2;
        volumeGroup.add(guide);
        const resources = { guide, guideGeometry, guideMaterial };
        partialSliceGuides.push(resources);
        return resources;
      } catch (error) {
        guideGeometry?.dispose();
        guideMaterial?.dispose();
        throw error;
      }
    };
    sliceGuides = {
      axial: createSliceGuide(0x3b82f6, [[-size[0] / 2, -size[1] / 2, 0], [size[0] / 2, -size[1] / 2, 0], [size[0] / 2, size[1] / 2, 0], [-size[0] / 2, size[1] / 2, 0]]),
      coronal: createSliceGuide(0xf59e0b, [[-size[0] / 2, 0, -size[2] / 2], [size[0] / 2, 0, -size[2] / 2], [size[0] / 2, 0, size[2] / 2], [-size[0] / 2, 0, size[2] / 2]]),
      sagittal: createSliceGuide(0x10b981, [[0, -size[1] / 2, -size[2] / 2], [0, size[1] / 2, -size[2] / 2], [0, size[1] / 2, size[2] / 2], [0, -size[1] / 2, size[2] / 2]]),
    };
    scene.add(volumeGroup);
    inverseMatrix = new THREE.Matrix4();
    sizeVector = new THREE.Vector3(...size);
  } catch (error) {
    volumeTexture.dispose();
    disposeOptionalTexture(externalOverlayTexture);
    segmentationTexture?.dispose();
    segmentationPaletteTexture.dispose();
    segmentationStateTexture.dispose();
    geometry?.dispose();
    material?.dispose();
    boundsGeometry?.dispose();
    boundsMaterial?.dispose();
    partialSliceGuides.forEach(({ guideGeometry, guideMaterial }) => {
      guideGeometry.dispose();
      guideMaterial.dispose();
    });
    renderer.dispose();
    throw error;
  }

  let resourcesDisposed = false;
  const disposeRendererResources = () => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    volumeTexture.dispose();
    disposeOptionalTexture(externalOverlayTexture);
    segmentationTexture?.dispose();
    segmentationPaletteTexture.dispose();
    segmentationStateTexture.dispose();
    geometry.dispose();
    material.dispose();
    boundsGeometry.dispose();
    boundsMaterial.dispose();
    Object.values(sliceGuides).forEach(({ guideGeometry, guideMaterial }) => {
      guideGeometry.dispose();
      guideMaterial.dispose();
    });
    canvas.removeEventListener?.('webglcontextlost', handleContextLost);
    renderer.dispose();
  };

  const previousShaderErrorHandler = renderer.debug.onShaderError;
  let shaderInitializationError = null;
  let contextLostDuringInitialization = false;
  let initializationComplete = false;
  let runtimeErrorReported = false;
  const notifyRuntimeError = (error) => {
    if (runtimeErrorReported || resourcesDisposed) return;
    runtimeErrorReported = true;
    onError?.(error instanceof Error ? error : new Error(String(error)));
  };
  const handleContextLost = (event) => {
    event.preventDefault?.();
    contextLostDuringInitialization = true;
    if (initializationComplete) {
      notifyRuntimeError(new Error('PT3 volume renderer lost the WebGL context'));
    }
  };
  canvas.addEventListener?.('webglcontextlost', handleContextLost);
  renderer.debug.onShaderError = (context, program, vertexShader, fragmentShader) => {
    const diagnostics = [
      context.getProgramInfoLog(program),
      context.getShaderInfoLog(vertexShader),
      context.getShaderInfoLog(fragmentShader),
    ].filter(Boolean).join('\n').trim();
    shaderInitializationError = diagnostics || 'the volume shader could not be linked';
  };
  const initializeRenderer = () => {
    shaderInitializationError = null;
    contextLostDuringInitialization = false;
    throwIfAborted(signal);
    // Force shader compilation and 3D texture upload before advertising the
    // renderer as ready so the caller can use its existing Canvas fallback.
    for (let index = 0; index < 8 && gl.getError() !== gl.NO_ERROR; index += 1) {
      // Drain setup errors so the check below only reports this initialization.
    }
    renderer.setSize(1, 1, false);
    camera.aspect = 1;
    camera.position.z = getPt3CameraDistance(rendererMetadata);
    camera.updateProjectionMatrix();
    volumeGroup.updateMatrixWorld();
    inverseMatrix.copy(volumeGroup.matrixWorld).invert();
    material.uniforms.cameraLocal.value.copy(camera.position).applyMatrix4(inverseMatrix).divide(sizeVector);
    try {
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
    } catch (error) {
      const renderingError = gl.getError();
      if (
        contextLostDuringInitialization
        || gl.isContextLost()
        || renderingError === gl.CONTEXT_LOST_WEBGL
      ) {
        throw new Pt3WebGlContextLossError();
      }
      throw error;
    }
    if (shaderInitializationError) {
      throw new Error(`PT3 volume shader compilation failed: ${shaderInitializationError}`);
    }
    if (contextLostDuringInitialization || gl.isContextLost()) {
      throw new Pt3WebGlContextLossError();
    }
    const initializationError = gl.getError();
    if (initializationError === gl.CONTEXT_LOST_WEBGL) {
      throw new Pt3WebGlContextLossError();
    }
    if (initializationError !== gl.NO_ERROR) {
      throw new Error(`PT3 volume GPU initialization failed with WebGL error ${getWebGlErrorLabel(gl, initializationError)}`);
    }
  };
  let externalOverlayContextLoss = null;
  try {
    externalOverlayTexture = initializePt3RendererWithExternalOverlayFallback({
      initialize: initializeRenderer,
      externalOverlayTexture,
      signal,
      disableExternalOverlay: (failedTexture) => {
        externalOverlayTexture = null;
        material.uniforms.externalOverlayMap.value = volumeTexture;
        material.uniforms.hasExternalOverlay.value = false;
        if (material.defines) delete material.defines.PT3_EXTERNAL_OVERLAY;
        material.needsUpdate = true;
        disposeOptionalTexture(failedTexture);
      },
    });
  } catch (error) {
    if (error?.name === 'Pt3WebGlContextLossError' && externalOverlayTexture) {
      externalOverlayContextLoss = error;
    } else {
      disposeRendererResources();
      throw error;
    }
  } finally {
    renderer.debug.onShaderError = previousShaderErrorHandler;
  }
  if (externalOverlayContextLoss) {
    const forceContextRestore = typeof renderer.forceContextRestore === 'function'
      ? renderer.forceContextRestore.bind(renderer)
      : null;
    return recreatePt3BaseRendererAfterContextLoss({
      signal,
      disposeFailedRenderer: disposeRendererResources,
      restoreContext: () => waitForPt3WebGlContextRestoration(
        canvas,
        forceContextRestore,
        signal,
      ),
      createBaseRenderer: () => createThreeMechanicalRenderer(canvas, {
        volumeDescriptor,
        metadata,
        mode,
        volumeImageStack,
        volumeOverlayImageStacks: [],
        segmentationLabelSlices,
        signal,
        onError,
      }),
    });
  }
  initializationComplete = true;

  const sliceOffset = (value, dimension, axisSpacing) => {
    const upper = Math.max(0, Number(dimension) - 1);
    const clamped = Math.min(upper, Math.max(0, Number(value) || 0));
    return (clamped - upper / 2) * axisSpacing;
  };

  return {
    rendererType: 'three-webgl-raymarch',
    hasExternalOverlay: Boolean(externalOverlayTexture),
    render({
      width,
      height,
      rotation,
      zoom,
      mirrorScale,
      volumeOpacity,
      transferFunction,
      intensityThreshold,
      sampleStep,
      slicePosition,
      showSliceGuides,
      segmentationPalette,
      reconstructionStyle,
      windowCenter,
      windowWidth,
      isoThreshold,
      isoWidth,
      boundaryEnhancement,
      boundaryStrength,
      boundaryBandWidth,
      showExternalOverlay = true,
      externalOverlayOpacity = 1,
      segmentationOpacityMultiplier = 1,
    }) {
      if (resourcesDisposed) return;
      const safeWidth = Math.max(1, width || canvas.clientWidth || 1);
      const safeHeight = Math.max(1, height || canvas.clientHeight || 1);
      try {
        renderer.setSize(safeWidth, safeHeight, false);
      } catch (error) {
        notifyRuntimeError(error);
        return;
      }
      camera.aspect = safeWidth / safeHeight;
      camera.zoom = Math.min(4, Math.max(0.2, Number(zoom) || 1));
      camera.updateProjectionMatrix();
      volumeGroup.rotation.x = (rotation?.x || 0) * Math.PI / 180;
      volumeGroup.rotation.y = (rotation?.y || 0) * Math.PI / 180;
      const worldScale = getPt3WorldScale(mirrorScale);
      volumeGroup.scale.set(worldScale.x, worldScale.y, worldScale.z);
      // Keep the camera outside the rotated volume at every zoom level. Three's
      // optical zoom changes framing without dollying through the volume.
      camera.position.z = getPt3CameraDistance(rendererMetadata);
      sliceGuides.axial.guide.position.z = sliceOffset(slicePosition?.axial, dimensions[2], spacing[2]);
      sliceGuides.coronal.guide.position.y = sliceOffset(slicePosition?.coronal, dimensions[1], spacing[1]);
      sliceGuides.sagittal.guide.position.x = sliceOffset(slicePosition?.sagittal, dimensions[0], spacing[0]);
      Object.values(sliceGuides).forEach(({ guide }) => { guide.visible = Boolean(showSliceGuides); });
      volumeGroup.updateMatrixWorld();
      inverseMatrix.copy(volumeGroup.matrixWorld).invert();
      material.uniforms.cameraLocal.value.copy(camera.position).applyMatrix4(inverseMatrix).divide(sizeVector);
      material.uniforms.opacityMultiplier.value = Math.max(0, Number(volumeOpacity) || 0);
      material.uniforms.intensityThreshold.value = Math.min(0.95, Math.max(0, Number(intensityThreshold) || 0));
      const safeSampleStep = Math.min(3, Math.max(0.5, Number(sampleStep) || 1.25));
      material.uniforms.sampleStep.value = safeSampleStep;
      material.uniforms.stepSize.value = safeSampleStep / Math.max(...textureDimensions, 1);
      const safeExternalOverlayOpacity = Math.min(
        1,
        Math.max(0, Number(externalOverlayOpacity) || 0),
      );
      material.uniforms.hasExternalOverlay.value = Boolean(
        shouldRenderPt3ExternalOverlay(
          externalOverlayTexture,
          showExternalOverlay,
          safeExternalOverlayOpacity,
        ),
      );
      material.uniforms.externalOverlayOpacity.value = safeExternalOverlayOpacity;
      material.uniforms.segmentationOpacityMultiplier.value = Math.min(
        1,
        Math.max(0, Number(segmentationOpacityMultiplier) || 0),
      );
      updateSegmentationPalette(segmentationPaletteTexture, segmentationStateTexture, segmentationPalette);
      const parseColor = (hex, fallback) => {
        const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
        if (!match) return fallback;
        const value = Number.parseInt(match[1], 16);
        return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
      };
      material.uniforms.opacityRampWidth.value = Math.min(1, Math.max(0.01, Number(transferFunction?.opacityRampWidth) || 0.52));
      material.uniforms.colorLow.value.set(...parseColor(transferFunction?.colorLow, presetColors.machinedMetal[0]));
      material.uniforms.colorHigh.value.set(...parseColor(transferFunction?.colorHigh, presetColors.machinedMetal[1]));
      const reconstructionUniforms = getPt3ReconstructionUniformValues({
        reconstructionStyle,
        windowCenter,
        windowWidth,
        isoThreshold,
        isoWidth,
        boundaryEnhancement,
        boundaryStrength,
        boundaryBandWidth,
      });
      Object.entries(reconstructionUniforms).forEach(([uniformName, value]) => {
        material.uniforms[uniformName].value = value;
      });
      try {
        if (gl.isContextLost()) {
          throw new Error('PT3 volume renderer lost the WebGL context');
        }
        renderer.render(scene, camera);
        const renderError = gl.getError();
        if (renderError !== gl.NO_ERROR) {
          throw new Error(`PT3 volume rendering failed with WebGL error ${getWebGlErrorLabel(gl, renderError)}`);
        }
      } catch (error) {
        notifyRuntimeError(error);
      }
    },
    dispose() {
      disposeRendererResources();
    },
  };
}
