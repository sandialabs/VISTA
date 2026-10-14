export const DEFAULT_SEGMENT_COLOR = '#22c55e';
export const SEGMENT_COLORS = ['#22c55e', '#3b82f6', '#f97316', '#e11d48', '#a855f7', '#14b8a6', '#facc15'];
export const SEGMENTATION_HELPER_TOOLS = [
  {
    id: 'brush',
    label: 'Brush',
    icon: 'brush',
    detail: 'Paint a circle on one slice or a swept sphere through the volume.',
    modes: ['2d', '3d'],
    modeLabels: { '2d': 'Circle', '3d': 'Sphere' },
  },
  {
    id: 'eraser',
    label: 'Eraser',
    icon: 'eraser',
    detail: 'Erase with a circle on one slice or a swept sphere through the volume.',
    modes: ['2d', '3d'],
    modeLabels: { '2d': 'Circle', '3d': 'Sphere' },
  },
  {
    id: 'connected',
    label: 'Connected',
    icon: 'target',
    detail: 'Grow from a seed through similar pixels on one slice or all three dimensions.',
    modes: ['2d', '3d'],
    modeLabels: { '2d': 'Slice', '3d': 'Volume' },
  },
  { id: 'polygon', label: 'Polygon', icon: 'polygon', detail: 'Click boundary vertices, double-click to close the perimeter.' },
  { id: 'circle', label: 'Circle', icon: 'circle', detail: 'Click the center, then drag to set the radius.' },
  { id: 'rectangle', label: 'Rectangle', icon: 'rectangle', detail: 'Drag from one corner to the opposite corner.' },
  { id: 'threshold', label: 'Threshold', icon: 'threshold', detail: 'Preview a local intensity band around a clicked point.' },
  { id: 'level-trace', label: 'Level Trace', icon: 'contour', detail: 'Trace an equal-intensity contour from the clicked point.' },
  { id: 'scissors', label: 'Scissors', icon: 'scissors', detail: 'Mark cut paths for trimming a selected segment.' },
  { id: 'ml-helper', label: 'ML Helper', icon: 'spark', detail: 'Run a toolbox segmentation method once per slice, then select regions by click.' },
];
export const SEGMENTATION_HELPER_VIEWS = [
  { id: 'x', label: 'X', axis: 'sagittal', plane: 'YZ', detail: 'X axis · YZ plane' },
  { id: 'y', label: 'Y', axis: 'coronal', plane: 'XZ', detail: 'Y axis · XZ plane' },
  { id: 'z', label: 'Z', axis: 'axial', plane: 'XY', detail: 'Z axis · XY plane' },
  { id: 'mpr', label: 'MPR', detail: 'Linked orthogonal views' },
  { id: '3d', label: '3D', detail: '3D volume context and exact segment surface' },
];
export const SEGMENTATION_VIEW_BY_AXIS = {
  sagittal: 'x',
  coronal: 'y',
  axial: 'z',
};
export const DEFAULT_SEGMENTATION_TOOL_MODES = {
  brush: '2d',
  eraser: '2d',
  connected: '2d',
};
export const SEGMENTATION_POINT_MARKER_TOOLS = new Set(['polygon', 'circle', 'rectangle']);
export const SEGMENTATION_ML_METHOD_GROUPS = [
  {
    id: 'yolo',
    label: 'YOLO',
    methods: [
      { id: 'segmentation.yolo.placeholder', label: 'YOLO' },
    ],
  },
  {
    id: 'anomalib',
    label: 'Anomalib',
    methods: [
      { id: 'segmentation.anomalib.placeholder', label: 'Anomalib' },
    ],
  },
  {
    id: 'sam',
    label: 'SAM',
    methods: [
      { id: 'segmentation.sam.placeholder', label: 'SAM' },
    ],
  },
  {
    id: 'opencv',
    label: 'OpenCV',
    methods: [
      { id: 'segmentation.opencv.placeholder', label: 'OpenCV' },
    ],
  },
];
const DEFAULT_SEGMENTATION_ML_PARAMETERS = {
  'segmentation.yolo.placeholder': { integration_mode: 'local', fastapi_url: '', mode: 'default', prompts: {}, options: { model: 'yolo11n-seg.pt', confidence: 0.25, iou: 0.7 } },
  'segmentation.anomalib.placeholder': { integration_mode: 'local', fastapi_url: '', mode: 'default', prompts: {}, options: { model_name: 'patchcore', threshold: 0.5, min_mask_area_px: 1 } },
  'segmentation.sam.placeholder': { integration_mode: 'local', fastapi_url: '', mode: 'default', prompts: {}, options: {} },
  'segmentation.opencv.placeholder': { integration_mode: 'local', fastapi_url: '', mode: 'default', prompts: {}, options: { min_peak_distance_px: 1 } },
};

function normalizedSegmentationExecutionMode(value) {
  const mode = String(value || '').toLowerCase();
  return mode === 'remote' || mode === 'fastapi' ? 'remote' : 'local';
}

export function segmentationExecutionModeLabel(value) {
  return normalizedSegmentationExecutionMode(value) === 'remote' ? 'Remote' : 'Local';
}

export function getSegmentationMlParameterFields(methodId, parameters) {
  const mode = normalizedSegmentationExecutionMode(parameters?.integration_mode);
  return (SEGMENTATION_ML_PARAMETER_FIELDS[methodId] || []).filter((field) => (
    field.name !== 'fastapi_url' || mode === 'remote'
  ));
}

const SEGMENTATION_ML_PARAMETER_FIELDS = {
  'segmentation.yolo.placeholder': [
    { name: 'integration_mode', label: 'Local/Remote', type: 'select', options: ['local', 'remote'] },
    { name: 'fastapi_url', label: 'FastAPI URL', type: 'text' },
    { name: 'mode', label: 'Mode', type: 'text' },
  ],
  'segmentation.anomalib.placeholder': [
    { name: 'integration_mode', label: 'Local/Remote', type: 'select', options: ['local', 'remote'] },
    { name: 'fastapi_url', label: 'FastAPI URL', type: 'text' },
    { name: 'mode', label: 'Mode', type: 'text' },
  ],
  'segmentation.sam.placeholder': [
    { name: 'integration_mode', label: 'Local/Remote', type: 'select', options: ['local', 'remote'] },
    { name: 'fastapi_url', label: 'FastAPI URL', type: 'text' },
    { name: 'mode', label: 'Mode', type: 'text' },
  ],
  'segmentation.opencv.placeholder': [
    { name: 'integration_mode', label: 'Local/Remote', type: 'select', options: ['local', 'remote'] },
    { name: 'fastapi_url', label: 'FastAPI URL', type: 'text' },
    { name: 'mode', label: 'Mode', type: 'text' },
  ],
};

export function getSegmentationShapePoints(shape) {
  if (!shape) return [];
  if (!SEGMENTATION_POINT_MARKER_TOOLS.has(shape.tool)) return [];
  if (Array.isArray(shape.points)) return shape.points;
  if (shape.start && shape.end) return [shape.start, shape.end];
  if (shape.center && shape.edge) return [shape.center, shape.edge];
  return [];
}

export function getSegmentationMlMethods(groupId) {
  return (SEGMENTATION_ML_METHOD_GROUPS.find((group) => group.id === groupId) || SEGMENTATION_ML_METHOD_GROUPS[0]).methods;
}

export function getDefaultSegmentationMlMethod(groupId) {
  return getSegmentationMlMethods(groupId)[0]?.id || 'segmentation.opencv.placeholder';
}

export function getDefaultSegmentationMlParameters(methodId) {
  return { ...(DEFAULT_SEGMENTATION_ML_PARAMETERS[methodId] || {}) };
}
