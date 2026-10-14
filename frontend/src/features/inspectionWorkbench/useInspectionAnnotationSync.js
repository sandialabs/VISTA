import { useEffect } from 'react';
import { fetchPartAnnotations } from '../../api/parts';

/**
 * Loads the selected part annotations and keeps the selected annotation and inspection item valid.
 */
export default function useInspectionAnnotationSync({
  annotations,
  annotationsMutationRevisionRef,
  fullscreenBoundsEditAnnotationId,
  inspectionAnnotationItems,
  isAllImagesSelection,
  projectId,
  selectedAnnotationId,
  selectedInspectionItemKey,
  selectedPart,
  setAnnotationsLoading,
  setAnnotationsState,
  setFullscreenBoundsEditAnnotationId,
  setSelectedAnnotationId,
  setSelectedInspectionItemKey,
}) {
  useEffect(() => {
    let isCurrent = true;
    const loadAnnotations = async () => {
      if (isAllImagesSelection || !selectedPart?.id) {
        setAnnotationsState([]);
        return;
      }
      const embeddedFallback = Array.isArray(selectedPart.metadata?.annotations)
        ? selectedPart.metadata.annotations
        : [];
      setAnnotationsState(embeddedFallback);
      const requestMutationRevision = annotationsMutationRevisionRef.current;
      setAnnotationsLoading(true);
      try {
        const payload = await fetchPartAnnotations(projectId, selectedPart.id, { errorLabel: 'Failed to load annotations' });
        const annotationItems = Array.isArray(payload?.annotations) ? payload.annotations : [];
        if (isCurrent && annotationsMutationRevisionRef.current === requestMutationRevision) {
          setAnnotationsState((previous) => (
            JSON.stringify(previous) === JSON.stringify(annotationItems) ? previous : annotationItems
          ));
        }
      } catch (_err) {
        if (isCurrent && annotationsMutationRevisionRef.current === requestMutationRevision) {
          setAnnotationsState(embeddedFallback);
        }
      } finally {
        if (isCurrent) {
          setAnnotationsLoading(false);
        }
      }
    };

    loadAnnotations();
    return () => {
      isCurrent = false;
    };
  }, [
    isAllImagesSelection,
    projectId,
    selectedPart?.id,
    selectedPart?.metadata?.annotations,
    annotationsMutationRevisionRef,
    setAnnotationsLoading,
    setAnnotationsState,
  ]);

  useEffect(() => {
    if (selectedInspectionItemKey && !inspectionAnnotationItems.some((item) => item.key === selectedInspectionItemKey)) {
      setSelectedInspectionItemKey('');
    }
    const selectedItem = inspectionAnnotationItems.find((item) => item.key === selectedInspectionItemKey);
    if (selectedItem?.source?.resource === 'source_image') {
      setSelectedAnnotationId(null);
      setFullscreenBoundsEditAnnotationId(null);
      return;
    }
    if (!annotations.length) {
      setSelectedAnnotationId(null);
      setFullscreenBoundsEditAnnotationId(null);
      return;
    }
    if (!annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(annotations[0].id);
      const firstItem = inspectionAnnotationItems.find((item) => (
        item.source?.resource === 'annotation'
        && String(item.source.resourceId) === String(annotations[0].id)
      ));
      setSelectedInspectionItemKey(firstItem?.key || '');
    }
    if (fullscreenBoundsEditAnnotationId && !annotations.some((annotation) => String(annotation.id) === String(fullscreenBoundsEditAnnotationId))) {
      setFullscreenBoundsEditAnnotationId(null);
    }
  }, [
    annotations,
    inspectionAnnotationItems,
    selectedAnnotationId,
    selectedInspectionItemKey,
    fullscreenBoundsEditAnnotationId,
    setFullscreenBoundsEditAnnotationId,
    setSelectedAnnotationId,
    setSelectedInspectionItemKey,
  ]);
}
