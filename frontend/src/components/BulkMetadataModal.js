import React, { useState, useMemo } from 'react';
import { updateImageMetadata } from '../api/images';

const BATCH_SIZE = 15;

function BulkMetadataModal({ selectedImages, onClose, onImageUpdated, refreshProjectImages, onClearSelection }) {
  const [metaKey, setMetaKey] = useState('');
  const [metaValue, setMetaValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const parsedPreview = useMemo(() => {
    if (!metaValue) return { value: '', type: 'string (empty)' };
    try {
      const parsed = JSON.parse(metaValue);
      const type = Array.isArray(parsed) ? 'array' : (parsed === null ? 'null' : typeof parsed);
      return { value: JSON.stringify(parsed, null, 2), type: `JSON ${type}` };
    } catch {
      return { value: metaValue, type: 'string' };
    }
  }, [metaValue]);

  const updateMetadata = (imageId, key, value) =>
    updateImageMetadata(imageId, key, value);

  const handleSubmit = async () => {
    if (metaKey.trim() === '') {
      setError('Metadata key cannot be empty');
      return;
    }

    let parsedValue = metaValue;
    try {
      parsedValue = JSON.parse(metaValue);
    } catch {
      // treat as plain string
    }

    setSubmitting(true);
    setError(null);

    const ids = Array.from(selectedImages);
    const allResults = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(id => updateMetadata(id, metaKey.trim(), parsedValue))
      );
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
      setError(`${failed.length} update(s) failed. Succeeded: ${succeeded.length}`);
    } else {
      onClose();
      onClearSelection();
    }
  };

  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Add Metadata to Selected Images</h3>
          <button className="modal-close-btn" onClick={onClose} disabled={submitting} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <p>The key-value pair will be applied to all {selectedImages.size} selected image(s).</p>
          <div className="form-group">
            <label htmlFor="bulk-meta-key">Key</label>
            <input
              type="text"
              id="bulk-meta-key"
              value={metaKey}
              onChange={e => { setMetaKey(e.target.value); if (error) setError(null); }}
              placeholder="Enter metadata key"
              disabled={submitting}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="bulk-meta-value">Value</label>
            <textarea
              id="bulk-meta-value"
              rows={3}
              value={metaValue}
              onChange={e => setMetaValue(e.target.value)}
              placeholder="Enter a simple value or valid JSON"
              disabled={submitting}
            />
            <small>You can enter a simple text value or valid JSON (arrays, objects, numbers, booleans, null).</small>
          </div>
          {metaKey.trim() && (
            <div className="form-group">
              <label>Preview</label>
              <div style={{
                background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px',
                padding: '10px', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', maxHeight: '120px', overflowY: 'auto',
              }}>
                <div style={{ marginBottom: '4px', color: '#6c757d', fontSize: '11px' }}>
                  Type: {parsedPreview.type}
                </div>
                <div>
                  <strong>{metaKey.trim()}</strong>: {parsedPreview.value || <em style={{ color: '#999' }}>empty</em>}
                </div>
              </div>
              <small>This will be set on {selectedImages.size} image(s).</small>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Applying...' : 'Apply to All Selected'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkMetadataModal;
