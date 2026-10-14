import { makeVistaSegmentAnnotationPayload } from '../../components/inspectionAnnotationAdapter';
import { deletePartAnnotation, savePartAnnotation } from '../../api/parts';
import { annotationToSegmentationHelperSegment } from './segmentationGeometry';
import { clampSegmentationSlicePatch } from './segmentationVolumeGeometry';

const mergeSavedSegmentAnnotation = (prev, saved, localId, resolvedAnnotationId) => {
  let inserted = false;
  const next = [];
  prev.forEach((annotation) => {
    const candidateId = String(annotation.id);
    if (candidateId === String(localId) && candidateId !== resolvedAnnotationId) return;
    if (candidateId === resolvedAnnotationId) {
      if (!inserted) next.push(saved);
      inserted = true;
      return;
    }
    next.push(annotation);
  });
  if (!inserted) next.unshift(saved);
  return next;
};

/**
 * Serializes VISTA segment saves and deletes per segment behind one POST and
 * later PATCHes. Responses only touch panel state while the queue's part is
 * still the active persistence scope; stale responses update the id maps only.
 */
export function useSegmentationPersistence({
  readOnly,
  projectId,
  selectedPart,
  annotations,
  setAnnotations,
  setSelectedAnnotationId,
  setError,
  segmentationSegments,
  segmentationHelperActions,
  segmentationMutationQueuesRef,
  segmentationServerIdsRef,
  segmentationLocalDraftsRef,
  activeSegmentationPersistenceScopeRef,
  getSegmentationVolumeDimensions,
}) {
  const isActiveQueueScope = (queue) => (
    activeSegmentationPersistenceScopeRef.current === `${queue.projectId}:${queue.partId}`
  );

  const runQueuedDelete = async (queueKey, queue, mutation, annotationId) => {
    if (!annotationId) {
      setError('Failed to delete segment annotation (missing annotation id)');
      mutation.resolve(false);
      return;
    }
    try {
      await deletePartAnnotation(queue.projectId, queue.partId, annotationId, { readOnly, errorLabel: 'Failed to delete segment annotation' });
      segmentationLocalDraftsRef.current.delete(queueKey);
      segmentationServerIdsRef.current.delete(queueKey);
      segmentationServerIdsRef.current.delete(`${queue.projectId}:${queue.partId}:${annotationId}`);
      if (isActiveQueueScope(queue)) {
        setAnnotations((prev) => prev.filter((annotation) => (
          String(annotation.id) !== String(annotationId)
          && String(annotation.id) !== String(queue.localId)
        )));
        segmentationHelperActions.removeSegment(annotationId, queue.localId);
        setSelectedAnnotationId((current) => (
          String(current) === String(annotationId) ? null : current
        ));
      }
      mutation.resolve(true);
    } catch (err) {
      queue.deleted = false;
      setError(err.message || 'Failed to delete segment annotation');
      mutation.resolve(false);
    }
  };

  const recordSavedSegment = (queueKey, queue, saved, resolvedAnnotationId) => {
    queue.serverId = resolvedAnnotationId;
    queue.lastSavedAnnotation = saved;
    segmentationServerIdsRef.current.set(queueKey, resolvedAnnotationId);
    segmentationServerIdsRef.current.set(
      `${queue.projectId}:${queue.partId}:${resolvedAnnotationId}`,
      resolvedAnnotationId,
    );
    const currentDraft = segmentationLocalDraftsRef.current.get(queueKey);
    if (currentDraft) {
      segmentationLocalDraftsRef.current.set(queueKey, {
        ...currentDraft,
        serverId: resolvedAnnotationId,
      });
    }
  };

  const applyLatestSavedSegment = (queueKey, queue, saved, resolvedAnnotationId) => {
    segmentationLocalDraftsRef.current.delete(queueKey);
    if (!isActiveQueueScope(queue)) return;
    setAnnotations((prev) => mergeSavedSegmentAnnotation(prev, saved, queue.localId, resolvedAnnotationId));
    const savedSegment = annotationToSegmentationHelperSegment(saved);
    segmentationHelperActions.replaceSavedSegment(queue.localId, resolvedAnnotationId, savedSegment);
    setSelectedAnnotationId(resolvedAnnotationId);
  };

  const runQueuedSave = async (queueKey, queue, mutation, annotationId) => {
    const payload = makeVistaSegmentAnnotationPayload(mutation.segment, queue.lastSavedAnnotation || null);
    try {
      const responseAnnotation = await savePartAnnotation(
        queue.projectId,
        queue.partId,
        payload,
        annotationId,
        { readOnly, errorLabel: 'Failed to save segment annotation' },
      );
      const resolvedAnnotationId = String(annotationId || responseAnnotation?.id || '');
      if (!resolvedAnnotationId) throw new Error('Failed to save segment annotation (missing annotation id)');

      // Treat the submitted mutation as authoritative. A delayed or stale response may
      // contain older geometry, but it must never roll the local helper back.
      const saved = {
        ...(responseAnnotation || {}),
        ...payload,
        id: resolvedAnnotationId,
        geometry: payload.geometry,
        metadata: payload.metadata,
      };
      recordSavedSegment(queueKey, queue, saved, resolvedAnnotationId);
      const isLatestMutation = mutation.version === queue.latestVersion && queue.pending.length === 0;
      if (isLatestMutation) applyLatestSavedSegment(queueKey, queue, saved, resolvedAnnotationId);
      mutation.resolve(saved);
    } catch (err) {
      setError(err.message || 'Failed to save segment annotation');
      mutation.resolve(null);
      if (!annotationId) {
        // Without a server id, later entries cannot be PATCHed safely. Keep the
        // latest local draft visible and let the next user edit retry one POST.
        queue.pending.splice(0).forEach((pendingMutation) => pendingMutation.resolve(null));
      }
    }
  };

  const drainSegmentationMutationQueue = async (queueKey) => {
    const queue = segmentationMutationQueuesRef.current.get(queueKey);
    if (!queue || queue.running) return;
    queue.running = true;

    while (queue.pending.length > 0) {
      const mutation = queue.pending.shift();
      const annotationId = queue.serverId || segmentationServerIdsRef.current.get(queueKey) || '';
      if (mutation.type === 'delete') {
        await runQueuedDelete(queueKey, queue, mutation, annotationId);
        continue;
      }
      await runQueuedSave(queueKey, queue, mutation, annotationId);
    }

    queue.running = false;
    if (queue.pending.length === 0) segmentationMutationQueuesRef.current.delete(queueKey);
  };

  const getOrCreateSegmentQueue = (queueKey, localId, serverId, lastSavedLookupId) => {
    let queue = segmentationMutationQueuesRef.current.get(queueKey);
    if (!queue) {
      queue = {
        projectId,
        partId: String(selectedPart.id),
        localId,
        serverId,
        lastSavedAnnotation: annotations.find((annotation) => (
          String(annotation.id) === String(lastSavedLookupId)
        )) || null,
        latestVersion: 0,
        pending: [],
        running: false,
        deleted: false,
      };
      segmentationMutationQueuesRef.current.set(queueKey, queue);
    }
    return queue;
  };

  const persistSegmentationSegment = (segment) => {
    if (readOnly) return Promise.resolve(null);
    if (!selectedPart?.id || !segment) return Promise.resolve(null);
    const localId = String(segment.id || segment.annotationId || '');
    if (!localId) return Promise.resolve(null);
    const queueKey = `${projectId}:${selectedPart.id}:${localId}`;
    const knownServerId = String(
      segmentationServerIdsRef.current.get(queueKey)
      || segment.annotationId
      || annotations.find((annotation) => String(annotation.id) === localId)?.id
      || '',
    );
    const queue = getOrCreateSegmentQueue(queueKey, localId, knownServerId, knownServerId || localId);
    if (queue.deleted) return Promise.resolve(null);
    queue.latestVersion += 1;
    const version = queue.latestVersion;
    const segmentSnapshot = {
      ...segment,
      areas: Array.isArray(segment.areas) ? [...segment.areas] : [],
    };
    segmentationLocalDraftsRef.current.set(queueKey, {
      localId,
      serverId: queue.serverId,
      version,
      segment: segmentSnapshot,
    });
    const supersededSaves = queue.pending.filter((entry) => entry.type === 'save');
    if (supersededSaves.length > 0) {
      queue.pending = queue.pending.filter((entry) => entry.type !== 'save');
      supersededSaves.forEach((entry) => entry.resolve(null));
    }
    const result = new Promise((resolve) => {
      queue.pending.push({ type: 'save', version, segment: segmentSnapshot, resolve });
    });
    drainSegmentationMutationQueue(queueKey);
    return result;
  };

  const deleteSegmentationSegment = (segmentId) => {
    if (readOnly) return Promise.resolve(false);
    if (!selectedPart?.id || !segmentId) return Promise.resolve(false);
    const segment = segmentationSegments.find((candidate) => (
      String(candidate.id) === String(segmentId)
      || String(candidate.annotationId) === String(segmentId)
    ));
    const localId = String(segment?.id || segmentId);
    const queueKey = `${projectId}:${selectedPart.id}:${localId}`;
    const knownServerId = String(
      segmentationServerIdsRef.current.get(queueKey)
      || segment?.annotationId
      || annotations.find((annotation) => String(annotation.id) === String(segmentId))?.id
      || segmentId,
    );
    const queue = getOrCreateSegmentQueue(queueKey, localId, knownServerId, knownServerId);
    if (queue.deleted) return Promise.resolve(false);
    queue.deleted = true;
    queue.latestVersion += 1;
    const result = new Promise((resolve) => {
      queue.pending.push({ type: 'delete', version: queue.latestVersion, resolve });
    });
    drainSegmentationMutationQueue(queueKey);
    return result;
  };

  const updateSegmentationSegment = (segmentId, patch) => {
    if (readOnly) return;
    segmentationHelperActions.patchSegment(segmentId, patch);
  };

  const saveSegmentationSegmentPatch = async (segmentId, patch = {}) => {
    if (readOnly) return null;
    const segment = segmentationSegments.find((entry) => String(entry.id) === String(segmentId));
    if (!segment) return null;
    const next = clampSegmentationSlicePatch(segment, patch, getSegmentationVolumeDimensions());
    updateSegmentationSegment(segmentId, next);
    return persistSegmentationSegment(next);
  };

  return {
    persistSegmentationSegment,
    deleteSegmentationSegment,
    updateSegmentationSegment,
    saveSegmentationSegmentPatch,
  };
}
