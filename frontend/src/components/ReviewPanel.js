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
      padding: '0.75rem',
      marginBottom: '0.75rem',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.5rem',
      }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>
          Review Status
        </h4>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#fff',
          backgroundColor: statusColor,
        }}>
          {loading ? '...' : statusLabel}
        </span>
      </div>

      {error && (
        <div style={{
          padding: '0.4rem 0.6rem',
          marginBottom: '0.5rem',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '4px',
          fontSize: '0.8rem',
          color: '#dc2626',
        }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: 'right',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.9rem',
              color: '#dc2626',
            }}
            aria-label="Dismiss error"
          >
            x
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
        <button
          onClick={() => submitReview('pass')}
          disabled={submitting || loading}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            border: currentStatus === 'pass' ? '2px solid #16a34a' : '1px solid var(--border-light, #e2e8f0)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: currentStatus === 'pass' ? '#f0fdf4' : 'var(--bg-secondary, #f8fafc)',
            color: '#16a34a',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: submitting ? 'wait' : 'pointer',
            transition: 'all 150ms',
          }}
          title="Mark image as passed inspection"
        >
          Pass
        </button>
        <button
          onClick={() => submitReview('reject_pending')}
          disabled={submitting || loading}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            border: currentStatus === 'reject_pending' ? '2px solid #f59e0b' : '1px solid var(--border-light, #e2e8f0)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: currentStatus === 'reject_pending' ? '#fffbeb' : 'var(--bg-secondary, #f8fafc)',
            color: '#d97706',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: submitting ? 'wait' : 'pointer',
            transition: 'all 150ms',
          }}
          title="Reject image (requires secondary review)"
        >
          Reject
        </button>
      </div>

      {/* Secondary review confirmation (only when status is reject_pending) */}
      {currentStatus === 'reject_pending' && (
        <div style={{
          padding: '0.5rem',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: 'var(--radius-sm, 6px)',
          marginBottom: '0.5rem',
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            cursor: 'pointer',
            userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={false}
              onChange={() => {
                submitReview('reject_confirmed');
              }}
              disabled={submitting}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 500 }}>
              Secondary Review: Confirm Rejection
            </span>
          </label>
          <div style={{
            fontSize: '0.75rem',
            color: '#92400e',
            marginTop: '0.25rem',
            paddingLeft: '1.5rem',
          }}>
            A senior team member should confirm this rejection.
          </div>
        </div>
      )}

      {/* Reset to unreviewed */}
      {currentStatus !== 'unreviewed' && reviews.length > 0 && (
        <button
          onClick={() => revokeReview(reviews[0].id)}
          disabled={submitting}
          style={{
            width: '100%',
            padding: '0.3rem',
            border: '1px solid var(--border-light, #e2e8f0)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: 'transparent',
            color: 'var(--gray-500, #64748b)',
            fontSize: '0.75rem',
            cursor: submitting ? 'wait' : 'pointer',
            marginBottom: '0.5rem',
          }}
          title="Revert review status to unreviewed"
        >
          Revert
        </button>
      )}

      {/* Review history toggle */}
      {reviews.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary-color, #2563eb)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            {showHistory ? 'Hide' : 'Show'} review history ({reviews.length})
          </button>

          {showHistory && (
            <div style={{ marginTop: '0.4rem', maxHeight: '150px', overflowY: 'auto' }}>
              {reviews.map((review) => (
                <div
                  key={review.id}
                  style={{
                    padding: '0.3rem 0.5rem',
                    borderBottom: '1px solid var(--border-light, #e2e8f0)',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{
                      fontWeight: 600,
                      color: STATUS_COLORS[review.status] || '#94a3b8',
                    }}>
                      {STATUS_LABELS[review.status] || review.status}
                    </span>
                    <span style={{ color: 'var(--gray-400, #94a3b8)' }}>
                      {new Date(review.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ color: 'var(--gray-500, #64748b)', marginTop: '2px' }}>
                    By: {review.reviewer_email?.split('@')[0] || 'Unknown User'}
                  </div>
                  {review.notes && (
                    <div style={{ color: 'var(--gray-600, #475569)', marginTop: '2px' }}>
                      {review.notes}
                    </div>
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
