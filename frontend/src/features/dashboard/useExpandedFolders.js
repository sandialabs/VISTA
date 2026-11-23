import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDashboardItems } from '../../api/folders';
import { errorDetail } from './dashboardUtils';

export const CHILD_PAGE_SIZE = 50;
export const EXPAND_ALL_DEPTH = 3;

const emptyEntry = { status: 'idle', folders: [], projects: [], total: 0, error: null };

/**
 * Folders opened in place in the dashboard table.
 *
 * ``expandedIds`` is the remembered set (per access group, via the navigator's
 * view prefs). For each open folder this hook loads its subfolders and the
 * first page of its projects with the same sort and filters as the table, and
 * reloads them whenever ``refreshToken`` changes (after any mutation).
 */
export default function useExpandedFolders({
  accessGroup,
  expandedIds,
  setExpanded,
  baseParams,
  refreshToken,
  enabled,
}) {
  const [entries, setEntries] = useState({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const generation = useRef(0);
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds]);
  const paramsKey = JSON.stringify(baseParams);

  const loadFolder = useCallback(async (folderId, { offset = 0, append = false } = {}) => {
    const gen = generation.current;
    setEntries((prev) => ({
      ...prev,
      [folderId]: {
        ...(prev[folderId] || emptyEntry),
        status: append ? 'loading-more' : (prev[folderId]?.status === 'ready' ? 'refreshing' : 'loading'),
        error: null,
      },
    }));
    try {
      const data = await fetchDashboardItems({
        ...JSON.parse(paramsKey),
        meta_group_id: accessGroup,
        folder_id: folderId,
        offset,
        limit: CHILD_PAGE_SIZE,
      });
      if (gen !== generation.current) return null;
      setEntries((prev) => {
        const before = prev[folderId] || emptyEntry;
        const projects = append
          ? [...before.projects, ...(data?.projects || []).filter((p) => !before.projects.some((x) => x.id === p.id))]
          : data?.projects || [];
        return {
          ...prev,
          [folderId]: {
            status: 'ready',
            folders: append ? before.folders : data?.folders || [],
            projects,
            total: data?.total_projects || 0,
            error: null,
          },
        };
      });
      return data;
    } catch (error) {
      if (gen !== generation.current) return null;
      if (error?.status === 404) {
        // Folder deleted or no longer visible: forget it.
        setExpanded(folderId, false);
      }
      setEntries((prev) => ({
        ...prev,
        [folderId]: { ...(prev[folderId] || emptyEntry), status: 'error', error: errorDetail(error) },
      }));
      return null;
    }
  }, [accessGroup, paramsKey, setExpanded]);

  // (Re)load every open folder when the group, params or refresh token change.
  useEffect(() => {
    generation.current += 1;
    setEntries({});
    if (!enabled || !accessGroup) return;
    expanded.forEach((id) => { loadFolder(id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, accessGroup, paramsKey, refreshToken]);

  // Load newly opened folders.
  useEffect(() => {
    if (!enabled || !accessGroup) return;
    expanded.forEach((id) => {
      if (!entriesRef.current[id]) loadFolder(id);
    });
  }, [expanded, enabled, accessGroup, loadFolder]);

  const toggle = useCallback((folderId) => {
    setExpanded(folderId, !expanded.has(folderId));
  }, [expanded, setExpanded]);

  const showMore = useCallback((folderId) => {
    const entry = entriesRef.current[folderId];
    loadFolder(folderId, { offset: entry?.projects.length || 0, append: true });
  }, [loadFolder]);

  const retry = useCallback((folderId) => loadFolder(folderId), [loadFolder]);

  /** Open folders breadth-first down to ``EXPAND_ALL_DEPTH`` levels. */
  const expandAll = useCallback(async (topFolders) => {
    const opened = new Set(expanded);
    let level = topFolders.map((f) => f.id);
    for (let depth = 1; depth <= EXPAND_ALL_DEPTH && level.length; depth += 1) {
      level.forEach((id) => opened.add(id));
      setExpanded(level, true);
      if (depth === EXPAND_ALL_DEPTH) break;
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(level.map((id) => (
        entriesRef.current[id]?.status === 'ready'
          ? Promise.resolve({ folders: entriesRef.current[id].folders })
          : loadFolder(id)
      )));
      level = results.flatMap((data) => (data?.folders || []).map((f) => f.id)).filter((id) => !opened.has(id));
    }
  }, [expanded, loadFolder, setExpanded]);

  const collapseAll = useCallback(() => setExpanded(null, false), [setExpanded]);

  return { expanded, entries, toggle, showMore, retry, expandAll, collapseAll };
}
