import {
  MPR_AXES,
  MPR_AXIS_CONFIG,
  MPR_FALLBACK_MODEL_SIZE,
  MPR_FALLBACK_PERSPECTIVE_PX,
  MPR_CROSSHAIR_AXES_BY_VIEW,
  MPR_DISPLAY_AXES_BY_VIEW,
  DEFAULT_MPR_PROJECTION_MIRROR,
} from './mprConstants';
import { clampRange } from './inspectionUtils';

export function getFallbackProjectionImage(axis, shellImageLayers) {
  const preferredViews = {
    axial: ['top', 'bottom', 'front', 'back', 'left', 'right'],
    coronal: ['front', 'back', 'top', 'bottom', 'left', 'right'],
    sagittal: ['left', 'right', 'front', 'back', 'top', 'bottom'],
  };
  const preferences = preferredViews[axis] || [];
  return preferences.map((viewName) => shellImageLayers.find((entry) => entry.viewName === viewName)).find(Boolean)
    || shellImageLayers[0]
    || null;
}

export function getFraction(value, maxValue) {
  const upper = Math.max(1, Number(maxValue) || 1);
  return Math.min(1, Math.max(0, (Number(value) || 0) / upper));
}

export function normalizeMprProjectionMirror(candidate) {
  return MPR_AXES.reduce((acc, axis) => {
    acc[axis] = candidate?.[axis] === true;
    return acc;
  }, { ...DEFAULT_MPR_PROJECTION_MIRROR });
}

export function getScaledIndex(value, sourceMaxValue, targetLength) {
  const upper = Math.max(0, (Number(targetLength) || 1) - 1);
  return clampRange(Math.round(getFraction(value, sourceMaxValue) * upper), 0, upper, 0);
}

export function getCanonicalSegmentationSliceIndex(
  axis,
  uiSliceIndex,
  uiDimensions = {},
  volumeDimensions = [],
) {
  const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
  const canonicalDimensions = Array.isArray(volumeDimensions)
    ? volumeDimensions
    : [
      volumeDimensions?.x ?? volumeDimensions?.width ?? volumeDimensions?.sagittal,
      volumeDimensions?.y ?? volumeDimensions?.height ?? volumeDimensions?.coronal,
      volumeDimensions?.z ?? volumeDimensions?.depth ?? volumeDimensions?.axial,
    ];
  const targetLength = safeAxis === 'sagittal'
    ? canonicalDimensions[0]
    : (safeAxis === 'coronal' ? canonicalDimensions[1] : canonicalDimensions[2]);
  return getScaledIndex(
    uiSliceIndex,
    Math.max(0, (Number(uiDimensions[safeAxis]) || 1) - 1),
    targetLength,
  );
}

export function getMprCrosshairStyle(axis, slicePosition, dimensions, mirroredAxes = DEFAULT_MPR_PROJECTION_MIRROR) {
  const x = getFraction(slicePosition.sagittal, (dimensions.sagittal || 1) - 1) * 100;
  const y = getFraction(slicePosition.coronal, (dimensions.coronal || 1) - 1) * 100;
  const z = (1 - getFraction(slicePosition.axial, (dimensions.axial || 1) - 1)) * 100;
  const representedAxes = MPR_CROSSHAIR_AXES_BY_VIEW[axis] || MPR_CROSSHAIR_AXES_BY_VIEW.axial;
  const displayAxes = MPR_DISPLAY_AXES_BY_VIEW[axis] || MPR_DISPLAY_AXES_BY_VIEW.axial;
  const mirrorX = mirroredAxes?.[displayAxes.x] === true;
  const mirrorY = mirroredAxes?.[displayAxes.y] === true;
  const representedStyle = {
    '--crosshair-h-color': MPR_AXIS_CONFIG[representedAxes.horizontal]?.color || '#ffffff',
    '--crosshair-v-color': MPR_AXIS_CONFIG[representedAxes.vertical]?.color || '#ffffff',
    '--projection-scale-x': mirrorX ? -1 : 1,
    '--projection-scale-y': mirrorY ? -1 : 1,
  };
  const displayX = (value) => `${mirrorX ? 100 - value : value}%`;
  const displayY = (value) => `${mirrorY ? 100 - value : value}%`;
  if (axis === 'axial') {
    return { '--crosshair-x': displayX(x), '--crosshair-y': displayY(y), ...representedStyle };
  }
  if (axis === 'coronal') {
    return { '--crosshair-x': displayX(x), '--crosshair-y': displayY(z), ...representedStyle };
  }
  return { '--crosshair-x': displayX(y), '--crosshair-y': displayY(z), ...representedStyle };
}

export function getPlaneFocusRange(position, dimension) {
  const normalizedDimension = Math.max(1, Number(dimension) || 1);
  const half = normalizedDimension / 10;
  const minimum = -0.5;
  const maximum = normalizedDimension - 0.5;
  let lo = position - half;
  let hi = position + half;
  if (lo < minimum) { hi += minimum - lo; lo = minimum; }
  if (hi > maximum) { lo -= (hi - maximum); hi = maximum; }
  return [Math.max(minimum, lo), Math.min(maximum, hi)];
}

export function getMprFallbackModelZoom(zoom, fullscreen = false) {
  const normalizedZoom = Math.max(0.01, Number(zoom) || 1);
  return fullscreen
    ? Math.min(3.4, Math.max(3, normalizedZoom * 1.8))
    : normalizedZoom;
}

export function getMprFallbackModelCoordinate(value, dimension, extent) {
  const normalizedDimension = Math.max(1, Number(dimension) || 1);
  return ((((Number(value) || 0) + 0.5) / normalizedDimension) - 0.5) * extent;
}

export function projectMprPointToOverlay(vx, vy, vz, dims, rotation, zoom, width, height, mirrorScale) {
  const rx = (rotation.x * Math.PI) / 180;
  const ry = (rotation.y * Math.PI) / 180;
  const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
  const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
  let px = getMprFallbackModelCoordinate(vx, dims.sagittal, MPR_FALLBACK_MODEL_SIZE.width) * (mirrorScale?.x ?? 1);
  let py = getMprFallbackModelCoordinate(vy, dims.coronal, MPR_FALLBACK_MODEL_SIZE.height) * (mirrorScale?.y ?? 1);
  let pz = getMprFallbackModelCoordinate(vz, dims.axial, MPR_FALLBACK_MODEL_SIZE.depth) * (mirrorScale?.z ?? 1);
  let t = px * cosRy + pz * sinRy; pz = -px * sinRy + pz * cosRy; px = t;
  t = py * cosRx + pz * sinRx; pz = -py * sinRx + pz * cosRx; py = t;
  px *= zoom;
  py *= zoom;
  pz *= zoom;
  const perspectiveScale = MPR_FALLBACK_PERSPECTIVE_PX
    / Math.max(1, MPR_FALLBACK_PERSPECTIVE_PX - pz);
  return {
    x: (width / 2) + (px * perspectiveScale),
    y: (height / 2) + (py * perspectiveScale),
    z: pz,
  };
}
