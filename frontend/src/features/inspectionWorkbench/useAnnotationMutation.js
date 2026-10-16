import { useRef } from 'react';

import { savePartAnnotation } from '../../api/parts';
import { ALL_PARTS_ID } from './useInspectionPartSelection';

/**
 * Owns the stale-response scope for part-scoped inspection mutations and the
 * shared create/update annotation flow.
 *
 * The scope is `${projectId}:${activeSelectionId}` plus a generation counter
 * that advances whenever the scope changes, so a response that resolves after
 * the user switches parts (or leaves and returns) is dropped instead of being
 * merged into the newly selected part.
 *
 * `scopeRef` is shared with the segmentation persistence queue, which checks the
 * scope string directly.
 */
export default function useAnnotationMutation({
  projectId,
  activeSelectionId,
  selectedPart,
  readOnly,
  setError,
  scopeRef,
}) {
  const viewRef = useRef({ scope: '', generation: 0 });
  const activePartMutationScope = `${projectId}:${activeSelectionId || ''}`;
  scopeRef.current = activePartMutationScope;
  if (viewRef.current.scope !== activePartMutationScope) {
    viewRef.current = {
      scope: activePartMutationScope,
      generation: viewRef.current.generation + 1,
    };
  }
  const activePartMutationGeneration = viewRef.current.generation;
  const isActivePartMutation = (scope, generation) => (
    scopeRef.current === scope
    && viewRef.current.generation === generation
  );

  /**
   * Create (no annotationId) or update (annotationId) an annotation on the
   * selected part. Returns the saved annotation, `null` when rejected by a guard
   * or when the request fails. `onSuccess(saved, partId)` runs only when the
   * response still belongs to the active part; errors are reported through
   * `setError` under the same condition.
   */
  const mutateAnnotation = async ({ payload, annotationId = '', errorLabel, onSuccess }) => {
    if (readOnly) return null;
    if (!selectedPart?.id || String(selectedPart.id) === ALL_PARTS_ID) return null;
    const mutationPartId = String(selectedPart.id);
    const mutationScope = `${projectId}:${mutationPartId}`;
    const mutationGeneration = activePartMutationGeneration;
    try {
      const saved = await savePartAnnotation(projectId, mutationPartId, payload, annotationId, { readOnly, errorLabel });
      if (isActivePartMutation(mutationScope, mutationGeneration) && onSuccess) onSuccess(saved, mutationPartId);
      return saved;
    } catch (err) {
      if (isActivePartMutation(mutationScope, mutationGeneration)) {
        setError(err.message || errorLabel);
      }
      return null;
    }
  };

  return { activePartMutationGeneration, isActivePartMutation, mutateAnnotation };
}
