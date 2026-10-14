import { useCallback, useEffect } from 'react';
import { Actions } from 'flexlayout-react';
import { INSPECTION_VIEW_PARTS_TAB } from './inspectionConstants';
import { getAnnotationSourceImageId } from './partImageRefs';

// Returns the image ref of the selected-part image that an annotation belongs
// to, or '' when the annotation has no image or no matching image ref.
export const findImageRefForAnnotation = (annotation, selectedPartImageRefs, projectImageLookup) => {
  if (!annotation?.image_id) return '';
  const annotationImageId = String(annotation.image_id);
  const matchingEntry = selectedPartImageRefs.find((entry) => {
    const sourceImageId = getAnnotationSourceImageId(entry, projectImageLookup);
    return String(sourceImageId || entry.imageId || '') === annotationImageId;
  });
  return matchingEntry ? String(matchingEntry.imageRef || '') : '';
};

// Applies a pending focus request (from a part-row annotation chip) once the
// requested part is selected: selects the annotation and its image, switches
// to the single-column Parts tab, and closes the utility modal.
export default function useInspectionFocusRequest({
  annotations,
  inspectionAnnotationItems,
  inspectionFlexLayoutModel,
  inspectionFocusRequest,
  projectImageLookup,
  selectedPart,
  selectedPartImageRefs,
  setActiveInspectionViewTab,
  setActiveWorkbenchModal,
  setInspectionFocusRequest,
  setSelectedAnnotationId,
  setSelectedImageRef,
  setSelectedInspectionItemKey,
  setTileColumnCount,
}) {
  const getImageRefForAnnotation = useCallback(
    (annotation) => findImageRefForAnnotation(annotation, selectedPartImageRefs, projectImageLookup),
    [projectImageLookup, selectedPartImageRefs],
  );

  useEffect(() => {
    if (!inspectionFocusRequest) return;
    if (String(selectedPart?.id || '') !== String(inspectionFocusRequest.partId || '')) return;
    const annotation = annotations.find((candidate) => (
      String(candidate.id) === String(inspectionFocusRequest.annotationId)
    ));
    if (!annotation) return;
    const matchingItem = inspectionAnnotationItems.find((item) => (
      item.source?.resource === 'annotation'
      && String(item.source.resourceId) === String(annotation.id)
    ));
    const imageRef = getImageRefForAnnotation(annotation);
    if (imageRef) {
      setSelectedImageRef(imageRef);
    }
    setTileColumnCount(1);
    setSelectedAnnotationId(annotation.id);
    setSelectedInspectionItemKey(matchingItem?.key || `annotation:${annotation.id}`);
    setActiveInspectionViewTab(INSPECTION_VIEW_PARTS_TAB);
    try {
      inspectionFlexLayoutModel.doAction(Actions.selectTab(`inspection-tab-${INSPECTION_VIEW_PARTS_TAB}`));
    } catch (_err) {
      // Selection is still applied even if the current layout cannot switch tabs.
    }
    setActiveWorkbenchModal(null);
    setInspectionFocusRequest(null);
  }, [
    annotations,
    getImageRefForAnnotation,
    inspectionAnnotationItems,
    inspectionFlexLayoutModel,
    inspectionFocusRequest,
    selectedPart,
    selectedPartImageRefs,
    setActiveInspectionViewTab,
    setActiveWorkbenchModal,
    setInspectionFocusRequest,
    setSelectedAnnotationId,
    setSelectedImageRef,
    setSelectedInspectionItemKey,
    setTileColumnCount,
  ]);
}
