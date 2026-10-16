import { useMemo } from 'react';
import { buildInspectionAnnotationItems } from '../../components/inspectionAnnotationAdapter';
import { getInspectionOverlayStyleTarget } from './inspectionAnnotationDisplay';

// Resolves the selected inspection item: the item for the selected annotation
// first, then the item with the selected key.
export const findSelectedInspectionItem = (items, selectedAnnotationId, selectedItemKey) => (
  (selectedAnnotationId
    ? items.find((item) => (
      item.source?.resource === 'annotation'
      && String(item.source.resourceId) === String(selectedAnnotationId)
    ))
    : null)
  || items.find((item) => item.key === selectedItemKey)
  || null
);

export default function useInspectionAnnotationItems({ annotations, selectedPartImageRefs }) {
  return useMemo(
    () => buildInspectionAnnotationItems(annotations, selectedPartImageRefs),
    [annotations, selectedPartImageRefs],
  );
}

export function useSelectedInspectionItem({
  inspectionAnnotationItems,
  selectedAnnotationId,
  selectedInspectionItemKey,
}) {
  const selectedInspectionItem = useMemo(
    () => findSelectedInspectionItem(inspectionAnnotationItems, selectedAnnotationId, selectedInspectionItemKey),
    [inspectionAnnotationItems, selectedAnnotationId, selectedInspectionItemKey],
  );
  return {
    selectedExternalOverlayResourceId: selectedInspectionItem?.kind === 'external_overlay'
      ? String(selectedInspectionItem.source?.resourceId || '')
      : '',
    selectedInspectionItem,
    selectedInspectionOverlayStyleTarget: getInspectionOverlayStyleTarget(selectedInspectionItem),
  };
}
