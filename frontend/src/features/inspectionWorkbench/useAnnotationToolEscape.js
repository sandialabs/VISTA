import { useEffect } from 'react';

const STICKY_TILE_TOOL_MODES = ['measure', 'box', 'crop'];

const isTextEntryTarget = (target) => {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

// Escape belongs to any other open dialog (sort menu, NCR editor, calibration
// prompt, annotation editor, ...), even when focus is outside it, so the
// drawing tool only reacts when no such dialog is showing.
const isOtherDialogOpen = () => typeof document !== 'undefined'
  && Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]'));

const hasDraft = (surfaceDraft) => Boolean(surfaceDraft?.measure || surfaceDraft?.drag || surfaceDraft?.preview);

/**
 * Escape handling for the sticky Measure, Draw box, and New Crop tools.
 *
 * The tools stay selected after each shape is drawn. Escape first discards a
 * shape that is still being drawn; a second Escape (or one with no shape in
 * progress) turns the active tool off with the same cleanup as clicking its
 * button again. The single image view takes priority over the tile grid while
 * it is open. The listener is only registered while a tool is active, and it
 * ignores keys typed into text fields or meant for another open dialog.
 */
export default function useAnnotationToolEscape({
  annotationToolMode,
  turnOffTileTool,
  annotationDraftsRef,
  cancelAnnotationDraft,
  fullscreenSession,
}) {
  const {
    fullscreenImageModal,
    fullscreenMeasureActive,
    fullscreenBoxActive,
    fullscreenCropActive,
    setFullscreenMeasureActive,
    setFullscreenBoxActive,
    setFullscreenCropActive,
  } = fullscreenSession;
  const fullscreenOpen = Boolean(fullscreenImageModal);
  const fullscreenToolActive = fullscreenOpen
    && (fullscreenMeasureActive || fullscreenBoxActive || fullscreenCropActive);
  const tileToolActive = !fullscreenOpen && STICKY_TILE_TOOL_MODES.includes(annotationToolMode);

  useEffect(() => {
    if (!fullscreenToolActive && !tileToolActive) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isTextEntryTarget(event.target) || isOtherDialogOpen()) return;
      const surface = fullscreenToolActive ? 'fullscreen' : 'tile';
      event.preventDefault();
      if (hasDraft(annotationDraftsRef.current?.[surface])) {
        cancelAnnotationDraft(surface);
        return;
      }
      if (fullscreenToolActive) {
        setFullscreenMeasureActive(false);
        setFullscreenBoxActive(false);
        setFullscreenCropActive(false);
      } else {
        turnOffTileTool();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    annotationDraftsRef, cancelAnnotationDraft, fullscreenToolActive, setFullscreenBoxActive,
    setFullscreenCropActive, setFullscreenMeasureActive, tileToolActive, turnOffTileTool,
  ]);
}
