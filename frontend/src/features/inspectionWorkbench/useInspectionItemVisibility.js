import { updatePartSourceImage } from '../../api/parts';
import {
  findVisibilitySegment,
  setAnnotationHidden,
  setPartSourceImageHidden,
} from './inspectionVisibilityPatches';

/**
 * Annotation, VISTA segment, and source-image visibility toggles. Read-only
 * sessions apply visibility locally only. Uses no React hooks.
 */
export function useInspectionItemVisibility({
  readOnly,
  projectId,
  selectedPart,
  isAllImagesSelection,
  activePartMutationGeneration,
  isActivePartMutation,
  mutateAnnotation,
  setAnnotations,
  setParts,
  setError,
  segmentVisibility,
}) {
  const {
    segments, setSegmentVisibility, updateSegment, persistSegment,
  } = segmentVisibility;
  const applyLocalVisibility = (item, visible, mutationPartId) => {
    const hidden = !visible;
    if (item.source.resource === 'annotation') {
      setAnnotations((prev) => setAnnotationHidden(prev, item.source.resourceId, hidden));
      setSegmentVisibility(item.source.resourceId, visible);
    } else if (item.source.resource === 'source_image') {
      setParts((prev) => prev.map((part) => (
        String(part.id) !== mutationPartId ? part : setPartSourceImageHidden(part, item, hidden)
      )));
    }
  };

  const persistAnnotationVisibility = async (item, visible) => {
    if (item.kind === 'vista_segment') {
      const segment = findVisibilitySegment(segments, item);
      if (segment) {
        const nextSegment = { ...segment, visible };
        updateSegment(segment.id, nextSegment);
        await persistSegment(nextSegment);
        return;
      }
    }
    await mutateAnnotation({
      payload: { hidden: !visible },
      annotationId: item.source.resourceId,
      errorLabel: 'Failed to update annotation visibility',
      onSuccess: (updated) => {
        setAnnotations((prev) => prev.map((annotation) => (
          String(annotation.id) === String(updated.id) ? updated : annotation
        )));
      },
    });
  };

  const persistSourceImageVisibility = async (item, visible, mutationPartId) => {
    const mutationScope = `${projectId}:${mutationPartId}`;
    const mutationGeneration = activePartMutationGeneration;
    try {
      const updatedPart = await updatePartSourceImage(
        projectId,
        mutationPartId,
        item.source.resourceId,
        { hidden: !visible },
        { readOnly, errorLabel: 'Failed to update overlay visibility' },
      );
      setParts((prev) => prev.map((part) => (
        String(part.id) === String(updatedPart.id) ? updatedPart : part
      )));
    } catch (err) {
      if (isActivePartMutation(mutationScope, mutationGeneration)) {
        setError(err.message || 'Failed to update overlay visibility');
      }
    }
  };

  const setInspectionItemVisibility = async (item, visible) => {
    if (isAllImagesSelection || !selectedPart?.id || !item?.source) return;
    const mutationPartId = String(selectedPart.id);
    if (readOnly) {
      applyLocalVisibility(item, visible, mutationPartId);
      return;
    }
    if (item.source.resource === 'annotation') {
      await persistAnnotationVisibility(item, visible);
      return;
    }
    if (item.source.resource === 'source_image') {
      await persistSourceImageVisibility(item, visible, mutationPartId);
    }
  };

  return { setInspectionItemVisibility };
}
