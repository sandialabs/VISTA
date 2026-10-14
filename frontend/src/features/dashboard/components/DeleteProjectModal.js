import React, { memo, useState } from 'react';

const DeleteProjectModal = memo(function DeleteProjectModal({ project, onClose, onConfirm, canDelete = true }) {
  const [acknowledgeIrreversible, setAcknowledgeIrreversible] = useState(false);
  const canSubmit = canDelete && acknowledgeIrreversible;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!project) return;
    if (!canSubmit) return;
    onConfirm(project);
  };

  if (!project) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Delete Project</h3>
          <span className="close" onClick={onClose}>&times;</span>
        </div>
        <div className="modal-body">
          <p>
            This action permanently deletes <strong>{project.name}</strong> and related project data.
          </p>
          <p role="alert">
            <strong>Warning:</strong> This action is irreversible and cannot be undone.
          </p>
          <form id="delete-project-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="delete_irreversible_acknowledge">
                <input
                  id="delete_irreversible_acknowledge"
                  type="checkbox"
                  checked={acknowledgeIrreversible}
                  onChange={(e) => setAcknowledgeIrreversible(e.target.checked)}
                />{' '}
                I understand that deleting <strong>{project.name}</strong> is irreversible.
              </label>
            </div>
            {!canDelete && (
              <p role="alert">You are not authorized to delete this project.</p>
            )}
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="delete-project-form"
            className="btn btn-danger btn-large"
            disabled={!canSubmit}
          >
            Delete Project
          </button>
        </div>
      </div>
    </div>
  );
});

export default DeleteProjectModal;
