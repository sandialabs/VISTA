import { PT3_VOLUME_AXES } from '../../components/pt3VolumeDescriptor';

export const MPR_AXES = [...PT3_VOLUME_AXES];

export const MPR_AXIS_LABELS = { axial: 'XY', coronal: 'XZ', sagittal: 'YZ' };
export const MPR_AXIS_CONFIG = {
  axial: {
    label: 'XY',
    sliceLabel: 'Z',
    color: '#3b82f6',
  },
  coronal: {
    label: 'XZ',
    sliceLabel: 'Y',
    color: '#f59e0b',
  },
  sagittal: {
    label: 'YZ',
    sliceLabel: 'X',
    color: '#10b981',
  },
};
export const MPR_FALLBACK_MODEL_SIZE = Object.freeze({ width: 190, height: 138, depth: 108 });
export const MPR_FALLBACK_PERSPECTIVE_PX = 760;
export const MPR_CROSSHAIR_AXES_BY_VIEW = {
  axial: { horizontal: 'coronal', vertical: 'sagittal' },
  coronal: { horizontal: 'axial', vertical: 'sagittal' },
  sagittal: { horizontal: 'axial', vertical: 'coronal' },
};
export const MPR_DISPLAY_AXES_BY_VIEW = {
  axial: { x: 'sagittal', y: 'coronal' },
  coronal: { x: 'sagittal', y: 'axial' },
  sagittal: { x: 'coronal', y: 'axial' },
};
export const MPR_RECONSTRUCTION_MODES = {
  orientation: 'orientation',
  stack: 'stack',
  splat: 'splat',
  realSplat: 'real_splat',
  volume3d: 'volume3d',
};
export const MPR_RECONSTRUCTION_LABELS = {
  [MPR_RECONSTRUCTION_MODES.orientation]: 'Orientation only',
  [MPR_RECONSTRUCTION_MODES.stack]: 'Stack reconstruction',
  [MPR_RECONSTRUCTION_MODES.splat]: 'Simplified 3DGS',
  [MPR_RECONSTRUCTION_MODES.realSplat]: 'Real 3DGS',
  [MPR_RECONSTRUCTION_MODES.volume3d]: 'Ray marching',
};
export const RAY_MARCH_RECONSTRUCTION_OPTIONS = Object.freeze([
  { value: 'composite', label: 'Composite' },
  { value: 'mip', label: 'MIP' },
  { value: 'xray', label: 'X-ray' },
  { value: 'iso', label: 'Iso' },
  { value: 'window', label: 'Window' },
]);
export const RAY_MARCH_RECONSTRUCTION_IDS = new Set(
  RAY_MARCH_RECONSTRUCTION_OPTIONS.map(({ value }) => value),
);
export const RAY_MARCH_SELECTOR_PREFIX = 'ray-march:';
export const PT3_RENDERER_RECONSTRUCTION_MODES = [
  MPR_RECONSTRUCTION_MODES.volume3d,
  MPR_RECONSTRUCTION_MODES.splat,
  MPR_RECONSTRUCTION_MODES.realSplat,
];

export function normalizeMprReconstructionMode(value) {
  if (value === 'shell') return MPR_RECONSTRUCTION_MODES.orientation;
  if (value === 'hybrid3d') return MPR_RECONSTRUCTION_MODES.volume3d;
  return Object.values(MPR_RECONSTRUCTION_MODES).includes(value)
    ? value
    : MPR_RECONSTRUCTION_MODES.orientation;
}
export const DEFAULT_MPR_PROJECTION_MIRROR = { axial: false, coronal: false, sagittal: false };

export const MPR_SERVER_VOLUME_KIND = 'server-volume';
export const MPR_VOLUME_SLICE_RENDER_VERSION = 'rgba-segments-v2';
export const MPR_VOLUME_RENDER_SUMMARY_VERSION = 1;
export const MPR_VOLUME_RENDERER_MAX_SLICES = 12;
export const MPR_SERVER_SLICE_PREFETCH_RADIUS = 2;
export const MPR_SERVER_CURRENT_SLICE_DEBOUNCE_MS = 200;
