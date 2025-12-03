import React, { useState, useEffect } from 'react';

// Minimal shared deletion controls for single image view
// Props: projectId, image, setImage, onImageRemoved (optional), refreshProjectImages (optional)
function ImageDeletionControls({ projectId, image, setImage, onImageRemoved, refreshProjectImages }) {
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const MIN_REASON = 5; // Keep in sync with backend default IMAGE_DELETE_REASON_MIN_CHARS

  useEffect(() => {
    if (!showModal) {
      setReason("");
      setForce(false);
      setError(null);
      setSubmitting(false);
    }
  }, [showModal]);

  if (!image) return null;

  const deleted = !!image.deleted_at;
  const permanentlyDeleted = !!image.storage_deleted;

  const retentionDeadline = image.pending_hard_delete_at ? new Date(image.pending_hard_delete_at) : null;
  const now = new Date();
  let retentionCountdown = null;
  if (deleted && retentionDeadline) {
    const diffMs = retentionDeadline - now;
    if (diffMs > 0) {
      const days = Math.floor(diffMs / (1000*60*60*24));
      const hours = Math.floor((diffMs / (1000*60*60)) % 24);
      retentionCountdown = `${days}d ${hours}h`;
    } else {
      retentionCountdown = 'pending purge';
    }
  }

  const handleDelete = async () => {
    if (reason.trim().length < MIN_REASON) {
      setError(`Reason must be at least ${MIN_REASON} characters`);
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
      if (onImageRemoved && !data.deleted_at) {
        onImageRemoved(data.id);
      }
      if (refreshProjectImages) refreshProjectImages();
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async () => {
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/projects/${projectId}/images/${image.id}/restore`, { method: 'POST' });
      if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(`Restore failed (${resp.status}): ${detail}`);
      }
      const data = await resp.json();
      setImage(data);
      if (refreshProjectImages) refreshProjectImages();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: '10px' }}>
      <div className="card-header">
        <h2>Deletion & Recovery</h2>
      </div>
      <div className="card-content">
        {!deleted && !permanentlyDeleted && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-danger" onClick={() => setShowModal(true)}>Delete Image</button>
            <span className="help-text">Soft delete: image hidden from default list. Force delete also removes storage object.</span>
          </div>
        )}
        {deleted && !permanentlyDeleted && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <strong>Status:</strong> Soft deleted{retentionCountdown && ` (retention ${retentionCountdown})`}.
            </div>
            {image.deletion_reason && (
              <div><strong>Reason:</strong> {image.deletion_reason}</div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn" onClick={handleRestore} disabled={submitting}>Restore</button>
              <button className="btn btn-danger" onClick={() => { setForce(true); setShowModal(true); }}>Force Delete</button>
            </div>
          </div>
        )}
        {permanentlyDeleted && (
            <div>
              <strong>Status:</strong> Permanently deleted from storage.
              {image.deletion_reason && (<div><strong>Reason:</strong> {image.deletion_reason}</div>)}
            </div>
        )}
        {error && <div className="alert alert-error" style={{ marginTop: '8px' }}>{error}</div>}
      </div>

      {showModal && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <span className="close-modal" onClick={() => setShowModal(false)}>&times;</span>
            <h3>{force ? 'Force Delete Image' : 'Delete Image'}</h3>
            <p>{force ? 'This will remove the file from storage immediately. Database record stays for audit.' : 'The image will be hidden and can be restored until retention expires.'}</p>
            <div className="form-group">
              <label htmlFor="delete-reason">Reason (required)</label>
              <textarea id="delete-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
              <small>Min {MIN_REASON} chars. Helps auditing.</small>
            </div>
            {!deleted && !force && (
              <div className="form-group">
                <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
                  Force delete (also remove object from storage)
                </label>
              </div>
            )}
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={submitting}>{submitting ? 'Deleting...' : (force ? 'Force Delete' : 'Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImageDeletionControls;
