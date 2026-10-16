import { clamp, finiteNumber } from '../utils/numbers';

export const MAX_VOLUME_SEGMENT_RUNS = 50_000;
export const MAX_VOLUME_SEGMENT_VOXELS = 250_000;
export const MAX_VOLUME_SEGMENT_EXAMINED = 1_000_000;

const AXES = new Set(['axial', 'coronal', 'sagittal']);

function positiveInteger(value, fallback = 1) {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? Math.max(1, Math.floor(numeric)) : fallback;
}

export function normalizeVolumeDimensions(input) {
  if (Array.isArray(input)) {
    return [
      positiveInteger(input[0]),
      positiveInteger(input[1]),
      positiveInteger(input[2]),
    ];
  }
  const source = input && typeof input === 'object' ? input : {};
  return [
    positiveInteger(source.x ?? source.width ?? source.sagittal),
    positiveInteger(source.y ?? source.height ?? source.coronal),
    positiveInteger(source.z ?? source.depth ?? source.axial),
  ];
}

function normalizeSpacing(input) {
  const source = Array.isArray(input) ? input : [];
  return [0, 1, 2].map((index) => {
    const value = finiteNumber(source[index], 1);
    return value > 0 ? value : 1;
  });
}

function normalizeRun(run, dimensions) {
  const [width, height, depth] = dimensions;
  const source = Array.isArray(run)
    ? run
    : [run?.z, run?.y, run?.xStart ?? run?.x0, run?.xEnd ?? run?.x1];
  if (!Array.isArray(source) || source.length < 4) return null;
  const values = source.slice(0, 4).map((value) => finiteNumber(value));
  if (values.some((value) => value === null)) return null;
  const z = Math.floor(values[0]);
  const y = Math.floor(values[1]);
  if (z < 0 || z >= depth || y < 0 || y >= height) return null;
  const xStart = clamp(Math.floor(Math.min(values[2], values[3])), 0, width);
  const xEnd = clamp(Math.ceil(Math.max(values[2], values[3])), 0, width);
  return xEnd > xStart ? [z, y, xStart, xEnd] : null;
}

function addInterval(rowMap, z, y, xStart, xEnd) {
  const key = `${z}:${y}`;
  if (!rowMap.has(key)) rowMap.set(key, { z, y, intervals: [] });
  rowMap.get(key).intervals.push([xStart, xEnd]);
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((interval) => Array.isArray(interval) && interval[1] > interval[0])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  sorted.forEach(([start, end]) => {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  });
  return merged;
}

function rowMapToRuns(rowMap, maxRuns = MAX_VOLUME_SEGMENT_RUNS) {
  const limit = Math.max(0, Math.floor(finiteNumber(maxRuns, MAX_VOLUME_SEGMENT_RUNS)));
  const runs = [];
  [...rowMap.values()]
    .sort((left, right) => left.z - right.z || left.y - right.y)
    .forEach(({ z, y, intervals }) => {
      mergeIntervals(intervals).forEach(([xStart, xEnd]) => {
        if (runs.length < limit) runs.push([z, y, xStart, xEnd]);
      });
    });
  return runs;
}

export function normalizeVolumeRuns(runs, dimensions, options = {}) {
  const normalizedDimensions = normalizeVolumeDimensions(dimensions);
  const rowMap = new Map();
  const source = Array.isArray(runs) ? runs : [];
  const inputLimit = Math.max(
    MAX_VOLUME_SEGMENT_RUNS,
    Math.floor(finiteNumber(options.maxInputRuns, MAX_VOLUME_SEGMENT_RUNS * 4)),
  );
  source.slice(0, inputLimit).forEach((run) => {
    const normalized = normalizeRun(run, normalizedDimensions);
    if (normalized) addInterval(rowMap, ...normalized);
  });
  return rowMapToRuns(
    rowMap,
    options.maxRuns ?? MAX_VOLUME_SEGMENT_RUNS,
  );
}

export function countVolumeRunVoxels(runs) {
  return (Array.isArray(runs) ? runs : []).reduce((total, run) => (
    total + Math.max(0, finiteNumber(run?.[3], 0) - finiteNumber(run?.[2], 0))
  ), 0);
}

export function getVolumeRunBounds(runs) {
  const source = Array.isArray(runs) ? runs : [];
  if (source.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  source.forEach(([z, y, xStart, xEnd]) => {
    minX = Math.min(minX, xStart);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, xEnd - 1);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  });
  return Number.isFinite(minX)
    ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
    : null;
}

function subtractIntervals(baseIntervals, cutterIntervals) {
  const cutters = mergeIntervals(cutterIntervals);
  const output = [];
  let firstRelevantCutter = 0;
  mergeIntervals(baseIntervals).forEach(([baseStart, baseEnd]) => {
    let cursor = baseStart;
    while (
      firstRelevantCutter < cutters.length
      && cutters[firstRelevantCutter][1] <= cursor
    ) {
      firstRelevantCutter += 1;
    }
    for (let index = firstRelevantCutter; index < cutters.length; index += 1) {
      const [cutStart, cutEnd] = cutters[index];
      if (cutStart >= baseEnd) break;
      if (cutEnd <= cursor) continue;
      if (cutStart > cursor) output.push([cursor, Math.min(cutStart, baseEnd)]);
      cursor = Math.max(cursor, cutEnd);
      if (cursor >= baseEnd) break;
    }
    if (cursor < baseEnd) output.push([cursor, baseEnd]);
  });
  return output;
}

export function compositeVolumeRuns(baseRuns, incomingRuns, options = {}) {
  const dimensions = normalizeVolumeDimensions(options.dimensions);
  const base = normalizeVolumeRuns(baseRuns, dimensions, { maxRuns: Number.MAX_SAFE_INTEGER });
  const incoming = normalizeVolumeRuns(incomingRuns, dimensions, { maxRuns: Number.MAX_SAFE_INTEGER });
  const rowMap = new Map();
  base.forEach(([z, y, xStart, xEnd]) => addInterval(rowMap, z, y, xStart, xEnd));
  if (options.subtract) {
    const cuttersByRow = new Map();
    incoming.forEach(([z, y, xStart, xEnd]) => addInterval(cuttersByRow, z, y, xStart, xEnd));
    cuttersByRow.forEach(({ z, y, intervals }, key) => {
      const occupied = rowMap.get(key);
      if (!occupied) return;
      occupied.intervals = subtractIntervals(occupied.intervals, intervals);
      if (occupied.intervals.length === 0) rowMap.delete(key);
      else rowMap.set(key, { z, y, intervals: occupied.intervals });
    });
  } else {
    incoming.forEach(([z, y, xStart, xEnd]) => addInterval(rowMap, z, y, xStart, xEnd));
  }
  return rowMapToRuns(rowMap, options.maxRuns ?? MAX_VOLUME_SEGMENT_RUNS);
}

function normalizeVoxelPoint(point) {
  const source = Array.isArray(point) ? point : [point?.x, point?.y, point?.z];
  if (!Array.isArray(source) || source.length < 3) return null;
  const values = source.slice(0, 3).map((value) => finiteNumber(value));
  return values.some((value) => value === null) ? null : values;
}

function interpolateCenters(centers, radius, spacing, maxCenters = 4096) {
  const source = (Array.isArray(centers) ? centers : []).map(normalizeVoxelPoint).filter(Boolean);
  if (source.length < 2) return source;
  const interpolated = [source[0]];
  const minimumSpacing = Math.min(...spacing);
  const targetStep = Math.max(minimumSpacing * 0.5, radius * 0.45);
  for (let index = 1; index < source.length; index += 1) {
    const previous = source[index - 1];
    const current = source[index];
    const distance = Math.hypot(
      (current[0] - previous[0]) * spacing[0],
      (current[1] - previous[1]) * spacing[1],
      (current[2] - previous[2]) * spacing[2],
    );
    const steps = Math.max(1, Math.ceil(distance / targetStep));
    for (let step = 1; step <= steps; step += 1) {
      if (interpolated.length >= maxCenters) return interpolated;
      const fraction = step / steps;
      interpolated.push([
        previous[0] + ((current[0] - previous[0]) * fraction),
        previous[1] + ((current[1] - previous[1]) * fraction),
        previous[2] + ((current[2] - previous[2]) * fraction),
      ]);
    }
  }
  return interpolated;
}

function trimRunsByVoxelBudget(runs, maxVoxels) {
  const limit = Math.max(0, Math.floor(finiteNumber(maxVoxels, MAX_VOLUME_SEGMENT_VOXELS)));
  const output = [];
  let remaining = limit;
  for (const run of runs) {
    if (remaining <= 0) break;
    const runLength = run[3] - run[2];
    if (runLength <= remaining) {
      output.push(run);
      remaining -= runLength;
    } else {
      output.push([run[0], run[1], run[2], run[2] + remaining]);
      remaining = 0;
    }
  }
  return output;
}

function makeVolumeResult(runs, metadata = {}) {
  const voxelCount = countVolumeRunVoxels(runs);
  return {
    runs,
    voxelCount,
    bounds: getVolumeRunBounds(runs),
    truncated: false,
    reason: '',
    ...metadata,
  };
}

export function rasterizeSphereStroke({
  centers,
  radius,
  dimensions,
  spacing,
  maxRuns = MAX_VOLUME_SEGMENT_RUNS,
  maxVoxels = MAX_VOLUME_SEGMENT_VOXELS,
} = {}) {
  const normalizedDimensions = normalizeVolumeDimensions(dimensions);
  const normalizedSpacing = normalizeSpacing(spacing);
  const normalizedRadius = finiteNumber(radius);
  const allSeedCenters = (Array.isArray(centers) ? centers : []).map(normalizeVoxelPoint).filter(Boolean);
  const maximumCenters = 4096;
  const seedCenters = allSeedCenters.length <= maximumCenters
    ? allSeedCenters
    : Array.from({ length: maximumCenters }, (_, index) => (
      allSeedCenters[Math.round((index / (maximumCenters - 1)) * (allSeedCenters.length - 1))]
    ));
  if (!(normalizedRadius > 0) || seedCenters.length === 0) {
    return makeVolumeResult([], { reason: 'invalid-sphere' });
  }
  const runLimit = Math.max(0, Math.floor(finiteNumber(maxRuns, MAX_VOLUME_SEGMENT_RUNS)));
  const rawIntervalLimit = Math.max(1024, runLimit * 4);
  const rowMap = new Map();
  const interpolatedCenters = interpolateCenters(
    seedCenters,
    normalizedRadius,
    normalizedSpacing,
    maximumCenters,
  );
  let rawIntervals = 0;
  let guardReached = allSeedCenters.length > seedCenters.length
    || interpolatedCenters.length >= maximumCenters;
  for (const [cx, cy, cz] of interpolatedCenters) {
    const [width, height, depth] = normalizedDimensions;
    const zRadius = normalizedRadius / normalizedSpacing[2];
    const yRadius = normalizedRadius / normalizedSpacing[1];
    const minZ = clamp(Math.ceil(cz - zRadius), 0, depth - 1);
    const maxZ = clamp(Math.floor(cz + zRadius), 0, depth - 1);
    for (let z = minZ; z <= maxZ; z += 1) {
      const dz = (z - cz) * normalizedSpacing[2];
      const minY = clamp(Math.ceil(cy - yRadius), 0, height - 1);
      const maxY = clamp(Math.floor(cy + yRadius), 0, height - 1);
      for (let y = minY; y <= maxY; y += 1) {
        const dy = (y - cy) * normalizedSpacing[1];
        const remainingSquared = (normalizedRadius ** 2) - (dz ** 2) - (dy ** 2);
        if (remainingSquared < 0) continue;
        const xRadius = Math.sqrt(remainingSquared) / normalizedSpacing[0];
        const xStart = clamp(Math.ceil(cx - xRadius), 0, width - 1);
        const xEnd = clamp(Math.floor(cx + xRadius) + 1, 1, width);
        if (xEnd > xStart) {
          if (rawIntervals >= rawIntervalLimit) {
            guardReached = true;
            break;
          }
          addInterval(rowMap, z, y, xStart, xEnd);
          rawIntervals += 1;
        }
      }
      if (guardReached && rawIntervals >= rawIntervalLimit) break;
    }
    if (guardReached && rawIntervals >= rawIntervalLimit) break;
  }
  const allRuns = rowMapToRuns(rowMap, Number.MAX_SAFE_INTEGER);
  let resultRuns = allRuns;
  let reason = guardReached ? 'input-guard' : '';
  if (resultRuns.length > runLimit) {
    resultRuns = resultRuns.slice(0, runLimit);
    reason = reason || 'max-runs';
  }
  const beforeVoxelTrim = countVolumeRunVoxels(resultRuns);
  if (beforeVoxelTrim > maxVoxels) {
    resultRuns = trimRunsByVoxelBudget(resultRuns, maxVoxels);
    reason = reason || 'max-voxels';
  }
  return makeVolumeResult(resultRuns, {
    truncated: guardReached
      || resultRuns.length < allRuns.length
      || countVolumeRunVoxels(resultRuns) < countVolumeRunVoxels(allRuns),
    reason,
  });
}

function mergeRectangles(rectangles) {
  const horizontal = [];
  rectangles
    .sort((left, right) => left.y0 - right.y0 || left.y1 - right.y1 || left.x0 - right.x0)
    .forEach((rectangle) => {
      const previous = horizontal[horizontal.length - 1];
      if (
        previous
        && previous.y0 === rectangle.y0
        && previous.y1 === rectangle.y1
        && rectangle.x0 <= previous.x1
      ) {
        previous.x1 = Math.max(previous.x1, rectangle.x1);
      } else {
        horizontal.push({ ...rectangle });
      }
    });
  return horizontal;
}

export function projectVolumeRunsToSlice({
  runs,
  axis,
  sliceIndex,
  dimensions,
} = {}) {
  const normalizedDimensions = normalizeVolumeDimensions(dimensions);
  const [width, height, depth] = normalizedDimensions;
  const safeAxis = AXES.has(axis) ? axis : 'axial';
  const axisLength = safeAxis === 'axial' ? depth : (safeAxis === 'coronal' ? height : width);
  const selectedSlice = clamp(Math.round(finiteNumber(sliceIndex, 0)), 0, axisLength - 1);
  const canonicalRuns = normalizeVolumeRuns(runs, normalizedDimensions);
  const rectangles = [];
  canonicalRuns.forEach(([z, y, xStart, xEnd]) => {
    if (safeAxis === 'axial' && z === selectedSlice) {
      rectangles.push({ x0: xStart, y0: y, x1: xEnd, y1: y + 1 });
    } else if (safeAxis === 'coronal' && y === selectedSlice) {
      const displayedZ = depth - 1 - z;
      rectangles.push({ x0: xStart, y0: displayedZ, x1: xEnd, y1: displayedZ + 1 });
    } else if (safeAxis === 'sagittal' && selectedSlice >= xStart && selectedSlice < xEnd) {
      const displayedZ = depth - 1 - z;
      rectangles.push({ x0: y, y0: displayedZ, x1: y + 1, y1: displayedZ + 1 });
    }
  });
  const merged = mergeRectangles(rectangles);
  return {
    imageWidth: safeAxis === 'sagittal' ? height : width,
    imageHeight: safeAxis === 'axial' ? height : depth,
    rectangles: merged,
    stats: {
      runsRead: canonicalRuns.length,
      rectanglesBuilt: merged.length,
      voxelCount: countVolumeRunVoxels(canonicalRuns),
      truncated: false,
    },
  };
}

function normalizeVoxelValue(value) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [value];
  const normalized = source.map((entry) => finiteNumber(entry)).filter((entry) => entry !== null);
  return normalized.length > 0 ? normalized : null;
}

function voxelMatchesSeed(value, seedValue, sensitivity) {
  const candidate = normalizeVoxelValue(value);
  if (!candidate) return false;
  const channels = Math.max(candidate.length, seedValue.length);
  let maximumDelta = 0;
  for (let index = 0; index < channels; index += 1) {
    const candidateValue = candidate[Math.min(index, candidate.length - 1)];
    const seedChannel = seedValue[Math.min(index, seedValue.length - 1)];
    maximumDelta = Math.max(maximumDelta, Math.abs(candidateValue - seedChannel));
  }
  return maximumDelta <= sensitivity;
}

function selectedIndexesToRuns(selected, dimensions, maxRuns) {
  const [width, height] = dimensions;
  const rowMap = new Map();
  selected.forEach((index) => {
    const z = Math.floor(index / (width * height));
    const remainder = index - (z * width * height);
    const y = Math.floor(remainder / width);
    const x = remainder - (y * width);
    addInterval(rowMap, z, y, x, x + 1);
  });
  return rowMapToRuns(rowMap, maxRuns);
}

function createFloodFillState({
  dimensions,
  seed,
  sensitivity = 0,
  getVoxel,
  maxVoxels = MAX_VOLUME_SEGMENT_VOXELS,
  maxExamined = MAX_VOLUME_SEGMENT_EXAMINED,
  maxRuns = MAX_VOLUME_SEGMENT_RUNS,
} = {}) {
  const normalizedDimensions = normalizeVolumeDimensions(dimensions);
  const [width, height, depth] = normalizedDimensions;
  const seedPoint = normalizeVoxelPoint(seed)?.map((value) => Math.round(value));
  if (
    !seedPoint
    || seedPoint[0] < 0 || seedPoint[0] >= width
    || seedPoint[1] < 0 || seedPoint[1] >= height
    || seedPoint[2] < 0 || seedPoint[2] >= depth
    || typeof getVoxel !== 'function'
  ) {
    return {
      done: true,
      invalidResult: makeVolumeResult([], { reason: 'invalid-seed', examined: 0 }),
    };
  }
  const seedValue = normalizeVoxelValue(getVoxel(seedPoint[0], seedPoint[1], seedPoint[2]));
  if (!seedValue) {
    return {
      done: true,
      invalidResult: makeVolumeResult([], { reason: 'invalid-seed-value', examined: 0 }),
    };
  }
  const tolerance = Math.max(0, finiteNumber(sensitivity, 0));
  const voxelLimit = Math.max(1, Math.floor(finiteNumber(maxVoxels, MAX_VOLUME_SEGMENT_VOXELS)));
  const examinedLimit = Math.max(1, Math.floor(finiteNumber(maxExamined, MAX_VOLUME_SEGMENT_EXAMINED)));
  const toIndex = (x, y, z) => (z * width * height) + (y * width) + x;
  const totalVoxels = width * height * depth;
  const queueCapacity = Math.min(totalVoxels, examinedLimit);
  const queue = new Int32Array(queueCapacity);
  const seedIndex = toIndex(seedPoint[0], seedPoint[1], seedPoint[2]);
  queue[0] = seedIndex;
  let queueLength = 1;
  let queueIndex = 0;
  const denseVisited = totalVoxels <= 16_000_000 ? new Uint8Array(totalVoxels) : null;
  const sparseVisited = denseVisited ? null : new Set();
  const hasVisited = (index) => (denseVisited ? denseVisited[index] === 1 : sparseVisited.has(index));
  const markVisited = (index) => {
    if (denseVisited) denseVisited[index] = 1;
    else sparseVisited.add(index);
  };
  markVisited(seedIndex);
  return {
    dimensions: normalizedDimensions,
    width,
    height,
    depth,
    tolerance,
    voxelLimit,
    examinedLimit,
    maxRuns,
    getVoxel,
    seedValue,
    queue,
    get queueLength() { return queueLength; },
    set queueLength(value) { queueLength = value; },
    get queueIndex() { return queueIndex; },
    set queueIndex(value) { queueIndex = value; },
    selected: [],
    hasVisited,
    markVisited,
    done: false,
    reason: '',
  };
}

function advanceFloodFillState(state, workBudget, isCancelled) {
  if (state.done) return;
  const {
    width,
    height,
    depth,
    queue,
    selected,
    getVoxel,
    seedValue,
    tolerance,
    voxelLimit,
    examinedLimit,
    hasVisited,
    markVisited,
  } = state;
  const planeSize = width * height;
  let completed = 0;
  const enqueue = (index) => {
    if (hasVisited(index)) return true;
    if (state.queueLength >= examinedLimit || state.queueLength >= queue.length) {
      state.reason = 'max-examined';
      state.done = true;
      return false;
    }
    markVisited(index);
    queue[state.queueLength] = index;
    state.queueLength += 1;
    return true;
  };
  while (state.queueIndex < state.queueLength && completed < workBudget) {
    if (isCancelled?.()) {
      state.reason = 'cancelled';
      state.done = true;
      break;
    }
    const index = queue[state.queueIndex];
    state.queueIndex += 1;
    completed += 1;
    const z = Math.floor(index / planeSize);
    const remainder = index - (z * planeSize);
    const y = Math.floor(remainder / width);
    const x = remainder - (y * width);
    if (!voxelMatchesSeed(getVoxel(x, y, z), seedValue, tolerance)) continue;
    if (selected.length >= voxelLimit) {
      state.reason = 'max-voxels';
      state.done = true;
      break;
    }
    selected.push(index);
    if (x > 0 && !enqueue(index - 1)) break;
    if (x + 1 < width && !enqueue(index + 1)) break;
    if (y > 0 && !enqueue(index - width)) break;
    if (y + 1 < height && !enqueue(index + width)) break;
    if (z > 0 && !enqueue(index - planeSize)) break;
    if (z + 1 < depth && !enqueue(index + planeSize)) break;
  }
  if (state.queueIndex >= state.queueLength) state.done = true;
}

function finishFloodFillState(state) {
  if (state.invalidResult) return state.invalidResult;
  const allRuns = selectedIndexesToRuns(
    state.selected,
    state.dimensions,
    Number.MAX_SAFE_INTEGER,
  );
  const runLimit = Math.max(0, Math.floor(finiteNumber(state.maxRuns, MAX_VOLUME_SEGMENT_RUNS)));
  const runs = allRuns.slice(0, runLimit);
  if (!state.reason && runs.length < allRuns.length) state.reason = 'max-runs';
  return makeVolumeResult(runs, {
    truncated: Boolean(state.reason),
    reason: state.reason,
    examined: state.queueIndex,
  });
}

export function floodFillVolume3d(options = {}) {
  const state = createFloodFillState(options);
  while (!state.done) {
    advanceFloodFillState(state, 16_384, options.isCancelled);
  }
  return finishFloodFillState(state);
}

export async function floodFillVolume3dAsync(options = {}) {
  const state = createFloodFillState(options);
  while (!state.done) {
    advanceFloodFillState(state, 4_096, options.isCancelled);
    if (!state.done) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return finishFloodFillState(state);
}
