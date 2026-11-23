import React, { useEffect, useState } from 'react';
import { fetchFolderDeletePreview } from '../../../api/folders';
import { errorDetail } from '../dashboardUtils';

/**
 * Delete a folder and everything inside it. Shows what will be removed and
 * requires typing the exact confirmation phrase (``DELETE <folder name>``).
 */
export default function DeleteFolderModal({ folder, onClose, onConfirm, busy = false }) {
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    fetchFolderDeletePreview(folder.id)
      .then((data) => { if (current) setPreview(data); })
      .catch((err) => { if (current) setLoadError(errorDetail(err)); });
    return () => { current = false; };
  }, [folder.id]);

  const phrase = preview?.confirmation_phrase || `DELETE ${folder.name}`;
  const matches = typed === phrase;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!matches) return;
    const result = await onConfirm(typed);
    if (result && result.error) setError(result.error);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
      <div className="modal-content">
        <div className="modal-header">
          <h3 id="delete-folder-title">Delete Folder</h3>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <p>
            This permanently deletes <strong>{folder.name}</strong>, every folder inside it, and every
            project inside those folders, including their images and annotations.
          </p>
          {preview && (
            <ul className="delete-preview-list" aria-label="Items that will be deleted">
              <li>{preview.folders} folder{preview.folders === 1 ? '' : 's'}</li>
              <li>{preview.projects} project{preview.projects === 1 ? '' : 's'}</li>
              <li>{preview.images} image{preview.images === 1 ? '' : 's'}</li>
            </ul>
          )}
          {!preview && !loadError && <p className="muted">Counting contents...</p>}
          {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}
          <p role="alert"><strong>Warning:</strong> This action is irreversible.</p>
          <form id="delete-folder-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="delete_folder_confirm">
                Type <code>{phrase}</code> to confirm
              </label>
              <input
                id="delete_folder_confirm"
                className="form-control"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => { setTyped(event.target.value); setError(''); }}
                onPaste={(event) => event.preventDefault()}
              />
            </div>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="delete-folder-form"
            className="btn btn-danger"
            disabled={!matches || busy || !preview}
          >
            Delete Folder
          </button>
        </div>
      </div>
    </div>
  );
}
