export const MIDDLE_MOUSE_BUTTON = 1;
export const MIDDLE_MOUSE_BUTTONS_MASK = 4;

export const DEFAULT_OVERLAY_LAYERS = [
  { id: 'segmentation', label: 'Segmentation', color: '#ef4444' },
  { id: 'heatmap', label: 'Heatmap', color: '#8b5cf6' },
  { id: 'voids', label: 'Voids', color: '#f59e0b' },
];
export const DEFAULT_MODALITIES = ['visual', 'infrared', 'uv'];
export const DEFAULT_PRIMARY_IMAGE_FILTER_KEY = 'view';
export const DEFAULT_MODALITY_IMAGE_FILTER_KEY = 'modality';
export const DEFAULT_SECONDARY_IMAGE_FILTER_KEY = 'layer';
export const INSPECTION_VIEW_ALL_IMAGES_TAB = 'view_all_images';
export const INSPECTION_VIEW_PARTS_TAB = 'view_parts';
export const INSPECTION_FILTER_IMAGES_COLUMN = 'filter_images';
export const DEFAULT_INSPECTOR_HOTKEYS = {
  accept_classification: 'a',
  reject_classification: 'r',
  toggle_shortcut_help: 'h',
};
export const DEFAULT_INSPECTION_COLUMN_WIDTHS = { leftPx: null, rightPx: null };

export const FULLSCREEN_IMAGE_ZOOM_MIN = 1;
export const FULLSCREEN_IMAGE_ZOOM_MAX = 8;
export const RESIZABLE_COLUMN_MIN_PX = 220;
export const RESIZE_HANDLE_WIDTH_PX = 10;
export const FLEX_LAYOUT_CENTER_WEIGHT_PX = 760;
export const INSPECTION_FLEX_TABSET_IDS = {
  left: 'inspection-left-tabset',
  center: 'inspection-center-tabset',
  right: 'inspection-right-tabset',
};
export const DEFAULT_PANEL_LAYOUT = {
  part_list: { is_open: true, width_px: 320, height_px: 420, orientation: 'vertical' },
  inspector: { is_open: true, width_px: 360, height_px: 420, orientation: 'vertical' },
  mpr_controls: { is_open: true, width_px: 360, height_px: 360, orientation: 'vertical' },
};
export const PANEL_LAYOUT_KEYS = ['part_list', 'inspector', 'mpr_controls'];
export const REVIEW_LABELS = {
  unreviewed: 'Unreviewed',
  pass: 'Pass',
  reject_pending: 'Reject',
  reject_confirmed: 'Reject',
};
