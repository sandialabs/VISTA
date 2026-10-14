// Duplicate-filename tagging for queued uploads, so two files with the same
// name do not collide when sent to the server.
import { appendFilenameOrdinal, assignDuplicateFilenameAliases } from '../../utils/imageIdentity';

export function tagDuplicateFilename(filename = '', occurrence = 0) {
  const safeFilename = String(filename ?? '') || 'upload.bin';
  if (occurrence <= 0) return safeFilename;
  return appendFilenameOrdinal(safeFilename, occurrence);
}

export function buildDuplicateFilenameMap(files = []) {
  const mapped = new Map();
  const entries = files.map((file, index) => ({
    file,
    filename: file?.name || `upload-${index}.bin`,
  }));
  const decorated = assignDuplicateFilenameAliases(entries);
  entries.forEach((entry, index) => {
    mapped.set(entry.file, decorated[index].displayName);
  });
  return mapped;
}
