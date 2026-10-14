// Byte-size formatters. Two display styles exist in the UI and are kept
// distinct so existing labels do not change.

const BINARY_UNITS = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

// Gallery style: "0 Bytes", "1.5 KB", "2 MB" (up to two decimals, trailing
// zeros trimmed).
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + BINARY_UNITS[i];
}

// Fixed-precision style: "512 B", "1.5 KB", "1.00 MB", "2.50 GB". Non-numeric
// input is treated as 0.
export function formatFileSizeFixed(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}
