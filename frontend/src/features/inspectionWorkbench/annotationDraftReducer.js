import { isFiniteAnnotationBox, isFiniteMeasurementLine, makeBoxFromPoints } from './inspectionAnnotationGeometry';

/**
 * Pure state machine for in-progress measure, box, crop, and cube drafts on
 * the tile, MPR, and fullscreen surfaces.
 *
 * Each surface keeps the same slots:
 * - `measure`: first point of a click-click (or press-release) measurement.
 * - `drag`: anchor point of a box, crop, or cube drag.
 * - `pending`: committed first face of a two-slice MPR cube.
 * - `preview`: geometry rendered while the pointer moves.
 *
 * Points are `{ x, y, imageWidth, imageHeight, ...surfaceContext }` in source
 * image pixels. Saving is not done here; callers resolve the committed geometry
 * with `getDraftLine` / `getDraftBox` and persist it through the annotation
 * mutation helpers.
 */
export const ANNOTATION_DRAFT_SURFACES = ['tile', 'mpr', 'fullscreen'];
export const ANNOTATION_DRAFT_SLOTS = ['measure', 'drag', 'pending', 'preview'];

// Fullscreen press-release measurements shorter than this are treated as
// clicks rather than drags and are discarded.
export const FULLSCREEN_MIN_MEASURE_LENGTH_PX = 2;

const EMPTY_SURFACE_DRAFT = Object.freeze({
  measure: null,
  drag: null,
  pending: null,
  preview: null,
});

export function createInitialAnnotationDraftState() {
  return ANNOTATION_DRAFT_SURFACES.reduce((state, surface) => ({
    ...state,
    [surface]: EMPTY_SURFACE_DRAFT,
  }), {});
}

function patchSurface(state, surface, patch) {
  const current = state[surface] || EMPTY_SURFACE_DRAFT;
  const changed = Object.keys(patch).some((key) => current[key] !== patch[key]);
  if (!changed) return state;
  return { ...state, [surface]: { ...current, ...patch } };
}

function clearedSlots(slots) {
  return slots.reduce((patch, slot) => ({ ...patch, [slot]: null }), {});
}

export function annotationDraftReducer(state, action) {
  const { surface } = action || {};
  if (action?.type === 'resetAll') return createInitialAnnotationDraftState();
  if (!ANNOTATION_DRAFT_SURFACES.includes(surface)) return state;
  switch (action.type) {
    case 'start': {
      // A new anchor replaces every other draft on the surface. Only a second
      // cube drag keeps the pending first face (`keepPending`).
      const slot = action.slot === 'drag' ? 'drag' : 'measure';
      const current = state[surface] || EMPTY_SURFACE_DRAFT;
      return patchSurface(state, surface, {
        measure: null,
        drag: null,
        preview: null,
        pending: action.keepPending ? current.pending : null,
        [slot]: action.point ?? null,
      });
    }
    case 'move':
      return patchSurface(state, surface, { preview: action.preview ?? null });
    case 'finish': {
      const patch = { measure: null, drag: null, preview: null };
      if (Object.prototype.hasOwnProperty.call(action, 'pending')) patch.pending = action.pending;
      return patchSurface(state, surface, patch);
    }
    case 'cancel':
      return patchSurface(state, surface, clearedSlots(action.slots || ANNOTATION_DRAFT_SLOTS));
    case 'setPending':
      return patchSurface(state, surface, { pending: action.pending ?? null });
    case 'reset':
      return patchSurface(state, surface, clearedSlots(ANNOTATION_DRAFT_SLOTS));
    default:
      return state;
  }
}

/** Line from a draft anchor to the current point, sized by the current point. */
export function getDraftLine(anchor, point, extra = {}) {
  if (!anchor || !point) return null;
  return {
    x1: anchor.x,
    y1: anchor.y,
    x2: point.x,
    y2: point.y,
    imageWidth: point.imageWidth,
    imageHeight: point.imageHeight,
    ...extra,
  };
}

/**
 * True when a draft line may be saved. Without `minLength` every line is
 * accepted, matching the tile and MPR click-click flows.
 */
export function isCommittableDraftLine(line, { minLength = null } = {}) {
  if (!line) return false;
  if (minLength === null) return true;
  return isFiniteMeasurementLine(line) && Math.hypot(line.x2 - line.x1, line.y2 - line.y1) >= minLength;
}

/** Box spanned by a drag anchor and the current point. */
export function getDraftBox(anchor, point, extra = {}) {
  const box = makeBoxFromPoints(anchor, point);
  return box ? { ...box, ...extra } : null;
}

/** Boxes need finite geometry and a positive width and height to be saved. */
export function isCommittableDraftBox(box) {
  return isFiniteAnnotationBox(box);
}
