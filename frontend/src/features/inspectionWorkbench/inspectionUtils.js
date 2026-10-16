import { parseMetadataBoolean } from '../../utils/imageIdentity';
import {
  MIDDLE_MOUSE_BUTTON,
  MIDDLE_MOUSE_BUTTONS_MASK,
  DEFAULT_OVERLAY_LAYERS,
  DEFAULT_INSPECTOR_HOTKEYS,
} from './inspectionConstants';

export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load source image for crop'));
    image.src = src;
  });
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create cropped image'));
      }
    }, type);
  });
}

export function safeDecodeFilename(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

export function getLatestRunFromMetadata(part, key) {
  const runs = part?.metadata?.[key];
  if (!Array.isArray(runs) || runs.length === 0) return null;
  return runs[runs.length - 1];
}

export function getOverlayLayers(part) {
  const overlays = part?.metadata?.overlay_layers;
  if (Array.isArray(overlays) && overlays.length > 0) {
    return overlays
      .filter((overlay) => (
        overlay
        && overlay.id
        && !parseMetadataBoolean(overlay.overlay_delete_candidate)
        && !parseMetadataBoolean(overlay.delete_candidate)
      ))
      .map((overlay) => ({
        id: String(overlay.id),
        label: overlay.label || String(overlay.id),
        color: overlay.color || '#64748b',
      }));
  }
  return DEFAULT_OVERLAY_LAYERS;
}

export function clampRange(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function getInspectionTileMaxColumns(projectConfiguration) {
  const configured = Number(projectConfiguration?.display_settings?.inspection_tile_max_columns);
  if (!Number.isFinite(configured)) return 8;
  return Math.max(1, Math.round(configured));
}

export function isMiddleMousePanEvent(event) {
  return event?.button === MIDDLE_MOUSE_BUTTON || (Number(event?.buttons) & MIDDLE_MOUSE_BUTTONS_MASK) !== 0;
}

export function stopMiddleMouseDefault(event) {
  event.preventDefault();
  event.stopPropagation();
}

export function normalizeTileViewportTransform(transform = {}) {
  return {
    zoom: clampRange(transform.zoom, 0.5, 4, 1),
    panX: clampRange(transform.panX, -10000, 10000, 0),
    panY: clampRange(transform.panY, -10000, 10000, 0),
  };
}

export function normalizeInspectorHotkeys(candidate) {
  const normalized = { ...DEFAULT_INSPECTOR_HOTKEYS };
  if (!candidate || typeof candidate !== 'object') return normalized;
  Object.entries(DEFAULT_INSPECTOR_HOTKEYS).forEach(([binding, fallback]) => {
    const raw = typeof candidate[binding] === 'string' ? candidate[binding].trim().toLowerCase() : fallback;
    normalized[binding] = /^[a-z0-9]$/.test(raw) ? raw : fallback;
  });
  return normalized;
}
