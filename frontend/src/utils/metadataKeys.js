// Metadata keys used internally by the application that should not be
// shown to users in dropdowns, filters, or export columns.
const INTERNAL_METADATA_KEYS = new Set([
  'measurements',
  'calibration_override',
]);

export function isUserMetadataKey(key) {
  return !INTERNAL_METADATA_KEYS.has(key);
}
