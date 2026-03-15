import React, { useState } from 'react';

const MIN_REASON = 5;

/**
 * Modal for confirming image deletion (soft or force).
 *
 * Props:
 *   image             - image object
 *   projectId         - project UUID
 *   setImage          - setter to update the image in the parent
 *   refreshProjectImages - callback to reload the project image list
 *   show              - boolean controlling visibility
 *   onClose           - callback to close the modal
 */
function ImageDeleteModal({ image, projectId, setImage, refreshProjectImages, show, onClose }) {
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const [showForceDeleteConfirm, setShowForceDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const resetState = () => {
    setReason('');
    setForce(false);
    setDeleteError(null);
    setShowForceDeleteConfirm(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleDelete = async () => {
    if (reason.trim().length < MIN_REASON) {
      setDeleteError(`Reason must be at least ${MIN_REASON} characters`);
      return;
    }

    if (force && !showForceDeleteConfirm) {
      setShowForceDeleteConfirm(true);
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch(`/api/projects/${projectId}/images/${image.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), force })
      });
      if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(`Delete failed (${resp.status}): ${detail}`);
      }
      const data = await resp.json();
      setImage(data);
      if (refreshProjectImages) refreshProjectImages();
      handleClose();
    } catch (e) {
      setDeleteError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>{force ? 'Force Delete Image' : 'Delete Image'}</h3>
          <span className="close-modal" onClick={handleClose}>&times;</span>
        </div>

        <div className="modal-body">
          <p>
            {force
              ? 'This will remove the file from storage immediately. Database record stays for audit.'
              : 'The image will be hidden and can be restored until retention expires.'}
          </p>

          {force && showForceDeleteConfirm && (
            <div
              className="alert alert-warning"
              style={{
                margin: '16px 0',
                padding: '12px',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffeaa7',
                borderRadius: '4px',
                color: '#856404'
              }}
            >
              <strong>Final Warning:</strong> This action will permanently delete the image
              file from storage and cannot be undone. Are you absolutely sure you want to
              proceed?
            </div>
          )}

          <div className="form-group">
            <label htmlFor="delete-reason">Reason (required)</label>
            <textarea
              id="delete-reason"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Enter a reason for deleting this image..."
            />
            <small>Min {MIN_REASON} chars. Helps auditing.</small>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={force}
                onChange={e => {
                  setForce(e.target.checked);
                  if (!e.target.checked) {
                    setShowForceDeleteConfirm(false);
                  }
                }}
              />
              Force delete (also remove object from storage)
            </label>
          </div>

          {deleteError && <div className="alert alert-error">{deleteError}</div>}
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={submitting}
          >
            {submitting
              ? 'Deleting...'
              : force && showForceDeleteConfirm
                ? 'Permanently Delete'
                : force
                  ? 'Force Delete'
                  : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageDeleteModal;
