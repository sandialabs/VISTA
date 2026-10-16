import { useCallback, useState } from 'react';

import {
  getAnnotationColor,
  getAnnotationFillOpacity,
  getAnnotationTransparencyPercent,
  getInspectionOverlayStyleDraft,
} from './inspectionAnnotationDisplay';

export const EMPTY_ANNOTATION_BBOX_DRAFT = { x: '', y: '', width: '', height: '' };

export function getDefaultAnnotationDraft({ enabledModalities = [], modalityOptions = [] } = {}) {
  return {
    defect_class: '',
    modality: enabledModalities[0] || modalityOptions[0] || 'visual',
    comment: '',
    disposition: 'open',
    measurement_name: '',
    measurement_value: '',
    bbox: { ...EMPTY_ANNOTATION_BBOX_DRAFT },
  };
}

export function getAnnotationEditDraft(annotation) {
  if (!annotation?.id) return null;
  return {
    id: annotation.id,
    defect_class: String(annotation.defect_class || '').trim(),
    comment: annotation.comment || '',
    disposition: annotation.disposition || 'open',
    color: getAnnotationColor(annotation),
    fill_opacity: getAnnotationFillOpacity(annotation),
    transparency_percent: getAnnotationTransparencyPercent(annotation),
  };
}

export default function useInspectionAnnotationModals({
  enabledModalities,
  inspectionAnnotationItems,
  modalityOptions,
  setSelectedAnnotationId,
  setSelectedImageRef,
  setSelectedInspectionItemKey,
}) {
  const [annotationDraft, setAnnotationDraft] = useState(() => getDefaultAnnotationDraft());
  const [otherAnnotationModalVisible, setOtherAnnotationModalVisible] = useState(false);
  const [annotationEditModalVisible, setAnnotationEditModalVisible] = useState(false);
  const [annotationEditDraft, setAnnotationEditDraft] = useState(null);

  const resetAnnotationDraft = useCallback(() => {
    setAnnotationDraft(getDefaultAnnotationDraft({ enabledModalities, modalityOptions }));
  }, [enabledModalities, modalityOptions]);

  const openOtherAnnotationModal = useCallback(() => {
    resetAnnotationDraft();
    setOtherAnnotationModalVisible(true);
  }, [resetAnnotationDraft]);

  const closeOtherAnnotationModal = useCallback(() => {
    setOtherAnnotationModalVisible(false);
  }, []);

  const openAnnotationEditModal = useCallback((annotation) => {
    const draft = getAnnotationEditDraft(annotation);
    if (!draft) return;
    const matchingItem = inspectionAnnotationItems.find((item) => (
      item.source?.resource === 'annotation'
      && String(item.source.resourceId) === String(annotation.id)
    ));
    setSelectedAnnotationId(annotation.id);
    setSelectedInspectionItemKey(matchingItem?.key || `annotation:${annotation.id}`);
    setAnnotationEditDraft(draft);
    setAnnotationEditModalVisible(true);
  }, [inspectionAnnotationItems, setSelectedAnnotationId, setSelectedInspectionItemKey]);

  const openInspectionItemConfigModal = useCallback((item) => {
    if (!item) return;
    if (item.source?.resource === 'annotation') {
      openAnnotationEditModal(item.annotation);
      return;
    }
    if (item.source?.resource === 'source_image') {
      setSelectedInspectionItemKey(item.key);
      setSelectedAnnotationId(null);
      setAnnotationEditDraft(getInspectionOverlayStyleDraft(item));
      setAnnotationEditModalVisible(true);
    }
  }, [openAnnotationEditModal, setSelectedAnnotationId, setSelectedInspectionItemKey]);

  const selectInspectionAnnotationItem = useCallback((item) => {
    if (!item) return;
    setSelectedInspectionItemKey(item.key);
    if (item.source?.resource === 'annotation') {
      setSelectedAnnotationId(item.source.resourceId || item.id);
      return;
    }
    if (item.source?.resource === 'source_image') {
      setSelectedAnnotationId(null);
      const targetRef = item.overlay?.imageRef || item.overlay?.imageId || item.overlay?.filename || item.source.resourceId;
      if (targetRef) setSelectedImageRef(String(targetRef));
    }
  }, [setSelectedAnnotationId, setSelectedImageRef, setSelectedInspectionItemKey]);

  const closeAnnotationEditModal = useCallback(() => {
    setAnnotationEditModalVisible(false);
    setAnnotationEditDraft(null);
  }, []);

  return {
    annotationDraft,
    annotationEditDraft,
    annotationEditModalVisible,
    closeAnnotationEditModal,
    closeOtherAnnotationModal,
    openAnnotationEditModal,
    openInspectionItemConfigModal,
    openOtherAnnotationModal,
    otherAnnotationModalVisible,
    resetAnnotationDraft,
    selectInspectionAnnotationItem,
    setAnnotationDraft,
    setAnnotationEditDraft,
    setAnnotationEditModalVisible,
    setOtherAnnotationModalVisible,
  };
}
