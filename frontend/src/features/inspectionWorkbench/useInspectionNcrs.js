import { useCallback, useEffect, useRef, useState } from 'react';
import {
  approvePartNcr,
  createPartNcr,
  deletePartNcr,
  fetchPartNcr,
  fetchPartNcrs,
  updatePartNcr,
} from '../../api/ncrs';

export const NCR_TEXT_MAX_LENGTH = 10000;

export const EMPTY_NCR_DRAFT = Object.freeze({
  comment: '',
  failure_code: '',
  disposition_code: '',
  disposition_instructions: '',
});

const NCR_FIELD_LABELS = {
  comment: 'Comment',
  failure_code: 'Failure code',
  disposition_code: 'Disposition code',
  disposition_instructions: 'Disposition instructions',
};

export function validateNcrDraft(draft) {
  return Object.entries(NCR_FIELD_LABELS)
    .filter(([field]) => !String(draft?.[field] || '').trim())
    .map(([, label]) => `${label} is required.`);
}

export function getNcrErrorMessage(error, fallback) {
  const detail = error?.payload?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail
      .map((entry) => (typeof entry === 'string' ? entry : entry?.msg))
      .filter((entry) => typeof entry === 'string' && entry);
    if (messages.length > 0) return messages.join(' ');
  }
  return error?.message || fallback;
}

function draftFromNcr(ncr) {
  return {
    comment: ncr.comment || '',
    failure_code: ncr.failure_code || '',
    disposition_code: ncr.disposition_code || '',
    disposition_instructions: ncr.disposition_instructions || '',
  };
}

function trimDraft(draft) {
  return Object.keys(EMPTY_NCR_DRAFT).reduce((acc, field) => {
    acc[field] = String(draft[field] || '').trim();
    return acc;
  }, {});
}

export function isDeletedNcr(ncr) {
  return Boolean(ncr?.deleted_at);
}

/**
 * Loads and mutates the selected part's nonconformance reports (NCRs).
 *
 * Responses for a part that is no longer selected are discarded, so switching
 * parts mid-request never shows another part's NCRs.
 */
export default function useInspectionNcrs({ projectId, selectedPartId, readOnly }) {
  // "View deleted" belongs to the session, not to a part: it stays on while
  // the user moves between parts and only the user can turn it off.
  const [showDeleted, setShowDeleted] = useState(false);
  const [ncrs, setNcrs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const activePartRef = useRef(selectedPartId);
  activePartRef.current = selectedPartId;
  // State updates are async, so a ref guards against two submissions in the
  // same tick (double click, Enter plus click).
  const busyRef = useRef(false);
  // Only the most recently requested list/detail may populate state.
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const isCurrentPart = useCallback((partId) => activePartRef.current === partId, []);

  const reload = useCallback(async () => {
    const partId = selectedPartId;
    listRequestRef.current += 1;
    const requestId = listRequestRef.current;
    const isCurrentRequest = () => isCurrentPart(partId) && listRequestRef.current === requestId;
    if (!projectId || !partId) {
      setNcrs([]);
      setLoadError('');
      setLoading(false);
      return [];
    }
    setLoading(true);
    setLoadError('');
    try {
      const payload = await fetchPartNcrs(projectId, partId, { includeDeleted: showDeleted });
      const loaded = Array.isArray(payload?.ncrs) ? payload.ncrs : [];
      if (isCurrentRequest()) {
        setNcrs(loaded);
        // Rebase an open edit on the latest version so a retry after a
        // conflict is not rejected forever; the user's draft is kept.
        setEditor((previous) => {
          if (!previous || previous.mode !== 'edit') return previous;
          const latest = loaded.find((ncr) => ncr.id === previous.ncr.id);
          return latest ? { ...previous, ncr: latest } : null;
        });
        setDetail((previous) => {
          if (!previous) return previous;
          return loaded.some((ncr) => ncr.id === previous.ncr.id) ? previous : null;
        });
      }
      return loaded;
    } catch (error) {
      if (isCurrentRequest()) {
        setNcrs([]);
        setLoadError(getNcrErrorMessage(error, 'Failed to load NCRs'));
      }
      return [];
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [isCurrentPart, projectId, selectedPartId, showDeleted]);

  // Switching part (or project) resets the per-part panels.
  useEffect(() => {
    setEditor(null);
    setDetail(null);
    setActionError('');
  }, [projectId, selectedPartId]);

  // Reload on part changes and when "View deleted" is toggled. reload() also
  // closes a detail panel whose NCR is no longer listed (deleted, hidden).
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    // A project becoming read-only (archived) discards any open edit.
    if (readOnly) setEditor(null);
  }, [readOnly]);

  const upsertNcr = useCallback((saved) => {
    setNcrs((previous) => {
      const exists = previous.some((ncr) => ncr.id === saved.id);
      const next = exists
        ? previous.map((ncr) => (ncr.id === saved.id ? saved : ncr))
        : [...previous, saved];
      return next.sort((left, right) => left.ncr_number - right.ncr_number);
    });
  }, []);

  const openCreate = useCallback(() => {
    if (readOnly || !selectedPartId) return;
    setActionError('');
    setEditor({ mode: 'create', ncr: null, draft: { ...EMPTY_NCR_DRAFT } });
  }, [readOnly, selectedPartId]);

  const openEdit = useCallback((ncr) => {
    if (readOnly || !ncr || isDeletedNcr(ncr)) return;
    setActionError('');
    setEditor({ mode: 'edit', ncr, draft: draftFromNcr(ncr) });
  }, [readOnly]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setActionError('');
  }, []);

  const setDraft = useCallback((updater) => {
    setEditor((previous) => {
      if (!previous) return previous;
      const draft = typeof updater === 'function' ? updater(previous.draft) : updater;
      return { ...previous, draft };
    });
    // A stale "is required" / server error should not linger while the
    // user is correcting the form; it is re-checked on the next Save.
    setActionError('');
  }, []);

  const openDetail = useCallback(async (ncr) => {
    const partId = selectedPartId;
    if (!ncr || !partId) return;
    detailRequestRef.current += 1;
    const requestId = detailRequestRef.current;
    const isCurrentRequest = () => isCurrentPart(partId) && detailRequestRef.current === requestId;
    setActionError('');
    setDetail({ ncr, history: null, loading: true });
    try {
      // Deleted NCRs are only listed while "View deleted" is on; ask for them
      // explicitly so their read-only history loads.
      const payload = await fetchPartNcr(projectId, partId, ncr.id, { includeDeleted: isDeletedNcr(ncr) });
      if (isCurrentRequest()) {
        setDetail({ ncr: payload, history: Array.isArray(payload?.history) ? payload.history : [], loading: false });
        upsertNcr(payload);
      }
    } catch (error) {
      if (isCurrentRequest()) {
        setDetail({ ncr, history: [], loading: false, error: getNcrErrorMessage(error, 'Failed to load NCR history') });
      }
    }
  }, [isCurrentPart, projectId, selectedPartId, upsertNcr]);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setDetail(null);
  }, []);

  const runAction = useCallback(async (action, fallbackMessage) => {
    const partId = selectedPartId;
    if (readOnly || !partId || busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    try {
      const saved = await action(partId);
      if (!isCurrentPart(partId)) return null;
      return saved;
    } catch (error) {
      if (isCurrentPart(partId)) {
        setActionError(getNcrErrorMessage(error, fallbackMessage));
        if (error?.status === 409 || error?.status === 404) {
          reload();
        }
      }
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [isCurrentPart, readOnly, reload, selectedPartId]);

  const saveEditor = useCallback(async () => {
    if (!editor || readOnly || busyRef.current) return false;
    const errors = validateNcrDraft(editor.draft);
    if (errors.length > 0) {
      setActionError(errors.join(' '));
      return false;
    }
    const draft = trimDraft(editor.draft);
    const saved = await runAction((partId) => (
      editor.mode === 'create'
        ? createPartNcr(projectId, partId, draft, { readOnly })
        : updatePartNcr(projectId, partId, editor.ncr.id, {
          ...draft,
          expected_version: editor.ncr.version,
        }, { readOnly })
    ), editor.mode === 'create' ? 'Failed to create NCR' : 'Failed to save NCR');
    if (!saved) return false;
    upsertNcr(saved);
    setEditor(null);
    setDetail((previous) => (previous && previous.ncr.id === saved.id
      ? { ncr: saved, history: saved.history || [], loading: false }
      : previous));
    return true;
  }, [editor, projectId, readOnly, runAction, upsertNcr]);

  const approve = useCallback(async (ncr) => {
    if (isDeletedNcr(ncr)) return false;
    const saved = await runAction(
      (partId) => approvePartNcr(projectId, partId, ncr.id, ncr.version, { readOnly }),
      'Failed to approve NCR',
    );
    if (!saved) return false;
    upsertNcr(saved);
    setDetail((previous) => (previous && previous.ncr.id === saved.id
      ? { ncr: saved, history: saved.history || [], loading: false }
      : previous));
    return true;
  }, [projectId, readOnly, runAction, upsertNcr]);

  const remove = useCallback(async (ncr) => {
    if (isDeletedNcr(ncr)) return false;
    const result = await runAction(
      (partId) => deletePartNcr(projectId, partId, ncr.id, ncr.version, { readOnly }).then(() => true),
      'Failed to delete NCR',
    );
    if (!result) return false;
    if (showDeleted) {
      // Keep it visible, marked as deleted; the reload brings the server copy.
      reload();
    } else {
      setNcrs((previous) => previous.filter((entry) => entry.id !== ncr.id));
    }
    setDetail((previous) => (previous && previous.ncr.id === ncr.id ? null : previous));
    return true;
  }, [projectId, readOnly, reload, runAction, showDeleted]);

  return {
    showDeleted,
    setShowDeleted,
    ncrs,
    loading,
    loadError,
    reload,
    editor,
    openCreate,
    openEdit,
    closeEditor,
    setDraft,
    saveEditor,
    detail,
    openDetail,
    closeDetail,
    approve,
    remove,
    busy,
    actionError,
  };
}
