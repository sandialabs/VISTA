/**
 * Browser-local dashboard preferences.
 *
 * Everything here is per browser (localStorage), keyed by user email so two
 * people sharing a machine do not overwrite each other. All reads tolerate
 * missing, corrupt, or blocked storage.
 */

const PREFIX = 'vista.dashboard';
export const MAX_RECENTS = 12;
export const MAX_PINS = 50;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

function userKey(email) {
  return String(email || 'anonymous').trim().toLowerCase() || 'anonymous';
}

function readJson(key, fallback) {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Storage full or blocked: preferences are best-effort.
  }
}

export function lastAccessGroupKey(email) {
  return `${PREFIX}.lastAccessGroup.${userKey(email)}`;
}

export function loadLastAccessGroup(email) {
  const value = readJson(lastAccessGroupKey(email), null);
  return typeof value === 'string' && value ? value : null;
}

export function saveLastAccessGroup(email, group) {
  if (typeof group === 'string' && group) writeJson(lastAccessGroupKey(email), group);
}

/** Pick the remembered group if still allowed, otherwise the first allowed. */
export function resolveAccessGroup(groups, preferred) {
  const list = Array.isArray(groups) ? groups.filter((g) => typeof g === 'string' && g) : [];
  if (preferred && list.includes(preferred)) return preferred;
  return list[0] || null;
}

const SORT_FIELDS = ['created', 'last_activity', 'archived', 'name'];
const DEFAULT_VIEW = { sort: 'last_activity', order: 'desc', expanded: [] };

export function viewPrefsKey(email, group) {
  return `${PREFIX}.view.${userKey(email)}.${group || '_'}`;
}

export function loadViewPrefs(email, group) {
  const value = readJson(viewPrefsKey(email, group), {});
  const sort = SORT_FIELDS.includes(value?.sort) ? value.sort : DEFAULT_VIEW.sort;
  const order = value?.order === 'asc' ? 'asc' : 'desc';
  const expanded = Array.isArray(value?.expanded)
    ? value.expanded.filter((id) => typeof id === 'string').slice(0, 500)
    : [];
  return { sort, order, expanded };
}

export function saveViewPrefs(email, group, prefs) {
  writeJson(viewPrefsKey(email, group), {
    sort: prefs.sort,
    order: prefs.order,
    expanded: Array.from(new Set(prefs.expanded || [])).slice(0, 500),
  });
}

function listKey(kind, email, group) {
  return `${PREFIX}.${kind}.${userKey(email)}.${group || '_'}`;
}

function loadIdList(kind, email, group, max) {
  const value = readJson(listKey(kind, email, group), []);
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((id) => typeof id === 'string' && id))).slice(0, max)
    : [];
}

export function loadPins(email, group) {
  return loadIdList('pins', email, group, MAX_PINS);
}

export function savePins(email, group, ids) {
  writeJson(listKey('pins', email, group), Array.from(new Set(ids)).slice(0, MAX_PINS));
}

export function loadRecents(email, group) {
  return loadIdList('recents', email, group, MAX_RECENTS);
}

export function saveRecents(email, group, ids) {
  writeJson(listKey('recents', email, group), Array.from(new Set(ids)).slice(0, MAX_RECENTS));
}

/** Record that a project was opened (most recent first). */
export function recordRecentProject(email, group, projectId) {
  if (!group || !projectId) return;
  const next = [String(projectId), ...loadRecents(email, group).filter((id) => id !== String(projectId))];
  saveRecents(email, group, next);
}
