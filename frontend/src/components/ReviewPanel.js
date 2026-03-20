import React, { useState, useEffect, useCallback } from 'react';

const STATUS_LABELS = {
  unreviewed: 'Unreviewed',
  pass: 'Pass',
  reject_pending: 'Reject (Pending)',
  reject_confirmed: 'Reject (Confirmed)',
};

const STATUS_COLORS = {
  unreviewed: '#94a3b8',
  pass: '#16a34a',
  reject_pending: '#f59e0b',
  reject_confirmed: '#dc2626',
};

function ReviewPanel({ imageId }) {
  const [reviews, setReviews] = useState([]);
  const [currentStatus, setCurrentStatus] = useState('unreviewed');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadReviews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/images/${imageId}/reviews`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setReviews(data);
      setCurrentStatus(data.length > 0 ? data[0].status : 'unreviewed');
    } catch (err) {
      console.error('Failed to load reviews:', err);
      setError('Failed to load review status');
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  useEffect(() => {
    if (imageId) loadReviews();
  }, [imageId, loadReviews]);

  const submitReview = async (status) => {
    try {
      setSubmitting(true);
      setError(null);
      const response = await fetch(`/api/images/${imageId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Review failed (${response.status}): ${detail}`);
      }
      await loadReviews();
    } catch (err) {
      console.error('Failed to submit review:', err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const revokeReview = async (reviewId) => {
    try {
      setSubmitting(true);
      setError(null);
      const response = await fetch(`/api/reviews/${reviewId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Revoke failed (${response.status}): ${detail}`);
      }
      await loadReviews();
    } catch (err) {
      console.error('Failed to revoke review:', err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard shortcuts: p = pass, r = reject
  const submitRef = React.useRef(submitReview);
  submitRef.current = submitReview;
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'p') submitRef.current('pass');
      else if (e.key === 'r') submitRef.current('reject_pending');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const statusColor = STATUS_COLORS[currentStatus] || '#94a3b8';
  const statusLabel = STATUS_LABELS[currentStatus] || 'Unknown';

  return (
    <div className="review-panel" style={{
      background: 'var(--bg-primary, #ffffff)',
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--border-light, #e2e8f0)',
      padding: '0.5rem',
      marginBottom: '0.5rem',
    }}>
      {error && (
        <div style={{
          padding: '3px 6px', marginBottom: '4px',
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '3px', fontSize: '0.72rem', color: '#dc2626',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{
            float: 'right', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: '0.8rem', color: '#dc2626',
          }} aria-label="Dismiss error">x</button>
        </div>
      )}

      {/* Compact single row: status badge + action buttons + revert */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{
          display: 'inline-block', padding: '1px 6px',
          borderRadius: '8px', fontSize: '0.68rem', fontWeight: 600,
          color: '#fff', backgroundColor: statusColor, whiteSpace: 'nowrap',
        }}>
          {loading ? '...' : statusLabel}
        </span>
        <button
          onClick={() => submitReview('pass')}
          disabled={submitting || loading}
          title="Pass (P)"
          style={{
            flex: 1, padding: '3px 0',
            border: currentStatus === 'pass' ? '2px solid #16a34a' : '1px solid var(--border-light, #e2e8f0)',
            borderRadius: '4px',
            background: currentStatus === 'pass' ? '#f0fdf4' : 'var(--bg-secondary, #f8fafc)',
            color: '#16a34a', fontWeight: 600, fontSize: '0.75rem',
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          Pass
        </button>
        <button
          onClick={() => submitReview('reject_pending')}
          disabled={submitting || loading}
          title="Reject (R)"
          style={{
            flex: 1, padding: '3px 0',
            border: currentStatus === 'reject_pending' ? '2px solid #f59e0b' : '1px solid var(--border-light, #e2e8f0)',
            borderRadius: '4px',
            background: currentStatus === 'reject_pending' ? '#fffbeb' : 'var(--bg-secondary, #f8fafc)',
            color: '#d97706', fontWeight: 600, fontSize: '0.75rem',
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          Reject
        </button>
        {currentStatus !== 'unreviewed' && reviews.length > 0 && (
          <button
            onClick={() => revokeReview(reviews[0].id)}
            disabled={submitting}
            title="Revert to unreviewed"
            style={{
              padding: '3px 6px', border: '1px solid var(--border-light, #e2e8f0)',
              borderRadius: '4px', background: 'transparent',
              color: 'var(--gray-500, #64748b)', fontSize: '0.68rem',
              cursor: submitting ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Revert
          </button>
        )}
      </div>

      {/* Secondary review confirmation (only when reject_pending) */}
      {currentStatus === 'reject_pending' && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: '0.72rem', cursor: 'pointer', userSelect: 'none',
          padding: '3px 6px', marginTop: '4px',
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '3px',
        }}>
          <input
            type="checkbox" checked={false}
            onChange={() => submitReview('reject_confirmed')}
            disabled={submitting}
            style={{ cursor: 'pointer', width: 12, height: 12 }}
          />
          Confirm rejection (secondary review)
        </label>
      )}

      {/* Review history toggle */}
      {reviews.length > 0 && (
        <div style={{ marginTop: '3px' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: 'none', border: 'none',
              color: 'var(--primary-color, #2563eb)',
              fontSize: '0.68rem', cursor: 'pointer',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {showHistory ? 'Hide' : 'Show'} history ({reviews.length})
          </button>

          {showHistory && (
            <div style={{ marginTop: '3px', maxHeight: '120px', overflowY: 'auto' }}>
              {reviews.map((review) => (
                <div key={review.id} style={{
                  padding: '2px 4px',
                  borderBottom: '1px solid var(--border-light, #e2e8f0)',
                  fontSize: '0.68rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, color: STATUS_COLORS[review.status] || '#94a3b8' }}>
                      {STATUS_LABELS[review.status] || review.status}
                    </span>
                    <span style={{ color: 'var(--gray-400, #94a3b8)' }}>
                      {new Date(review.created_at).toLocaleString()}
                    </span>
                  </div>
                  <span style={{ color: 'var(--gray-500, #64748b)' }}>
                    {review.reviewer_email?.split('@')[0] || 'Unknown'}
                  </span>
                  {review.notes && (
                    <span style={{ color: 'var(--gray-600, #475569)', marginLeft: '6px' }}>
                      {review.notes}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReviewPanel;
