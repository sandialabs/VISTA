import { updateImageMetadataResponse } from '../../api/images';
import { getImageMeasurements } from '../../utils/measurementState';

// Writes the full measurement list for an image and resolves with the
// acknowledged measurements. Rejects with `${failureMessage}: <status>[ - <detail>]`
// on a non-2xx response.
export default async function persistImageMeasurements(imageId, measurements, failureMessage) {
  const response = await updateImageMetadataResponse(
    imageId,
    'measurements',
    measurements,
  );
  if (!response.ok) {
    const detail = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`${failureMessage}: ${response.status || 'unknown'}${detail ? ` - ${detail}` : ''}`);
  }
  // A 2xx response acknowledges the full-state metadata write even if an
  // intermediary returns an empty or malformed body. Do not roll back a
  // server-confirmed write merely because response materialization fails.
  let acknowledgedMeasurements = measurements;
  try {
    const responseImage = await response.json();
    const responseContainsMeasurements = (
      Array.isArray(responseImage?.metadata?.measurements)
      || Array.isArray(responseImage?.metadata_?.measurements)
    );
    if (responseContainsMeasurements) {
      acknowledgedMeasurements = getImageMeasurements(responseImage);
    }
  } catch (_parseError) {
    // The HTTP acknowledgement is authoritative even when the optional
    // response representation is absent or malformed.
  }
  return acknowledgedMeasurements;
}
