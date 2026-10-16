import { getMeasurementIds } from '../../utils/measurementState';

// Pure helpers for shaping measurement mutation payloads. Kept free of React
// and network concerns so they can be unit tested directly.

export function getMeasurementMutationKey(projectId, imageId) {
  return JSON.stringify([
    String(projectId ?? ''),
    String(imageId ?? ''),
  ]);
}

// Visible IDs after an upsert: keep previously visible IDs that still exist,
// plus the saved measurement's ID, deduplicated. A null `originalVisibleIds`
// means "everything is visible", so the result mirrors the full ID list.
export function buildUpsertedVisibleMeasurementIds({
  originalVisibleIds,
  updatedMeasurements,
  measurementId,
}) {
  const updatedIds = getMeasurementIds(updatedMeasurements);
  const nextVisibleIds = originalVisibleIds === null
    ? updatedIds
    : [...new Set([
      ...originalVisibleIds.filter((id) => updatedIds.includes(id)),
      measurementId,
    ].filter((id) => id !== null && id !== undefined))];
  return nextVisibleIds.length > 0 ? nextVisibleIds : null;
}

// Visible IDs after a delete: drop any ID no longer present in the updated
// measurement list.
export function buildFilteredVisibleMeasurementIds({
  originalVisibleIds,
  updatedMeasurements,
}) {
  const updatedIds = getMeasurementIds(updatedMeasurements);
  const nextVisibleIds = originalVisibleIds === null
    ? updatedIds
    : originalVisibleIds.filter((id) => updatedIds.includes(id));
  return updatedMeasurements.length > 0 ? nextVisibleIds : null;
}
