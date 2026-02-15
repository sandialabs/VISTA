/**
 * Shared utility functions for the VISTA frontend.
 */

/**
 * Format a byte count into a human-readable file size string.
 * @param {number} bytes - The size in bytes
 * @returns {string} Formatted size string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return 'Unknown size';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format a date string into a localized display string.
 * @param {string} dateString - An ISO date string
 * @returns {string} Formatted date string
 */
export function formatDate(dateString) {
  if (!dateString) return 'Unknown date';
  return new Date(dateString).toLocaleString();
}

/**
 * Parse a metadata value string, returning the JSON-parsed value
 * if valid JSON, or the raw string otherwise.
 * @param {string} value - The value to parse
 * @returns {*} The parsed value
 */
export function parseMetadataValue(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}
