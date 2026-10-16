import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { generateTransferFunctionLut } from './pt3TransferFunctions';
import {
  createPt3PerspectiveProjector,
  getPhysicalBounds,
  normalizeAxisMirrorScale,
  pointInsideCropBox,
  voxelToPhysical,
} from './pt3VolumeGeometry';
import {
  createThreeMechanicalRenderer,
  DEFAULT_PT3_RECONSTRUCTION_OPTIONS,
  loadVolumeTextureImages,
  normalizePt3ReconstructionOptions,
} from './pt3ThreeRenderer';
import {
  MECHANICAL_TRANSFER_PRESETS,
  getMechanicalCropBox,
  getMechanicalVolumeDescriptor,
  makeMechanicalFallbackSplats,
} from './pt3MechanicalVisualization';
import {
  createPt3VolumeDescriptor,
  getPt3VolumeMetadata,
  isPt3VolumeDescriptor,
} from './pt3VolumeDescriptor';
import { getSegmentDisplayStyle, normalizePt3Segmentation, segmentColorToRgba } from './pt3Segmentation';
import { renderPt3VectorAnnotations } from './pt3VectorAnnotations';
import {
  buildPt3SliceLocatorGeometry,
  drawPt3SliceLocator,
  getPt3SliceLocatorDescription,
} from './pt3SliceLocator';
import {
  DEFAULT_SPLAT_VIEW_SETTINGS,
  evaluateGraphdecoSphericalHarmonics,
  getCanvasSplatSampleIndices,
  getPt3SplatViewDirection,
  MAX_CANVAS_GAUSSIANS,
  prepareSplatAssetForRendering,
  projectGaussianCovariance,
  sortSplatRenderEntriesBackToFront,
} from './pt3SplatRendering';
import {
  createPartRealGaussianSplatAsset,
  createPartVolumeSplatAsset,
  fetchPartRealGaussianSplatAssetStatus,
  fetchPartVolumeSplatAssetStatus,
} from '../api/parts';
import { rethrowWithServerDetail } from '../api/client';
import { createSplatWorker } from './pt3SplatAssetWorker';

export { DEFAULT_SPLAT_VIEW_SETTINGS } from './pt3SplatRendering';

const SPLAT_METADATA_KEYS = ['gaussian_splat_url', 'gaussian_splat_asset_url', 'splat_url', 'splat_asset_url', 'point_cloud_url'];
const REAL_SPLAT_METADATA_KEYS = ['real_gaussian_splat_url', 'real_gaussian_splat_asset_url'];
const VIEWER_MODES = { volume: 'volume', splat: 'splat', realSplat: 'real-splat', hybrid: 'hybrid' };
const QUALITY_PROFILES = { performance: { sampleStep: 2.5, scale: 0.65 }, balanced: { sampleStep: 1.25, scale: 0.85 }, quality: { sampleStep: 0.75, scale: 1 } };
const SPLAT_FALLBACK_NOTE = 'Generated 3DGS asset unavailable. Showing deterministic mechanical fallback splats.';
const DEFAULT_AXIS_MIRROR_SCALE = Object.freeze({ x: 1, y: 1, z: 1 });
const EMPTY_VOLUME_IMAGE_STACK = Object.freeze([]);
const EMPTY_VOLUME_OVERLAY_IMAGE_STACKS = Object.freeze([]);
const EMPTY_VECTOR_ANNOTATIONS = Object.freeze([]);
const VISUALLY_HIDDEN_STYLE = Object.freeze({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
const EMPTY_SEGMENTATION_SEGMENTS = Object.freeze([]);
export const REAL_SPLAT_BROWSER_MAX = 100000;
export const MAX_EXTERNAL_VOLUME_OVERLAY_POINTS = 30000;
const DEFAULT_REAL_SPLAT_BUDGET = 50000;
export const DEFAULT_RAY_MARCH_SETTINGS = Object.freeze({
  opacityRampWidth: 0.52,
  colorLow: '#3d5c7a',
  colorHigh: '#f5faff',
  volumeOpacity: 1.25,
  intensityThreshold: 0.08,
  quality: 'balanced',
  showSliceGuides: true,
  ...DEFAULT_PT3_RECONSTRUCTION_OPTIONS,
});

export function getRenderablePt3SegmentationSegments(
  segments,
  showAnnotations = true,
) {
  return showAnnotations ? segments : EMPTY_SEGMENTATION_SEGMENTS;
}

export function getPt3SegmentedSplatRgba({
  baseColor,
  baseAlpha,
  segment,
  opacityMultiplier = 1,
}) {
  const safeBaseColor = Array.from({ length: 3 }, (_unused, index) => (
    Math.max(0, Math.min(255, Number(baseColor?.[index]) || 0))
  ));
  const safeBaseAlpha = Math.max(0, Number(baseAlpha) || 0);
  if (!segment) return [...safeBaseColor, Math.min(1, safeBaseAlpha)];
  const numericMultiplier = Number(opacityMultiplier);
  const visualOpacity = Number.isFinite(numericMultiplier)
    ? Math.min(1, Math.max(0, numericMultiplier))
    : 1;
  const segmentRgba = segmentColorToRgba(segment.color, segment.opacity);
  return [
    ...safeBaseColor.map((channel, index) => (
      channel + (segmentRgba[index] - channel) * visualOpacity
    )),
    Math.min(1, safeBaseAlpha * (1 + (segmentRgba[3] - 1) * visualOpacity)),
  ];
}

const RAY_MARCH_QUALITY_IDS = new Set(Object.keys(QUALITY_PROFILES));
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function normalizeRayMarchNumber(value, fallback, minimum, maximum) {
  if (value === null || value === undefined || typeof value === 'boolean') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  let numeric;
  try {
    numeric = Number(value);
  } catch {
    return fallback;
  }
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function normalizeRayMarchBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'on'].includes(normalized)) return true;
    if (['false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeRayMarchColor(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback;
}

export function normalizeRayMarchSettings(settings = DEFAULT_RAY_MARCH_SETTINGS) {
  const source = isPlainObject(settings) ? settings : {};
  const reconstruction = normalizePt3ReconstructionOptions({
    ...source,
    boundaryEnhancement: normalizeRayMarchBoolean(
      source.boundaryEnhancement,
      DEFAULT_PT3_RECONSTRUCTION_OPTIONS.boundaryEnhancement,
    ),
  });
  const requestedQuality = typeof source.quality === 'string'
    ? source.quality.trim().toLowerCase()
    : '';
  return {
    opacityRampWidth: normalizeRayMarchNumber(
      source.opacityRampWidth,
      DEFAULT_RAY_MARCH_SETTINGS.opacityRampWidth,
      0.05,
      1,
    ),
    colorLow: normalizeRayMarchColor(source.colorLow, DEFAULT_RAY_MARCH_SETTINGS.colorLow),
    colorHigh: normalizeRayMarchColor(source.colorHigh, DEFAULT_RAY_MARCH_SETTINGS.colorHigh),
    volumeOpacity: normalizeRayMarchNumber(
      source.volumeOpacity,
      DEFAULT_RAY_MARCH_SETTINGS.volumeOpacity,
      0.25,
      2.5,
    ),
    intensityThreshold: normalizeRayMarchNumber(
      source.intensityThreshold,
      DEFAULT_RAY_MARCH_SETTINGS.intensityThreshold,
      0,
      0.6,
    ),
    quality: RAY_MARCH_QUALITY_IDS.has(requestedQuality)
      ? requestedQuality
      : DEFAULT_RAY_MARCH_SETTINGS.quality,
    showSliceGuides: normalizeRayMarchBoolean(
      source.showSliceGuides,
      DEFAULT_RAY_MARCH_SETTINGS.showSliceGuides,
    ),
    ...reconstruction,
  };
}

const RAY_MARCH_RECONSTRUCTION_DETAILS = Object.freeze({
  composite: {
    label: 'Composite',
    formula: 'α(I) = ρ · smoothstep(τ, τ + w, I); C(I) = mix(Cₗ, Cₕ, smoothstep(τ, 1, I)).',
    summary: 'Accumulates color and opacity from front to back using the existing density, threshold, ramp, and color defaults. Opaque exterior material can hide internal features.',
  },
  mip: {
    label: 'MIP',
    formula: 'Iₘₐₓ = maxₛ I(s); C = mix(Cₗ, Cₕ, smoothstep(τ, 1, Iₘₐₓ)).',
    summary: 'Keeps the highest-intensity sample on each ray to highlight dense features. MIP is a projection: it does not preserve depth, and a dense shell can still be the maximum.',
  },
  xray: {
    label: 'X-ray',
    formula: 'Ī = (1 / N) · Σₛ I(s); C = mix(Cₗ, Cₕ, smoothstep(τ, 1, Ī)).',
    summary: 'Averages all samples through the part so enclosed density contributes instead of being occluded. This is an average-intensity projection, not a depth-resolved surface.',
  },
  iso: {
    label: 'Iso',
    formula: 'B(I) = 1 − smoothstep(0, δ, |I − τᵢₛₒ|); α(I) = ρ · B(I).',
    summary: 'Reconstructs a narrow intensity boundary around the selected threshold. Adjust threshold to peel between material interfaces and width to control the boundary band.',
  },
  window: {
    label: 'Window',
    formula: 'L = c − b / 2; H = c + b / 2; α(I) > 0 only when L ≤ I ≤ H.',
    summary: 'Suppresses samples outside a selected intensity band. Move the center and narrow the width to isolate internal material, voids, or inclusions.',
  },
});

const BOUNDARY_ENHANCEMENT_STYLES = new Set(['composite', 'window', 'iso']);

function disposeThreeRenderer(rendererRef, canvas) {
  const activeRenderer = rendererRef.current;
  rendererRef.current = null;
  activeRenderer?.dispose?.();
  if (!canvas) return;
  // Resetting the backing store guarantees that a disposed WebGL context cannot
  // leave its last volume frame visible while the 2D splat/fallback takes over.
  canvas.width = Math.max(1, canvas.width || 1);
  canvas.height = Math.max(1, canvas.height || 1);
}

function isPlainObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function firstString(...values) { return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''; }
function getNestedSplatAsset(metadata) {
  for (const candidate of [metadata?.gaussian_splat, metadata?.splat, metadata?.point_cloud]) {
    if (typeof candidate === 'string' && candidate.trim()) return { url: candidate.trim(), assetRecord: metadata };
    if (isPlainObject(candidate)) {
      const url = firstString(candidate.url, candidate.asset_url, candidate.href, candidate.path);
      if (url) return { url, assetRecord: candidate };
    }
  }
  return null;
}

export function getPt3GaussianSplatAsset(part) {
  const metadata = isPlainObject(part?.metadata) ? part.metadata : {};
  const generatedAsset = isPlainObject(metadata.pt3_splat_asset) ? metadata.pt3_splat_asset : null;
  if (generatedAsset?.status === 'ready') {
    const generatedUrl = firstString(generatedAsset.asset_url, generatedAsset.url);
    if (generatedUrl) return {
      url: generatedUrl,
      label: 'preprocessed splat asset',
      assetRecord: generatedAsset,
      legacyPt3SplatAsset: generatedAsset,
    };
  }
  const directUrl = firstString(...SPLAT_METADATA_KEYS.map((key) => metadata[key]));
  if (directUrl) return { url: directUrl, label: 'part metadata', assetRecord: metadata };
  const nestedAsset = getNestedSplatAsset(metadata);
  if (nestedAsset?.url) return { ...nestedAsset, label: 'part metadata' };
  const splatRecord = (Array.isArray(metadata.source_images) ? metadata.source_images : []).find((record) => {
    const filename = String(record?.filename || '').toLowerCase();
    const kind = String(record?.kind || record?.asset_type || record?.metadata?.kind || record?.metadata?.asset_type || '').toLowerCase();
    return kind.includes('splat') || kind.includes('point_cloud') || /\.(splat|ply|ksplat|spz)(\?|$)/i.test(filename);
  });
  if (!splatRecord) return null;
  const recordUrl = firstString(splatRecord.url, splatRecord.asset_url, splatRecord.href, splatRecord.metadata?.url, splatRecord.metadata?.asset_url);
  return recordUrl ? { url: recordUrl, label: splatRecord.filename || 'splat source image', assetRecord: splatRecord } : null;
}

export function getPt3RealGaussianSplatAsset(part) {
  const metadata = isPlainObject(part?.metadata) ? part.metadata : {};
  const declaredAsset = isPlainObject(metadata.pt3_real_splat_asset) ? metadata.pt3_real_splat_asset : null;
  if (declaredAsset?.status === 'ready') {
    const url = firstString(declaredAsset.asset_url, declaredAsset.url, declaredAsset.href, declaredAsset.path);
    if (url) return { url, label: 'canonical real 3DGS asset', assetRecord: declaredAsset };
  }
  const directUrl = firstString(...REAL_SPLAT_METADATA_KEYS.map((key) => metadata[key]));
  if (directUrl) return { url: directUrl, label: 'real 3DGS metadata', assetRecord: metadata };
  const explicitRealAsset = metadata.real_gaussian_splat;
  if (typeof explicitRealAsset === 'string' && explicitRealAsset.trim()) {
    return { url: explicitRealAsset.trim(), label: 'real 3DGS metadata', assetRecord: metadata };
  }
  if (isPlainObject(explicitRealAsset)) {
    const url = firstString(explicitRealAsset.url, explicitRealAsset.asset_url, explicitRealAsset.href, explicitRealAsset.path);
    if (url && (!explicitRealAsset.status || explicitRealAsset.status === 'ready')) {
      return { url, label: 'real 3DGS metadata', assetRecord: explicitRealAsset };
    }
  }
  return null;
}

export function getPt3RealSplatCameras(part) {
  const metadata = isPlainObject(part?.metadata) ? part.metadata : {};
  const candidates = [
    metadata.pt3_real_3dgs?.cameras,
    metadata.pt3_camera_calibrations,
    metadata.camera_calibrations,
  ];
  const cameras = candidates.find((candidate) => Array.isArray(candidate));
  if (!cameras) return [];
  const seenImageIds = new Set();
  const numericValue = (value) => {
    if (typeof value === 'boolean' || value === null || (typeof value === 'string' && !value.trim())) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const numericVector = (value, length) => {
    if (!Array.isArray(value) || value.length !== length) return null;
    const normalized = value.map(numericValue);
    return normalized.every((item) => item !== null) ? normalized : null;
  };
  return cameras.filter((camera) => {
    if (!isPlainObject(camera)) return false;
    const imageId = typeof camera.image_id === 'string' ? camera.image_id.trim() : '';
    const width = numericValue(camera.width);
    const height = numericValue(camera.height);
    const intrinsics = numericVector(camera.intrinsics, 9);
    const rotation = numericVector(camera.rotation_quaternion, 4);
    const translation = numericVector(camera.translation, 3);
    if (!imageId || imageId.length > 255 || seenImageIds.has(imageId)) return false;
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) return false;
    if (!intrinsics || !rotation || !translation) return false;
    if (intrinsics[0] <= 0 || intrinsics[4] <= 0) return false;
    if (intrinsics[2] < 0 || intrinsics[2] > width || intrinsics[5] < 0 || intrinsics[5] > height) return false;
    if (Math.abs(intrinsics[6]) > 1e-8 || Math.abs(intrinsics[7]) > 1e-8 || Math.abs(intrinsics[8] - 1) > 1e-8) return false;
    if (Math.hypot(...rotation) <= 1e-12) return false;
    seenImageIds.add(imageId);
    return true;
  });
}


function buildMetadata(part) {
  return getMechanicalVolumeDescriptor(part);
}

function resolveViewerVolumeDescriptor(candidate, part = null) {
  return isPt3VolumeDescriptor(candidate)
    ? candidate
    : candidate
      ? createPt3VolumeDescriptor({
        sourceKind: 'synthetic',
        partMetadata: candidate,
        allowSynthetic: true,
      })
      : getMechanicalVolumeDescriptor(part);
}

function normalizeViewerVolumeMetadata(candidate, part = null) {
  const descriptor = resolveViewerVolumeDescriptor(candidate, part);
  return getPt3VolumeMetadata(
    descriptor,
    !isPt3VolumeDescriptor(candidate) && candidate && typeof candidate === 'object'
      ? candidate
      : {},
  );
}

function drawProjectedGaussian(ctx, { x, y, sigmaMajor, sigmaMinor, angle, color, alpha }) {
  const maximumRadius = Math.max(ctx.canvas.width, ctx.canvas.height);
  const major = Math.max(0.35, Math.min(maximumRadius, Number(sigmaMajor) || 0.35));
  const minor = Math.max(0.35, Math.min(maximumRadius, Number(sigmaMinor) || 0.35));
  const footprint = 3 * major;
  if (x + footprint < 0 || x - footprint > ctx.canvas.width || y + footprint < 0 || y - footprint > ctx.canvas.height) return false;
  const [red, green, blue] = color.map((value) => Math.round(Math.max(0, Math.min(255, value))));
  ctx.save?.();
  ctx.translate?.(x, y);
  ctx.rotate?.(Number(angle) || 0);
  ctx.scale?.(major, minor);
  if (typeof ctx.createRadialGradient === 'function') {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 3);
    gradient.addColorStop(0, `rgba(${red},${green},${blue},${alpha})`);
    gradient.addColorStop(1 / 3, `rgba(${red},${green},${blue},${alpha * Math.exp(-0.5)})`);
    gradient.addColorStop(2 / 3, `rgba(${red},${green},${blue},${alpha * Math.exp(-2)})`);
    gradient.addColorStop(0.9, `rgba(${red},${green},${blue},${alpha * Math.exp(-3.645)})`);
    gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2);
    else ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore?.();
  return true;
}

function getExternalOverlayReservoirSlot(seenActive, retainedCount, maxPoints) {
  if (retainedCount < maxPoints) return retainedCount;
  const hashed = Math.imul(seenActive, 2654435761) >>> 0;
  const candidate = hashed % seenActive;
  return candidate < maxPoints ? candidate : -1;
}

export async function loadPt3ExternalVolumeOverlayPoints(
  volumeOverlayImageStacks,
  metadata,
  { signal, maxPoints = MAX_EXTERNAL_VOLUME_OVERLAY_POINTS } = {},
) {
  const stacks = Array.isArray(volumeOverlayImageStacks)
    ? volumeOverlayImageStacks.filter((stack) => Array.isArray(stack) && stack.length > 0)
    : [];
  if (stacks.length === 0 || maxPoints < 1) return null;
  const normalizedMetadata = normalizeViewerVolumeMetadata(metadata);
  const [dimensionX, dimensionY, dimensionZ] = normalizedMetadata.dimensions;
  const retainedPositions = [];
  const retainedColors = [];
  let seenActive = 0;
  for (const stack of stacks) {
    if (signal?.aborted) return null;
    const highlighted = stack.some((entry) => entry?.highlighted === true);
    const { images, ordered } = await loadVolumeTextureImages(stack, { signal });
    if (signal?.aborted) return null;
    for (let z = 0; z < images.length; z += 1) {
      if (signal?.aborted) return null;
      const image = images[z];
      const width = image?.naturalWidth || image?.width || 0;
      const height = image?.naturalHeight || image?.height || 0;
      if (!width || !height) continue;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext?.('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas image decoding is unavailable');
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      const voxelSliceIndex = Number(ordered[z]?.voxelSliceIndex);
      const declaredSliceIndex = Number.isFinite(voxelSliceIndex)
        ? voxelSliceIndex
        : Number(ordered[z]?.sliceIndex);
      const voxelZ = Number.isFinite(declaredSliceIndex)
        ? Math.max(0, Math.min(dimensionZ - 1, declaredSliceIndex))
        : (images.length <= 1 ? 0 : (z / (images.length - 1)) * (dimensionZ - 1));
      for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
        const colorIndex = pixelIndex * 4;
        const alpha = pixels[colorIndex + 3];
        if (alpha <= 0) continue;
        seenActive += 1;
        const slot = getExternalOverlayReservoirSlot(
          seenActive,
          retainedPositions.length,
          maxPoints,
        );
        if (slot < 0) continue;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const voxelPoint = [
          width <= 1 ? 0 : (x / (width - 1)) * (dimensionX - 1),
          height <= 1 ? 0 : (y / (height - 1)) * (dimensionY - 1),
          voxelZ,
        ];
        retainedPositions[slot] = voxelToPhysical(voxelPoint, normalizedMetadata);
        retainedColors[slot] = [
          pixels[colorIndex],
          pixels[colorIndex + 1],
          pixels[colorIndex + 2],
          Math.min(1, (alpha / 255) * (highlighted ? 1.8 : 1)),
        ];
      }
    }
  }
  if (retainedPositions.length === 0) return null;
  return {
    positions: new Float32Array(retainedPositions.flat()),
    colors: new Float32Array(retainedColors.flat()),
    sourcePointCount: seenActive,
  };
}

function renderPreview(ctx, {
  mode,
  metadata,
  splats,
  rotation,
  zoom,
  mirrorScale,
  preset,
  crop,
  volumeOpacity,
  splatOpacity,
  splatPointSize,
  splatContrast,
  slicePosition,
  showSliceGuides,
  tunedSplatView,
  showReferenceFrame,
  projectionCache,
  segmentationSegments,
  externalOverlayPoints,
  annotationOpacityMultiplier,
  statsRef,
}) {
  if (!ctx?.canvas) return;
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2; const cy = height / 2;
  const bounds = getPhysicalBounds(metadata);
  const normalizedMetadata = normalizeViewerVolumeMetadata(metadata);
  const project = createPt3PerspectiveProjector({ metadata, width, height, rotation, zoom, mirrorScale });
  const centerVoxel = normalizedMetadata.dimensions.map((dimension) => (dimension - 1) / 2);
  const referencePixelsPerUnit = project(voxelToPhysical(centerVoxel, normalizedMetadata))[3];
  const lut = generateTransferFunctionLut({ preset, scalarRange: metadata.scalarRange, opacityMultiplier: volumeOpacity });
  const tuneColor = (value, fallback) => Math.round(Math.max(0, Math.min(1, ((value ?? fallback) - 0.5) * splatContrast + 0.5)) * 255);
  if (mode === VIEWER_MODES.volume) {
    const fallbackScale = Math.min(width, height) / Math.max(...bounds.size, 1) * 0.72 * zoom;
    for (let i = 0; i < 56; i += 1) {
      const t = i / 55;
      const colorIndex = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
      ctx.fillStyle = `rgba(${lut[colorIndex]},${lut[colorIndex + 1]},${lut[colorIndex + 2]},${(lut[colorIndex + 3] / 255) * 0.16})`;
      const w = bounds.size[0] * fallbackScale * (0.25 + t * 0.7);
      const h = bounds.size[1] * fallbackScale * (0.18 + (1 - t) * 0.62);
      ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, rotation.y * Math.PI / 360, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (mode !== VIEWER_MODES.volume && splats?.positions) {
    const splatCount = Math.floor(splats.positions.length / 3);
    const hasCanonicalCovariance = Boolean(splats.covariances3d?.length >= splatCount * 9);
    const sampledSplatIndices = getCanvasSplatSampleIndices({
      splatCount,
      maxSplats: hasCanonicalCovariance ? MAX_CANVAS_GAUSSIANS : undefined,
      segmentIds: splats.segmentIds,
      segments: segmentationSegments,
    });
    let projectedSplats = projectionCache?.splats === splats
      && projectionCache.width === width
      && projectionCache.height === height
      ? projectionCache.entries
      : null;
    if (!projectedSplats) {
      projectedSplats = [];
      for (const splatIndex of sampledSplatIndices) {
        const i = splatIndex * 3;
        const point = [splats.positions[i], splats.positions[i + 1], splats.positions[i + 2]];
        if (!pointInsideCropBox(point, crop)) continue;
        if (hasCanonicalCovariance) {
          const projectedGaussian = projectGaussianCovariance({
            mean: point,
            covariance: splats.covariances3d.subarray(splatIndex * 9, splatIndex * 9 + 9),
            project,
          });
          if (!projectedGaussian) continue;
          const viewDirection = getPt3SplatViewDirection({ metadata, point, rotation, mirrorScale });
          const shValuesPerSplat = splats.shValuesPerSplat || 3 * ((splats.shDegree || 0) + 1) ** 2;
          const shColor = splats.shCoefficients
            ? evaluateGraphdecoSphericalHarmonics(
              splats.shCoefficients,
              splats.shDegree,
              viewDirection,
              splatIndex * shValuesPerSplat,
            )
            : null;
          projectedSplats.push({ splatIndex, ...projectedGaussian, shColor, gaussian: true });
        } else {
          const [x, y, viewZ, pixelsPerWorldUnit] = project(point);
          projectedSplats.push({ splatIndex, x, y, viewZ, pixelsPerWorldUnit });
        }
      }
      sortSplatRenderEntriesBackToFront(projectedSplats);
      if (projectionCache) Object.assign(projectionCache, {
        splats,
        width,
        height,
        entries: projectedSplats,
      });
    }
    let renderedSplatCount = 0;
    projectedSplats.forEach((entry) => {
      const {
        splatIndex, x, y, pixelsPerWorldUnit, gaussian, shColor, sigmaMajor, sigmaMinor, angle,
      } = entry;
      const ci = splatIndex * 4;
      const segment = getSegmentDisplayStyle(splats.segmentIds?.[splatIndex], segmentationSegments);
      if (segment && !segment.visible) return;
      const baseColor = [
        tuneColor(shColor?.[0] ?? splats.colors?.[ci], 0.4),
        tuneColor(shColor?.[1] ?? splats.colors?.[ci + 1], 0.8),
        tuneColor(shColor?.[2] ?? splats.colors?.[ci + 2], 1),
      ];
      const [red, green, blue, alpha] = getPt3SegmentedSplatRgba({
        baseColor,
        baseAlpha: (splats.colors?.[ci + 3] ?? 0.7) * splatOpacity,
        segment,
        opacityMultiplier: annotationOpacityMultiplier,
      });
      const authoredScale = Math.max(0.1, Number(splats.scales?.[splatIndex]) || 1);
      const depthScale = Math.max(0.65, Math.min(1.8, pixelsPerWorldUnit / referencePixelsPerUnit));
      const radius = tunedSplatView
        ? Math.max(0.9, Math.min(18, authoredScale * splatPointSize * 1.4 * depthScale))
        : Math.max(1.4, 4 * depthScale);
      if (gaussian) {
        if (drawProjectedGaussian(ctx, {
          x,
          y,
          sigmaMajor: sigmaMajor * splatPointSize,
          sigmaMinor: sigmaMinor * splatPointSize,
          angle,
          color: [red, green, blue],
          alpha,
        })) renderedSplatCount += 1;
        return;
      }
      ctx.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      renderedSplatCount += 1;
    });
    statsRef.current.renderedSplats = renderedSplatCount;
  }
  if (externalOverlayPoints?.positions?.length) {
    const pointCount = Math.floor(externalOverlayPoints.positions.length / 3);
    const projectedOverlayPoints = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const positionOffset = pointIndex * 3;
      const [x, y, viewZ, pixelsPerWorldUnit] = project([
        externalOverlayPoints.positions[positionOffset],
        externalOverlayPoints.positions[positionOffset + 1],
        externalOverlayPoints.positions[positionOffset + 2],
      ]);
      projectedOverlayPoints.push({ pointIndex, splatIndex: pointIndex, x, y, viewZ, pixelsPerWorldUnit });
    }
    sortSplatRenderEntriesBackToFront(projectedOverlayPoints);
    projectedOverlayPoints.forEach(({ pointIndex, x, y, pixelsPerWorldUnit }) => {
      const colorOffset = pointIndex * 4;
      const alpha = Math.max(0, Math.min(1,
        (externalOverlayPoints.colors[colorOffset + 3] || 0) * annotationOpacityMultiplier,
      ));
      if (alpha <= 0) return;
      const radius = Math.max(1.25, Math.min(4.5, 1.8 * pixelsPerWorldUnit / referencePixelsPerUnit));
      const red = Math.round(externalOverlayPoints.colors[colorOffset] || 0);
      const green = Math.round(externalOverlayPoints.colors[colorOffset + 1] || 0);
      const blue = Math.round(externalOverlayPoints.colors[colorOffset + 2] || 0);
      ctx.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (showReferenceFrame && tunedSplatView) {
    const drawLoop = (points, color, lineWidth = 1, dash = []) => {
      const projected = points.map(project);
      ctx.beginPath();
      ctx.moveTo(projected[0][0], projected[0][1]);
      projected.slice(1).forEach((point) => ctx.lineTo(point[0], point[1]));
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const [dimensionX, dimensionY, dimensionZ] = normalizedMetadata.dimensions;
    const x0 = -0.5; const x1 = dimensionX - 0.5;
    const y0 = -0.5; const y1 = dimensionY - 0.5;
    const z0 = -0.5; const z1 = dimensionZ - 0.5;
    const framePoint = (x, y, z) => voxelToPhysical([x, y, z], normalizedMetadata);
    const corners = [
      framePoint(x0, y0, z0), framePoint(x1, y0, z0), framePoint(x1, y1, z0), framePoint(x0, y1, z0),
      framePoint(x0, y0, z1), framePoint(x1, y0, z1), framePoint(x1, y1, z1), framePoint(x0, y1, z1),
    ];
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([from, to]) => {
      const a = project(corners[from]); const b = project(corners[to]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.strokeStyle = 'rgba(226,232,240,0.58)'; ctx.lineWidth = 1; ctx.stroke();
    });
    const positionOnAxis = (axis, value) => Math.max(
      0,
      Math.min(normalizedMetadata.dimensions[axis] - 1, Number(value) || 0),
    );
    if (showSliceGuides) {
      const sliceX = positionOnAxis(0, slicePosition?.sagittal);
      const sliceY = positionOnAxis(1, slicePosition?.coronal);
      const sliceZ = positionOnAxis(2, slicePosition?.axial);
      drawLoop([framePoint(x0, y0, sliceZ), framePoint(x1, y0, sliceZ), framePoint(x1, y1, sliceZ), framePoint(x0, y1, sliceZ)], 'rgba(59,130,246,0.9)', 1.2, [4, 3]);
      drawLoop([framePoint(x0, sliceY, z0), framePoint(x1, sliceY, z0), framePoint(x1, sliceY, z1), framePoint(x0, sliceY, z1)], 'rgba(245,158,11,0.9)', 1.2, [4, 3]);
      drawLoop([framePoint(sliceX, y0, z0), framePoint(sliceX, y1, z0), framePoint(sliceX, y1, z1), framePoint(sliceX, y0, z1)], 'rgba(16,185,129,0.9)', 1.2, [4, 3]);
    }
    ctx.fillStyle = '#bae6fd'; ctx.fillText('R', width - 24, cy); ctx.fillText('S', cx, 18); ctx.fillText('A', cx + 22, cy + 24);
  } else if (showReferenceFrame) {
    const fallbackScale = Math.min(width, height) / Math.max(...bounds.size, 1) * 0.72 * zoom;
    ctx.strokeStyle = 'rgba(226,232,240,0.72)'; ctx.lineWidth = 1; ctx.strokeRect(cx - bounds.size[0] * fallbackScale / 2, cy - bounds.size[1] * fallbackScale / 2, bounds.size[0] * fallbackScale, bounds.size[1] * fallbackScale);
    ctx.fillStyle = '#bae6fd'; ctx.fillText('R', width - 24, cy); ctx.fillText('S', cx, 18); ctx.fillText('A', cx + 22, cy + 24);
  }
}

export default function Pt3GaussianSplatViewer({
  part,
  volumeDescriptor = null,
  volumeMetadata = null,
  projectId,
  volumeImageStack = EMPTY_VOLUME_IMAGE_STACK,
  volumeOverlayImageStacks = EMPTY_VOLUME_OVERLAY_IMAGE_STACKS,
  splatParameters,
  mode = VIEWER_MODES.hybrid,
  rotation = { x: -18, y: 32 },
  zoom = 1,
  mirrorScale = DEFAULT_AXIS_MIRROR_SCALE,
  slicePosition = { axial: 0, coronal: 0, sagittal: 0 },
  activeSliceAxis = 'axial',
  rayMarchSettings = DEFAULT_RAY_MARCH_SETTINGS,
  splatViewSettings = DEFAULT_SPLAT_VIEW_SETTINGS,
  onRayMarchSettingsChange,
  onSplatViewSettingsChange,
  onRotationChange,
  onZoomChange,
  onResetView,
  showRayMarchControls = false,
  showSplatControls = false,
  showRealOptimizationControls = true,
  vectorAnnotations = EMPTY_VECTOR_ANNOTATIONS,
  showAnnotations = true,
  annotationOpacityMultiplier = 1,
  pt3GuideSettings = null,
}) {
  const canvasRef = useRef(null);
  const webglCanvasRef = useRef(null);
  const threeRendererRef = useRef(null);
  const workerRef = useRef(null);
  const statsRef = useRef({ frames: 0, fps: 0, renderedSplats: 0 });
  const rayMarchSummaryId = useId();
  const rayMarchAvailabilityId = useId();
  const boundaryInactiveId = useId();
  const sliceLocatorDescriptionId = useId();
  const activeMirrorScale = useMemo(
    () => normalizeAxisMirrorScale(mirrorScale),
    [mirrorScale],
  );
  const activeRayMarchSettings = normalizeRayMarchSettings(rayMarchSettings);
  const {
    quality,
    volumeOpacity,
    intensityThreshold,
    showSliceGuides,
    opacityRampWidth,
    colorLow,
    colorHigh,
    reconstructionStyle,
    windowCenter,
    windowWidth,
    isoThreshold,
    isoWidth,
    boundaryEnhancement,
    boundaryStrength,
    boundaryBandWidth,
  } = activeRayMarchSettings;
  const reconstructionDetail = RAY_MARCH_RECONSTRUCTION_DETAILS[reconstructionStyle];
  const boundaryEnhancementSupported = BOUNDARY_ENHANCEMENT_STYLES.has(reconstructionStyle);
  const activeSplatViewSettings = { ...DEFAULT_SPLAT_VIEW_SETTINGS, ...(splatViewSettings || {}) };
  const {
    opacity: configuredSplatOpacity,
    pointSize: configuredSplatPointSize,
    contrast: configuredSplatContrast,
    showSliceGuides: configuredSplatGuides,
  } = activeSplatViewSettings;
  const [status, setStatus] = useState('initializing');
  const [statusDetail, setStatusDetail] = useState(null);
  const [rendererState, setRendererState] = useState({
    mode: null,
    metadata: null,
    volumeImageStack: null,
    volumeOverlayImageStacks: null,
    segmentationLabelSlices: null,
    type: 'pending',
  });
  const [rayRendererFallback, setRayRendererFallback] = useState(null);
  const [splats, setSplats] = useState(null);
  const [externalOverlayPoints, setExternalOverlayPoints] = useState(null);
  const [realMaxSplats, setRealMaxSplats] = useState(DEFAULT_REAL_SPLAT_BUDGET);
  const [realFitMode, setRealFitMode] = useState('voxel_direct');
  const [realGenerationVersion, setRealGenerationVersion] = useState(0);
  const cropEnabled = false;
  const isPureSplatMode = mode === VIEWER_MODES.splat || mode === VIEWER_MODES.realSplat;
  const splatOpacity = isPureSplatMode ? configuredSplatOpacity : 0.9;
  const splatPointSize = isPureSplatMode ? configuredSplatPointSize : 1;
  const splatContrast = isPureSplatMode ? configuredSplatContrast : 1;
  const splatGuidesVisible = isPureSplatMode ? configuredSplatGuides : showSliceGuides;
  const resolvedVolumeDescriptor = useMemo(
    () => (
      isPt3VolumeDescriptor(volumeDescriptor)
        ? volumeDescriptor
        : resolveViewerVolumeDescriptor(volumeMetadata || buildMetadata(part), part)
    ),
    [part, volumeDescriptor, volumeMetadata],
  );
  const metadata = useMemo(
    () => getPt3VolumeMetadata(
      resolvedVolumeDescriptor,
      volumeMetadata && typeof volumeMetadata === 'object' ? volumeMetadata : {},
    ),
    [resolvedVolumeDescriptor, volumeMetadata],
  );
  const sliceLocatorGeometry = useMemo(() => buildPt3SliceLocatorGeometry({
    metadata,
    width: 1,
    height: 1,
    slicePosition,
    activeSliceAxis,
  }), [activeSliceAxis, metadata, slicePosition]);
  const sliceLocatorDescription = getPt3SliceLocatorDescription(sliceLocatorGeometry);
  const segmentationContract = useMemo(() => normalizePt3Segmentation(part), [part]);
  const rendererMatchesCurrentVolume = rendererState.mode === mode
    && rendererState.metadata === metadata
    && rendererState.volumeImageStack === volumeImageStack
    && rendererState.volumeOverlayImageStacks === volumeOverlayImageStacks
    && rendererState.segmentationLabelSlices === segmentationContract.labelSlices;
  const rendererType = rendererMatchesCurrentVolume
    ? rendererState.type
    : isPureSplatMode ? 'canvas2d-fallback' : 'pending';
  const safeAnnotationOpacityMultiplier = Math.min(
    1,
    Math.max(0, Number(annotationOpacityMultiplier) || 0),
  );
  const rendererHasExternalOverlay = rendererMatchesCurrentVolume
    && Boolean(rendererState.hasExternalOverlay);
  const rayMarchControlsAvailable = mode === VIEWER_MODES.volume && rendererType.startsWith('three-');
  const realSplatCameras = useMemo(() => getPt3RealSplatCameras(part), [part]);
  const [segmentationSegments, setSegmentationSegments] = useState(segmentationContract.segments);
  const renderableSegmentationSegments = useMemo(
    () => getRenderablePt3SegmentationSegments(
      segmentationSegments,
      showAnnotations,
    ),
    [segmentationSegments, showAnnotations],
  );
  const asset = useMemo(() => (
    mode === VIEWER_MODES.realSplat ? getPt3RealGaussianSplatAsset(part) : getPt3GaussianSplatAsset(part)
  ), [mode, part]);

  useEffect(() => {
    setSegmentationSegments(segmentationContract.segments);
  }, [segmentationContract]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    if (mode === VIEWER_MODES.volume) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setSplats(null);
      setStatus(volumeImageStack.length > 0 ? 'loading' : 'fallback');
      setStatusDetail(volumeImageStack.length > 0 ? null : {
        note: 'No volume stack images are attached to this part. Showing deterministic volume bounds fallback.',
      });
      return () => { cancelled = true; };
    }
    const requestId = `${Date.now()}-${Math.random()}`;
    const showDeterministicSplatFallback = () => {
      if (cancelled) return;
      setSplats(makeMechanicalFallbackSplats(metadata));
      setStatus('ready');
      setStatusDetail({ note: SPLAT_FALLBACK_NOTE });
    };
    const handleSplatFailure = (error) => {
      if (mode !== VIEWER_MODES.realSplat) {
        showDeterministicSplatFallback();
        return;
      }
      if (cancelled) return;
      setSplats(null);
      setStatus('failed');
      setStatusDetail({
        error: error?.message || 'Could not load the canonical splat asset',
        note: 'Real 3DGS could not be loaded. No simplified fallback was used.',
      });
    };
    const loadSplatAsset = (url, coordinateContext = {}) => {
      workerRef.current?.terminate();
      let worker;
      try {
        worker = createSplatWorker();
      } catch {
        handleSplatFailure(new Error('3DGS asset worker is unavailable'));
        return;
      }
      workerRef.current = worker;
      worker.onmessage = (event) => {
        if (cancelled || event.data?.id !== requestId) return;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        if (!event.data.ok) { handleSplatFailure(new Error(event.data.error || 'Could not parse 3DGS asset')); return; }
        const parsedSplats = {
          positions: event.data.positions,
          scales: event.data.scales,
          colors: event.data.colors,
          scaleVectors: event.data.scaleVectors,
          rotations: event.data.rotations,
          shCoefficients: event.data.shCoefficients,
          shDegree: event.data.shDegree,
          shValuesPerSplat: event.data.shValuesPerSplat,
          segmentIds: event.data.segmentIds || [],
          layers: event.data.layers || [],
          metadata: event.data.metadata || {},
        };
        setSplats(prepareSplatAssetForRendering(parsedSplats, metadata, {
          ...coordinateContext,
          assetUrl: url,
          parsedMetadata: parsedSplats.metadata,
        })); setStatus('ready'); setStatusDetail(null);
      };
      worker.onerror = () => {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        handleSplatFailure(new Error('Could not load 3DGS asset'));
      };
      try {
        worker.postMessage({
          id: requestId,
          url: new URL(url, window.location.origin).href,
          requireCanonical: mode === VIEWER_MODES.realSplat,
        });
      } catch {
        handleSplatFailure(new Error('3DGS asset URL is invalid'));
      }
    };
    setStatus('loading'); setStatusDetail(null);
    if (mode === VIEWER_MODES.realSplat && (!asset?.url || realGenerationVersion > 0)) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setSplats(null);
      if (!projectId || !part?.id) {
        setStatus('unavailable');
        setStatusDetail({ note: 'Real 3DGS unavailable. A saved PT3 part is required before fitting or training can run.' });
        return () => { cancelled = true; };
      }
      const pollRealStatus = () => fetchPartRealGaussianSplatAssetStatus(projectId, part.id)
        .then((payload) => {
          if (cancelled) return;
          const progress = Math.round(Number(payload.progress_percent) || 0);
          if (payload.status === 'pending') {
            setStatus('pending');
            setStatusDetail({ note: `${payload.stage || 'Optimizing'} • ${progress}% complete` });
            pollTimer = window.setTimeout(pollRealStatus, 750);
            return;
          }
          if (payload.status === 'ready' && payload.asset_url) {
            loadSplatAsset(payload.asset_url, { sourceMetadata: payload });
            return;
          }
          setStatus(payload.status || 'unavailable');
          setStatusDetail({
            error: payload.error || null,
            note: payload.status === 'missing' && realFitMode === 'voxel_direct'
              ? 'The voxel stack is ready for an analytic fit. Choose a splat budget, then fit voxel splats.'
              : 'Synthetic-view and hybrid fitting require a configured provider and calibrated or generated views. Simplified splats are never substituted.',
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setStatus('failed');
          setStatusDetail({ error: error.message, note: 'Could not read Real 3DGS fitting or training status.' });
        });
      pollRealStatus();
      return () => { cancelled = true; if (pollTimer) window.clearTimeout(pollTimer); workerRef.current?.terminate(); };
    }
    if (!asset?.url) {
      if (projectId && part?.id) {
        const pollStatus = () => fetchPartVolumeSplatAssetStatus(projectId, part.id)
          .then((payload) => {
            if (cancelled) return;
            if (payload.status === 'pending') { setStatusDetail(null); setStatus('pending'); pollTimer = window.setTimeout(pollStatus, 750); return; }
            if (payload.status === 'failed') { showDeterministicSplatFallback(); return; }
            if (payload.status === 'ready' && payload.asset_url) { loadSplatAsset(payload.asset_url, { sourceMetadata: payload }); return; }
            return createPartVolumeSplatAsset(projectId, part.id, { source_image_ids: [], transfer_function: { threshold: Number(splatParameters?.threshold) || 1, intensity_min: Number(splatParameters?.intensityMin) || 0, intensity_max: Number(splatParameters?.intensityMax) || 255, opacity_min: Number(splatParameters?.opacityMin) || 0.05, opacity_max: Number(splatParameters?.opacityMax) || 1, color_map: 'grayscale' }, downsample: Number(splatParameters?.downsample) || 1, max_splats: Number(splatParameters?.maxSplats) || 100000, output_format: splatParameters?.outputFormat || 'json' })
              .then((payload2) => {
              if (cancelled) return;
              if (payload2.status === 'failed') { showDeterministicSplatFallback(); return; }
              if (payload2.status === 'ready' && payload2.asset_url) { loadSplatAsset(payload2.asset_url, { sourceMetadata: payload2 }); return; }
              setStatusDetail(null);
              setStatus('pending');
              pollTimer = window.setTimeout(pollStatus, 750);
            });
          })
          .catch(() => showDeterministicSplatFallback());
        pollStatus();
        return () => { cancelled = true; if (pollTimer) window.clearTimeout(pollTimer); workerRef.current?.terminate(); };
      }
      setSplats(makeMechanicalFallbackSplats(metadata)); setStatus('ready'); setStatusDetail({ note: 'Using deterministic mechanical part fallback splats until a PT3 asset is generated.' }); return undefined;
    }
    loadSplatAsset(asset.url, asset);
    return () => { cancelled = true; workerRef.current?.terminate(); };
  }, [asset, metadata, mode, part?.id, projectId, realFitMode, realGenerationVersion, realSplatCameras.length, splatParameters?.downsample, splatParameters?.intensityMax, splatParameters?.intensityMin, splatParameters?.maxSplats, splatParameters?.opacityMax, splatParameters?.opacityMin, splatParameters?.outputFormat, splatParameters?.threshold, volumeImageStack.length]);

  useEffect(() => {
    const controller = new AbortController();
    setExternalOverlayPoints(null);
    const shouldLoadCanvasOverlayPoints = isPureSplatMode
      || rendererType === 'canvas2d-fallback';
    if (!shouldLoadCanvasOverlayPoints
      || !Array.isArray(volumeOverlayImageStacks)
      || volumeOverlayImageStacks.length === 0) {
      return () => controller.abort();
    }
    loadPt3ExternalVolumeOverlayPoints(volumeOverlayImageStacks, metadata, {
      signal: controller.signal,
    }).then((points) => {
      if (!controller.signal.aborted) setExternalOverlayPoints(points);
    }).catch(() => {
      if (!controller.signal.aborted) setExternalOverlayPoints(null);
    });
    return () => controller.abort();
  }, [isPureSplatMode, metadata, rendererType, volumeOverlayImageStacks]);


  useEffect(() => {
    const canvas = webglCanvasRef.current;
    let cancelled = false;
    if (!canvas || isPureSplatMode) {
      disposeThreeRenderer(threeRendererRef, canvas);
      setRendererState({
        mode,
        metadata,
        volumeImageStack,
        volumeOverlayImageStacks,
        segmentationLabelSlices: segmentationContract.labelSlices,
        type: 'canvas2d-fallback',
      });
      setRayRendererFallback(null);
      return undefined;
    }
    const initializationController = new AbortController();
    setRendererState({
      mode,
      metadata,
      volumeImageStack,
      volumeOverlayImageStacks,
      segmentationLabelSlices: segmentationContract.labelSlices,
      type: 'pending',
    });
    setRayRendererFallback(null);
    const showRendererFallback = (error) => {
      if (cancelled) return;
      const reason = error?.message || 'Could not initialize ray-marched volume';
      disposeThreeRenderer(threeRendererRef, canvas);
      setRendererState({
        mode,
        metadata,
        volumeImageStack,
        volumeOverlayImageStacks,
        segmentationLabelSlices: segmentationContract.labelSlices,
        type: 'canvas2d-fallback',
      });
      if (mode === VIEWER_MODES.volume) {
        setStatus('fallback');
        setStatusDetail({
          error: reason,
          note: 'Ray-marched volume unavailable. Showing deterministic volume bounds fallback.',
        });
      } else if (mode === VIEWER_MODES.hybrid) {
        setRayRendererFallback(
          `Ray-marched layer unavailable: ${reason}. Showing the aligned 3DGS fallback only.`,
        );
      }
    };
    createThreeMechanicalRenderer(canvas, {
      volumeDescriptor: resolvedVolumeDescriptor,
      metadata,
      mode,
      volumeImageStack,
      volumeOverlayImageStacks,
      segmentationLabelSlices: segmentationContract.labelSlices,
      signal: initializationController.signal,
      onError: showRendererFallback,
    })
      .then((renderer) => {
        if (cancelled || !renderer) {
          renderer?.dispose?.();
          return;
        }
        threeRendererRef.current?.dispose?.();
        threeRendererRef.current = renderer;
        setRendererState({
          mode,
          metadata,
          volumeImageStack,
          volumeOverlayImageStacks,
          segmentationLabelSlices: segmentationContract.labelSlices,
          type: renderer.rendererType || 'three-webgl',
          hasExternalOverlay: Boolean(renderer.hasExternalOverlay),
        });
        setRayRendererFallback(null);
        if (mode === VIEWER_MODES.volume) setStatus('ready');
      })
      .catch(showRendererFallback);
    return () => {
      cancelled = true;
      initializationController.abort();
      disposeThreeRenderer(threeRendererRef, canvas);
    };
  }, [isPureSplatMode, metadata, mode, resolvedVolumeDescriptor, segmentationContract.labelSlices, volumeImageStack, volumeOverlayImageStacks]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return undefined;
    let frameId = null;
    const projectionCache = {};
    const render = () => {
      frameId = null;
      const startedAt = performance.now();
      const ratio = window.devicePixelRatio || 1; const profile = QUALITY_PROFILES[quality];
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio * profile.scale)); const height = Math.max(1, Math.floor(canvas.clientHeight * ratio * profile.scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      threeRendererRef.current?.render?.({
        width,
        height,
        rotation,
        zoom,
        mirrorScale: activeMirrorScale,
        volumeOpacity,
        transferFunction: { opacityRampWidth, colorLow, colorHigh },
        intensityThreshold,
        sampleStep: profile.sampleStep,
        slicePosition,
        showSliceGuides: false,
        segmentationPalette: renderableSegmentationSegments,
        reconstructionStyle,
        windowCenter,
        windowWidth,
        isoThreshold,
        isoWidth,
        boundaryEnhancement,
        boundaryStrength,
        boundaryBandWidth,
        showExternalOverlay: showAnnotations,
        externalOverlayOpacity: safeAnnotationOpacityMultiplier,
        segmentationOpacityMultiplier: safeAnnotationOpacityMultiplier,
      });
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);
      if (rendererType === 'canvas2d-fallback' || mode !== VIEWER_MODES.volume) {
        renderPreview(ctx, {
          mode: rendererType !== 'canvas2d-fallback' && mode === VIEWER_MODES.hybrid ? VIEWER_MODES.splat : mode,
          metadata,
          splats,
          rotation,
          zoom,
          mirrorScale: activeMirrorScale,
          preset: MECHANICAL_TRANSFER_PRESETS.machinedMetal,
          crop: getMechanicalCropBox(metadata, cropEnabled),
          volumeOpacity,
          splatOpacity,
          splatPointSize,
          splatContrast,
          slicePosition,
          showSliceGuides: false,
          tunedSplatView: isPureSplatMode || rendererType === 'canvas2d-fallback',
          showReferenceFrame: mode !== VIEWER_MODES.hybrid || rendererType === 'canvas2d-fallback',
          projectionCache,
          segmentationSegments: renderableSegmentationSegments,
          externalOverlayPoints: showAnnotations ? externalOverlayPoints : null,
          annotationOpacityMultiplier: safeAnnotationOpacityMultiplier,
          statsRef,
        });
      }
      renderPt3VectorAnnotations(ctx, {
        vectorAnnotations,
        showAnnotations,
        metadata,
        rotation,
        zoom,
        mirrorScale: activeMirrorScale,
        width,
        height,
        opacityMultiplier: safeAnnotationOpacityMultiplier,
      });
      if (splatGuidesVisible) {
        drawPt3SliceLocator(ctx, {
          metadata,
          width,
          height,
          rotation,
          zoom,
          mirrorScale: activeMirrorScale,
          slicePosition,
          activeSliceAxis,
          guideSettings: pt3GuideSettings,
        });
      }
      const renderDuration = Math.max(0.1, performance.now() - startedAt);
      statsRef.current.fps = Math.min(999, Math.max(1, Math.round(1000 / renderDuration)));
    };
    const scheduleRender = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(render);
    };
    const resizeObserver = typeof window.ResizeObserver === 'function'
      ? new window.ResizeObserver(scheduleRender)
      : null;
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', scheduleRender);
    scheduleRender();
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleRender);
    };
  }, [activeMirrorScale, activeSliceAxis, boundaryBandWidth, boundaryEnhancement, boundaryStrength, colorHigh, colorLow, cropEnabled, externalOverlayPoints, intensityThreshold, isPureSplatMode, isoThreshold, isoWidth, metadata, mode, opacityRampWidth, pt3GuideSettings, quality, reconstructionStyle, renderableSegmentationSegments, rendererType, rotation, safeAnnotationOpacityMultiplier, showAnnotations, slicePosition, splatContrast, splatGuidesVisible, splatOpacity, splatPointSize, splats, vectorAnnotations, volumeOpacity, windowCenter, windowWidth, zoom]);

  const updateRayMarchSetting = (key, value) => {
    onRayMarchSettingsChange?.({ ...activeRayMarchSettings, [key]: value });
  };

  const updateSplatViewSetting = (key, value) => {
    onSplatViewSettingsChange?.({ ...activeSplatViewSettings, [key]: value });
  };

  const updateSegmentDisplay = (segmentId, changes) => {
    setSegmentationSegments((current) => current.map((segment) => (
      segment.id === segmentId ? { ...segment, ...changes } : segment
    )));
  };

  const startRealOptimization = async () => {
    const requiresCameras = realFitMode !== 'voxel_direct';
    if (!projectId || !part?.id || (requiresCameras && realSplatCameras.length < 2) || status === 'pending') return;
    setStatus('pending');
    setStatusDetail({
      note: realFitMode === 'voxel_direct'
        ? 'Queueing analytic voxel fit • 0% complete'
        : 'Queueing calibrated 3DGS training • 0% complete',
    });
    try {
      const payload = await createPartRealGaussianSplatAsset(projectId, part.id, {
          fit_mode: realFitMode,
          cameras: requiresCameras ? realSplatCameras : [],
          parameters: {
            max_splats: Math.min(REAL_SPLAT_BROWSER_MAX, Math.max(1000, realMaxSplats)),
            sh_degree: requiresCameras ? 3 : 0,
            optimize_camera_poses: requiresCameras,
          },
      }).catch(rethrowWithServerDetail('HTTP'));
      setStatusDetail({ note: `${payload.stage || 'Queued'} • ${Math.round(Number(payload.progress_percent) || 0)}% complete` });
      setRealGenerationVersion((version) => version + 1);
    } catch (error) {
      setStatus('failed');
      setStatusDetail({
        error: error.message,
        note: realFitMode === 'voxel_direct'
          ? 'Voxel splat fitting was not started.'
          : 'Real 3DGS training was not started.',
      });
    }
  };

  const stats = statsRef.current; const bounds = getPhysicalBounds(metadata);
  const loadedSplatCount = splats?.positions
    ? Math.floor(splats.positions.length / 3)
    : (stats.renderedSplats ?? 0);
  const loadedVoxelFit = String(splats?.metadata?.optimization_method || '').startsWith('voxel_direct')
    || splats?.metadata?.optimization_domain === 'voxel_field';
  const externalOverlayPointCount = showAnnotations && externalOverlayPoints?.positions
    ? Math.floor(externalOverlayPoints.positions.length / 3)
    : 0;
  const externalOverlayRendered = showAnnotations
    && (rendererHasExternalOverlay || externalOverlayPointCount > 0);
  const modeLabel = mode === VIEWER_MODES.volume
    ? 'Ray march'
    : mode === VIEWER_MODES.realSplat
      ? loadedVoxelFit ? 'Voxel splats' : 'Real 3DGS'
      : mode === VIEWER_MODES.splat
        ? 'Simplified 3DGS'
        : 'HYBRID';
  const hasCanonicalRealAsset = asset?.url || splats?.metadata?.contract_version === 'pt3_real_3dgs/v1';
  const directFitSelected = realFitMode === 'voxel_direct';
  const realOptimizationButtonLabel = directFitSelected
    ? status === 'pending'
      ? 'Fitting voxel splats'
      : hasCanonicalRealAsset
        ? 'Recompute voxel splats'
        : 'Fit voxel splats'
    : status === 'pending'
      ? 'Training 3DGS splats'
      : hasCanonicalRealAsset
        ? 'Recompute trained splats'
        : 'Train 3DGS splats';
  const canonicalMarker = mode === VIEWER_MODES.realSplat
    && splats?.metadata?.contract_version === 'pt3_real_3dgs/v1' ? ' • canonical v1' : '';
  const readyLabel = mode === VIEWER_MODES.realSplat && loadedVoxelFit
    ? 'ready • analytic fit'
    : mode === VIEWER_MODES.realSplat
      ? 'trained'
      : mode === VIEWER_MODES.hybrid && rayRendererFallback ? 'degraded' : 'ready';
  const renderTimingStatus = 'render on change';
  const readyStatus = `${modeLabel} ${readyLabel}${canonicalMarker}${[VIEWER_MODES.splat, VIEWER_MODES.hybrid].includes(mode) ? ` • threshold ${splatParameters?.threshold ?? 'n/a'}` : ''} • ${metadata.dimensions.join('×')} voxels • ${bounds.size.map((v) => v.toFixed(1)).join('×')} mm • ${rendererType} • ${renderTimingStatus}${mode === VIEWER_MODES.volume ? ` • slices ${volumeImageStack.length}` : ` • splats ${loadedSplatCount}`}`;
  const pendingStatus = mode === VIEWER_MODES.realSplat
    ? `${directFitSelected ? 'Voxel splat fitting is running' : 'Real 3DGS training is running'}${statusDetail?.note ? ` • ${statusDetail.note}` : ''}`
    : `Simplified 3DGS preprocessing is still running • threshold ${splatParameters?.threshold ?? 'n/a'}`;
  return <div
    className={`pt3-gaussian-splat-viewer${mode === VIEWER_MODES.realSplat ? ' pt3-real-splat-mode' : ''}${segmentationSegments.length > 0 ? ' pt3-has-segmentation' : ''}`}
    data-testid="pt3-gaussian-splat-viewer"
    data-mirror-x={activeMirrorScale.x}
    data-mirror-y={activeMirrorScale.y}
    data-mirror-z={activeMirrorScale.z}
    data-active-slice-axis={activeSliceAxis}
    data-renderer-type={rendererType}
    data-external-overlay-rendered={externalOverlayRendered}
    data-external-overlay-points={externalOverlayPointCount}
  >
    <canvas
      ref={webglCanvasRef}
      className="pt3-gaussian-splat-webgl"
      aria-label="Three.js mechanical volume renderer"
      hidden={isPureSplatMode || !rendererType.startsWith('three-')}
    />
    <canvas
      ref={canvasRef}
      className="pt3-gaussian-splat-canvas"
      aria-label="Mechanical 3DGS preview"
      aria-describedby={sliceLocatorDescriptionId}
    />
    <span id={sliceLocatorDescriptionId} style={VISUALLY_HIDDEN_STYLE}>
      {sliceLocatorDescription}
    </span>
    {mode === VIEWER_MODES.realSplat && showRealOptimizationControls && (
      <fieldset
        className="pt3-real-optimization-controls"
        aria-label="Real 3DGS fitting"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (!['Tab', 'Escape'].includes(event.key)) event.stopPropagation(); }}
      >
        <legend>Real 3DGS fit</legend>
        <label className="pt3-real-fit-strategy">
          <span>Method</span>
          <select aria-label="Real 3DGS fitting strategy" value={realFitMode} onChange={(event) => setRealFitMode(event.target.value)}>
            <option value="voxel_direct">Direct voxel fit</option>
            <option value="synthetic_views">Synthetic/camera views</option>
            <option value="hybrid">Hybrid provider fit</option>
          </select>
        </label>
        <label className="pt3-real-fit-budget">
          <span>Budget</span><output>{realMaxSplats.toLocaleString()} / 100k</output>
          <input
            aria-label="Real 3DGS splat budget"
            type="range"
            min="1000"
            max={REAL_SPLAT_BROWSER_MAX}
            step="1000"
            value={realMaxSplats}
            onChange={(event) => setRealMaxSplats(Math.min(
              REAL_SPLAT_BROWSER_MAX,
              Math.max(1000, Number(event.target.value) || DEFAULT_REAL_SPLAT_BUDGET),
            ))}
          />
        </label>
        <div className="pt3-real-fit-action">
          <button type="button" aria-label={realOptimizationButtonLabel} disabled={!projectId || !part?.id || (realFitMode !== 'voxel_direct' && realSplatCameras.length < 2) || status === 'pending'} onClick={startRealOptimization}>
            {realOptimizationButtonLabel}
          </button>
          <small>{realFitMode === 'voxel_direct'
            ? 'Analytic voxel fit • no cameras'
            : realSplatCameras.length >= 2
              ? `${realSplatCameras.length} calibrated/generated views`
              : 'At least two calibrated or generated views are required'}</small>
        </div>
      </fieldset>
    )}
    {showRayMarchControls && mode === VIEWER_MODES.volume && (
      <fieldset
        className="pt3-ray-march-controls"
        aria-label="Ray-march controls"
        aria-describedby={rayMarchAvailabilityId}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (!['Tab', 'Escape'].includes(event.key)) event.stopPropagation(); }}
      >
        <legend>Ray march</legend>
        <p
          id={rayMarchAvailabilityId}
          className={`pt3-ray-march-availability${rayMarchControlsAvailable ? ' is-active' : ''}`}
          role="status"
          aria-live="polite"
        >
          {rayMarchControlsAvailable
            ? 'WebGL ray-march renderer active.'
            : 'Reconstruction settings require an active WebGL volume renderer and are disabled while it initializes or a deterministic fallback is shown. Orbit, zoom, and reset view remain available.'}
        </p>
        <label className="pt3-ray-march-style-control">
          Reconstruction style
          <select
            aria-label="Ray-march reconstruction style"
            aria-describedby={rayMarchSummaryId}
            value={reconstructionStyle}
            disabled={!rayMarchControlsAvailable}
            onChange={(event) => updateRayMarchSetting('reconstructionStyle', event.target.value)}
          >
            <option value="composite">Composite</option>
            <option value="mip">MIP</option>
            <option value="xray">X-ray</option>
            <option value="iso">Iso</option>
            <option value="window">Window</option>
          </select>
        </label>
        <div
          id={rayMarchSummaryId}
          className="pt3-ray-march-transfer-summary"
          data-testid="ray-march-transfer-summary"
          data-reconstruction-style={reconstructionStyle}
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>{reconstructionDetail.label} reconstruction</strong>
          <code>{reconstructionDetail.formula}</code>
          <p>{reconstructionDetail.summary}</p>
          <small>
            Intensity controls use normalized 0–1 preview luminance decoded from browser-ready slices, not original CT scalar units. Server-backed NumPy volumes may use sampled axial preview slices. {' '}
            {boundaryEnhancementSupported
              ? `Boundary enhancement is ${boundaryEnhancement ? 'enabled' : 'available'} for this style.`
              : `Boundary enhancement is saved as ${boundaryEnhancement ? 'on' : 'off'} but inactive for ${reconstructionDetail.label}.`}
          </small>
        </div>
        {reconstructionStyle === 'window' && (
          <div className="pt3-ray-march-mode-parameters" data-testid="ray-march-window-controls">
            <label>
              Window center <output aria-hidden="true">{Number(windowCenter).toFixed(2)}</output>
              <input aria-label="Ray-march window center" type="range" min="0" max="1" step="0.01" value={windowCenter} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('windowCenter', Number(event.target.value))} />
            </label>
            <label>
              Window width <output aria-hidden="true">{Number(windowWidth).toFixed(2)}</output>
              <input aria-label="Ray-march window width" type="range" min="0.01" max="1" step="0.01" value={windowWidth} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('windowWidth', Number(event.target.value))} />
            </label>
          </div>
        )}
        {reconstructionStyle === 'iso' && (
          <div className="pt3-ray-march-mode-parameters" data-testid="ray-march-iso-controls">
            <label>
              Iso threshold <output aria-hidden="true">{Number(isoThreshold).toFixed(2)}</output>
              <input aria-label="Ray-march iso threshold" type="range" min="0" max="1" step="0.01" value={isoThreshold} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('isoThreshold', Number(event.target.value))} />
            </label>
            <label>
              Iso width <output aria-hidden="true">{Number(isoWidth).toFixed(3)}</output>
              <input aria-label="Ray-march iso width" type="range" min="0.001" max="1" step="0.001" value={isoWidth} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('isoWidth', Number(event.target.value))} />
            </label>
          </div>
        )}
        <label className={`pt3-ray-march-checkbox${boundaryEnhancementSupported ? '' : ' is-disabled'}`}>
          <input
            aria-label="Ray-march boundary enhancement"
            aria-describedby={boundaryEnhancementSupported ? undefined : boundaryInactiveId}
            type="checkbox"
            checked={Boolean(boundaryEnhancement)}
            disabled={!rayMarchControlsAvailable || !boundaryEnhancementSupported}
            onChange={(event) => updateRayMarchSetting('boundaryEnhancement', event.target.checked)}
          />
          <span>
            Boundary enhancement
            {!boundaryEnhancementSupported && (
              <small id={boundaryInactiveId} className="pt3-ray-march-control-note">
                Saved {boundaryEnhancement ? 'on' : 'off'}; inactive in {reconstructionDetail.label}
              </small>
            )}
            {boundaryEnhancementSupported && (
              <small className="pt3-ray-march-control-note">
                Adds GPU gradient sampling; use Performance for large stacks
              </small>
            )}
          </span>
        </label>
        <label className={!boundaryEnhancementSupported || !boundaryEnhancement ? 'is-disabled' : undefined}>
          Boundary strength <output aria-hidden="true">{Number(boundaryStrength).toFixed(2)}</output>
          <input
            aria-label="Ray-march boundary strength"
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={boundaryStrength}
            disabled={!rayMarchControlsAvailable || !boundaryEnhancementSupported || !boundaryEnhancement}
            onChange={(event) => updateRayMarchSetting('boundaryStrength', Number(event.target.value))}
          />
        </label>
        {reconstructionStyle !== 'iso' && (
          <label>
            Opacity ramp width <output aria-hidden="true">{Number(opacityRampWidth).toFixed(2)}</output>
            <input aria-label="Ray-march opacity ramp width" type="range" min="0.05" max="1" step="0.01" value={opacityRampWidth} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('opacityRampWidth', Number(event.target.value))} />
          </label>
        )}
        <label>
          Low color coefficient
          <input aria-label="Ray-march low color coefficient" type="color" value={colorLow} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('colorLow', event.target.value)} />
        </label>
        <label>
          High color coefficient
          <input aria-label="Ray-march high color coefficient" type="color" value={colorHigh} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('colorHigh', event.target.value)} />
        </label>
        <label>
          Density <output aria-hidden="true">{volumeOpacity.toFixed(2)}×</output>
          <input aria-label="Ray-march density" type="range" min="0.25" max="2.5" step="0.05" value={volumeOpacity} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('volumeOpacity', Number(event.target.value))} />
        </label>
        {!['window', 'iso'].includes(reconstructionStyle) && (
          <label>
            Threshold <output aria-hidden="true">{intensityThreshold.toFixed(2)}</output>
            <input aria-label="Ray-march intensity threshold" type="range" min="0" max="0.6" step="0.01" value={intensityThreshold} disabled={!rayMarchControlsAvailable} onChange={(event) => onRayMarchSettingsChange?.({ ...activeRayMarchSettings, intensityThreshold: Number(event.target.value) })} />
          </label>
        )}
        <label>
          Quality profile
          <select aria-label="Ray-march quality profile" value={quality} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('quality', event.target.value)}>
            <option value="performance">Performance</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Quality</option>
          </select>
        </label>
        <label className="pt3-ray-march-checkbox">
          <input aria-label="Show slice guides" type="checkbox" checked={showSliceGuides} disabled={!rayMarchControlsAvailable} onChange={(event) => updateRayMarchSetting('showSliceGuides', event.target.checked)} />
          Show slice guides
        </label>
        <button type="button" disabled={!rayMarchControlsAvailable} onClick={() => onRayMarchSettingsChange?.({ ...DEFAULT_RAY_MARCH_SETTINGS })}>Reset ray-march settings</button>
        <label>
          Orbit X <output aria-hidden="true">{Math.round(rotation.x)}°</output>
          <input aria-label="Orbit X" type="range" min="-72" max="72" step="1" value={rotation.x} onChange={(event) => onRotationChange?.({ ...rotation, x: Number(event.target.value) })} />
        </label>
        <label>
          Orbit Y <output aria-hidden="true">{Math.round(rotation.y)}°</output>
          <input aria-label="Orbit Y" type="range" min="-180" max="180" step="1" value={rotation.y} onChange={(event) => onRotationChange?.({ ...rotation, y: Number(event.target.value) })} />
        </label>
        <div className="pt3-ray-march-view-actions">
          <button type="button" aria-label="Zoom -" onClick={() => onZoomChange?.(Math.max(0.5, Number((zoom - 0.12).toFixed(2))))}>−</button>
          <button type="button" aria-label="Reset view" onClick={() => onResetView?.()}>Reset view</button>
          <button type="button" aria-label="Zoom +" onClick={() => onZoomChange?.(Math.min(4, Number((zoom + 0.12).toFixed(2))))}>+</button>
        </div>
      </fieldset>
    )}
    {showSplatControls && isPureSplatMode && (
      <fieldset
        className="pt3-ray-march-controls pt3-splat-controls"
        aria-label="3DGS controls"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (!['Tab', 'Escape'].includes(event.key)) event.stopPropagation(); }}
      >
        <legend>{mode === VIEWER_MODES.realSplat ? 'Real 3DGS visibility' : 'Simplified 3DGS visibility'}</legend>
        <label>
          Opacity <output aria-hidden="true">{configuredSplatOpacity.toFixed(2)}×</output>
          <input aria-label="3DGS opacity" type="range" min="0.25" max="2.5" step="0.05" value={configuredSplatOpacity} onChange={(event) => updateSplatViewSetting('opacity', Number(event.target.value))} />
        </label>
        <label>
          Point size <output aria-hidden="true">{configuredSplatPointSize.toFixed(2)}×</output>
          <input aria-label="3DGS point size" type="range" min="0.5" max="3" step="0.05" value={configuredSplatPointSize} onChange={(event) => updateSplatViewSetting('pointSize', Number(event.target.value))} />
        </label>
        <label>
          Contrast <output aria-hidden="true">{configuredSplatContrast.toFixed(2)}×</output>
          <input aria-label="3DGS contrast" type="range" min="0.5" max="2" step="0.05" value={configuredSplatContrast} onChange={(event) => updateSplatViewSetting('contrast', Number(event.target.value))} />
        </label>
        <label className="pt3-ray-march-checkbox">
          <input type="checkbox" checked={configuredSplatGuides} onChange={(event) => updateSplatViewSetting('showSliceGuides', event.target.checked)} />
          Show slice guides
        </label>
        <button type="button" onClick={() => onSplatViewSettingsChange?.({ ...DEFAULT_SPLAT_VIEW_SETTINGS })}>Reset 3DGS settings</button>
        <label>
          Orbit X <output aria-hidden="true">{Math.round(rotation.x)}°</output>
          <input aria-label="3DGS Orbit X" type="range" min="-72" max="72" step="1" value={rotation.x} onChange={(event) => onRotationChange?.({ ...rotation, x: Number(event.target.value) })} />
        </label>
        <label>
          Orbit Y <output aria-hidden="true">{Math.round(rotation.y)}°</output>
          <input aria-label="3DGS Orbit Y" type="range" min="-180" max="180" step="1" value={rotation.y} onChange={(event) => onRotationChange?.({ ...rotation, y: Number(event.target.value) })} />
        </label>
        <div className="pt3-ray-march-view-actions">
          <button type="button" aria-label="3DGS Zoom -" onClick={() => onZoomChange?.(Math.max(0.5, Number((zoom - 0.12).toFixed(2))))}>−</button>
          <button type="button" aria-label="Reset 3DGS view" onClick={() => onResetView?.()}>Reset view</button>
          <button type="button" aria-label="3DGS Zoom +" onClick={() => onZoomChange?.(Math.min(4, Number((zoom + 0.12).toFixed(2))))}>+</button>
        </div>
      </fieldset>
    )}
    {segmentationSegments.length > 0 && (
      <fieldset
        className="pt3-segmentation-controls"
        aria-label="Segmentation display"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (!['Tab', 'Escape'].includes(event.key)) event.stopPropagation(); }}
      >
        <legend>Segments</legend>
        {segmentationSegments.map((segment) => (
          <div className="pt3-segment-row" key={segment.id}>
            <label className="pt3-segment-visibility">
              <input
                type="checkbox"
                aria-label={`Show ${segment.label}`}
                checked={segment.visible}
                onChange={(event) => updateSegmentDisplay(segment.id, { visible: event.target.checked })}
              />
              <span className="pt3-segment-swatch" style={{ '--segment-color': segment.color }} aria-hidden="true" />
              <span>{segment.label}</span>
            </label>
            <label className="pt3-segment-opacity">
              <span>Opacity</span>
              <output>{Math.round(segment.opacity * 100)}%</output>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                aria-label={`${segment.label} opacity`}
                value={segment.opacity}
                onChange={(event) => updateSegmentDisplay(segment.id, { opacity: Number(event.target.value) })}
              />
            </label>
          </div>
        ))}
      </fieldset>
    )}
    <span className="pt3-gaussian-splat-status">{status === 'ready' ? readyStatus : status === 'pending' ? pendingStatus : `${modeLabel} ${status}${mode === VIEWER_MODES.splat ? ` • threshold ${splatParameters?.threshold ?? 'n/a'}` : ''}${statusDetail?.error ? `: ${statusDetail.error}` : ''}`}</span>
    {statusDetail?.note && mode !== VIEWER_MODES.realSplat && <span className="pt3-viewer-note">{statusDetail.note}</span>}
    {rayRendererFallback && <span className="pt3-viewer-note">{rayRendererFallback}</span>}
  </div>;
}
