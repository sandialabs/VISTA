import {
  getPt3CameraDistance,
  getPt3WorldScale,
  normalizeVolumeMetadata,
  voxelToPhysical,
} from './pt3VolumeGeometry';
import { clamp } from '../utils/numbers';

export const DEFAULT_SPLAT_VIEW_SETTINGS = Object.freeze({
  opacity: 1.25,
  pointSize: 1.35,
  contrast: 1.2,
  showSliceGuides: true,
});

export const MAX_CANVAS_SPLATS = 30000;
export const MAX_CANVAS_GAUSSIANS = 6000;

const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const SH_C2 = [
  1.0925484305920792,
  -1.0925484305920792,
  0.31539156525252005,
  -1.0925484305920792,
  0.5462742152960396,
];
const SH_C3 = [
  -0.5900435899266435,
  2.890611442640554,
  -0.4570457994644658,
  0.3731763325901154,
  -0.4570457994644658,
  1.445305721320277,
  -0.5900435899266435,
];
const SH_C4 = [
  2.5033429417967046,
  -1.7701307697799304,
  0.9461746957575601,
  -0.6690465435572892,
  0.10578554691520431,
  -0.6690465435572892,
  0.47308734787878004,
  -1.7701307697799304,
  0.6258357354491761,
];

function normalizeDirection(direction) {
  const values = [0, 1, 2].map((axis) => Number(direction?.[axis]) || 0);
  const magnitude = Math.hypot(...values);
  return magnitude > 1e-12 ? values.map((value) => value / magnitude) : [0, 0, 1];
}

/**
 * Real SH basis and ordering used by Graphdeco 3DGS (degree-major, m=-l..l).
 * Canonical VISTA coefficients are coefficient-major RGB, so each basis value
 * consumes three adjacent values in evaluateGraphdecoSphericalHarmonics.
 */
export function getGraphdecoShBasis(degree, direction) {
  const safeDegree = clamp(Math.floor(Number(degree) || 0), 0, 4);
  const [x, y, z] = normalizeDirection(direction);
  const basis = [SH_C0];
  if (safeDegree < 1) return basis;
  basis.push(-SH_C1 * y, SH_C1 * z, -SH_C1 * x);
  if (safeDegree < 2) return basis;
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const yz = y * z; const xz = x * z;
  basis.push(
    SH_C2[0] * xy,
    SH_C2[1] * yz,
    SH_C2[2] * (2 * zz - xx - yy),
    SH_C2[3] * xz,
    SH_C2[4] * (xx - yy),
  );
  if (safeDegree < 3) return basis;
  basis.push(
    SH_C3[0] * y * (3 * xx - yy),
    SH_C3[1] * xy * z,
    SH_C3[2] * y * (4 * zz - xx - yy),
    SH_C3[3] * z * (2 * zz - 3 * xx - 3 * yy),
    SH_C3[4] * x * (4 * zz - xx - yy),
    SH_C3[5] * z * (xx - yy),
    SH_C3[6] * x * (xx - 3 * yy),
  );
  if (safeDegree < 4) return basis;
  basis.push(
    SH_C4[0] * xy * (xx - yy),
    SH_C4[1] * yz * (3 * xx - yy),
    SH_C4[2] * xy * (7 * zz - 1),
    SH_C4[3] * yz * (7 * zz - 3),
    SH_C4[4] * (zz * (35 * zz - 30) + 3),
    SH_C4[5] * xz * (7 * zz - 3),
    SH_C4[6] * (xx - yy) * (7 * zz - 1),
    SH_C4[7] * xz * (xx - 3 * yy),
    SH_C4[8] * (xx * (xx - 3 * yy) - yy * (3 * xx - yy)),
  );
  return basis;
}

export function evaluateGraphdecoSphericalHarmonics(coefficients, degree, direction, offset = 0) {
  const basis = getGraphdecoShBasis(degree, direction);
  return [0, 1, 2].map((channel) => {
    let value = 0.5;
    for (let index = 0; index < basis.length; index += 1) {
      const coefficient = Number(coefficients?.[offset + index * 3 + channel]);
      if (Number.isFinite(coefficient)) value += basis[index] * coefficient;
    }
    return clamp(value, 0, 1);
  });
}

export function covarianceFromScaleQuaternion(scales, quaternion) {
  const safeScales = [0, 1, 2].map((axis) => Math.max(Number.EPSILON, Math.abs(Number(scales?.[axis]) || 0)));
  let [w, x, y, z] = [0, 1, 2, 3].map((axis) => Number(quaternion?.[axis]) || 0);
  const quaternionNorm = Math.hypot(w, x, y, z);
  if (quaternionNorm <= 1e-12) [w, x, y, z] = [1, 0, 0, 0];
  else [w, x, y, z] = [w, x, y, z].map((value) => value / quaternionNorm);
  const rotation = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const variances = safeScales.map((scale) => scale * scale);
  const covariance = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        covariance[row * 3 + column] += rotation[row * 3 + axis] * variances[axis] * rotation[column * 3 + axis];
      }
    }
  }
  return covariance;
}

function transformCovariance3d(covariance, transform) {
  const intermediate = new Array(9).fill(0);
  const result = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        intermediate[row * 3 + column] += transform[row * 3 + axis] * covariance[axis * 3 + column];
      }
    }
  }
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        result[row * 3 + column] += intermediate[row * 3 + axis] * transform[column * 3 + axis];
      }
    }
  }
  return result;
}

/** Project a complete physical-space covariance through the exact active projector. */
export function projectGaussianCovariance({
  mean,
  covariance,
  project,
  finiteDifferenceStep,
  minimumVariance = 0.3,
} = {}) {
  if (typeof project !== 'function' || !Array.isArray(mean) || mean.length !== 3 || !covariance || covariance.length !== 9) return null;
  const center = project(mean);
  if (!center?.slice?.(0, 3).every(Number.isFinite)) return null;
  const maximumVariance = Math.max(Number(covariance[0]) || 0, Number(covariance[4]) || 0, Number(covariance[8]) || 0, Number.EPSILON);
  const step = Number.isFinite(Number(finiteDifferenceStep)) && Number(finiteDifferenceStep) > 0
    ? Number(finiteDifferenceStep)
    : clamp(Math.sqrt(maximumVariance) * 1e-3, 1e-5, 5e-2);
  const jacobian = [[], []];
  for (let axis = 0; axis < 3; axis += 1) {
    const before = mean.slice(); const after = mean.slice();
    before[axis] -= step; after[axis] += step;
    const projectedBefore = project(before); const projectedAfter = project(after);
    jacobian[0][axis] = (projectedAfter[0] - projectedBefore[0]) / (2 * step);
    jacobian[1][axis] = (projectedAfter[1] - projectedBefore[1]) / (2 * step);
  }
  const projected = [0, 0, 0, 0];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      for (let left = 0; left < 3; left += 1) {
        for (let right = 0; right < 3; right += 1) {
          projected[row * 2 + column] += jacobian[row][left] * covariance[left * 3 + right] * jacobian[column][right];
        }
      }
    }
  }
  const filterVariance = Math.max(0, Number(minimumVariance) || 0);
  const a = Math.max(Number.EPSILON, projected[0] + filterVariance);
  const b = (projected[1] + projected[2]) / 2;
  const c = Math.max(Number.EPSILON, projected[3] + filterVariance);
  const halfDifference = (a - c) / 2;
  const eigenRadius = Math.sqrt(Math.max(0, halfDifference * halfDifference + b * b));
  const eigenCenter = (a + c) / 2;
  const majorVariance = Math.max(Number.EPSILON, eigenCenter + eigenRadius);
  const minorVariance = Math.max(Number.EPSILON, eigenCenter - eigenRadius);
  return {
    x: center[0],
    y: center[1],
    viewZ: center[2],
    pixelsPerWorldUnit: center[3],
    covariance2d: [a, b, b, c],
    sigmaMajor: Math.sqrt(majorVariance),
    sigmaMinor: Math.sqrt(minorVariance),
    angle: 0.5 * Math.atan2(2 * b, a - c),
  };
}

/** Direction from the current orbit camera to a physical-space Gaussian mean. */
export function getPt3SplatViewDirection({ metadata, point, rotation = {}, mirrorScale } = {}) {
  const meta = normalizeVolumeMetadata(metadata);
  const center = meta.dimensions.map((dimension, axis) => (dimension - 1) * meta.spacing[axis] / 2);
  const cameraDistance = getPt3CameraDistance(meta);
  const rx = (Number(rotation?.x) || 0) * Math.PI / 180;
  const ry = (Number(rotation?.y) || 0) * Math.PI / 180;
  const worldScale = getPt3WorldScale(mirrorScale);
  const centeredCamera = [
    (-cameraDistance * Math.cos(rx) * Math.sin(ry)) / worldScale.x,
    (cameraDistance * Math.sin(rx)) / worldScale.y,
    (cameraDistance * Math.cos(rx) * Math.cos(ry)) / worldScale.z,
  ];
  const localCamera = centeredCamera.map((value, axis) => value + center[axis]);
  const d = meta.direction;
  const camera = [
    meta.origin[0] + d[0] * localCamera[0] + d[1] * localCamera[1] + d[2] * localCamera[2],
    meta.origin[1] + d[3] * localCamera[0] + d[4] * localCamera[1] + d[5] * localCamera[2],
    meta.origin[2] + d[6] * localCamera[0] + d[7] * localCamera[1] + d[8] * localCamera[2],
  ];
  return normalizeDirection([0, 1, 2].map((axis) => (Number(point?.[axis]) || 0) - camera[axis]));
}

function normalizeCoordinateSpace(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['voxel', 'voxels', 'voxel_index', 'voxel_indices', 'ijk', 'index'].includes(normalized)) return 'voxel';
  if (['physical', 'physical_space', 'world', 'world_space', 'millimeter', 'millimeters', 'mm'].includes(normalized)) return 'physical';
  return null;
}

function getDeclaredCoordinateSpace(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const direct = normalizeCoordinateSpace(candidate.coordinate_space ?? candidate.coordinateSpace);
  if (direct) return direct;
  if (candidate.metadata && candidate.metadata !== candidate) {
    return normalizeCoordinateSpace(candidate.metadata.coordinate_space ?? candidate.metadata.coordinateSpace);
  }
  return null;
}

function isInternalVolumeSplatAssetUrl(assetUrl, applicationOrigin) {
  if (typeof assetUrl !== 'string' || !assetUrl.trim()) return false;
  const rawUrl = assetUrl.trim();
  const fallbackOrigin = applicationOrigin
    || (typeof window !== 'undefined' && window.location?.origin)
    || 'http://vista.local';
  try {
    const parsed = new URL(rawUrl, fallbackOrigin);
    const isRelative = !/^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl) && !rawUrl.startsWith('//');
    if (!isRelative && parsed.origin !== fallbackOrigin) return false;
    return /\/volume-splat-assets(?:\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Resolve the coordinate contract without guessing from point ranges. Explicit
 * declarations always win; only VISTA's generated-asset routes and the legacy
 * ready metadata record retain the historical voxel-coordinate default.
 */
export function resolveSplatCoordinateSpace({
  parsedMetadata,
  sourceMetadata,
  assetRecord,
  assetUrl,
  legacyPt3SplatAsset,
  applicationOrigin,
} = {}) {
  for (const candidate of [parsedMetadata, sourceMetadata, assetRecord]) {
    const declared = getDeclaredCoordinateSpace(candidate);
    if (declared) return declared;
  }
  if (isInternalVolumeSplatAssetUrl(assetUrl, applicationOrigin)) return 'voxel';
  if (legacyPt3SplatAsset?.status === 'ready') return 'voxel';
  return 'physical';
}

export function getCanvasSplatStride(splatCount, maxSplats = MAX_CANVAS_SPLATS) {
  const safeCount = Math.max(0, Math.floor(Number(splatCount) || 0));
  const safeMaximum = Math.max(1, Math.floor(Number(maxSplats) || MAX_CANVAS_SPLATS));
  return Math.max(1, Math.ceil(safeCount / safeMaximum));
}

function selectEvenlySpacedIndices(indices, count) {
  const safeCount = Math.min(indices.length, Math.max(0, Math.floor(Number(count) || 0)));
  if (safeCount === 0) return [];
  if (safeCount === 1) return [indices[Math.floor((indices.length - 1) / 2)]];
  return Array.from({ length: safeCount }, (_, index) => (
    indices[Math.round((index * (indices.length - 1)) / (safeCount - 1))]
  ));
}

/**
 * Deterministically bound Canvas preview work without erasing small segments.
 * Every nonempty visible segment receives one representative when the budget
 * permits; the remaining budget is distributed proportionally across groups.
 */
export function getCanvasSplatSampleIndices({
  splatCount,
  maxSplats = MAX_CANVAS_SPLATS,
  segmentIds = [],
  segments = [],
} = {}) {
  const safeCount = Math.max(0, Math.floor(Number(splatCount) || 0));
  const safeMaximum = Math.max(1, Math.floor(Number(maxSplats) || MAX_CANVAS_SPLATS));
  if (safeCount === 0) return [];

  const declaredVisibility = new Map(
    segments.map((segment) => [String(segment?.id), segment?.visible !== false]),
  );
  const buckets = new Map();
  segments.forEach((segment) => {
    if (segment?.visible !== false) buckets.set(String(segment?.id), []);
  });
  for (let index = 0; index < safeCount; index += 1) {
    const rawSegmentId = segmentIds?.[index];
    const segmentKey = rawSegmentId === undefined || rawSegmentId === null || String(rawSegmentId).trim() === ''
      ? '__unsegmented__'
      : String(rawSegmentId);
    if (declaredVisibility.get(segmentKey) === false) continue;
    if (!buckets.has(segmentKey)) buckets.set(segmentKey, []);
    buckets.get(segmentKey).push(index);
  }

  const populatedBuckets = [...buckets.values()].filter((indices) => indices.length > 0);
  const candidateCount = populatedBuckets.reduce((total, indices) => total + indices.length, 0);
  const budget = Math.min(safeMaximum, candidateCount);
  if (budget === 0) return [];

  const quotas = new Array(populatedBuckets.length).fill(0);
  const guaranteedBucketCount = Math.min(budget, populatedBuckets.length);
  for (let index = 0; index < guaranteedBucketCount; index += 1) quotas[index] = 1;
  let remainingBudget = budget - guaranteedBucketCount;
  if (remainingBudget > 0) {
    const capacities = populatedBuckets.map((indices, index) => indices.length - quotas[index]);
    const totalCapacity = capacities.reduce((total, capacity) => total + capacity, 0);
    const remainders = capacities.map((capacity, index) => {
      const ideal = totalCapacity > 0 ? (remainingBudget * capacity) / totalCapacity : 0;
      const allocation = Math.min(capacity, Math.floor(ideal));
      quotas[index] += allocation;
      return { index, remainder: ideal - allocation };
    });
    remainingBudget -= quotas.reduce((total, quota) => total + quota, 0) - guaranteedBucketCount;
    remainders.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
    for (const target of remainders) {
      if (remainingBudget === 0) break;
      if (quotas[target.index] >= populatedBuckets[target.index].length) continue;
      quotas[target.index] += 1;
      remainingBudget -= 1;
    }
  }

  return populatedBuckets
    .flatMap((indices, index) => selectEvenlySpacedIndices(indices, quotas[index]))
    .sort((left, right) => left - right);
}

export function sortSplatRenderEntriesBackToFront(entries = []) {
  return entries.sort((left, right) => (
    left.viewZ - right.viewZ || left.splatIndex - right.splatIndex
  ));
}

/**
 * Convert declared/generated voxel points into the same physical space used by
 * the ray renderer while leaving physical/world point clouds untouched.
 * Per-point scales remain authored values; the view's point-size control is a
 * separate presentation multiplier.
 */
export function prepareSplatAssetForRendering(splats, metadata, context = {}) {
  if (!splats?.positions) return splats;
  const coordinateSpace = resolveSplatCoordinateSpace({
    ...context,
    parsedMetadata: context.parsedMetadata || splats.metadata,
  });
  let positions = splats.positions;
  if (coordinateSpace === 'voxel') {
    positions = new Float32Array(splats.positions.length);
    for (let index = 0; index < splats.positions.length; index += 3) {
      positions.set(voxelToPhysical([
        splats.positions[index],
        splats.positions[index + 1],
        splats.positions[index + 2],
      ], metadata), index);
    }
  }
  let covariances3d = splats.covariances3d;
  if (splats.scaleVectors?.length && splats.rotations?.length) {
    const count = Math.min(
      Math.floor(splats.scaleVectors.length / 3),
      Math.floor(splats.rotations.length / 4),
    );
    covariances3d = new Float32Array(count * 9);
    const meta = normalizeVolumeMetadata(metadata);
    const voxelToPhysicalLinear = [
      meta.direction[0] * meta.spacing[0], meta.direction[1] * meta.spacing[1], meta.direction[2] * meta.spacing[2],
      meta.direction[3] * meta.spacing[0], meta.direction[4] * meta.spacing[1], meta.direction[5] * meta.spacing[2],
      meta.direction[6] * meta.spacing[0], meta.direction[7] * meta.spacing[1], meta.direction[8] * meta.spacing[2],
    ];
    for (let index = 0; index < count; index += 1) {
      const covariance = covarianceFromScaleQuaternion(
        splats.scaleVectors.subarray(index * 3, index * 3 + 3),
        splats.rotations.subarray(index * 4, index * 4 + 4),
      );
      covariances3d.set(
        coordinateSpace === 'voxel' ? transformCovariance3d(covariance, voxelToPhysicalLinear) : covariance,
        index * 9,
      );
    }
  }
  if (positions === splats.positions && covariances3d === splats.covariances3d) return splats;
  return { ...splats, positions, covariances3d };
}
