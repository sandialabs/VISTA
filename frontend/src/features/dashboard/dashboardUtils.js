/** The user-facing part of an API error: the server's `detail` when present. */
export function errorDetail(error, fallback = 'Request failed.') {
  const detail = error?.payload?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    if (first && typeof first.msg === 'string') return first.msg.replace(/^Value error, /, '');
  }
  return error?.message || fallback;
}

const DATE_FORMAT = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  : null;

/** Compact local date/time, or an em dash for missing values. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_FORMAT ? DATE_FORMAT.format(date) : date.toISOString();
}

/** Build a parent -> children map from a flat folder list. */
export function buildFolderChildren(folders) {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map();
  folders.forEach((folder) => {
    const parent = folder.parent_id && ids.has(folder.parent_id) ? folder.parent_id : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(folder);
  });
  children.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
  return children;
}

/** IDs of `folderId` and every folder below it. */
export function folderSubtreeIds(children, folderId) {
  const out = new Set();
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    (children.get(id) || []).forEach((child) => stack.push(child.id));
  }
  return out;
}
