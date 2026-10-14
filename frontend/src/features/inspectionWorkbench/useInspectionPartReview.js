import { useCallback, useEffect, useMemo } from 'react';
import { updateProjectPart } from '../../api/parts';
import { ALL_PARTS_ID, getPartReviewState } from './useInspectionPartSelection';

/**
 * Part review mutations, review hotkeys, local annotation state updates, and the review summary.
 */
export default function useInspectionPartReview({
  inspectorHotkeys,
  mprFullscreenOpen,
  parts,
  projectId,
  readOnly,
  savingPartId,
  selectedPart,
  setError,
  setParts,
  setSavingPartId,
  setShortcutHelpVisible,
}) {
  const updatePartReviewState = useCallback(async (part, nextState) => {
    if (readOnly || !part?.id || String(part.id) === ALL_PARTS_ID) return;
    try {
      setSavingPartId(part.id);
      const updatedPart = await updateProjectPart(projectId, part.id, { review_state: nextState }, { readOnly, errorLabel: 'Failed to update review state' });
      setParts((prev) => prev.map((item) => (item.id === updatedPart.id ? updatedPart : item)));
    } catch (err) {
      setError(err.message || 'Failed to update part review state');
    } finally {
      setSavingPartId(null);
    }
  }, [projectId, readOnly, setError, setParts, setSavingPartId]);

  const updatePartAnnotationsState = useCallback((partId, annotationsUpdater, { rejectPart = false } = {}) => {
    const targetPartId = String(partId || '');
    if (!targetPartId) return;
    setParts((prev) => prev.map((part) => {
      if (String(part.id) !== targetPartId) return part;
      const existingAnnotations = Array.isArray(part.metadata?.annotations) ? part.metadata.annotations : [];
      return {
        ...part,
        review_state: rejectPart ? 'reject_confirmed' : part.review_state,
        metadata: {
          ...(part.metadata || {}),
          annotations: annotationsUpdater(existingAnnotations),
        },
      };
    }));
  }, [setParts]);

  useEffect(() => {
    if (!selectedPart?.id) return undefined;
    const handleInspectorHotkeys = (event) => {
      if (mprFullscreenOpen) return;
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
  }, [
    inspectorHotkeys,
    mprFullscreenOpen,
    savingPartId,
    selectedPart,
    updatePartReviewState,
    setShortcutHelpVisible,
  ]);

  const reviewSummary = useMemo(() => {
    return parts.reduce(
      (acc, part) => {
        const state = getPartReviewState(part);
        acc[state] = (acc[state] || 0) + 1;
        return acc;
      },
      { unreviewed: 0, pass: 0, reject_pending: 0, reject_confirmed: 0 },
    );
  }, [parts]);

  return {
    reviewSummary,
    updatePartAnnotationsState,
    updatePartReviewState,
  };
}
