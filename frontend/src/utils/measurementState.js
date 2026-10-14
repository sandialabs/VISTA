export function getImageMeasurements(imageData) {
  const metadataMeasurements = imageData?.metadata?.measurements;
  if (Array.isArray(metadataMeasurements)) return metadataMeasurements;

  const legacyMetadataMeasurements = imageData?.metadata_?.measurements;
  if (Array.isArray(legacyMetadataMeasurements)) return legacyMetadataMeasurements;

  return [];
}

export function getMeasurementIds(imageMeasurements) {
  return imageMeasurements
    .map((measurement) => measurement?.id)
    .filter((measurementId) => measurementId !== null && measurementId !== undefined);
}

function measurementIdsMatch(firstId, secondId) {
  if (firstId === null || firstId === undefined || secondId === null || secondId === undefined) {
    return firstId === secondId;
  }
  return String(firstId) === String(secondId);
}

export function upsertMeasurementById(imageMeasurements, nextMeasurement) {
  const nextMeasurementId = nextMeasurement?.id;
  if (nextMeasurementId === null || nextMeasurementId === undefined) {
    return [...imageMeasurements, nextMeasurement];
  }

  let found = false;
  const deduplicated = [];
  imageMeasurements.forEach((measurement) => {
    if (!measurementIdsMatch(measurement?.id, nextMeasurementId)) {
      deduplicated.push(measurement);
      return;
    }
    if (!found) {
      deduplicated.push({ ...measurement, ...nextMeasurement });
      found = true;
    }
  });
  if (!found) deduplicated.push(nextMeasurement);
  return deduplicated;
}

export function mergeImageMeasurements(imageData, imageMeasurements) {
  if (!imageData) return imageData;
  return {
    ...imageData,
    metadata: {
      ...(imageData.metadata || {}),
      measurements: imageMeasurements,
    },
  };
}

export function reconcileVisibleMeasurementIds(
  confirmedMeasurements,
  preferredVisibleMeasurementIds,
) {
  const confirmedIds = getMeasurementIds(confirmedMeasurements);
  if (confirmedIds.length === 0) return null;
  if (preferredVisibleMeasurementIds === null) return confirmedIds;

  const confirmedIdKeys = new Set(confirmedIds.map((measurementId) => String(measurementId)));
  return preferredVisibleMeasurementIds.filter(
    (measurementId) => confirmedIdKeys.has(String(measurementId)),
  );
}
