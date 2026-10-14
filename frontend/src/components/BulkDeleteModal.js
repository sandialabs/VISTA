import React, { useState } from 'react';
import { deleteProjectImage } from '../api/images';

const MIN_DELETE_REASON = 5;
const BATCH_SIZE = 15;

function BulkDeleteModal({ projectId, selectedImages, onClose, onImageUpdated, refreshProjectImages, onClearSelection }) {
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const deleteImage = (imageId) =>
    deleteProjectImage(projectId, imageId, { reason: reason.trim(), force });

  const handleSubmit = async () => {
    if (reason.trim().length < MIN_DELETE_REASON) {
      setError(`Reason must be at least ${MIN_DELETE_REASON} characters`);
      return;
    }
    setSubmitting(true);
    setError(null);

    const ids = Array.from(selectedImages);
    const allResults = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(id => deleteImage(id)));
      allResults.push(...results);
    }

    setSubmitting(false);
    const succeeded = allResults.filter(r => r.status === 'fulfilled');
    const failed = allResults.filter(r => r.status === 'rejected');

    if (succeeded.length > 0) {
      succeeded.forEach(r => { if (onImageUpdated) onImageUpdated(r.value); });
      if (refreshProjectImages) refreshProjectImages();
    }

    if (failed.length > 0) {
      setError(`${failed.length} deletion(s) failed. Succeeded: ${succeeded.length}`);
    } else {
      onClose();
      onClearSelection();
    }
  };

  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>{force ? 'Force Delete Selected Images' : 'Delete Selected Images'}</h3>
          <button className="modal-close-btn" onClick={onClose} disabled={submitting} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <p>
            {force
              ? `This will permanently remove ${selectedImages.size} image(s) from storage. Database records will remain for audit purposes.`
              : `${selectedImages.size} image(s) will be soft-deleted and hidden from the default list. They can be restored until retention expires.`}
          </p>
          <div className="form-group">
            <label htmlFor="bulk-delete-reason">Reason (required)</label>
            <textarea
              id="bulk-delete-reason"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={submitting}
            />
            <small>Min {MIN_DELETE_REASON} chars.</small>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={force}
                onChange={e => setForce(e.target.checked)}
                disabled={submitting}
              />
              Force delete (also remove objects from storage)
            </label>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-danger" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Deleting...' : (force ? 'Force Delete' : 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkDeleteModal;
