import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Actions, Layout, Model } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import CalibrationManager from './CalibrationManager';
import { DEFAULT_INTERFACE_HIERARCHY } from '../utils/interfaceHierarchy';

const VIEW_ORDER = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const MPR_AXES = ['axial', 'coronal', 'sagittal'];
const MPR_AXIS_LABELS = { axial: 'XY', coronal: 'XZ', sagittal: 'YZ' };
const MPR_AXIS_CONFIG = {
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
const MPR_CROSSHAIR_AXES_BY_VIEW = {
  axial: { horizontal: 'coronal', vertical: 'sagittal' },
  coronal: { horizontal: 'axial', vertical: 'sagittal' },
  sagittal: { horizontal: 'axial', vertical: 'coronal' },
};
const MPR_DISPLAY_AXES_BY_VIEW = {
  axial: { x: 'sagittal', y: 'coronal' },
  coronal: { x: 'sagittal', y: 'axial' },
  sagittal: { x: 'coronal', y: 'axial' },
};
const MPR_RECONSTRUCTION_MODES = {
  orientation: 'orientation',
  stack: 'stack',
  shell: 'shell',
};
const DEFAULT_MPR_PROJECTION_MIRROR = { axial: false, coronal: false, sagittal: false };
const MPR_VOLUME_CACHE_LIMIT = 4;
const MPR_SLICE_CANVAS_CACHE_LIMIT = 96;
const DEFAULT_DISPLAY_VALUE_DOMAIN = { min: 0, max: 255, step: 1, label: '8-bit image' };
const mprVolumeCacheStore = new Map();
const DEFAULT_OVERLAY_LAYERS = [
  { id: 'segmentation', label: 'Segmentation', color: '#ef4444' },
  { id: 'heatmap', label: 'Heatmap', color: '#8b5cf6' },
  { id: 'voids', label: 'Voids', color: '#f59e0b' },
];
const DEFAULT_MODALITIES = ['visual', 'infrared', 'uv'];
const DEFAULT_INSPECTOR_HOTKEYS = {
  accept_classification: 'a',
  reject_classification: 'r',
  toggle_shortcut_help: 'h',
};
const DEFAULT_INSPECTION_COLUMN_WIDTHS = { leftPx: null, rightPx: null };
const MEASUREMENT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
const DEFAULT_ANNOTATION_COLOR = '#f97316';
const DEFAULT_ANNOTATION_FILL_OPACITY = 0.5;
const DEFAULT_SEGMENT_COLOR = '#22c55e';
const SEGMENT_COLORS = ['#22c55e', '#3b82f6', '#f97316', '#e11d48', '#a855f7', '#14b8a6', '#facc15'];
const SEGMENTATION_HELPER_TOOLS = [
  { id: 'brush', label: 'Brush', icon: 'brush', detail: 'Paint freehand strokes onto the current segment.' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', detail: 'Remove painted areas with the same brush controls.' },
  { id: 'connected', label: 'Connected', icon: 'target', detail: 'Seed a contiguous area using sensitivity around the clicked pixel.' },
  { id: 'polygon', label: 'Polygon', icon: 'polygon', detail: 'Click boundary vertices, double-click to close the perimeter.' },
  { id: 'circle', label: 'Circle', icon: 'circle', detail: 'Click the center, then drag to set the radius.' },
  { id: 'rectangle', label: 'Rectangle', icon: 'rectangle', detail: 'Drag from one corner to the opposite corner.' },
  { id: 'threshold', label: 'Threshold', icon: 'threshold', detail: 'Preview a local intensity band around a clicked point.' },
  { id: 'level-trace', label: 'Level Trace', icon: 'contour', detail: 'Trace an equal-intensity contour from the clicked point.' },
  { id: 'scissors', label: 'Scissors', icon: 'scissors', detail: 'Mark cut paths for trimming a selected segment.' },
  { id: 'ml-helper', label: 'ML Helper', icon: 'spark', detail: 'Run a toolbox segmentation method once per slice, then select regions by click.' },
];
const SEGMENTATION_POINT_MARKER_TOOLS = new Set(['polygon', 'circle', 'rectangle']);
const SEGMENTATION_ML_METHOD_GROUPS = [
  {
    id: 'opencv',
    label: 'OpenCV',
    methods: [
      { id: 'segmentation.connected_components', label: 'Connected Components' },
      { id: 'threshold.otsu', label: 'Otsu Threshold' },
      { id: 'segmentation.watershed_seeds', label: 'Watershed Seeds' },
    ],
  },
  {
    id: 'yolo',
    label: 'YOLO',
    methods: [
      { id: 'ml.yolov8.segment', label: 'YOLOv8 Segment' },
      { id: 'ml.yolo.ultralytics', label: 'Ultralytics Configurable' },
    ],
  },
  {
    id: 'sam',
    label: 'SAM',
    methods: [
      { id: 'ml.sam.segment_anything', label: 'Segment Anything' },
      { id: 'ml.mask2former.universal_segment', label: 'Mask2Former' },
      { id: 'ml.oneformer.universal_segment', label: 'OneFormer' },
    ],
  },
];
const DEFAULT_SEGMENTATION_ML_PARAMETERS = {
  'segmentation.connected_components': { min_area_px: 12 },
  'threshold.otsu': {},
  'segmentation.watershed_seeds': { seed_spacing_px: 18, compactness: 0.01 },
  'ml.yolov8.segment': { model: 'yolov8n-seg.pt', confidence: 0.25 },
  'ml.yolo.ultralytics': { family: 'yolo11', task: 'segment', size: 'n', model: '', confidence: 0.25, iou: 0.45 },
  'ml.sam.segment_anything': {
    variant: 'sam2.1_hiera_large',
    prompt_mode: 'automatic',
    prompt_json: {},
    min_mask_region_area: 8,
    max_foreground_fraction: 0.85,
  },
  'ml.mask2former.universal_segment': { checkpoint: 'facebook/mask2former-swin-large-ade-semantic', task: 'semantic' },
  'ml.oneformer.universal_segment': { checkpoint: 'shi-labs/oneformer_ade20k_swin_large', task: 'semantic' },
};

function SegmentationToolIcon({ icon }) {
  const commonProps = {
    className: 'segmentation-tool-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  };
  if (icon === 'brush') {
    return (
      <svg {...commonProps}>
        <path d="M15.5 3.5l5 5-8.4 8.4-5-5 8.4-8.4z" />
        <path d="M7.1 11.9c-2.1 1-3.2 2.7-3.2 5.2 1.8-.1 3.5-.5 5.1-1.3" />
      </svg>
    );
  }
  if (icon === 'eraser') {
    return (
      <svg {...commonProps}>
        <path d="M4 15l8.6-8.6a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13 20H8.8L4 15z" />
        <path d="M9.5 9.5l5 5" />
        <path d="M13 20h7" />
      </svg>
    );
  }
  if (icon === 'target') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      </svg>
    );
  }
  if (icon === 'polygon') {
    return (
      <svg {...commonProps}>
        <path d="M6 6l10-2 4 9-7 7-9-5 2-9z" />
        <circle cx="6" cy="6" r="1.4" />
        <circle cx="16" cy="4" r="1.4" />
        <circle cx="20" cy="13" r="1.4" />
        <circle cx="13" cy="20" r="1.4" />
      </svg>
    );
  }
  if (icon === 'circle') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="12" cy="12" r="1.4" />
        <path d="M12 12l5.3-5.3" />
      </svg>
    );
  }
  if (icon === 'rectangle') {
    return (
      <svg {...commonProps}>
        <rect x="5" y="6" width="14" height="12" rx="1" />
        <circle cx="5" cy="6" r="1.3" />
        <circle cx="19" cy="18" r="1.3" />
      </svg>
    );
  }
  if (icon === 'threshold') {
    return (
      <svg {...commonProps}>
        <path d="M5 18V6" />
        <path d="M19 18V6" />
        <path d="M5 15c3-5 6-5 9 0 1.4 2.3 3 2.7 5 0" />
        <path d="M8 9h8" />
      </svg>
    );
  }
  if (icon === 'contour') {
    return (
      <svg {...commonProps}>
        <path d="M4.5 13.5c1.5-6.2 8.4-8.8 13-4.6 3.7 3.4 1 9.7-4.5 9.6-4.2 0-5.4-4.2-2.8-6.1 2-1.5 4.5-.2 4.8 2.1" />
      </svg>
    );
  }
  if (icon === 'scissors') {
    return (
      <svg {...commonProps}>
        <circle cx="6.5" cy="6.5" r="2.3" />
        <circle cx="6.5" cy="17.5" r="2.3" />
        <path d="M8.4 8.4L20 20" />
        <path d="M8.4 15.6L20 4" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
    </svg>
  );
}
const SEGMENTATION_ML_PARAMETER_FIELDS = {
  'segmentation.connected_components': [
    { name: 'min_area_px', label: 'Min area', type: 'number', min: 0, step: 1 },
  ],
  'segmentation.watershed_seeds': [
    { name: 'seed_spacing_px', label: 'Seed spacing', type: 'number', min: 1, step: 1 },
    { name: 'compactness', label: 'Compactness', type: 'number', min: 0, step: 0.01 },
  ],
  'ml.yolov8.segment': [
    { name: 'model', label: 'Model', type: 'text' },
    { name: 'confidence', label: 'Confidence', type: 'number', min: 0, max: 1, step: 0.05 },
  ],
  'ml.yolo.ultralytics': [
    { name: 'family', label: 'Family', type: 'select', options: ['yolov8', 'yolo11', 'custom'] },
    { name: 'task', label: 'Task', type: 'select', options: ['detect', 'segment'] },
    { name: 'size', label: 'Size', type: 'select', options: ['n', 's', 'm', 'l', 'x'] },
    { name: 'model', label: 'Custom model', type: 'text' },
    { name: 'confidence', label: 'Confidence', type: 'number', min: 0, max: 1, step: 0.05 },
    { name: 'iou', label: 'IoU', type: 'number', min: 0, max: 1, step: 0.05 },
  ],
  'ml.sam.segment_anything': [
    { name: 'variant', label: 'Variant', type: 'select', options: ['sam2.1_hiera_tiny', 'sam2.1_hiera_small', 'sam2.1_hiera_base_plus', 'sam2.1_hiera_large', 'sam_vit_b', 'sam_vit_l', 'sam_vit_h'] },
    { name: 'prompt_mode', label: 'Prompt', type: 'select', options: ['automatic', 'box', 'points'] },
    { name: 'min_mask_region_area', label: 'Min region', type: 'number', min: 1, step: 1 },
    { name: 'max_foreground_fraction', label: 'Max foreground', type: 'number', min: 0.05, max: 0.98, step: 0.01 },
  ],
  'ml.mask2former.universal_segment': [
    { name: 'checkpoint', label: 'Checkpoint', type: 'select', options: ['facebook/mask2former-swin-large-ade-semantic', 'facebook/mask2former-swin-large-ade-panoptic', 'facebook/mask2former-swin-tiny-ade-semantic'] },
    { name: 'task', label: 'Task', type: 'select', options: ['semantic', 'instance', 'panoptic'] },
  ],
  'ml.oneformer.universal_segment': [
    { name: 'checkpoint', label: 'Checkpoint', type: 'select', options: ['shi-labs/oneformer_ade20k_swin_large', 'shi-labs/oneformer_coco_swin_large', 'shi-labs/oneformer_coco_dinat_large'] },
    { name: 'task', label: 'Task', type: 'select', options: ['semantic', 'instance', 'panoptic'] },
  ],
};
const MEASUREMENT_ENDPOINT_HOVER_RATIO = 0.01;
const MEASUREMENT_LOCAL_ZOOM_DIAMETER_RATIO = 0.5;
const MEASUREMENT_LOCAL_ZOOM_SCALE = 10;
const MEASUREMENT_LOCAL_ZOOM_MIN_SCALE = 2;
const MEASUREMENT_LOCAL_ZOOM_MAX_SCALE = 25;
const MEASUREMENT_LOCAL_ZOOM_POINTER_SENSITIVITY = 0.5;
const FULLSCREEN_IMAGE_ZOOM_MIN = 1;
const FULLSCREEN_IMAGE_ZOOM_MAX = 8;
const RESIZABLE_COLUMN_MIN_PX = 220;
const RESIZE_HANDLE_WIDTH_PX = 10;
const FLEX_LAYOUT_CENTER_WEIGHT_PX = 760;
const INSPECTION_FLEX_TABSET_IDS = {
  left: 'inspection-left-tabset',
  center: 'inspection-center-tabset',
  right: 'inspection-right-tabset',
};
const DEFAULT_PANEL_LAYOUT = {
  part_list: { is_open: true, width_px: 320, height_px: 420, orientation: 'vertical' },
  inspector: { is_open: true, width_px: 360, height_px: 420, orientation: 'vertical' },
  mpr_controls: { is_open: true, width_px: 360, height_px: 360, orientation: 'vertical' },
};
const PANEL_LAYOUT_KEYS = ['part_list', 'inspector', 'mpr_controls'];
const REVIEW_LABELS = {
  unreviewed: 'Unreviewed',
  pass: 'Pass',
  reject_pending: 'Reject',
  reject_confirmed: 'Reject',
};
const IMAGE_RENDER_CATEGORIES = [
  { id: 'source', label: 'Source images' },
  { id: 'overlay', label: 'Overlays' },
];
function hasDroppedMetadataField(part, field) {
  const metadata = part?.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  const value = metadata[field];
  if (!Array.isArray(value)) return false;
  return value.some((item) => !item || typeof item !== 'object' || Array.isArray(item));
}

function normalizeSavedMeasurements(measurements) {
  if (!Array.isArray(measurements)) return [];
  return measurements
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      const value = typeof entry.value === 'string'
        ? entry.value.trim()
        : Number.isFinite(entry.value)
          ? String(entry.value)
          : '';
      if (!label || !value) return null;
      return {
        id: entry.id ? String(entry.id) : '',
        label,
        value,
      };
    })
    .filter(Boolean);
}

function getDefectCount(part) {
  const defects = part?.metadata?.defects;
  if (Array.isArray(defects)) return defects.length;
  const explicitCount = part?.metadata?.defect_count;
  return Number.isFinite(explicitCount) ? explicitCount : 0;
}

function getMeasurementLinesByImageId(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const imageId = annotation?.image_id;
    const line = annotation?.geometry?.line;
    if (!imageId || !line) return acc;
    const x1 = Number(line.x1);
    const y1 = Number(line.y1);
    const x2 = Number(line.x2);
    const y2 = Number(line.y2);
    const imageWidth = Number(line.imageWidth);
    const imageHeight = Number(line.imageHeight);
    if (![x1, y1, x2, y2, imageWidth, imageHeight].every(Number.isFinite)) return acc;
    const lengthMm = Number(annotation?.measurements?.length_mm);
    const providedLengthPx = Number(annotation?.measurements?.length_px);
    const distancePx = Number.isFinite(providedLengthPx)
      ? providedLengthPx
      : Math.hypot(x2 - x1, y2 - y1);
    const key = String(imageId);
    const lineIndex = (acc[key] || []).length;
    const color = getAnnotationColor(annotation, MEASUREMENT_COLORS[lineIndex % MEASUREMENT_COLORS.length]);
    const entry = {
      id: String(annotation.id || `${imageId}-${x1}-${y1}`),
      imageId: key,
      name: annotation?.comment || `Measurement ${lineIndex + 1}`,
      kind: annotation?.defect_class || 'Measurement',
      x1,
      y1,
      x2,
      y2,
      imageWidth,
      imageHeight,
      color,
      axis: line.axis || annotation?.geometry?.axis || '',
      sliceIndex: Number.isFinite(Number(line.slice_index ?? line.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex))
        ? Number(line.slice_index ?? line.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex)
        : null,
      distanceMm: Number.isFinite(lengthMm) ? lengthMm : null,
      distancePx,
    };
    acc[key] = [...(acc[key] || []), entry];
    return acc;
  }, {});
}

function getBoxAnnotationsByImageId(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const imageId = annotation?.image_id;
    const bbox = annotation?.bbox;
    if (!imageId || !bbox) return acc;
    const x = Number(bbox.x);
    const y = Number(bbox.y);
    const width = Number(bbox.width);
    const height = Number(bbox.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return acc;
    const imageWidth = Number(annotation?.geometry?.imageWidth || annotation?.geometry?.box?.imageWidth || bbox.imageWidth);
    const imageHeight = Number(annotation?.geometry?.imageHeight || annotation?.geometry?.box?.imageHeight || bbox.imageHeight);
    if (![imageWidth, imageHeight].every(Number.isFinite) || imageWidth <= 0 || imageHeight <= 0) return acc;
	    const key = String(imageId);
	    const boxIndex = (acc[key] || []).length;
	    const color = getAnnotationColor(annotation, MEASUREMENT_COLORS[boxIndex % MEASUREMENT_COLORS.length]);
	    const widthMm = Number(annotation?.measurements?.width_mm);
	    const heightMm = Number(annotation?.measurements?.height_mm);
	    const entry = {
	      id: String(annotation.id || `${imageId}-${x}-${y}`),
	      imageId: key,
      name: annotation?.comment || annotation?.defect_class || `Box ${boxIndex + 1}`,
      x,
      y,
      width,
      height,
	      imageWidth,
	      imageHeight,
	      color,
	      fillOpacity: getAnnotationFillOpacity(annotation),
	      axis: annotation?.geometry?.box?.axis || annotation?.geometry?.axis || '',
	      sliceIndex: Number.isFinite(Number(annotation?.geometry?.box?.slice_index ?? annotation?.geometry?.box?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex))
	        ? Number(annotation?.geometry?.box?.slice_index ?? annotation?.geometry?.box?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex)
	        : null,
	      widthMm: Number.isFinite(widthMm) ? widthMm : null,
	      heightMm: Number.isFinite(heightMm) ? heightMm : null,
	    };
    acc[key] = [...(acc[key] || []), entry];
    return acc;
  }, {});
}

function getAnnotationColor(annotation, fallback = DEFAULT_ANNOTATION_COLOR) {
  const color = String(
    annotation?.metadata?.annotation_color
    || annotation?.metadata?.measurement_color
    || annotation?.color
    || fallback
  ).trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function getAnnotationFillOpacity(annotation, fallback = DEFAULT_ANNOTATION_FILL_OPACITY) {
  const value = Number(annotation?.metadata?.annotation_fill_opacity ?? annotation?.fillOpacity ?? annotation?.fill_opacity);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function getMprSliceKey(axis, sliceIndex) {
  return `${axis}:${Number(sliceIndex) || 0}`;
}

function getMprMeasurementLinesBySlice(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const line = annotation?.geometry?.line;
    const axis = String(line?.axis || annotation?.geometry?.axis || '').trim();
    const sliceIndex = Number(line?.slice_index ?? line?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex);
    if (!axis || !Number.isFinite(sliceIndex)) return acc;
    const parsed = getMeasurementLinesByImageId([{ ...annotation, image_id: annotation?.image_id || getMprSliceKey(axis, sliceIndex) }]);
    const entry = Object.values(parsed)[0]?.[0];
    if (!entry) return acc;
    const key = getMprSliceKey(axis, sliceIndex);
    acc[key] = [...(acc[key] || []), { ...entry, axis, sliceIndex }];
    return acc;
  }, {});
}

function getMprBoxAnnotationsBySlice(annotations) {
  if (!Array.isArray(annotations)) return {};
  return annotations.reduce((acc, annotation) => {
    const box = annotation?.geometry?.box;
    const axis = String(box?.axis || annotation?.geometry?.axis || '').trim();
    const sliceIndex = Number(box?.slice_index ?? box?.sliceIndex ?? annotation?.geometry?.slice_index ?? annotation?.geometry?.sliceIndex);
    if (!axis || !Number.isFinite(sliceIndex)) return acc;
    const bbox = annotation?.bbox || box;
    const imageWidth = Number(annotation?.geometry?.imageWidth || box?.imageWidth || bbox?.imageWidth);
    const imageHeight = Number(annotation?.geometry?.imageHeight || box?.imageHeight || bbox?.imageHeight);
    const x = Number(bbox?.x);
    const y = Number(bbox?.y);
    const width = Number(bbox?.width);
    const height = Number(bbox?.height);
    if (![x, y, width, height, imageWidth, imageHeight].every(Number.isFinite) || width <= 0 || height <= 0) return acc;
    const key = getMprSliceKey(axis, sliceIndex);
    const boxIndex = (acc[key] || []).length;
    acc[key] = [...(acc[key] || []), {
      id: String(annotation.id || `${key}-${x}-${y}`),
      imageId: key,
      name: annotation?.comment || annotation?.defect_class || `Box ${boxIndex + 1}`,
      x,
      y,
      width,
      height,
      imageWidth,
      imageHeight,
      color: getAnnotationColor(annotation, MEASUREMENT_COLORS[boxIndex % MEASUREMENT_COLORS.length]),
      fillOpacity: getAnnotationFillOpacity(annotation),
      axis,
      sliceIndex,
    }];
    return acc;
  }, {});
}

function getMprCubeAnnotations(annotations) {
  if (!Array.isArray(annotations)) return [];
  return annotations.map((annotation) => {
    const cube = annotation?.geometry?.cube;
    if (!cube || typeof cube !== 'object') return null;
    const axis = String(cube.axis || '').trim();
    const startSlice = Number(cube.startSlice ?? cube.start_slice);
    const endSlice = Number(cube.endSlice ?? cube.end_slice);
    const x = Number(cube.x);
    const y = Number(cube.y);
    const width = Number(cube.width);
    const height = Number(cube.height);
    const imageWidth = Number(cube.imageWidth || cube.image_width);
    const imageHeight = Number(cube.imageHeight || cube.image_height);
    if (!axis || ![startSlice, endSlice, x, y, width, height, imageWidth, imageHeight].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return {
      id: String(annotation.id || `${axis}-${startSlice}-${endSlice}-${x}-${y}`),
      axis,
      startSlice: Math.min(startSlice, endSlice),
      endSlice: Math.max(startSlice, endSlice),
      x,
      y,
      width,
      height,
      imageWidth,
      imageHeight,
      color: getAnnotationColor(annotation),
      fillOpacity: getAnnotationFillOpacity(annotation),
      name: annotation?.comment || annotation?.defect_class || 'Cube',
    };
  }).filter(Boolean);
}

function getMprCubeBoxesForSlice(cubes, axis, sliceIndex) {
  return (Array.isArray(cubes) ? cubes : [])
    .filter((cube) => cube.axis === axis && Number(sliceIndex) >= cube.startSlice && Number(sliceIndex) <= cube.endSlice)
    .map((cube) => ({
      ...cube,
      id: `${cube.id}-${axis}-${sliceIndex}`,
      imageId: getMprSliceKey(axis, sliceIndex),
    }));
}

function makeMprCubeVertices(axis, firstBox, secondBox) {
  const lowerSlice = Math.min(Number(firstBox.sliceIndex), Number(secondBox.sliceIndex));
  const upperSlice = Math.max(Number(firstBox.sliceIndex), Number(secondBox.sliceIndex));
  const x = Math.min(Number(firstBox.x), Number(secondBox.x));
  const y = Math.min(Number(firstBox.y), Number(secondBox.y));
  const width = Math.max(Number(firstBox.x) + Number(firstBox.width), Number(secondBox.x) + Number(secondBox.width)) - x;
  const height = Math.max(Number(firstBox.y) + Number(firstBox.height), Number(secondBox.y) + Number(secondBox.height)) - y;
  const planeCorners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  const toVolumeVertex = (point, slice) => {
    if (axis === 'coronal') return { x: Number(point.x.toFixed(2)), y: slice, z: Number(point.y.toFixed(2)) };
    if (axis === 'sagittal') return { x: slice, y: Number(point.x.toFixed(2)), z: Number(point.y.toFixed(2)) };
    return { x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)), z: slice };
  };
  return [
    ...planeCorners.map((point) => toVolumeVertex(point, lowerSlice)),
    ...planeCorners.map((point) => toVolumeVertex(point, upperSlice)),
  ];
}

function isFiniteMeasurementLine(line) {
  if (!line || typeof line !== 'object') return false;
  const values = [line.x1, line.y1, line.x2, line.y2, line.imageWidth, line.imageHeight];
  return values.every((value) => Number.isFinite(Number(value)));
}

function isFiniteAnnotationBox(box) {
  if (!box || typeof box !== 'object') return false;
  const values = [box.x, box.y, box.width, box.height, box.imageWidth, box.imageHeight];
  return values.every((value) => Number.isFinite(Number(value))) && Number(box.width) > 0 && Number(box.height) > 0;
}

function isValidCalibration(calibration) {
  return Number(calibration?.pixels_per_mm) > 0;
}

function getImageMetadata(image) {
  return (image?.metadata && typeof image.metadata === 'object')
    ? image.metadata
    : (image?.metadata_ && typeof image.metadata_ === 'object')
      ? image.metadata_
      : {};
}

function resolveMeasurementCalibration(projectMetadata, image, projectConfiguration, sessionCalibration) {
  if (isValidCalibration(sessionCalibration)) return sessionCalibration;
  const imageMetadata = getImageMetadata(image);
  if (isValidCalibration(imageMetadata?.calibration_override)) return imageMetadata.calibration_override;
  const rules = Array.isArray(projectMetadata?.calibration_rules) ? projectMetadata.calibration_rules : [];
  const matchingRule = rules.find((rule) => (
    rule?.metadata_key
    && rule?.metadata_value !== undefined
    && isValidCalibration(rule?.calibration)
    && imageMetadata[rule.metadata_key] !== undefined
    && String(imageMetadata[rule.metadata_key]) === String(rule.metadata_value)
  ));
  if (matchingRule) return matchingRule.calibration;
  if (isValidCalibration(projectMetadata?.calibration_default)) return projectMetadata.calibration_default;
  if (isValidCalibration(projectConfiguration?.calibration)) return projectConfiguration.calibration;
  return null;
}

function getMeasurementLineLabel(line) {
  if (Number.isFinite(Number(line?.distanceMm))) {
    return `${Number(line.distanceMm).toFixed(2)} mm`;
  }
  const distancePx = Number.isFinite(Number(line?.distancePx))
    ? Number(line.distancePx)
    : isFiniteMeasurementLine(line)
      ? Math.hypot(Number(line.x2) - Number(line.x1), Number(line.y2) - Number(line.y1))
      : null;
  return Number.isFinite(distancePx) ? `${distancePx.toFixed(1)} px` : '';
}

function getAnnotationBoxWidthLabel(box) {
  if (Number.isFinite(Number(box?.widthMm))) {
    return `Width ${Number(box.widthMm).toFixed(2)} mm`;
  }
  return `Width ${Number(box.width).toFixed(1)} px`;
}

function getAnnotationBoxHeightLabel(box) {
  if (Number.isFinite(Number(box?.heightMm))) {
    return `Height ${Number(box.heightMm).toFixed(2)} mm`;
  }
  return `Height ${Number(box.height).toFixed(1)} px`;
}

function getAnnotationListType(annotation) {
  const defectClass = String(annotation?.defect_class || '').trim();
  if (defectClass) return defectClass;
  if (annotation?.geometry?.line) return 'Measurement';
  if (annotation?.geometry?.box || annotation?.bbox) return 'Bounding Box';
  return 'Annotation';
}

function getAnnotationListValue(annotation) {
  const measurements = annotation?.measurements && typeof annotation.measurements === 'object'
    ? annotation.measurements
    : {};
  const lengthMm = Number(measurements.length_mm);
  if (Number.isFinite(lengthMm)) return `${lengthMm.toFixed(2)} mm`;
  const lengthPx = Number(measurements.length_px);
  if (Number.isFinite(lengthPx)) return `${lengthPx.toFixed(1)} px`;

  const widthMm = Number(measurements.width_mm);
  const heightMm = Number(measurements.height_mm);
  if (Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0) {
    return `${widthMm.toFixed(2)} x ${heightMm.toFixed(2)} mm`;
  }
  const measurementWidthPx = Number(measurements.width_px);
  const measurementHeightPx = Number(measurements.height_px);
  if (
    Number.isFinite(measurementWidthPx)
    && Number.isFinite(measurementHeightPx)
    && measurementWidthPx > 0
    && measurementHeightPx > 0
  ) {
    return `${measurementWidthPx.toFixed(1)} x ${measurementHeightPx.toFixed(1)} px`;
  }

  const comment = String(annotation?.comment || '').trim();
  if (comment) return comment;

  const widthPx = Number(annotation?.bbox?.width);
  const heightPx = Number(annotation?.bbox?.height);
  if (Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0) {
    return `${widthPx.toFixed(1)} x ${heightPx.toFixed(1)} px`;
  }

  const firstMeasurement = Object.entries(measurements).find(([, value]) => (
    typeof value === 'string' || Number.isFinite(Number(value))
  ));
  if (firstMeasurement) {
    const [label, value] = firstMeasurement;
    return `${label}: ${value}`;
  }
  return '-';
}

function getMeasurementLabelViewBoxPosition(line, fontSize = 20) {
  const x = ((Number(line.x1) + Number(line.x2)) / (2 * Number(line.imageWidth))) * 1000;
  const y = ((Number(line.y1) + Number(line.y2)) / (2 * Number(line.imageHeight))) * 1000 - 6;
  const inset = Math.max(12, fontSize + 4);
  return {
    x: Math.min(980, Math.max(20, x)),
    y: Math.min(980, Math.max(inset, y)),
  };
}

function getMeasurementEndpointViewBoxPosition(line) {
  return {
    start: {
      x: (Number(line.x1) / Number(line.imageWidth)) * 1000,
      y: (Number(line.y1) / Number(line.imageHeight)) * 1000,
    },
    end: {
      x: (Number(line.x2) / Number(line.imageWidth)) * 1000,
      y: (Number(line.y2) / Number(line.imageHeight)) * 1000,
    },
  };
}

function getAnnotationBoxCornerPoints(box) {
  const x = Number(box?.x);
  const y = Number(box?.y);
  const width = Number(box?.width);
  const height = Number(box?.height);
  return {
    topLeft: { x, y },
    topRight: { x: x + width, y },
    bottomLeft: { x, y: y + height },
    bottomRight: { x: x + width, y: y + height },
  };
}

function getAnnotationBoxCornerViewBoxPosition(box) {
  const imageWidth = Number(box?.imageWidth);
  const imageHeight = Number(box?.imageHeight);
  return Object.entries(getAnnotationBoxCornerPoints(box)).reduce((acc, [corner, point]) => {
    acc[corner] = {
      x: (point.x / imageWidth) * 1000,
      y: (point.y / imageHeight) * 1000,
    };
    return acc;
  }, {});
}

function getAnnotationBoxOppositeCornerName(corner) {
  return {
    topLeft: 'bottomRight',
    topRight: 'bottomLeft',
    bottomLeft: 'topRight',
    bottomRight: 'topLeft',
  }[corner];
}

function getMeasurementLineWithDerivedLength(line, imageId, calibration) {
  if (!isFiniteMeasurementLine(line)) return null;
  const distancePx = Math.hypot(Number(line.x2) - Number(line.x1), Number(line.y2) - Number(line.y1));
  const pixelsPerMm = Number(calibration?.pixels_per_mm || 0);
  return {
    ...line,
    imageId: String(imageId || line.imageId || ''),
    distancePx,
    distanceMm: pixelsPerMm > 0 ? distancePx / pixelsPerMm : null,
  };
}

function getPartViews(part) {
  const configuredViews = part?.metadata?.configured_views;
  if (Array.isArray(configuredViews) && configuredViews.length > 0) {
    return configuredViews.map((value) => String(value).toLowerCase());
  }
  return VIEW_ORDER;
}

function getModalities(part) {
  const modalities = part?.metadata?.modalities;
  if (Array.isArray(modalities) && modalities.length > 0) {
    return modalities.map((value) => String(value));
  }
  return DEFAULT_MODALITIES;
}

function getMprDimensions(part) {
  const raw = part?.metadata?.volume_shape || part?.metadata?.mpr?.volume_shape || {};
  const dimensions = MPR_AXES.reduce((acc, axis) => {
    const value = Number(raw?.[axis]);
    acc[axis] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 128;
    return acc;
  }, {});
  return dimensions;
}

function getVolumeSourceImages(part, projectImageLookup = {}) {
  const sourceImages = part?.metadata?.source_images;
  if (!Array.isArray(sourceImages)) return [];
  return sourceImages
    .map((entry, index) => {
      const filename = String(entry?.filename || '');
      const imageId = entry?.image_id || projectImageLookup[filename]?.id;
      if (!imageId) return null;
      const sliceIndex = Number(entry?.metadata?.slice_index ?? entry?.slice_index ?? index);
      return {
        id: String(imageId),
        filename,
        sliceIndex: Number.isFinite(sliceIndex) ? sliceIndex : index,
        url: `/api/images/${encodeURIComponent(String(imageId))}/content`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sliceIndex - right.sliceIndex || left.filename.localeCompare(right.filename));
}

function getNumericRangeFromCandidate(candidate) {
  if (!candidate) return null;
  if (Array.isArray(candidate) && candidate.length >= 2) {
    const min = Number(candidate[0]);
    const max = Number(candidate[1]);
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
  }
  if (typeof candidate !== 'object') return null;
  const min = Number(candidate.min ?? candidate.minimum ?? candidate.low ?? candidate.lower ?? candidate.min_value ?? candidate.range_min);
  const max = Number(candidate.max ?? candidate.maximum ?? candidate.high ?? candidate.upper ?? candidate.max_value ?? candidate.range_max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
}

function getDisplayDomainFromDtype(value) {
  const dtype = String(value || '').trim().toLowerCase();
  if (!dtype) return null;
  if (/uint8|\|u1|<u1|>u1|ubyte/.test(dtype)) return { min: 0, max: 255, step: 1, label: 'uint8' };
  if (/int8|\|i1|<i1|>i1/.test(dtype)) return { min: -128, max: 127, step: 1, label: 'int8' };
  if (/uint16|<u2|>u2|\|u2/.test(dtype)) return { min: 0, max: 65535, step: 1, label: 'uint16' };
  if (/uint32|<u4|>u4|\|u4/.test(dtype)) return { min: 0, max: 4294967295, step: 1, label: 'uint32' };
  if (/int16|<i2|>i2|\|i2/.test(dtype)) return { min: -32768, max: 32767, step: 1, label: 'int16' };
  if (/int32|<i4|>i4|\|i4/.test(dtype)) return { min: -2147483648, max: 2147483647, step: 1, label: 'int32' };
  if (/float|double|<f|>f|\|f/.test(dtype)) return { min: 0, max: 1, step: 0.001, label: dtype.includes('64') ? 'float64' : 'float' };
  return null;
}

function getDisplayDomainFromBitDepth(value, signed = false) {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits <= 0 || bits > 32) return null;
  if (signed) {
    const max = (2 ** (bits - 1)) - 1;
    return { min: -(2 ** (bits - 1)), max, step: 1, label: `int${bits}` };
  }
  return { min: 0, max: (2 ** bits) - 1, step: 1, label: `${bits}-bit` };
}

function getDisplayDomainFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const dtypeDomain = getDisplayDomainFromDtype(
    metadata.voxel_dtype
      ?? metadata.pixel_dtype
      ?? metadata.data_dtype
      ?? metadata.dtype
      ?? metadata.pixel_type
      ?? metadata.data_type,
  );
  if (dtypeDomain) return dtypeDomain;
  const bitDepthDomain = getDisplayDomainFromBitDepth(
    metadata.bit_depth ?? metadata.bits_allocated ?? metadata.bits_per_sample,
    metadata.signed === true || String(metadata.pixel_representation || '').toLowerCase() === 'signed',
  );
  if (bitDepthDomain) return bitDepthDomain;
  const explicitRange = [
    metadata.data_value_range,
    metadata.voxel_value_range,
    metadata.pixel_value_range,
    metadata.scalar_range,
    metadata.value_range,
    metadata.intensity_range,
    metadata.display_range,
  ].map(getNumericRangeFromCandidate).find(Boolean);
  if (explicitRange) {
    const span = explicitRange.max - explicitRange.min;
    return {
      ...explicitRange,
      step: Number.isInteger(explicitRange.min) && Number.isInteger(explicitRange.max) ? 1 : Math.max(0.001, span / 1000),
      label: 'metadata range',
    };
  }
  return null;
}

function getPartDisplayValueDomain(part, projectImageLookup = {}) {
  const partDomain = getDisplayDomainFromMetadata(part?.metadata);
  if (partDomain) return partDomain;

  const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
  for (const source of sourceImages) {
    const sourceDomain = getDisplayDomainFromMetadata(source?.metadata) || getDisplayDomainFromMetadata(source);
    if (sourceDomain) return sourceDomain;
    const filename = String(source?.filename || '');
    const imageId = String(source?.image_id || '');
    const imageRecord = projectImageLookup[imageId] || projectImageLookup[filename];
    const imageDomain = getDisplayDomainFromMetadata(getImageMetadata(imageRecord));
    if (imageDomain) return imageDomain;
  }

  return DEFAULT_DISPLAY_VALUE_DOMAIN;
}

function getNormalizedDisplayDomain(domain) {
  const min = Number(domain?.min);
  const max = Number(domain?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return DEFAULT_DISPLAY_VALUE_DOMAIN;
  const step = Number(domain?.step);
  return {
    min,
    max,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    label: domain?.label || DEFAULT_DISPLAY_VALUE_DOMAIN.label,
  };
}

function formatWindowValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3).replace(/\.?0+$/, '');
}

function normalizeDisplayWindow(candidate, domain, fallback) {
  const safeDomain = getNormalizedDisplayDomain(domain);
  const minimumGap = Math.min(safeDomain.step, safeDomain.max - safeDomain.min);
  const fallbackWindow = fallback && Number.isFinite(Number(fallback.min)) && Number.isFinite(Number(fallback.max))
    ? fallback
    : { min: safeDomain.min, max: safeDomain.max };
  const rawMin = Number(candidate?.min);
  const rawMax = Number(candidate?.max);
  let min = Number.isFinite(rawMin) ? rawMin : Number(fallbackWindow.min);
  let max = Number.isFinite(rawMax) ? rawMax : Number(fallbackWindow.max);
  min = clampRange(min, safeDomain.min, safeDomain.max - minimumGap, safeDomain.min);
  max = clampRange(max, min + minimumGap, safeDomain.max, safeDomain.max);
  return { min, max };
}

function getWindowPercent(value, domain) {
  const safeDomain = getNormalizedDisplayDomain(domain);
  return ((clampRange(value, safeDomain.min, safeDomain.max, safeDomain.min) - safeDomain.min) / (safeDomain.max - safeDomain.min)) * 100;
}

function getShellImageLayers(part, projectImageLookup = {}) {
  const imagesByView = part?.metadata?.view_images;
  if (!imagesByView || typeof imagesByView !== 'object') return [];
  return Object.entries(imagesByView)
    .map(([viewName, imageRef]) => {
      const filename = String(imageRef || '');
      const imageId = projectImageLookup[filename]?.id;
      if (!imageId) return null;
      return {
        viewName: String(viewName || '').toLowerCase(),
        filename,
        id: String(imageId),
        url: `/api/images/${encodeURIComponent(String(imageId))}/content`,
      };
    })
    .filter(Boolean);
}

function getAnalyzeOverlayDisplayLabel(label) {
  const parts = String(label || 'Analyze Overlay')
    .split('::')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'Analyze Overlay';
  return [...parts].reverse().join(' :: ');
}

function getPartImageRefs(part) {
  const refs = [];
  const seen = new Set();
  const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
  const sourceImageByFilename = sourceImages.reduce((acc, record) => {
    const filename = String(record?.filename || '');
    if (filename && !acc[filename]) acc[filename] = record;
    return acc;
  }, {});
  const getRecordModality = (record) => String(record?.modality || record?.metadata?.modality || '').toLowerCase();
  const imagesByView = part?.metadata?.view_images;
  if (imagesByView && typeof imagesByView === 'object') {
    Object.entries(imagesByView).forEach(([viewName, imageRef]) => {
      const ref = String(imageRef || '');
      if (!ref || seen.has(ref)) return;
      const sourceRecord = sourceImageByFilename[ref] || {};
      seen.add(ref);
      refs.push({
        id: `${part.id}-view-${viewName}`,
        viewName: String(viewName || '').toLowerCase(),
        modality: getRecordModality(sourceRecord),
        label: String(viewName || 'image').toUpperCase(),
        imageRef: ref,
        imageId: sourceRecord.image_id ? String(sourceRecord.image_id) : '',
        overlay: false,
      });
    });
  }
  const hasViewRefs = refs.length > 0;
  const isAnalyzeOutputRecord = (record) => {
    const modality = String(record?.modality || '').toLowerCase();
    return Boolean(
      record?.analysis_output
      || record?.analysis_source_image_id
      || record?.overlay_base_image_id
      || modality === 'analyze-overlay'
    );
  };
  const pushRecord = (record, index, forceOverlay = false) => {
    if (!record || typeof record !== 'object') return;
    if (record.overlay_delete_candidate || record.delete_candidate) return;
    const overlay = forceOverlay || record.overlay === true || record.analysis_output === true;
    if (!overlay && hasViewRefs) return;
    const imageRef = String(record.image_id || record.filename || '');
    if (!imageRef || seen.has(imageRef)) return;
    seen.add(imageRef);
    const modality = getRecordModality(record);
    const label = overlay
      ? getAnalyzeOverlayDisplayLabel(record.label || record.analysis_label || modality || 'Analyze Overlay')
      : String(record.side || record.modality || `IMAGE ${index + 1}`).toUpperCase();
    refs.push({
      id: `${part.id}-${overlay ? 'analysis' : 'source'}-${index}`,
      viewName: String(record.side || record.modality || (overlay ? 'overlay' : 'image')).toLowerCase(),
      modality,
      label,
      imageRef,
      filename: String(record.filename || ''),
      imageId: record.image_id ? String(record.image_id) : '',
      overlay,
      overlayBaseImageId: record.overlay_base_image_id ? String(record.overlay_base_image_id) : '',
      overlayBaseFilename: record.overlay_base_filename ? String(record.overlay_base_filename) : '',
    });
  };
  sourceImages.forEach((record, index) => {
    pushRecord(record, index, isAnalyzeOutputRecord(record));
  });
  const analysisOutputs = part?.metadata?.analysis_outputs;
  if (Array.isArray(analysisOutputs)) {
    analysisOutputs.forEach((record, index) => {
      pushRecord(record, index, true);
    });
  }
  return refs;
}

function resolveProjectImageId(projectImageLookup, ...candidates) {
  for (const candidate of candidates) {
    const key = String(candidate || '');
    if (!key) continue;
    const record = projectImageLookup[key];
    if (record?.id) return String(record.id);
    if (key) return key;
  }
  return '';
}

function getAnnotationSourceImageId(entry, projectImageLookup) {
  const imageId = resolveProjectImageId(projectImageLookup, entry?.imageId, entry?.imageRef);
  if (!imageId) return '';
  if (!entry?.overlay) return imageId;
  const imageRecord = projectImageLookup[entry.imageId] || projectImageLookup[entry.imageRef] || {};
  return resolveProjectImageId(
    projectImageLookup,
    entry.overlayBaseImageId,
    entry.overlayBaseFilename,
    imageRecord?.metadata?.overlay_base_image_id,
    imageRecord?.metadata?.analysis_source_image_id,
    imageRecord?.metadata?.overlay_base_filename,
    imageId,
  );
}

function getAnnotationSourceImageIdLookup(imageEntries, projectImageLookup) {
  return imageEntries.reduce((acc, entry) => {
    const imageId = resolveProjectImageId(projectImageLookup, entry?.imageId, entry?.imageRef);
    const sourceImageId = getAnnotationSourceImageId(entry, projectImageLookup);
    if (imageId && sourceImageId) acc[imageId] = sourceImageId;
    if (sourceImageId) acc[sourceImageId] = sourceImageId;
    return acc;
  }, {});
}

function renderAnnotationOverlay({ measurementLines = [], boxes = [], fontSize = 24, selectedAnnotationId = '' }) {
  return (
    <>
      {measurementLines.filter(isFiniteMeasurementLine).map((line) => {
        const labelPosition = getMeasurementLabelViewBoxPosition(line, fontSize);
        const isSelected = String(selectedAnnotationId || '') === String(line.id || '');
        return (
          <g key={`line-${line.id}`} className={isSelected ? 'inspection-annotation-selected' : ''}>
            {isSelected && <line x1={(line.x1 / line.imageWidth) * 1000} y1={(line.y1 / line.imageHeight) * 1000} x2={(line.x2 / line.imageWidth) * 1000} y2={(line.y2 / line.imageHeight) * 1000} stroke="#ffffff" strokeWidth="10" />}
            <line x1={(line.x1 / line.imageWidth) * 1000} y1={(line.y1 / line.imageHeight) * 1000} x2={(line.x2 / line.imageWidth) * 1000} y2={(line.y2 / line.imageHeight) * 1000} stroke={line.color} strokeWidth={isSelected ? '6' : '3'} />
            <text x={labelPosition.x} y={labelPosition.y} fill={line.color} fontSize={fontSize} fontWeight={isSelected ? '800' : '400'}>
              {getMeasurementLineLabel(line)}
            </text>
          </g>
        );
      })}
      {boxes.filter(isFiniteAnnotationBox).map((box) => {
        const x = (box.x / box.imageWidth) * 1000;
        const y = (box.y / box.imageHeight) * 1000;
        const width = (box.width / box.imageWidth) * 1000;
        const height = (box.height / box.imageHeight) * 1000;
        const labelSize = Math.max(18, fontSize * 0.82);
        const isSelected = String(selectedAnnotationId || '') === String(box.id || '');
        const fillOpacity = Number.isFinite(Number(box.fillOpacity)) ? Math.min(1, Math.max(0, Number(box.fillOpacity))) : DEFAULT_ANNOTATION_FILL_OPACITY;
        return (
          <g key={`box-${box.id}`} className={isSelected ? 'inspection-annotation-selected' : ''}>
            {isSelected && <rect x={x} y={y} width={width} height={height} fill={box.color} fillOpacity={Math.min(1, fillOpacity + 0.18)} stroke="#ffffff" strokeWidth="10" />}
            <rect x={x} y={y} width={width} height={height} fill={box.color} fillOpacity={fillOpacity} stroke={box.color} strokeWidth={isSelected ? '6' : '3'} />
            <text x={Math.min(980, Math.max(20, x + (width / 2)))} y={Math.max(24, y - 8)} fill={box.color} fontSize={labelSize} fontWeight={isSelected ? '800' : '400'} textAnchor="middle">
              {getAnnotationBoxWidthLabel(box)}
            </text>
            <text x={Math.min(980, x + width + 12)} y={Math.min(980, y + (height / 2))} fill={box.color} fontSize={labelSize} fontWeight={isSelected ? '800' : '400'} transform={`rotate(90 ${Math.min(980, x + width + 12)} ${Math.min(980, y + (height / 2))})`} textAnchor="middle">
              {getAnnotationBoxHeightLabel(box)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function getFallbackProjectionImage(axis, shellImageLayers) {
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

function getFraction(value, maxValue) {
  const upper = Math.max(1, Number(maxValue) || 1);
  return Math.min(1, Math.max(0, (Number(value) || 0) / upper));
}

function normalizeMprProjectionMirror(candidate) {
  return MPR_AXES.reduce((acc, axis) => {
    acc[axis] = candidate?.[axis] === true;
    return acc;
  }, { ...DEFAULT_MPR_PROJECTION_MIRROR });
}

function getScaledIndex(value, sourceMaxValue, targetLength) {
  const upper = Math.max(0, (Number(targetLength) || 1) - 1);
  return clampRange(Math.round(getFraction(value, sourceMaxValue) * upper), 0, upper, 0);
}

function getMprVolumeCacheKey(imageStack) {
  if (!Array.isArray(imageStack) || imageStack.length === 0) return '';
  return imageStack
    .map((entry) => `${entry.id}:${entry.sliceIndex}:${entry.url}`)
    .join('|');
}

function rememberMprVolumeCache(key, cache) {
  if (!key || !cache) return;
  mprVolumeCacheStore.delete(key);
  mprVolumeCacheStore.set(key, cache);
  while (mprVolumeCacheStore.size > MPR_VOLUME_CACHE_LIMIT) {
    const oldestKey = mprVolumeCacheStore.keys().next().value;
    mprVolumeCacheStore.delete(oldestKey);
  }
}

function rememberSliceCanvas(volumeCache, key, canvas) {
  if (!volumeCache?.sliceCanvases || !key || !canvas) return;
  volumeCache.sliceCanvases.delete(key);
  volumeCache.sliceCanvases.set(key, canvas);
  while (volumeCache.sliceCanvases.size > MPR_SLICE_CANVAS_CACHE_LIMIT) {
    const oldestKey = volumeCache.sliceCanvases.keys().next().value;
    volumeCache.sliceCanvases.delete(oldestKey);
  }
}

function loadMprImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source.url;
  });
}

async function buildMprVolumeCache(cacheKey, imageStack, dimensions) {
  const images = await Promise.all(imageStack.map(loadMprImage));
  const validImages = images.filter(Boolean);
  if (validImages.length === 0) return null;

  const first = validImages[0];
  const width = first.naturalWidth || first.width || Math.max(1, dimensions.sagittal || 1);
  const height = first.naturalHeight || first.height || Math.max(1, dimensions.coronal || 1);
  const scratch = document.createElement('canvas');
  const scratchContext = scratch.getContext?.('2d');
  if (!scratchContext) return null;

  scratch.width = width;
  scratch.height = height;

  const slices = validImages.map((image) => {
    scratchContext.clearRect(0, 0, width, height);
    scratchContext.drawImage(image, 0, 0, width, height);
    return {
      image,
      imageData: scratchContext.getImageData(0, 0, width, height),
    };
  });

  return {
    key: cacheKey,
    width,
    height,
    depth: slices.length,
    slices,
    sliceCanvases: new Map(),
  };
}

function getCachedMprSliceCanvas(axis, slicePosition, dimensions, volumeCache) {
  if (!volumeCache || typeof document === 'undefined') return null;
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
    outputContext.drawImage(slice.image, 0, 0, output.width, output.height);
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

function getMprCrosshairStyle(axis, slicePosition, dimensions, mirroredAxes = DEFAULT_MPR_PROJECTION_MIRROR) {
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

function createDefaultSegment(index = 0) {
  return {
    id: `segment-${Date.now()}-${index}`,
    name: index === 0 ? 'Segment A' : `Segment ${String.fromCharCode(65 + (index % 26))}`,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length] || DEFAULT_SEGMENT_COLOR,
    areas: [],
  };
}

function getMprAxisImageDimensions(axis, dimensions = {}) {
  if (axis === 'coronal') {
    return {
      width: Math.max(1, Number(dimensions.sagittal) || 1),
      height: Math.max(1, Number(dimensions.axial) || 1),
    };
  }
  if (axis === 'sagittal') {
    return {
      width: Math.max(1, Number(dimensions.coronal) || 1),
      height: Math.max(1, Number(dimensions.axial) || 1),
    };
  }
  return {
    width: Math.max(1, Number(dimensions.sagittal) || 1),
    height: Math.max(1, Number(dimensions.coronal) || 1),
  };
}

function getSegmentationShapeKey(shape, index) {
  return `${shape?.operation || 'add'}-${shape?.tool || 'shape'}-${shape?.axis || 'axis'}-${shape?.sliceIndex ?? 'slice'}-${shape?.id || index}`;
}

function renderSegmentationShape(shape, options = {}) {
  if (!shape) return null;
  const strokeColor = options.color || shape.color || DEFAULT_SEGMENT_COLOR;
  const fillColor = options.fillColor || strokeColor;
  const fillOpacity = Number.isFinite(Number(options.fillOpacity)) ? Number(options.fillOpacity) : 0.22;
  const strokeWidth = options.strokeWidth || 2.5;
  const points = Array.isArray(shape.points) ? shape.points : [];
  const className = [
    'segmentation-helper-shape',
    shape.operation === 'subtract' ? 'subtract' : 'add',
    options.preview ? 'preview' : '',
  ].filter(Boolean).join(' ');

  if (shape.tool === 'brush' || shape.tool === 'eraser' || shape.tool === 'scissors') {
    if (points.length === 0) return null;
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    return (
      <path
        d={path}
        className={className}
        fill="none"
        stroke={strokeColor}
        strokeWidth={Math.max(2, Number(shape.brushSize) || 12)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={shape.tool === 'eraser' || shape.operation === 'subtract' ? 0.72 : 0.88}
      />
    );
  }

  if (shape.tool === 'polygon' && points.length > 0) {
    const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
    return (
      <polyline
        points={pointString}
        className={className}
        fill={shape.closed && points.length > 2 ? fillColor : 'none'}
        fillOpacity={shape.closed && points.length > 2 ? fillOpacity : 0}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'circle' && shape.center) {
    const radius = Number(shape.radius) || (
      shape.edge ? Math.hypot(shape.edge.x - shape.center.x, shape.edge.y - shape.center.y) : 0
    );
    if (radius <= 0) return null;
    return (
      <circle
        cx={shape.center.x}
        cy={shape.center.y}
        r={radius}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'rectangle' && shape.start && shape.end) {
    const x = Math.min(shape.start.x, shape.end.x);
    const y = Math.min(shape.start.y, shape.end.y);
    const width = Math.abs(shape.end.x - shape.start.x);
    const height = Math.abs(shape.end.y - shape.start.y);
    if (width <= 0 || height <= 0) return null;
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'ml-helper' && Array.isArray(shape.bbox) && shape.bbox.length >= 4) {
    const [x1, y1, x2, y2] = shape.bbox.map(Number);
    const width = x2 - x1;
    const height = y2 - y1;
    if (![x1, y1, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return (
      <rect
        x={x1}
        y={y1}
        width={width}
        height={height}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'connected') {
    if (!shape.maskPath) return null;
    return (
      <path
        d={shape.maskPath}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (['threshold', 'level-trace'].includes(shape.tool) && shape.seed) {
    const radius = Number(shape.radius) || Number(shape.sensitivity) || 20;
    return (
      <ellipse
        cx={shape.seed.x}
        cy={shape.seed.y}
        rx={radius * 1.25}
        ry={radius}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={shape.tool === 'level-trace' ? '7 5' : undefined}
      />
    );
  }

  return null;
}

function getSegmentationShapePoints(shape) {
  if (!shape) return [];
  if (!SEGMENTATION_POINT_MARKER_TOOLS.has(shape.tool)) return [];
  if (Array.isArray(shape.points)) return shape.points;
  if (shape.start && shape.end) return [shape.start, shape.end];
  if (shape.center && shape.edge) return [shape.center, shape.edge];
  return [];
}

function getSegmentationMlMethods(groupId) {
  return (SEGMENTATION_ML_METHOD_GROUPS.find((group) => group.id === groupId) || SEGMENTATION_ML_METHOD_GROUPS[0]).methods;
}

function getDefaultSegmentationMlMethod(groupId) {
  return getSegmentationMlMethods(groupId)[0]?.id || 'segmentation.connected_components';
}

function getDefaultSegmentationMlParameters(methodId) {
  return { ...(DEFAULT_SEGMENTATION_ML_PARAMETERS[methodId] || {}) };
}

function getPlaneFocusRange(position, maxDimension) {
  const half = maxDimension / 10;
  let lo = position - half;
  let hi = position + half;
  if (lo < 0) { hi -= lo; lo = 0; }
  if (hi > maxDimension) { lo -= (hi - maxDimension); hi = maxDimension; }
  return [Math.max(0, lo), hi];
}

function projectMprPointToOverlay(vx, vy, vz, dims, rotation, zoom, width, height) {
  const rx = (rotation.x * Math.PI) / 180;
  const ry = (rotation.y * Math.PI) / 180;
  const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
  const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
  const maxDim = Math.max(dims.sagittal, dims.coronal, dims.axial);
  let px = vx - dims.sagittal / 2;
  let py = vy - dims.coronal / 2;
  let pz = vz - dims.axial / 2;
  let t = px * cosRy - pz * sinRy; pz = px * sinRy + pz * cosRy; px = t;
  t = py * cosRx + pz * sinRx; pz = -py * sinRx + pz * cosRx; py = t;
  return { x: (px * zoom / maxDim + 0.5) * width, y: (py * zoom / maxDim + 0.5) * height, z: pz };
}

function useMprVolumeCache(imageStack, dimensions) {
  const cacheKey = useMemo(() => getMprVolumeCacheKey(imageStack), [imageStack]);
  const [cacheState, setCacheState] = useState({ key: '', status: 'idle', cache: null });

  useEffect(() => {
    if (!cacheKey || imageStack.length === 0) {
      setCacheState({ key: '', status: 'idle', cache: null });
      return undefined;
    }
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      setCacheState({ key: cacheKey, status: 'idle', cache: null });
      return undefined;
    }

    const cached = mprVolumeCacheStore.get(cacheKey);
    if (cached) {
      setCacheState({ key: cacheKey, status: 'ready', cache: cached });
      return undefined;
    }

    let cancelled = false;
    setCacheState({ key: cacheKey, status: 'loading', cache: null });
    buildMprVolumeCache(cacheKey, imageStack, dimensions).then((cache) => {
      if (cancelled) return;
      if (!cache) {
        setCacheState({ key: cacheKey, status: 'error', cache: null });
        return;
      }
      rememberMprVolumeCache(cacheKey, cache);
      setCacheState({ key: cacheKey, status: 'ready', cache });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, dimensions, imageStack]);

  return cacheState;
}

function applyDisplayWindowToCanvasContext(ctx, width, height, displayWindow, displayDomain) {
  const domain = getNormalizedDisplayDomain(displayDomain);
  const windowRange = normalizeDisplayWindow(displayWindow, domain);
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const domainSpan = Math.max(Number.EPSILON, domain.max - domain.min);
  const displaySpan = Math.max(Number.EPSILON, windowRange.max - windowRange.min);

  for (let i = 0; i < data.length; i += 4) {
    const intensity = (data[i] * 0.2126) + (data[i + 1] * 0.7152) + (data[i + 2] * 0.0722);
    const sourceValue = domain.min + ((intensity / 255) * domainSpan);
    const clipped = Math.min(windowRange.max, Math.max(windowRange.min, sourceValue));
    const normalized = Math.round(((clipped - windowRange.min) / displaySpan) * 255);
    data[i] = normalized;
    data[i + 1] = normalized;
    data[i + 2] = normalized;
  }
  ctx.putImageData(imageData, 0, 0);
}

function MprWindowedImage({
  src,
  alt,
  className,
  draggable = false,
  onDragStart,
  style,
  displayWindow,
  displayDomain,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return undefined;
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      return undefined;
    }
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return undefined;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      applyDisplayWindowToCanvasContext(ctx, width, height, displayWindow, displayDomain);
    };
    image.onerror = () => {
      if (cancelled) return;
      canvas.width = 1;
      canvas.height = 1;
      ctx.clearRect(0, 0, 1, 1);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [displayDomain, displayWindow, src]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={alt}
      draggable={draggable}
      onDragStart={onDragStart}
      style={style}
      data-display-window={`${formatWindowValue(displayWindow?.min ?? 0)}-${formatWindowValue(displayWindow?.max ?? 255)}`}
      data-display-domain={`${formatWindowValue(displayDomain?.min ?? 0)}-${formatWindowValue(displayDomain?.max ?? 255)}`}
    />
  );
}

function DisplayWindowControl({ displayWindow, displayDomain, onChange }) {
  const domain = getNormalizedDisplayDomain(displayDomain);
  const normalizedWindow = normalizeDisplayWindow(displayWindow, domain);
  const [draftValues, setDraftValues] = useState({
    min: formatWindowValue(normalizedWindow.min),
    max: formatWindowValue(normalizedWindow.max),
  });

  useEffect(() => {
    setDraftValues({
      min: formatWindowValue(normalizedWindow.min),
      max: formatWindowValue(normalizedWindow.max),
    });
  }, [normalizedWindow.max, normalizedWindow.min]);

  const updateWindow = useCallback((patch) => {
    onChange((previous) => normalizeDisplayWindow({ ...previous, ...patch }, domain, normalizedWindow));
  }, [domain, normalizedWindow, onChange]);

  const handleTextChange = (edge, value) => {
    setDraftValues((previous) => ({ ...previous, [edge]: value }));
    if (value.trim() === '') return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    updateWindow({ [edge]: numeric });
  };

  const handleTextBlur = () => {
    setDraftValues({
      min: formatWindowValue(normalizedWindow.min),
      max: formatWindowValue(normalizedWindow.max),
    });
  };

  const minPercent = getWindowPercent(normalizedWindow.min, domain);
  const maxPercent = getWindowPercent(normalizedWindow.max, domain);

  return (
    <fieldset
      className="pt3-window-control"
      style={{
        '--window-min-percent': `${minPercent}%`,
        '--window-max-percent': `${maxPercent}%`,
      }}
    >
      <legend>Display window</legend>
      <div className="pt3-window-range-control" data-testid="display-window-slider">
        <div className="pt3-window-range-track" aria-hidden="true">
          <span className="pt3-window-range-fill" />
        </div>
        <input
          type="range"
          aria-label="Display window minimum handle"
          min={domain.min}
          max={domain.max}
          step={domain.step}
          value={normalizedWindow.min}
          onChange={(event) => updateWindow({ min: Number(event.target.value) })}
        />
        <input
          type="range"
          aria-label="Display window maximum handle"
          min={domain.min}
          max={domain.max}
          step={domain.step}
          value={normalizedWindow.max}
          onChange={(event) => updateWindow({ max: Number(event.target.value) })}
        />
      </div>
      <div className="pt3-window-number-row">
        <label htmlFor="mpr-window-min">
          Min
          <input
            id="mpr-window-min"
            type="number"
            aria-label="Display window minimum"
            min={domain.min}
            max={domain.max}
            step={domain.step}
            value={draftValues.min}
            onChange={(event) => handleTextChange('min', event.target.value)}
            onBlur={handleTextBlur}
          />
        </label>
        <label htmlFor="mpr-window-max">
          Max
          <input
            id="mpr-window-max"
            type="number"
            aria-label="Display window maximum"
            min={domain.min}
            max={domain.max}
            step={domain.step}
            value={draftValues.max}
            onChange={(event) => handleTextChange('max', event.target.value)}
            onBlur={handleTextBlur}
          />
        </label>
      </div>
      <span className="pt3-window-domain">
        {formatWindowValue(domain.min)}-{formatWindowValue(domain.max)} {domain.label}
      </span>
    </fieldset>
  );
}

function MprSliceCanvas({ axis, volumeCache, volumeCacheStatus, slicePosition, dimensions, displayWindow, displayDomain }) {
  const canvasRef = useRef(null);
  const relevantSlicePosition = slicePosition[axis];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !volumeCache) return undefined;
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      return undefined;
    }
    const safeGetContext = () => {
      try {
        return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      } catch (_) {
        return null;
      }
    };
    const ctx = safeGetContext();
    if (!ctx) return undefined;

    const sliceCanvas = getCachedMprSliceCanvas(axis, slicePosition, dimensions, volumeCache);
    if (!sliceCanvas) return undefined;
    canvas.width = sliceCanvas.width || 1;
    canvas.height = sliceCanvas.height || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sliceCanvas, 0, 0, canvas.width, canvas.height);
    applyDisplayWindowToCanvasContext(ctx, canvas.width, canvas.height, displayWindow, displayDomain);
    return undefined;
  }, [axis, dimensions, displayDomain, displayWindow, relevantSlicePosition, slicePosition, volumeCache]);

  return (
    <canvas
      ref={canvasRef}
      className="mpr-slice-canvas"
      aria-hidden="true"
      data-volume-cache-status={volumeCacheStatus}
      data-display-window={`${formatWindowValue(displayWindow?.min ?? 0)}-${formatWindowValue(displayWindow?.max ?? 255)}`}
      data-display-domain={`${formatWindowValue(displayDomain?.min ?? 0)}-${formatWindowValue(displayDomain?.max ?? 255)}`}
    />
  );
}

function safeDecodeFilename(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

function getLatestRunFromMetadata(part, key) {
  const runs = part?.metadata?.[key];
  if (!Array.isArray(runs) || runs.length === 0) return null;
  return runs[runs.length - 1];
}

function getOverlayLayers(part) {
  const overlays = part?.metadata?.overlay_layers;
  if (Array.isArray(overlays) && overlays.length > 0) {
    return overlays
      .filter((overlay) => overlay && overlay.id && !overlay.overlay_delete_candidate && !overlay.delete_candidate)
      .map((overlay) => ({
        id: String(overlay.id),
        label: overlay.label || String(overlay.id),
        color: overlay.color || '#64748b',
      }));
  }
  return DEFAULT_OVERLAY_LAYERS;
}

function clampRange(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeInspectorHotkeys(candidate) {
  const normalized = { ...DEFAULT_INSPECTOR_HOTKEYS };
  if (!candidate || typeof candidate !== 'object') return normalized;
  Object.entries(DEFAULT_INSPECTOR_HOTKEYS).forEach(([binding, fallback]) => {
    const raw = typeof candidate[binding] === 'string' ? candidate[binding].trim().toLowerCase() : fallback;
    normalized[binding] = /^[a-z0-9]$/.test(raw) ? raw : fallback;
  });
  return normalized;
}

function normalizePanelDimension(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizePanelLayout(candidate) {
  const safeCandidate = candidate && typeof candidate === 'object' ? candidate : {};
  return PANEL_LAYOUT_KEYS.reduce((acc, key) => {
    const defaults = DEFAULT_PANEL_LAYOUT[key];
    const current = safeCandidate[key] && typeof safeCandidate[key] === 'object' ? safeCandidate[key] : {};
    const orientation = String(current.orientation || defaults.orientation).toLowerCase();
    acc[key] = {
      is_open: current.is_open !== false,
      width_px: normalizePanelDimension(current.width_px, 220, 1200, defaults.width_px),
      height_px: normalizePanelDimension(current.height_px, 220, 1400, defaults.height_px),
      orientation: orientation === 'horizontal' ? 'horizontal' : 'vertical',
    };
    return acc;
  }, {});
}

function normalizeLayoutNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback;
}

function normalizeInspectionRegion(regionKey, candidate = {}) {
  const defaults = DEFAULT_INTERFACE_HIERARCHY.inspection.regions[regionKey] || {};
  return {
    ...defaults,
    ...candidate,
    label: String(candidate.label || defaults.label || regionKey),
    order: normalizeLayoutNumber(candidate.order, defaults.order || 1),
    isOpen: candidate.isOpen !== false,
    widthPx: candidate.widthPx == null ? defaults.widthPx : normalizeLayoutNumber(candidate.widthPx, defaults.widthPx),
    minWidthPx: candidate.minWidthPx == null ? defaults.minWidthPx : normalizeLayoutNumber(candidate.minWidthPx, defaults.minWidthPx),
    maxWidthPx: candidate.maxWidthPx == null ? defaults.maxWidthPx : normalizeLayoutNumber(candidate.maxWidthPx, defaults.maxWidthPx),
    heightPx: candidate.heightPx == null ? defaults.heightPx : normalizeLayoutNumber(candidate.heightPx, defaults.heightPx),
    minHeightPx: candidate.minHeightPx == null ? defaults.minHeightPx : normalizeLayoutNumber(candidate.minHeightPx, defaults.minHeightPx),
    maxHeightPx: candidate.maxHeightPx == null ? defaults.maxHeightPx : normalizeLayoutNumber(candidate.maxHeightPx, defaults.maxHeightPx),
  };
}

function normalizeInspectionHierarchy(hierarchy) {
  const safeHierarchy = hierarchy && typeof hierarchy === 'object' ? hierarchy : {};
  const defaultInspection = DEFAULT_INTERFACE_HIERARCHY.inspection;
  const mergedRegions = {
    ...defaultInspection.regions,
    ...(safeHierarchy.regions || {}),
  };
  const regions = Object.entries(mergedRegions).reduce((acc, [regionKey, region]) => {
    acc[regionKey] = normalizeInspectionRegion(regionKey, region);
    return acc;
  }, {});
  const centerTabs = Array.isArray(safeHierarchy.centerTabs) && safeHierarchy.centerTabs.length > 0
    ? safeHierarchy.centerTabs
    : defaultInspection.centerTabs;
  const layout = {
    ...defaultInspection.layout,
    ...(safeHierarchy.layout || {}),
  };

  return {
    leftColumn: safeHierarchy.leftColumn || defaultInspection.leftColumn,
    centerTabs: centerTabs
      .filter((tabKey) => regions[tabKey]?.isOpen !== false)
      .sort((left, right) => (regions[left]?.order || 1) - (regions[right]?.order || 1)),
    rightColumn: safeHierarchy.rightColumn || defaultInspection.rightColumn,
    layout: {
      ...layout,
      gapPx: normalizeLayoutNumber(layout.gapPx, defaultInspection.layout.gapPx),
      minHeightPx: normalizeLayoutNumber(layout.minHeightPx, defaultInspection.layout.minHeightPx),
      collapseBreakpointPx: normalizeLayoutNumber(
        layout.collapseBreakpointPx,
        defaultInspection.layout.collapseBreakpointPx,
      ),
    },
    regions,
  };
}

function getInspectionPaneWeight(region, fallback) {
  return normalizeLayoutNumber(region?.widthPx ?? region?.minWidthPx, fallback);
}

function createInspectionTab(tabKey, region, fallbackLabel) {
  return {
    type: 'tab',
    id: `inspection-tab-${tabKey}`,
    name: region?.label || fallbackLabel || tabKey,
    component: tabKey,
    enableClose: false,
    enableRename: false,
  };
}

function createInspectionFlexLayoutModel({
  inspectionHierarchy,
  leftRegion,
  inspectorRegion,
  rightRegion,
  inspectionLayoutCollapsed,
}) {
  const leftWeight = getInspectionPaneWeight(leftRegion, 320);
  const centerWeight = getInspectionPaneWeight(inspectorRegion, FLEX_LAYOUT_CENTER_WEIGHT_PX);
  const rightWeight = getInspectionPaneWeight(rightRegion, 360);

  return Model.fromJson({
    global: {
      rootOrientationVertical: inspectionLayoutCollapsed,
      splitterSize: RESIZE_HANDLE_WIDTH_PX,
      splitterExtra: 4,
      tabEnableClose: false,
      tabEnableRename: false,
      tabEnablePopout: false,
      tabSetEnableClose: false,
      tabSetEnableDeleteWhenEmpty: false,
      tabSetEnableMaximize: false,
      tabSetEnableTabStrip: true,
      tabSetTabLocation: 'top',
    },
    borders: [],
    layout: {
      type: 'row',
      id: 'inspection-root-layout',
      weight: 100,
      children: [
        {
          type: 'tabset',
          id: INSPECTION_FLEX_TABSET_IDS.left,
          weight: leftWeight,
          minWidth: normalizeLayoutNumber(leftRegion?.minWidthPx, RESIZABLE_COLUMN_MIN_PX),
          maxWidth: normalizeLayoutNumber(leftRegion?.maxWidthPx, 1200),
          minHeight: normalizeLayoutNumber(leftRegion?.minHeightPx, 220),
          children: [
            createInspectionTab(inspectionHierarchy.leftColumn, leftRegion, 'Part Summary'),
          ],
        },
        {
          type: 'tabset',
          id: INSPECTION_FLEX_TABSET_IDS.center,
          weight: centerWeight,
          minWidth: normalizeLayoutNumber(inspectorRegion?.minWidthPx, 560),
          minHeight: normalizeLayoutNumber(inspectorRegion?.minHeightPx, 320),
          children: inspectionHierarchy.centerTabs.map((tabKey) => (
            createInspectionTab(tabKey, inspectionHierarchy.regions[tabKey], tabKey)
          )),
        },
        {
          type: 'tabset',
          id: INSPECTION_FLEX_TABSET_IDS.right,
          weight: rightWeight,
          minWidth: normalizeLayoutNumber(rightRegion?.minWidthPx, RESIZABLE_COLUMN_MIN_PX),
          maxWidth: normalizeLayoutNumber(rightRegion?.maxWidthPx, 1200),
          minHeight: normalizeLayoutNumber(rightRegion?.minHeightPx, 220),
          children: [
            createInspectionTab(inspectionHierarchy.rightColumn, rightRegion, 'Annotations'),
          ],
        },
      ],
    },
  });
}

function normalizeInspectionColumnWidths(candidate = {}) {
  const leftRaw = Number(candidate.left_px ?? candidate.leftPx);
  const rightRaw = Number(candidate.right_px ?? candidate.rightPx);
  return {
    leftPx: Number.isFinite(leftRaw) && leftRaw > 0 ? Math.round(leftRaw) : null,
    rightPx: Number.isFinite(rightRaw) && rightRaw > 0 ? Math.round(rightRaw) : null,
  };
}


function getAnnotationTooltip(annotation) {
  if (!annotation || typeof annotation !== 'object') return '';
  const details = [];
  const type = getAnnotationListType(annotation);
  const value = getAnnotationListValue(annotation);
  if (type) details.push(type);
  if (value) details.push(value);
  const createdAt = formatAnnotationTimestamp(getAnnotationCreatedAt(annotation));
  if (createdAt) details.push(`Created: ${createdAt}`);
  details.push(`By: ${getAnnotationCreator(annotation)}`);
  return details.join(' • ');
}

function getAnnotationCreator(annotation) {
  const creator = String(annotation?.created_by || annotation?.createdBy || '').trim();
  if (creator) return creator;
  const updatedBy = String(annotation?.updated_by || annotation?.updatedBy || '').trim();
  return updatedBy || 'Unknown user';
}

function getAnnotationCreatedAt(annotation) {
  return annotation?.created_at || annotation?.createdAt || annotation?.updated_at || annotation?.updatedAt || '';
}

function formatAnnotationTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function InspectionWorkbenchPanel({ projectId, projectType, hierarchy, launchFilters }) {
  const [batches, setBatches] = useState([]);
  const [parts, setParts] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [partFilter, setPartFilter] = useState('');
  const [sortMode, setSortMode] = useState('part_asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingPartId, setSavingPartId] = useState(null);
  const [slicePosition, setSlicePosition] = useState({ axial: 0, coronal: 0, sagittal: 0 });
  const [viewportTransform, setViewportTransform] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [activeMprPane, setActiveMprPane] = useState('axial');
  const [mprRotation, setMprRotation] = useState({ x: -22, y: 32 });
  const [mprReconstructionMode, setMprReconstructionMode] = useState(MPR_RECONSTRUCTION_MODES.orientation);
  const [mprProjectionMirror, setMprProjectionMirror] = useState(DEFAULT_MPR_PROJECTION_MIRROR);
  const [activeWorkbenchModal, setActiveWorkbenchModal] = useState(null);
  const [segmentationHelperOpen, setSegmentationHelperOpen] = useState(false);
  const [segmentationHelperAxis, setSegmentationHelperAxis] = useState('axial');
  const [segmentationSegments, setSegmentationSegments] = useState(() => [createDefaultSegment(0)]);
  const [selectedSegmentationSegmentId, setSelectedSegmentationSegmentId] = useState('');
  const [editingSegmentationSegmentId, setEditingSegmentationSegmentId] = useState('');
  const [segmentationTool, setSegmentationTool] = useState('brush');
  const [segmentationOperation, setSegmentationOperation] = useState('add');
  const [segmentationBrushSize, setSegmentationBrushSize] = useState(18);
  const [segmentationSensitivity, setSegmentationSensitivity] = useState(28);
  const [segmentationPendingSelection, setSegmentationPendingSelection] = useState(null);
  const [segmentationDraftShape, setSegmentationDraftShape] = useState(null);
  const [segmentationPointerPreview, setSegmentationPointerPreview] = useState(null);
  const [segmentationMlGroup, setSegmentationMlGroup] = useState('opencv');
  const [segmentationMlMethod, setSegmentationMlMethod] = useState('segmentation.connected_components');
  const [segmentationMlParameters, setSegmentationMlParameters] = useState(() => getDefaultSegmentationMlParameters('segmentation.connected_components'));
  const [segmentationMlStatus, setSegmentationMlStatus] = useState('');
  const [segmentationMlLoading, setSegmentationMlLoading] = useState(false);
  const [displayWindow, setDisplayWindow] = useState({ min: 0, max: 255 });
  const [activeOverlayIds, setActiveOverlayIds] = useState([]);
  const [cursorProbe, setCursorProbe] = useState({ x: 50, y: 50 });
  const [segmentationRun, setSegmentationRun] = useState(null);
  const [measurementRun, setMeasurementRun] = useState(null);
  const [mlActionLoading, setMlActionLoading] = useState({ segmentation: false, measurement: false });
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const [workspaceHydration, setWorkspaceHydration] = useState({});
  const [enabledModalities, setEnabledModalities] = useState([]);
  const [selectedViewName, setSelectedViewName] = useState('');
  const [hiddenViewNames, setHiddenViewNames] = useState([]);
  const [renderCategories, setRenderCategories] = useState(['source', 'overlay']);
  const [tileColumnCount, setTileColumnCount] = useState(3);
  const [imageEnabled, setImageEnabled] = useState(true);
  const [measurementEntries, setMeasurementEntries] = useState([]);
  const [inspectorViewport, setInspectorViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [annotations, setAnnotations] = useState([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState({
    defect_class: '',
    modality: '',
    comment: '',
    disposition: 'open',
    measurement_name: '',
    measurement_value: '',
    bbox: { x: '', y: '', width: '', height: '' },
  });
  const [annotationToolMode, setAnnotationToolMode] = useState('');
  const [otherAnnotationModalVisible, setOtherAnnotationModalVisible] = useState(false);
  const [annotationEditModalVisible, setAnnotationEditModalVisible] = useState(false);
  const [annotationEditDraft, setAnnotationEditDraft] = useState(null);
  const customDefectTypeDraft = '';
  const [tileAnnotationDraft, setTileAnnotationDraft] = useState(null);
  const [tileAnnotationPreview, setTileAnnotationPreview] = useState(null);
  const [inspectorHotkeys, setInspectorHotkeys] = useState(DEFAULT_INSPECTOR_HOTKEYS);
  const [projectConfiguration, setProjectConfiguration] = useState(null);
  const [projectMetadata, setProjectMetadata] = useState({});
  const [inspectionColumnWidths, setInspectionColumnWidths] = useState(DEFAULT_INSPECTION_COLUMN_WIDTHS);
  const [shortcutHelpVisible, setShortcutHelpVisible] = useState(false);
  const [panelLayout, setPanelLayout] = useState(DEFAULT_PANEL_LAYOUT);
  const [normalizationTriageField, setNormalizationTriageField] = useState('');
  const [selectedImageRef, setSelectedImageRef] = useState('');
  const [projectImageLookup, setProjectImageLookup] = useState({});
  const [deletingOverlayId, setDeletingOverlayId] = useState('');
  const [fullscreenImageModal, setFullscreenImageModal] = useState(null);
  const [fullscreenMeasureActive, setFullscreenMeasureActive] = useState(false);
  const [fullscreenBoxActive, setFullscreenBoxActive] = useState(false);
  const [fullscreenMeasurements, setFullscreenMeasurements] = useState([]);
  const [fullscreenCalibrationPromptVisible, setFullscreenCalibrationPromptVisible] = useState(false);
  const [fullscreenHoveredEndpoint, setFullscreenHoveredEndpoint] = useState(null);
  const [fullscreenEditingEndpoint, setFullscreenEditingEndpoint] = useState(null);
  const [fullscreenHoveredBoxCorner, setFullscreenHoveredBoxCorner] = useState(null);
  const [fullscreenEditingBoxCorner, setFullscreenEditingBoxCorner] = useState(null);
  const [fullscreenZoomLens, setFullscreenZoomLens] = useState(null);
  const [fullscreenZoomScale, setFullscreenZoomScale] = useState(MEASUREMENT_LOCAL_ZOOM_SCALE);
  const [fullscreenImageZoom, setFullscreenImageZoom] = useState({ scale: 1, originX: 50, originY: 50, panX: 0, panY: 0 });
  const [fullscreenImagePanning, setFullscreenImagePanning] = useState(false);
  const [sessionCalibrationByImageId, setSessionCalibrationByImageId] = useState({});
  const configuredDefectTypes = useMemo(() => (Array.isArray(projectConfiguration?.defect_types) ? projectConfiguration.defect_types
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean) : []), [projectConfiguration]);
  const measurementLinesByImageId = useMemo(() => getMeasurementLinesByImageId(annotations), [annotations]);
  const boxAnnotationsByImageId = useMemo(() => getBoxAnnotationsByImageId(annotations), [annotations]);
  const mprMeasurementLinesBySlice = useMemo(() => getMprMeasurementLinesBySlice(annotations), [annotations]);
  const mprBoxAnnotationsBySlice = useMemo(() => getMprBoxAnnotationsBySlice(annotations), [annotations]);
  const mprCubeAnnotations = useMemo(() => getMprCubeAnnotations(annotations), [annotations]);
  const selectedSegmentationSegment = useMemo(() => (
    segmentationSegments.find((segment) => segment.id === selectedSegmentationSegmentId) || segmentationSegments[0] || null
  ), [selectedSegmentationSegmentId, segmentationSegments]);
  const [pendingMeasurePoint, setPendingMeasurePoint] = useState(null);
  const [pendingBoxPoint, setPendingBoxPoint] = useState(null);
  const [mprAnnotationDraft, setMprAnnotationDraft] = useState(null);
  const [mprAnnotationPreview, setMprAnnotationPreview] = useState(null);
  const [fullscreenAnnotationPreview, setFullscreenAnnotationPreview] = useState(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
  ));
  const [workbenchWidth, setWorkbenchWidth] = useState(0);
  const [manualFilterNotice, setManualFilterNotice] = useState('');
  const workbenchDetailsRef = useRef(null);
  const inspectionResizeSaveTimerRef = useRef(null);
  const mprDragRef = useRef(null);
  const tileAnnotationDraftRef = useRef(null);
  const mprAnnotationDraftRef = useRef(null);
  const segmentationDraftRef = useRef(null);
  const segmentationMlCacheRef = useRef(new Map());
  const pendingMeasurePointRef = useRef(null);
  const pendingBoxPointRef = useRef(null);
  const fullscreenImageRef = useRef(null);
  const fullscreenPanDragRef = useRef(null);
  const suppressNextTileClickRef = useRef(false);
  const mprOverlayCanvasRef = useRef(null);

  const inspectionHierarchy = useMemo(() => {
    const normalized = normalizeInspectionHierarchy(hierarchy || {});
    if (projectType !== 'PT3' || normalized.centerTabs.includes('mpr')) {
      return normalized;
    }
    return {
      ...normalized,
      centerTabs: ['mpr', ...normalized.centerTabs],
      regions: {
        ...normalized.regions,
        mpr: normalizeInspectionRegion('mpr', DEFAULT_INTERFACE_HIERARCHY.inspection.regions.mpr),
      },
    };
  }, [hierarchy, projectType]);

  useEffect(() => {
    if (segmentationSegments.length === 0) {
      const firstSegment = createDefaultSegment(0);
      setSegmentationSegments([firstSegment]);
      setSelectedSegmentationSegmentId(firstSegment.id);
      setEditingSegmentationSegmentId(firstSegment.id);
      return;
    }
    if (!selectedSegmentationSegmentId || !segmentationSegments.some((segment) => segment.id === selectedSegmentationSegmentId)) {
      setSelectedSegmentationSegmentId(segmentationSegments[0].id);
    }
  }, [selectedSegmentationSegmentId, segmentationSegments]);
  const leftRegion = inspectionHierarchy.regions[inspectionHierarchy.leftColumn];
  const rightRegion = inspectionHierarchy.regions[inspectionHierarchy.rightColumn];
  const inspectorRegion = inspectionHierarchy.regions.inspector;
  const availableLayoutWidth = workbenchWidth > 0 ? workbenchWidth : viewportWidth;
  const inspectionLayoutCollapsed = projectType !== 'PT3'
    && availableLayoutWidth <= inspectionHierarchy.layout.collapseBreakpointPx;
  const minSideColumnWidthPx = Math.max(120, Math.round(availableLayoutWidth * 0.05));
  const defaultLeftColumnWidthPx = Math.max(220, Math.round(normalizeLayoutNumber(leftRegion?.widthPx ?? leftRegion?.minWidthPx, 220) * 0.5));
  const defaultRightColumnWidthPx = Math.max(220, Math.round(normalizeLayoutNumber(rightRegion?.widthPx ?? rightRegion?.minWidthPx, 220) * 0.5));
  const configuredLeftColumnWidthPx = inspectionColumnWidths.leftPx ?? defaultLeftColumnWidthPx;
  const configuredRightColumnWidthPx = inspectionColumnWidths.rightPx ?? defaultRightColumnWidthPx;
  const inspectionFlexLayoutModel = useMemo(() => createInspectionFlexLayoutModel({
    inspectionHierarchy: {
      ...inspectionHierarchy,
      regions: {
        ...inspectionHierarchy.regions,
        [inspectionHierarchy.leftColumn]: {
          ...leftRegion,
          widthPx: configuredLeftColumnWidthPx,
          minWidthPx: minSideColumnWidthPx,
        },
        [inspectionHierarchy.rightColumn]: {
          ...rightRegion,
          widthPx: configuredRightColumnWidthPx,
          minWidthPx: minSideColumnWidthPx,
        },
      },
    },
    leftRegion: {
      ...leftRegion,
      widthPx: configuredLeftColumnWidthPx,
      minWidthPx: minSideColumnWidthPx,
    },
    inspectorRegion,
    rightRegion: {
      ...rightRegion,
      widthPx: configuredRightColumnWidthPx,
      minWidthPx: minSideColumnWidthPx,
    },
    inspectionLayoutCollapsed,
  }), [
    configuredLeftColumnWidthPx,
    configuredRightColumnWidthPx,
    inspectionHierarchy,
    inspectionLayoutCollapsed,
    inspectorRegion,
    leftRegion,
    minSideColumnWidthPx,
    rightRegion,
  ]);
  const workbenchFlexLayoutStyle = {
    '--inspection-grid-template-columns': inspectionLayoutCollapsed
      ? '1fr'
      : `${configuredLeftColumnWidthPx}px minmax(0, 1fr) ${configuredRightColumnWidthPx}px`,
    '--inspection-layout-gap': `${inspectionHierarchy.layout.gapPx}px`,
    '--inspection-layout-min-height': inspectionLayoutCollapsed ? '520px' : `${inspectionHierarchy.layout.minHeightPx}px`,
  };

  useEffect(() => {
    const loadWorkbenchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [batchResp, partResp, workspaceResp, configResp, metadataResp, imageResp] = await Promise.all([
          fetch(`/api/projects/${projectId}/batches`),
          fetch(`/api/projects/${projectId}/parts`),
          fetch(`/api/projects/${projectId}/workspace-state`),
          fetch(`/api/projects/${projectId}/configuration`),
          fetch(`/api/projects/${projectId}/metadata-dict`),
          fetch(`/api/projects/${projectId}/images?include_deleted=true&limit=5000`),
        ]);
        if (!batchResp.ok) {
          throw new Error(`Failed to load batches (${batchResp.status})`);
        }
        if (!partResp.ok) {
          throw new Error(`Failed to load parts (${partResp.status})`);
        }

        const [batchData, partData, workspaceData, configData, metadataData, imageData] = await Promise.all([
          batchResp.json(),
          partResp.json(),
          workspaceResp.ok ? workspaceResp.json() : Promise.resolve({ state: {} }),
          configResp.ok ? configResp.json() : Promise.resolve({}),
          metadataResp.ok ? metadataResp.json() : Promise.resolve({}),
          imageResp.ok ? imageResp.json() : Promise.resolve([]),
        ]);
        const safeBatches = Array.isArray(batchData) ? batchData : [];
        const safeParts = Array.isArray(partData) ? partData : [];
        const savedState = workspaceData?.state && typeof workspaceData.state === 'object' ? workspaceData.state : {};
        setPanelLayout(normalizePanelLayout(savedState.panel_layout));
        const resolvedConfig = configData?.config && typeof configData.config === 'object' ? configData.config : {};
        setProjectConfiguration(resolvedConfig);
        setProjectMetadata(metadataData && typeof metadataData === 'object' ? metadataData : {});
        setInspectionColumnWidths(normalizeInspectionColumnWidths(resolvedConfig?.inspection_layout?.column_widths));
        const savedHotkeys = normalizeInspectorHotkeys(
          resolvedConfig?.process_settings?.configurable_hotkeys,
        );
        setInspectorHotkeys(savedHotkeys);
        setWorkspaceHydration(savedState);
        setBatches(safeBatches);
        setParts(safeParts);
        const imageLookup = (Array.isArray(imageData) ? imageData : []).reduce((acc, image) => {
          const filename = String(image?.filename || '');
          const id = image?.id ? String(image.id) : '';
          if (filename) acc[filename] = image;
          if (id) acc[id] = image;
          return acc;
        }, {});
        setProjectImageLookup(imageLookup);
        const savedBatchId = String(savedState.selected_batch_id || '');
        setSelectedBatchId(savedBatchId);
        const savedReviewFilter = String(savedState.review_filter || 'all');
        setReviewFilter(['all', 'pass', 'reject_pending', 'reject_confirmed', 'none', 'manual'].includes(savedReviewFilter) ? savedReviewFilter : 'all');
        setPartFilter(String(savedState.part_filter || ''));
        const savedSortMode = String(savedState.sort_mode || 'part_asc');
        setSortMode(['part_asc', 'batch_asc', 'status_asc', 'defect_desc'].includes(savedSortMode) ? savedSortMode : 'part_asc');
        const savedPartId = String(savedState.selected_part_id || '');
        const selectedFromSaved = safeParts.find((part) => part.id === savedPartId);
        if (selectedFromSaved) {
          setSelectedPartId(selectedFromSaved.id);
        } else if (safeParts.length > 0) {
          setSelectedPartId(safeParts[0].id);
        }
      } catch (err) {
        setError(err.message || 'Failed to load inspection workbench data');
      } finally {
        setWorkspaceStateLoaded(true);
        setLoading(false);
      }
    };

    loadWorkbenchData();
  }, [projectId]);

  useEffect(() => {
    if (!launchFilters || typeof launchFilters !== 'object') return;
    if (String(launchFilters.selected_batch_id || '').trim()) {
      setSelectedBatchId(String(launchFilters.selected_batch_id));
    }
    if (String(launchFilters.review_filter || '').trim()) {
      setReviewFilter(String(launchFilters.review_filter));
    }
    if (launchFilters.review_filter === 'manual') {
      const batchName = String(launchFilters.source_batch_name || '').trim();
      setManualFilterNotice(
        batchName
          ? `Manual filter applied from Batches tab for ${batchName}.`
          : 'Manual filter applied from Batches tab.',
      );
    }
  }, [launchFilters]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const container = workbenchDetailsRef.current;
    if (!container) return undefined;

    const updateWorkbenchWidth = () => {
      const measuredWidth = Math.floor(container.getBoundingClientRect().width);
      setWorkbenchWidth(Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 0);
    };
    updateWorkbenchWidth();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateWorkbenchWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (inspectionResizeSaveTimerRef.current) {
      window.clearTimeout(inspectionResizeSaveTimerRef.current);
    }
  }, []);

  const getCalibrationForImage = useCallback((imageId) => {
    const key = String(imageId || '');
    return resolveMeasurementCalibration(
      projectMetadata,
      projectImageLookup[key],
      projectConfiguration,
      sessionCalibrationByImageId[key],
    );
  }, [projectConfiguration, projectImageLookup, projectMetadata, sessionCalibrationByImageId]);

  const handleFullscreenCalibrationChange = useCallback((calibration) => {
    if (!fullscreenImageModal?.imageId || !isValidCalibration(calibration)) return;
    const imageId = String(fullscreenImageModal.imageId);
    setSessionCalibrationByImageId((prev) => ({ ...prev, [imageId]: calibration }));
    setProjectMetadata((prev) => ({
      ...(prev && typeof prev === 'object' ? prev : {}),
      calibration_default: prev?.calibration_default || calibration,
    }));
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenMeasureActive(true);
  }, [fullscreenImageModal?.imageId]);


  async function saveInspectionColumnWidths(columnWidths) {
    const nextConfig = {
      ...(projectConfiguration && typeof projectConfiguration === 'object' ? projectConfiguration : {}),
      inspection_layout: {
        ...((projectConfiguration && projectConfiguration.inspection_layout) || {}),
        column_widths: {
          left_px: Number.isFinite(columnWidths.leftPx) ? Math.round(columnWidths.leftPx) : null,
          right_px: Number.isFinite(columnWidths.rightPx) ? Math.round(columnWidths.rightPx) : null,
        },
      },
    };

    try {
      const resp = await fetch(`/api/projects/${projectId}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      });
      if (!resp.ok) throw new Error(`Failed to save inspection column widths (${resp.status})`);
      const payload = await resp.json();
      const persistedConfig = payload?.config && typeof payload.config === 'object' ? payload.config : nextConfig;
      setProjectConfiguration(persistedConfig);
    } catch (_) {
      // Best-effort persistence: keep interactive resize fluid even if save fails.
    }
  }


  const filteredParts = useMemo(() => {
    let output = [...parts];

    if (selectedBatchId) {
      output = output.filter((part) => part.batch_id === selectedBatchId);
    }
    if (reviewFilter !== 'all') {
      if (reviewFilter === 'manual') {
        output = output.filter((part) => part?.metadata?.manual_flagged === true);
      } else if (reviewFilter === 'none') {
        output = output.filter((part) => !part.review_state || part.review_state === 'unreviewed');
      } else {
        output = output.filter((part) => String(part.review_state || '').toLowerCase() === reviewFilter);
      }
    }
    if (partFilter.trim()) {
      const query = partFilter.trim().toLowerCase();
      output = output.filter((part) => {
        const candidate = `${part.display_name || ''} ${part.serial_number || ''} ${part.batch_id || ''}`.toLowerCase();
        return candidate.includes(query);
      });
    }
    if (normalizationTriageField) {
      output = output.filter((part) => hasDroppedMetadataField(part, normalizationTriageField));
    }

    if (sortMode === 'defect_desc') {
      output.sort((a, b) => getDefectCount(b) - getDefectCount(a));
    } else if (sortMode === 'batch_asc') {
      output.sort((a, b) => String(a.batch_id || '').localeCompare(String(b.batch_id || '')));
    } else if (sortMode === 'status_asc') {
      output.sort((a, b) => String(a.review_state || 'unreviewed').localeCompare(String(b.review_state || 'unreviewed')));
    } else {
      output.sort((a, b) => String(a.serial_number).localeCompare(String(b.serial_number)));
    }

    return output;
  }, [parts, selectedBatchId, reviewFilter, partFilter, normalizationTriageField, sortMode]);
  const normalizationTriageMatchCount = useMemo(() => {
    if (!normalizationTriageField) return 0;
    return parts.filter((part) => hasDroppedMetadataField(part, normalizationTriageField)).length;
  }, [parts, normalizationTriageField]);

  const selectedPart = useMemo(
    () => filteredParts.find((part) => part.id === selectedPartId) || filteredParts[0] || null,
    [filteredParts, selectedPartId],
  );
  const mprDimensions = useMemo(() => getMprDimensions(selectedPart), [selectedPart]);
  const displayValueDomain = useMemo(
    () => getPartDisplayValueDomain(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );

  useEffect(() => {
    const canvas = mprOverlayCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (activeMprPane !== 'volume') return;
    const dims = {
      sagittal: Math.max(1, mprDimensions.sagittal || 1),
      coronal: Math.max(1, mprDimensions.coronal || 1),
      axial: Math.max(1, mprDimensions.axial || 1),
    };
    const sx = slicePosition.sagittal;
    const sy = slicePosition.coronal;
    const sz = slicePosition.axial;
    const full = {
      axial: [[0, 0, sz], [dims.sagittal, 0, sz], [dims.sagittal, dims.coronal, sz], [0, dims.coronal, sz]],
      sagittal: [[sx, 0, 0], [sx, dims.coronal, 0], [sx, dims.coronal, dims.axial], [sx, 0, dims.axial]],
      coronal: [[0, sy, 0], [dims.sagittal, sy, 0], [dims.sagittal, sy, dims.axial], [0, sy, dims.axial]],
    };
    const [axX0, axX1] = getPlaneFocusRange(sx, dims.sagittal);
    const [axY0, axY1] = getPlaneFocusRange(sy, dims.coronal);
    const [sgY0, sgY1] = getPlaneFocusRange(sy, dims.coronal);
    const [sgZ0, sgZ1] = getPlaneFocusRange(sz, dims.axial);
    const [coX0, coX1] = getPlaneFocusRange(sx, dims.sagittal);
    const [coZ0, coZ1] = getPlaneFocusRange(sz, dims.axial);
    const focus = {
      axial: [[axX0, axY0, sz], [axX1, axY0, sz], [axX1, axY1, sz], [axX0, axY1, sz]],
      sagittal: [[sx, sgY0, sgZ0], [sx, sgY1, sgZ0], [sx, sgY1, sgZ1], [sx, sgY0, sgZ1]],
      coronal: [[coX0, sy, coZ0], [coX1, sy, coZ0], [coX1, sy, coZ1], [coX0, sy, coZ1]],
    };
    const drawOrder = MPR_AXES;
    drawOrder.forEach((axis) => {
      const color = MPR_AXIS_CONFIG[axis].color;
      const line = full[axis].map(([x, y, z]) => projectMprPointToOverlay(x, y, z, dims, mprRotation, viewportTransform.zoom, canvas.width, canvas.height));
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      line.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      const active = activeMprPane === axis ? axis : null;
      if (active) {
        const quad = focus[axis].map(([x, y, z]) => projectMprPointToOverlay(x, y, z, dims, mprRotation, viewportTransform.zoom, canvas.width, canvas.height));
        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        quad.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    });
  }, [activeMprPane, mprDimensions, mprRotation, slicePosition, viewportTransform.zoom]);
  const overlayLayers = useMemo(() => getOverlayLayers(selectedPart), [selectedPart]);
  const modalityOptions = useMemo(() => getModalities(selectedPart), [selectedPart]);
  const activeViewName = useMemo(() => {
    if (!selectedPart) return '';
    const configuredViews = getPartViews(selectedPart);
    if (selectedViewName && configuredViews.includes(selectedViewName)) {
      return selectedViewName;
    }
    return configuredViews[0] || '';
  }, [selectedPart, selectedViewName]);
  const selectedPartImageRefs = useMemo(() => {
    if (!selectedPart?.metadata || typeof selectedPart.metadata !== 'object') return [];
    return getPartImageRefs(selectedPart);
  }, [selectedPart]);
  const visibleSelectedPartImageRefs = useMemo(() => {
    const hidden = new Set(hiddenViewNames.map((name) => String(name).toLowerCase()));
    const enabled = new Set(enabledModalities.map((name) => String(name).toLowerCase()));
    return selectedPartImageRefs.filter((entry) => {
      const category = entry.overlay ? 'overlay' : 'source';
      if (!renderCategories.includes(category)) return false;
      if (hidden.has(String(entry.viewName || '').toLowerCase())) return false;
      const modality = String(entry.modality || '').toLowerCase();
      return !modality || modality === 'analyze-overlay' || enabled.has(modality);
    });
  }, [enabledModalities, hiddenViewNames, renderCategories, selectedPartImageRefs]);
  const tileColumnMax = Math.max(1, selectedPartImageRefs.length || visibleSelectedPartImageRefs.length || 1);
  const normalizedTileColumnCount = Math.round(clampRange(
    tileColumnCount,
    1,
    tileColumnMax,
    Math.min(3, tileColumnMax),
  ));
  const annotationSourceImageIdLookup = useMemo(
    () => getAnnotationSourceImageIdLookup(selectedPartImageRefs, projectImageLookup),
    [projectImageLookup, selectedPartImageRefs],
  );
  const getAnnotationSourceImageIdForImage = useCallback((imageId) => {
    const key = String(imageId || '');
    return annotationSourceImageIdLookup[key] || key;
  }, [annotationSourceImageIdLookup]);
  const selectedImageRecord = useMemo(() => {
    if (!selectedImageRef) return null;
    return projectImageLookup[selectedImageRef] || null;
  }, [projectImageLookup, selectedImageRef]);
  const volumeImageStack = useMemo(
    () => getVolumeSourceImages(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );
  const volumeCacheState = useMprVolumeCache(volumeImageStack, mprDimensions);
  const shellImageLayers = useMemo(
    () => getShellImageLayers(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );
  const volumePreviewLayers = useMemo(() => {
    if (volumeImageStack.length === 0) return [];
    const maxLayers = 12;
    const step = Math.max(1, Math.floor(volumeImageStack.length / maxLayers));
    return volumeImageStack
      .filter((_, index) => index % step === 0)
      .slice(0, maxLayers)
      .map((entry, index, entries) => ({
        ...entry,
        depth: entries.length <= 1 ? 0 : -48 + (index / (entries.length - 1)) * 96,
        opacity: entries.length <= 1 ? 0.86 : 0.18 + (index / (entries.length - 1)) * 0.26,
      }));
  }, [volumeImageStack]);
  const getMprAnnotationImage = useCallback((axis) => {
    if (axis === 'axial' && volumeImageStack.length > 0) {
      const target = slicePosition.axial;
      const match = volumeImageStack.find((entry) => Number(entry.sliceIndex) === Number(target)) || volumeImageStack[Math.min(target, volumeImageStack.length - 1)] || volumeImageStack[0];
      return match?.id || match?.imageId || selectedImageRef || null;
    }
    return selectedImageRef || (volumeImageStack[0]?.id || volumeImageStack[0]?.imageId || null);
  }, [selectedImageRef, slicePosition.axial, volumeImageStack]);

  const openMprAnnotationTool = useCallback((axis, mode) => {
    const imageId = getMprAnnotationImage(axis);
    if (!imageId) return;
    const sliceValue = slicePosition[axis];
    const axisLabel = (MPR_AXIS_CONFIG[axis]?.sliceLabel || axis).toUpperCase();
    setFullscreenImageModal({ imageId: String(imageId), label: `${MPR_AXIS_CONFIG[axis]?.label || axis.toUpperCase()} slice ${sliceValue}` });
    setFullscreenMeasureActive(mode === 'measure');
    setFullscreenBoxActive(mode === 'box');
    setFullscreenCalibrationPromptVisible(false);
    setAnnotationDraft((prev) => ({ ...prev, comment: `${mode === 'measure' ? 'Measurement' : 'Box'} on ${axisLabel} ${sliceValue}` }));
  }, [getMprAnnotationImage, slicePosition]);

  const canShowStackReconstruction = volumePreviewLayers.length > 0;
  const canShowShellReconstruction = shellImageLayers.length > 0;
  const effectiveMprReconstructionMode = (
    mprReconstructionMode === MPR_RECONSTRUCTION_MODES.stack && canShowStackReconstruction
  )
    ? MPR_RECONSTRUCTION_MODES.stack
    : (
      mprReconstructionMode === MPR_RECONSTRUCTION_MODES.shell && canShowShellReconstruction
    )
      ? MPR_RECONSTRUCTION_MODES.shell
      : MPR_RECONSTRUCTION_MODES.orientation;

  useEffect(() => {
    if (mprReconstructionMode !== effectiveMprReconstructionMode) {
      setMprReconstructionMode(effectiveMprReconstructionMode);
    }
  }, [effectiveMprReconstructionMode, mprReconstructionMode]);

  const tooltipValues = useMemo(() => {
    const domain = getNormalizedDisplayDomain(displayValueDomain);
    const activeWindow = normalizeDisplayWindow(displayWindow, domain);
    const axisSeed = slicePosition.axial + slicePosition.coronal + slicePosition.sagittal;
    const unitValue = Math.min(
      255,
      Math.max(0, Math.round(cursorProbe.x * 0.35 + cursorProbe.y * 0.65 + axisSeed)),
    );
    const sourceValue = domain.min + ((unitValue / 255) * (domain.max - domain.min));
    const windowRange = Math.max(Number.EPSILON, activeWindow.max - activeWindow.min);
    const base = Math.round(((Math.min(activeWindow.max, Math.max(activeWindow.min, sourceValue)) - activeWindow.min) / windowRange) * 255);
    const overlays = activeOverlayIds.map((overlayId, index) => {
      const value = Number((((base + (index + 1) * 17) / 255) * 100).toFixed(1));
      return { overlayId, value };
    });
    return { base, overlays };
  }, [activeOverlayIds, cursorProbe.x, cursorProbe.y, displayValueDomain, displayWindow, slicePosition]);

  useEffect(() => {
    if (selectedPart && selectedPart.id !== selectedPartId) {
      setSelectedPartId(selectedPart.id);
    }
  }, [selectedPart, selectedPartId]);

  useEffect(() => {
    if (selectedPartImageRefs.length === 0) return;
    if (tileColumnCount !== normalizedTileColumnCount) {
      setTileColumnCount(normalizedTileColumnCount);
    }
  }, [normalizedTileColumnCount, selectedPartImageRefs.length, tileColumnCount]);

  useEffect(() => {
    if (selectedPartImageRefs.length === 0) {
      setSelectedImageRef('');
      return;
    }
    const hasCurrentImage = selectedPartImageRefs.some((entry) => entry.imageRef === selectedImageRef);
    if (!hasCurrentImage) {
      setSelectedImageRef(selectedPartImageRefs[0].imageRef);
    }
  }, [selectedPartImageRefs, selectedImageRef]);

  useEffect(() => {
    if (!selectedPart || !['PT2', 'PT3'].includes(projectType)) return;
    const savedMpr = workspaceHydration?.mpr || {};
    const savedSlice = savedMpr?.slice_position || {};
    const savedViewport = savedMpr?.viewport_transform || {};
    const savedProbe = savedMpr?.cursor_probe || {};
    setSlicePosition({
      axial: clampRange(savedSlice.axial, 0, Math.max(0, mprDimensions.axial - 1), Math.floor((mprDimensions.axial - 1) / 2)),
      coronal: clampRange(savedSlice.coronal, 0, Math.max(0, mprDimensions.coronal - 1), Math.floor((mprDimensions.coronal - 1) / 2)),
      sagittal: clampRange(savedSlice.sagittal, 0, Math.max(0, mprDimensions.sagittal - 1), Math.floor((mprDimensions.sagittal - 1) / 2)),
    });
    setViewportTransform({
      zoom: clampRange(savedViewport.zoom, 0.5, 4, 1),
      panX: clampRange(savedViewport.panX, -200, 200, 0),
      panY: clampRange(savedViewport.panY, -200, 200, 0),
    });
    setMprReconstructionMode(
      Object.values(MPR_RECONSTRUCTION_MODES).includes(savedMpr.reconstruction_mode)
        ? savedMpr.reconstruction_mode
        : MPR_RECONSTRUCTION_MODES.orientation,
    );
    setMprProjectionMirror(normalizeMprProjectionMirror(savedMpr.projection_mirror));
    const savedDisplayWindow = savedMpr.display_window || {};
    const displayDomain = getNormalizedDisplayDomain(displayValueDomain);
    const fallbackContrast = clampRange(savedMpr.contrast_percent, 50, 150, 100);
    const fallbackRange = displayDomain.max - displayDomain.min;
    const legacyFallback = fallbackContrast === 100
      ? { min: displayDomain.min, max: displayDomain.max }
      : {
        min: displayDomain.min + (Math.max(0, 100 - fallbackContrast) / 100) * (fallbackRange / 2),
        max: displayDomain.min + Math.min(1, fallbackContrast / 100) * fallbackRange,
      };
    setDisplayWindow(normalizeDisplayWindow(savedDisplayWindow, displayDomain, legacyFallback));
    const defaultActive = getOverlayLayers(selectedPart)
      .slice(0, 2)
      .map((overlay) => overlay.id);
    const savedOverlayIds = Array.isArray(savedMpr.active_overlay_ids) ? savedMpr.active_overlay_ids.map((entry) => String(entry)) : [];
    setActiveOverlayIds(savedOverlayIds.length > 0 ? savedOverlayIds : defaultActive);
    setCursorProbe({
      x: clampRange(savedProbe.x, 0, 100, 50),
      y: clampRange(savedProbe.y, 0, 100, 50),
    });
    setSegmentationRun(getLatestRunFromMetadata(selectedPart, 'segmentation_runs'));
    setMeasurementRun(getLatestRunFromMetadata(selectedPart, 'measurement_runs'));
    setMlActionLoading({ segmentation: false, measurement: false });
  }, [selectedPart, projectType, mprDimensions, workspaceHydration, displayValueDomain]);

  useEffect(() => {
    const savedInspector = workspaceHydration?.inspector || {};
    setShortcutHelpVisible(savedInspector.shortcut_help_visible === true);
    setNormalizationTriageField(
      typeof savedInspector.normalization_triage_field === 'string'
        ? savedInspector.normalization_triage_field
        : '',
    );
    if (!selectedPart) return;
    const savedModalities = Array.isArray(savedInspector.modalities)
      ? savedInspector.modalities.map((value) => String(value))
      : [];
    setEnabledModalities(savedModalities.length > 0 ? savedModalities : getModalities(selectedPart).slice(0, 1));
    setSelectedViewName(savedInspector.view_name ? String(savedInspector.view_name) : '');
    setImageEnabled(typeof savedInspector.image_enabled === 'boolean' ? savedInspector.image_enabled : true);
    setMeasurementEntries(normalizeSavedMeasurements(savedInspector.measurements));
    const savedInspectorViewport = savedInspector.viewport_transform || {};
    setInspectorViewport({
      zoom: clampRange(savedInspectorViewport.zoom, 0.5, 4, 1),
      panX: clampRange(savedInspectorViewport.panX, -200, 200, 0),
      panY: clampRange(savedInspectorViewport.panY, -200, 200, 0),
    });
    setAnnotationDraft({
      defect_class: '',
      modality: getModalities(selectedPart)[0] || 'visual',
      comment: '',
      disposition: 'open',
      measurement_name: '',
      measurement_value: '',
    });
  }, [selectedPart, workspaceHydration]);

  useEffect(() => {
    const loadAnnotations = async () => {
      if (!selectedPart?.id) {
        setAnnotations([]);
        return;
      }
      setAnnotationsLoading(true);
      try {
        const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations`);
        if (!resp.ok) {
          throw new Error(`Failed to load annotations (${resp.status})`);
        }
        const payload = await resp.json();
        const annotationItems = Array.isArray(payload?.annotations) ? payload.annotations : [];
        setAnnotations(annotationItems);
      } catch (_err) {
        setAnnotations([]);
      } finally {
        setAnnotationsLoading(false);
      }
    };

    loadAnnotations();
  }, [projectId, selectedPart?.id]);

  useEffect(() => {
    if (!annotations.length) {
      setSelectedAnnotationId(null);
      return;
    }
    if (!annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(annotations[0].id);
    }
  }, [annotations, selectedAnnotationId]);

  useEffect(() => {
    if (loading || !workspaceStateLoaded) return;
    const saveHandle = setTimeout(async () => {
      try {
        await fetch(`/api/projects/${projectId}/workspace-state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: {
              selected_batch_id: selectedBatchId || '',
              review_filter: reviewFilter,
              part_filter: partFilter,
              sort_mode: sortMode,
              selected_part_id: selectedPart?.id || '',
              mpr: ['PT2', 'PT3'].includes(projectType)
                ? {
                  slice_position: slicePosition,
                  viewport_transform: viewportTransform,
                  reconstruction_mode: mprReconstructionMode,
                  projection_mirror: mprProjectionMirror,
                  display_window: displayWindow,
                  active_overlay_ids: activeOverlayIds,
                  cursor_probe: cursorProbe,
                }
                : undefined,
              inspector: {
                modalities: enabledModalities,
                view_name: activeViewName || '',
                image_enabled: imageEnabled,
                shortcut_help_visible: shortcutHelpVisible,
                normalization_triage_field: normalizationTriageField || '',
                measurements: measurementEntries,
                viewport_transform: inspectorViewport,
              },
              panel_layout: panelLayout,
            },
          }),
        });
      } catch (_err) {
        // Workspace persistence is non-blocking for main workbench interactions.
      }
    }, 350);
    return () => clearTimeout(saveHandle);
  }, [
    activeOverlayIds,
    activeViewName,
    displayWindow,
    cursorProbe,
    reviewFilter,
    partFilter,
    enabledModalities,
    imageEnabled,
    shortcutHelpVisible,
    loading,
    measurementEntries,
    normalizationTriageField,
    inspectorViewport,
    panelLayout,
    projectId,
    projectType,
    mprReconstructionMode,
    mprProjectionMirror,
    selectedBatchId,
    selectedPart,
    slicePosition,
    sortMode,
    viewportTransform,
    workspaceStateLoaded,
  ]);

  const updatePartReviewState = useCallback(async (part, nextState) => {
    try {
      setSavingPartId(part.id);
      const resp = await fetch(`/api/projects/${projectId}/parts/${part.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_state: nextState }),
      });
      if (!resp.ok) {
        throw new Error(`Failed to update review state (${resp.status})`);
      }
      const updatedPart = await resp.json();
      setParts((prev) => prev.map((item) => (item.id === updatedPart.id ? updatedPart : item)));
    } catch (err) {
      setError(err.message || 'Failed to update part review state');
    } finally {
      setSavingPartId(null);
    }
  }, [projectId]);

  useEffect(() => {
    if (!selectedPart?.id) return undefined;
    const handleInspectorHotkeys = (event) => {
      const focusedTag = event.target?.tagName?.toLowerCase();
      if (focusedTag === 'input' || focusedTag === 'textarea' || focusedTag === 'select' || event.defaultPrevented) {
        return;
      }
      const key = (event.key || '').toLowerCase();
      if (key === inspectorHotkeys.toggle_shortcut_help) {
        event.preventDefault();
        setShortcutHelpVisible((prev) => !prev);
        return;
      }
      if (savingPartId === selectedPart.id) return;
      if (key === inspectorHotkeys.accept_classification) {
        event.preventDefault();
        updatePartReviewState(selectedPart, 'pass');
      } else if (key === inspectorHotkeys.reject_classification) {
        event.preventDefault();
        updatePartReviewState(selectedPart, 'reject_confirmed');
      }
    };
    document.addEventListener('keydown', handleInspectorHotkeys);
    return () => document.removeEventListener('keydown', handleInspectorHotkeys);
  }, [inspectorHotkeys, savingPartId, selectedPart, updatePartReviewState]);

  const reviewSummary = useMemo(() => {
    return parts.reduce(
      (acc, part) => {
        const state = part.review_state || 'unreviewed';
        acc[state] = (acc[state] || 0) + 1;
        return acc;
      },
      { unreviewed: 0, pass: 0, reject_pending: 0, reject_confirmed: 0 },
    );
  }, [parts]);

  const updateSlicePosition = (axis, value, dimensions) => {
    const upper = Math.max(0, (dimensions?.[axis] || 1) - 1);
    const nextValue = Math.min(upper, Math.max(0, Number(value) || 0));
    setSlicePosition((prev) => ({ ...prev, [axis]: nextValue }));
  };

  const stepSlicePosition = (axis, delta) => {
    const upper = Math.max(0, (mprDimensions?.[axis] || 1) - 1);
    setSlicePosition((prev) => ({
      ...prev,
      [axis]: Math.min(upper, Math.max(0, Number(prev[axis] || 0) + delta)),
    }));
  };

  const handleMprPaneWheel = (axis, event) => {
    event.preventDefault();
    setActiveMprPane(axis);
    stepSlicePosition(axis, event.deltaY > 0 ? 1 : -1);
  };

  const handleMprVolumeWheel = (event) => {
    event.preventDefault();
    setActiveMprPane('volume');
    adjustZoom(event.deltaY < 0 ? 0.12 : -0.12);
  };

  const handleMprVolumePointerDown = (event) => {
    event.preventDefault();
    if (event.button !== undefined && event.button !== 0) return;
    setActiveMprPane('volume');
    mprDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotation: mprRotation,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleMprVolumePointerMove = (event) => {
    const drag = mprDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setMprRotation({
      x: Math.min(72, Math.max(-72, drag.rotation.x - dy * 0.35)),
      y: drag.rotation.y + dx * 0.35,
    });
  };

  const handleMprVolumePointerUp = (event) => {
    const drag = mprDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      mprDragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const preventMprNativeDrag = (event) => {
    event.preventDefault();
  };

  const openSegmentationHelper = () => {
    const fallbackAxis = activeMprPane === 'volume' ? 'axial' : activeMprPane;
    setSegmentationHelperAxis(MPR_AXES.includes(fallbackAxis) ? fallbackAxis : 'axial');
    setSegmentationPendingSelection(null);
    setSegmentationDraftShape(null);
    segmentationDraftRef.current = null;
    setSegmentationHelperOpen(true);
  };

  const closeSegmentationHelper = () => {
    setSegmentationHelperOpen(false);
    setSegmentationPendingSelection(null);
    setSegmentationDraftShape(null);
    setSegmentationPointerPreview(null);
    segmentationDraftRef.current = null;
  };

  const addSegmentationSegment = () => {
    setSegmentationSegments((prev) => {
      const nextSegment = createDefaultSegment(prev.length);
      setSelectedSegmentationSegmentId(nextSegment.id);
      setEditingSegmentationSegmentId(nextSegment.id);
      return [...prev, nextSegment];
    });
  };

  const updateSegmentationSegment = (segmentId, patch) => {
    setSegmentationSegments((prev) => prev.map((segment) => (
      segment.id === segmentId ? { ...segment, ...patch } : segment
    )));
  };

  const getSegmentationPointerPosition = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dimensions = getMprAxisImageDimensions(segmentationHelperAxis, mprDimensions);
    if (!rect.width || !rect.height || !dimensions.width || !dimensions.height) return null;
    const displayX = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const displayY = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    const x = (displayX / rect.width) * dimensions.width;
    const y = (displayY / rect.height) * dimensions.height;
    if (![x, y].every(Number.isFinite)) return null;
    return {
      x,
      y,
      displayX,
      displayY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    };
  };

  const makeSegmentationShapeBase = (tool, position, overrides = {}) => ({
    id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tool,
    operation: segmentationOperation,
    axis: segmentationHelperAxis,
    sliceIndex: Number(slicePosition[segmentationHelperAxis] || 0),
    imageWidth: position?.imageWidth || getMprAxisImageDimensions(segmentationHelperAxis, mprDimensions).width,
    imageHeight: position?.imageHeight || getMprAxisImageDimensions(segmentationHelperAxis, mprDimensions).height,
    brushSize: Number(segmentationBrushSize) || 18,
    sensitivity: Number(segmentationSensitivity) || 28,
    ...overrides,
  });

  const getSegmentationMlCacheKey = (axis = segmentationHelperAxis) => JSON.stringify({
    partId: selectedPart?.id || '',
    axis,
    sliceIndex: Number(slicePosition[axis] || 0),
    methodId: segmentationMlMethod,
    parameters: segmentationMlParameters,
    displayWindow,
  });

  const getSegmentationSliceDataUrl = (stageElement, axis = segmentationHelperAxis) => {
    const renderedCanvas = stageElement?.querySelector?.('canvas.mpr-slice-canvas');
    if (renderedCanvas?.toDataURL) {
      return renderedCanvas.toDataURL('image/png');
    }
    const cachedCanvas = getCachedMprSliceCanvas(axis, slicePosition, mprDimensions, volumeCacheState.cache);
    if (cachedCanvas?.toDataURL) {
      return cachedCanvas.toDataURL('image/png');
    }
    return '';
  };

  const getSegmentationSliceCanvasForSelection = (stageElement, axis = segmentationHelperAxis) => {
    const renderedCanvas = stageElement?.querySelector?.('canvas.mpr-slice-canvas');
    if (renderedCanvas?.getContext) return renderedCanvas;
    return getCachedMprSliceCanvas(axis, slicePosition, mprDimensions, volumeCacheState.cache);
  };

  const buildConnectedSegmentationSelection = (stageElement, position) => {
    const canvas = getSegmentationSliceCanvasForSelection(stageElement, segmentationHelperAxis);
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

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch (_) {
      imageData = null;
    }
    const data = imageData?.data;
    if (!data || data.length < width * height * 4) {
      return null;
    }

    const seedX = Math.max(0, Math.min(width - 1, Math.round((position.x / Math.max(1, position.imageWidth || width)) * (width - 1))));
    const seedY = Math.max(0, Math.min(height - 1, Math.round((position.y / Math.max(1, position.imageHeight || height)) * (height - 1))));
    const seedOffset = (seedY * width + seedX) * 4;
    const seed = [
      data[seedOffset],
      data[seedOffset + 1],
      data[seedOffset + 2],
      data[seedOffset + 3],
    ];
    const sensitivity = Math.max(0, Number(segmentationSensitivity) || 28);
    const maxDelta = sensitivity;
    const visited = new Uint8Array(width * height);
    const selected = new Uint8Array(width * height);
    const stack = [seedY * width + seedX];
    let areaPx = 0;
    let minX = seedX;
    let maxX = seedX;
    let minY = seedY;
    let maxY = seedY;

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
      areaPx += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0) stack.push(index - 1);
      if (x < width - 1) stack.push(index + 1);
      if (y > 0) stack.push(index - width);
      if (y < height - 1) stack.push(index + width);
    }

    const scaleX = (position.imageWidth || width) / width;
    const scaleY = (position.imageHeight || height) / height;
    const pathParts = [];
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
      }
    }

    return makeSegmentationShapeBase('connected', position, {
      seed: position,
      points: [],
      maskPath: pathParts.join(' '),
      bbox: [minX * scaleX, minY * scaleY, (maxX + 1) * scaleX, (maxY + 1) * scaleY],
      areaPx,
      canvasWidth: width,
      canvasHeight: height,
      seedColor: seed,
    });
  };

  const updateSegmentationMlParameter = (name, value) => {
    setSegmentationMlParameters((prev) => ({ ...prev, [name]: value }));
    setSegmentationPendingSelection(null);
    setSegmentationMlStatus('');
  };

  const changeSegmentationMlGroup = (groupId) => {
    const nextMethod = getDefaultSegmentationMlMethod(groupId);
    setSegmentationMlGroup(groupId);
    setSegmentationMlMethod(nextMethod);
    setSegmentationMlParameters(getDefaultSegmentationMlParameters(nextMethod));
    setSegmentationPendingSelection(null);
    setSegmentationMlStatus('');
  };

  const changeSegmentationMlMethod = (methodId) => {
    setSegmentationMlMethod(methodId);
    setSegmentationMlParameters(getDefaultSegmentationMlParameters(methodId));
    setSegmentationPendingSelection(null);
    setSegmentationMlStatus('');
  };

  const makeShapeFromMlRegion = (region, position, cachedResult) => {
    if (!region?.bbox) return null;
    const dimensions = getMprAxisImageDimensions(segmentationHelperAxis, mprDimensions);
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
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    });
  };

  const selectRegionFromCachedMlResult = (cachedResult, position) => {
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
    const shape = makeShapeFromMlRegion(selectedRegion, position, cachedResult);
    if (shape) {
      setSegmentationPendingSelection(shape);
      setSegmentationMlStatus(`Selected ML region ${selectedRegion.label} from ${regions.length} cached regions.`);
    } else {
      setSegmentationPendingSelection(null);
      setSegmentationMlStatus(regions.length > 0 ? 'No ML segment contains that click.' : 'No ML segments were returned for this slice.');
    }
  };

  const runSegmentationMlHelper = async (event, position) => {
    if (!selectedPart?.id || !position) return;
    const cacheKey = getSegmentationMlCacheKey(segmentationHelperAxis);
    const cached = segmentationMlCacheRef.current.get(cacheKey);
    if (cached) {
      selectRegionFromCachedMlResult(cached, position);
      return;
    }
    const imageData = getSegmentationSliceDataUrl(event.currentTarget, segmentationHelperAxis);
    if (!imageData) {
      setSegmentationMlStatus('Current slice image is still loading.');
      return;
    }
    setSegmentationMlLoading(true);
    setSegmentationMlStatus('Running ML helper on this slice...');
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/slice-segmentation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          axis: segmentationHelperAxis,
          slice_index: Number(slicePosition[segmentationHelperAxis] || 0),
          method_id: segmentationMlMethod,
          parameters: segmentationMlParameters,
          image_data_base64: imageData,
          filename: `${selectedPart.serial_number || selectedPart.id}-${segmentationHelperAxis}-${slicePosition[segmentationHelperAxis] || 0}.png`,
          click_x: position.x,
          click_y: position.y,
        }),
      });
      if (!resp.ok) throw new Error(`ML helper failed (${resp.status})`);
      const result = await resp.json();
      segmentationMlCacheRef.current.set(cacheKey, result);
      selectRegionFromCachedMlResult(result, position);
    } catch (err) {
      setSegmentationMlStatus(err.message || 'ML helper failed.');
    } finally {
      setSegmentationMlLoading(false);
    }
  };

  const commitSegmentationShape = (shape, explicitOperation = segmentationOperation) => {
    if (!shape || !selectedSegmentationSegment) return;
    const nextShape = {
      ...shape,
      operation: explicitOperation,
      color: selectedSegmentationSegment.color,
      id: shape.id || `shape-${Date.now()}`,
    };
    setSegmentationSegments((prev) => prev.map((segment) => (
      segment.id === selectedSegmentationSegment.id
        ? { ...segment, areas: [...(segment.areas || []), nextShape] }
        : segment
    )));
    setSegmentationPendingSelection(null);
    setSegmentationDraftShape(null);
    segmentationDraftRef.current = null;
  };

  const commitPendingSegmentationSelection = (operation = segmentationOperation) => {
    if (!segmentationPendingSelection) return;
    commitSegmentationShape(segmentationPendingSelection, operation);
  };

  const handleSegmentationHelperWheel = (event) => {
    event.preventDefault();
    stepSlicePosition(segmentationHelperAxis, event.deltaY > 0 ? 1 : -1);
  };

  const handleSegmentationStagePointerDown = (event) => {
    if (!selectedSegmentationSegment || (event.button !== undefined && event.button !== 0)) return;
    const position = getSegmentationPointerPosition(event);
    if (!position) return;
    setSegmentationPointerPreview(position);
    event.preventDefault();
    event.stopPropagation();
    const operation = segmentationTool === 'eraser' ? 'subtract' : segmentationOperation;
    const tool = segmentationTool === 'eraser' ? 'brush' : segmentationTool;
    if (tool === 'ml-helper') {
      runSegmentationMlHelper(event, position);
      return;
    }
    if (tool === 'brush' || tool === 'scissors') {
      const shape = makeSegmentationShapeBase(tool, position, { operation, points: [position] });
      segmentationDraftRef.current = shape;
      setSegmentationDraftShape(shape);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (tool === 'circle') {
      const shape = makeSegmentationShapeBase(tool, position, { center: position, edge: position, radius: 0, points: [position] });
      segmentationDraftRef.current = shape;
      setSegmentationDraftShape(shape);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (tool === 'rectangle') {
      const shape = makeSegmentationShapeBase(tool, position, { start: position, end: position, points: [position] });
      segmentationDraftRef.current = shape;
      setSegmentationDraftShape(shape);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (tool === 'connected') {
      setSegmentationPendingSelection(buildConnectedSegmentationSelection(event.currentTarget, position));
      return;
    }
    if (['threshold', 'level-trace'].includes(tool)) {
      const radius = Math.max(6, Number(segmentationSensitivity) || 28);
      setSegmentationPendingSelection(makeSegmentationShapeBase(tool, position, {
        seed: position,
        radius,
        points: SEGMENTATION_POINT_MARKER_TOOLS.has(tool) ? [position] : [],
      }));
      return;
    }
    if (tool === 'polygon') {
      const existing = segmentationDraftRef.current?.tool === 'polygon' ? segmentationDraftRef.current : null;
      const points = [...(existing?.points || []), position];
      const shape = makeSegmentationShapeBase(tool, position, { ...(existing || {}), points, closed: false });
      segmentationDraftRef.current = shape;
      setSegmentationDraftShape(shape);
    }
  };

  const handleSegmentationStagePointerMove = (event) => {
    const position = getSegmentationPointerPosition(event);
    if (position) setSegmentationPointerPreview(position);
    const draft = segmentationDraftRef.current;
    if (!draft || draft.tool === 'polygon') return;
    if (!position) return;
    event.preventDefault();
    if (draft.tool === 'brush' || draft.tool === 'scissors') {
      const next = { ...draft, points: [...(draft.points || []), position] };
      segmentationDraftRef.current = next;
      setSegmentationDraftShape(next);
      return;
    }
    if (draft.tool === 'circle') {
      const radius = Math.hypot(position.x - draft.center.x, position.y - draft.center.y);
      const next = { ...draft, edge: position, radius, points: [draft.center, position] };
      segmentationDraftRef.current = next;
      setSegmentationDraftShape(next);
      return;
    }
    if (draft.tool === 'rectangle') {
      const next = { ...draft, end: position, points: [draft.start, position] };
      segmentationDraftRef.current = next;
      setSegmentationDraftShape(next);
    }
  };

  const handleSegmentationStagePointerLeave = () => {
    setSegmentationPointerPreview(null);
  };

  const handleSegmentationStagePointerUp = (event) => {
    const draft = segmentationDraftRef.current;
    if (!draft || draft.tool === 'polygon') return;
    event.preventDefault();
    event.stopPropagation();
    if (draft.tool === 'brush' || draft.tool === 'scissors') {
      if ((draft.points || []).length > 0) commitSegmentationShape(draft, draft.operation);
    } else {
      setSegmentationPendingSelection(draft);
      setSegmentationDraftShape(null);
      segmentationDraftRef.current = null;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const completeSegmentationPolygon = (event) => {
    if (segmentationTool !== 'polygon') return;
    const draft = segmentationDraftRef.current;
    if (!draft || draft.tool !== 'polygon' || (draft.points || []).length < 3) return;
    event.preventDefault();
    event.stopPropagation();
    const closed = { ...draft, closed: true };
    setSegmentationPendingSelection(closed);
    setSegmentationDraftShape(null);
    segmentationDraftRef.current = null;
  };

  const cancelSegmentationDraft = () => {
    setSegmentationDraftShape(null);
    setSegmentationPendingSelection(null);
    segmentationDraftRef.current = null;
  };

  const adjustZoom = (delta) => {
    setViewportTransform((prev) => {
      const nextZoom = Math.min(4, Math.max(0.5, Number((prev.zoom + delta).toFixed(2))));
      return { ...prev, zoom: nextZoom };
    });
  };

  const resetViewport = () => {
    setViewportTransform({ zoom: 1, panX: 0, panY: 0 });
    setMprRotation({ x: -22, y: 32 });
  };

  const toggleOverlay = (overlayId) => {
    setActiveOverlayIds((prev) => {
      if (prev.includes(overlayId)) return prev.filter((id) => id !== overlayId);
      return [...prev, overlayId];
    });
  };
  const toggleRenderCategory = (categoryId) => {
    setRenderCategories((prev) => (prev.includes(categoryId)
      ? prev.filter((entry) => entry !== categoryId)
      : [...prev, categoryId]));
  };
  const toggleViewVisibility = (viewName) => {
    const key = String(viewName || '').toLowerCase();
    if (!key) return;
    setHiddenViewNames((prev) => (prev.includes(key)
      ? prev.filter((entry) => entry !== key)
      : [...prev, key]));
  };

  const toggleModalityVisibility = (modality) => {
    const key = String(modality || '').toLowerCase();
    if (!key) return;
    setEnabledModalities((prev) => {
      const normalized = prev.map((entry) => String(entry).toLowerCase());
      return normalized.includes(key)
        ? prev.filter((entry) => String(entry).toLowerCase() !== key)
        : [...prev, key];
    });
  };

  const toggleMprProjectionMirror = (axis) => {
    setMprProjectionMirror((prev) => ({
      ...prev,
      [axis]: !prev[axis],
    }));
  };


  const deleteAnalyzeOverlay = useCallback(async (entry) => {
    const overlayId = entry?.imageId || entry?.imageRef;
    if (!overlayId) return;
    try {
      setDeletingOverlayId(String(overlayId));
      const resp = await fetch(`/api/projects/${projectId}/analyze/overlays/${encodeURIComponent(String(overlayId))}`, {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error(`Failed to delete Analyze overlay (${resp.status})`);
      const updatedPart = await resp.json();
      setParts((prev) => prev.map((part) => (part.id === updatedPart.id ? updatedPart : part)));
      setSelectedImageRef((current) => (String(current) === String(entry.imageRef) ? '' : current));
    } catch (err) {
      setError(err.message || 'Failed to delete Analyze overlay');
    } finally {
      setDeletingOverlayId('');
    }
  }, [projectId]);


  const runSegmentation = async () => {
    if (!selectedPart) return;
    try {
      setMlActionLoading((prev) => ({ ...prev, segmentation: true }));
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/segmentation-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ axis: 'axial', slice_index: slicePosition.axial }),
      });
      if (!resp.ok) {
        throw new Error(`Failed to run segmentation (${resp.status})`);
      }
      const result = await resp.json();
      setSegmentationRun(result);
      if (result.overlay_id) {
        setActiveOverlayIds((prev) => (prev.includes(result.overlay_id) ? prev : [...prev, result.overlay_id]));
      }
    } catch (err) {
      setError(err.message || 'Failed to run segmentation');
    } finally {
      setMlActionLoading((prev) => ({ ...prev, segmentation: false }));
    }
  };

  const runMeasurements = async () => {
    if (!selectedPart) return;
    try {
      setMlActionLoading((prev) => ({ ...prev, measurement: true }));
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/measurement-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measurement_profile: 'workbench-default',
          include_overlays: activeOverlayIds,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Failed to run AI measurements (${resp.status})`);
      }
      const result = await resp.json();
      setMeasurementRun(result);
    } catch (err) {
      setError(err.message || 'Failed to run AI measurements');
    } finally {
      setMlActionLoading((prev) => ({ ...prev, measurement: false }));
    }
  };

  const resetAnnotationDraft = () => {
    setAnnotationDraft({
      defect_class: '',
      modality: enabledModalities[0] || modalityOptions[0] || 'visual',
      comment: '',
      disposition: 'open',
      measurement_name: '',
      measurement_value: '',
    });
  };

  const setTileAnnotationMode = (mode) => {
    setAnnotationToolMode((prev) => (prev === mode ? '' : mode));
    setTileAnnotationDraft(null);
    setTileAnnotationPreview(null);
    tileAnnotationDraftRef.current = null;
    setMprAnnotationDraft(null);
    setMprAnnotationPreview(null);
    mprAnnotationDraftRef.current = null;
  };

  const openAnnotationEditModal = (annotation) => {
    if (!annotation?.id) return;
    setSelectedAnnotationId(annotation.id);
    setAnnotationEditDraft({
      id: annotation.id,
      defect_class: annotation.defect_class || '',
      comment: annotation.comment || '',
      disposition: annotation.disposition || 'open',
      color: getAnnotationColor(annotation),
      fill_opacity: getAnnotationFillOpacity(annotation),
    });
    setAnnotationEditModalVisible(true);
  };

  const closeAnnotationEditModal = () => {
    setAnnotationEditModalVisible(false);
    setAnnotationEditDraft(null);
  };

  const createAnnotation = async () => {
    if (!selectedPart?.id || !annotationDraft.defect_class.trim()) return;
    const measurementName = annotationDraft.measurement_name.trim();
    const measurementValue = Number(annotationDraft.measurement_value);
    const measurements = measurementName && Number.isFinite(measurementValue)
      ? { [measurementName]: Number(measurementValue.toFixed(2)) }
      : {};
    const payload = {
      defect_class: (annotationDraft.defect_class === 'Other' ? (customDefectTypeDraft.trim() || 'Other') : annotationDraft.defect_class).trim(),
      modality: (annotationDraft.modality || enabledModalities[0] || modalityOptions[0] || 'visual').trim(),
      comment: annotationDraft.comment.trim() || null,
      disposition: annotationDraft.disposition,
      measurements,
      hidden: false,
    };

    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        throw new Error(`Failed to create annotation (${resp.status})`);
      }
      const created = await resp.json();
      setAnnotations((prev) => [created, ...prev]);
      resetAnnotationDraft();
      setOtherAnnotationModalVisible(false);
    } catch (err) {
      setError(err.message || 'Failed to create annotation');
    }
  };

  const createMeasurementAnnotation = async ({ imageId, line, name, color, distanceMm, modality, geometryPatch = {}, metadataPatch = {} }) => {
    if (!selectedPart?.id || !line || !line.imageWidth || !line.imageHeight) return;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    const width = Math.abs(line.x2 - line.x1);
    const height = Math.abs(line.y2 - line.y1);
    const distancePixels = Math.sqrt((width ** 2) + (height ** 2));
    const payload = {
      image_id: annotationImageId ? String(annotationImageId) : null,
      defect_class: 'Measurement',
      modality: modality || activeViewName || enabledModalities[0] || modalityOptions[0] || 'visual',
      comment: name || 'Captured from measurement tool.',
      disposition: 'open',
      measurements: { length_px: Number(distancePixels.toFixed(2)), ...(Number.isFinite(distanceMm) ? { length_mm: Number(distanceMm.toFixed(2)) } : {}) },
      geometry: { ...geometryPatch, line },
      metadata: { measurement_color: color, annotation_color: color, ...metadataPatch },
      bbox: {
        x: Number(Math.min(line.x1, line.x2).toFixed(2)),
        y: Number(Math.min(line.y1, line.y2).toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      },
      hidden: false,
    };
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Failed to create measurement annotation (${resp.status})`);
      const created = await resp.json();
      setAnnotations((prev) => [created, ...prev]);
      setSelectedAnnotationId(created.id);
      return created;
    } catch (err) {
      setError(err.message || 'Failed to create measurement annotation');
      return null;
    }
  };

	  const createBoxAnnotation = async ({ imageId, box, name, color, modality, defectClass = 'Bounding Box', geometryPatch = {}, metadataPatch = {} }) => {
	    if (!selectedPart?.id || !isFiniteAnnotationBox(box)) return null;
	    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
	    const pixelsPerMm = Number(getCalibrationForImage(annotationImageId)?.pixels_per_mm || 0);
	    const widthMm = pixelsPerMm > 0 ? box.width / pixelsPerMm : null;
	    const heightMm = pixelsPerMm > 0 ? box.height / pixelsPerMm : null;
	    const payload = {
      image_id: annotationImageId ? String(annotationImageId) : null,
      defect_class: defectClass,
      modality: modality || activeViewName || enabledModalities[0] || modalityOptions[0] || 'visual',
      comment: name || 'Captured from draw box tool.',
      disposition: 'open',
	      measurements: {
	        width_px: Number(box.width.toFixed(2)),
	        height_px: Number(box.height.toFixed(2)),
	        ...(Number.isFinite(widthMm) ? { width_mm: Number(widthMm.toFixed(2)) } : {}),
	        ...(Number.isFinite(heightMm) ? { height_mm: Number(heightMm.toFixed(2)) } : {}),
	      },
      geometry: {
        ...geometryPatch,
        imageWidth: box.imageWidth,
        imageHeight: box.imageHeight,
        box: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          imageWidth: box.imageWidth,
          imageHeight: box.imageHeight,
          ...(geometryPatch?.box || {}),
        },
      },
      metadata: { annotation_color: color, annotation_fill_opacity: DEFAULT_ANNOTATION_FILL_OPACITY, ...metadataPatch },
      bbox: {
        x: Number(box.x.toFixed(2)),
        y: Number(box.y.toFixed(2)),
        width: Number(box.width.toFixed(2)),
        height: Number(box.height.toFixed(2)),
      },
      hidden: false,
    };
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Failed to create box annotation (${resp.status})`);
      const created = await resp.json();
      setAnnotations((prev) => [created, ...prev]);
      setSelectedAnnotationId(created.id);
      return created;
    } catch (err) {
      setError(err.message || 'Failed to create box annotation');
      return null;
    }
  };

  const createCubeAnnotation = async ({ axis, firstBox, secondBox, color }) => {
    if (!selectedPart?.id || !axis || !isFiniteAnnotationBox(firstBox) || !isFiniteAnnotationBox(secondBox)) return null;
    const firstSlice = Number(firstBox.sliceIndex);
    const secondSlice = Number(secondBox.sliceIndex);
    if (!Number.isFinite(firstSlice) || !Number.isFinite(secondSlice) || firstSlice === secondSlice) return null;
    const x = Math.min(firstBox.x, secondBox.x);
    const y = Math.min(firstBox.y, secondBox.y);
    const right = Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width);
    const bottom = Math.max(firstBox.y + firstBox.height, secondBox.y + secondBox.height);
    const width = right - x;
    const height = bottom - y;
    const cube = {
      axis,
      startSlice: Math.min(firstSlice, secondSlice),
      endSlice: Math.max(firstSlice, secondSlice),
      x,
      y,
      width,
      height,
      imageWidth: secondBox.imageWidth || firstBox.imageWidth,
      imageHeight: secondBox.imageHeight || firstBox.imageHeight,
      firstBox,
      secondBox,
      vertices: makeMprCubeVertices(axis, firstBox, secondBox),
    };
    const payload = {
      image_id: null,
      defect_class: '3D Box',
      modality: 'volume',
      comment: 'Captured from 3D box tool.',
      disposition: 'open',
      measurements: {
        width_px: Number(width.toFixed(2)),
        height_px: Number(height.toFixed(2)),
        depth_slices: Math.abs(secondSlice - firstSlice),
      },
      geometry: { cube },
      metadata: { annotation_color: color, annotation_fill_opacity: DEFAULT_ANNOTATION_FILL_OPACITY },
      bbox: {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      },
      hidden: false,
    };
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Failed to create 3D annotation (${resp.status})`);
      const created = await resp.json();
      setAnnotations((prev) => [created, ...prev]);
      setSelectedAnnotationId(created.id);
      return created;
    } catch (err) {
      setError(err.message || 'Failed to create 3D annotation');
      return null;
    }
  };

  const updateMeasurementAnnotationLine = async (lineId, nextLine) => {
    if (!selectedPart?.id || !lineId || !isFiniteMeasurementLine(nextLine)) return null;
    const calibratedLine = getMeasurementLineWithDerivedLength(
      nextLine,
      getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId),
      getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId)),
    );
    const width = Math.abs(calibratedLine.x2 - calibratedLine.x1);
    const height = Math.abs(calibratedLine.y2 - calibratedLine.y1);
    const measurements = {
      length_px: Number(calibratedLine.distancePx.toFixed(2)),
      ...(Number.isFinite(calibratedLine.distanceMm) ? { length_mm: Number(calibratedLine.distanceMm.toFixed(2)) } : {}),
    };
    const payload = {
      image_id: calibratedLine.imageId,
      geometry: { line: calibratedLine },
      measurements,
      metadata: { measurement_color: nextLine.color },
      bbox: {
        x: Number(Math.min(calibratedLine.x1, calibratedLine.x2).toFixed(2)),
        y: Number(Math.min(calibratedLine.y1, calibratedLine.y2).toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      },
    };
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Failed to update measurement annotation (${resp.status})`);
      const updated = await resp.json();
      setAnnotations((prev) => prev.map((item) => (String(item.id) === String(updated.id) ? updated : item)));
      setFullscreenMeasurements((prev) => prev.map((item) => (String(item.id) === String(lineId)
        ? {
          ...item,
          ...calibratedLine,
          color: nextLine.color,
          distancePx: calibratedLine.distancePx,
          distanceMm: calibratedLine.distanceMm,
        }
        : item)));
      setSelectedAnnotationId(updated.id);
      return updated;
    } catch (err) {
      setError(err.message || 'Failed to update measurement annotation');
      return null;
    }
  };

  const updateBoxAnnotationGeometry = async (boxId, nextBox) => {
    if (!selectedPart?.id || !boxId || !isFiniteAnnotationBox(nextBox)) return null;
    const annotationImageId = getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId);
    const pixelsPerMm = Number(getCalibrationForImage(annotationImageId)?.pixels_per_mm || 0);
    const widthMm = pixelsPerMm > 0 ? nextBox.width / pixelsPerMm : null;
    const heightMm = pixelsPerMm > 0 ? nextBox.height / pixelsPerMm : null;
    const measurements = {
      width_px: Number(nextBox.width.toFixed(2)),
      height_px: Number(nextBox.height.toFixed(2)),
      ...(Number.isFinite(widthMm) ? { width_mm: Number(widthMm.toFixed(2)) } : {}),
      ...(Number.isFinite(heightMm) ? { height_mm: Number(heightMm.toFixed(2)) } : {}),
    };
    const payload = {
      image_id: annotationImageId ? String(annotationImageId) : null,
      geometry: {
        imageWidth: nextBox.imageWidth,
        imageHeight: nextBox.imageHeight,
        box: {
          x: nextBox.x,
          y: nextBox.y,
          width: nextBox.width,
          height: nextBox.height,
          imageWidth: nextBox.imageWidth,
          imageHeight: nextBox.imageHeight,
        },
      },
      measurements,
      metadata: { annotation_color: nextBox.color },
      bbox: {
        x: Number(nextBox.x.toFixed(2)),
        y: Number(nextBox.y.toFixed(2)),
        width: Number(nextBox.width.toFixed(2)),
        height: Number(nextBox.height.toFixed(2)),
      },
    };
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations/${boxId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Failed to update box annotation (${resp.status})`);
      const updated = await resp.json();
      setAnnotations((prev) => prev.map((item) => (String(item.id) === String(updated.id) ? updated : item)));
      setSelectedAnnotationId(updated.id);
      return updated;
    } catch (err) {
      setError(err.message || 'Failed to update box annotation');
      return null;
    }
  };

  const deleteMeasurementAnnotation = async (lineId) => {
    if (!selectedPart?.id || !lineId) return;
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations/${lineId}`, {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error(`Failed to delete measurement annotation (${resp.status})`);
      setAnnotations((prev) => prev.filter((item) => String(item.id) !== String(lineId)));
      setFullscreenMeasurements((prev) => prev.filter((item) => String(item.id) !== String(lineId)));
      setSelectedAnnotationId((prev) => (String(prev) === String(lineId) ? null : prev));
      setFullscreenHoveredEndpoint((prev) => (String(prev?.lineId) === String(lineId) ? null : prev));
      setFullscreenEditingEndpoint((prev) => (String(prev?.lineId) === String(lineId) ? null : prev));
      setFullscreenHoveredBoxCorner((prev) => (String(prev?.boxId) === String(lineId) ? null : prev));
      setFullscreenEditingBoxCorner((prev) => (String(prev?.boxId) === String(lineId) ? null : prev));
    } catch (err) {
      setError(err.message || 'Failed to delete measurement annotation');
    }
  };

  const renderPartSummaryPane = () => (
    <section
      className="workbench-tabbed-panel"
      data-layout-region={inspectionHierarchy.leftColumn}
    >
      <div className="workspace-panel-layout">
        <div className="workbench-controls workbench-controls-compact">
          <label htmlFor="batchFilter" className="form-label">Batch</label>
          <select
            id="batchFilter"
            className="form-control"
            value={selectedBatchId}
            onChange={(e) => setSelectedBatchId(e.target.value)}
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.name}</option>
            ))}
          </select>

          <label htmlFor="reviewFilter" className="form-label">Status</label>
          <select
            id="reviewFilter"
            className="form-control"
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="pass">Pass</option>
            <option value="reject_confirmed">Reject</option>
            <option value="manual">Manual</option>
            <option value="none">None</option>
          </select>
          {manualFilterNotice && reviewFilter === 'manual' && (
            <p className="muted">{manualFilterNotice}</p>
          )}

          <label htmlFor="partFilter" className="form-label">Filter</label>
          <input
            id="partFilter"
            className="form-control"
            type="text"
            value={partFilter}
            onChange={(e) => setPartFilter(e.target.value)}
            placeholder="Filter by batch # or part #"
          />

          <label htmlFor="sortMode" className="form-label">Sort</label>
          <select
            id="sortMode"
            className="form-control"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
          >
            <option value="part_asc">Part # (A -> Z)</option>
            <option value="batch_asc">Batch # (A -> Z)</option>
            <option value="status_asc">Inspection status</option>
            <option value="defect_desc">Defect count (high -> low)</option>
          </select>
        </div>
        <div className="workbench-list">
          {filteredParts.length === 0 ? (
            <div>
              <p className="muted">No parts found for the current filters.</p>
              {normalizationTriageField && (
                <p className="muted" data-testid="normalization-triage-empty-guidance">
                  {normalizationTriageMatchCount > 0
                    ? `Triage matches exist for ${normalizationTriageField}, but they are hidden by the active filters.`
                    : `No parts in this project contain mixed ${normalizationTriageField} metadata values.`}
                </p>
              )}
            </div>
          ) : (
            (() => {
              const partsByBatch = filteredParts.reduce((acc, part) => {
                const key = String(part.batch_id || 'No Batch');
                if (!acc.has(key)) acc.set(key, []);
                acc.get(key).push(part);
                return acc;
              }, new Map());
              return Array.from(partsByBatch.entries()).map(([batchKey, batchParts]) => (
                <div key={batchKey} className="part-summary-batch">
                  {batchParts.map((part) => {
                    const state = part.review_state || 'unreviewed';
                    const defectCount = getDefectCount(part);
                    const annotationCount = Array.isArray(part?.metadata?.annotations) ? part.metadata.annotations.length : 0;
                    const isSelected = part.id === selectedPart?.id;
                    const viewImages = part?.metadata?.view_images || {};
                    const imageEntries = Object.entries(viewImages);
                    const partModalities = getModalities(part);
                    const partImageRefs = getPartImageRefs(part);
                    return (
                      <article
                        key={part.id}
                        className={`workbench-part-row ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedPartId(part.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            setSelectedPartId(part.id);
                          }
                        }}
                      >
                        <div>
                          <div className="group-row-name">{part.display_name || part.serial_number}</div>
                          <div className="workbench-defect-count">
                            Defects: {defectCount} • Annotations: {annotationCount}
                          </div>
                          {imageEntries.length > 0 && (
                            <div className="part-summary-images" aria-label={`${part.display_name || part.serial_number} view filters`}>
                              {imageEntries.map(([viewName, imageRef]) => {
                                const normalizedViewName = String(viewName).toLowerCase();
                                const isHidden = hiddenViewNames.includes(normalizedViewName);
                                return (
                                  <button
                                    type="button"
                                    key={`${part.id}-${viewName}`}
                                    className={`btn btn-secondary btn-sm ${isSelected && activeViewName === normalizedViewName ? 'active' : ''} ${isHidden ? 'muted-toggle' : ''}`}
                                    aria-pressed={!isHidden}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedPartId(part.id);
                                      toggleViewVisibility(viewName);
                                      setSelectedViewName(normalizedViewName);
                                      setSelectedImageRef(String(imageRef || ''));
                                    }}
                                  >
                                    {viewName.toUpperCase()}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {partModalities.length > 0 && (
                            <div className="part-summary-images part-summary-modalities" aria-label={`${part.display_name || part.serial_number} modality filters`}>
                              {partModalities.map((modality) => {
                                const normalizedModality = String(modality).toLowerCase();
                                const isEnabled = enabledModalities.map((entry) => String(entry).toLowerCase()).includes(normalizedModality);
                                const matchingImage = partImageRefs.find((entry) => String(entry.modality || '').toLowerCase() === normalizedModality);
                                return (
                                  <button
                                    type="button"
                                    key={`${part.id}-modality-${normalizedModality}`}
                                    className={`btn btn-secondary btn-sm ${isEnabled ? 'active' : 'muted-toggle'}`}
                                    aria-pressed={isEnabled}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedPartId(part.id);
                                      toggleModalityVisibility(normalizedModality);
                                      if (matchingImage) {
                                        setSelectedViewName(String(matchingImage.viewName || '').toLowerCase());
                                        setSelectedImageRef(String(matchingImage.imageRef || matchingImage.imageId || ''));
                                      }
                                    }}
                                  >
                                    {normalizedModality.toUpperCase()}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <span className={`group-status-badge group-status-${state}`} data-testid="part-review-state">
                          {REVIEW_LABELS[state] || REVIEW_LABELS.unreviewed}
                        </span>
                      </article>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>
      </div>
    </section>
  );

  const renderMprPane = () => (
    <section className="mpr-shell" data-testid="mpr-panel" aria-label="Multi-Planar Reconstruction">
      {!selectedPart ? (
        <p className="muted">No part selected. Select a part to inspect the volume.</p>
      ) : (
        <>
          <div className="mpr-control-strip">
            {projectType === 'PT3' && filteredParts.length > 1 && (
              <label htmlFor="mpr-part-selector" className="mpr-part-selector">
                Part
                <select
                  id="mpr-part-selector"
                  data-testid="mpr-part-selector"
                  value={selectedPart?.id || ''}
                  onChange={(event) => setSelectedPartId(event.target.value)}
                >
                  {filteredParts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.display_name || part.serial_number || part.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <DisplayWindowControl
              displayWindow={displayWindow}
              displayDomain={displayValueDomain}
              onChange={setDisplayWindow}
            />
            <span className="group-badge">{formatWindowValue(displayWindow.min)}-{formatWindowValue(displayWindow.max)}</span>
            <label className="mpr-reconstruction-selector" htmlFor="mpr-reconstruction-mode">
              3D view
              <select
                id="mpr-reconstruction-mode"
                value={mprReconstructionMode}
                onChange={(event) => setMprReconstructionMode(event.target.value)}
              >
                <option value={MPR_RECONSTRUCTION_MODES.orientation}>Orientation only</option>
                <option value={MPR_RECONSTRUCTION_MODES.stack} disabled={!canShowStackReconstruction}>
                  Stack reconstruction
                </option>
                <option value={MPR_RECONSTRUCTION_MODES.shell} disabled={!canShowShellReconstruction}>
                  Reference shell
                </option>
              </select>
            </label>
            <div className="overlay-toggles">
              {overlayLayers.map((overlay) => (
                <label key={overlay.id} className="overlay-toggle">
                  <input
                    type="checkbox"
                    checked={activeOverlayIds.includes(overlay.id)}
                    onChange={() => toggleOverlay(overlay.id)}
                  />
                  <span className="overlay-swatch" style={{ backgroundColor: overlay.color }} />
                  {overlay.label}
                </label>
              ))}
            </div>
            <span className="mpr-probe-readout">Probe {tooltipValues.base}</span>
            <div className="mpr-ml-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!selectedPart || mlActionLoading.segmentation}
                onClick={runSegmentation}
              >
                {mlActionLoading.segmentation ? 'Running Segmentation...' : 'Run Segmentation'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!selectedPart || mlActionLoading.measurement}
                onClick={runMeasurements}
              >
                {mlActionLoading.measurement ? 'Running Measurements...' : 'Run Measurements'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={resetViewport}>Reset 3D</button>
              {projectType === 'PT3' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={openSegmentationHelper}
                  disabled={!selectedPart}
                >
                  Segmentation Helpers
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openMprAnnotationTool(activeMprPane === 'volume' ? 'axial' : activeMprPane, 'measure')}>Measure</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openMprAnnotationTool(activeMprPane === 'volume' ? 'axial' : activeMprPane, 'box')}>Draw Box</button>
            </div>
          </div>
          <div className="mpr-grid mpr-grid-four" data-testid="mpr-grid">
            {MPR_AXES.map((axis) => {
              const upper = Math.max(0, (mprDimensions[axis] || 1) - 1);
              const config = MPR_AXIS_CONFIG[axis];
              const label = config?.label || MPR_AXIS_LABELS[axis] || axis.toUpperCase();
              const isMirrored = mprProjectionMirror[axis] === true;
              const crosshairStyle = getMprCrosshairStyle(axis, slicePosition, mprDimensions, mprProjectionMirror);
              const fallbackImage = getFallbackProjectionImage(axis, shellImageLayers);
              const currentSliceIndex = Number(slicePosition[axis] || 0);
              const mprSliceKey = getMprSliceKey(axis, currentSliceIndex);
              const mprPreviewLines = mprAnnotationPreview?.mode === 'measure'
                && mprAnnotationPreview.axis === axis
                && Number(mprAnnotationPreview.sliceIndex) === currentSliceIndex
                ? [mprAnnotationPreview.line]
                : [];
              const mprPreviewBoxes = mprAnnotationPreview?.box
                && mprAnnotationPreview.axis === axis
                && Number(mprAnnotationPreview.sliceIndex) === currentSliceIndex
                ? [mprAnnotationPreview.box]
                : [];
              const pendingCubeBoxes = mprAnnotationDraft?.mode === 'cube-pending'
                && mprAnnotationDraft.axis === axis
                && Number(mprAnnotationDraft.sliceIndex) === currentSliceIndex
                ? [{ ...mprAnnotationDraft.box, id: 'mpr-cube-pending', color: DEFAULT_ANNOTATION_COLOR, fillOpacity: DEFAULT_ANNOTATION_FILL_OPACITY }]
                : [];
              const mprSliceLines = (mprMeasurementLinesBySlice[mprSliceKey] || []).filter(isFiniteMeasurementLine);
              const mprSliceBoxes = [
                ...(mprBoxAnnotationsBySlice[mprSliceKey] || []),
                ...getMprCubeBoxesForSlice(mprCubeAnnotations, axis, currentSliceIndex),
              ].filter(isFiniteAnnotationBox);
              return (
                <article
                  key={axis}
                  className={`mpr-pane mpr-pane-${axis} ${activeMprPane === axis ? 'active-pane' : ''}`}
                  style={{ '--mpr-axis-color': config?.color, ...crosshairStyle }}
                  data-testid={`mpr-pane-${axis}`}
                  onClick={() => {
                    setActiveMprPane(axis);
                    openMprAnnotationTool(axis, 'measure');
                    setFullscreenMeasureActive(false);
                    setFullscreenImageZoom({ scale: 1, panX: 0, panY: 0, originX: 50, originY: 50 });
                  }}
                  onWheel={(event) => handleMprPaneWheel(axis, event)}
                >
                  <header className="mpr-pane-header">
                    <strong>{label}</strong>
                    <div className="mpr-pane-header-controls">
                      <span>{config?.sliceLabel || axis.toUpperCase()} {slicePosition[axis]} / {upper}</span>
                      <label className="mpr-mirror-toggle" htmlFor={`mpr-mirror-${axis}`} onClick={(event) => event.stopPropagation()}>
                        <input
                          id={`mpr-mirror-${axis}`}
                          type="checkbox"
                          checked={isMirrored}
                          onChange={() => toggleMprProjectionMirror(axis)}
                        />
                        Mirror
                      </label>
                    </div>
                  </header>
                  <div
                    className="mpr-crosshair-preview"
                    aria-label={`${label} slice preview`}
                    data-testid={`mpr-preview-${axis}`}
                    style={crosshairStyle}
                    onMouseDown={(event) => handleMprAnnotationPointerDown(event, axis)}
                    onMouseMove={(event) => handleMprAnnotationPointerMove(event, axis)}
                    onMouseUp={(event) => handleMprAnnotationPointerUp(event, axis)}
                    onMouseLeave={handleMprAnnotationPointerCancel}
                    onClick={(event) => {
                      if (annotationToolMode) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  >
                    {volumeImageStack.length > 0 ? (
                      <MprSliceCanvas
                        axis={axis}
                        volumeCache={volumeCacheState.cache}
                        volumeCacheStatus={volumeCacheState.status}
                        slicePosition={slicePosition}
                        dimensions={mprDimensions}
                        displayWindow={displayWindow}
                        displayDomain={displayValueDomain}
                      />
                    ) : fallbackImage ? (
                      <MprWindowedImage
                        className="mpr-fallback-projection"
                        src={fallbackImage.url}
                        alt={`${label} fallback projection from ${fallbackImage.viewName} view`}
                        displayWindow={displayWindow}
                        displayDomain={displayValueDomain}
                      />
                    ) : (
                      <span className="mpr-empty-volume">No volume stack images</span>
                    )}
                    <span className="mpr-crosshair-h" />
                    <span className="mpr-crosshair-v" />
                    <span className="mpr-crosshair-center" />
                    <svg className="inspection-fullscreen-measurement-overlay mpr-annotation-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={`${label} annotation overlay`}>
                      {renderAnnotationOverlay({
                        measurementLines: [...mprSliceLines, ...mprPreviewLines],
                        boxes: [...mprSliceBoxes, ...pendingCubeBoxes, ...mprPreviewBoxes],
                        fontSize: 26,
                        selectedAnnotationId,
                      })}
                    </svg>
                  </div>
                  <label className="mpr-slice-control" htmlFor={`mpr-slice-${axis}`}>
                    Slice
                    <input
                      id={`mpr-slice-${axis}`}
                      type="range"
                      min="0"
                      max={upper}
                      value={slicePosition[axis]}
                      onChange={(event) => updateSlicePosition(axis, event.target.value, mprDimensions)}
                    />
                  </label>
                </article>
              );
            })}
            <article
              className={`mpr-pane mpr-pane-volume ${activeMprPane === 'volume' ? 'active-pane' : ''}`}
              data-testid="mpr-pane-3d"
              onClick={() => {
                setActiveMprPane('volume');
              }}
              onWheel={handleMprVolumeWheel}
            >
              <header className="mpr-pane-header">
                <strong>3D</strong>
                <span>Zoom {viewportTransform.zoom.toFixed(2)}x</span>
              </header>
              <div
                className="mpr-volume-scene"
                role="img"
                aria-label="3D part view with colored slicing plane reticle"
                onPointerDown={handleMprVolumePointerDown}
                onPointerMove={handleMprVolumePointerMove}
                onPointerUp={handleMprVolumePointerUp}
                onPointerCancel={handleMprVolumePointerUp}
                onDragStart={preventMprNativeDrag}
              >
                <canvas className="mpr-volume-overlay" ref={mprOverlayCanvasRef} aria-hidden="true" />
                <div
                  className={`mpr-volume-model reconstruction-${effectiveMprReconstructionMode}`}
                  style={{
                    '--volume-rotate-x': `${mprRotation.x}deg`,
                    '--volume-rotate-y': `${mprRotation.y}deg`,
                    '--volume-zoom': viewportTransform.zoom,
                    '--slice-axial-depth': `${(getFraction(slicePosition.axial, mprDimensions.axial - 1) - 0.5) * 108}px`,
                    '--slice-coronal-y': `${(getFraction(slicePosition.coronal, mprDimensions.coronal - 1) - 0.5) * 138}px`,
                    '--slice-sagittal-x': `${(getFraction(slicePosition.sagittal, mprDimensions.sagittal - 1) - 0.5) * 190}px`,
                    '--reticle-active-color': MPR_AXIS_CONFIG[activeMprPane]?.color || '#f8fafc',
                  }}
                >
                  {effectiveMprReconstructionMode === MPR_RECONSTRUCTION_MODES.stack ? (
                    volumePreviewLayers.map((layer) => (
                      <MprWindowedImage
                        key={`${layer.id}-${layer.sliceIndex}`}
                        className="volume-slice-voxel"
                        src={layer.url}
                        alt={`Volume reconstruction slice ${layer.sliceIndex}`}
                        draggable={false}
                        onDragStart={preventMprNativeDrag}
                        style={{
                          '--slice-depth': `${layer.depth}px`,
                          '--slice-opacity': layer.opacity,
                        }}
                        displayWindow={displayWindow}
                        displayDomain={displayValueDomain}
                      />
                    ))
                  ) : effectiveMprReconstructionMode === MPR_RECONSTRUCTION_MODES.shell ? (
                    shellImageLayers.map((layer) => (
                      <MprWindowedImage
                        key={`${layer.id}-${layer.viewName}`}
                        className={`volume-shell-image shell-view-${layer.viewName}`}
                        src={layer.url}
                        alt={`Fallback visual hull shell ${layer.viewName} view`}
                        draggable={false}
                        onDragStart={preventMprNativeDrag}
                        displayWindow={displayWindow}
                        displayDomain={displayValueDomain}
                      />
                    ))
                  ) : !canShowStackReconstruction && !canShowShellReconstruction ? (
                    <span className="volume-reconstruction-empty">No 3D reference</span>
                  ) : null}
                  {volumeCacheState.status === 'loading' && volumeImageStack.length > 0 && (
                    <span className="volume-cache-status">Caching slices</span>
                  )}
                  <span className="volume-box volume-face-front" />
                  <span className="volume-box volume-face-back" />
                  <span className="volume-box volume-face-left" />
                  <span className="volume-box volume-face-right" />
                  <span className="volume-box volume-face-top" />
                  <span className="volume-box volume-face-bottom" />
                  <span className={`volume-plane plane-axial ${activeMprPane === 'axial' ? 'active' : ''}`} />
                  <span className={`volume-plane plane-coronal ${activeMprPane === 'coronal' ? 'active' : ''}`} />
                  <span className={`volume-plane plane-sagittal ${activeMprPane === 'sagittal' ? 'active' : ''}`} />
                  <span className="volume-reticle reticle-x" />
                  <span className="volume-reticle reticle-y" />
                  <span className="volume-reticle reticle-z" />
                </div>
              </div>
              <div className="mpr-volume-legend" aria-label="MPR axis legend">
                {MPR_AXES.map((axis) => (
                  <span key={axis} className={`chip chip-${axis}`}>
                    <span className="overlay-swatch" style={{ backgroundColor: MPR_AXIS_CONFIG[axis].color }} />
                    {MPR_AXIS_CONFIG[axis].label}
                  </span>
                ))}
              </div>
            </article>
          </div>
          {(segmentationRun || measurementRun) && (
            <div className="workbench-notice">
              {segmentationRun && <p>Segmentation: {segmentationRun.status || 'complete'}</p>}
              {measurementRun && <p>Measurements: {measurementRun.status || 'complete'}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );

  const renderCenterPane = (tabKey) => (
    <section
      className="workbench-tabbed-panel"
      data-layout-region="center"
    >
      <div className="workspace-panel-layout" data-testid={tabKey === 'mpr' ? 'mpr-center-panel' : 'selected-image-panel'}>
        {tabKey === 'mpr' ? (
          renderMprPane()
        ) : tabKey === 'image_metadata' ? (
          !selectedPart ? (
            <p className="muted">No part selected. Select a part to review image metadata.</p>
          ) : selectedPartImageRefs.length === 0 ? (
            <p className="muted">No mapped images for this part.</p>
          ) : !selectedImageRef ? (
            <p className="muted">Select an image in Part Summary to review metadata.</p>
          ) : (
            <div className="workbench-notice" data-testid="selected-image-metadata-panel">
              <p><strong>Selected image:</strong> {safeDecodeFilename(selectedImageRef)}</p>
              <p className="muted">
                Image ID: {selectedImageRecord?.id ? String(selectedImageRecord.id) : 'Unavailable'}
              </p>
              <pre>{JSON.stringify(selectedImageRecord?.metadata || {}, null, 2)}</pre>
            </div>
          )
        ) : (
          !selectedPart ? (
            <p className="muted">No part selected. Select a part to inspect mapped images.</p>
          ) : visibleSelectedPartImageRefs.length === 0 ? (
            <p className="muted">No mapped images for this part.</p>
          ) : (
            <>
            <div className="view-board-controls">
              <div className="tile-size-control">
                <label htmlFor="inspection-tile-columns-slider">Tile size</label>
                <input
                  id="inspection-tile-columns-slider"
                  type="range"
                  aria-label="Inspection tile columns"
                  min="1"
                  max={tileColumnMax}
                  step="1"
                  value={normalizedTileColumnCount}
                  onChange={(event) => setTileColumnCount(Number(event.target.value))}
                />
                <input
                  id="inspection-tile-columns-input"
                  className="tile-size-input"
                  type="number"
                  aria-label="Inspection tile columns value"
                  min="1"
                  max={tileColumnMax}
                  step="1"
                  value={normalizedTileColumnCount}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    setTileColumnCount(Math.round(clampRange(nextValue, 1, tileColumnMax, normalizedTileColumnCount)));
                  }}
                />
                <span>{normalizedTileColumnCount} / {tileColumnMax}</span>
              </div>
              <div className="view-category-controls" aria-label="Image categories">
                {IMAGE_RENDER_CATEGORIES.map((category) => (
                  <label key={category.id}>
                    <input type="checkbox" checked={renderCategories.includes(category.id)} onChange={() => toggleRenderCategory(category.id)} />
                    {category.label}
                  </label>
                ))}
              </div>
            </div>
            <div
              className="view-board"
              data-layout-region="visual_workspace"
              style={{
                '--inspection-tile-columns': normalizedTileColumnCount,
                '--inspection-tile-min-height': `${Math.max(240, Math.round(560 / normalizedTileColumnCount))}px`,
              }}
            >
              {visibleSelectedPartImageRefs.map((entry) => {
                const viewName = entry.viewName || 'image';
                const imageRef = String(entry.imageRef || '');
                const imageRecord = projectImageLookup[entry.imageId] || projectImageLookup[imageRef];
                const imageId = imageRecord?.id || entry.imageId || '';
                const baseRecord = entry.overlay
                  ? (projectImageLookup[entry.overlayBaseImageId] || projectImageLookup[entry.overlayBaseFilename])
                  : null;
                const baseImageId = baseRecord?.id || entry.overlayBaseImageId || '';
                const annotationSourceImageId = getAnnotationSourceImageId(entry, projectImageLookup);
                const tileAnnotationSourceImageId = String(annotationSourceImageId || imageId);
	                const tileMeasurementLines = (measurementLinesByImageId[tileAnnotationSourceImageId] || [])
	                  .filter(isFiniteMeasurementLine);
		                const tileBoxes = (boxAnnotationsByImageId[tileAnnotationSourceImageId] || [])
		                  .filter(isFiniteAnnotationBox)
		                  .map((box) => getBoxWithDerivedDimensions(box, tileAnnotationSourceImageId));
	                const tilePreviewLines = tileAnnotationPreview?.mode === 'measure' && tileAnnotationPreview.imageId === tileAnnotationSourceImageId
	                  ? [tileAnnotationPreview.line].filter(isFiniteMeasurementLine)
	                  : [];
	                const tilePreviewBoxes = tileAnnotationPreview?.mode === 'box' && tileAnnotationPreview.imageId === tileAnnotationSourceImageId
		                  ? [tileAnnotationPreview.box].filter(isFiniteAnnotationBox).map((box) => getBoxWithDerivedDimensions(box, tileAnnotationSourceImageId))
		                  : [];
                return (
                  <div
                    key={entry.id}
                    className={`view-cell ${activeViewName === viewName ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedViewName(viewName);
                      setSelectedImageRef(imageRef);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedViewName(viewName);
                        setSelectedImageRef(imageRef);
                      }
                    }}
                  >
                    <div className="view-cell-title">
                      <span>{entry.label || viewName.toUpperCase()}</span>
                      {entry.overlay && entry.imageId && (
                        <button
                          type="button"
                          className="inspection-overlay-delete"
                          aria-label={`Delete overlay ${entry.label || viewName}`}
                          disabled={deletingOverlayId === String(entry.imageId)}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteAnalyzeOverlay(entry);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="view-cell-body">
                      {!imageEnabled ? (
                        <span className="view-cell-empty">Image hidden</span>
                      ) : entry.overlay && imageId && baseImageId ? (
                        <div
                          className="inspection-overlay-composite inspection-image-annotation-surface"
	                          data-testid="inspection-overlay-composite"
	                          onMouseDown={(event) => handleTileBoxPointerDown(event, imageId)}
	                          onMouseMove={(event) => handleTileAnnotationPointerMove(event, imageId)}
	                          onMouseUp={(event) => handleTileBoxPointerUp(event, imageId)}
	                          onMouseLeave={handleTileBoxPointerCancel}
	                          onClick={(event) => {
	                            event.stopPropagation();
	                            if (suppressNextTileClickRef.current) {
	                              suppressNextTileClickRef.current = false;
	                              return;
	                            }
	                            if (handleTileAnnotationPointerDown(event, imageId)) return;
	                            setFullscreenImageModal({
	                              imageId: String(imageId),
	                              baseImageId: String(baseImageId),
                              label: entry.label || viewName.toUpperCase(),
                            });
                          }}
                        >
                          <img
                            className="inspection-view-image"
                            src={`/api/images/${encodeURIComponent(String(baseImageId))}/content`}
                            alt={`${viewName} source`}
                            loading="lazy"
                          />
                          <img
                            className="inspection-view-image analysis-overlay-image"
                            src={`/api/images/${encodeURIComponent(String(imageId))}/content`}
                            alt={`${viewName} overlay`}
                            loading="lazy"
                          />
	                          <svg className="inspection-fullscreen-measurement-overlay" viewBox={`0 0 1000 1000`} preserveAspectRatio="none" aria-label="tile measurement overlay">
	                            {renderAnnotationOverlay({ measurementLines: [...tileMeasurementLines, ...tilePreviewLines], boxes: [...tileBoxes, ...tilePreviewBoxes], fontSize: 30, selectedAnnotationId })}
	                          </svg>
	                        </div>
	                      ) : imageId ? (
                        <div
                          className="inspection-image-annotation-surface"
                          onMouseDown={(event) => handleTileBoxPointerDown(event, imageId)}
                          onMouseMove={(event) => handleTileAnnotationPointerMove(event, imageId)}
                          onMouseUp={(event) => handleTileBoxPointerUp(event, imageId)}
                          onMouseLeave={handleTileBoxPointerCancel}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressNextTileClickRef.current) {
                              suppressNextTileClickRef.current = false;
                              return;
                            }
                            if (handleTileAnnotationPointerDown(event, imageId)) return;
                            setFullscreenImageModal({ imageId: String(imageId), label: entry.label || viewName.toUpperCase() });
                          }}
                        >
                          <img
                            className="inspection-view-image"
                            src={`/api/images/${encodeURIComponent(String(imageId))}/content`}
                            alt={`${viewName} view`}
                            loading="lazy"
	                          />
	                          <svg className="inspection-fullscreen-measurement-overlay" viewBox={`0 0 1000 1000`} preserveAspectRatio="none" aria-label="tile measurement overlay">
	                            {renderAnnotationOverlay({ measurementLines: [...tileMeasurementLines, ...tilePreviewLines], boxes: [...tileBoxes, ...tilePreviewBoxes], fontSize: 30, selectedAnnotationId })}
	                          </svg>
	                        </div>
                      ) : imageRef ? (
                        <span className="view-cell-empty">Image not found: {safeDecodeFilename(imageRef)}</span>
                      ) : (
                        <span className="view-cell-empty">No image mapped</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )
        )}
      </div>
    </section>
  );

	  const renderAnnotationsPane = () => (
	    <section
	      className="workbench-tabbed-panel"
	      data-layout-region={inspectionHierarchy.rightColumn}
	    >
	      <div className="annotation-controls" data-testid="annotation-controls">
	        <p className="muted">For selected part: {selectedPart?.serial_number || 'No part selected'}</p>
	        <div className="annotation-tool-buttons" aria-label="Annotation tools">
	          <button
	            type="button"
	            className={`btn btn-secondary ${annotationToolMode === 'measure' ? 'active' : ''}`}
	            aria-label="Measure on tiles"
	            onClick={() => setTileAnnotationMode('measure')}
	            disabled={!selectedPart}
	          >
	            Measure
	          </button>
	          <button
	            type="button"
	            className={`btn btn-secondary ${annotationToolMode === 'box' ? 'active' : ''}`}
	            aria-label={projectType === 'PT3' ? 'Draw box on MPR slices' : 'Draw box on tiles'}
	            onClick={() => setTileAnnotationMode('box')}
	            disabled={!selectedPart}
	          >
	            Draw box
	          </button>
	          {projectType === 'PT3' && (
	            <button
	              type="button"
	              className={`btn btn-secondary ${annotationToolMode === 'cube' ? 'active' : ''}`}
	              aria-label="Draw 3D box on MPR slices"
	              onClick={() => setTileAnnotationMode('cube')}
	              disabled={!selectedPart}
	            >
	              3D Box
	            </button>
	          )}
	          <button
	            type="button"
	            className="btn btn-secondary"
	            onClick={() => {
	              resetAnnotationDraft();
	              setOtherAnnotationModalVisible(true);
	            }}
	            disabled={!selectedPart}
	          >
	            Other
	          </button>
	        </div>
	        {annotationToolMode === 'measure' && (
	          <p className="muted annotation-tool-hint">
	            Click two points {projectType === 'PT3' ? 'on an MPR slice' : 'on a tile'} to place a measurement line.
	          </p>
	        )}
	        {annotationToolMode === 'box' && (
	          <p className="muted annotation-tool-hint">
	            Drag two corners {projectType === 'PT3' ? 'on the active MPR slice' : 'on a tile'} to draw a bounding box.
	          </p>
        )}
	        {annotationToolMode === 'cube' && (
	          <p className="muted annotation-tool-hint">
	            Draw one box, move to another slice on the same axis, then draw the second box.
	          </p>
	        )}
        <ul className="measurement-list" data-testid="annotation-list">
          {annotationsLoading ? (
            <li className="muted">Loading annotations…</li>
          ) : annotations.length === 0 ? (
            <li className="muted">No annotations captured.</li>
          ) : (
            annotations.map((annotation) => {
              const creator = getAnnotationCreator(annotation);
              const createdAt = formatAnnotationTimestamp(getAnnotationCreatedAt(annotation));
              return (
                <li
                  key={annotation.id}
                  className={`annotation-entry ${selectedAnnotationId === annotation.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  title={getAnnotationTooltip(annotation)}
                  onClick={() => setSelectedAnnotationId(annotation.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedAnnotationId(annotation.id);
                    }
                  }}
                >
                  <div className="annotation-entry-content">
                    <span className="annotation-entry-type">{getAnnotationListType(annotation)}</span>
                    <span className="annotation-entry-value">{getAnnotationListValue(annotation)}</span>
                    <span className="annotation-entry-meta">Created by {creator}</span>
                    <span className="annotation-entry-meta">{createdAt}</span>
                  </div>
                  <div className="annotation-entry-actions">
                    <button
                      type="button"
                      className="annotation-entry-edit"
                      aria-label={`Edit annotation ${annotation.comment || annotation.defect_class || annotation.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openAnnotationEditModal(annotation);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="annotation-entry-delete"
                      aria-label={`Delete annotation ${annotation.comment || annotation.defect_class || annotation.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        deleteMeasurementAnnotation(annotation.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </section>
  );

  const inspectionFlexLayoutFactory = (node) => {
    const component = node.getComponent();
    if (component === inspectionHierarchy.leftColumn) return renderPartSummaryPane();
    if (component === inspectionHierarchy.rightColumn) return renderAnnotationsPane();
    if (inspectionHierarchy.centerTabs.includes(component)) return renderCenterPane(component);
    return null;
  };

	  const handleInspectionFlexLayoutChange = (model, action) => {
	    if (action?.type !== Actions.ADJUST_WEIGHTS || availableLayoutWidth <= 0) return;
    const json = model.toJson();
    const children = json?.layout?.children || [];
    const left = children.find((child) => child.id === INSPECTION_FLEX_TABSET_IDS.left);
    const right = children.find((child) => child.id === INSPECTION_FLEX_TABSET_IDS.right);
    const totalWeight = children.reduce((sum, child) => sum + Number(child.weight || 0), 0);
    if (!left || !right || totalWeight <= 0) return;
    const availableWidth = Math.max(0, availableLayoutWidth - (children.length - 1) * RESIZE_HANDLE_WIDTH_PX);
    const nextWidths = {
      leftPx: Math.round((Number(left.weight || 0) / totalWeight) * availableWidth),
      rightPx: Math.round((Number(right.weight || 0) / totalWeight) * availableWidth),
    };
	    if (inspectionResizeSaveTimerRef.current) {
	      window.clearTimeout(inspectionResizeSaveTimerRef.current);
	    }
	    inspectionResizeSaveTimerRef.current = window.setTimeout(() => {
	      saveInspectionColumnWidths(nextWidths);
	    }, 250);
	  };

	  const renderOtherAnnotationModal = () => {
	    if (!otherAnnotationModalVisible) return null;
	    return (
	      <div className="modal" style={{ display: 'flex' }} onClick={() => setOtherAnnotationModalVisible(false)}>
	        <div className="modal-content workbench-utility-modal other-annotation-modal" role="dialog" aria-label="Other annotation" onClick={(event) => event.stopPropagation()}>
	          <div className="modal-header">
	            <h3>Other Annotation</h3>
	            <button
	              type="button"
	              className="modal-close-btn"
	              aria-label="Close other annotation"
	              onClick={() => setOtherAnnotationModalVisible(false)}
	            >
	              &times;
	            </button>
	          </div>
	          <div className="modal-body">
	            <div className="measurement-fields">
	              <select
	                aria-label="Annotation defect type"
	                value={annotationDraft.defect_class}
	                onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, defect_class: event.target.value }))}
	              >
	                <option value="">Defect type</option>
	                {configuredDefectTypes.map((defectType) => (
	                  <option key={defectType} value={defectType}>{defectType}</option>
	                ))}
	                <option value="Other">Other</option>
	              </select>
	              <input
	                type="text"
	                placeholder="annotation modality"
	                value={annotationDraft.modality}
	                onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, modality: event.target.value }))}
	              />
	              <select
	                aria-label="Annotation disposition"
	                value={annotationDraft.disposition}
	                onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, disposition: event.target.value }))}
	              >
	                <option value="open">Open</option>
	                <option value="accepted">Accepted</option>
	                <option value="rejected">Rejected</option>
	                <option value="needs_info">Needs Info</option>
	              </select>
	            </div>
	            <div className="measurement-fields">
	              <input
	                type="text"
	                placeholder="measurement name"
	                value={annotationDraft.measurement_name}
	                onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, measurement_name: event.target.value }))}
	              />
	              <input
	                type="number"
	                placeholder="measurement value"
	                value={annotationDraft.measurement_value}
	                onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, measurement_value: event.target.value }))}
	              />
	              <input
	                type="text"
	                placeholder="annotation comment"
	                value={annotationDraft.comment}
	                onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, comment: event.target.value }))}
	              />
	            </div>
		            <div className="modal-actions">
	              <button type="button" className="btn btn-secondary" onClick={() => setOtherAnnotationModalVisible(false)}>
	                Cancel
	              </button>
	              <button
	                type="button"
	                className="btn btn-primary"
	                onClick={createAnnotation}
	                disabled={!selectedPart || !annotationDraft.defect_class.trim()}
	              >
	                Save annotation
	              </button>
	            </div>
	          </div>
	        </div>
	      </div>
	    );
	  };

	



  const updateAnnotationFromModal = async () => {
    const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId);
    if (!selected || !selectedPart?.id) return;
    const draft = annotationEditDraft || {};
    const fillOpacity = clampRange(Number(draft.fill_opacity), 0, 1, getAnnotationFillOpacity(selected));
    const color = getAnnotationColor({ metadata: { annotation_color: draft.color } }, getAnnotationColor(selected));
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${selectedPart.id}/annotations/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defect_class: draft.defect_class ?? selected.defect_class,
          comment: draft.comment ?? selected.comment,
          measurements: selected.measurements || {},
          disposition: draft.disposition || selected.disposition || 'open',
          metadata: {
            ...(selected.metadata || {}),
            annotation_color: color,
            measurement_color: color,
            annotation_fill_opacity: fillOpacity,
          },
        }),
      });
      if (!resp.ok) throw new Error(`Failed to update annotation (${resp.status})`);
      const updated = await resp.json();
      setAnnotations((prev) => prev.map((annotation) => (annotation.id === updated.id ? updated : annotation)));
      closeAnnotationEditModal();
    } catch (err) {
      setError(err.message || 'Failed to update annotation');
    }
  };

  const renderAnnotationEditModal = () => {
    if (!annotationEditModalVisible) return null;
    const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId);
    if (!selected) return null;
    const draft = annotationEditDraft || {
      defect_class: selected.defect_class || '',
      comment: selected.comment || '',
      disposition: selected.disposition || 'open',
      color: getAnnotationColor(selected),
      fill_opacity: getAnnotationFillOpacity(selected),
    };
    return (
      <div className="modal" style={{ display: 'flex' }} onClick={closeAnnotationEditModal}>
        <div className="modal-content workbench-utility-modal" role="dialog" aria-label="Edit annotation" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h3>Edit Annotation</h3>
            <button
              type="button"
              className="modal-close-btn modal-close-danger"
              aria-label="Cancel edit annotation"
              onClick={closeAnnotationEditModal}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            <div className="measurement-fields">
              <input
                type="text"
                aria-label="Edit annotation defect class"
                value={draft.defect_class}
                onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), defect_class: event.target.value }))}
              />
              <select
                aria-label="Edit annotation disposition"
                value={draft.disposition}
                onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), disposition: event.target.value }))}
              >
                <option value="open">Open</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="needs_info">Needs Info</option>
              </select>
            </div>
            <div className="measurement-fields">
              <input
                type="text"
                aria-label="Edit annotation comment"
                value={draft.comment}
                onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), comment: event.target.value }))}
              />
            </div>
            <div className="measurement-fields annotation-style-fields">
              <label htmlFor="edit-annotation-color">
                Color
                <input
                  id="edit-annotation-color"
                  type="color"
                  aria-label="Edit annotation color"
                  value={draft.color || DEFAULT_ANNOTATION_COLOR}
                  onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), color: event.target.value }))}
                />
              </label>
              <label htmlFor="edit-annotation-fill-opacity">
                Fill opacity
                <input
                  id="edit-annotation-fill-opacity"
                  type="number"
                  aria-label="Edit annotation fill opacity"
                  min="0"
                  max="1"
                  step="0.05"
                  value={draft.fill_opacity ?? DEFAULT_ANNOTATION_FILL_OPACITY}
                  onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), fill_opacity: event.target.value }))}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeAnnotationEditModal}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={updateAnnotationFromModal}>Save</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSegmentationHelperModal = () => {
    if (!segmentationHelperOpen) return null;
    const axis = MPR_AXES.includes(segmentationHelperAxis) ? segmentationHelperAxis : 'axial';
    const dimensions = getMprAxisImageDimensions(axis, mprDimensions);
    const upper = Math.max(0, (mprDimensions[axis] || 1) - 1);
    const config = MPR_AXIS_CONFIG[axis] || MPR_AXIS_CONFIG.axial;
    const fallbackImage = getFallbackProjectionImage(axis, shellImageLayers);
    const crosshairStyle = getMprCrosshairStyle(axis, slicePosition, mprDimensions, mprProjectionMirror);
    const activeTool = SEGMENTATION_HELPER_TOOLS.find((tool) => tool.id === segmentationTool) || SEGMENTATION_HELPER_TOOLS[0];
    const visibleSegmentShapes = segmentationSegments.flatMap((segment) => (
      (segment.areas || [])
        .filter((shape) => shape.axis === axis && Number(shape.sliceIndex) === Number(slicePosition[axis] || 0))
        .map((shape) => ({ ...shape, segmentId: segment.id, color: segment.color }))
    ));
    const draftPoints = [
      ...getSegmentationShapePoints(segmentationDraftShape),
      ...getSegmentationShapePoints(segmentationPendingSelection),
    ];
    const brushPointerVisible = ['brush', 'eraser'].includes(segmentationTool) && segmentationPointerPreview;
    const brushPointerDiameter = Math.max(2, Number(segmentationBrushSize) || 18);

    return (
      <div className="modal segmentation-helper-modal" style={{ display: 'flex' }} onClick={closeSegmentationHelper}>
        <div
          className="modal-content segmentation-helper-modal-content"
          role="dialog"
          aria-modal="true"
          aria-label="Segmentation Helpers"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="modal-header segmentation-helper-header">
            <div>
              <h3>Segmentation Helpers</h3>
              <p className="muted">Slice tools for building local segment masks on PT3 volumes.</p>
            </div>
            <button
              type="button"
              className="modal-close-btn"
              aria-label="Close Segmentation Helpers"
              onClick={closeSegmentationHelper}
            >
              &times;
            </button>
          </div>

          <div className="segmentation-helper-body">
            <aside className="segmentation-helper-sidebar" aria-label="Segmentation helper controls">
              <div className="segmentation-orientation-switcher" aria-label="View orientation">
                {MPR_AXES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={axis === option ? 'active' : ''}
                    style={{ '--segment-axis-color': MPR_AXIS_CONFIG[option]?.color }}
                    onClick={() => {
                      setSegmentationHelperAxis(option);
                      setActiveMprPane(option);
                      cancelSegmentationDraft();
                    }}
                  >
                    {MPR_AXIS_CONFIG[option]?.label || option}
                  </button>
                ))}
              </div>

              <div className="segmentation-slice-sliders" aria-label="Slice navigation">
                {MPR_AXES.map((sliceAxis) => {
                  const sliceUpper = Math.max(0, (mprDimensions[sliceAxis] || 1) - 1);
                  return (
                    <label key={sliceAxis} htmlFor={`segmentation-helper-slice-${sliceAxis}`}>
                      <span>{MPR_AXIS_CONFIG[sliceAxis]?.sliceLabel || sliceAxis.toUpperCase()}</span>
                      <input
                        id={`segmentation-helper-slice-${sliceAxis}`}
                        type="range"
                        min="0"
                        max={sliceUpper}
                        value={slicePosition[sliceAxis]}
                        onChange={(event) => updateSlicePosition(sliceAxis, event.target.value, mprDimensions)}
                      />
                      <output>{slicePosition[sliceAxis]} / {sliceUpper}</output>
                    </label>
                  );
                })}
              </div>

              <div className="segmentation-segment-panel">
                <div className="segmentation-panel-title">
                  <h4>Segments</h4>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addSegmentationSegment}>
                    Add new segment
                  </button>
                </div>
                <ul className="segmentation-segment-list" data-testid="segmentation-segment-list">
                  {segmentationSegments.map((segment) => {
                    const selected = selectedSegmentationSegment?.id === segment.id;
                    const editing = editingSegmentationSegmentId === segment.id;
                    return (
                      <li
                        key={segment.id}
                        className={`segmentation-segment-row ${selected ? 'selected' : ''}`}
                        style={{ borderColor: selected ? segment.color : undefined }}
                      >
                        <button
                          type="button"
                          className="segmentation-segment-select"
                          onClick={() => setSelectedSegmentationSegmentId(segment.id)}
                        >
                          <span className="segmentation-segment-color" style={{ backgroundColor: segment.color }} />
                          <span>{segment.name}</span>
                          <small>{(segment.areas || []).length} areas</small>
                        </button>
                        <button
                          type="button"
                          className="annotation-entry-edit"
                          aria-label={`Edit ${segment.name}`}
                          onClick={() => {
                            setSelectedSegmentationSegmentId(segment.id);
                            setEditingSegmentationSegmentId(editing ? '' : segment.id);
                          }}
                        >
                          Edit
                        </button>
                        {editing && (
                          <div className="segmentation-segment-editor">
                            <label htmlFor={`segmentation-segment-name-${segment.id}`}>
                              Name
                              <input
                                id={`segmentation-segment-name-${segment.id}`}
                                type="text"
                                value={segment.name}
                                onChange={(event) => updateSegmentationSegment(segment.id, { name: event.target.value })}
                              />
                            </label>
                            <label htmlFor={`segmentation-segment-color-${segment.id}`}>
                              Color
                              <input
                                id={`segmentation-segment-color-${segment.id}`}
                                type="color"
                                value={segment.color}
                                onChange={(event) => updateSegmentationSegment(segment.id, { color: event.target.value })}
                              />
                            </label>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>

            <main className="segmentation-helper-main" aria-label="Segmentation helper slice workspace">
              <div className="segmentation-helper-toolbar">
                <div className="segmentation-operation-buttons" aria-label="Selection operation">
                  <button
                    type="button"
                    className={segmentationOperation === 'add' ? 'active' : ''}
                    onClick={() => setSegmentationOperation('add')}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className={segmentationOperation === 'subtract' ? 'active' : ''}
                    onClick={() => setSegmentationOperation('subtract')}
                  >
                    Subtract
                  </button>
                  <button
                    type="button"
                    disabled={!segmentationPendingSelection}
                    onClick={() => commitPendingSegmentationSelection('add')}
                  >
                    Add selection
                  </button>
                  <button
                    type="button"
                    disabled={!segmentationPendingSelection}
                    onClick={() => commitPendingSegmentationSelection('subtract')}
                  >
                    Subtract selection
                  </button>
                </div>
                <div className="segmentation-helper-current">
                  <span className="segmentation-segment-color" style={{ backgroundColor: selectedSegmentationSegment?.color || DEFAULT_SEGMENT_COLOR }} />
                  <strong>{selectedSegmentationSegment?.name || 'No segment'}</strong>
                  <span>{config.sliceLabel} {slicePosition[axis]} / {upper}</span>
                </div>
              </div>

              <div className="segmentation-tools-grid" aria-label="Segmentation tools">
                {SEGMENTATION_HELPER_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={segmentationTool === tool.id ? 'active' : ''}
                    title={tool.detail}
                    aria-label={`${tool.label}: ${tool.detail}`}
                    data-tooltip={`${tool.label}: ${tool.detail}`}
                    onClick={() => {
                      setSegmentationTool(tool.id);
                      cancelSegmentationDraft();
                    }}
                  >
                    <SegmentationToolIcon icon={tool.icon} />
                    <span className="segmentation-tool-label">{tool.label}</span>
                  </button>
                ))}
              </div>

              <div className="segmentation-tool-parameters">
                <label htmlFor="segmentation-brush-size">
                  Brush size
                  <input
                    id="segmentation-brush-size"
                    type="range"
                    min="2"
                    max="80"
                    value={segmentationBrushSize}
                    onChange={(event) => setSegmentationBrushSize(Number(event.target.value))}
                  />
                  <output>{segmentationBrushSize}px</output>
                </label>
                <label htmlFor="segmentation-sensitivity">
                  Sensitivity
                  <input
                    id="segmentation-sensitivity"
                    type="range"
                    min="2"
                    max="96"
                    value={segmentationSensitivity}
                    onChange={(event) => setSegmentationSensitivity(Number(event.target.value))}
                  />
                  <output>{segmentationSensitivity}</output>
                </label>
                <p className="muted">{activeTool.detail}</p>
                {SEGMENTATION_POINT_MARKER_TOOLS.has(segmentationTool) && (
                  <p className="muted">Defined points are shown as dots on the slice. Double-click closes polygon selections.</p>
                )}
              </div>

              {segmentationTool === 'ml-helper' && (
                <div className="segmentation-ml-panel" aria-label="ML helper options">
                  <label htmlFor="segmentation-ml-group">
                    Method family
                    <select
                      id="segmentation-ml-group"
                      value={segmentationMlGroup}
                      onChange={(event) => changeSegmentationMlGroup(event.target.value)}
                    >
                      {SEGMENTATION_ML_METHOD_GROUPS.map((group) => (
                        <option key={group.id} value={group.id}>{group.label}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="segmentation-ml-method">
                    Segment function
                    <select
                      id="segmentation-ml-method"
                      value={segmentationMlMethod}
                      onChange={(event) => changeSegmentationMlMethod(event.target.value)}
                    >
                      {getSegmentationMlMethods(segmentationMlGroup).map((method) => (
                        <option key={method.id} value={method.id}>{method.label}</option>
                      ))}
                    </select>
                  </label>
                  {(SEGMENTATION_ML_PARAMETER_FIELDS[segmentationMlMethod] || []).map((field) => (
                    <label key={field.name} htmlFor={`segmentation-ml-${field.name}`}>
                      {field.label}
                      {field.type === 'select' ? (
                        <select
                          id={`segmentation-ml-${field.name}`}
                          value={segmentationMlParameters[field.name] ?? ''}
                          onChange={(event) => updateSegmentationMlParameter(field.name, event.target.value)}
                        >
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`segmentation-ml-${field.name}`}
                          type={field.type}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={segmentationMlParameters[field.name] ?? ''}
                          onChange={(event) => updateSegmentationMlParameter(
                            field.name,
                            field.type === 'number' ? Number(event.target.value) : event.target.value,
                          )}
                        />
                      )}
                    </label>
                  ))}
                  <p className="muted">
                    {segmentationMlLoading ? 'Running analysis for this slice.' : (segmentationMlStatus || 'Click the slice to run once, cache this method result, and select the clicked segment.')}
                  </p>
                </div>
              )}

              <div
                className={`segmentation-slice-stage ${brushPointerVisible ? 'show-brush-pointer' : ''}`}
                style={{
                  '--segment-axis-color': config.color,
                  '--brush-pointer-x': brushPointerVisible ? `${segmentationPointerPreview.displayX}px` : '50%',
                  '--brush-pointer-y': brushPointerVisible ? `${segmentationPointerPreview.displayY}px` : '50%',
                  '--brush-pointer-size': `${brushPointerDiameter}px`,
                  ...crosshairStyle,
                }}
                onWheel={handleSegmentationHelperWheel}
                onMouseDown={handleSegmentationStagePointerDown}
                onMouseMove={handleSegmentationStagePointerMove}
                onMouseUp={handleSegmentationStagePointerUp}
                onMouseLeave={handleSegmentationStagePointerLeave}
                onDoubleClick={completeSegmentationPolygon}
                data-testid="segmentation-helper-stage"
              >
                {volumeImageStack.length > 0 ? (
                  <MprSliceCanvas
                    axis={axis}
                    volumeCache={volumeCacheState.cache}
                    volumeCacheStatus={volumeCacheState.status}
                    slicePosition={slicePosition}
                    dimensions={mprDimensions}
                    displayWindow={displayWindow}
                    displayDomain={displayValueDomain}
                  />
                ) : fallbackImage ? (
                  <MprWindowedImage
                    className="mpr-fallback-projection"
                    src={fallbackImage.url}
                    alt={`${config.label} segmentation helper fallback`}
                    displayWindow={displayWindow}
                    displayDomain={displayValueDomain}
                  />
                ) : (
                  <span className="mpr-empty-volume">No volume stack images</span>
                )}
                <svg
                  className="segmentation-helper-overlay"
                  viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                  preserveAspectRatio="none"
                  aria-label="Segmentation helper overlay"
                >
                  {visibleSegmentShapes.map((shape, index) => (
                    <g
                      key={getSegmentationShapeKey(shape, index)}
                      className={shape.segmentId === selectedSegmentationSegment?.id ? 'active-segment' : ''}
                    >
                      {renderSegmentationShape(shape, {
                        color: shape.color,
                        fillColor: shape.color,
                        fillOpacity: shape.operation === 'subtract' ? 0.08 : 0.2,
                      })}
                    </g>
                  ))}
                  {segmentationPendingSelection && renderSegmentationShape(segmentationPendingSelection, {
                    color: '#fde047',
                    fillColor: '#fde047',
                    fillOpacity: 0.18,
                    preview: true,
                    strokeWidth: 3,
                  })}
                  {segmentationDraftShape && renderSegmentationShape(segmentationDraftShape, {
                    color: '#f8fafc',
                    fillColor: selectedSegmentationSegment?.color || DEFAULT_SEGMENT_COLOR,
                    fillOpacity: 0.15,
                    preview: true,
                    strokeWidth: 3,
                  })}
                </svg>
                <div className="segmentation-helper-point-layer" aria-hidden="true">
                  {draftPoints.map((point, index) => (
                    <span
                      key={`segmentation-point-${index}-${point.x}-${point.y}`}
                      className="segmentation-helper-point"
                      style={{
                        left: `${Math.max(0, Math.min(100, (point.x / Math.max(1, dimensions.width)) * 100))}%`,
                        top: `${Math.max(0, Math.min(100, (point.y / Math.max(1, dimensions.height)) * 100))}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    );
  };

  const renderWorkbenchModal = () => {
    if (!activeWorkbenchModal) return null;
    const modalTitle = activeWorkbenchModal === 'parts' ? 'Part Selection' : 'Annotations';
    return (
      <div className="modal" style={{ display: 'flex' }} onClick={() => setActiveWorkbenchModal(null)}>
        <div className="modal-content workbench-utility-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h3>{modalTitle}</h3>
            <button
              type="button"
              className="modal-close-btn"
              aria-label={`Close ${modalTitle}`}
              onClick={() => setActiveWorkbenchModal(null)}
            >
              &times;
            </button>
          </div>
          <div className="modal-body">
            {activeWorkbenchModal === 'parts' ? renderPartSummaryPane() : renderAnnotationsPane()}
          </div>
        </div>
      </div>
    );
  };

  const renderPt3FocusedWorkbench = () => (
    <div className="workbench-details workbench-details-pt3" ref={workbenchDetailsRef}>
      <div className="pt3-mpr-topbar">
        <div className="pt3-mpr-context">
          <strong>{selectedPart?.display_name || selectedPart?.serial_number || 'No part selected'}</strong>
          <span>Batches: {batches.length}</span>
          <span>Parts: {parts.length}</span>
          <span>Passed: {reviewSummary.pass}</span>
          <span>Rejected: {reviewSummary.reject_confirmed + reviewSummary.reject_pending}</span>
          <span className="pt3-hotkey-hints" data-testid="inspector-hotkey-hints">
            Hotkeys: pass ({inspectorHotkeys.accept_classification.toUpperCase()}), reject (
            {inspectorHotkeys.reject_classification.toUpperCase()}), shortcuts help (
            {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}).
          </span>
        </div>
        <div className="workbench-detail-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setActiveWorkbenchModal('parts')}>
            Part Selection
          </button>
          {selectedPart && (
            <>
              <button
                className="btn btn-success"
                disabled={savingPartId === selectedPart.id}
                onClick={() => updatePartReviewState(selectedPart, 'pass')}
              >
                Pass
              </button>
              <button
                className="btn btn-danger"
                disabled={savingPartId === selectedPart.id}
                onClick={() => updatePartReviewState(selectedPart, 'reject_confirmed')}
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
      {shortcutHelpVisible && (
        <div className="workbench-notice" data-testid="shortcut-help-panel">
          <strong>Shortcut help</strong>
          <ul>
            <li>Mark Pass: {inspectorHotkeys.accept_classification.toUpperCase()}</li>
            <li>Reject: {inspectorHotkeys.reject_classification.toUpperCase()}</li>
            <li>Toggle this help: {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}</li>
          </ul>
        </div>
      )}
      <div className="pt3-inspection-layout" data-testid="pt3-inspection-layout">
        <div className="pt3-mpr-center">
          {renderMprPane()}
        </div>
        <aside className="pt3-annotations-column" aria-label="PT3 annotations">
          {renderAnnotationsPane()}
        </aside>
      </div>
      {renderWorkbenchModal()}
    </div>
  );



  const classifyMeasurementLine = (line) => {
    const dx = Math.abs(line.x2 - line.x1);
    const dy = Math.abs(line.y2 - line.y1);
    const horizontal = dy <= Math.max(dx, 1) * 0.1;
    const vertical = dx <= Math.max(dy, 1) * 0.1;
    if (horizontal) return 'Horizontal';
    if (vertical) return 'Vertical';
    return 'Diagonal';
  };

  const nextMeasurementName = (kind) => {
    const count = fullscreenMeasurements.filter((item) => item.kind === kind).length + 1;
    return `${kind} line ${count}`;
  };

	  const getLineDistanceMm = (line, imageId) => {
	    const pixelsPerMm = Number(getCalibrationForImage(getAnnotationSourceImageIdForImage(imageId))?.pixels_per_mm || 0);
	    const distancePx = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
	    return pixelsPerMm > 0 ? distancePx / pixelsPerMm : null;
	  };

	  const getBoxWithDerivedDimensions = (box, imageId) => {
	    if (!isFiniteAnnotationBox(box)) return box;
	    const pixelsPerMm = Number(getCalibrationForImage(getAnnotationSourceImageIdForImage(imageId))?.pixels_per_mm || 0);
	    if (pixelsPerMm <= 0) return box;
	    const widthMm = Number.isFinite(Number(box.widthMm)) ? Number(box.widthMm) : Number(box.width) / pixelsPerMm;
	    const heightMm = Number.isFinite(Number(box.heightMm)) ? Number(box.heightMm) : Number(box.height) / pixelsPerMm;
	    return { ...box, widthMm, heightMm };
	  };

  const getAnnotationSurfacePointerPosition = (event) => {
    const surface = event.currentTarget;
    const image = surface.tagName === 'IMG'
      ? surface
      : surface.querySelector('img.inspection-view-image:not(.analysis-overlay-image)') || surface.querySelector('img');
    const rect = image?.getBoundingClientRect?.() || surface.getBoundingClientRect();
    const naturalWidth = Number(image?.naturalWidth || rect.width);
    const naturalHeight = Number(image?.naturalHeight || rect.height);
    if (!rect.width || !rect.height || !naturalWidth || !naturalHeight) return null;
    const displayX = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const displayY = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
    const x = (displayX / rect.width) * naturalWidth;
    const y = (displayY / rect.height) * naturalHeight;
    if (![x, y, naturalWidth, naturalHeight].every(Number.isFinite)) return null;
    return { x, y, imageWidth: naturalWidth, imageHeight: naturalHeight };
  };

  const makeBoxFromPoints = (firstPoint, secondPoint) => {
    if (!firstPoint || !secondPoint) return null;
    const x = Math.min(firstPoint.x, secondPoint.x);
    const y = Math.min(firstPoint.y, secondPoint.y);
    const width = Math.abs(secondPoint.x - firstPoint.x);
    const height = Math.abs(secondPoint.y - firstPoint.y);
    return {
      x,
      y,
      width,
      height,
      imageWidth: secondPoint.imageWidth || firstPoint.imageWidth,
      imageHeight: secondPoint.imageHeight || firstPoint.imageHeight,
    };
  };

	  const handleTileAnnotationPointerDown = (event, imageId) => {
	    if (!annotationToolMode) return false;
	    event.preventDefault();
	    event.stopPropagation();
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return true;
    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
    if (annotationToolMode === 'measure') {
      const firstPoint = tileAnnotationDraft?.mode === 'measure' ? tileAnnotationDraft : null;
      if (!firstPoint) {
        setTileAnnotationDraft({ ...position, mode: 'measure', imageId: annotationImageId });
        return true;
      }
      const line = { x1: firstPoint.x, y1: firstPoint.y, x2: position.x, y2: position.y, imageWidth: position.imageWidth, imageHeight: position.imageHeight };
      const existingLineCount = (measurementLinesByImageId[String(annotationImageId || '')] || []).length;
      const color = MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length];
	      createMeasurementAnnotation({
	        imageId: annotationImageId,
	        line,
	        name: nextMeasurementName(classifyMeasurementLine(line)),
	        color,
	        distanceMm: getLineDistanceMm(line, annotationImageId),
	      });
	      setTileAnnotationDraft(null);
	      setTileAnnotationPreview(null);
	      setAnnotationToolMode('');
	      return true;
	    }
	    if (annotationToolMode === 'box') return true;
	    return true;
	  };

	  const handleTileBoxPointerDown = (event, imageId) => {
	    if (annotationToolMode !== 'box') return false;
	    if (event.button !== undefined && event.button !== 0) return false;
	    event.preventDefault();
	    event.stopPropagation();
	    const position = getAnnotationSurfacePointerPosition(event);
	    if (!position) return true;
	    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
	    const nextPoint = { ...position, mode: 'box', imageId: annotationImageId };
	    tileAnnotationDraftRef.current = nextPoint;
	    setTileAnnotationDraft(nextPoint);
	    setTileAnnotationPreview(null);
	    suppressNextTileClickRef.current = true;
	    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
	    return true;
	  };

	  const handleTileBoxPointerUp = (event, imageId) => {
	    if (annotationToolMode !== 'box') return false;
	    event.preventDefault();
	    event.stopPropagation();
	    suppressNextTileClickRef.current = true;
	    const firstPoint = tileAnnotationDraftRef.current || (tileAnnotationDraft?.mode === 'box' ? tileAnnotationDraft : null);
	    const position = getAnnotationSurfacePointerPosition(event);
	    if (firstPoint && position) {
	      const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
	      const box = makeBoxFromPoints(firstPoint, position);
	      if (isFiniteAnnotationBox(box)) {
	        const existingBoxCount = (boxAnnotationsByImageId[String(annotationImageId || '')] || []).length;
	        createBoxAnnotation({
	          imageId: annotationImageId,
	          box,
	          name: 'Drawn bounding box',
	          color: MEASUREMENT_COLORS[existingBoxCount % MEASUREMENT_COLORS.length],
	        });
	      }
	    }
	    tileAnnotationDraftRef.current = null;
	    setTileAnnotationDraft(null);
	    setTileAnnotationPreview(null);
	    setAnnotationToolMode('');
	    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
	    return true;
	  };

	  const handleTileBoxPointerCancel = (event) => {
	    if (!tileAnnotationDraftRef.current && tileAnnotationDraft?.mode !== 'box') return;
	    event.preventDefault();
	    event.stopPropagation();
	    tileAnnotationDraftRef.current = null;
	    setTileAnnotationDraft(null);
	    setTileAnnotationPreview(null);
	    setAnnotationToolMode('');
	    suppressNextTileClickRef.current = true;
	    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
	  };

	  const handleTileAnnotationPointerMove = (event, imageId) => {
	    const annotationImageId = getAnnotationSourceImageIdForImage(imageId);
	    const position = getAnnotationSurfacePointerPosition(event);
	    if (!position) return;
	    if (annotationToolMode === 'measure' && tileAnnotationDraft?.mode === 'measure' && String(tileAnnotationDraft.imageId || '') === String(annotationImageId || '')) {
	      const line = {
	        id: 'tile-measure-preview',
	        imageId: String(annotationImageId || ''),
	        x1: tileAnnotationDraft.x,
	        y1: tileAnnotationDraft.y,
	        x2: position.x,
	        y2: position.y,
	        imageWidth: position.imageWidth,
	        imageHeight: position.imageHeight,
	        color: '#f97316',
	        distancePx: Math.hypot(position.x - tileAnnotationDraft.x, position.y - tileAnnotationDraft.y),
	        distanceMm: getLineDistanceMm(
	          { x1: tileAnnotationDraft.x, y1: tileAnnotationDraft.y, x2: position.x, y2: position.y },
	          annotationImageId,
	        ),
	      };
	      setTileAnnotationPreview({ mode: 'measure', imageId: String(annotationImageId || ''), line });
	      return;
	    }
	    const firstPoint = tileAnnotationDraftRef.current || (tileAnnotationDraft?.mode === 'box' ? tileAnnotationDraft : null);
	    if (annotationToolMode === 'box' && firstPoint && String(firstPoint.imageId || '') === String(annotationImageId || '')) {
	      const box = {
	        ...makeBoxFromPoints(firstPoint, position),
	        id: 'tile-box-preview',
	        imageId: String(annotationImageId || ''),
	        color: '#f97316',
	      };
	      setTileAnnotationPreview({ mode: 'box', imageId: String(annotationImageId || ''), box });
	    }
	  };

  const handleMprAnnotationPointerDown = (event, axis) => {
    if (!['measure', 'box', 'cube'].includes(annotationToolMode)) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    setActiveMprPane(axis);
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return true;
    const sliceIndex = Number(slicePosition[axis] || 0);
    if (annotationToolMode === 'measure') {
      const firstPoint = mprAnnotationDraft?.mode === 'measure' && mprAnnotationDraft.axis === axis
        ? mprAnnotationDraft
        : null;
      if (!firstPoint) {
        setMprAnnotationDraft({ ...position, mode: 'measure', axis, sliceIndex });
        return true;
      }
      const line = {
        x1: firstPoint.x,
        y1: firstPoint.y,
        x2: position.x,
        y2: position.y,
        imageWidth: position.imageWidth,
        imageHeight: position.imageHeight,
        axis,
        slice_index: firstPoint.sliceIndex,
      };
      const key = getMprSliceKey(axis, firstPoint.sliceIndex);
      const existingLineCount = (mprMeasurementLinesBySlice[key] || []).length;
      createMeasurementAnnotation({
        imageId: null,
        line,
        name: nextMeasurementName(classifyMeasurementLine(line)),
        color: MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length],
        modality: 'volume',
        geometryPatch: { axis, slice_index: firstPoint.sliceIndex },
      });
      setMprAnnotationDraft(null);
      setMprAnnotationPreview(null);
      setAnnotationToolMode('');
      return true;
    }
    const nextPoint = { ...position, mode: annotationToolMode, axis, sliceIndex };
    mprAnnotationDraftRef.current = nextPoint;
    if (!(annotationToolMode === 'cube' && mprAnnotationDraft?.mode === 'cube-pending')) {
      setMprAnnotationDraft(nextPoint);
    }
    setMprAnnotationPreview(null);
    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  };

  const handleMprAnnotationPointerMove = (event, axis) => {
    if (!['measure', 'box', 'cube'].includes(annotationToolMode)) return;
    const position = getAnnotationSurfacePointerPosition(event);
    if (!position) return;
    const sliceIndex = Number(slicePosition[axis] || 0);
    if (annotationToolMode === 'measure' && mprAnnotationDraft?.mode === 'measure' && mprAnnotationDraft.axis === axis) {
      const line = {
        id: 'mpr-measure-preview',
        imageId: getMprSliceKey(axis, mprAnnotationDraft.sliceIndex),
        x1: mprAnnotationDraft.x,
        y1: mprAnnotationDraft.y,
        x2: position.x,
        y2: position.y,
        imageWidth: position.imageWidth,
        imageHeight: position.imageHeight,
        axis,
        sliceIndex: mprAnnotationDraft.sliceIndex,
        color: DEFAULT_ANNOTATION_COLOR,
        distancePx: Math.hypot(position.x - mprAnnotationDraft.x, position.y - mprAnnotationDraft.y),
        distanceMm: null,
      };
      setMprAnnotationPreview({ mode: 'measure', axis, sliceIndex: mprAnnotationDraft.sliceIndex, line });
      return;
    }
    const firstPoint = mprAnnotationDraftRef.current;
    if (firstPoint && firstPoint.axis === axis && ['box', 'cube'].includes(annotationToolMode)) {
      const box = {
        ...makeBoxFromPoints(firstPoint, position),
        id: `mpr-${annotationToolMode}-preview`,
        imageId: getMprSliceKey(axis, sliceIndex),
        color: DEFAULT_ANNOTATION_COLOR,
        fillOpacity: DEFAULT_ANNOTATION_FILL_OPACITY,
        axis,
        sliceIndex,
      };
      setMprAnnotationPreview({ mode: annotationToolMode, axis, sliceIndex, box });
    }
  };

  const handleMprAnnotationPointerUp = (event, axis) => {
    if (!['box', 'cube'].includes(annotationToolMode)) return false;
    event.preventDefault();
    event.stopPropagation();
    const firstPoint = mprAnnotationDraftRef.current;
    const position = getAnnotationSurfacePointerPosition(event);
    const sliceIndex = Number(slicePosition[axis] || 0);
    if (firstPoint && position && firstPoint.axis === axis) {
      const box = {
        ...makeBoxFromPoints(firstPoint, position),
        axis,
        sliceIndex,
      };
      if (isFiniteAnnotationBox(box)) {
        if (annotationToolMode === 'box') {
          const key = getMprSliceKey(axis, sliceIndex);
          const existingBoxCount = (mprBoxAnnotationsBySlice[key] || []).length;
          createBoxAnnotation({
            imageId: null,
            box,
            name: 'Drawn MPR bounding box',
            color: MEASUREMENT_COLORS[existingBoxCount % MEASUREMENT_COLORS.length],
            modality: 'volume',
            geometryPatch: { axis, slice_index: sliceIndex, box: { axis, slice_index: sliceIndex } },
          });
          setAnnotationToolMode('');
        } else {
          const firstCubeBox = mprAnnotationDraft?.mode === 'cube-pending' ? mprAnnotationDraft.box : null;
          if (firstCubeBox && firstCubeBox.axis === axis && Number(firstCubeBox.sliceIndex) !== sliceIndex) {
            createCubeAnnotation({
              axis,
              firstBox: firstCubeBox,
              secondBox: box,
              color: DEFAULT_ANNOTATION_COLOR,
            });
            setAnnotationToolMode('');
            setMprAnnotationDraft(null);
          } else {
            setMprAnnotationDraft({ mode: 'cube-pending', axis, sliceIndex, box });
          }
        }
      }
    }
    mprAnnotationDraftRef.current = null;
    setMprAnnotationPreview(null);
    if (annotationToolMode !== 'cube') setMprAnnotationDraft(null);
    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
    return true;
  };

  const handleMprAnnotationPointerCancel = (event) => {
    if (!mprAnnotationDraftRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    mprAnnotationDraftRef.current = null;
    setMprAnnotationPreview(null);
    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const getFullscreenImagePointerPosition = (event) => {
    const image = fullscreenImageRef.current;
    if (!image) return null;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || !image.naturalWidth || !image.naturalHeight) return null;
    const rawDisplayX = event.clientX - rect.left;
    const rawDisplayY = event.clientY - rect.top;
    const displayX = Math.min(rect.width, Math.max(0, rawDisplayX));
    const displayY = Math.min(rect.height, Math.max(0, rawDisplayY));
    const x = (displayX / rect.width) * image.naturalWidth;
    const y = (displayY / rect.height) * image.naturalHeight;
    if (![x, y, displayX, displayY].every(Number.isFinite)) return null;
    return { x, y, displayX, displayY, rawDisplayX, rawDisplayY, rect, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
  };

  const findHoveredMeasurementEndpoint = (position, lines) => {
    if (!position || !Array.isArray(lines) || lines.length === 0) return null;
    let closest = null;
    lines.forEach((line) => {
      if (!isFiniteMeasurementLine(line)) return;
      const threshold = Math.max(6, Number(line.imageWidth) * MEASUREMENT_ENDPOINT_HOVER_RATIO);
      [
        { endpoint: 'start', x: Number(line.x1), y: Number(line.y1) },
        { endpoint: 'end', x: Number(line.x2), y: Number(line.y2) },
      ].forEach((candidate) => {
        const distance = Math.hypot(position.x - candidate.x, position.y - candidate.y);
        if (distance <= threshold && (!closest || distance < closest.distance)) {
          closest = { lineId: String(line.id), endpoint: candidate.endpoint, distance };
        }
      });
    });
    return closest;
  };

  const findHoveredBoxCorner = (position, boxes) => {
    if (!position || !Array.isArray(boxes) || boxes.length === 0) return null;
    let closest = null;
    boxes.forEach((box) => {
      if (!isFiniteAnnotationBox(box)) return;
      const threshold = Math.max(6, Number(box.imageWidth) * MEASUREMENT_ENDPOINT_HOVER_RATIO);
      Object.entries(getAnnotationBoxCornerPoints(box)).forEach(([corner, point]) => {
        const distance = Math.hypot(position.x - point.x, position.y - point.y);
        if (distance <= threshold && (!closest || distance < closest.distance)) {
          closest = { boxId: String(box.id), corner, distance };
        }
      });
    });
    return closest;
  };

  const getReducedSensitivityPosition = (position, anchor) => {
    if (!position || !anchor) return position;
    const x = Number(anchor.x) + ((Number(position.x) - Number(anchor.x)) * MEASUREMENT_LOCAL_ZOOM_POINTER_SENSITIVITY);
    const y = Number(anchor.y) + ((Number(position.y) - Number(anchor.y)) * MEASUREMENT_LOCAL_ZOOM_POINTER_SENSITIVITY);
    return {
      ...position,
      x: Math.min(position.naturalWidth, Math.max(0, x)),
      y: Math.min(position.naturalHeight, Math.max(0, y)),
    };
  };

  const makeBoxFromMovedCorner = (box, corner, point, naturalWidth, naturalHeight) => {
    if (!isFiniteAnnotationBox(box) || !corner || !point) return null;
    const oppositeCorner = getAnnotationBoxOppositeCornerName(corner);
    const oppositePoint = getAnnotationBoxCornerPoints(box)[oppositeCorner];
    if (!oppositePoint) return null;
    return makeBoxFromPoints(
      { x: point.x, y: point.y, imageWidth: naturalWidth || box.imageWidth, imageHeight: naturalHeight || box.imageHeight },
      { x: oppositePoint.x, y: oppositePoint.y, imageWidth: naturalWidth || box.imageWidth, imageHeight: naturalHeight || box.imageHeight },
    );
  };

  const updateFullscreenZoomLens = (position, nextScale = fullscreenZoomScale) => {
    if (!position) {
      setFullscreenZoomLens(null);
      return;
    }
    const diameter = Math.max(1, position.rect.width * MEASUREMENT_LOCAL_ZOOM_DIAMETER_RATIO);
    setFullscreenZoomLens({
      displayX: position.displayX,
      displayY: position.displayY,
      naturalX: position.x,
      naturalY: position.y,
      naturalWidth: position.naturalWidth,
      naturalHeight: position.naturalHeight,
      imageDisplayWidth: position.rect.width,
      imageDisplayHeight: position.rect.height,
      diameter,
      scale: nextScale,
      backgroundSize: `${position.rect.width * nextScale}px ${position.rect.height * nextScale}px`,
      backgroundPosition: `${(diameter / 2) - (position.displayX * nextScale)}px ${(diameter / 2) - (position.displayY * nextScale)}px`,
    });
  };

	  const updateFullscreenImageZoomFromWheel = (event) => {
	    if (fullscreenMeasureActive || fullscreenBoxActive || fullscreenEditingEndpoint) return;
	    const position = getFullscreenImagePointerPosition(event);
	    if (!position) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextScale = Math.min(
      FULLSCREEN_IMAGE_ZOOM_MAX,
      Math.max(FULLSCREEN_IMAGE_ZOOM_MIN, fullscreenImageZoom.scale * (direction > 0 ? 1.15 : 1 / 1.15)),
    );
	    setFullscreenImageZoom({
	      scale: nextScale,
	      originX: (position.displayX / position.rect.width) * 100,
	      originY: (position.displayY / position.rect.height) * 100,
	      panX: fullscreenImageZoom.panX || 0,
	      panY: fullscreenImageZoom.panY || 0,
	    });
	  };

  const toggleFullscreenMeasure = () => {
    if (fullscreenMeasureActive) {
      setFullscreenMeasureActive(false);
      setPendingMeasurePoint(null);
      pendingMeasurePointRef.current = null;
	      setFullscreenHoveredEndpoint(null);
	      setFullscreenEditingEndpoint(null);
      setFullscreenHoveredBoxCorner(null);
      setFullscreenEditingBoxCorner(null);
	      setFullscreenZoomLens(null);
	      setFullscreenAnnotationPreview(null);
	      return;
	    }
    if (!getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId))) {
      setFullscreenCalibrationPromptVisible(true);
      return;
    }
	    setFullscreenCalibrationPromptVisible(false);
	    setFullscreenBoxActive(false);
	    setPendingBoxPoint(null);
	    pendingBoxPointRef.current = null;
    setFullscreenHoveredBoxCorner(null);
    setFullscreenEditingBoxCorner(null);
	    setFullscreenAnnotationPreview(null);
	    setFullscreenMeasureActive(true);
	  };

	  const toggleFullscreenBox = () => {
	    if (fullscreenBoxActive) {
	      setFullscreenBoxActive(false);
	      setPendingBoxPoint(null);
	      pendingBoxPointRef.current = null;
      setFullscreenHoveredBoxCorner(null);
      setFullscreenEditingBoxCorner(null);
	      setFullscreenAnnotationPreview(null);
	      return;
	    }
	    setFullscreenMeasureActive(false);
	    setPendingMeasurePoint(null);
	    pendingMeasurePointRef.current = null;
	    setFullscreenCalibrationPromptVisible(false);
	    setFullscreenEditingEndpoint(null);
	    setFullscreenHoveredEndpoint(null);
    setFullscreenHoveredBoxCorner(null);
    setFullscreenEditingBoxCorner(null);
	    setFullscreenZoomLens(null);
	    setFullscreenAnnotationPreview(null);
	    setFullscreenBoxActive(true);
	  };

	  const commitFullscreenBox = async (box) => {
	    if (isFiniteAnnotationBox(box)) {
	      const annotationSourceImageId = getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId);
	      const existingBoxCount = (boxAnnotationsByImageId[String(annotationSourceImageId || '')] || []).length;
	      await createBoxAnnotation({
	        imageId: fullscreenImageModal?.imageId,
	        box,
	        name: 'Drawn bounding box',
	        color: MEASUREMENT_COLORS[existingBoxCount % MEASUREMENT_COLORS.length],
	      });
	    }
	    setPendingBoxPoint(null);
	    pendingBoxPointRef.current = null;
	    setFullscreenAnnotationPreview(null);
	  };

  const commitFullscreenMeasureLine = async (line) => {
    if (!line) return;
    if (!getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId))) {
      setPendingMeasurePoint(null);
      pendingMeasurePointRef.current = null;
      setFullscreenMeasureActive(false);
      setFullscreenCalibrationPromptVisible(true);
      return;
    }
    const kind = classifyMeasurementLine(line);
    const name = nextMeasurementName(kind);
    const annotationSourceImageId = getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId);
    const existingLineCount = (measurementLinesByImageId[String(annotationSourceImageId || '')] || []).length
      + fullscreenMeasurements.filter((item) => String(item.imageId || '') === String(annotationSourceImageId || '')).length;
    const color = MEASUREMENT_COLORS[existingLineCount % MEASUREMENT_COLORS.length];
    const distancePx = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const distanceMm = getLineDistanceMm(line, annotationSourceImageId);
    const created = await createMeasurementAnnotation({ imageId: fullscreenImageModal?.imageId, line, name, color, distanceMm });
    if (created && (!created.image_id || !created.geometry?.line)) {
      setFullscreenMeasurements((prev) => [...prev, { ...line, id: created.id, imageId: String(annotationSourceImageId || ''), name, kind, color, distanceMm, distancePx }]);
    }
	    setPendingMeasurePoint(null);
	    pendingMeasurePointRef.current = null;
	    setFullscreenAnnotationPreview(null);
	    setFullscreenMeasureActive(false);
	  };

  const handleFullscreenMeasurePointerDown = async (event) => {
    const position = getFullscreenImagePointerPosition(event);
    if (!position) return;
    if (fullscreenEditingEndpoint?.lineId) {
      const sourceLine = fullscreenEditingEndpoint.line;
      const lensAnchoredPosition = fullscreenZoomLens && Number.isFinite(fullscreenZoomLens.naturalX) && Number.isFinite(fullscreenZoomLens.naturalY)
        ? {
            ...position,
            x: fullscreenZoomLens.naturalX,
            y: fullscreenZoomLens.naturalY,
            naturalWidth: fullscreenZoomLens.naturalWidth || position.naturalWidth,
            naturalHeight: fullscreenZoomLens.naturalHeight || position.naturalHeight,
          }
        : position;
      const adjustedPosition = getReducedSensitivityPosition(lensAnchoredPosition, fullscreenEditingEndpoint.anchor);
      const coordinatePatch = fullscreenEditingEndpoint.endpoint === 'start'
        ? { x1: adjustedPosition.x, y1: adjustedPosition.y }
        : { x2: adjustedPosition.x, y2: adjustedPosition.y };
      const nextLine = {
        ...sourceLine,
        ...coordinatePatch,
        imageWidth: position.naturalWidth,
        imageHeight: position.naturalHeight,
      };
      await updateMeasurementAnnotationLine(fullscreenEditingEndpoint.lineId, nextLine);
      setFullscreenEditingEndpoint(null);
      setFullscreenHoveredEndpoint(null);
      setFullscreenZoomLens(null);
      return;
    }
    if (fullscreenEditingBoxCorner?.boxId) {
      const adjustedPosition = getReducedSensitivityPosition(position, fullscreenEditingBoxCorner.anchor);
      const nextBox = makeBoxFromMovedCorner(
        fullscreenEditingBoxCorner.box,
        fullscreenEditingBoxCorner.corner,
        adjustedPosition,
        position.naturalWidth,
        position.naturalHeight,
      );
      if (nextBox && isFiniteAnnotationBox(nextBox)) {
        await updateBoxAnnotationGeometry(fullscreenEditingBoxCorner.boxId, {
          ...nextBox,
          id: fullscreenEditingBoxCorner.boxId,
          color: fullscreenEditingBoxCorner.box.color,
        });
      }
      setFullscreenEditingBoxCorner(null);
      setFullscreenHoveredBoxCorner(null);
      setFullscreenZoomLens(null);
      return;
    }
	    if (fullscreenBoxActive) return;
	    if (!fullscreenMeasureActive) return;
    if (!getCalibrationForImage(getAnnotationSourceImageIdForImage(fullscreenImageModal?.imageId))) {
      setFullscreenMeasureActive(false);
      setFullscreenCalibrationPromptVisible(true);
      setPendingMeasurePoint(null);
      pendingMeasurePointRef.current = null;
      return;
    }
    const { x, y, naturalWidth, naturalHeight } = position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const firstPoint = pendingMeasurePointRef.current || pendingMeasurePoint;
    if (!firstPoint) {
	      const nextPoint = { x, y, imageWidth: naturalWidth, imageHeight: naturalHeight };
	      pendingMeasurePointRef.current = nextPoint;
	      setPendingMeasurePoint(nextPoint);
	      setFullscreenAnnotationPreview(null);
	      return;
    }
    const line = { x1: firstPoint.x, y1: firstPoint.y, x2: x, y2: y, imageWidth: naturalWidth, imageHeight: naturalHeight };
	    if (!isFiniteMeasurementLine(line)) return;
	    await commitFullscreenMeasureLine(line);
	  };

	  const handleFullscreenBoxPointerDown = (event) => {
	    if (!fullscreenBoxActive) return;
	    if (event.button !== undefined && event.button !== 0) return;
	    const position = getFullscreenImagePointerPosition(event);
	    if (!position) return;
	    event.preventDefault();
	    event.stopPropagation();
	    const nextPoint = {
	      x: position.x,
	      y: position.y,
	      imageWidth: position.naturalWidth,
	      imageHeight: position.naturalHeight,
	    };
	    pendingBoxPointRef.current = nextPoint;
	    setPendingBoxPoint(nextPoint);
	    setFullscreenAnnotationPreview(null);
	    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
	  };

	  const handleFullscreenBoxPointerUp = async (event) => {
	    if (!fullscreenBoxActive) return;
	    const position = getFullscreenImagePointerPosition(event);
	    event.preventDefault();
	    event.stopPropagation();
	    const firstPoint = pendingBoxPointRef.current || pendingBoxPoint;
	    if (firstPoint && position) {
	      const box = makeBoxFromPoints(firstPoint, {
	        x: position.x,
	        y: position.y,
	        imageWidth: position.naturalWidth,
	        imageHeight: position.naturalHeight,
	      });
	      await commitFullscreenBox(box);
	    } else {
	      setPendingBoxPoint(null);
	      pendingBoxPointRef.current = null;
	      setFullscreenAnnotationPreview(null);
	      setFullscreenBoxActive(false);
	    }
	    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
	  };

	  const handleFullscreenBoxPointerCancel = (event) => {
	    if (!fullscreenBoxActive && !pendingBoxPointRef.current) return;
	    event.preventDefault();
	    event.stopPropagation();
	    setPendingBoxPoint(null);
	    pendingBoxPointRef.current = null;
	    setFullscreenAnnotationPreview(null);
	    setFullscreenBoxActive(false);
	    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
	  };

	  const handleFullscreenImageWheel = (event) => {
	    if (fullscreenEditingEndpoint?.lineId || fullscreenEditingBoxCorner?.boxId) {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextScale = Math.min(
        MEASUREMENT_LOCAL_ZOOM_MAX_SCALE,
        Math.max(MEASUREMENT_LOCAL_ZOOM_MIN_SCALE, fullscreenZoomScale + (direction * 1)),
      );
      setFullscreenZoomScale(nextScale);
      updateFullscreenZoomLens(getFullscreenImagePointerPosition(event), nextScale);
      return;
    }
	    updateFullscreenImageZoomFromWheel(event);
	  };

	  const canPanFullscreenImage = () => (
	    !fullscreenMeasureActive
	    && !fullscreenBoxActive
	    && !fullscreenEditingEndpoint?.lineId
	    && !fullscreenEditingBoxCorner?.boxId
	    && !fullscreenCalibrationPromptVisible
	  );

	  const handleFullscreenPanMouseDown = (event) => {
	    if (!canPanFullscreenImage()) return;
	    if (event.button !== undefined && event.button !== 0) return;
	    if (event.target?.classList?.contains('inspection-measurement-endpoint-dot')) return;
	    if (event.target?.classList?.contains('inspection-box-corner-dot')) return;
	    event.preventDefault();
	    fullscreenPanDragRef.current = {
	      startClientX: event.clientX,
	      startClientY: event.clientY,
	      startPanX: Number(fullscreenImageZoom.panX || 0),
	      startPanY: Number(fullscreenImageZoom.panY || 0),
	    };
	    setFullscreenImagePanning(true);
	  };

	  const handleFullscreenPanMouseUp = () => {
	    fullscreenPanDragRef.current = null;
	    setFullscreenImagePanning(false);
	  };

	  const handleFullscreenImagePointerMove = (event, lines, boxes = []) => {
	    const panDrag = fullscreenPanDragRef.current;
	    if (panDrag) {
	      event.preventDefault();
	      const nextPanX = panDrag.startPanX + (event.clientX - panDrag.startClientX);
	      const nextPanY = panDrag.startPanY + (event.clientY - panDrag.startClientY);
	      setFullscreenImageZoom((prev) => ({
	        ...prev,
	        panX: nextPanX,
	        panY: nextPanY,
	      }));
	      return;
	    }
	    const position = getFullscreenImagePointerPosition(event);
	    if (fullscreenEditingEndpoint?.lineId || fullscreenEditingBoxCorner?.boxId) {
	      updateFullscreenZoomLens(position);
	      return;
	    }
	    if (fullscreenBoxActive) {
	      const firstPoint = pendingBoxPointRef.current || pendingBoxPoint;
	      if (firstPoint && position) {
	        const box = {
	          ...makeBoxFromPoints(firstPoint, {
	            x: position.x,
	            y: position.y,
	            imageWidth: position.naturalWidth,
	            imageHeight: position.naturalHeight,
	          }),
	          id: 'fullscreen-box-preview',
	          color: '#f97316',
	        };
	        setFullscreenAnnotationPreview({ mode: 'box', box });
	      }
	      setFullscreenHoveredEndpoint(null);
	      setFullscreenHoveredBoxCorner(null);
	      return;
	    }
	    const firstMeasurePoint = pendingMeasurePointRef.current || pendingMeasurePoint;
	    if (fullscreenMeasureActive && firstMeasurePoint && position) {
	      const line = {
	        id: 'fullscreen-measure-preview',
	        x1: firstMeasurePoint.x,
	        y1: firstMeasurePoint.y,
	        x2: position.x,
	        y2: position.y,
	        imageWidth: position.naturalWidth,
	        imageHeight: position.naturalHeight,
	        color: '#f97316',
	        distancePx: Math.hypot(position.x - firstMeasurePoint.x, position.y - firstMeasurePoint.y),
	        distanceMm: getLineDistanceMm(
	          { x1: firstMeasurePoint.x, y1: firstMeasurePoint.y, x2: position.x, y2: position.y },
	          fullscreenImageModal?.imageId,
	        ),
	      };
	      setFullscreenAnnotationPreview({ mode: 'measure', line });
	      setFullscreenHoveredEndpoint(null);
	      setFullscreenHoveredBoxCorner(null);
	      return;
	    }
	    const hovered = findHoveredMeasurementEndpoint(position, lines);
    setFullscreenHoveredEndpoint((prev) => (
      prev?.lineId === hovered?.lineId && prev?.endpoint === hovered?.endpoint ? prev : hovered
    ));
    const hoveredBoxCorner = hovered ? null : findHoveredBoxCorner(position, boxes);
    setFullscreenHoveredBoxCorner((prev) => (
      prev?.boxId === hoveredBoxCorner?.boxId && prev?.corner === hoveredBoxCorner?.corner ? prev : hoveredBoxCorner
    ));
  };

	  const startFullscreenEndpointEdit = (event, line, endpoint) => {
	    event.preventDefault();
	    event.stopPropagation();
    const anchor = endpoint === 'start'
      ? { x: Number(line.x1), y: Number(line.y1) }
      : { x: Number(line.x2), y: Number(line.y2) };
	    setFullscreenMeasureActive(false);
	    setFullscreenBoxActive(false);
	    setPendingMeasurePoint(null);
	    pendingMeasurePointRef.current = null;
	    setPendingBoxPoint(null);
	    pendingBoxPointRef.current = null;
    setFullscreenEditingBoxCorner(null);
    setFullscreenHoveredBoxCorner(null);
    setFullscreenEditingEndpoint({ lineId: String(line.id), endpoint, line, anchor });
    setFullscreenHoveredEndpoint({ lineId: String(line.id), endpoint });
    updateFullscreenZoomLens(getFullscreenImagePointerPosition(event));
  };

  const handleFullscreenEndpointDotClick = (event, line, endpoint) => {
    event.preventDefault();
    event.stopPropagation();
    if (fullscreenEditingEndpoint?.lineId) {
      handleFullscreenMeasurePointerDown(event);
      return;
    }
    startFullscreenEndpointEdit(event, line, endpoint);
  };

  const startFullscreenBoxCornerEdit = (event, box, corner) => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = getAnnotationBoxCornerPoints(box)[corner];
    setFullscreenMeasureActive(false);
    setFullscreenBoxActive(false);
    setPendingMeasurePoint(null);
    pendingMeasurePointRef.current = null;
    setPendingBoxPoint(null);
    pendingBoxPointRef.current = null;
    setFullscreenEditingEndpoint(null);
    setFullscreenHoveredEndpoint(null);
    setFullscreenEditingBoxCorner({ boxId: String(box.id), corner, box, anchor });
    setFullscreenHoveredBoxCorner({ boxId: String(box.id), corner });
    updateFullscreenZoomLens(getFullscreenImagePointerPosition(event));
  };

  const handleFullscreenBoxCornerDotClick = (event, box, corner) => {
    event.preventDefault();
    event.stopPropagation();
    if (fullscreenEditingBoxCorner?.boxId) {
      handleFullscreenMeasurePointerDown(event);
      return;
    }
    startFullscreenBoxCornerEdit(event, box, corner);
  };

  const closeFullscreenImageModal = () => {
	    setFullscreenImageModal(null);
	    fullscreenPanDragRef.current = null;
	    setFullscreenImagePanning(false);
	    setFullscreenMeasureActive(false);
	    setFullscreenBoxActive(false);
	    setPendingMeasurePoint(null);
	    pendingMeasurePointRef.current = null;
	    setPendingBoxPoint(null);
	    pendingBoxPointRef.current = null;
    setFullscreenCalibrationPromptVisible(false);
    setFullscreenHoveredEndpoint(null);
	    setFullscreenEditingEndpoint(null);
    setFullscreenHoveredBoxCorner(null);
    setFullscreenEditingBoxCorner(null);
	    setFullscreenZoomLens(null);
	    setFullscreenZoomScale(MEASUREMENT_LOCAL_ZOOM_SCALE);
	    setFullscreenImageZoom({ scale: 1, originX: 50, originY: 50, panX: 0, panY: 0 });
	    setFullscreenAnnotationPreview(null);
	  };

  const renderFullscreenImageModal = () => {
    if (!fullscreenImageModal?.imageId) return null;
    const fullscreenImageId = String(fullscreenImageModal.imageId);
    const fullscreenAnnotationSourceImageId = getAnnotationSourceImageIdForImage(fullscreenImageId);
    const fullscreenBaseImageId = String(fullscreenImageModal.baseImageId || (
      fullscreenAnnotationSourceImageId && fullscreenAnnotationSourceImageId !== fullscreenImageId
        ? fullscreenAnnotationSourceImageId
        : ''
    ));
    const fullscreenImageRecord = projectImageLookup[fullscreenImageId] || {};
	    const fullscreenMeasurementLines = [
	      ...(measurementLinesByImageId[fullscreenAnnotationSourceImageId] || []),
	      ...fullscreenMeasurements.filter((line) => String(line.imageId || '') === fullscreenAnnotationSourceImageId),
	    ].filter(isFiniteMeasurementLine);
	    const fullscreenBoxAnnotations = (boxAnnotationsByImageId[fullscreenAnnotationSourceImageId] || [])
	      .filter(isFiniteAnnotationBox)
	      .map((box) => getBoxWithDerivedDimensions(box, fullscreenAnnotationSourceImageId));
	    const fullscreenPreviewLines = fullscreenAnnotationPreview?.mode === 'measure'
	      ? [fullscreenAnnotationPreview.line].filter(isFiniteMeasurementLine)
	      : [];
	    const fullscreenPreviewBoxes = fullscreenAnnotationPreview?.mode === 'box'
	      ? [fullscreenAnnotationPreview.box].filter(isFiniteAnnotationBox).map((box) => getBoxWithDerivedDimensions(box, fullscreenAnnotationSourceImageId))
	      : [];
	    const fullscreenAnnotationItems = [
	      ...fullscreenMeasurementLines.map((line, index) => ({
	        ...line,
	        annotationType: 'measurement',
	        title: line.name || `Measurement ${index + 1}`,
	        summary: getMeasurementLineLabel(line),
	      })),
	      ...fullscreenBoxAnnotations.map((box, index) => ({
	        ...box,
	        annotationType: 'box',
	        title: box.name || `Box ${index + 1}`,
	        summary: `${getAnnotationBoxWidthLabel(box)} • ${getAnnotationBoxHeightLabel(box)}`,
	      })),
	    ];
	    return (
      <div className="modal inspection-fullscreen-modal" style={{ display: 'flex' }} onClick={closeFullscreenImageModal}>
        <div className="modal-content inspection-fullscreen-modal-content" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <h3>{fullscreenImageModal.label}</h3>
            <div className="workbench-detail-actions">
	              <button type="button" className={`btn btn-secondary ${fullscreenMeasureActive ? 'active' : ''}`} onClick={toggleFullscreenMeasure}>
	                Measure
	              </button>
	              <button type="button" className={`btn btn-secondary ${fullscreenBoxActive ? 'active' : ''}`} onClick={toggleFullscreenBox}>
	                Draw box
	              </button>
	              <button type="button" className="modal-close-btn" aria-label="Close fullscreen image" onClick={closeFullscreenImageModal}>&times;</button>
	            </div>
          </div>
          {fullscreenCalibrationPromptVisible && (
            <div className="inspection-fullscreen-calibration-panel" role="dialog" aria-label="Measurement calibration required">
              <div className="workbench-notice">
                <strong>No Calibration Set</strong>
                <p>Set calibration before placing a measurement line.</p>
              </div>
              <CalibrationManager
                projectId={projectId}
                imageId={fullscreenImageId}
                image={fullscreenImageRecord}
                onCalibrationChange={handleFullscreenCalibrationChange}
              />
            </div>
          )}
	          <div className="inspection-fullscreen-stage">
	            {fullscreenMeasureActive && <div className="workbench-notice">Click to set first point, click again to set second point.</div>}
	            {fullscreenBoxActive && <div className="workbench-notice">Press and drag to draw a bounding box.</div>}
	            {(fullscreenEditingEndpoint || fullscreenEditingBoxCorner) && <div className="workbench-notice">Move the zoom lens to the precise point and click to place it.</div>}
            <div className="inspection-fullscreen-workspace">
              <div
	                className={`inspection-fullscreen-image-frame ${fullscreenImageZoom.scale > 1 ? 'zoomed' : ''} ${fullscreenImagePanning ? 'panning' : ''}`}
	                onMouseDown={handleFullscreenPanMouseDown}
	                onMouseMove={(event) => handleFullscreenImagePointerMove(event, fullscreenMeasurementLines, fullscreenBoxAnnotations)}
	                onMouseUp={handleFullscreenPanMouseUp}
	                onMouseLeave={() => {
	                  handleFullscreenPanMouseUp();
	                  if (!fullscreenEditingEndpoint) setFullscreenHoveredEndpoint(null);
                    if (!fullscreenEditingBoxCorner) setFullscreenHoveredBoxCorner(null);
	                }}
                onWheel={handleFullscreenImageWheel}
              >
                <div
                  className="inspection-fullscreen-image-zoom-layer"
	                  style={{
	                    transform: `translate(${fullscreenImageZoom.panX || 0}px, ${fullscreenImageZoom.panY || 0}px) scale(${fullscreenImageZoom.scale})`,
	                    transformOrigin: `${fullscreenImageZoom.originX}% ${fullscreenImageZoom.originY}%`,
	                  }}
                >
                  {fullscreenBaseImageId && (
                    <img
                      src={`/api/images/${encodeURIComponent(fullscreenBaseImageId)}/content`}
                      alt={`${fullscreenImageModal.label} source fullscreen`}
                      className="inspection-fullscreen-image"
                    />
                  )}
                  <img
                    ref={fullscreenImageRef}
                    src={`/api/images/${encodeURIComponent(fullscreenImageModal.imageId)}/content`}
	                    alt={`${fullscreenImageModal.label} fullscreen`}
		                    className={`inspection-fullscreen-image ${fullscreenBaseImageId ? 'analysis-overlay-image' : ''} ${fullscreenMeasureActive || fullscreenBoxActive || fullscreenEditingEndpoint || fullscreenEditingBoxCorner ? 'measurement-active' : ''}`}
		                    onMouseDown={handleFullscreenBoxPointerDown}
		                    onMouseUp={handleFullscreenBoxPointerUp}
		                    onMouseLeave={handleFullscreenBoxPointerCancel}
		                    onClick={handleFullscreenMeasurePointerDown}
		                  />
                  <svg className="inspection-fullscreen-measurement-overlay" viewBox={`0 0 1000 1000`} preserveAspectRatio="none" aria-label="fullscreen measurement overlay">
	                    {[...fullscreenMeasurementLines, ...fullscreenPreviewLines].map((line) => {
                      const labelPosition = getMeasurementLabelViewBoxPosition(line, 20);
                      const endpointPositions = getMeasurementEndpointViewBoxPosition(line);
                      const endpointActive = fullscreenHoveredEndpoint?.lineId === String(line.id)
                        || fullscreenEditingEndpoint?.lineId === String(line.id)
                        || String(selectedAnnotationId || '') === String(line.id);
                      return (
                        <g key={line.id}>
                          <line x1={(line.x1 / line.imageWidth) * 1000} y1={(line.y1 / line.imageHeight) * 1000} x2={(line.x2 / line.imageWidth) * 1000} y2={(line.y2 / line.imageHeight) * 1000} stroke={line.color} strokeWidth="3" />
                          <text x={labelPosition.x} y={labelPosition.y} fill={line.color} fontSize="20">{getMeasurementLineLabel(line)}</text>
                          {endpointActive && ['start', 'end'].map((endpoint) => (
                            <circle
                              key={endpoint}
                              className="inspection-measurement-endpoint-dot"
                              cx={endpointPositions[endpoint].x}
                              cy={endpointPositions[endpoint].y}
                              r="11"
                              fill="#ffffff"
                              stroke={line.color}
                              strokeWidth="5"
                              role="button"
                              tabIndex={0}
                              aria-label={`Reposition ${endpoint} endpoint for ${line.name || 'measurement'}`}
                              onClick={(event) => handleFullscreenEndpointDotClick(event, line, endpoint)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  handleFullscreenEndpointDotClick(event, line, endpoint);
                                }
                              }}
                            />
                          ))}
                        </g>
	                      );
	                    })}
	                    {renderAnnotationOverlay({ measurementLines: [], boxes: [...fullscreenBoxAnnotations, ...fullscreenPreviewBoxes], fontSize: 20, selectedAnnotationId })}
                    {fullscreenBoxAnnotations.map((box) => {
                      const cornerPositions = getAnnotationBoxCornerViewBoxPosition(box);
                      const cornerActive = fullscreenHoveredBoxCorner?.boxId === String(box.id)
                        || fullscreenEditingBoxCorner?.boxId === String(box.id)
                        || String(selectedAnnotationId || '') === String(box.id);
                      if (!cornerActive) return null;
                      return (
                        <g key={`box-corners-${box.id}`}>
                          {Object.entries(cornerPositions).map(([corner, point]) => (
                            <circle
                              key={corner}
                              className="inspection-box-corner-dot"
                              cx={point.x}
                              cy={point.y}
                              r="11"
                              fill="#ffffff"
                              stroke={box.color}
                              strokeWidth="5"
                              role="button"
                              tabIndex={0}
                              aria-label={`Reposition ${corner} corner for ${box.name || 'bounding box'}`}
                              onClick={(event) => handleFullscreenBoxCornerDotClick(event, box, corner)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  handleFullscreenBoxCornerDotClick(event, box, corner);
                                }
                              }}
                            />
                          ))}
                        </g>
                      );
                    })}
	                  </svg>
	                </div>
                {projectType !== 'PT1' && fullscreenZoomLens && (
                  <div
                    className="inspection-fullscreen-zoom-lens"
                    data-testid="fullscreen-measurement-zoom-lens"
                    style={{
                      width: fullscreenZoomLens.diameter,
                      height: fullscreenZoomLens.diameter,
                      left: fullscreenZoomLens.displayX - (fullscreenZoomLens.diameter / 2),
                      top: fullscreenZoomLens.displayY - (fullscreenZoomLens.diameter / 2),
                      backgroundImage: fullscreenBaseImageId
                        ? `url(/api/images/${encodeURIComponent(fullscreenImageModal.imageId)}/content), url(/api/images/${encodeURIComponent(fullscreenBaseImageId)}/content)`
                        : `url(/api/images/${encodeURIComponent(fullscreenImageModal.imageId)}/content)`,
                      backgroundSize: fullscreenZoomLens.backgroundSize,
                      backgroundPosition: fullscreenZoomLens.backgroundPosition,
                    }}
                  >
                    {fullscreenEditingEndpoint?.line && (
                      <svg className="inspection-fullscreen-zoom-lens-overlay" width={fullscreenZoomLens.diameter} height={fullscreenZoomLens.diameter} aria-label="Measurement fine-tune overlay">
                        {(() => {
                          const line = fullscreenEditingEndpoint.line;
                          const toLensX = (x) => {
                            const displayX = (Number(x) / Number(line.imageWidth || fullscreenZoomLens.naturalWidth || 1)) * Number(fullscreenZoomLens.imageDisplayWidth || 1);
                            return (fullscreenZoomLens.diameter / 2) + ((displayX - fullscreenZoomLens.displayX) * fullscreenZoomLens.scale);
                          };
                          const toLensY = (y) => {
                            const displayY = (Number(y) / Number(line.imageHeight || fullscreenZoomLens.naturalHeight || 1)) * Number(fullscreenZoomLens.imageDisplayHeight || 1);
                            return (fullscreenZoomLens.diameter / 2) + ((displayY - fullscreenZoomLens.displayY) * fullscreenZoomLens.scale);
                          };
                          return (
                            <g opacity="0.45">
                              <line
                                x1={toLensX(line.x1)}
                                y1={toLensY(line.y1)}
                                x2={toLensX(line.x2)}
                                y2={toLensY(line.y2)}
                                stroke={line.color || '#f97316'}
                                strokeWidth="2"
                              />
                              <circle cx={toLensX(line.x1)} cy={toLensY(line.y1)} r="4" fill="#ffffff" stroke={line.color || '#f97316'} strokeWidth="2" />
                              <circle cx={toLensX(line.x2)} cy={toLensY(line.y2)} r="4" fill="#ffffff" stroke={line.color || '#f97316'} strokeWidth="2" />
                            </g>
                          );
                        })()}
                      </svg>
                    )}
                  </div>
                )}
              </div>
	              <aside className="inspection-fullscreen-annotations" aria-label="Measurement annotations" data-testid="fullscreen-annotation-list">
	                <h4>Annotations</h4>
	                {fullscreenAnnotationItems.length === 0 ? (
	                  <p className="muted">No annotations.</p>
	                ) : (
	                  <ul className="inspection-fullscreen-annotation-list">
	                    {fullscreenAnnotationItems.map((annotation, index) => (
	                      <li
	                        key={`${annotation.annotationType}-${annotation.id}`}
	                        className={`inspection-fullscreen-annotation ${selectedAnnotationId === annotation.id ? 'selected' : ''}`}
	                        style={{ borderColor: annotation.color }}
	                      >
	                        <button
	                          type="button"
	                          className="inspection-fullscreen-annotation-body"
	                          onClick={() => { setSelectedAnnotationId(annotation.id);
                    setAnnotationEditModalVisible(true); setAnnotationEditModalVisible(true); }}
	                        >
	                          <span className="inspection-fullscreen-annotation-title">{annotation.title || `Annotation ${index + 1}`}</span>
	                          <span className="inspection-fullscreen-annotation-length">{annotation.summary}</span>
	                        </button>
	                        <button
	                          type="button"
	                          className="inspection-fullscreen-annotation-delete"
	                          aria-label={`Delete ${annotation.title || `annotation ${index + 1}`}`}
	                          onClick={() => deleteMeasurementAnnotation(annotation.id)}
	                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="workbench-panel" aria-label="Inspection Workbench">
      {loading && <div className="loading-text">Loading inspection workbench…</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && (
        <>
          {projectType !== 'PT3' && (
            <div className="workbench-stats">
              <span className="group-badge">Batches: {batches.length}</span>
              <span className="group-badge">Parts: {parts.length}</span>
              <span className="group-badge">Passed: {reviewSummary.pass}</span>
              <span className="group-badge">Rejected: {reviewSummary.reject_confirmed + reviewSummary.reject_pending}</span>
            </div>
          )}

          <div className="workbench-layout">
            {projectType === 'PT3' ? (
              renderPt3FocusedWorkbench()
            ) : (
            <div className="workbench-details" ref={workbenchDetailsRef}>
              {selectedPart ? (
                <>
                  <div className="workbench-detail-header">
                    <h3>{selectedPart.display_name || selectedPart.serial_number}</h3>
                    <div className="workbench-detail-actions">
                      <button
                        className="btn btn-success"
                        disabled={savingPartId === selectedPart.id}
                        onClick={() => updatePartReviewState(selectedPart, 'pass')}
                      >
                        Pass
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={savingPartId === selectedPart.id}
                        onClick={() => updatePartReviewState(selectedPart, 'reject_confirmed')}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  <p className="muted" data-testid="inspector-hotkey-hints">
                    Hotkeys: pass ({inspectorHotkeys.accept_classification.toUpperCase()}), reject (
                    {inspectorHotkeys.reject_classification.toUpperCase()}), shortcuts help (
                    {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}).
                  </p>
                  {shortcutHelpVisible && (
                    <div className="workbench-notice" data-testid="shortcut-help-panel">
                      <strong>Shortcut help</strong>
                      <ul>
                        <li>Mark Pass: {inspectorHotkeys.accept_classification.toUpperCase()}</li>
                        <li>Reject: {inspectorHotkeys.reject_classification.toUpperCase()}</li>
                        <li>Toggle this help: {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}</li>
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="workbench-notice" data-testid="inspection-empty-state">
                  <strong>No part selected</strong>
                  <p className="muted">
                    {filteredParts.length === 0
                      ? 'No parts found for the current filters. The configured inspection workspace is ready for incoming parts.'
                      : 'Select a part from the summary panel to begin inspection.'}
                  </p>
                  {normalizationTriageField && (
                    <p className="muted" data-testid="normalization-triage-empty-guidance">
                      {normalizationTriageMatchCount > 0
                        ? `Triage matches exist for ${normalizationTriageField}, but they are hidden by the active filters.`
                        : `No parts in this project contain mixed ${normalizationTriageField} metadata values.`}
                    </p>
                  )}
                </div>
              )}

                  <div
                    className="workbench-flexlayout-shell"
                    style={workbenchFlexLayoutStyle}
                    data-testid="inspection-layout-grid"
                  >
                    <Layout
                      model={inspectionFlexLayoutModel}
                      factory={inspectionFlexLayoutFactory}
                      onModelChange={handleInspectionFlexLayoutChange}
                    />
                  </div>

            </div>
            )}
          </div>
        </>
	      )}
	      {renderOtherAnnotationModal()}
      {renderAnnotationEditModal()}
      {renderSegmentationHelperModal()}
	      {renderFullscreenImageModal()}
	    </section>
	  );
}

export default InspectionWorkbenchPanel;
