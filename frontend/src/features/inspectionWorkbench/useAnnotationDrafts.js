import { useCallback, useRef, useState } from 'react';

import { annotationDraftReducer, createInitialAnnotationDraftState } from './annotationDraftReducer';

/**
 * Shared annotation draft state for the tile, MPR, and fullscreen surfaces.
 *
 * `annotationDrafts` drives rendering; `annotationDraftsRef` is updated
 * synchronously on every dispatch so pointer handlers that fire before the next
 * render (pointerdown followed by pointerup) read the latest anchors.
 */
export default function useAnnotationDrafts() {
  const [annotationDrafts, setAnnotationDrafts] = useState(createInitialAnnotationDraftState);
  const annotationDraftsRef = useRef(annotationDrafts);

  const dispatch = useCallback((action) => {
    const next = annotationDraftReducer(annotationDraftsRef.current, action);
    if (next === annotationDraftsRef.current) return;
    annotationDraftsRef.current = next;
    setAnnotationDrafts(next);
  }, []);

  const startAnnotationDraft = useCallback((surface, slot, point, { keepPending = false } = {}) => {
    dispatch({ type: 'start', surface, slot, point, keepPending });
  }, [dispatch]);
  const moveAnnotationDraft = useCallback((surface, preview) => {
    dispatch({ type: 'move', surface, preview });
  }, [dispatch]);
  const finishAnnotationDraft = useCallback((surface, options = {}) => {
    dispatch({ type: 'finish', surface, ...options });
  }, [dispatch]);
  const cancelAnnotationDraft = useCallback((surface, slots) => {
    dispatch({ type: 'cancel', surface, slots });
  }, [dispatch]);
  const setPendingAnnotationDraft = useCallback((surface, pending) => {
    dispatch({ type: 'setPending', surface, pending });
  }, [dispatch]);
  const resetAnnotationDrafts = useCallback(() => {
    dispatch({ type: 'resetAll' });
  }, [dispatch]);

  return {
    annotationDrafts,
    annotationDraftsRef,
    cancelAnnotationDraft,
    finishAnnotationDraft,
    moveAnnotationDraft,
    resetAnnotationDrafts,
    setPendingAnnotationDraft,
    startAnnotationDraft,
  };
}
