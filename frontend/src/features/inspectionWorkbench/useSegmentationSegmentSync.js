import { useEffect, useMemo } from 'react';
import { annotationToSegmentationHelperSegment } from './segmentationGeometry';

// Merges persisted segmentation annotations with unsaved local drafts for the
// active project/part scope. A draft replaces the persisted segment that
// matches its local or server ID; otherwise it is appended.
export const mergeSegmentationSegmentsWithDrafts = (annotations, localDraftEntries, scopePrefix) => {
  const persistedSegments = annotations.map(annotationToSegmentationHelperSegment).filter(Boolean);
  const localDrafts = localDraftEntries
    .filter(([key]) => key.startsWith(scopePrefix))
    .map(([, draft]) => draft);
  const mergedSegments = [...persistedSegments];
  localDrafts.forEach((draft) => {
    const localId = String(draft.localId || draft.segment?.id || '');
    const serverId = String(draft.serverId || '');
    const existingIndex = mergedSegments.findIndex((segment) => (
      String(segment.id) === localId
      || (serverId && String(segment.id) === serverId)
    ));
    if (existingIndex >= 0) mergedSegments[existingIndex] = draft.segment;
    else mergedSegments.push(draft.segment);
  });
  return mergedSegments;
};

export function useSelectedSegmentationSegment({ segmentationSegments, selectedSegmentationSegmentId }) {
  return useMemo(() => (
    segmentationSegments.find((segment) => segment.id === selectedSegmentationSegmentId) || segmentationSegments[0] || null
  ), [selectedSegmentationSegmentId, segmentationSegments]);
}

export default function useSegmentationSegmentSync({
  annotations,
  projectId,
  segmentationHelperActions,
  segmentationLocalDraftsRef,
  selectedPartId,
}) {
  useEffect(() => {
    segmentationHelperActions.syncSegments(mergeSegmentationSegmentsWithDrafts(
      annotations,
      [...segmentationLocalDraftsRef.current.entries()],
      `${projectId}:${selectedPartId}:`,
    ));
  }, [annotations, projectId, segmentationHelperActions, segmentationLocalDraftsRef, selectedPartId]);
}
