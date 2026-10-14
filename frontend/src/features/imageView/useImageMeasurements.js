import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbortError } from '../../utils/useRouteRequestOwnership';
import {
  getImageMeasurements,
  getMeasurementIds,
  mergeImageMeasurements,
  reconcileVisibleMeasurementIds,
  upsertMeasurementById,
} from '../../utils/measurementState';
import {
  buildFilteredVisibleMeasurementIds,
  buildUpsertedVisibleMeasurementIds,
  getMeasurementMutationKey,
} from './measurementMutationPayloads';
import { createMeasurementMutationQueue } from './measurementMutationQueue';
import persistImageMeasurements from './persistImageMeasurements';
import useMeasurementMutationGeneration from './useMeasurementMutationGeneration';

// Measurement writes are optimistic in the active route but serialized by
// project-image resource for the lifetime of this view. A mutation acknowledges
// or fails independently of route navigation, so staleness here is about which
// mutation attempt is the most recent for a given image, not which route owns
// the request. useRouteRequestOwnership models route-scoped request ownership
// and does not fit that per-mutation ordering, so this hook delegates to
// useMeasurementMutationGeneration for that per-mutation ordering while still
// consulting the current route instance key before touching component state.
export default function useImageMeasurements({
  activeRouteInstanceKeyRef,
  imageId,
  projectArchived,
  projectId,
  routeInstanceKey,
  setError,
  updateCurrentImage,
}) {
  const EMPTY_LIST = useRef(Object.freeze([])).current;
  const [measurementsState, setMeasurementsState] = useState({
    routeInstanceKey: null,
    value: EMPTY_LIST,
  });
  const measurements = measurementsState.routeInstanceKey === routeInstanceKey
    ? measurementsState.value
    : EMPTY_LIST;
  const [measurementActiveState, setMeasurementActiveState] = useState({
    routeInstanceKey: null,
    value: false,
  });
  const measurementActive = measurementActiveState.routeInstanceKey === routeInstanceKey
    ? measurementActiveState.value
    : false;
  const [selectedMeasurementState, setSelectedMeasurementState] = useState({
    routeInstanceKey: null,
    value: null,
  });
  const selectedMeasurementId = selectedMeasurementState.routeInstanceKey === routeInstanceKey
    ? selectedMeasurementState.value
    : null;
  const [visibleMeasurementsState, setVisibleMeasurementsState] = useState({
    routeInstanceKey: null,
    value: null,
  });
  const visibleMeasurementIds = visibleMeasurementsState.routeInstanceKey === routeInstanceKey
    ? visibleMeasurementsState.value
    : null;

  const measurementsRef = useRef([]);
  const visibleMeasurementIdsRef = useRef(null);
  const visibilityRevisionRef = useRef(0);
  const {
    advanceGeneration: advanceMutationGeneration,
    beginGeneration: beginMutationGeneration,
    isCurrentGeneration: isCurrentMutationGeneration,
  } = useMeasurementMutationGeneration();
  const [measurementMutationQueue] = useState(createMeasurementMutationQueue);
  const confirmedMeasurementsByRouteRef = useRef(new Map());
  const componentMountedRef = useRef(true);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
    };
  }, []);

  const replaceMeasurements = useCallback((nextMeasurements, expectedRouteInstanceKey = activeRouteInstanceKeyRef.current) => {
    if (activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey) return;
    measurementsRef.current = nextMeasurements;
    setMeasurementsState({
      routeInstanceKey: expectedRouteInstanceKey,
      value: nextMeasurements,
    });
  }, [activeRouteInstanceKeyRef]);

  const replaceVisibleMeasurementIds = useCallback((nextVisibleMeasurementIds, expectedRouteInstanceKey = activeRouteInstanceKeyRef.current) => {
    if (activeRouteInstanceKeyRef.current !== expectedRouteInstanceKey) return;
    visibleMeasurementIdsRef.current = nextVisibleMeasurementIds;
    setVisibleMeasurementsState({
      routeInstanceKey: expectedRouteInstanceKey,
      value: nextVisibleMeasurementIds,
    });
  }, [activeRouteInstanceKeyRef]);

  // Called by useImageRecordLoader right before it starts fetching a new
  // image, so measurement state is cleared and the current mutation
  // revision for this image is captured before the load resolves.
  const prepareForNewImageLoad = useCallback((targetProjectId, targetImageId, expectedRouteInstanceKey) => {
    visibilityRevisionRef.current = 0;
    advanceMutationGeneration();
    const imageMutationKey = getMeasurementMutationKey(targetProjectId, targetImageId);
    const measurementMutationRevisionAtLoad = measurementMutationQueue.getRevision(imageMutationKey);
    replaceMeasurements(EMPTY_LIST, expectedRouteInstanceKey);
    replaceVisibleMeasurementIds(null, expectedRouteInstanceKey);
    return { imageMutationKey, measurementMutationRevisionAtLoad };
  }, [
    EMPTY_LIST,
    advanceMutationGeneration,
    measurementMutationQueue,
    replaceMeasurements,
    replaceVisibleMeasurementIds,
  ]);

  // Called by useImageRecordLoader once a new image has loaded successfully.
  const commitLoadedMeasurements = useCallback((
    imageData,
    expectedRouteInstanceKey,
    imageMutationKey,
    measurementMutationRevisionAtLoad,
  ) => {
    const imageMeasurements = getImageMeasurements(imageData);
    const measurementIds = getMeasurementIds(imageMeasurements);
    measurementMutationQueue.replaceConfirmedIfSettled(
      imageMutationKey,
      measurementMutationRevisionAtLoad,
      imageMeasurements,
    );
    for (const confirmedRouteInstanceKey of confirmedMeasurementsByRouteRef.current.keys()) {
      if (confirmedRouteInstanceKey !== expectedRouteInstanceKey) {
        confirmedMeasurementsByRouteRef.current.delete(confirmedRouteInstanceKey);
      }
    }
    confirmedMeasurementsByRouteRef.current.set(expectedRouteInstanceKey, imageMeasurements);
    replaceMeasurements(imageMeasurements, expectedRouteInstanceKey);
    replaceVisibleMeasurementIds(
      measurementIds.length > 0 ? measurementIds : null,
      expectedRouteInstanceKey,
    );
    visibilityRevisionRef.current = 0;
  }, [measurementMutationQueue, replaceMeasurements, replaceVisibleMeasurementIds]);

  // Called by useImageRecordLoader's load effect cleanup.
  const discardRouteMeasurements = useCallback((expectedRouteInstanceKey) => {
    advanceMutationGeneration();
    confirmedMeasurementsByRouteRef.current.delete(expectedRouteInstanceKey);
  }, [advanceMutationGeneration]);

  // Reset route-scoped measurement UI state when image changes.
  useEffect(() => {
    setMeasurementActiveState({ routeInstanceKey, value: false });
    setSelectedMeasurementState({ routeInstanceKey, value: null });
  }, [routeInstanceKey]);

  const setRouteMeasurementActive = useCallback((nextMeasurementActive) => {
    if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return;
    if (
      nextMeasurementActive
      && !confirmedMeasurementsByRouteRef.current.has(routeInstanceKey)
    ) return;
    setMeasurementActiveState({
      routeInstanceKey,
      value: nextMeasurementActive,
    });
  }, [activeRouteInstanceKeyRef, routeInstanceKey]);

  const setRouteSelectedMeasurementId = useCallback((nextMeasurementId) => {
    if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return;
    setSelectedMeasurementState({
      routeInstanceKey,
      value: nextMeasurementId,
    });
  }, [activeRouteInstanceKeyRef, routeInstanceKey]);

  const isRouteStillActive = useCallback((expectedRouteInstanceKey) => (
    componentMountedRef.current
    && activeRouteInstanceKeyRef.current === expectedRouteInstanceKey
  ), [activeRouteInstanceKeyRef]);

  const applyConfirmedMeasurements = useCallback((confirmedMeasurements, preferredVisibleMeasurementIds) => {
    const confirmedVisibleIds = reconcileVisibleMeasurementIds(
      confirmedMeasurements,
      preferredVisibleMeasurementIds,
    );
    replaceMeasurements(confirmedMeasurements);
    replaceVisibleMeasurementIds(confirmedVisibleIds);
    updateCurrentImage((currentImage) => (
      mergeImageMeasurements(currentImage, confirmedMeasurements)
    ));
  }, [replaceMeasurements, replaceVisibleMeasurementIds, updateCurrentImage]);

  // Rolls a failed mutation back to the last acknowledged server state unless a
  // later mutation, reset, or navigation has superseded it.
  const handleMutationFailure = useCallback((mutationError, {
    expectedRouteInstanceKey,
    failureLogPrefix,
    failureMessage,
    generation,
    imageMutationKey,
    originalMeasurements,
    originalVisibleIds,
    visibilityRevisionAtMutation,
  }) => {
    if (
      isAbortError(mutationError)
      || !isCurrentMutationGeneration(generation)
      || !isRouteStillActive(expectedRouteInstanceKey)
    ) return;
    console.error(failureLogPrefix, mutationError);
    setError(`${failureMessage}. Please try again.`);
    applyConfirmedMeasurements(
      measurementMutationQueue.getConfirmedMeasurements(imageMutationKey) || originalMeasurements,
      visibilityRevisionRef.current === visibilityRevisionAtMutation
        ? originalVisibleIds
        : visibleMeasurementIdsRef.current,
    );
  }, [
    applyConfirmedMeasurements,
    isCurrentMutationGeneration,
    isRouteStillActive,
    measurementMutationQueue,
    setError,
  ]);

  // Measurement writes are optimistic in the active route but serialized by
  // project-image resource through measurementMutationQueue. Each queued write
  // is rebased onto the last acknowledged server representation so a later
  // operation after navigation does not overwrite it with a stale full state.
  const persistMeasurementMutation = useCallback(async ({
    applyMeasurementMutation,
    buildNextVisibleMeasurementIds,
    failureLogPrefix,
    failureMessage,
  }) => {
    const expectedRouteInstanceKey = routeInstanceKey;
    if (
      projectArchived !== false
      || !isRouteStillActive(expectedRouteInstanceKey)
      || !confirmedMeasurementsByRouteRef.current.has(expectedRouteInstanceKey)
    ) return;
    const originalMeasurements = [...measurementsRef.current];
    const originalVisibleIds = visibleMeasurementIdsRef.current
      ? [...visibleMeasurementIdsRef.current]
      : null;
    const visibilityRevisionAtMutation = visibilityRevisionRef.current;
    const optimisticMeasurements = applyMeasurementMutation(originalMeasurements);
    const imageMutationKey = getMeasurementMutationKey(projectId, imageId);

    const generation = beginMutationGeneration();
    replaceMeasurements(optimisticMeasurements, expectedRouteInstanceKey);
    replaceVisibleMeasurementIds(
      buildNextVisibleMeasurementIds(originalVisibleIds, optimisticMeasurements),
      expectedRouteInstanceKey,
    );

    try {
      const acknowledgedMeasurements = await measurementMutationQueue.enqueue(imageMutationKey, {
        initialConfirmedMeasurements: (
          confirmedMeasurementsByRouteRef.current.get(expectedRouteInstanceKey)
          || originalMeasurements
        ),
        persist: (confirmedMeasurements) => persistImageMeasurements(
          imageId,
          applyMeasurementMutation(confirmedMeasurements),
          failureMessage,
        ),
        onConfirmed: (confirmedMeasurements) => {
          if (!isRouteStillActive(expectedRouteInstanceKey)) return;
          confirmedMeasurementsByRouteRef.current.set(expectedRouteInstanceKey, confirmedMeasurements);
        },
      });
      if (isCurrentMutationGeneration(generation) && isRouteStillActive(expectedRouteInstanceKey)) {
        applyConfirmedMeasurements(acknowledgedMeasurements, visibleMeasurementIdsRef.current);
      }
    } catch (mutationError) {
      handleMutationFailure(mutationError, {
        expectedRouteInstanceKey,
        failureLogPrefix,
        failureMessage,
        generation,
        imageMutationKey,
        originalMeasurements,
        originalVisibleIds,
        visibilityRevisionAtMutation,
      });
    }
  }, [
    applyConfirmedMeasurements,
    beginMutationGeneration,
    handleMutationFailure,
    imageId,
    isCurrentMutationGeneration,
    isRouteStillActive,
    measurementMutationQueue,
    projectArchived,
    projectId,
    replaceMeasurements,
    replaceVisibleMeasurementIds,
    routeInstanceKey,
  ]);

  const handleSaveMeasurement = useCallback((measurement) => persistMeasurementMutation({
    applyMeasurementMutation: (baseMeasurements) => (
      upsertMeasurementById(baseMeasurements, measurement)
    ),
    buildNextVisibleMeasurementIds: (originalVisibleIds, updatedMeasurements) => (
      buildUpsertedVisibleMeasurementIds({
        originalVisibleIds,
        updatedMeasurements,
        measurementId: measurement?.id,
      })
    ),
    failureLogPrefix: 'Error saving measurement:',
    failureMessage: 'Failed to save measurement',
  }), [persistMeasurementMutation]);

  const handleDeleteMeasurement = useCallback((measurementId) => persistMeasurementMutation({
    applyMeasurementMutation: (baseMeasurements) => baseMeasurements.filter(
      (measurement) => String(measurement.id) !== String(measurementId),
    ),
    buildNextVisibleMeasurementIds: (originalVisibleIds, updatedMeasurements) => (
      buildFilteredVisibleMeasurementIds({ originalVisibleIds, updatedMeasurements })
    ),
    failureLogPrefix: 'Error deleting measurement:',
    failureMessage: 'Failed to delete measurement',
  }), [persistMeasurementMutation]);

  const handleRenameMeasurement = useCallback((measurementId, newName) => persistMeasurementMutation({
    applyMeasurementMutation: (baseMeasurements) => baseMeasurements.map((measurement) => (
      String(measurement.id) === String(measurementId)
        ? { ...measurement, name: newName }
        : measurement
    )),
    buildNextVisibleMeasurementIds: (originalVisibleIds) => originalVisibleIds,
    failureLogPrefix: 'Error renaming measurement:',
    failureMessage: 'Failed to rename measurement',
  }), [persistMeasurementMutation]);

  const handleToggleVisibility = useCallback((measurementId) => {
    if (activeRouteInstanceKeyRef.current !== routeInstanceKey) return;
    const previousIds = visibleMeasurementIdsRef.current;
    let nextIds;
    if (!previousIds) {
      nextIds = [measurementId];
    } else if (previousIds.includes(measurementId)) {
      nextIds = previousIds.filter((id) => id !== measurementId);
    } else {
      nextIds = [...previousIds, measurementId];
    }
    visibilityRevisionRef.current += 1;
    replaceVisibleMeasurementIds(nextIds);
  }, [activeRouteInstanceKeyRef, replaceVisibleMeasurementIds, routeInstanceKey]);

  return {
    glue: {
      commitLoadedMeasurements,
      discardRouteMeasurements,
      prepareForNewImageLoad,
    },
    handleDeleteMeasurement,
    handleRenameMeasurement,
    handleSaveMeasurement,
    handleToggleVisibility,
    measurementActive,
    measurements,
    selectedMeasurementId,
    setRouteMeasurementActive,
    setRouteSelectedMeasurementId,
    visibleMeasurementIds,
  };
}
