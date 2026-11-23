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

// Display names follow the calibration unit resolved for each annotation's image.
export default function useInspectionAnnotationItems({ annotations, selectedPartImageRefs, getCalibrationForImage }) {
  return useMemo(
    () => buildInspectionAnnotationItems(annotations, selectedPartImageRefs, {
      getUnitForAnnotation: (annotation) => (
        typeof getCalibrationForImage === 'function'
        && getCalibrationForImage(annotation?.image_id)?.unit === 'inches'
          ? 'inches'
          : 'mm'
      ),
    }),
    [annotations, selectedPartImageRefs, getCalibrationForImage],
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
