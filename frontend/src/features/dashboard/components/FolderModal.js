import React, { useEffect, useRef, useState } from 'react';

const NAME_MAX = 255;

/** Create or edit a folder (name required; description optional). */
export default function FolderModal({ mode = 'create', folder = null, parentName, onClose, onSubmit, busy = false }) {
  const [name, setName] = useState(folder?.name || '');
  const [description, setDescription] = useState(folder?.description || '');
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Folder name is required.');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Folder name must be at most ${NAME_MAX} characters.`);
      return;
    }
    setError('');
    const result = await onSubmit({ name: trimmed, description: description.trim() || null });
    if (result && result.error) setError(result.error);
  };

  const title = mode === 'create' ? 'New Folder' : 'Edit Folder';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
      <div className="modal-content">
        <div className="modal-header">
          <h3 id="folder-modal-title">{title}</h3>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {mode === 'create' && (
            <p className="muted">Location: {parentName || 'Top level'}</p>
          )}
          <form id="folder-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="folder_name">Folder Name *</label>
              <input
                id="folder_name"
                ref={nameRef}
                className="form-control"
                type="text"
                maxLength={NAME_MAX}
                value={name}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'folder_name_error' : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setError('');
                }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="folder_description">Description</label>
              <textarea
                id="folder_description"
                className="form-control"
                rows="2"
                maxLength={4000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {error && (
              <div id="folder_name_error" className="alert alert-error" role="alert">{error}</div>
            )}
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="folder-form" className="btn btn-success" disabled={busy}>
            {mode === 'create' ? 'Create Folder' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
