import {
  createPt3PerspectiveProjector,
  normalizeAxisMirrorScale,
  normalizeVolumeMetadata,
  voxelToPhysical,
} from './pt3VolumeGeometry';
import { getPt3GuideAppearance } from '../utils/pt3GuideSettings';
import { clampFinite as clamp } from '../utils/numbers';

const LOCATOR_AXES = Object.freeze({
  axial: Object.freeze({ coordinate: 2, color: '#3b82f6', plane: 'XY', slice: 'Z' }),
  coronal: Object.freeze({ coordinate: 1, color: '#f59e0b', plane: 'XZ', slice: 'Y' }),
  sagittal: Object.freeze({ coordinate: 0, color: '#10b981', plane: 'YZ', slice: 'X' }),
});

const AXIS_ORDER = ['axial', 'coronal', 'sagittal'];

function projectVoxel(project, metadata, voxel) {
  const projected = project(voxelToPhysical(voxel, metadata));
  return {
    x: Number.isFinite(projected[0]) ? projected[0] : 0,
    y: Number.isFinite(projected[1]) ? projected[1] : 0,
    depth: Number.isFinite(projected[2]) ? projected[2] : 0,
  };
}

function normalizeRotation(rotation) {
  const finiteDegrees = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric % 360 : 0;
  };
  return { x: finiteDegrees(rotation?.x), y: finiteDegrees(rotation?.y) };
}

function makeReadout(axis, index, dimensions) {
  const config = LOCATOR_AXES[axis];
  return `${config.slice} ${index} / ${Math.max(0, dimensions[config.coordinate] - 1)}`;
}

export function buildPt3SliceLocatorGeometry({
  metadata,
  width,
  height,
  rotation,
  zoom,
  mirrorScale,
  slicePosition,
  activeSliceAxis = 'axial',
} = {}) {
  const normalizedMetadata = normalizeVolumeMetadata(
    metadata && typeof metadata === 'object' ? metadata : {},
  );
  const dimensions = normalizedMetadata.dimensions;
  const safeWidth = clamp(width, 1, 32768, 1);
  const safeHeight = clamp(height, 1, 32768, 1);
  const activeAxis = LOCATOR_AXES[activeSliceAxis] ? activeSliceAxis : 'axial';
  const positions = {
    sagittal: Math.round(clamp(slicePosition?.sagittal, 0, dimensions[0] - 1, 0)),
    coronal: Math.round(clamp(slicePosition?.coronal, 0, dimensions[1] - 1, 0)),
    axial: Math.round(clamp(slicePosition?.axial, 0, dimensions[2] - 1, 0)),
  };
  const [dimensionX, dimensionY, dimensionZ] = dimensions;
  const x0 = -0.5; const x1 = dimensionX - 0.5;
  const y0 = -0.5; const y1 = dimensionY - 0.5;
  const z0 = -0.5; const z1 = dimensionZ - 0.5;
  const x = positions.sagittal;
  const y = positions.coronal;
  const z = positions.axial;
  const project = createPt3PerspectiveProjector({
    metadata: normalizedMetadata,
    width: safeWidth,
    height: safeHeight,
    rotation: normalizeRotation(rotation),
    zoom,
    mirrorScale: normalizeAxisMirrorScale(mirrorScale),
  });
  const projected = (voxel) => projectVoxel(project, normalizedMetadata, voxel);
  const planeVoxels = {
    axial: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
    coronal: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]],
    sagittal: [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]],
  };
  const lineVoxels = {
    sagittal: [[x0, y, z], [x1, y, z]],
    coronal: [[x, y0, z], [x, y1, z]],
    axial: [[x, y, z0], [x, y, z1]],
  };
  const readouts = AXIS_ORDER.reduce((result, axis) => ({
    ...result,
    [axis]: makeReadout(axis, positions[axis], dimensions),
  }), {});

  return {
    width: safeWidth,
    height: safeHeight,
    metadata: normalizedMetadata,
    activeAxis,
    positions,
    planes: AXIS_ORDER.map((axis) => ({
      axis,
      color: LOCATOR_AXES[axis].color,
      active: axis === activeAxis,
      points: planeVoxels[axis].map(projected),
    })),
    intersectionLines: ['sagittal', 'coronal', 'axial'].map((axis) => ({
      axis,
      color: LOCATOR_AXES[axis].color,
      label: readouts[axis],
      points: lineVoxels[axis].map(projected),
    })),
    center: projected([x, y, z]),
    readouts,
    activePlaneLabel: `${LOCATOR_AXES[activeAxis].plane} • ${readouts[activeAxis]}`,
  };
}

export function getPt3SliceLocatorDescription(geometry) {
  return `Active plane ${geometry.activePlaneLabel}. `
    + `X ${geometry.positions.sagittal} / ${Math.max(0, geometry.metadata.dimensions[0] - 1)}; `
    + `Y ${geometry.positions.coronal} / ${Math.max(0, geometry.metadata.dimensions[1] - 1)}; `
    + `Z ${geometry.positions.axial} / ${Math.max(0, geometry.metadata.dimensions[2] - 1)}.`;
}

function tracePoints(ctx, points, close = false) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  if (close) ctx.closePath();
}

function drawOutlinedPath(
  ctx,
  points,
  color,
  width,
  close = false,
  displayScale = 1,
  haloWidth = width + 1.5,
  opacity = 1,
) {
  const previousAlpha = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
  ctx.globalAlpha = previousAlpha * opacity;
  tracePoints(ctx, points, close);
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.94)';
  ctx.lineWidth = haloWidth * displayScale;
  ctx.stroke();
  tracePoints(ctx, points, close);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * displayScale;
  ctx.stroke();
  ctx.globalAlpha = previousAlpha;
}

export function drawPt3SliceLocator(ctx, options = {}) {
  if (!ctx) return null;
  const geometry = buildPt3SliceLocatorGeometry(options);
  const appearance = getPt3GuideAppearance(options.guideSettings);
  const cssWidth = Number(ctx.canvas?.clientWidth);
  const displayScale = clamp(
    options.displayScale,
    0.5,
    4,
    Number.isFinite(cssWidth) && cssWidth > 0 ? geometry.width / cssWidth : 1,
  );
  ctx.save?.();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const activePlane = geometry.planes.find((plane) => plane.active);
  if (activePlane) {
    tracePoints(ctx, activePlane.points, true);
    ctx.fillStyle = `${activePlane.color}30`;
    ctx.fill();
  }
  geometry.planes.forEach((plane) => {
    const width = plane.active
      ? appearance.planeOutlineLineWidthPx
      : appearance.planeOutlineLineWidthPx / 2;
    drawOutlinedPath(
      ctx,
      plane.points,
      plane.color,
      width,
      true,
      displayScale,
      width + 1.5,
      appearance.planeOutlineOpacity,
    );
  });
  geometry.intersectionLines.forEach((line) => {
    drawOutlinedPath(
      ctx,
      line.points,
      line.color,
      appearance.crosshairLineWidthPx,
      false,
      displayScale,
      appearance.crosshairLineWidthPx + 1.5,
      appearance.crosshairOpacity,
    );
  });

  const previousAlpha = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
  ctx.globalAlpha = previousAlpha * appearance.crosshairOpacity;
  ctx.beginPath();
  ctx.arc(geometry.center.x, geometry.center.y, 6 * displayScale, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.96)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(geometry.center.x, geometry.center.y, 3.25 * displayScale, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = previousAlpha;
  ctx.restore?.();
  return geometry;
}

export { LOCATOR_AXES as PT3_SLICE_LOCATOR_AXES };
