export const isAbortError = (error) => error?.name === 'AbortError';

export function mergeImagesByIdentity(currentImages, confirmedImages) {
  const next = Array.isArray(currentImages) ? [...currentImages] : [];
  const indexesById = new Map();
  next.forEach((image, index) => {
    if (image?.id !== undefined && image?.id !== null) {
      indexesById.set(String(image.id), index);
    }
  });
  (Array.isArray(confirmedImages) ? confirmedImages : []).forEach((image) => {
    if (!image || typeof image !== 'object') return;
    const id = image.id !== undefined && image.id !== null ? String(image.id) : '';
    if (id && indexesById.has(id)) {
      const index = indexesById.get(id);
      next[index] = { ...next[index], ...image };
      return;
    }
    if (id) indexesById.set(id, next.length);
    next.push(image);
  });
  return next;
}

export function resolveProjectCollectionReadiness(partsState, imagesState) {
  const projectPartsReady = partsState.loaded && !partsState.loading && !partsState.stale;
  const projectImagesReady = imagesState.loaded && !imagesState.loading && !imagesState.stale;
  return {
    projectPartsReady,
    // Keep an already-loaded tab mounted if a later reconciliation fails so it
    // can explain that deletion succeeded but the authoritative refresh did not.
    projectPartsAvailable: partsState.loaded,
    projectImagesReady,
    completeProjectCollectionsReady: projectPartsReady && projectImagesReady,
    completeProjectCollectionsAvailable: partsState.loaded
      && !partsState.error
      && imagesState.loaded
      && !imagesState.error,
    completeProjectCollectionsError: partsState.error || imagesState.error,
  };
}

// Runs a route-owned read. `owner` is either a captured route owner or a
// request from useRouteRequestOwnership; a request's signal is forwarded so
// navigation aborts it. Returns 'stale' when the route no longer owns the read.
export async function refreshOwnedResource({ owner, isCurrent, load, apply }) {
  const signal = owner?.controller?.signal;
  if (!isCurrent(owner)) return 'stale';
  try {
    const payload = await load(signal ? { signal } : undefined);
    if (!isCurrent(owner)) return 'stale';
    apply(payload);
    return 'fresh';
  } catch (err) {
    if (isAbortError(err) || !isCurrent(owner)) return 'stale';
    throw err;
  }
}
