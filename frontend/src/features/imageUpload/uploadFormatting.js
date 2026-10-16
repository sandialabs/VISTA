// Shared size/progress formatting helpers for local and S3 image uploads.

const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB ** 2;
const BYTES_PER_GIB = BYTES_PER_KIB ** 3;

export function getUploadItemSizeBytes(item) {
  return Math.max(0, Number(item?.size) || 0);
}

export function getTotalUploadSizeBytes(items = []) {
  return items.reduce((sum, item) => sum + getUploadItemSizeBytes(item), 0);
}

export function formatUploadSize(bytes = 0) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  if (safeBytes >= BYTES_PER_GIB) return `${(safeBytes / BYTES_PER_GIB).toFixed(2)} GB`;
  if (safeBytes >= BYTES_PER_MIB) return `${(safeBytes / BYTES_PER_MIB).toFixed(2)} MB`;
  if (safeBytes >= BYTES_PER_KIB) return `${(safeBytes / BYTES_PER_KIB).toFixed(2)} KB`;
  return `${safeBytes} B`;
}

export function progressPercent(uploadProgress) {
  if (!uploadProgress) return 0;
  const totalBytes = Math.max(0, Number(uploadProgress.totalBytes) || 0);
  if (totalBytes > 0) {
    return Math.min(100, Math.round((Math.max(0, Number(uploadProgress.loadedBytes) || 0) / totalBytes) * 100));
  }
  const total = Math.max(1, Number(uploadProgress.total) || 0);
  return Math.min(100, Math.round((Math.max(0, Number(uploadProgress.completed) || 0) / total) * 100));
}

export function progressLabel(uploadProgress) {
  if (!uploadProgress) return '';
  const totalBytes = Math.max(0, Number(uploadProgress.totalBytes) || 0);
  if (totalBytes > 0) {
    return `${formatUploadSize(uploadProgress.loadedBytes)} / ${formatUploadSize(totalBytes)} uploaded`;
  }
  return `${uploadProgress.completed} / ${uploadProgress.total} uploaded`;
}
