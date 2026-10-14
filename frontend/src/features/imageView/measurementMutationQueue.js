// Per-resource serialized queue for measurement writes. Kept free of React so
// the ordering and bookkeeping can be unit tested directly.
//
// Each resource key (one project image) keeps:
// - confirmedMeasurements: the last acknowledged server representation, used
//   as the base that every queued write is rebased onto when it runs;
// - pendingCount: writes enqueued but not yet settled;
// - revision: bumped when a write is enqueued and again when it settles, so a
//   load that started before a write can detect that it is stale;
// - tail: the promise the next write chains onto.
// Settled entries stay cached for the lifetime of the queue so a GET started
// before a write settled cannot replace that acknowledged base.
export function createMeasurementMutationQueue() {
  const stateByResource = new Map();

  function getRevision(resourceKey) {
    return stateByResource.get(resourceKey)?.revision || 0;
  }

  function getPendingCount(resourceKey) {
    return stateByResource.get(resourceKey)?.pendingCount || 0;
  }

  function getConfirmedMeasurements(resourceKey) {
    return stateByResource.get(resourceKey)?.confirmedMeasurements;
  }

  // Adopt freshly loaded measurements as the confirmed base only when no write
  // is pending and none has been enqueued or settled since the load started.
  function replaceConfirmedIfSettled(resourceKey, revisionAtLoad, measurements) {
    const state = stateByResource.get(resourceKey);
    if (state && state.pendingCount === 0 && state.revision === revisionAtLoad) {
      state.confirmedMeasurements = measurements;
    }
  }

  // Chains a write after every earlier write for the same resource. When it
  // runs, `persist` receives the current confirmed base and must resolve with
  // the acknowledged measurements, which become the new confirmed base before
  // `onConfirmed` is called. A rejected write leaves the confirmed base intact
  // and does not block later writes. `initialConfirmedMeasurements` seeds the
  // confirmed base only when the resource has no queue entry yet.
  function enqueue(resourceKey, { initialConfirmedMeasurements, persist, onConfirmed }) {
    let state = stateByResource.get(resourceKey);
    if (!state) {
      state = {
        confirmedMeasurements: initialConfirmedMeasurements,
        pendingCount: 0,
        revision: 0,
        tail: Promise.resolve(),
      };
      stateByResource.set(resourceKey, state);
    }

    const previousTail = state.tail;
    state.pendingCount += 1;
    state.revision += 1;
    const request = previousTail
      .catch(() => undefined)
      .then(async () => {
        const acknowledgedMeasurements = await persist(state.confirmedMeasurements);
        state.confirmedMeasurements = acknowledgedMeasurements;
        if (onConfirmed) onConfirmed(acknowledgedMeasurements);
        return acknowledgedMeasurements;
      })
      .finally(() => {
        state.pendingCount -= 1;
        state.revision += 1;
      });
    state.tail = request.catch(() => undefined);
    return request;
  }

  return {
    enqueue,
    getConfirmedMeasurements,
    getPendingCount,
    getRevision,
    replaceConfirmedIfSettled,
  };
}
