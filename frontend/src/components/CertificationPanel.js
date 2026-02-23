import React, { useState, useEffect } from 'react';

function CertificationPanel({ collection, onCertified }) {
  const [progress, setProgress] = useState(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!collection) return;
    fetch(`/api/collections/${collection.id}/review-progress`)
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => { if (data) setProgress(data); })
      .catch(err => console.error('Failed to fetch review progress:', err));
  }, [collection]);

  if (!collection) return null;

  if (collection.phase === 'certified') {
    return (
      <div className="certification-panel certified">
        <h4>Collection Certified</h4>
        <div className="certification-info">
          <p>Certified at: {new Date(collection.certified_at).toLocaleString()}</p>
          {collection.certification_notes && (
            <p>Notes: {collection.certification_notes}</p>
          )}
        </div>
      </div>
    );
  }

  if (collection.phase !== 'review') return null;

  const canCertify = progress &&
    progress.unreviewed === 0 &&
    progress.annotation_pending === 0 &&
    progress.annotation_flagged === 0;

  const handleCertify = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/collections/${collection.id}/certify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certification_notes: notes || null }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (onCertified) onCertified(data);
      } else {
        const errData = await resp.json();
        setError(errData.detail || 'Certification failed');
      }
    } catch (err) {
      setError('Failed to certify collection');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="certification-panel">
      <h4>Certification</h4>
      {progress && (
        <div className="certification-checklist">
          <div className={`cert-check ${progress.unreviewed === 0 ? 'pass' : 'fail'}`}>
            All images reviewed: {progress.unreviewed === 0 ? 'Yes' : `${progress.unreviewed} remaining`}
          </div>
          <div className={`cert-check ${progress.annotation_pending === 0 ? 'pass' : 'fail'}`}>
            No pending annotations: {progress.annotation_pending === 0 ? 'Yes' : `${progress.annotation_pending} pending`}
          </div>
          <div className={`cert-check ${progress.annotation_flagged === 0 ? 'pass' : 'fail'}`}>
            No flagged annotations: {progress.annotation_flagged === 0 ? 'Yes' : `${progress.annotation_flagged} flagged`}
          </div>
        </div>
      )}
      <textarea
        className="form-control certification-notes"
        placeholder="Certification notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
      />
      {error && <div className="alert alert-error">{error}</div>}
      <button
        className="btn btn-primary"
        onClick={handleCertify}
        disabled={!canCertify || loading}
      >
        {loading ? 'Certifying...' : 'Certify Collection'}
      </button>
    </div>
  );
}

export default CertificationPanel;
