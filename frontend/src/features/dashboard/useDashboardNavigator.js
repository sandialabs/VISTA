import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAccessGroups, fetchDashboardItems, fetchFolderTree } from '../../api/folders';
import { errorDetail } from './dashboardUtils';
import {
  loadLastAccessGroup,
  loadPins,
  loadRecents,
  loadViewPrefs,
  resolveAccessGroup,
  saveLastAccessGroup,
  savePins,
  saveRecents,
  saveViewPrefs,
} from './dashboardPrefs';

export const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Dashboard navigation state.
 *
 * The URL holds the location (`ag`, `folder`) and the query (`q`), so Back /
 * Forward and shared links work. Sort order and expanded tree branches are
 * remembered per browser per access group. The selected access group is
 * remembered per browser (falls back to the first allowed group).
 */
export default function useDashboardNavigator({
  currentUser, userLoaded = true, showArchived, showToast, debugMode = false,
}) {
  const [searchParams, setSearchParamsRaw] = useSearchParams();
  // react-router recreates the setter on unrelated renders; keep a stable one so
  // data loaders that depend on navigation do not refetch (and reset paging).
  const setSearchParamsRef = useRef(setSearchParamsRaw);
  setSearchParamsRef.current = setSearchParamsRaw;
  const setSearchParams = useCallback((...args) => setSearchParamsRef.current(...args), []);
  const email = currentUser?.email || '';
  const [accessGroups, setAccessGroups] = useState(null);
  const [tree, setTree] = useState({ folders: [], root_project_count: 0, total_project_count: 0 });
  const [items, setItems] = useState({ folders: [], projects: [], total_projects: 0, total_folders: 0 });
  const [loadingItems, setLoadingItems] = useState(false);
  // Key of the listing the current `items` belong to; until it matches the
  // requested one, the UI shows a loader instead of a stale or empty listing.
  const [loadedKey, setLoadedKey] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [itemsError, setItemsError] = useState(null);
  const [filters, setFilters] = useState({ projectType: '', createdBy: '', archived: 'any' });
  const [pinnedIds, setPinnedIds] = useState([]);
  const [recentIds, setRecentIds] = useState([]);
  const [pinnedProjects, setPinnedProjects] = useState([]);
  const [recentProjects, setRecentProjects] = useState([]);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const urlGroup = searchParams.get('ag') || '';
  const folderId = searchParams.get('folder') || null;
  const query = searchParams.get('q') || '';
  const [searchText, setSearchText] = useState(query);

  const debugRef = useRef(debugMode);
  debugRef.current = debugMode;
  // Debug mode shows the full diagnostic message and keeps it on screen.
  const reportError = useCallback((label, error) => {
    if (debugRef.current) {
      const detail = errorDetail(error);
      const diagnostics = error?.message && error.message !== detail ? `\nDebug details: ${error.message}` : '';
      toastRef.current?.(`${label}: ${detail}${diagnostics}`, 'error', { persist: true });
    } else {
      toastRef.current?.(`${label}: ${errorDetail(error)}`, 'error');
    }
  }, []);

  // --- Access groups -------------------------------------------------------
  useEffect(() => {
    let current = true;
    fetchAccessGroups()
      .then((groups) => {
        if (current) setAccessGroups(Array.isArray(groups) ? groups.filter((g) => typeof g === 'string') : []);
      })
      .catch((error) => {
        if (!current) return;
        setAccessGroups([]);
        reportError('Failed to load access groups', error);
      });
    return () => {
      current = false;
    };
  }, [reportError]);

  const accessGroup = useMemo(() => {
    // The remembered group is stored per user; wait until the user is known.
    if (!accessGroups || !userLoaded) return null;
    return resolveAccessGroup(accessGroups, urlGroup || loadLastAccessGroup(email));
  }, [accessGroups, urlGroup, email, userLoaded]);

  // Keep the URL and the remembered group in step with the resolved group.
  useEffect(() => {
    if (!accessGroup) return;
    saveLastAccessGroup(email, accessGroup);
    if (urlGroup !== accessGroup) {
      const next = new URLSearchParams(searchParams);
      next.set('ag', accessGroup);
      if (urlGroup) {
        // The URL named a group the user cannot access: drop the location too.
        next.delete('folder');
      }
      setSearchParams(next, { replace: true });
    }
  }, [accessGroup, email, urlGroup, searchParams, setSearchParams]);

  // --- Per-group view prefs ------------------------------------------------
  const [viewPrefs, setViewPrefs] = useState(() => loadViewPrefs(email, accessGroup));
  useEffect(() => {
    setViewPrefs(loadViewPrefs(email, accessGroup));
    setPinnedIds(loadPins(email, accessGroup));
    setRecentIds(loadRecents(email, accessGroup));
  }, [email, accessGroup]);

  const updateViewPrefs = useCallback((patch) => {
    setViewPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveViewPrefs(email, accessGroup, next);
      return next;
    });
  }, [email, accessGroup]);

  const setSort = useCallback((sort) => {
    if (sort === viewPrefs.sort) {
      updateViewPrefs({ order: viewPrefs.order === 'asc' ? 'desc' : 'asc' });
    } else {
      updateViewPrefs({ sort, order: sort === 'name' ? 'asc' : 'desc' });
    }
  }, [updateViewPrefs, viewPrefs.order, viewPrefs.sort]);

  // setExpanded(id | id[] | null, open): null with open=false collapses all.
  const toggleExpanded = useCallback((ids, force) => {
    setViewPrefs((prev) => {
      let set = new Set(prev.expanded);
      if (ids === null) {
        set = force ? set : new Set();
      } else {
        (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
          const open = force ?? !set.has(id);
          if (open) set.add(id); else set.delete(id);
        });
      }
      const next = { ...prev, expanded: Array.from(set) };
      saveViewPrefs(email, accessGroup, next);
      return next;
    });
  }, [email, accessGroup]);

  // --- Navigation ----------------------------------------------------------
  const navigateTo = useCallback(({ group = accessGroup, folder = null, q = '' } = {}) => {
    const next = new URLSearchParams();
    if (group) next.set('ag', group);
    if (folder) next.set('folder', folder);
    if (q) next.set('q', q);
    setSearchParams(next);
    setSearchText(q);
  }, [accessGroup, setSearchParams]);

  const selectAccessGroup = useCallback((group) => {
    saveLastAccessGroup(email, group);
    navigateTo({ group, folder: null, q: '' });
  }, [email, navigateTo]);

  const openFolder = useCallback((id) => {
    navigateTo({ folder: id, q: '' });
  }, [navigateTo]);

  // Debounced search text -> URL `q` (replace, so typing is one history entry).
  // Sync from the URL only when it really differs (keeps a trailing space the
  // user is still typing, which the URL stores trimmed).
  useEffect(() => {
    setSearchText((current) => (current.trim() === query ? current : query));
  }, [query]);
  useEffect(() => {
    if (searchText.trim() === query) return undefined;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchText.trim()) next.set('q', searchText.trim()); else next.delete('q');
      setSearchParams(next, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, query, searchParams, setSearchParams]);

  // --- Data ----------------------------------------------------------------
  const loadTree = useCallback(() => {
    if (!accessGroup) return Promise.resolve();
    return fetchFolderTree(accessGroup, { includeArchived: showArchived })
      .then((data) => {
        setTree({
          folders: Array.isArray(data?.folders) ? data.folders : [],
          root_project_count: data?.root_project_count || 0,
          total_project_count: data?.total_project_count || 0,
        });
      })
      .catch((error) => {
        reportError('Failed to load folders', error);
      });
  }, [accessGroup, showArchived, reportError]);

  const itemParams = useMemo(() => ({
    meta_group_id: accessGroup,
    folder_id: folderId || undefined,
    q: query || undefined,
    include_archived: showArchived,
    project_type: filters.projectType || undefined,
    created_by: filters.createdBy || undefined,
    archived: showArchived ? filters.archived : undefined,
    sort: viewPrefs.sort,
    order: viewPrefs.order,
    limit: PAGE_SIZE,
  }), [accessGroup, folderId, query, showArchived, filters, viewPrefs.sort, viewPrefs.order]);

  const requestRef = useRef(0);
  const loadItems = useCallback(({ strict = false, quiet = false } = {}) => {
    if (!accessGroup) return Promise.resolve();
    const token = requestRef.current + 1;
    requestRef.current = token;
    setLoadingItems(true);
    setItemsError(null);
    const key = JSON.stringify(itemParams);
    return fetchDashboardItems({ ...itemParams, offset: 0 })
      .then((data) => {
        if (token !== requestRef.current) return;
        setLoadedKey(key);
        setItems({
          folders: data?.folders || [],
          projects: data?.projects || [],
          total_projects: data?.total_projects || 0,
          total_folders: data?.total_folders || 0,
          current_folder: data?.current_folder || null,
        });
      })
      .catch((error) => {
        if (token !== requestRef.current) return;
        setLoadedKey(key);
        setItemsError(error.message);
        if (error.status === 404 && folderId) {
          // The folder disappeared (deleted, or archived and hidden).
          toastRef.current?.('That folder is no longer available.', 'warning');
          navigateTo({ folder: null });
          return;
        }
        if (!quiet) reportError('Failed to fetch projects', error);
        if (strict) throw error;
      })
      .finally(() => {
        if (token === requestRef.current) setLoadingItems(false);
      });
  }, [accessGroup, itemParams, folderId, navigateTo, reportError]);

  const loadMore = useCallback(() => {
    if (!accessGroup || loadingMore) return;
    setLoadingMore(true);
    const token = requestRef.current;
    fetchDashboardItems({ ...itemParams, offset: items.projects.length })
      .then((data) => {
        if (token !== requestRef.current) return;
        setItems((prev) => {
          const seen = new Set(prev.projects.map((p) => p.id));
          return {
            ...prev,
            projects: [...prev.projects, ...(data?.projects || []).filter((p) => !seen.has(p.id))],
            total_projects: data?.total_projects ?? prev.total_projects,
          };
        });
      })
      .catch((error) => reportError('Failed to load more projects', error))
      .finally(() => setLoadingMore(false));
  }, [accessGroup, itemParams, items.projects.length, loadingMore, reportError]);

  const loadPinnedAndRecent = useCallback(() => {
    if (!accessGroup) return Promise.resolve();
    const ids = Array.from(new Set([...pinnedIds, ...recentIds]));
    if (ids.length === 0) {
      setPinnedProjects([]);
      setRecentProjects([]);
      return Promise.resolve();
    }
    return fetchDashboardItems({
      meta_group_id: accessGroup,
      ids,
      include_archived: true,
      limit: Math.max(ids.length, 1),
    })
      .then((data) => {
        const byId = new Map((data?.projects || []).map((p) => [String(p.id), p]));
        // Drop pins/recents that no longer exist or are no longer accessible.
        const livePins = pinnedIds.filter((id) => byId.has(id));
        const liveRecents = recentIds.filter((id) => byId.has(id));
        if (livePins.length !== pinnedIds.length) {
          setPinnedIds(livePins);
          savePins(email, accessGroup, livePins);
        }
        if (liveRecents.length !== recentIds.length) {
          setRecentIds(liveRecents);
          saveRecents(email, accessGroup, liveRecents);
        }
        setPinnedProjects(livePins.map((id) => byId.get(id)));
        setRecentProjects(
          liveRecents
            .map((id) => byId.get(id))
            .filter((p) => showArchived || !p.effective_archived),
        );
      })
      .catch(() => {
        // Pins/recents are a convenience; the main listing reports errors.
      });
  }, [accessGroup, pinnedIds, recentIds, email, showArchived]);

  const togglePin = useCallback((projectId) => {
    const id = String(projectId);
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      savePins(email, accessGroup, next);
      return next;
    });
  }, [email, accessGroup]);

  // Bumped on every refresh so open folders in the table reload too.
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
    return Promise.all([loadTree(), loadItems(), loadPinnedAndRecent()]);
  }, [loadTree, loadItems, loadPinnedAndRecent]);
  // Full reload (after a database switch or import); rejects if projects fail
  // to load so callers can tell the user.
  const reloadAll = useCallback(async () => {
    const groups = await fetchAccessGroups();
    setAccessGroups(Array.isArray(groups) ? groups.filter((g) => typeof g === 'string') : []);
    // The caller reports a failure itself, so stay quiet here.
    setRefreshToken((n) => n + 1);
    await Promise.all([loadTree(), loadItems({ strict: true, quiet: true }), loadPinnedAndRecent()]);
  }, [loadTree, loadItems, loadPinnedAndRecent]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);
  useEffect(() => {
    loadItems();
  }, [loadItems]);
  useEffect(() => {
    loadPinnedAndRecent();
  }, [loadPinnedAndRecent]);

  const foldersById = useMemo(() => new Map(tree.folders.map((f) => [f.id, f])), [tree.folders]);
  // Prefer the listing's own view of the folder: it is present (with lock
  // state) even when the folder is archived and hidden from the tree.
  const listedFolder = items.current_folder && items.current_folder.id === folderId
    ? items.current_folder
    : null;
  const currentFolder = folderId ? listedFolder || foldersById.get(folderId) || null : null;

  return {
    accessGroups,
    accessGroup,
    selectAccessGroup,
    folderId,
    currentFolder,
    foldersById,
    openFolder,
    navigateTo,
    query,
    searchText,
    setSearchText,
    tree,
    items,
    loadingItems,
    itemsReady: loadedKey === JSON.stringify(itemParams),
    loadingMore,
    itemsError,
    loadMore,
    hasMore: items.projects.length < items.total_projects,
    filters,
    setFilters,
    viewPrefs,
    setSort,
    toggleExpanded,
    pinnedIds,
    pinnedProjects,
    recentProjects,
    togglePin,
    refresh,
    refreshToken,
    reloadAll,
    // Sort/filter params for loading an open folder's contents.
    childParams: {
      include_archived: showArchived,
      project_type: filters.projectType || undefined,
      created_by: filters.createdBy || undefined,
      archived: showArchived ? filters.archived : undefined,
      sort: viewPrefs.sort,
      order: viewPrefs.order,
    },
  };
}
