import { useMemo } from 'react';

export const ALL_PARTS_ID = '__all_parts__';

const REJECT_PART_DISPOSITION = 'reject_part';

export function hasDroppedMetadataField(part, field) {
  const metadata = part?.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  const value = metadata[field];
  if (!Array.isArray(value)) return false;
  return value.some((item) => !item || typeof item !== 'object' || Array.isArray(item));
}

export function isRejectPartAnnotation(annotation) {
  return String(annotation?.disposition || '').trim().toLowerCase() === REJECT_PART_DISPOSITION;
}

export function getPartRejectAnnotation(part) {
  const annotations = Array.isArray(part?.metadata?.annotations) ? part.metadata.annotations : [];
  return annotations.find(isRejectPartAnnotation) || null;
}

export function getPartReviewState(part) {
  return getPartRejectAnnotation(part) ? 'reject_confirmed' : (part?.review_state || 'unreviewed');
}

function getDefectCount(part) {
  const defects = part?.metadata?.defects;
  if (Array.isArray(defects)) return defects.length;
  const explicitCount = part?.metadata?.defect_count;
  return Number.isFinite(explicitCount) ? explicitCount : 0;
}

export function filterInspectionParts({
  normalizationTriageField = '',
  partFilter = '',
  parts = [],
  reviewFilter = 'all',
  selectedBatchId = '',
  sortMode = 'part_asc',
} = {}) {
  let output = Array.isArray(parts) ? [...parts] : [];

  if (selectedBatchId) {
    output = output.filter((part) => part.batch_id === selectedBatchId);
  }
  if (reviewFilter !== 'all') {
    if (reviewFilter === 'manual') {
      output = output.filter((part) => part?.metadata?.manual_flagged === true);
    } else if (reviewFilter === 'none') {
      output = output.filter((part) => getPartReviewState(part) === 'unreviewed');
    } else {
      output = output.filter((part) => String(getPartReviewState(part)).toLowerCase() === reviewFilter);
    }
  }
  if (partFilter.trim()) {
    const query = partFilter.trim().toLowerCase();
    output = output.filter((part) => {
      const candidate = `${part.id || ''} ${part.display_name || ''} ${part.serial_number || ''} ${part.batch_id || ''}`.toLowerCase();
      return candidate.includes(query);
    });
  }
  if (normalizationTriageField) {
    output = output.filter((part) => hasDroppedMetadataField(part, normalizationTriageField));
  }

  if (sortMode === 'defect_desc') {
    output.sort((a, b) => getDefectCount(b) - getDefectCount(a));
  } else if (sortMode === 'batch_asc') {
    output.sort((a, b) => String(a.batch_id || '').localeCompare(String(b.batch_id || '')));
  } else if (sortMode === 'status_asc') {
    output.sort((a, b) => String(getPartReviewState(a)).localeCompare(String(getPartReviewState(b))));
  } else {
    output.sort((a, b) => String(a.serial_number).localeCompare(String(b.serial_number)));
  }

  return output;
}

export default function useInspectionPartSelection({
  activeInspectionViewTab,
  inspectionViewAllImagesTab,
  normalizationTriageField,
  partFilter,
  parts,
  reviewFilter,
  selectedBatchId,
  selectedPartId,
  sortMode,
}) {
  const isAllImagesSelection = activeInspectionViewTab === inspectionViewAllImagesTab;
  const filteredParts = useMemo(() => filterInspectionParts({
    normalizationTriageField,
    partFilter,
    parts,
    reviewFilter,
    selectedBatchId,
    sortMode,
  }), [parts, selectedBatchId, reviewFilter, partFilter, normalizationTriageField, sortMode]);
  const normalizationTriageMatchCount = useMemo(() => {
    if (!normalizationTriageField) return 0;
    return (Array.isArray(parts) ? parts : []).filter((part) => (
      hasDroppedMetadataField(part, normalizationTriageField)
    )).length;
  }, [parts, normalizationTriageField]);
  const selectedRealPart = useMemo(
    () => filteredParts.find((part) => String(part.id) === String(selectedPartId)) || null,
    [filteredParts, selectedPartId],
  );
  const selectedPart = isAllImagesSelection ? null : (selectedRealPart || filteredParts[0] || null);
  const activeSelectionId = isAllImagesSelection ? ALL_PARTS_ID : (selectedPart?.id || '');

  return {
    activeSelectionId,
    filteredParts,
    isAllImagesSelection,
    normalizationTriageMatchCount,
    selectedPart,
    selectedRealPart,
  };
}
