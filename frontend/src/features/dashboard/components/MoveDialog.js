import React, { useMemo, useState } from 'react';
import { buildFolderChildren, folderSubtreeIds } from '../dashboardUtils';

/**
 * Pick a destination folder inside the current access group.
 *
 * Disabled destinations: locked (archived) folders, the moved folders
 * themselves and anything below them, and the items' current location when
 * every item already lives there.
 */
export default function MoveDialog({ items, folders, accessGroup, onClose, onSubmit, busy = false }) {
  const [target, setTarget] = useState(undefined);
  const [error, setError] = useState('');
  const childrenMap = useMemo(() => buildFolderChildren(folders), [folders]);

  const blocked = useMemo(() => {
    const set = new Set();
    items.filter((i) => i.type === 'folder').forEach((i) => {
      folderSubtreeIds(childrenMap, i.id).forEach((id) => set.add(id));
    });
    return set;
  }, [items, childrenMap]);

  const currentParents = new Set(items.map((i) => (i.type === 'folder' ? i.parent_id : i.folder_id) || null));
  const onlyLocation = currentParents.size === 1 ? [...currentParents][0] : undefined;

  const rows = [];
  const walk = (parent, depth) => {
    (childrenMap.get(parent) || []).forEach((folder) => {
      rows.push({ folder, depth });
      walk(folder.id, depth + 1);
    });
  };
  walk(null, 0);

  const isDisabled = (id) => {
    if (id === onlyLocation) return true;
    if (id === null) return false;
    const folder = folders.find((f) => f.id === id);
    return blocked.has(id) || Boolean(folder?.effective_archived);
  };

  const title = items.length === 1 ? `Move "${items[0].name}"` : `Move ${items.length} items`;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (target === undefined) {
      setError('Choose a destination folder.');
      return;
    }
    const result = await onSubmit(target);
    if (result && result.error) setError(result.error);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title">
      <div className="modal-content">
        <div className="modal-header">
          <h3 id="move-dialog-title">{title}</h3>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="muted">
            Destination inside access group <strong>{accessGroup}</strong>. Items cannot move between access groups.
          </p>
          <form id="move-form" onSubmit={handleSubmit}>
            <div className="move-target-list" role="radiogroup" aria-label="Destination folder">
              <label className={`move-target${isDisabled(null) ? ' is-disabled' : ''}`}>
                <input
                  type="radio"
                  name="move-target"
                  value=""
                  disabled={isDisabled(null)}
                  checked={target === null}
                  onChange={() => { setTarget(null); setError(''); }}
                />
                <span>Top level ({accessGroup})</span>
              </label>
              {rows.map(({ folder, depth }) => {
                const disabled = isDisabled(folder.id);
                let reason = '';
                if (folder.effective_archived) reason = ' (archived)';
                else if (blocked.has(folder.id)) reason = ' (being moved)';
                else if (folder.id === onlyLocation) reason = ' (current)';
                return (
                  <label
                    key={folder.id}
                    className={`move-target${disabled ? ' is-disabled' : ''}`}
                    style={{ paddingLeft: `${depth * 16 + 8}px` }}
                  >
                    <input
                      type="radio"
                      name="move-target"
                      value={folder.id}
                      disabled={disabled}
                      checked={target === folder.id}
                      onChange={() => { setTarget(folder.id); setError(''); }}
                    />
                    <span>{folder.name}{reason}</span>
                  </label>
                );
              })}
            </div>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="move-form" className="btn btn-primary" disabled={busy || target === undefined}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
