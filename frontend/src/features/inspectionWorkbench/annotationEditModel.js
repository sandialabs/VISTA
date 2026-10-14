import { getInspectionOverlayStyleDraft, getAnnotationColor, getAnnotationFillOpacity, getAnnotationTransparencyPercent } from './inspectionAnnotationDisplay';

export function buildAnnotationEditModel({
  annotationEditDraft,
  selectedInspectionOverlayStyleTarget,
  inspectionAnnotationItems,
  annotations,
  selectedAnnotationId,
  configuredDefectTypes,
}) {
  const styleTarget = annotationEditDraft?.resource
    ? { resource: annotationEditDraft.resource, resourceId: annotationEditDraft.resourceId }
    : selectedInspectionOverlayStyleTarget;
  const selectedItem = styleTarget
    ? inspectionAnnotationItems.find((item) => (
      item.source?.resource === styleTarget.resource
      && String(item.source?.resourceId || '') === String(styleTarget.resourceId || '')
    ))
    : null;
    const selected = selectedItem?.annotation
      || annotations.find((annotation) => annotation.id === selectedAnnotationId);
    const selectedOverlay = selectedItem?.overlay || annotationEditDraft || {};
  if (!selected && selectedItem?.kind !== 'external_overlay') return null;
  const isExternalOverlayConfig = selectedItem?.kind === 'external_overlay' || annotationEditDraft?.resource === 'source_image';
  const draft = annotationEditDraft || getInspectionOverlayStyleDraft(selectedItem) || {
    defect_class: String(selected?.defect_class || '').trim(),
    comment: selected?.comment || '',
    disposition: selected?.disposition || 'open',
    color: getAnnotationColor(selected),
    fill_opacity: getAnnotationFillOpacity(selected),
    transparency_percent: getAnnotationTransparencyPercent(selected),
  };
  const currentDefectClass = String(draft.defect_class || '').trim();
  const editDefectTypes = configuredDefectTypes.map((defectType) => (
    currentDefectClass
    && defectType.toLocaleLowerCase() === currentDefectClass.toLocaleLowerCase()
      ? currentDefectClass
      : (defectType.toLocaleLowerCase() === 'other' ? 'Other' : defectType)
  ));
  if (!isExternalOverlayConfig) {
    if (currentDefectClass && !editDefectTypes.includes(currentDefectClass)) {
      editDefectTypes.push(currentDefectClass);
    }
    if (!editDefectTypes.some((defectType) => defectType.toLocaleLowerCase() === 'other')) {
      editDefectTypes.push('Other');
    }
  }
  const transparencyPercent = draft.transparency_percent ?? getAnnotationTransparencyPercent({
    metadata: { annotation_fill_opacity: draft.fill_opacity },
  });
  return {
    selectedItem,
    selected,
    selectedOverlay,
    isExternalOverlayConfig,
    draft,
    currentDefectClass,
    editDefectTypes,
    transparencyPercent,
  };
}
