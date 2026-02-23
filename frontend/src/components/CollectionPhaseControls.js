import React, { useState } from 'react';

const PHASE_TRANSITIONS = {
  draft: [{ target: 'annotating', label: 'Start Annotating', confirm: 'Move to annotating phase? Image roster will be locked.' }],
  annotating: [{ target: 'review', label: 'Start Review', confirm: 'Move to review phase? Annotation creation will continue, but image roster is locked.' }],
  review: [
    { target: 'certified', label: 'Certify', confirm: null },
    { target: 'annotating', label: 'Reopen for Annotation', confirm: 'Reopen collection for further annotation?' },
  ],
  certified: [{ target: 'review', label: 'Reopen', confirm: null, requiresReason: true }],
};

const PHASE_LABELS = {
  draft: 'Draft',
  annotating: 'Annotating',
  review: 'Review',
  certified: 'Certified',
};

function CollectionPhaseControls({ collection, onPhaseChanged, onCertify }) {
  const [confirming, setConfirming] = useState(null);
  const [reopenReason, setReopenReason] = useState('');
  const [loading, setLoading] = useState(false);

  if (!collection) return null;

  const transitions = PHASE_TRANSITIONS[collection.phase] || [];

  const handleTransition = async (target) => {
    setLoading(true);
    try {
      if (target === 'certified' && onCertify) {
        onCertify();
        setConfirming(null);
        return;
      }
      const body = { phase: target };
      if (target === 'review' && collection.phase === 'certified') {
        body.reopen_reason = reopenReason;
      }
      const resp = await fetch(`/api/collections/${collection.id}/phase`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const updated = await resp.json();
        if (onPhaseChanged) onPhaseChanged(updated);
      }
      setConfirming(null);
      setReopenReason('');
    } catch (err) {
      console.error('Failed to update phase:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="collection-phase-controls">
      <div className="phase-current">
        <span className={`phase-badge phase-${collection.phase}`}>
          {PHASE_LABELS[collection.phase]}
        </span>
      </div>
      <div className="phase-actions">
        {transitions.map(t => (
          <div key={t.target}>
            {confirming === t.target ? (
              <div className="phase-confirm">
                <p className="phase-confirm-msg">
                  {t.confirm || `Transition to ${PHASE_LABELS[t.target]}?`}
                </p>
                {t.requiresReason && (
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Reason for reopening"
                    value={reopenReason}
                    onChange={e => setReopenReason(e.target.value)}
                  />
                )}
                <div className="phase-confirm-actions">
                  <button
                    className="btn btn-primary btn-small"
                    onClick={() => handleTransition(t.target)}
                    disabled={loading || (t.requiresReason && !reopenReason.trim())}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => { setConfirming(null); setReopenReason(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setConfirming(t.target)}
              >
                {t.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CollectionPhaseControls;
