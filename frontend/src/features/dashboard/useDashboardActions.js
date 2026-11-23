import { useCallback, useState } from 'react';
import {
  archiveFolder,
  bulkArchive,
  bulkMove,
  createFolder,
  deleteFolder,
  moveFolder,
  moveProject,
  unarchiveFolder,
  updateFolder,
} from '../../api/folders';
import {
  archiveProject,
  createProject,
  deleteProject,
  unarchiveProject,
  updateProject,
} from '../../api/projects';
import { errorDetail } from './dashboardUtils';

/**
 * Every dashboard mutation. Each one refreshes the listing afterwards and
 * reports through ``showToast``; modal submit handlers return ``{error}`` so
 * dialogs can show the failure inline and stay open.
 */
export default function useDashboardActions({ accessGroup, currentFolder, refresh, showToast, currentUser }) {
  const [dialog, setDialog] = useState(null); // {kind, ...}
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null); // {message, moves:[{type,id,from}]}

  const close = useCallback(() => setDialog(null), []);

  const run = useCallback(async (fn, { success, closeOnSuccess = true } = {}) => {
    setBusy(true);
    try {
      const result = await fn();
      if (closeOnSuccess) setDialog(null);
      if (success) showToast(typeof success === 'function' ? success(result) : success, 'success');
      await refresh();
      return result;
    } catch (error) {
      const message = errorDetail(error);
      return { error: message };
    } finally {
      setBusy(false);
    }
  }, [refresh, showToast]);

  // Fire-and-report actions (no dialog).
  const runDirect = useCallback(async (fn, success) => {
    const result = await run(fn, { success, closeOnSuccess: false });
    if (result && result.error) showToast(result.error, 'error');
    return result;
  }, [run, showToast]);

  // --- Folders
  const openNewFolder = useCallback(() => setDialog({ kind: 'new-folder' }), []);
  const submitNewFolder = useCallback((values) => run(
    () => createFolder({ ...values, meta_group_id: accessGroup, parent_id: currentFolder?.id || null }),
    { success: (f) => `Folder "${f.name}" created.` },
  ), [run, accessGroup, currentFolder]);

  const openEditFolder = useCallback((folder) => setDialog({ kind: 'edit-folder', folder }), []);
  const submitEditFolder = useCallback((folder, values) => run(
    () => updateFolder(folder.id, values),
    { success: (f) => `Folder "${f.name}" saved.` },
  ), [run]);

  const setFolderArchived = useCallback((folder, archived) => {
    const verb = archived ? 'Archive' : 'Unarchive';
    const message = archived
      ? `Archive "${folder.name}"? Everything inside becomes read-only and hidden by default.`
      : `Unarchive "${folder.name}"? Items archived on their own stay archived.`;
    if (!window.confirm(message)) return Promise.resolve();
    return runDirect(
      () => (archived ? archiveFolder(folder.id) : unarchiveFolder(folder.id)),
      `${verb}d "${folder.name}".`,
    );
  }, [runDirect]);

  const openDeleteFolder = useCallback((folder) => setDialog({ kind: 'delete-folder', folder }), []);
  const submitDeleteFolder = useCallback((folder, phrase) => run(
    () => deleteFolder(folder.id, phrase),
    { success: (r) => `Deleted "${folder.name}" (${r.folders_deleted} folders, ${r.projects_deleted} projects).` },
  ), [run]);

  // --- Projects
  const openNewProject = useCallback(() => setDialog({ kind: 'new-project' }), []);
  const submitNewProject = useCallback(async (payload) => {
    const result = await run(() => createProject(payload), { success: (p) => `Project "${p.name}" created successfully!` });
    if (result && result.error) showToast(result.error, 'error');
  }, [run, showToast]);

  const openEditProject = useCallback((project) => setDialog({ kind: 'edit-project', project }), []);
  const submitEditProject = useCallback(async (project, values) => {
    const result = await run(() => updateProject(project.id, values), {
      success: (p) => `Project "${p.name}" updated successfully!`,
    });
    if (result && result.error) showToast(result.error, 'error');
  }, [run, showToast]);

  const setProjectArchived = useCallback((project, archived) => {
    const message = archived
      ? `Archive "${project.name}"? The project will become read-only and hidden by default.`
      : `Unarchive "${project.name}"? This will restore full editing access.`;
    if (!window.confirm(message)) return Promise.resolve();
    return runDirect(
      () => (archived ? archiveProject(project.id) : unarchiveProject(project.id)),
      `${archived ? 'Archived' : 'Unarchived'} "${project.name}".`,
    );
  }, [runDirect]);

  const openDeleteProject = useCallback((project) => setDialog({ kind: 'delete-project', project }), []);
  const submitDeleteProject = useCallback(async (project) => {
    const result = await run(() => deleteProject(project.id, `DELETE ${project.name}`), {
      success: `Project "${project.name}" deleted successfully.`,
    });
    if (result && result.error) showToast(result.error, 'error');
  }, [run, showToast]);

  // --- Moves (single + bulk) with undo
  const openMove = useCallback((items) => setDialog({ kind: 'move', items }), []);
  const submitMove = useCallback(async (items, targetId) => {
    const refs = items.map((i) => ({ type: i.type, id: i.id }));
    const result = await run(async () => {
      if (refs.length === 1) {
        const [only] = items;
        if (only.type === 'folder') await moveFolder(only.id, targetId);
        else await moveProject(only.id, targetId);
        return {
          ok: true,
          results: [{ ...refs[0], ok: true, previous_folder_id: (only.type === 'folder' ? only.parent_id : only.folder_id) || null }],
        };
      }
      const body = await bulkMove(refs, targetId);
      if (!body.ok) {
        const failed = body.results.find((r) => !r.ok && !/another item/.test(r.detail || ''));
        const name = items.find((i) => i.id === failed?.id)?.name;
        const err = new Error(`${name ? `"${name}": ` : ''}${failed?.detail || 'Move failed.'} Nothing was moved.`);
        throw err;
      }
      return body;
    }, { closeOnSuccess: true });
    if (result && result.error) return result;
    const moves = (result?.results || []).filter((r) => r.ok).map((r) => ({ type: r.type, id: r.id, from: r.previous_folder_id || null }));
    setUndo({ message: `Moved ${moves.length} item${moves.length === 1 ? '' : 's'}.`, moves });
    return result;
  }, [run]);

  const undoMove = useCallback(async () => {
    const pending = undo;
    setUndo(null);
    if (!pending) return;
    // Items that came from the same place go back in one atomic request.
    const byOrigin = new Map();
    pending.moves.forEach((move) => {
      const key = move.from || '';
      if (!byOrigin.has(key)) byOrigin.set(key, []);
      byOrigin.get(key).push({ type: move.type, id: move.id });
    });
    let restored = 0;
    const failures = [];
    for (const [origin, items] of byOrigin) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const body = await bulkMove(items, origin || null);
        if (body?.ok) restored += items.length;
        else failures.push(body?.results?.find((r) => !r.ok && !/another item/.test(r.detail || ''))?.detail || 'Move failed.');
      } catch (error) {
        failures.push(errorDetail(error));
      }
    }
    if (failures.length === 0) {
      showToast('Move undone.', 'info');
    } else {
      showToast(
        `Undo restored ${restored} of ${pending.moves.length} item(s). ${failures[0]}`,
        'error',
      );
    }
    await refresh();
  }, [undo, refresh, showToast]);

  const dismissUndo = useCallback(() => setUndo(null), []);

  const bulkSetArchived = useCallback(async (items, archived) => {
    if (!items.length) return null;
    const noun = `${items.length} item${items.length === 1 ? '' : 's'}`;
    if (!window.confirm(`${archived ? 'Archive' : 'Unarchive'} ${noun}?`)) return null;
    return runDirect(async () => {
      const body = await bulkArchive(items.map((i) => ({ type: i.type, id: i.id })), archived);
      if (!body.ok) {
        const failed = body.results.find((r) => !r.ok && !/another item/.test(r.detail || ''));
        const name = items.find((i) => i.id === failed?.id)?.name;
        throw new Error(`${name ? `"${name}": ` : ''}${failed?.detail || 'Failed.'} Nothing was changed.`);
      }
      return body;
    }, `${archived ? 'Archived' : 'Unarchived'} ${noun}.`);
  }, [runDirect]);

  const canArchiveProject = useCallback(
    (project) => Boolean(currentUser) && (!project.created_by || project.created_by === currentUser.email),
    [currentUser],
  );

  return {
    dialog,
    busy,
    close,
    undo,
    dismissUndo,
    undoMove,
    openNewFolder,
    submitNewFolder,
    openEditFolder,
    submitEditFolder,
    setFolderArchived,
    openDeleteFolder,
    submitDeleteFolder,
    openNewProject,
    submitNewProject,
    openEditProject,
    submitEditProject,
    setProjectArchived,
    openDeleteProject,
    submitDeleteProject,
    openMove,
    submitMove,
    bulkSetArchived,
    canArchiveProject,
  };
}
